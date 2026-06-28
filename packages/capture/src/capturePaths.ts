import { mkdir } from "node:fs/promises";

export type CapturePaths = {
  outputDir: string;
  manifestPath: string;
  mediaDir: string;
  viewportMediaPath: string;
};

export function buildCapturePaths(outputDir: string): CapturePaths {
  const normalizedOutputDir = trimTrailingSlashes(outputDir);
  const mediaDir = `${normalizedOutputDir}/media`;

  return {
    outputDir: normalizedOutputDir,
    manifestPath: `${normalizedOutputDir}/capture.manifest.json`,
    mediaDir,
    viewportMediaPath: `${mediaDir}/viewport.webm`,
  };
}

export async function ensureCaptureDirectories(paths: CapturePaths): Promise<void> {
  await mkdir(paths.mediaDir, { recursive: true });
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}
