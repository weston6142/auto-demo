import { describe, expect, it } from "vitest";
import { createUnsupportedBrowserCaptureAdapter } from "./index.js";

describe("createUnsupportedBrowserCaptureAdapter", () => {
  it("fails clearly while preserving the requested output paths", async () => {
    const adapter = createUnsupportedBrowserCaptureAdapter();
    const result = await adapter.start({
      source: { kind: "browser", url: "https://example.com" },
      outputDir: "demo-capture",
      viewport: { width: 1280, height: 720 },
      startedAt: "2026-06-28T12:00:00.000Z",
      childCommand: {
        command: "npm",
        args: ["run", "demo:walkthrough"],
      },
    });

    expect(result).toEqual({
      ok: false,
      code: "capture_not_implemented",
      message: "Browser capture is not implemented yet.",
      outputDir: "demo-capture",
      manifestPath: "demo-capture/capture.manifest.json",
    });
  });
});
