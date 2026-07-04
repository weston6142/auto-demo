import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  loadProject,
  type LoadedProject,
  type ProjectValidationErrorCode,
  type ProjectVariant,
} from "@auto-demo/project";

export type PolishPackageRole = "edit-decision-generation";

export const polishPackageRole: PolishPackageRole = "edit-decision-generation";

/** Optional stable labels for the generated baseline variant. */
export type GenerateBaselinePolishOptions = {
  /** Lowercase slug used for the returned variant id. */
  id?: string;
  /** Human-readable variant label; blank values fall back to `Baseline Polish`. */
  displayName?: string;
};

/** Non-secret warning categories returned with a generated baseline variant. */
export type PolishWarningCode =
  | "events_file_unreadable"
  | "events_file_empty"
  | "malformed_event_line"
  | "missing_action_events"
  | "missing_click_coordinates"
  | "incomplete_capture_status";

/** Structured warning that never echoes raw event payloads, URLs, typed values, or local paths. */
export type PolishWarning = {
  code: PolishWarningCode;
  message: string;
};

/** Baseline polish output and recoverable metadata warnings. */
export type BaselinePolishResult = {
  variant: ProjectVariant;
  warnings: PolishWarning[];
};

/** Supported first-pass headless generation inputs. */
export type HeadlessVariantGenerationOptions = {
  projectPath: string;
  dryRun?: boolean;
  json?: boolean;
  count?: number;
  style?: string;
  save?: boolean;
  mode?: string;
};

export type HeadlessVariantGenerationErrorCode =
  | "missing_project_path"
  | "unsupported_output_mode"
  | "unsupported_save_mode"
  | "unsupported_variant_count"
  | "unsupported_style"
  | "invalid_project";

/** Structured non-secret error for the headless generation contract. */
export type HeadlessVariantGenerationError = {
  code: HeadlessVariantGenerationErrorCode;
  message: string;
  projectErrorCode?: ProjectValidationErrorCode;
};

export type HeadlessVariantSaveStatus = {
  mode: "dry-run";
  saved: false;
};

export type HeadlessVariantSummary = {
  id: string;
  displayName: string;
  style: "baseline";
  source: {
    projectPath: string;
    manifestPath: string;
    mediaPath: string;
    eventsPath: string;
  };
  save: HeadlessVariantSaveStatus;
  warnings: PolishWarning[];
};

export type HeadlessVariantGenerationResult =
  | {
      ok: true;
      project: {
        projectDir: string;
        manifestPath: string;
        name: string;
      };
      requested: {
        count: 1;
        style: "baseline";
        dryRun: true;
      };
      variants: HeadlessVariantSummary[];
      errors: [];
    }
  | {
      ok: false;
      project: {
        projectPath: string;
      };
      requested: {
        count: number;
        style: string;
        dryRun: boolean;
      };
      variants: [];
      errors: HeadlessVariantGenerationError[];
    };

type CaptureEventRecord = {
  type: string;
  timestampMs: number;
  viewport?: {
    width?: number;
    height?: number;
  };
  data?: Record<string, unknown>;
};

const ACTION_EVENT_TYPES = new Set(["click", "fill", "press", "navigation", "agent_step"]);

/**
 * Reads a validated Auto Demo project's event metadata and returns one deterministic,
 * schema-valid baseline variant without saving it to the project manifest.
 */
