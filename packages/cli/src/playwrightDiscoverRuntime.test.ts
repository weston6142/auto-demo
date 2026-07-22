import { describe, expect, it, vi } from "vitest";
import type { DiscoverHostBootstrap } from "./discoverBackend.js";
import { createPlaywrightDiscoverRuntime } from "./playwrightDiscoverRuntime.js";

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
});

function bootstrap(): DiscoverHostBootstrap {
  return {
    schemaVersion: 1,
    sessionId: "capture-helper-preflight",
    sessionDirectory: "/tmp/capture-helper-preflight",
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
