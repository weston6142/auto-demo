import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { validateCaptureBundle, type CaptureManifest } from "@auto-demo/capture";

export const PROJECT_MANIFEST_FILENAME = "autodemo.project.json";
export const SUPPORTED_PROJECT_SCHEMA_VERSION = 1;

export type ProjectManifest = {
  schemaVersion: 1;
  name: string;
  createdAt: string;
  updatedAt: string;
  sourceCapture: ProjectSourceCapture;
  media: {
    primary: {
      kind: "viewport";
      path: string;
      contentType: "video/webm";
    };
  };
  metadata: {
    events: {
      path: string;
      contentType: "application/x-ndjson";
    };
  };
  variants: ProjectVariant[];
  previews: [];
  exports: [];
};

export type ProjectSourceCapture = {
  kind: "browser";
  status: "completed" | "failed" | "interrupted";
  source: {
    kind: "browser";
    url: string;
  };
  viewport: {
    width: number;
    height: number;
  };
  timing: {
    startedAt: string;
    endedAt: string;
    durationMs: number;
  };
  adapter: {
    kind: "browser";
    backend: "playwright";
  };
  tools: {
    capturePackage: string;
    playwright: string;
  };
  manifestPath: "metadata/capture.manifest.json";
};

/** MVP polish decisions stored directly in a schema v1 project manifest. */
export type ProjectVariant = {
  id: string;
  displayName: string;
  source: ProjectVariantSource;
  timeline: ProjectVariantTimeline;
  viewport: ProjectVariantViewportDecision;
  cursor: ProjectVariantCursorDecision;
  clicks: ProjectVariantClickDecision;
  captions: ProjectVariantCaption[];
  callouts: ProjectVariantCallout[];
  style: ProjectVariantStyle;
  exportIntent: ProjectVariantExportIntent;
};

/** Project-owned source artifacts a variant is derived from. */
export type ProjectVariantSource = {
  mediaPath: string;
  eventsPath: string;
};

/** Millisecond range within the source capture duration. */
export type ProjectVariantTimeline = {
  startMs: number;
  endMs: number;
};

/** Viewport framing choice for a polished variant. */
export type ProjectVariantViewportDecision = {
  mode: "contain" | "cover";
  focus: {
    x: number;
    y: number;
  };
  zoom: number;
};

/** Cursor visibility and emphasis choice for a polished variant. */
export type ProjectVariantCursorDecision = {
  visible: boolean;
  emphasis: "none" | "spotlight" | "hide-idle";
};

/** Click visualization choice for a polished variant. */
export type ProjectVariantClickDecision = {
  emphasis: "none" | "ring" | "pulse";
};

/** Timed text overlay within a variant timeline. */
export type ProjectVariantCaption = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
};

/** Timed text overlay anchored to normalized viewport coordinates. */
export type ProjectVariantCallout = ProjectVariantCaption & {
  anchor: {
    x: number;
    y: number;
  };
};

/** Background and frame presentation choices for a polished variant. */
export type ProjectVariantStyle = {
  background: "solid" | "transparent";
  backgroundColor: string;
  frame: "browser" | "none";
  padding: number;
  cornerRadius: number;
};

/** Downstream export target requested by a polished variant. */
export type ProjectVariantExportIntent = {
  format: "mp4";
  quality: "demo" | "high";
  aspectRatio: "16:9" | "4:3" | "9:16";
};

export type ProjectValidationErrorCode =
  | "unsupported_project_version"
  | "invalid_project_manifest"
  | "unsafe_project_path"
  | "missing_project_manifest"
  | "invalid_project_json"
  | "missing_project_file";

export type ProjectValidationError = {
  code: ProjectValidationErrorCode;
  message: string;
};

export type ProjectManifestValidationResult =
  { ok: true; manifest: ProjectManifest } | { ok: false; errors: ProjectValidationError[] };

/** Validated project data loaded from disk. */
export type LoadedProject = {
  projectDir: string;
  manifestPath: string;
  manifest: ProjectManifest;
};

/** Result for validating or loading an Auto Demo project directory or manifest file. */
export type ProjectValidationResult =
  | ({ ok: true } & LoadedProject)
  | {
      ok: false;
      projectDir: string;
      manifestPath: string;
      errors: ProjectValidationError[];
    };

/** Input for saving a project manifest and revalidating the project on disk. */
export type SaveProjectInput = LoadedProject;

/** Options for saving a generated polish variant into a project. */
export type SavePolishVariantOptions = {
  now?: Date;
};

/** Result for saving a polish variant and revalidating the saved project. */
export type SavePolishVariantResult = ProjectValidationResult;

export type UpsertSavedVariantInput =
  | {
      mode: "update";
      variant: ProjectVariant;
    }
  | {
      mode: "copy";
      variant: ProjectVariant;
      copyId: string;
      displayName: string;
    };

/** Options for saving browser-edited variants into existing project files. */
export type UpsertSavedVariantOptions = {
  now?: Date;
};

/** Result for upserting one browser-edited saved variant and revalidating the project. */
export type UpsertSavedVariantResult = ProjectValidationResult;

export type ProjectImportErrorCode =
  | ProjectValidationErrorCode
  | "invalid_capture_bundle"
  | "invalid_project_input"
  | "project_directory_not_empty";

