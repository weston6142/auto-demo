# @auto-demo/project

Owns the first Auto Demo project manifest contract, project layout helpers, and
project load/save validation behavior, including schema v1 MVP polish variant
definitions.

## Project Layout

`createProjectFromCaptureBundle()` imports a validated WES-147 capture bundle into this normalized directory shape:

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

The importer accepts either a capture bundle directory or a direct `capture.manifest.json` path. It validates the bundle with `@auto-demo/capture`, rejects non-empty target directories, copies viewport media to `raw/capture.webm`, copies event metadata to `metadata/events.jsonl`, writes a sanitized project-owned capture summary to `metadata/capture.manifest.json`, and writes a schema v1 `autodemo.project.json`.

The project-owned capture summary is not a verbatim WES-147 capture manifest. It removes temporary or diagnostic fields, rewrites artifact paths to final project-relative paths, and strips source URL username, password, query string, and fragment values.

## Variant Definitions

Schema v1 project manifests may include MVP polish variant entries in
`variants`. The project package validates the variant data model but does not
generate polish decisions, render previews or exports, or add editor behavior.
New imports still start with `variants: []`.

Each variant must include a unique lowercase slug `id`, non-empty
`displayName`, source paths that match the manifest's primary media and events
paths, a timeline within `sourceCapture.timing.durationMs`, viewport
`contain`/`cover` decisions with normalized focus and `1` through `4` zoom,
cursor and click emphasis decisions, caption and callout ranges within the
variant timeline, style decisions, and MP4 export intent. `previews` and
`exports` remain empty arrays in schema v1.

## API

```ts
import {
  createProjectFromCaptureBundle,
  loadProject,
  saveProject,
  validateProject,
  validateProjectManifest,
} from "@auto-demo/project";

const result = await createProjectFromCaptureBundle({
  captureBundlePath: "captures/checkout",
  projectDir: "projects/checkout-demo",
  name: "Checkout demo",
});
```

Expected invalid capture or project input returns `{ ok: false, errors }` with stable non-secret error messages. Operational filesystem failures may still throw. `validateProjectManifest(input)` validates schema v1 manifest objects without reading project files.

The package also exports `ProjectVariant` and its nested decision types for
callers that construct or inspect manifest variants.

Variant validation errors are reported as `invalid_project_manifest` or
`unsafe_project_path` without echoing user text, raw URLs, typed values, or
arbitrary field names.

`validateProject(projectDirOrManifest)` and `loadProject(projectDirOrManifest)`
accept either a project directory or direct `autodemo.project.json` path. They
parse the manifest, reuse schema v1 validation, and verify the required
referenced files exist: viewport media, event metadata, and copied capture
summary metadata. Expected project file problems return structured
`missing_project_manifest`, `invalid_project_json`, `missing_project_file`, or
manifest validation errors without echoing secret-bearing input. A malformed
layout where a required parent path is a file is reported as the corresponding
missing manifest or project file error.

`saveProject(project)` validates and atomically writes the manifest, then
revalidates the saved project. It does not copy, delete, or repair referenced
artifact files.
