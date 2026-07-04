import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  loadProject,
  savePolishVariant,
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

/** Supported baseline-only headless batch generation inputs and save modes. */
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
  selectedVariantId?: string;
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
  | "invalid_selected_variant"
  | "duplicate_variant_id"
  | "unsafe_variant_path"
  | "unknown_generate_argument"
  | "invalid_project";

/** Structured non-secret error for the headless generation contract. */
export type HeadlessVariantGenerationError = {
  code: HeadlessVariantGenerationErrorCode;
  message: string;
  projectErrorCode?: ProjectValidationErrorCode;
};

export type HeadlessVariantSaveStatus =
  | {
      mode: "dry-run";
      saved: false;
    }
  | {
      mode: "selected" | "all";
      saved: true;
      path: string;
    }
  | {
      mode: "selected";
      saved: false;
      reason: "not-selected";
    };

export type HeadlessVariantSaveSummary = {
  mode: "dry-run" | "selected" | "all";
  saved: Array<{ id: string; path: string }>;
  skipped: Array<{ id: string; reason: "dry-run" | "not-selected" }>;
  validation: { ok: true; manifestPath: string };
  nextSteps: string[];
};

/** JSON-ready summary for one generated batch entry. */
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
        dryRun: boolean;
        sourceVariantId: string;
      };
      variants: HeadlessVariantSummary[];
      summary: HeadlessVariantSaveSummary;
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
      summary?: HeadlessVariantSaveSummary;
      errors: HeadlessVariantGenerationError[];
    };

type HeadlessSaveRequest =
  { mode: "dry-run" } | { mode: "selected"; selectedVariantId: string } | { mode: "all" };

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

