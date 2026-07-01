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
  "unsupported_project_version" | "invalid_project_manifest" | "unsafe_project_path";

export type ProjectValidationError = {
  code: ProjectValidationErrorCode;
  message: string;
};

export type ProjectManifestValidationResult =
  { ok: true; manifest: ProjectManifest } | { ok: false; errors: ProjectValidationError[] };

export type ProjectValidationResult = ProjectManifestValidationResult;

type JsonRecord = Record<string, unknown>;

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
