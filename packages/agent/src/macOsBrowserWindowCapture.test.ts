import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { createMacOsBrowserWindowCapture } from "./macOsBrowserWindowCapture.js";
import type { MacOsCaptureHelperClient } from "./macOsCaptureHelperClient.js";

describe("macOS browser window capture", () => {
  it("captures the cached viewport region and normalizes Retina pixels", async () => {
    const page = {
      async evaluate() {
        return {
          region: { x: 40, y: 120, width: 320, height: 240 },
          viewport: { width: 320, height: 240 },
        };
      },
    } as unknown as Page;
    const retina = new PNG({ width: 640, height: 480 });
    retina.data.fill(255);
    let capturedRegion: unknown;
    const client: MacOsCaptureHelperClient = {
      async capture(region) {
        capturedRegion = region;
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

    expect(capturedRegion).toEqual({ x: 40, y: 120, width: 320, height: 240 });
    expect(PNG.sync.read(Buffer.from(bytes))).toMatchObject({ width: 320, height: 240 });
    await capture.close?.();
  });

  it("is unavailable away from macOS", async () => {
    const capture = await createMacOsBrowserWindowCapture({} as Page, { platform: "linux" });
    expect(capture).toBeUndefined();
  });
});
