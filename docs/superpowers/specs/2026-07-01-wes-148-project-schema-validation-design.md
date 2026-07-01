# WES-148 Project Schema Validation Design

Date: 2026-07-01

## Linear Issue

- Issue: WES-148, "Project schema validation and public API"
- Project: Auto Demo Balanced MVP
- Milestone: Demo Project Format
- Parent: WES-134, "Milestone 3: Demo Project Format tracker"

## Context

The Capture Runtime milestone produces temporary WES-147 capture bundles. Demo Project
Format turns those capture outputs into a durable Auto Demo project directory. The project
directory is the user-facing working folder for one recorded demo and later deliverables:

```text
project-dir/
  autodemo.project.json
  raw/
    capture.webm
  metadata/
    events.jsonl
    capture.manifest.json
  variants/
  previews/
  exports/
```

`autodemo.project.json` is the top-level project manifest. It is the source-of-truth
contract that later packages use to polish, render, edit, and export a demo. WES-148
defines and validates that manifest shape only. It does not create project directories,
copy capture artifacts, read or write project files, or add CLI commands.

## Goals

- Export schema version 1 manifest constants and public TypeScript types from
  `@auto-demo/project`.
- Replace the current minimal manifest validator with a strict schema v1 validator.
- Validate a full `autodemo.project.json` object for the approved first project slice.
- Return accumulated structured validation errors so callers can show useful feedback.
- Keep manifest diagnostics deterministic and non-secret.

## Non-Goals

- Import WES-147 capture bundles into a project layout. That is WES-149.
- Validate files on disk, load projects, or save project manifests. That is WES-150.
- Create `raw/`, `metadata/`, `variants/`, `previews/`, or `exports/` directories.
- Add or broaden CLI commands.
- Generate variants, previews, renders, exports, or polish decisions.
- Persist exact original capture URLs when they contain query strings, fragments, or
  username/password userinfo.

## Public API

`@auto-demo/project` will export:

```ts
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

export type ProjectValidationError = {
  code: "unsupported_project_version" | "invalid_project_manifest" | "unsafe_project_path";
  message: string;
};

export type ProjectManifestValidationResult =
  { ok: true; manifest: ProjectManifest } | { ok: false; errors: ProjectValidationError[] };

export function validateProjectManifest(input: unknown): ProjectManifestValidationResult;
```

WES-148 may keep `ProjectValidationResult` as a compatibility alias to
`ProjectManifestValidationResult` if that reduces churn, but the public validator result
for manifest validation must use the accumulated `errors` shape.

## Manifest Shape

Schema version 1 requires these fields:

- `schemaVersion: 1`
- `name`: non-empty string
- `createdAt`: parseable ISO-style timestamp string
- `updatedAt`: parseable ISO-style timestamp string
- `sourceCapture`: browser capture summary
- `media.primary`: primary viewport video artifact reference
- `metadata.events`: browser interaction metadata artifact reference
- `variants`: empty array
- `previews`: empty array
- `exports`: empty array

`sourceCapture` is a sanitized summary of the imported capture, not a second source of
truth for raw capture artifacts. It stores:

- `kind: "browser"`
- `status`: `completed`, `failed`, or `interrupted`
- `source.kind: "browser"`
- `source.url`: an `http` or `https` URL with no username, password, query string, or
  fragment
- positive integer viewport width and height
- parseable `startedAt` and `endedAt` timestamps plus non-negative finite `durationMs`
- `adapter.kind: "browser"`
- `adapter.backend: "playwright"`
- non-empty tool version strings for `capturePackage` and `playwright`
- `manifestPath: "metadata/capture.manifest.json"`

Artifact references are fixed for schema v1:

- `media.primary.kind: "viewport"`
- `media.primary.path: "raw/capture.webm"`
- `media.primary.contentType: "video/webm"`
- `metadata.events.path: "metadata/events.jsonl"`
- `metadata.events.contentType: "application/x-ndjson"`

Later milestones may populate `variants`, `previews`, and `exports`, but schema v1 requires
them to be present and empty.

## Validation Rules

Validation should reject:

- non-object, null, or array inputs;
- unsupported schema versions with `unsupported_project_version`;
- missing required fields or sections;
- wrong literal values;
- invalid or empty strings where non-empty strings are required;
- invalid timestamps;
- negative, non-finite, or non-integer numeric fields;
- missing or non-empty `variants`, `previews`, or `exports`;
- unknown fields at any manifest object level;
- unsafe project artifact paths;
- source URLs with protocols other than `http` or `https`;
- source URLs with username/password userinfo;
- source URLs with query strings or fragments.

Unsafe project artifact paths include:

- absolute POSIX paths;
- Windows absolute paths;
- paths containing `..` traversal;
- paths containing backslashes;
- paths containing colons;
- empty paths.

Even though schema v1 uses fixed artifact paths, path validation should still be explicit
so future validation failures report `unsafe_project_path` instead of a generic manifest
error.

Validation should accumulate all errors it can safely find. It may skip nested validation
when a parent value has the wrong type, but it should not stop after the first independent
error.

Messages must be stable and non-secret. They should not echo user-provided path, URL, or
unknown-field values.

## Error Handling

`validateProjectManifest()` is pure and synchronous. Expected invalid input returns
`{ ok: false, errors }`; it should not throw for malformed user data.

The manifest-level error codes for WES-148 are intentionally small:

- `unsupported_project_version`
- `invalid_project_manifest`
- `unsafe_project_path`

WES-150 can introduce file-level errors such as `missing_project_manifest`,
`invalid_project_json`, and `missing_project_file` when project directory validation is
implemented.

## Testing

Tests should treat `validateProjectManifest()` as a black box. They should assert public
behavior and returned values, not helper names, parser internals, or validation traversal
order beyond the documented accumulated error array.

Required test coverage:

- accepts a representative valid schema v1 manifest and returns it as the parsed manifest;
- rejects unsupported schema versions with `unsupported_project_version`;
- rejects missing future arrays;
- rejects non-empty `variants`, `previews`, and `exports`;
- rejects unsafe media and metadata artifact paths;
- rejects unknown fields in top-level and nested objects;
- rejects source URLs with query strings, fragments, userinfo, or non-http protocols;
- rejects invalid timestamps and invalid numeric fields;
- rejects wrong literal values and content types;
- returns multiple independent errors in one result.

Tests should not read or write project directories for WES-148. Filesystem fixture helpers
belong in WES-150 unless a later implementation plan has a narrow reason to introduce them
earlier.

## Scope Boundary For Later Issues

WES-149 will use this manifest contract when importing capture bundles into project-owned
paths. It will sanitize capture input, including source URLs, into the stricter final
project format.

WES-150 will add project directory validation, loading, and saving. It will decide how
`validateProject()` reports missing manifests, invalid JSON files, missing referenced
files, and manifest-path resolution from either a project directory or direct manifest
path.

WES-148 should not add those behaviors, but it should leave exported types clear enough
for WES-149 and WES-150 to consume.
