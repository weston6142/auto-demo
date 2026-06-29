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
      metadataDir: "demo-capture/metadata",
      eventsPath: "demo-capture/metadata/events.jsonl",
    });
  });

  it("preserves a filesystem root output directory", () => {
    expect(buildCapturePaths("/")).toEqual({
      outputDir: "/",
      manifestPath: "/capture.manifest.json",
      mediaDir: "/media",
      viewportMediaPath: "/media/viewport.webm",
      metadataDir: "/metadata",
      eventsPath: "/metadata/events.jsonl",
    });
  });

  it("rejects an empty output directory", () => {
    expect(() => buildCapturePaths("")).toThrow("Capture output directory is required.");
  });
});

describe("ensureCaptureDirectories", () => {
  it("creates the output, media, and metadata directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "auto-demo-capture-paths-"));
    const paths = buildCapturePaths(join(root, "demo-capture"));

    await ensureCaptureDirectories(paths);

    const outputStat = await stat(paths.outputDir);
    const mediaStat = await stat(paths.mediaDir);
    const metadataStat = await stat(paths.metadataDir);

    expect(outputStat.isDirectory()).toBe(true);
    expect(mediaStat.isDirectory()).toBe(true);
    expect(metadataStat.isDirectory()).toBe(true);
  });
});
