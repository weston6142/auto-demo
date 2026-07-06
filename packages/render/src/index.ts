import { spawn } from "node:child_process";
import { lstat, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { loadProject, type LoadedProject, type ProjectVariant } from "@auto-demo/project";

export const MVP_EXPORT_PRESET_KEY = "mp4-demo";

export type ExportAspectRatio = "16:9" | "4:3" | "9:16";

export type RenderDimensions = {
  width: number;
  height: number;
};

export type MvpExportPreset = {
  key: typeof MVP_EXPORT_PRESET_KEY;
  container: "mp4";
  videoCodec: "libx264";
  pixelFormat: "yuv420p";
  frameRate: 30;
  audio: "none";
  dimensionsByAspectRatio: Record<ExportAspectRatio, RenderDimensions>;
};

export const MVP_EXPORT_PRESET: MvpExportPreset = {
  key: MVP_EXPORT_PRESET_KEY,
  container: "mp4",
  videoCodec: "libx264",
  pixelFormat: "yuv420p",
  frameRate: 30,
  audio: "none",
  dimensionsByAspectRatio: {
    "16:9": { width: 1280, height: 720 },
    "4:3": { width: 1024, height: 768 },
    "9:16": { width: 720, height: 1280 },
  },
};

export type RenderSavedVariantInput = {
  projectPath: string;
  variantId?: string;
  preset?: string;
  now?: () => Date;
};

export type RenderRunnerRequest = {
  inputPath: string;
  outputPath: string;
  settings: RenderSettings;
};

export type RenderRunnerResult =
  | {
      ok: true;
      command: string;
      exitCode: number;
    }
  | {
      ok: false;
      command: string;
      exitCode: number;
    };

export type RenderRunner = (request: RenderRunnerRequest) => Promise<RenderRunnerResult>;

export type RenderDependencies = {
  runner?: RenderRunner;
};

export type RenderSettings = {
  container: "mp4";
  videoCodec: "libx264";
  pixelFormat: "yuv420p";
  frameRate: 30;
  audio: "none";
  dimensions: RenderDimensions;
  timeline: {
    startMs: number;
    durationMs: number;
  };
};

export type RenderErrorCode =
  | "invalid_project"
  | "missing_variant"
  | "missing_media"
  | "unsupported_preset"
  | "unsupported_export_intent"
  | "renderer_failure"
  | "invalid_export_request";

export type RenderError = {
  code: RenderErrorCode;
  message: string;
};

export type RenderPresetSummary = {
  key: typeof MVP_EXPORT_PRESET_KEY;
  settings: RenderSettings;
};

export type RenderSuccessResult = {
  ok: true;
  projectManifestPath: string;
  variantId: string;
  outputPath: string;
  summaryPath: string;
  preset: RenderPresetSummary;
  startedAt: string;
  endedAt: string;
  renderer: {
    command: string;
    exitCode: number;
  };
};

export type RenderFailureResult = {
  ok: false;
  projectManifestPath?: string;
  variantId?: string;
  outputPath?: string;
  summaryPath?: string;
  preset?: RenderPresetSummary;
  startedAt?: string;
  endedAt?: string;
  renderer?: {
    command: string;
    exitCode: number;
  };
  errors: RenderError[];
};

export type RenderSavedVariantResult = RenderSuccessResult | RenderFailureResult;

type RenderSummary = Omit<RenderSuccessResult, "outputPath" | "summaryPath"> & {
  outputPath: string;
  summaryPath: string;
};

export async function renderSavedVariant(
  input: RenderSavedVariantInput,
  dependencies: RenderDependencies = {},
): Promise<RenderSavedVariantResult> {
  const now = input.now ?? (() => new Date());
  if (input.preset !== undefined && input.preset !== MVP_EXPORT_PRESET_KEY) {
    return failure([
      {
        code: "unsupported_preset",
        message: "Auto Demo export supports only the mp4-demo preset.",
      },
    ]);
  }

  const project = await loadProject(input.projectPath);
  if (!project.ok) {
    return failure([
      {
        code: "invalid_project",
        message: "Auto Demo project is invalid and cannot be exported.",
      },
    ]);
  }

  const variant = selectVariant(project, input.variantId);
  if (variant === undefined) {
    return failure(
      [
        {
          code: "missing_variant",
          message: "Requested Auto Demo variant was not found.",
        },
      ],
      { projectManifestPath: project.manifestPath, variantId: input.variantId },
    );
  }

  if (variant.exportIntent.format !== "mp4") {
    return failure(
      [
        {
          code: "unsupported_export_intent",
          message: "Auto Demo export supports only MP4 variant export intent.",
        },
      ],
      { projectManifestPath: project.manifestPath, variantId: variant.id },
    );
  }

  const projectDir = project.projectDir;
  const resolvedProjectDir = await realpath(projectDir);
  const inputPath = join(projectDir, variant.source.mediaPath);
  if (!(await isFile(inputPath))) {
    return failure(
      [
        {
          code: "missing_media",
          message: "Auto Demo variant source media is missing.",
        },
      ],
      { projectManifestPath: project.manifestPath, variantId: variant.id },
    );
  }
  const resolvedInputPath = await realpath(inputPath);
  if (!isInsideDirectory(resolvedProjectDir, resolvedInputPath)) {
    return invalidExportRequest(project.manifestPath, variant.id);
  }

  const exportDir = join(projectDir, "exports");
  const outputPath = join(exportDir, `${variant.id}.mp4`);
  const summaryPath = join(exportDir, `${variant.id}.render.json`);
  if (
    !(await ensureExportDirectoryInsideProject(resolvedProjectDir, exportDir)) ||
    !(await outputTargetIsWritableFileInsideProject(resolvedProjectDir, outputPath)) ||
    !(await outputTargetIsWritableFileInsideProject(resolvedProjectDir, summaryPath))
  ) {
    return invalidExportRequest(project.manifestPath, variant.id);
  }

  const startedAt = now().toISOString();
  const preset = buildPresetSummary(variant);
  const runner = dependencies.runner ?? runFfmpegRenderer;
  const runnerResult = await runner({
    inputPath: resolvedInputPath,
    outputPath,
    settings: preset.settings,
  });
  const endedAt = now().toISOString();

  const base = {
    projectManifestPath: project.manifestPath,
    variantId: variant.id,
    outputPath,
    summaryPath,
    preset,
    startedAt,
    endedAt,
    renderer: {
      command: runnerResult.command,
      exitCode: runnerResult.exitCode,
    },
  };

  if (!runnerResult.ok || !(await isFile(outputPath))) {
    const result = failure(
      [
        {
          code: "renderer_failure",
          message: "Auto Demo renderer failed to produce an MP4 artifact.",
        },
      ],
      base,
    );
    await writeRenderSummary(project.projectDir, summaryPath, result);
    return result;
  }

  const result: RenderSuccessResult = {
    ok: true,
    ...base,
  };
  await writeRenderSummary(project.projectDir, summaryPath, result);
  return result;
}

function selectVariant(
  project: LoadedProject,
  variantId: string | undefined,
): ProjectVariant | undefined {
  if (variantId !== undefined) {
    return project.manifest.variants.find((variant) => variant.id === variantId);
  }

  const baseline = project.manifest.variants.find((variant) => variant.id === "baseline-polish");
  if (baseline !== undefined) {
    return baseline;
  }

  if (project.manifest.variants.length === 1) {
    return project.manifest.variants[0];
  }

  return undefined;
}

function buildPresetSummary(variant: ProjectVariant): RenderPresetSummary {
  return {
    key: MVP_EXPORT_PRESET_KEY,
    settings: {
      container: MVP_EXPORT_PRESET.container,
      videoCodec: MVP_EXPORT_PRESET.videoCodec,
      pixelFormat: MVP_EXPORT_PRESET.pixelFormat,
      frameRate: MVP_EXPORT_PRESET.frameRate,
      audio: MVP_EXPORT_PRESET.audio,
      dimensions: MVP_EXPORT_PRESET.dimensionsByAspectRatio[variant.exportIntent.aspectRatio],
      timeline: {
        startMs: variant.timeline.startMs,
        durationMs: variant.timeline.endMs - variant.timeline.startMs,
      },
    },
  };
}

async function runFfmpegRenderer(request: RenderRunnerRequest): Promise<RenderRunnerResult> {
  const { width, height } = request.settings.dimensions;
  const command = "ffmpeg";
  const args = [
    "-y",
    "-ss",
    formatSeconds(request.settings.timeline.startMs),
    "-t",
    formatSeconds(request.settings.timeline.durationMs),
    "-i",
    request.inputPath,
    "-an",
    "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    "-r",
    String(request.settings.frameRate),
    "-c:v",
    request.settings.videoCodec,
    "-pix_fmt",
    request.settings.pixelFormat,
    "-movflags",
    "+faststart",
    request.outputPath,
  ];

  return await new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore" });

    child.on("error", () => {
      resolve({ ok: false, command, exitCode: 1 });
    });

    child.on("exit", (code) => {
      const exitCode = code ?? 1;
      resolve({ ok: exitCode === 0, command, exitCode });
    });
  });
}

