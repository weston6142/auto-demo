import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCapturePaths, ensureCaptureDirectories } from "./capturePaths.js";

describe("buildCapturePaths", () => {
  it("builds stable capture paths under the output directory", () => {
    expect(buildCapturePaths("demo-capture///")).toEqual({
      outputDir: "demo-capture",
      manifestPath: "demo-capture/capture.manifest.json",
      mediaDir: "demo-capture/media",
      viewportMediaPath: "demo-capture/media/viewport.webm",
    });
  });

  it("preserves a filesystem root output directory", () => {
    expect(buildCapturePaths("/")).toEqual({
      outputDir: "/",
      manifestPath: "/capture.manifest.json",
      mediaDir: "/media",
      viewportMediaPath: "/media/viewport.webm",
    });
  });

  it("rejects an empty output directory", () => {
    expect(() => buildCapturePaths("")).toThrow("Capture output directory is required.");
  });
});

describe("ensureCaptureDirectories", () => {
  it("creates the output and media directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "auto-demo-capture-paths-"));
    const paths = buildCapturePaths(join(root, "demo-capture"));

    await ensureCaptureDirectories(paths);

    const outputStat = await stat(paths.outputDir);
    const mediaStat = await stat(paths.mediaDir);

    expect(outputStat.isDirectory()).toBe(true);
    expect(mediaStat.isDirectory()).toBe(true);
  });
});
