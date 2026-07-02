import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
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
  variants: [];
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

export type LoadedProject = {
  projectDir: string;
  manifestPath: string;
  manifest: ProjectManifest;
};

export type ProjectValidationResult =
  | ({ ok: true } & LoadedProject)
  | {
      ok: false;
      projectDir: string;
      manifestPath: string;
      errors: ProjectValidationError[];
    };

export type SaveProjectInput = LoadedProject;

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
  validateForwardCompatibleArrays(input, errors);
  validateSourceCapture(input.sourceCapture, errors);
  validateMedia(input.media, errors);
  validateMetadata(input.metadata, errors);

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

export async function validateProject(
  projectDirOrManifest: string,
): Promise<ProjectValidationResult> {
  const projectPaths = resolveProjectPaths(projectDirOrManifest);
  let rawManifest: string;

  try {
    rawManifest = await readFile(projectPaths.manifestPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
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

export async function loadProject(projectDirOrManifest: string): Promise<ProjectValidationResult> {
  return validateProject(projectDirOrManifest);
}

export async function saveProject(project: SaveProjectInput): Promise<ProjectValidationResult> {
  const manifestValidation = validateProjectManifest(project.manifest);
  if (!manifestValidation.ok) {
    return projectFailure(project, manifestValidation.errors);
  }

  await writeJsonFileAtomically(project.manifestPath, manifestValidation.manifest);
  return validateProject(project.manifestPath);
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

  return errors;
}

async function isExistingFile(path: string): Promise<boolean> {
  try {
    const file = await stat(path);
    return file.isFile();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function writeJsonFileAtomically(path: string, value: unknown): Promise<void> {
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tempPath, path);
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

function validateForwardCompatibleArrays(
  input: JsonRecord,
  errors: ProjectValidationError[],
): void {
  if (
    !isEmptyArray(input.variants) ||
    !isEmptyArray(input.previews) ||
    !isEmptyArray(input.exports)
  ) {
    errors.push({
      code: "invalid_project_manifest",
      message:
        "Auto Demo project manifest must include empty variants, previews, and exports arrays.",
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
    value.durationMs < 0
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