async function resolvesInsideProject(projectDir: string, path: string): Promise<boolean> {
  try {
    return isInsideDirectory(projectDir, await realpath(path));
  } catch {
    return false;
  }
}

async function ensureExportDirectoryInsideProject(
  projectDir: string,
  exportDir: string,
): Promise<boolean> {
  try {
    await mkdir(exportDir, { recursive: true });
  } catch {
    return false;
  }

  try {
    const resolvedExportDir = await realpath(exportDir);
    const exportDirStat = await stat(exportDir);
    return isInsideDirectory(projectDir, resolvedExportDir) && exportDirStat.isDirectory();
  } catch {
    return false;
  }
}

async function outputTargetIsWritableFileInsideProject(
  projectDir: string,
  path: string,
): Promise<boolean> {
  if (!(await resolvesInsideProject(projectDir, dirname(path)))) {
    return false;
  }

  try {
    const resolvedPath = await realpath(path);
    const target = await stat(path);
    return isInsideDirectory(projectDir, resolvedPath) && target.isFile();
  } catch (error) {
    if (isMissingPathError(error)) {
      return !(await pathExists(path));
    }
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }
    throw error;
  }
}

function isInsideDirectory(directory: string, path: string): boolean {
  const relativePath = relative(directory, path);
  return (
    relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  );
}

