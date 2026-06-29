import { mkdir } from "node:fs/promises";

export type CapturePaths = {
  outputDir: string;
  manifestPath: string;
  mediaDir: string;
  viewportMediaPath: string;
  metadataDir: string;
  eventsPath: string;
};

export function buildCapturePaths(outputDir: string): CapturePaths {
  const normalizedOutputDir = trimTrailingSlashes(outputDir);
  if (normalizedOutputDir.length === 0) {
    throw new Error("Capture output directory is required.");
  }

  const mediaDir = appendPathSegment(normalizedOutputDir, "media");
  const metadataDir = appendPathSegment(normalizedOutputDir, "metadata");

  return {
    outputDir: normalizedOutputDir,
    manifestPath: appendPathSegment(normalizedOutputDir, "capture.manifest.json"),
    mediaDir,
    viewportMediaPath: appendPathSegment(mediaDir, "viewport.webm"),
    metadataDir,
    eventsPath: appendPathSegment(metadataDir, "events.jsonl"),
  };
}

export async function ensureCaptureDirectories(paths: CapturePaths): Promise<void> {
  await Promise.all([
    mkdir(paths.mediaDir, { recursive: true }),
    mkdir(paths.metadataDir, { recursive: true }),
  ]);
}

function trimTrailingSlashes(value: string): string {
  if (/^\/+$/.test(value)) {
    return "/";
  }

  return value.replace(/\/+$/, "");
}

function appendPathSegment(base: string, segment: string): string {
  return base === "/" ? `/${segment}` : `${base}/${segment}`;
}