export type ProjectImportError = {
  code: ProjectImportErrorCode;
  message: string;
};

/** Input for importing a temporary capture bundle into a project-owned layout. */
export type CreateProjectFromCaptureBundleInput = {
  /** Capture bundle directory or direct `capture.manifest.json` path. */
  captureBundlePath: string;
  /** Empty or missing destination directory for the generated Auto Demo project. */
  projectDir: string;
  /** Human-readable project name; surrounding whitespace is trimmed. */
  name: string;
  /** Optional clock injection for deterministic manifest timestamps. */
  now?: () => Date;
};

/** Successfully imported project details. */
export type ImportedProject = {
  projectDir: string;
  manifestPath: string;
  manifest: ProjectManifest;
};

export type ProjectImportResult =
  | {
      ok: true;
      project: ImportedProject;
    }
  | {
      ok: false;
      projectDir: string;
      manifestPath: string;
      errors: ProjectImportError[];
    };

type JsonRecord = Record<string, unknown>;

const PROJECT_MEDIA_PATH = "raw/capture.webm";
const PROJECT_EVENTS_PATH = "metadata/events.jsonl";
const PROJECT_CAPTURE_SUMMARY_PATH = "metadata/capture.manifest.json";

const TOP_LEVEL_KEYS = [
  "schemaVersion",
  "name",
  "createdAt",
  "updatedAt",
  "sourceCapture",
  "media",
  "metadata",
  "variants",
  "previews",
  "exports",
] as const;

const SOURCE_CAPTURE_KEYS = [
  "kind",
  "status",
  "source",
  "viewport",
  "timing",
  "adapter",
  "tools",
  "manifestPath",
] as const;

const SOURCE_KEYS = ["kind", "url"] as const;
const VIEWPORT_KEYS = ["width", "height"] as const;
const TIMING_KEYS = ["startedAt", "endedAt", "durationMs"] as const;
const ADAPTER_KEYS = ["kind", "backend"] as const;
const TOOLS_KEYS = ["capturePackage", "playwright"] as const;
const MEDIA_KEYS = ["primary"] as const;
const MEDIA_PRIMARY_KEYS = ["kind", "path", "contentType"] as const;
const METADATA_KEYS = ["events"] as const;
const METADATA_EVENTS_KEYS = ["path", "contentType"] as const;
const VARIANT_KEYS = [
  "id",
  "displayName",
  "source",
  "timeline",
  "viewport",
  "cursor",
  "clicks",
  "captions",
  "callouts",
  "style",
  "exportIntent",
] as const;
const VARIANT_SOURCE_KEYS = ["mediaPath", "eventsPath"] as const;
const VARIANT_TIMELINE_KEYS = ["startMs", "endMs"] as const;
const VARIANT_VIEWPORT_KEYS = ["mode", "focus", "zoom"] as const;
const VARIANT_FOCUS_KEYS = ["x", "y"] as const;
const VARIANT_CURSOR_KEYS = ["visible", "emphasis"] as const;
const VARIANT_CLICKS_KEYS = ["emphasis"] as const;
const VARIANT_TEXT_KEYS = ["id", "text", "startMs", "endMs"] as const;
const VARIANT_CALLOUT_KEYS = ["id", "text", "startMs", "endMs", "anchor"] as const;
const VARIANT_STYLE_KEYS = [
  "background",
  "backgroundColor",
  "frame",
  "padding",
  "cornerRadius",
] as const;
const VARIANT_EXPORT_INTENT_KEYS = ["format", "quality", "aspectRatio"] as const;

export function validateProjectManifest(input: unknown): ProjectManifestValidationResult {
  const errors: ProjectValidationError[] = [];

  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [
        {
          code: "invalid_project_manifest",
          message: "Auto Demo project manifest must be a JSON object.",
        },
      ],
    };
  }

  reportUnknownFields(input, TOP_LEVEL_KEYS, errors);
  validateSchemaVersion(input.schemaVersion, errors);
  validateNonEmptyString(
    input.name,
    "Auto Demo project manifest must include a non-empty name.",
    errors,
  );
  validateManifestTimestamps(input, errors);
  validateSourceCapture(input.sourceCapture, errors);
  validateMedia(input.media, errors);
  validateMetadata(input.metadata, errors);
  validateVariants(input, errors);
  validatePreviewAndExportPlaceholders(input, errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, manifest: input as ProjectManifest };
}

/**
 * Imports a validated capture bundle into the normalized Auto Demo project layout.
 *
 * Expected invalid input returns structured errors. Unexpected filesystem failures throw so
 * callers can surface operational problems separately from validation failures.
 */
