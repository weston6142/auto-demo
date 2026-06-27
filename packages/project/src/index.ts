export const PROJECT_MANIFEST_FILENAME = "autodemo.project.json";
export const SUPPORTED_PROJECT_SCHEMA_VERSION = 1;

export type ProjectManifest = {
  schemaVersion: number;
  name: string;
  createdAt: string;
};

export type ProjectValidationErrorCode =
  | "missing_project_manifest"
  | "invalid_project_json"
  | "unsupported_project_version"
  | "invalid_project_manifest";

export type ProjectValidationResult =
  | { ok: true; manifest: ProjectManifest }
  | { ok: false; code: ProjectValidationErrorCode; message: string };

export function validateProjectManifest(input: unknown): ProjectValidationResult {
  if (!isRecord(input)) {
    return {
      ok: false,
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest must be a JSON object.",
    };
  }

  if (input.schemaVersion !== SUPPORTED_PROJECT_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "unsupported_project_version",
      message: `Unsupported Auto Demo project schema version: ${String(input.schemaVersion)}`,
    };
  }

  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    return {
      ok: false,
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest must include a non-empty name.",
    };
  }

  if (typeof input.createdAt !== "string" || Number.isNaN(Date.parse(input.createdAt))) {
    return {
      ok: false,
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest must include an ISO createdAt timestamp.",
    };
  }

  return {
    ok: true,
    manifest: {
      schemaVersion: input.schemaVersion,
      name: input.name,
      createdAt: input.createdAt,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
