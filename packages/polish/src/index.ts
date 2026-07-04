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

/** Approved style keys for MVP headless generation. */
export type MvpStylePresetKey = "baseline";

/** Stable style preset metadata shared by headless generation and downstream UI planning. */
export type MvpStylePreset = {
  key: MvpStylePresetKey;
  displayName: "Baseline Polish";
};

/** The MVP intentionally ships only the conservative baseline preset. */
export const MVP_STYLE_PRESETS = [
  { key: "baseline", displayName: "Baseline Polish" },
] as const satisfies readonly MvpStylePreset[];

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

/** Supported baseline-only headless batch generation inputs. */
export type HeadlessVariantGenerationOptions = {
  projectPath: string;
  dryRun?: boolean;
  json?: boolean;
  count?: number;
  /** Backwards-compatible single style key; use `styles` for batch-shaped requests. */
  style?: string;
  /** Requested MVP style keys. Defaults to all approved MVP presets, currently `baseline`. */
  styles?: string[];
  /** Persisted project variant used as the batch source. Defaults to `baseline-polish`. */
  sourceVariantId?: string;
  save?: boolean;
  mode?: string;
};

export type HeadlessVariantGenerationErrorCode =
  | "missing_project_path"
  | "unsupported_output_mode"
  | "unsupported_save_mode"
  | "unsupported_variant_count"
  | "unsupported_style"
  | "conflicting_style_options"
  | "duplicate_style"
  | "missing_source_variant"
  | "unknown_generate_argument"
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

/** JSON-ready dry-run summary for one generated batch entry. */
export type HeadlessVariantSummary = {
  id: string;
  displayName: string;
  style: "baseline";
  source: {
    projectPath: string;
    manifestPath: string;
    mediaPath: string;
    eventsPath: string;
    variantId: string;
  };
  metadata: {
    presetKey: MvpStylePresetKey;
    presetDisplayName: MvpStylePreset["displayName"];
    batchIndex: number;
    batchSize: number;
    sourceVariantId: string;
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
        styles: ["baseline"];
        dryRun: true;
        sourceVariantId: string;
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
        styles: string[];
        dryRun: boolean;
        sourceVariantId: string;
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

/** Generates deterministic baseline-only dry-run batch summaries for a valid Auto Demo project. */
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

  const sourceVariant = loadedProject.manifest.variants.find(
    (variant) => variant.id === requested.sourceVariantId,
  );
  if (sourceVariant === undefined) {
    return headlessFailure(options.projectPath, requested, [
      {
        code: "missing_source_variant",
        message: `Project does not contain source variant ${requested.sourceVariantId}.`,
      },
    ]);
  }

  const baseline = await generateBaselinePolishVariant(loadedProject);
  const preset = MVP_STYLE_PRESETS[0];

  return {
    ok: true,
    project: {
      projectDir: loadedProject.projectDir,
      manifestPath: loadedProject.manifestPath,
      name: loadedProject.manifest.name,
    },
    requested: {
      count: 1,
      styles: ["baseline"],
      dryRun: true,
      sourceVariantId: requested.sourceVariantId,
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
          variantId: sourceVariant.id,
        },
        metadata: {
          presetKey: preset.key,
          presetDisplayName: preset.displayName,
          batchIndex: 0,
          batchSize: 1,
          sourceVariantId: sourceVariant.id,
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
  styles: string[];
  dryRun: boolean;
  sourceVariantId: string;
} {
  const styles =
    options.styles !== undefined
      ? options.styles
      : options.style !== undefined
        ? [options.style]
        : MVP_STYLE_PRESETS.map((preset) => preset.key);

  return {
    count: options.count ?? styles.length,
    styles,
    dryRun: options.dryRun ?? false,
    sourceVariantId: options.sourceVariantId ?? "baseline-polish",
  };
}

function validateHeadlessOptions(
  options: HeadlessVariantGenerationOptions,
  requested: { count: number; styles: string[]; dryRun: boolean; sourceVariantId: string },
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

  if (options.style !== undefined && options.styles !== undefined) {
    errors.push({
      code: "conflicting_style_options",
      message: "Use either --style or --styles, not both.",
    });
  }

  if (new Set(requested.styles).size !== requested.styles.length) {
    errors.push({
      code: "duplicate_style",
      message: "Each requested style key may appear only once.",
    });
  }

  if (requested.count !== requested.styles.length || requested.count !== MVP_STYLE_PRESETS.length) {
    errors.push({
      code: "unsupported_variant_count",
      message: "autodemo generate count must match the MVP style batch size.",
    });
  }

  const supportedStyles = new Set<string>(MVP_STYLE_PRESETS.map((preset) => preset.key));
  if (requested.styles.some((style) => !supportedStyles.has(style))) {
    errors.push({
      code: "unsupported_style",
      message: "autodemo generate currently supports --style baseline only.",
    });
  }

  return errors;
}

function headlessFailure(
  projectPath: string,
  requested: { count: number; styles: string[]; dryRun: boolean; sourceVariantId: string },
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