export async function createProjectFromCaptureBundle(
  input: CreateProjectFromCaptureBundleInput,
): Promise<ProjectImportResult> {
  const projectDir = input.projectDir;
  const manifestPath = join(projectDir, PROJECT_MANIFEST_FILENAME);
  const inputErrors = await validateProjectImportTarget(input);

  if (inputErrors.length > 0) {
    return importFailure(projectDir, manifestPath, inputErrors);
  }

  const capture = await validateCaptureBundle(input.captureBundlePath);
  if (!capture.ok) {
    return importFailure(projectDir, manifestPath, [
      {
        code: "invalid_capture_bundle",
        message: "Capture bundle cannot be imported.",
      },
    ]);
  }

  const manifest = buildProjectManifest({
    capture: capture.manifest,
    name: input.name,
    now: input.now?.() ?? new Date(),
  });

  if (Array.isArray(manifest)) {
    return importFailure(projectDir, manifestPath, manifest);
  }

  const manifestValidation = validateProjectManifest(manifest);
  if (!manifestValidation.ok) {
    return importFailure(projectDir, manifestPath, manifestValidation.errors);
  }

  await createProjectDirectories(projectDir);
  await copyCaptureArtifacts({
    captureManifestPath: capture.manifestPath,
    capture: capture.manifest,
    projectDir,
  });

  await writeJsonFileAtomically(
    join(projectDir, PROJECT_CAPTURE_SUMMARY_PATH),
    buildProjectCaptureSummary(capture.manifest, manifest.sourceCapture.source.url),
  );
  await writeJsonFileAtomically(manifestPath, manifestValidation.manifest);

  return {
    ok: true,
    project: {
      projectDir,
      manifestPath,
      manifest: manifestValidation.manifest,
    },
  };
}

/**
 * Validates a project directory or direct `autodemo.project.json` path.
 *
 * Expected invalid project state returns structured errors. Unexpected filesystem
 * failures throw so callers can surface operational problems separately.
 */
export async function validateProject(
  projectDirOrManifest: string,
): Promise<ProjectValidationResult> {
  const projectPaths = resolveProjectPaths(projectDirOrManifest);
  let rawManifest: string;

  try {
    rawManifest = await readFile(projectPaths.manifestPath, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) {
      return projectFailure(projectPaths, [
        {
          code: "missing_project_manifest",
          message: "Auto Demo project manifest is missing.",
        },
      ]);
    }
    throw error;
  }

  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(rawManifest);
  } catch {
    return projectFailure(projectPaths, [
      {
        code: "invalid_project_json",
        message: "Auto Demo project manifest JSON is invalid.",
      },
    ]);
  }

  const manifestValidation = validateProjectManifest(parsedManifest);
  if (!manifestValidation.ok) {
    return projectFailure(projectPaths, manifestValidation.errors);
  }

  const fileErrors = await validateReferencedProjectFiles(
    projectPaths.projectDir,
    manifestValidation.manifest,
  );
  if (fileErrors.length > 0) {
    return projectFailure(projectPaths, fileErrors);
  }

  return {
    ok: true,
    projectDir: projectPaths.projectDir,
    manifestPath: projectPaths.manifestPath,
    manifest: manifestValidation.manifest,
  };
}

/** Loads a project by delegating to `validateProject()` and returning the same result shape. */
export async function loadProject(projectDirOrManifest: string): Promise<ProjectValidationResult> {
  return validateProject(projectDirOrManifest);
}

/**
 * Validates, atomically writes, and revalidates a project manifest.
 *
 * Save does not create, delete, copy, or repair referenced artifact files.
 */
export async function saveProject(project: SaveProjectInput): Promise<ProjectValidationResult> {
  const manifestValidation = validateProjectManifest(project.manifest);
  if (!manifestValidation.ok) {
    return projectFailure(project, manifestValidation.errors);
  }

  await writeJsonFileAtomically(project.manifestPath, manifestValidation.manifest);
  return validateProject(project.manifestPath);
}

/** Saves one generated polish variant into `variants/<id>.json` and the project manifest. */
export async function savePolishVariant(
  project: LoadedProject,
  variant: ProjectVariant,
  options: SavePolishVariantOptions = {},
): Promise<SavePolishVariantResult> {
  const updatedManifest: ProjectManifest = {
    ...project.manifest,
    variants: [...project.manifest.variants, variant],
    updatedAt: (options.now ?? new Date()).toISOString(),
  };
  const manifestValidation = validateProjectManifest(updatedManifest);
  if (!manifestValidation.ok) {
    return projectFailure(project, manifestValidation.errors);
  }

  await mkdir(join(project.projectDir, "variants"), { recursive: true });
  await writeJsonFileAtomically(
    join(project.projectDir, variantFilePath(variant.id)),
    manifestValidation.manifest.variants[manifestValidation.manifest.variants.length - 1],
  );

  return saveProject({
    projectDir: project.projectDir,
    manifestPath: project.manifestPath,
    manifest: manifestValidation.manifest,
  });
}