export async function generateBaselinePolishVariant(
  project: LoadedProject,
  options: GenerateBaselinePolishOptions = {},
): Promise<BaselinePolishResult> {
  const warnings: PolishWarning[] = [];
  const events = await readProjectEvents(project, warnings);
  const durationMs = project.manifest.sourceCapture.timing.durationMs;
  const actionEvents = events
    .filter((event) => ACTION_EVENT_TYPES.has(event.type))
    .filter((event) => event.timestampMs >= 0 && event.timestampMs <= durationMs)
    .sort((a, b) => a.timestampMs - b.timestampMs);
  const clickEvents = actionEvents.filter((event) => event.type === "click");
  const clickFocus = findClickFocus(clickEvents, project.manifest.sourceCapture.viewport);

  if (actionEvents.length === 0) {
    warnings.push({
      code: "missing_action_events",
      message: "No interaction events were available for baseline polish decisions.",
    });
  }

  if (clickEvents.length > 0 && clickFocus === null) {
    warnings.push({
      code: "missing_click_coordinates",
      message: "Click events did not include usable viewport coordinates.",
    });
  }

  if (project.manifest.sourceCapture.status !== "completed") {
    warnings.push({
      code: "incomplete_capture_status",
      message: "Source capture did not complete; baseline polish used available metadata.",
    });
  }

  const hasActions = actionEvents.length > 0;
  const variant: ProjectVariant = {
    id: normalizeVariantId(options.id),
    displayName: normalizeDisplayName(options.displayName),
    source: {
      mediaPath: project.manifest.media.primary.path,
      eventsPath: project.manifest.metadata.events.path,
    },
    timeline: buildTimeline(actionEvents, durationMs),
    viewport: {
      mode: "contain",
      focus: clickFocus ?? { x: 0.5, y: 0.5 },
      zoom: clickFocus !== null ? 1.35 : hasActions ? 1.15 : 1,
    },
    cursor: {
      visible: true,
      emphasis: hasActions ? "spotlight" : "none",
    },
    clicks: {
      emphasis: clickEvents.length > 0 ? "ring" : "none",
    },
    captions: [],
    callouts: [],
    style: {
      background: "solid",
      backgroundColor: "#0f172a",
      frame: "browser",
      padding: 48,
      cornerRadius: 16,
    },
    exportIntent: {
      format: "mp4",
      quality: "demo",
      aspectRatio: "16:9",
    },
  };

  return { variant, warnings: uniqueWarnings(warnings) };
}

/** Generates the first headless dry-run variant summary for a valid Auto Demo project. */
export async function generateHeadlessVariants(
  options: HeadlessVariantGenerationOptions,
): Promise<HeadlessVariantGenerationResult> {
  const requested = normalizeHeadlessRequest(options);
  const validationErrors = validateHeadlessOptions(options, requested);

  if (validationErrors.length > 0) {
    return headlessFailure(options.projectPath, requested, validationErrors);
  }

  const loadedProject = await loadProject(options.projectPath);
  if (!loadedProject.ok) {
    return headlessFailure(
      options.projectPath,
      requested,
      loadedProject.errors.map((error) => ({
        code: "invalid_project",
        projectErrorCode: error.code,
        message: error.message,
      })),
    );
  }

  const baseline = await generateBaselinePolishVariant(loadedProject);

  return {
    ok: true,
    project: {
      projectDir: loadedProject.projectDir,
      manifestPath: loadedProject.manifestPath,
      name: loadedProject.manifest.name,
    },
    requested: {
      count: 1,
      style: "baseline",
      dryRun: true,
    },
    variants: [
      {
        id: baseline.variant.id,
        displayName: baseline.variant.displayName,
        style: "baseline",
        source: {
          projectPath: loadedProject.projectDir,
          manifestPath: loadedProject.manifestPath,
          mediaPath: baseline.variant.source.mediaPath,
          eventsPath: baseline.variant.source.eventsPath,
        },
        save: {
          mode: "dry-run",
          saved: false,
        },
        warnings: baseline.warnings,
      },
    ],
    errors: [],
  };
}

function normalizeHeadlessRequest(options: HeadlessVariantGenerationOptions): {
  count: number;
  style: string;
  dryRun: boolean;
} {
  return {
    count: options.count ?? 1,
    style: options.style ?? "baseline",
    dryRun: options.dryRun ?? false,
  };
}

function validateHeadlessOptions(
  options: HeadlessVariantGenerationOptions,
  requested: { count: number; style: string; dryRun: boolean },
): HeadlessVariantGenerationError[] {
  const errors: HeadlessVariantGenerationError[] = [];

  if (options.projectPath.trim().length === 0) {
    errors.push({
      code: "missing_project_path",
      message: "autodemo generate requires --project <project-dir-or-manifest>.",
    });
  }

  if (options.json !== true) {
    errors.push({
      code: "unsupported_output_mode",
      message: "autodemo generate currently requires --json output.",
    });
  }

  if (requested.dryRun !== true || options.save === true || options.mode === "save") {
    errors.push({
      code: "unsupported_save_mode",
      message: "autodemo generate currently supports dry-run output only.",
    });
  }

  if (requested.count !== 1) {
    errors.push({
      code: "unsupported_variant_count",
      message: "autodemo generate currently supports --count 1 only.",
    });
  }

  if (requested.style !== "baseline") {
    errors.push({
      code: "unsupported_style",
      message: "autodemo generate currently supports --style baseline only.",
    });
  }

  return errors;
}

