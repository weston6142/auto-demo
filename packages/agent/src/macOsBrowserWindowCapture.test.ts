import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { createMacOsBrowserWindowCapture } from "./macOsBrowserWindowCapture.js";
import type { MacOsCaptureHelperClient } from "./macOsCaptureHelperClient.js";

describe("macOS browser window capture", () => {
  it("refreshes the viewport region for every capture and normalizes Retina pixels", async () => {
    let evaluation = 0;
    const page = {
      async evaluate() {
        evaluation += 1;
        return {
          region: { x: 40 + evaluation, y: 120, width: 320, height: 240 },
          viewport: { width: 320, height: 240 },
        };
      },
    } as unknown as Page;
    const retina = new PNG({ width: 640, height: 480 });
    retina.data.fill(255);
    const capturedRegions: unknown[] = [];
    const client: MacOsCaptureHelperClient = {
      async capture(region) {
        capturedRegions.push(region);
        return PNG.sync.write(retina);
      },
      async close() {},
    };

    const capture = await createMacOsBrowserWindowCapture(page, {
      platform: "darwin",
      client,
    });
    if (capture === undefined) throw new Error("window capture unavailable");
    const bytes = await capture.capture();
    if (bytes === undefined) throw new Error("window capture unavailable");
    await capture.capture();

    expect(capturedRegions).toEqual([
      { x: 41, y: 120, width: 320, height: 240 },
      { x: 42, y: 120, width: 320, height: 240 },
    ]);
    expect(PNG.sync.read(Buffer.from(bytes))).toMatchObject({ width: 320, height: 240 });
    await capture.close?.();
  });

  it("records a bounded normalization failure without page content", async () => {
    const diagnostics: unknown[] = [];
    const page = {
      async evaluate() {
        return {
          region: { x: 40, y: 120, width: 320, height: 240 },
          viewport: { width: 320, height: 240 },
        };
      },
    } as unknown as Page;
    const client: MacOsCaptureHelperClient = {
      async capture() {
        return Uint8Array.from([1, 2, 3]);
      },
      async recordDiagnostic(event) {
        diagnostics.push(event);
      },
      async close() {},
    };

    const capture = await createMacOsBrowserWindowCapture(page, {
      platform: "darwin",
      client,
    });

    expect(await capture?.capture()).toBeUndefined();
    expect(diagnostics).toEqual([
      {
        event: "browser_capture_failed",
        stage: "png_normalization",
        region: { x: 40, y: 120, width: 320, height: 240 },
        viewport: { width: 320, height: 240 },
      },
    ]);
  });

  it("is unavailable away from macOS", async () => {
    const capture = await createMacOsBrowserWindowCapture({} as Page, { platform: "linux" });
    expect(capture).toBeUndefined();
  });
});