/** Updates an existing saved variant or saves a named copy for browser editor persistence. */
export async function upsertSavedVariant(
  project: LoadedProject,
  input: UpsertSavedVariantInput,
  options: UpsertSavedVariantOptions = {},
): Promise<UpsertSavedVariantResult> {
  const nextVariant =
    input.mode === "copy"
      ? { ...input.variant, id: input.copyId, displayName: input.displayName.trim() }
      : input.variant;
  const variantValidation = validateProjectManifest({
    ...project.manifest,
    variants: [nextVariant],
  });
  if (!variantValidation.ok) {
    return projectFailure(project, variantValidation.errors);
  }

  const existingIndex = project.manifest.variants.findIndex(
    (variant) => variant.id === nextVariant.id,
  );

  if (input.mode === "update" && existingIndex === -1) {
    return projectFailure(project, [
      {
        code: "invalid_project_manifest",
        message: "Saved Auto Demo project variant cannot update a missing variant.",
      },
    ]);
  }

  if (input.mode === "copy" && existingIndex !== -1) {
    return projectFailure(project, [
      {
        code: "invalid_project_manifest",
        message: "Saved Auto Demo project variant copy id already exists.",
      },
    ]);
  }

  const nextVariants =
    input.mode === "update"
      ? project.manifest.variants.map((variant, index) =>
          index === existingIndex ? nextVariant : variant,
        )
      : [...project.manifest.variants, nextVariant];
  const updatedManifest: ProjectManifest = {
    ...project.manifest,
    variants: nextVariants,
    updatedAt: (options.now ?? new Date()).toISOString(),
  };
  const manifestValidation = validateProjectManifest(updatedManifest);
  if (!manifestValidation.ok) {
    return projectFailure(project, manifestValidation.errors);
  }

  await mkdir(join(project.projectDir, "variants"), { recursive: true });
  const variantPath = join(project.projectDir, variantFilePath(nextVariant.id));
  const previousVariantFile = await readOptionalFile(variantPath);
  await writeJsonFileAtomically(variantPath, nextVariant);

  try {
    return await saveProject({
      projectDir: project.projectDir,
      manifestPath: project.manifestPath,
      manifest: manifestValidation.manifest,
    });
  } catch (error) {
    if (previousVariantFile === null) {
      await rm(variantPath, { force: true });
    } else {
      await writeFileAtomically(variantPath, previousVariantFile);
    }
    throw error;
  }
}

