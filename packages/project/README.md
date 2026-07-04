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
`variants`. New imports still start with `variants: []`. The project package
validates the variant data model and persists saved variant JSON files, but does
not generate polish decisions, render previews or exports, or add editor
behavior.

Each variant must include a unique lowercase slug `id`, non-empty
`displayName`, source paths that match the manifest's primary media and events
paths, a timeline within `sourceCapture.timing.durationMs`, viewport
`contain`/`cover` decisions with normalized focus and `1` through `4` zoom,
cursor emphasis (`none`, `spotlight`, or `hide-idle`), click emphasis (`none`,
`ring`, or `pulse`), caption and callout ranges within the variant timeline,
style decisions (`solid` or `transparent` background, six-digit hex color,
`browser` or `none` frame, `0` through `256` padding, and `0` through `64`
corner radius), and MP4 export intent (`demo` or `high` quality with `16:9`,
`4:3`, or `9:16` aspect ratio). `previews` and `exports` remain empty arrays
in schema v1.

Saved variants are stored under a derived project-relative path:

```text
variants/<variant-id>.json
```

The file contains the same formatted `ProjectVariant` JSON object referenced in
`autodemo.project.json`. The manifest remains the authoritative project index;
the saved variant file is the durable handoff artifact for headless generation,
browser editor, and export work. `validateProject()` and `loadProject()` require
each manifest variant to have a matching saved file and report structured
non-secret errors for missing, malformed, or mismatched variant files.

## API

```ts
import {
  createProjectFromCaptureBundle,
  loadProject,
  savePolishVariant,
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
artifact files. If the manifest includes variants, the corresponding
`variants/<variant-id>.json` files must already exist and match the manifest.

`savePolishVariant(project, variant, options)` validates one generated variant,
writes `variants/<variant-id>.json`, appends the variant to
`autodemo.project.json`, updates `updatedAt`, and revalidates the saved project.
Duplicate ids, unsafe source paths, invalid variant decisions, missing saved
variant files, and malformed or mismatched variant files are reported through
structured validation errors. The API does not mutate raw capture media,
metadata, previews, or exports.
