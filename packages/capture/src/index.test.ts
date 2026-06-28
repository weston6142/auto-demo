import { describe, expect, it } from "vitest";
import {
  createUnsupportedBrowserCaptureAdapter,
  manifestPathForOutputDir,
  type CaptureOutput,
} from "./index.js";

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

describe("CaptureOutput", () => {
  it("represents the media path and timing returned by a successful capture", () => {
    const output: CaptureOutput = {
      outputDir: "demo-capture",
      manifestPath: "demo-capture/capture.manifest.json",
      media: {
        kind: "viewport",
        path: "demo-capture/media/viewport.webm",
        contentType: "video/webm",
      },
      timing: {
        startedAt: "2026-06-28T12:00:00.000Z",
        endedAt: "2026-06-28T12:00:03.250Z",
        durationMs: 3250,
      },
    };

    expect(output.media.path).toBe("demo-capture/media/viewport.webm");
    expect(output.timing.durationMs).toBe(3250);
  });
});

describe("manifestPathForOutputDir", () => {
  it("normalizes trailing slashes", () => {
    expect(manifestPathForOutputDir("demo-capture///")).toBe("demo-capture/capture.manifest.json");
  });
});