function invalidExportRequest(projectManifestPath: string, variantId: string): RenderFailureResult {
  return failure(
    [
      {
        code: "invalid_export_request",
        message: "Auto Demo export paths must resolve inside the project.",
      },
    ],
    { projectManifestPath, variantId },
  );
}

function formatSeconds(milliseconds: number): string {
  return String(milliseconds / 1000);
}

async function isFile(path: string): Promise<boolean> {
  try {
    const file = await stat(path);
    return file.isFile();
  } catch {
    return false;
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function failure(
  errors: RenderError[],
  details: Omit<RenderFailureResult, "ok" | "errors"> = {},
): RenderFailureResult {
  return {
    ok: false,
    ...details,
    errors,
  };
}

async function writeRenderSummary(
  projectDir: string,
  summaryPath: string,
  result: RenderSuccessResult | RenderFailureResult,
): Promise<void> {
  const summary = toSummary(projectDir, summaryPath, result);
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
}

function toSummary(
  projectDir: string,
  summaryPath: string,
  result: RenderSuccessResult | RenderFailureResult,
): RenderSummary | (RenderFailureResult & { outputPath?: string; summaryPath?: string }) {
  const relativeSummaryPath = normalizeProjectRelativePath(projectDir, summaryPath);

  if (result.ok) {
    return {
      ...result,
      outputPath: normalizeProjectRelativePath(projectDir, result.outputPath),
      summaryPath: relativeSummaryPath,
    };
  }

  return {
    ...result,
    outputPath:
      result.outputPath === undefined
        ? undefined
        : normalizeProjectRelativePath(projectDir, result.outputPath),
    summaryPath: relativeSummaryPath,
  };
}

function normalizeProjectRelativePath(projectDir: string, path: string): string {
  const relativePath = relative(projectDir, path);
  return relativePath === "" ? basename(path) : relativePath;
}
