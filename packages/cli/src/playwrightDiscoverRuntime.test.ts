import { chmod, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CoordinateDiscoveryFinalizeResult,
  CoordinateDiscoveryPage,
  CoordinatePageState,
  CoordinateDiscoveryStore,
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

  it("starts diagnostics before launch and retains bounded failed-attempt evidence", async () => {
    const sessionDirectory = await mkdtemp(join(tmpdir(), "auto-demo-launch-diagnostics-"));
    tempDirectories.push(sessionDirectory);
    await chmod(sessionDirectory, 0o700);

    const result = await createPlaywrightDiscoverRuntime(bootstrap(sessionDirectory), {
      platform: "linux",
      async launchBrowser(input) {
        const diagnosticInput = input as typeof input & {
          onMainDocumentResponse?: (response: {
            ordinal: 1 | 2 | 3;
            profileId: string;
            status: number;
            url: string;
          }) => void;
          onLaunchAttempt?: (attempt: {
            ordinal: 1 | 2 | 3;
            profileId: string;
            outcome: "browser_navigation_failed";
          }) => void;
        };
        const attempt = {
          ordinal: 1 as const,
          profileId: `sha256:${"b".repeat(64)}`,
          outcome: "browser_navigation_failed" as const,
        };
        diagnosticInput.onMainDocumentResponse?.({
          ordinal: attempt.ordinal,
          profileId: attempt.profileId,
          status: 403,
          url: "https://blocked.example/private?token=launch-secret",
        });
        diagnosticInput.onLaunchAttempt?.(attempt);
        return {
          ok: false,
          code: "browser_profile_fallback_exhausted",
          message: "Browser launch profile fallback was exhausted.",
          attempts: [attempt],
        };
      },
    });

    expect(result.initialResponse).toMatchObject({
      ok: false,
      code: "browser_profile_fallback_exhausted",
    });
    const diagnosticText = await readFile(
      join(sessionDirectory, "discover-host-diagnostics.jsonl"),
      "utf8",
    );
    const diagnostics = diagnosticText
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(diagnostics.map((event) => event.event)).toEqual([
      "main_document_response",
      "browser_launch_attempt",
      "runtime_operation_failed",
      "runtime_stopped",
    ]);
    expect(diagnostics[0]).toMatchObject({
      ordinal: 1,
      profileId: `sha256:${"b".repeat(64)}`,
      status: 403,
      originRelation: "other-origin",
    });
    expect(diagnostics[1]).toMatchObject({
      ordinal: 1,
      profileId: `sha256:${"b".repeat(64)}`,
      outcome: "browser_navigation_failed",
    });
    expect(diagnostics[2]).toMatchObject({ operation: "startup", stage: "browser_launch" });
    expect(diagnosticText).not.toMatch(/blocked\.example|private|launch-secret/u);
  });

  it("records returned checkpoint failures instead of reporting diagnostic success", async () => {
    const sessionDirectory = await mkdtemp(join(tmpdir(), "auto-demo-store-diagnostics-"));
    tempDirectories.push(sessionDirectory);
    await chmod(sessionDirectory, 0o700);
    const rawPage = new FakeRawPage();
    const coordinatePage = new ThrowingCoordinatePage(false);
    const launched = successfulLaunch(rawPage);
    let checkpointWrites = 0;

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
      createCoordinateStore() {
        const store = fileBackedStore(sessionDirectory);
        return {
          ...store,
          async writeCheckpoint(checkpoint) {
            checkpointWrites += 1;
            if (checkpointWrites > 1) {
              return {
                ok: false,
                code: "coordinate_store_write_failed",
                message: "Coordinate discovery state could not be written.",
              };
            }
            return await store.writeCheckpoint(checkpoint);
          },
        } satisfies CoordinateDiscoveryStore;
      },
    });
    expect(result.initialResponse.ok).toBe(true);

    const acted = await result.runtime.act({
      frameId: "frame-1",
      actions: [{ type: "move", x: 500, y: 300 }],
    });
    expect(acted.ok).toBe(true);
    await result.runtime.abandon();

    const diagnosticText = await readFile(
      join(sessionDirectory, "discover-host-diagnostics.jsonl"),
      "utf8",
    );
    expect(diagnosticText).toContain('"event":"runtime_operation_failed"');
    expect(diagnosticText).toContain('"operation":"act"');
    expect(diagnosticText).toContain('"stage":"checkpoint_persistence"');
    expect(diagnosticText).toContain('"operation":"abandon"');
  });

  it("attributes finish failures to the exact finalization stage", async () => {
    const sessionDirectory = await mkdtemp(join(tmpdir(), "auto-demo-finish-diagnostics-"));
    tempDirectories.push(sessionDirectory);
    await chmod(sessionDirectory, 0o700);
    const rawPage = new FakeRawPage();
    const launched = successfulLaunch(rawPage);
    const result = await createPlaywrightDiscoverRuntime(bootstrap(sessionDirectory), {
      platform: "linux",
      async createWindowCapture() {
        return undefined;
      },
      async launchBrowser() {
        return launched;
      },
      createCoordinatePage() {
        return new ThrowingCoordinatePage(false);
      },
      async finalizeCoordinateDiscovery() {
        throw new Error("finish-finalization-secret");
      },
    });
    expect(result.initialResponse.ok).toBe(true);

    await expect(result.runtime.finish()).rejects.toThrow("finish-finalization-secret");
    await result.runtime.abandon();

    const diagnosticText = await readFile(
      join(sessionDirectory, "discover-host-diagnostics.jsonl"),
      "utf8",
    );
    expect(diagnosticText).toContain('"operation":"finish"');
    expect(diagnosticText).toContain('"stage":"finalization"');
    expect(diagnosticText).not.toContain("finish-finalization-secret");
  });

  it("records returned frame failures at the operation boundary", async () => {
    const sessionDirectory = await mkdtemp(join(tmpdir(), "auto-demo-frame-diagnostics-"));
    tempDirectories.push(sessionDirectory);
    const rawPage = new FakeRawPage();
    let frameWrites = 0;
    const result = await createPlaywrightDiscoverRuntime(bootstrap(sessionDirectory), {
      platform: "linux",
      async createWindowCapture() {
        return undefined;
      },
      async launchBrowser() {
        return successfulLaunch(rawPage);
      },
      createCoordinatePage() {
        return new ThrowingCoordinatePage(false);
      },
      createCoordinateStore() {
        const store = fileBackedStore(sessionDirectory);
        return {
          ...store,
          async writeFrame(input) {
            frameWrites += 1;
            if (frameWrites > 1) {
              return {
                ok: false,
                code: "coordinate_store_write_failed",
                message: "Coordinate discovery state could not be written.",
              };
            }
            return await store.writeFrame(input);
          },
        } satisfies CoordinateDiscoveryStore;
      },
    });
    expect(result.initialResponse.ok).toBe(true);

    await expect(result.runtime.observe()).resolves.toMatchObject({
      ok: false,
      code: "coordinate_store_write_failed",
    });
    await result.runtime.abandon();
    const diagnosticText = await readFile(
      join(sessionDirectory, "discover-host-diagnostics.jsonl"),
      "utf8",
    );
    expect(diagnosticText).toContain('"operation":"observe"');
    expect(diagnosticText).toContain('"stage":"frame_persistence"');
  });

  it("records a returned finish checkpoint failure", async () => {
    const sessionDirectory = await mkdtemp(join(tmpdir(), "auto-demo-finish-checkpoint-"));
    tempDirectories.push(sessionDirectory);
    const rawPage = new FakeRawPage();
    let checkpointWrites = 0;
    const result = await createPlaywrightDiscoverRuntime(bootstrap(sessionDirectory), {
      platform: "linux",
      async createWindowCapture() {
        return undefined;
      },
      async launchBrowser() {
        return successfulLaunch(rawPage);
      },
      createCoordinatePage() {
        return new ThrowingCoordinatePage(false);
      },
      createCoordinateStore() {
        const store = fileBackedStore(sessionDirectory);
        return {
          ...store,
          async writeCheckpoint(checkpoint) {
            checkpointWrites += 1;
            return checkpointWrites > 1
              ? {
                  ok: false,
                  code: "coordinate_store_write_failed",
                  message: "Coordinate discovery state could not be written.",
                }
              : await store.writeCheckpoint(checkpoint);
          },
        } satisfies CoordinateDiscoveryStore;
      },
      async finalizeCoordinateDiscovery() {
        return {
          ok: true,
          phase: "repairing",
          replayAttempts: 1,
          failure: { code: "replay_failed" },
        };
      },
    });
    expect(result.initialResponse.ok).toBe(true);

    await expect(result.runtime.finish()).resolves.toMatchObject({ ok: true, phase: "repairing" });
    await result.runtime.abandon();
    const diagnosticText = await readFile(
      join(sessionDirectory, "discover-host-diagnostics.jsonl"),
      "utf8",
    );
    expect(diagnosticText).toContain('"operation":"finish"');
    expect(diagnosticText).toContain('"stage":"checkpoint_persistence"');
  });

  it.each([
    ["plan.replay-validated.json", "review_plan_persistence"],
    ["review.json", "review_artifact_persistence"],
  ] as const)("attributes a blocked %s write to %s", async (artifact, expectedStage) => {
    const sessionDirectory = await mkdtemp(join(tmpdir(), "auto-demo-review-artifact-"));
    tempDirectories.push(sessionDirectory);
    await mkdir(join(sessionDirectory, artifact));
    const result = await createPlaywrightDiscoverRuntime(bootstrap(sessionDirectory), {
      platform: "linux",
      async createWindowCapture() {
        return undefined;
      },
      async launchBrowser() {
        return successfulLaunch(new FakeRawPage());
      },
      createCoordinatePage() {
        return new ThrowingCoordinatePage(false);
      },
      async finalizeCoordinateDiscovery() {
        return reviewRequiredResult();
      },
    });
    expect(result.initialResponse.ok).toBe(true);

    await expect(result.runtime.finish()).rejects.toThrow();
    await result.runtime.abandon();
    const diagnosticText = await readFile(
      join(sessionDirectory, "discover-host-diagnostics.jsonl"),
      "utf8",
    );
    expect(diagnosticText).toContain('"operation":"finish"');
    expect(diagnosticText).toContain(`"stage":"${expectedStage}"`);
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

  constructor(private readonly failAfterAction = true) {}

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
    if (this.executed && this.failAfterAction) throw new Error("runtime-navigation-secret");
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

function successfulLaunch(rawPage: FakeRawPage): DiscoveryBrowserLaunchHandle {
  return {
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
}

function fileBackedStore(sessionDirectory: string): CoordinateDiscoveryStore {
  const frames = new Map<string, Uint8Array>();
  return {
    async initialize() {
      return { ok: true };
    },
    async writeCheckpoint() {
      return { ok: true, path: join(sessionDirectory, "session.json") };
    },
    async loadCheckpoint() {
      return {
        ok: false,
        code: "coordinate_store_read_failed",
        message: "Coordinate discovery state could not be read.",
      };
    },
    async writeFrame(input) {
      frames.set(input.id, input.bytes);
      return {
        ok: true,
        path: `frames/${input.id}.png`,
        sha256: "a".repeat(64),
      };
    },
  };
}

function reviewRequiredResult(): CoordinateDiscoveryFinalizeResult {
  return {
    ok: true,
    phase: "review_required",
    replayAttempts: 1,
    plan: { schemaVersion: 1 },
    review: { schemaVersion: 1 },
    sourceSession: { schemaVersion: 1 },
  } as unknown as CoordinateDiscoveryFinalizeResult;
}