async function validateProjectImportTarget(
  input: CreateProjectFromCaptureBundleInput,
): Promise<ProjectImportError[]> {
  const errors: ProjectImportError[] = [];

  if (input.name.trim().length === 0) {
    errors.push({
      code: "invalid_project_input",
      message: "Project name must be a non-empty string.",
    });
  }

  if (input.projectDir.trim().length === 0) {
    errors.push({
      code: "invalid_project_input",
      message: "Project directory must be a non-empty path.",
    });
  }

  if (errors.length > 0) {
    return errors;
  }

  try {
    const target = await stat(input.projectDir);
    if (!target.isDirectory()) {
      return [
        {
          code: "invalid_project_input",
          message: "Project directory path must reference a directory.",
        },
      ];
    }

    const entries = await readdir(input.projectDir);
    if (entries.length > 0) {
      return [
        {
          code: "project_directory_not_empty",
          message: "Project directory must be empty before import.",
        },
      ];
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  return [];
}

function importFailure(
  projectDir: string,
  manifestPath: string,
  errors: ProjectImportError[],
): ProjectImportResult {
  return {
    ok: false,
    projectDir,
    manifestPath,
    errors,
  };
}

function resolveProjectPaths(projectDirOrManifest: string): {
  projectDir: string;
  manifestPath: string;
} {
  if (basename(projectDirOrManifest) === PROJECT_MANIFEST_FILENAME) {
    return {
      projectDir: dirname(projectDirOrManifest),
      manifestPath: projectDirOrManifest,
    };
  }

  return {
    projectDir: projectDirOrManifest,
    manifestPath: join(projectDirOrManifest, PROJECT_MANIFEST_FILENAME),
  };
}

function projectFailure(
  project: { projectDir: string; manifestPath: string },
  errors: ProjectValidationError[],
): ProjectValidationResult {
  return {
    ok: false,
    projectDir: project.projectDir,
    manifestPath: project.manifestPath,
    errors,
  };
}

function buildProjectManifest(input: {
  capture: CaptureManifest;
  name: string;
  now: Date;
}): ProjectManifest | ProjectImportError[] {
  const sourceUrl = sanitizeProjectSourceUrl(input.capture.source.url);
  if (sourceUrl === null) {
    return [
      {
        code: "invalid_capture_bundle",
        message: "Capture bundle source URL cannot be imported.",
      },
    ];
  }

  const timestamp = input.now.toISOString();

  return {
    schemaVersion: SUPPORTED_PROJECT_SCHEMA_VERSION,
    name: input.name.trim(),
    createdAt: timestamp,
    updatedAt: timestamp,
    sourceCapture: {
      kind: "browser",
      status: input.capture.status,
      source: {
        kind: "browser",
        url: sourceUrl,
      },
      viewport: input.capture.viewport,
      timing: {
        startedAt: input.capture.startedAt,
        endedAt: input.capture.endedAt,
        durationMs: input.capture.durationMs,
      },
      adapter: input.capture.adapter,
      tools: input.capture.tools,
      manifestPath: PROJECT_CAPTURE_SUMMARY_PATH,
    },
    media: {
      primary: {
        kind: "viewport",
        path: PROJECT_MEDIA_PATH,
        contentType: "video/webm",
      },
    },
    metadata: {
      events: {
        path: PROJECT_EVENTS_PATH,
        contentType: "application/x-ndjson",
      },
    },
    variants: [],
    previews: [],
    exports: [],
  };
}

function buildProjectCaptureSummary(capture: CaptureManifest, sourceUrl: string): unknown {
  return {
    schemaVersion: capture.schemaVersion,
    status: capture.status,
    source: {
      kind: capture.source.kind,
      url: sourceUrl,
    },
    adapter: capture.adapter,
    tools: capture.tools,
    viewport: capture.viewport,
    startedAt: capture.startedAt,
    endedAt: capture.endedAt,
    durationMs: capture.durationMs,
    artifacts: {
      media: PROJECT_MEDIA_PATH,
      events: PROJECT_EVENTS_PATH,
    },
  };
}

function sanitizeProjectSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return `${url.origin}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return null;
  }
}

async function createProjectDirectories(projectDir: string): Promise<void> {
  await mkdir(join(projectDir, "raw"), { recursive: true });
  await mkdir(join(projectDir, "metadata"), { recursive: true });
  await mkdir(join(projectDir, "variants"), { recursive: true });
  await mkdir(join(projectDir, "previews"), { recursive: true });
  await mkdir(join(projectDir, "exports"), { recursive: true });
}

async function copyCaptureArtifacts(input: {
  captureManifestPath: string;
  capture: CaptureManifest;
  projectDir: string;
}): Promise<void> {
  const captureDir = dirname(input.captureManifestPath);
  await copyFile(
    join(captureDir, input.capture.artifacts.media),
    join(input.projectDir, PROJECT_MEDIA_PATH),
  );
  await copyFile(
    join(captureDir, input.capture.artifacts.events),
    join(input.projectDir, PROJECT_EVENTS_PATH),
  );
}

async function validateReferencedProjectFiles(
  projectDir: string,
  manifest: ProjectManifest,
): Promise<ProjectValidationError[]> {
  const references: Array<{ field: string; path: string }> = [
    { field: "media.primary.path", path: manifest.media.primary.path },
    { field: "metadata.events.path", path: manifest.metadata.events.path },
    { field: "sourceCapture.manifestPath", path: manifest.sourceCapture.manifestPath },
  ];
  const errors: ProjectValidationError[] = [];

  for (const reference of references) {
    if (!(await isExistingFile(join(projectDir, reference.path)))) {
      errors.push({
        code: "missing_project_file",
        message: `Auto Demo project file referenced by ${reference.field} is missing.`,
      });
    }
  }

  errors.push(...(await validateSavedVariantFiles(projectDir, manifest)));

  return errors;
}

async function validateSavedVariantFiles(
  projectDir: string,
  manifest: ProjectManifest,
): Promise<ProjectValidationError[]> {
  const errors: ProjectValidationError[] = [];

  for (const variant of manifest.variants) {
    const path = variantFilePath(variant.id);
    const fullPath = join(projectDir, path);

    if (!(await isExistingFile(fullPath))) {
      errors.push({
        code: "missing_project_file",
        message: `Auto Demo project file referenced by variants.${variant.id} is missing.`,
      });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(fullPath, "utf8")) as unknown;
    } catch {
      errors.push(invalidSavedVariantFileError());
      continue;
    }

    const variantValidation = validateProjectManifest({
      ...manifest,
      variants: [parsed],
    });
    if (!variantValidation.ok) {
      errors.push(invalidSavedVariantFileError());
      continue;
    }

    if (JSON.stringify(variantValidation.manifest.variants[0]) !== JSON.stringify(variant)) {
      errors.push({
        code: "invalid_project_manifest",
        message: "Saved Auto Demo project variant file does not match the project manifest.",
      });
    }
  }

  return errors;
}

function invalidSavedVariantFileError(): ProjectValidationError {
  return {
    code: "invalid_project_manifest",
    message: "Saved Auto Demo project variant file is invalid.",
  };
}

function variantFilePath(variantId: string): string {
  return join("variants", `${variantId}.json`);
}

async function isExistingFile(path: string): Promise<boolean> {
  try {
    const file = await stat(path);
    return file.isFile();
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }
    throw error;
  }
}

function isMissingPathError(error: unknown): boolean {
  return isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

async function writeJsonFileAtomically(path: string, value: unknown): Promise<void> {
  await writeFileAtomically(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeFileAtomically(path: string, value: string): Promise<void> {
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, value);
  await rename(tempPath, path);
}

async function readOptionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function validateSchemaVersion(value: unknown, errors: ProjectValidationError[]): void {
  if (value !== SUPPORTED_PROJECT_SCHEMA_VERSION) {
    errors.push({
      code: "unsupported_project_version",
      message: "Unsupported Auto Demo project schema version.",
    });
  }
}

function validateManifestTimestamps(input: JsonRecord, errors: ProjectValidationError[]): void {
  if (!isIsoTimestamp(input.createdAt) || !isIsoTimestamp(input.updatedAt)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest timestamps are invalid.",
    });
  }
}

function validatePreviewAndExportPlaceholders(
  input: JsonRecord,
  errors: ProjectValidationError[],
): void {
  if (!isEmptyArray(input.previews) || !isEmptyArray(input.exports)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest must include empty previews and exports arrays.",
    });
  }
}

function validateSourceCapture(value: unknown, errors: ProjectValidationError[]): void {
  if (!isRecord(value)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest sourceCapture is invalid.",
    });
    return;
  }

  reportUnknownFields(value, SOURCE_CAPTURE_KEYS, errors);

  if (value.kind !== "browser" || !isCaptureStatus(value.status)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest sourceCapture is invalid.",
    });
  }

  validateSource(value.source, errors);
  validateViewport(value.viewport, errors);
  validateTiming(value.timing, errors);
  validateAdapter(value.adapter, errors);
  validateTools(value.tools, errors);

  if (value.manifestPath !== "metadata/capture.manifest.json") {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest sourceCapture manifest path is invalid.",
    });
  }
}

function validateSource(value: unknown, errors: ProjectValidationError[]): void {
  if (!isRecord(value)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest sourceCapture is invalid.",
    });
    return;
  }

  reportUnknownFields(value, SOURCE_KEYS, errors);

  if (value.kind !== "browser" || typeof value.url !== "string" || !isSafeSourceUrl(value.url)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest sourceCapture is invalid.",
    });
  }
}

function validateViewport(value: unknown, errors: ProjectValidationError[]): void {
  if (!isRecord(value)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest sourceCapture viewport is invalid.",
    });
    return;
  }

  reportUnknownFields(value, VIEWPORT_KEYS, errors);

  if (!isPositiveInteger(value.width) || !isPositiveInteger(value.height)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest sourceCapture viewport is invalid.",
    });
  }
}

function validateTiming(value: unknown, errors: ProjectValidationError[]): void {
  if (!isRecord(value)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest sourceCapture timing is invalid.",
    });
    return;
  }

  reportUnknownFields(value, TIMING_KEYS, errors);

  if (
    !isIsoTimestamp(value.startedAt) ||
    !isIsoTimestamp(value.endedAt) ||
    typeof value.durationMs !== "number" ||
    !Number.isFinite(value.durationMs) ||
    !Number.isInteger(value.durationMs) ||
    value.durationMs <= 0
  ) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest sourceCapture timing is invalid.",
    });
  }
}

function validateAdapter(value: unknown, errors: ProjectValidationError[]): void {
  if (!isRecord(value)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest sourceCapture adapter is invalid.",
    });
    return;
  }

  reportUnknownFields(value, ADAPTER_KEYS, errors);

  if (value.kind !== "browser" || value.backend !== "playwright") {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest sourceCapture adapter is invalid.",
    });
  }
}

function validateTools(value: unknown, errors: ProjectValidationError[]): void {
  if (!isRecord(value)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest sourceCapture tools are invalid.",
    });
    return;
  }

  reportUnknownFields(value, TOOLS_KEYS, errors);

  if (!isNonEmptyString(value.capturePackage) || !isNonEmptyString(value.playwright)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest sourceCapture tools are invalid.",
    });
  }
}

function validateMedia(value: unknown, errors: ProjectValidationError[]): void {
  if (!isRecord(value)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest media.primary is invalid.",
    });
    return;
  }

  reportUnknownFields(value, MEDIA_KEYS, errors);

  if (!isRecord(value.primary)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest media.primary is invalid.",
    });
    return;
  }

  reportUnknownFields(value.primary, MEDIA_PRIMARY_KEYS, errors);

  const pathIsSafe = isSafeProjectPath(value.primary.path);

  if (!pathIsSafe) {
    errors.push({
      code: "unsafe_project_path",
      message: "Project media.primary.path must be a relative path inside the project.",
    });
  }

  if (
    value.primary.kind !== "viewport" ||
    (pathIsSafe && value.primary.path !== "raw/capture.webm") ||
    value.primary.contentType !== "video/webm"
  ) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest media.primary is invalid.",
    });
  }
}

function validateMetadata(value: unknown, errors: ProjectValidationError[]): void {
  if (!isRecord(value)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest metadata.events is invalid.",
    });
    return;
  }

  reportUnknownFields(value, METADATA_KEYS, errors);

  if (!isRecord(value.events)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest metadata.events is invalid.",
    });
    return;
  }

  reportUnknownFields(value.events, METADATA_EVENTS_KEYS, errors);

  const pathIsSafe = isSafeProjectPath(value.events.path);

  if (!pathIsSafe) {
    errors.push({
      code: "unsafe_project_path",
      message: "Project metadata.events.path must be a relative path inside the project.",
    });
  }

  if (
    (pathIsSafe && value.events.path !== "metadata/events.jsonl") ||
    value.events.contentType !== "application/x-ndjson"
  ) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest metadata.events is invalid.",
    });
  }
}

function validateVariants(input: JsonRecord, errors: ProjectValidationError[]): void {
  if (!Array.isArray(input.variants)) {
    errors.push({
      code: "invalid_project_manifest",
      message:
        "Auto Demo project manifest must include empty variants, previews, and exports arrays.",
    });
    return;
  }

  const seenIds = new Set<string>();
  for (const variant of input.variants) {
    validateVariant(variant, input, seenIds, errors);
  }
}

function validateVariant(
  value: unknown,
  input: JsonRecord,
  seenIds: Set<string>,
  errors: ProjectValidationError[],
): void {
  if (!isRecord(value)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project variant is invalid.",
    });
    return;
  }

  reportUnknownFields(value, VARIANT_KEYS, errors);
  validateVariantId(value.id, seenIds, errors);
  validateNonEmptyString(
    value.displayName,
    "Auto Demo project variant display name is invalid.",
    errors,
  );
  validateVariantSource(value.source, input, errors);
  const timeline = validateVariantTimeline(
    value.timeline,
    getCaptureDurationMs(input.sourceCapture),
    errors,
  );
  validateVariantViewport(value.viewport, errors);
  validateVariantCursor(value.cursor, errors);
  validateVariantClicks(value.clicks, errors);
  validateVariantTimedTextArray(value.captions, "caption", timeline, errors);
  validateVariantTimedTextArray(value.callouts, "callout", timeline, errors);
  validateVariantStyle(value.style, errors);
  validateVariantExportIntent(value.exportIntent, errors);
}

function validateVariantId(
  value: unknown,
  seenIds: Set<string>,
  errors: ProjectValidationError[],
): void {
  if (typeof value !== "string" || !isSlug(value) || seenIds.has(value)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project variant ids must be unique lowercase slugs.",
    });
    return;
  }

  seenIds.add(value);
}

function validateVariantSource(
  value: unknown,
  input: JsonRecord,
  errors: ProjectValidationError[],
): void {
  if (!isRecord(value)) {
    errors.push({
      code: "invalid_project_manifest",
      message:
        "Auto Demo project variant source paths must reference the primary media and events.",
    });
    return;
  }

  reportUnknownFields(value, VARIANT_SOURCE_KEYS, errors);
  const mediaPathIsSafe = isSafeProjectPath(value.mediaPath);
  const eventsPathIsSafe = isSafeProjectPath(value.eventsPath);

  if (!mediaPathIsSafe || !eventsPathIsSafe) {
    errors.push({
      code: "unsafe_project_path",
      message: "Project variant source paths must be relative paths inside the project.",
    });
  }

  const mediaPath = getNestedString(input.media, ["primary", "path"]);
  const eventsPath = getNestedString(input.metadata, ["events", "path"]);
  if (
    (mediaPathIsSafe && value.mediaPath !== mediaPath) ||
    (eventsPathIsSafe && value.eventsPath !== eventsPath)
  ) {
    errors.push({
      code: "invalid_project_manifest",
      message:
        "Auto Demo project variant source paths must reference the primary media and events.",
    });
  }
}

function validateVariantTimeline(
  value: unknown,
  captureDurationMs: number | null,
  errors: ProjectValidationError[],
): ProjectVariantTimeline | null {
  if (!isRecord(value)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project variant timeline must fit inside the source capture duration.",
    });
    return null;
  }

  reportUnknownFields(value, VARIANT_TIMELINE_KEYS, errors);
  const startMs = value.startMs;
  const endMs = value.endMs;
  const validRange =
    captureDurationMs !== null &&
    isIntegerInRange(startMs, 0, captureDurationMs) &&
    isIntegerInRange(endMs, 0, captureDurationMs) &&
    startMs < endMs;

  if (!validRange) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project variant timeline must fit inside the source capture duration.",
    });
    return null;
  }

  return { startMs, endMs };
}

function validateVariantViewport(value: unknown, errors: ProjectValidationError[]): void {
  if (!isRecord(value)) {
    pushVariantViewportError(errors);
    return;
  }

  reportUnknownFields(value, VARIANT_VIEWPORT_KEYS, errors);
  const focusIsValid = isRecord(value.focus) && isNormalizedPoint(value.focus);
  if (isRecord(value.focus)) {
    reportUnknownFields(value.focus, VARIANT_FOCUS_KEYS, errors);
  }

  if (
    (value.mode !== "contain" && value.mode !== "cover") ||
    !focusIsValid ||
    typeof value.zoom !== "number" ||
    !Number.isFinite(value.zoom) ||
    value.zoom < 1 ||
    value.zoom > 4
  ) {
    pushVariantViewportError(errors);
  }
}

function validateVariantCursor(value: unknown, errors: ProjectValidationError[]): void {
  if (!isRecord(value)) {
    pushVariantCursorError(errors);
    return;
  }

  reportUnknownFields(value, VARIANT_CURSOR_KEYS, errors);
  if (
    typeof value.visible !== "boolean" ||
    (value.emphasis !== "none" && value.emphasis !== "spotlight" && value.emphasis !== "hide-idle")
  ) {
    pushVariantCursorError(errors);
  }
}

function validateVariantClicks(value: unknown, errors: ProjectValidationError[]): void {
  if (!isRecord(value)) {
    pushVariantClickError(errors);
    return;
  }

  reportUnknownFields(value, VARIANT_CLICKS_KEYS, errors);
  if (value.emphasis !== "none" && value.emphasis !== "ring" && value.emphasis !== "pulse") {
    pushVariantClickError(errors);
  }
}

function validateVariantTimedTextArray(
  value: unknown,
  kind: "caption" | "callout",
  timeline: ProjectVariantTimeline | null,
  errors: ProjectValidationError[],
): void {
  const rangeMessage = `Auto Demo project variant ${kind} ranges must fit inside the variant timeline.`;
  if (!Array.isArray(value)) {
    errors.push({
      code: "invalid_project_manifest",
      message: rangeMessage,
    });
    return;
  }

  const seenIds = new Set<string>();
  let hasRangeError = false;

  for (const entry of value) {
    if (!isRecord(entry)) {
      if (!hasRangeError) {
        errors.push({ code: "invalid_project_manifest", message: rangeMessage });
        hasRangeError = true;
      }
      continue;
    }

    reportUnknownFields(
      entry,
      kind === "caption" ? VARIANT_TEXT_KEYS : VARIANT_CALLOUT_KEYS,
      errors,
    );
    const entryIdIsValid =
      typeof entry.id === "string" && isSlug(entry.id) && !seenIds.has(entry.id);
    if (entryIdIsValid) {
      seenIds.add(entry.id as string);
    }

    if (!entryIdIsValid || !isNonEmptyString(entry.text)) {
      errors.push({
        code: "invalid_project_manifest",
        message: `Auto Demo project variant ${kind}s are invalid.`,
      });
    }

    if (kind === "callout") {
      if (isRecord(entry.anchor)) {
        reportUnknownFields(entry.anchor, VARIANT_FOCUS_KEYS, errors);
      }

      if (!isNormalizedPoint(entry.anchor)) {
        errors.push({
          code: "invalid_project_manifest",
          message: "Auto Demo project variant callouts are invalid.",
        });
      }
    }

    if (
      timeline === null ||
      !isIntegerInRange(entry.startMs, timeline.startMs, timeline.endMs) ||
      !isIntegerInRange(entry.endMs, timeline.startMs, timeline.endMs) ||
      entry.startMs >= entry.endMs
    ) {
      if (!hasRangeError) {
        errors.push({ code: "invalid_project_manifest", message: rangeMessage });
        hasRangeError = true;
      }
    }
  }
}

function validateVariantStyle(value: unknown, errors: ProjectValidationError[]): void {
  if (!isRecord(value)) {
    pushVariantStyleError(errors);
    return;
  }

  reportUnknownFields(value, VARIANT_STYLE_KEYS, errors);
  if (
    (value.background !== "solid" && value.background !== "transparent") ||
    typeof value.backgroundColor !== "string" ||
    !isHexColor(value.backgroundColor) ||
    (value.frame !== "browser" && value.frame !== "none") ||
    !isIntegerInRange(value.padding, 0, 256) ||
    !isIntegerInRange(value.cornerRadius, 0, 64)
  ) {
    pushVariantStyleError(errors);
  }
}

function validateVariantExportIntent(value: unknown, errors: ProjectValidationError[]): void {
  if (!isRecord(value)) {
    pushVariantExportIntentError(errors);
    return;
  }

  reportUnknownFields(value, VARIANT_EXPORT_INTENT_KEYS, errors);
  if (
    value.format !== "mp4" ||
    (value.quality !== "demo" && value.quality !== "high") ||
    (value.aspectRatio !== "16:9" && value.aspectRatio !== "4:3" && value.aspectRatio !== "9:16")
  ) {
    pushVariantExportIntentError(errors);
  }
}

function reportUnknownFields(
  value: JsonRecord,
  allowedKeys: readonly string[],
  errors: ProjectValidationError[],
): void {
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest contains unknown fields.",
    });
  }
}

function pushVariantViewportError(errors: ProjectValidationError[]): void {
  errors.push({
    code: "invalid_project_manifest",
    message: "Auto Demo project variant viewport decision is invalid.",
  });
}

function pushVariantCursorError(errors: ProjectValidationError[]): void {
  errors.push({
    code: "invalid_project_manifest",
    message: "Auto Demo project variant cursor decision is invalid.",
  });
}

function pushVariantClickError(errors: ProjectValidationError[]): void {
  errors.push({
    code: "invalid_project_manifest",
    message: "Auto Demo project variant click decision is invalid.",
  });
}

function pushVariantStyleError(errors: ProjectValidationError[]): void {
  errors.push({
    code: "invalid_project_manifest",
    message: "Auto Demo project variant style decision is invalid.",
  });
}

function pushVariantExportIntentError(errors: ProjectValidationError[]): void {
  errors.push({
    code: "invalid_project_manifest",
    message: "Auto Demo project variant export intent is invalid.",
  });
}

function validateNonEmptyString(
  value: unknown,
  message: string,
  errors: ProjectValidationError[],
): void {
  if (!isNonEmptyString(value)) {
    errors.push({
      code: "invalid_project_manifest",
      message,
    });
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }

  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function isEmptyArray(value: unknown): value is [] {
  return Array.isArray(value) && value.length === 0;
}

function isCaptureStatus(value: unknown): value is ProjectSourceCapture["status"] {
  return value === "completed" || value === "failed" || value === "interrupted";
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isNormalizedNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isNormalizedPoint(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return isNormalizedNumber(value.x) && isNormalizedNumber(value.y);
}

function isSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function getCaptureDurationMs(value: unknown): number | null {
  if (!isRecord(value) || !isRecord(value.timing) || typeof value.timing.durationMs !== "number") {
    return null;
  }

  return Number.isInteger(value.timing.durationMs) && value.timing.durationMs > 0
    ? value.timing.durationMs
    : null;
}

function getNestedString(value: unknown, path: string[]): string | null {
  let current: unknown = value;

  for (const key of path) {
    if (!isRecord(current)) {
      return null;
    }
    current = current[key];
  }

  return typeof current === "string" ? current : null;
}

function isSafeSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function isSafeProjectPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }

  return (
    !value.startsWith("/") && !value.includes("..") && !value.includes("\\") && !value.includes(":")
  );
}