function headlessFailure(
  projectPath: string,
  requested: { count: number; style: string; dryRun: boolean },
  errors: HeadlessVariantGenerationError[],
): HeadlessVariantGenerationResult {
  return {
    ok: false,
    project: {
      projectPath,
    },
    requested,
    variants: [],
    errors,
  };
}

async function readProjectEvents(
  project: LoadedProject,
  warnings: PolishWarning[],
): Promise<CaptureEventRecord[]> {
  const eventsPath = join(project.projectDir, project.manifest.metadata.events.path);
  let content: string;

  try {
    content = await readFile(eventsPath, "utf8");
  } catch {
    warnings.push({
      code: "events_file_unreadable",
      message: "Capture events file could not be read; baseline polish used safe defaults.",
    });
    return [];
  }

  if (content.trim().length === 0) {
    warnings.push({
      code: "events_file_empty",
      message: "Capture events file contained no events; baseline polish used safe defaults.",
    });
    return [];
  }

  const events: CaptureEventRecord[] = [];
  let malformed = false;

  for (const line of content.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as unknown;
      const event = parseEventRecord(parsed);
      if (event === null) {
        malformed = true;
      } else {
        events.push(event);
      }
    } catch {
      malformed = true;
    }
  }

  if (malformed) {
    warnings.push({
      code: "malformed_event_line",
      message: "One or more capture event lines could not be parsed.",
    });
  }

  if (events.length === 0) {
    warnings.push({
      code: "events_file_empty",
      message: "Capture events file contained no events; baseline polish used safe defaults.",
    });
  }

  return events;
}

function parseEventRecord(value: unknown): CaptureEventRecord | null {
  if (!isRecord(value) || typeof value.type !== "string" || !isInteger(value.timestampMs)) {
    return null;
  }

  const viewport = isRecord(value.viewport)
    ? {
        width: numberOrUndefined(value.viewport.width),
        height: numberOrUndefined(value.viewport.height),
      }
    : undefined;

  return {
    type: value.type,
    timestampMs: value.timestampMs,
    viewport,
    data: isRecord(value.data) ? value.data : undefined,
  };
}

function buildTimeline(
  actionEvents: CaptureEventRecord[],
  durationMs: number,
): ProjectVariant["timeline"] {
  if (actionEvents.length === 0) {
    return { startMs: 0, endMs: durationMs };
  }

  const firstActionMs = actionEvents[0]?.timestampMs ?? 0;
  const lastActionMs = actionEvents[actionEvents.length - 1]?.timestampMs ?? durationMs;
  const startMs = firstActionMs > 1000 ? Math.max(0, firstActionMs - 500) : 0;
  const endMs =
    durationMs - lastActionMs > 1000 ? Math.min(durationMs, lastActionMs + 750) : durationMs;

  return { startMs, endMs: Math.max(startMs + 1, endMs) };
}

function findClickFocus(
  clickEvents: CaptureEventRecord[],
  fallbackViewport: { width: number; height: number },
): { x: number; y: number } | null {
  for (const event of clickEvents) {
    const x = numberOrUndefined(event.data?.x);
    const y = numberOrUndefined(event.data?.y);
    const width = event.viewport?.width ?? fallbackViewport.width;
    const height = event.viewport?.height ?? fallbackViewport.height;

    if (
      x !== undefined &&
      y !== undefined &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      return {
        x: roundNormalized(clamp(x / width, 0, 1)),
        y: roundNormalized(clamp(y / height, 0, 1)),
      };
    }
  }

  return null;
}

function uniqueWarnings(warnings: PolishWarning[]): PolishWarning[] {
  const seen = new Set<PolishWarningCode>();
  return warnings.filter((warning) => {
    if (seen.has(warning.code)) {
      return false;
    }
    seen.add(warning.code);
    return true;
  });
}

function normalizeVariantId(value: string | undefined): string {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
    ? value
    : "baseline-polish";
}

function normalizeDisplayName(value: string | undefined): string {
  return typeof value === "string" && value.trim().length > 0 ? value : "Baseline Polish";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundNormalized(value: number): number {
  return Math.round(value * 1000) / 1000;
}
