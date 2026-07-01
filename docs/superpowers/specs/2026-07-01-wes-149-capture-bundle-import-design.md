# WES-149 Capture Bundle Import Design

Date: 2026-07-01

## Linear Issue

- Issue: WES-149, "Import capture bundles into project layout"
- Project: Auto Demo Balanced MVP
- Milestone: Demo Project Format
- Parent: WES-134, "Milestone 3: Demo Project Format tracker"

## Context

WES-147 produces temporary capture bundles:

```text
capture-dir/
  capture.manifest.json
  media/
    viewport.webm
  metadata/
    events.jsonl
```

WES-148 added strict schema v1 validation for the final Auto Demo project manifest. WES-149
connects those two pieces by importing a validated capture bundle into a normalized,
project-owned layout:

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

This issue should not add project load/save APIs, final project file validation, CLI commands,
variant generation, polish decisions, previews, or exports. WES-150 owns project load/save and
file validation behavior.

## Goals

- Add `createProjectFromCaptureBundle()` to `@auto-demo/project`.
- Validate the source capture bundle through `@auto-demo/capture` before importing.
- Copy supported capture artifacts into fixed project-owned paths.
- Write a schema v1 `autodemo.project.json` that passes WES-148 validation.
- Write project-owned capture summary metadata to `metadata/capture.manifest.json`.
- Return structured, non-secret errors for expected invalid capture or project input.
- Keep the original capture bundle unmodified.

## Non-Goals

- Add `validateProject()`, `loadProject()`, or `saveProject()`.
- Add or broaden `autodemo validate`.
- Validate all final project referenced files after import beyond checking the generated manifest
  and successful writes.
- Preserve exact temporary capture artifact paths in the final project manifest.
- Generate variants, previews, captions, renders, exports, or polish decisions.
- Support overwriting an existing project directory.

## Approaches Considered

### Recommended: Validate, Normalize, And Rewrite Summary Metadata

`createProjectFromCaptureBundle()` validates the source bundle, copies media and events into
fixed final-project paths, rewrites `metadata/capture.manifest.json` as a sanitized
project-owned capture summary, and writes `autodemo.project.json`.

This creates a clean boundary: capture bundles are temporary input, while project directories own
their own stable artifact paths and metadata. It also keeps secret-bearing or temporary fields out
of final projects.

### Alternative: Copy Capture Manifest Verbatim

The importer could copy the WES-147 `capture.manifest.json` exactly as-is. This is simpler, but it
would leave project metadata pointing at the temporary bundle's artifact paths and preserve fields
that are capture-runtime diagnostics rather than final project contract. That would make later
polish/render/editor code reason about two path systems.

### Alternative: Implement Full Project APIs Now

The importer could also add `validateProject()`, `loadProject()`, and `saveProject()`. That would
finish more of WES-134, but it merges WES-149 with WES-150 and broadens the implementation and test
surface before the import behavior is stable.

## Public API

`@auto-demo/project` adds:

```ts
export type CreateProjectFromCaptureBundleInput = {
  captureBundlePath: string;
  projectDir: string;
  name: string;
  now?: () => Date;
};

export type ProjectImportErrorCode =
  | ProjectValidationErrorCode
  | "invalid_capture_bundle"
  | "invalid_project_input"
  | "project_directory_not_empty";

export type ProjectImportError = {
  code: ProjectImportErrorCode;
  message: string;
};

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

export async function createProjectFromCaptureBundle(
  input: CreateProjectFromCaptureBundleInput,
): Promise<ProjectImportResult>;
```

`ProjectValidationErrorCode` remains part of the package surface from WES-148. The importer reuses
manifest validation codes by mapping `validateProjectManifest()` errors into `ProjectImportError`.

## Import Behavior

The importer accepts either a capture bundle directory or a direct `capture.manifest.json` path as
`captureBundlePath`. It calls `validateCaptureBundle(captureBundlePath)` and returns
`invalid_capture_bundle` if the capture package reports invalid input. The returned message should
be stable and non-secret; it should not forward raw capture validation text because those errors
can contain manifest-controlled paths.

The importer rejects expected bad project input before creating files:

- empty or whitespace-only project names;
- empty `projectDir`;
- target directories that already contain files or directories;
- target paths where the parent exists but the target is a file.

An existing empty target directory is allowed. A missing target directory is allowed. Existing
non-empty directories return `project_directory_not_empty`. Permission errors, disk failures, and
unexpected filesystem races may throw because they are operational failures rather than expected
validation input.

On success, the importer creates:

- `raw/`
- `metadata/`
- `variants/`
- `previews/`
- `exports/`

It copies:

- capture media artifact to `raw/capture.webm`;
- capture events artifact to `metadata/events.jsonl`.

It writes:

- sanitized capture summary metadata to `metadata/capture.manifest.json`;
- final schema v1 manifest to `autodemo.project.json`.

