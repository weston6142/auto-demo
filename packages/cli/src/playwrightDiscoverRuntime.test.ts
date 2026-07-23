import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CoordinateDiscoveryPage,
  CoordinatePageState,
  DiscoveryBrowserLaunchHandle,
} from "@auto-demo/agent";
import type { Page } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiscoverHostBootstrap } from "./discoverBackend.js";
import { createPlaywrightDiscoverRuntime } from "./playwrightDiscoverRuntime.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("Playwright discover runtime", () => {
  it("fails before launching a browser when the macOS capture helper is unavailable", async () => {
    const launchBrowser = vi.fn();
    const result = await createPlaywrightDiscoverRuntime(bootstrap(), {
      platform: "darwin",
      launchBrowser,
      async preflightCaptureHelper() {
        return {
          ok: false,
          code: "capture_helper_permission_required",
          message: "Auto Demo Capture needs Screen Recording permission.",
          setupCommand: "npm run autodemo -- setup capture-helper --json",
        };
      },
    });

    expect(result.initialResponse).toEqual({
      ok: false,
      code: "capture_helper_permission_required",
      message: "Auto Demo Capture needs Screen Recording permission.",
      setupCommand: "npm run autodemo -- setup capture-helper --json",
    });
    expect(launchBrowser).not.toHaveBeenCalled();
  });

  it("retains the exact private stage when a discovery action throws", async () => {
    const sessionDirectory = await mkdtemp(join(tmpdir(), "auto-demo-runtime-diagnostics-"));
    tempDirectories.push(sessionDirectory);
    await chmod(sessionDirectory, 0o700);
    const rawPage = new FakeRawPage();
    const coordinatePage = new ThrowingCoordinatePage();
    const launched: DiscoveryBrowserLaunchHandle = {
      ok: true,
      page: rawPage as unknown as Page,
      profile: {
        schemaVersion: 1,
        browser: "chromium",
        channel: "chrome",
        headless: false,
        viewport: { width: 1280, height: 720 },
      },
      profileId: `sha256:${"a".repeat(64)}`,
      attempts: [],
      async close() {},
    };
    const result = await createPlaywrightDiscoverRuntime(bootstrap(sessionDirectory), {
      platform: "linux",
      async createWindowCapture() {
        return undefined;
      },
      async launchBrowser() {
        return launched;
      },
      createCoordinatePage() {
        return coordinatePage;
      },
    });
    expect(result.initialResponse.ok).toBe(true);

    await expect(
      result.runtime.act({
        frameId: "frame-1",
        actions: [{ type: "click", x: 700, y: 80 }],
      }),
    ).rejects.toThrow("runtime-navigation-secret");
    await result.runtime.abandon();

    const diagnosticText = await readFile(
      join(sessionDirectory, "discover-host-diagnostics.jsonl"),
      "utf8",
    );
    const diagnostics = diagnosticText
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "runtime_started", channel: "chrome" }),
        expect.objectContaining({
          event: "coordinate_action_stage_failed",
          stage: "after_action_state",
          actionIndex: 0,
          actionType: "click",
        }),
        expect.objectContaining({
          event: "runtime_operation_failed",
          operation: "act",
          stage: "coordinate_session",
        }),
        expect.objectContaining({ event: "runtime_stopped" }),
      ]),
    );
    expect(diagnosticText).not.toContain("runtime-navigation-secret");
  });
});

function bootstrap(sessionDirectory = "/tmp/capture-helper-preflight"): DiscoverHostBootstrap {
  return {
    schemaVersion: 1,
    sessionId: "capture-helper-preflight",
    sessionDirectory,
    token: "capture-helper-private-token",
    start: {
      url: "https://example.com",
      goal: "Open the first result",
      risk: "public-browse",
      allowedOrigins: [],
      grid: false,
    },
  };
}

class FakeRawPage {
  private readonly main = {};
  private readonly listeners = new Set<(response: unknown) => void>();

  mainFrame() {
    return this.main;
  }

  on(_event: "response", listener: (response: unknown) => void) {
    this.listeners.add(listener);
  }

  off(_event: "response", listener: (response: unknown) => void) {
    this.listeners.delete(listener);
  }
}

class ThrowingCoordinatePage implements CoordinateDiscoveryPage {
  private executed = false;
  private readonly pageState: CoordinatePageState = {
    documentToken: "document-1",
    url: "https://example.com",
    title: "Vehicle search",
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0 },
    popup: "closed",
    layoutIdentity: "layout-1",
  };

  pointer() {
    return { x: 64, y: 64 };
  }

  async captureFrame(input: { id: string; pointer: { x: number; y: number } }) {
    return {
      id: input.id,
      png: Buffer.from("png"),
      width: 1280,
      height: 720,
      deviceScaleFactor: 1 as const,
      pointer: { ...input.pointer },
    };
  }

  async state() {
    if (this.executed) throw new Error("runtime-navigation-secret");
    return structuredClone(this.pageState);
  }

  async challenge() {
    return false;
  }

  async inspectPoint() {
    return undefined;
  }

  async execute() {
    this.executed = true;
  }
}