/** Generates deterministic baseline-only headless summaries and optionally saves variants. */
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
  const saveRequest = normalizeSaveRequest(options, requested);
  const generatedVariants = [
    {
      variant: baseline.variant,
      warnings: baseline.warnings,
      preset,
      sourceVariantId: sourceVariant.id,
    },
  ];
  const saveValidationErrors = validateSaveRequest(
    loadedProject,
    generatedVariants.map((generated) => generated.variant),
    saveRequest,
  );
  if (saveValidationErrors.length > 0) {
    return headlessFailure(options.projectPath, requested, saveValidationErrors);
  }

  const saveResult = await saveGeneratedVariants(loadedProject, generatedVariants, saveRequest);
  if (!saveResult.ok) {
    return {
      ok: false,
      project: {
        projectPath: options.projectPath,
      },
      requested,
      variants: [],
      summary: saveResult.summary,
      errors: saveResult.errors,
    };
  }

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
      dryRun: saveRequest.mode === "dry-run",
      sourceVariantId: requested.sourceVariantId,
    },
    variants: generatedVariants.map((generated) => ({
      id: generated.variant.id,
      displayName: generated.variant.displayName,
      style: "baseline",
      source: {
        projectPath: loadedProject.projectDir,
        manifestPath: loadedProject.manifestPath,
        mediaPath: generated.variant.source.mediaPath,
        eventsPath: generated.variant.source.eventsPath,
        variantId: sourceVariant.id,
      },
      metadata: {
        presetKey: generated.preset.key,
        presetDisplayName: generated.preset.displayName,
        batchIndex: 0,
        batchSize: 1,
        sourceVariantId: generated.sourceVariantId,
      },
      save: saveResult.statusByVariantId.get(generated.variant.id) ?? {
        mode: "dry-run",
        saved: false,
      },
      warnings: generated.warnings,
    })),
    summary: saveResult.summary,
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

  if (
    (requested.dryRun !== true && options.save !== true) ||
    (requested.dryRun === true && options.save === true) ||
    (options.save === true && options.mode !== "all" && options.selectedVariantId === undefined) ||
    (options.mode !== undefined && options.mode !== "all")
  ) {
    errors.push({
      code: "unsupported_save_mode",
      message: "Use --dry-run for previews, --save <variant-id>, or --save all.",
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

function normalizeSaveRequest(
  options: HeadlessVariantGenerationOptions,
  requested: { dryRun: boolean },
): HeadlessSaveRequest {
  if (options.save === true && options.mode === "all") {
    return { mode: "all" };
  }

  if (options.save === true && options.selectedVariantId !== undefined) {
    return { mode: "selected", selectedVariantId: options.selectedVariantId };
  }

  if (requested.dryRun) {
    return { mode: "dry-run" };
  }

  return { mode: "dry-run" };
}

function validateSaveRequest(
  project: LoadedProject,
  generatedVariants: ProjectVariant[],
  saveRequest: HeadlessSaveRequest,
): HeadlessVariantGenerationError[] {
  const errors: HeadlessVariantGenerationError[] = [];

  if (saveRequest.mode === "dry-run") {
    return errors;
  }

  const generatedIds = new Set(generatedVariants.map((variant) => variant.id));
  if (saveRequest.mode === "selected" && !generatedIds.has(saveRequest.selectedVariantId)) {
    errors.push({
      code: "invalid_selected_variant",
      message: `Generated variants do not include selected variant ${saveRequest.selectedVariantId}.`,
    });
  }

  const existingIds = new Set(project.manifest.variants.map((variant) => variant.id));
  for (const variant of generatedVariants) {
    if (!isSafeVariantId(variant.id)) {
      errors.push({
        code: "unsafe_variant_path",
        message: `Generated variant ${variant.id} cannot be saved to a safe variant path.`,
      });
    }

    if (shouldSaveVariant(variant.id, saveRequest) && existingIds.has(variant.id)) {
      errors.push({
        code: "duplicate_variant_id",
        message: `Project already contains generated variant ${variant.id}.`,
      });
    }
  }

  return errors;
}

async function saveGeneratedVariants(
  project: LoadedProject,
  generatedVariants: Array<{
    variant: ProjectVariant;
    warnings: PolishWarning[];
    preset: MvpStylePreset;
    sourceVariantId: string;
  }>,
  saveRequest: HeadlessSaveRequest,
): Promise<
  | {
      ok: true;
      summary: HeadlessVariantSaveSummary;
      statusByVariantId: Map<string, HeadlessVariantSaveStatus>;
    }
  | {
      ok: false;
      summary: HeadlessVariantSaveSummary;
      errors: HeadlessVariantGenerationError[];
    }
> {
  const saved: HeadlessVariantSaveSummary["saved"] = [];
  const skipped: HeadlessVariantSaveSummary["skipped"] = [];
  const statusByVariantId = new Map<string, HeadlessVariantSaveStatus>();
  let currentProject = project;

  for (const generated of generatedVariants) {
    const path = variantArtifactPath(generated.variant.id);

    if (saveRequest.mode === "dry-run") {
      skipped.push({ id: generated.variant.id, reason: "dry-run" });
      statusByVariantId.set(generated.variant.id, { mode: "dry-run", saved: false });
      continue;
    }

    if (!shouldSaveVariant(generated.variant.id, saveRequest)) {
      skipped.push({ id: generated.variant.id, reason: "not-selected" });
      statusByVariantId.set(generated.variant.id, {
        mode: "selected",
        saved: false,
        reason: "not-selected",
      });
      continue;
    }

    const result = await savePolishVariant(currentProject, generated.variant);
    if (!result.ok) {
      return {
        ok: false,
        summary: buildSaveSummary(saveRequest.mode, saved, skipped, currentProject.manifestPath),
        errors: result.errors.map((error) => ({
          code: "invalid_project",
          projectErrorCode: error.code,
          message: error.message,
        })),
      };
    }

    currentProject = result;
    saved.push({ id: generated.variant.id, path });
    statusByVariantId.set(generated.variant.id, { mode: saveRequest.mode, saved: true, path });
  }

  return {
    ok: true,
    summary: buildSaveSummary(saveRequest.mode, saved, skipped, currentProject.manifestPath),
    statusByVariantId,
  };
}

function buildSaveSummary(
  mode: HeadlessVariantSaveSummary["mode"],
  saved: HeadlessVariantSaveSummary["saved"],
  skipped: HeadlessVariantSaveSummary["skipped"],
  manifestPath: string,
): HeadlessVariantSaveSummary {
  return {
    mode,
    saved,
    skipped,
    validation: { ok: true, manifestPath },
    nextSteps: ["open-editor", "export-variant"],
  };
}

function shouldSaveVariant(variantId: string, saveRequest: HeadlessSaveRequest): boolean {
  return (
    saveRequest.mode === "all" ||
    (saveRequest.mode === "selected" && saveRequest.selectedVariantId === variantId)
  );
}

function variantArtifactPath(variantId: string): string {
  return join("variants", `${variantId}.json`);
}

function isSafeVariantId(variantId: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(variantId);
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
