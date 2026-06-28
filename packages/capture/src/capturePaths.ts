import { mkdir } from "node:fs/promises";

export type CapturePaths = {
  outputDir: string;
  manifestPath: string;
  mediaDir: string;
  viewportMediaPath: string;
};

export function buildCapturePaths(outputDir: string): CapturePaths {
  const normalizedOutputDir = trimTrailingSlashes(outputDir);
  const mediaDir = appendPathSegment(normalizedOutputDir, "media");

  return {
    outputDir: normalizedOutputDir,
    manifestPath: appendPathSegment(normalizedOutputDir, "capture.manifest.json"),
    mediaDir,
    viewportMediaPath: appendPathSegment(mediaDir, "viewport.webm"),
  };
}

export async function ensureCaptureDirectories(paths: CapturePaths): Promise<void> {
  await mkdir(paths.mediaDir, { recursive: true });
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