The original capture bundle is never mutated.

## Project Manifest Mapping

The generated `autodemo.project.json` uses:

- `schemaVersion: 1`
- `name`: input `name` trimmed of surrounding whitespace
- `createdAt` and `updatedAt`: `input.now?.()` or the current clock, serialized with
  `toISOString()`
- `sourceCapture.kind`: `"browser"`
- `sourceCapture.status`: capture manifest status
- `sourceCapture.source.kind`: `"browser"`
- `sourceCapture.source.url`: sanitized HTTP(S) URL with query string, fragment, username, and
  password removed
- `sourceCapture.viewport`: capture viewport
- `sourceCapture.timing`: capture `startedAt`, `endedAt`, and integer `durationMs`
- `sourceCapture.adapter`: capture adapter
- `sourceCapture.tools`: capture tool versions
- `sourceCapture.manifestPath`: `"metadata/capture.manifest.json"`
- `media.primary.path`: `"raw/capture.webm"`
- `metadata.events.path`: `"metadata/events.jsonl"`
- `variants`, `previews`, and `exports`: empty arrays

After building the manifest object, the importer calls `validateProjectManifest()`. Validation
failures return structured errors rather than writing an invalid project manifest.

If the capture source URL cannot become a WES-148-safe HTTP(S) URL, the import returns
`invalid_capture_bundle`. The importer should not invent a placeholder URL because downstream
polish and render work need the source summary to describe the actual capture.

## Project-Owned Capture Summary Metadata

`metadata/capture.manifest.json` is not a verbatim copy of the temporary WES-147 manifest and is
not intended to validate as a standalone WES-147 capture bundle. It is project-owned sanitized
capture summary metadata. It preserves:

- schema version;
- status;
- sanitized browser source URL;
- adapter;
- tools;
- viewport;
- started and ended timestamps;
- duration;

It omits or rewrites fields that are temporary-bundle-specific or diagnostic-only:

- original artifact paths;
- child command;
- error diagnostic details.

The summary includes a small `artifacts` section using final project-relative paths:

```json
{
  "media": "raw/capture.webm",
  "events": "metadata/events.jsonl"
}
```

This keeps the copied capture summary useful for audit and debugging while making
`autodemo.project.json` the source of truth for final project structure.

## File Writing And Atomicity

The importer should avoid exposing partially-written manifest files where practical:

- create directories before copying artifacts;
- copy media and events before writing manifests;
- write `metadata/capture.manifest.json` and `autodemo.project.json` through temp-file-then-rename;
- format JSON with two-space indentation and trailing newline.

The importer does not need full transaction rollback in WES-149. If an unexpected filesystem error
occurs after directories or artifacts are created, it may throw and leave partial files for
inspection. Expected invalid input should be detected before project files are created.

## Error Handling

Expected invalid input returns `{ ok: false, errors }`:

- invalid capture bundle;
- invalid project name;
- empty project directory path;
- existing non-empty target directory;
- generated manifest validation failures.

Messages must be concise and non-secret. They should avoid echoing raw paths, URLs, query strings,
fragments, child-command arguments, or capture diagnostics.

Unexpected filesystem and programming errors may throw:

- permission denied;
- disk full;
- source artifact disappears after validation;
- destination race after preflight;
- JSON serialization failure from impossible internal state.

## Testing

Tests should be black-box and behavior-oriented. Add WES-149 tests to
`packages/project/src/index.test.ts` unless the file becomes difficult to navigate; splitting test
files can be left to the implementation plan if needed.

Required coverage:

- importing a representative valid capture bundle creates the normalized project layout;
- imported media and events contents match the source artifacts;
- `autodemo.project.json` references only final project-relative paths and passes
  `validateProjectManifest()`;
- `metadata/capture.manifest.json` is rewritten with final project-relative artifact paths and no
  child command or error diagnostic details;
- a direct capture manifest path works as input;
- source URLs with query strings, fragments, or userinfo are sanitized into project-safe URLs;
- invalid capture bundles return `invalid_capture_bundle` without creating project files;
- empty project names return `invalid_project_input`;
- existing non-empty target directories return `project_directory_not_empty`;
- import does not mutate the original capture bundle.

Tests should not assert helper names, copy order, private filesystem helpers, or exact low-level
capture-package error text.

## Documentation

Update `docs/linear/auto-demo-project-structure.md` after implementation with completion evidence
and the next-task pointer. Update `README.md` only if the public package status needs to mention
project import support. No CLI documentation is required for WES-149 because no CLI command is
being added.

## Open Decisions Resolved

- Capture summary metadata is rewritten, not copied verbatim.
- Project import permits missing or empty destination directories and rejects non-empty targets.
- `autodemo.project.json` is the final project source of truth for artifact paths.
- WES-150 remains responsible for final project load/save and full file validation APIs.
