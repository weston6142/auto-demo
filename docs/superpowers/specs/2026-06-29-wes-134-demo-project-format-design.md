# WES-134 Demo Project Format Design

Date: 2026-06-29

## Linear Issue

- Issue: WES-134, "Milestone 3: Demo project format"
- Project: Auto Demo Balanced MVP
- Milestone: Demo Project Format

## Context

The Capture Runtime milestone is complete. `@auto-demo/capture` now writes a temporary
WES-147 capture bundle with `capture.manifest.json`, `media/viewport.webm`, and
`metadata/events.jsonl`. That bundle is useful capture-runtime output, but it is not the
final Auto Demo project schema.

WES-134 defines the first portable project-format slice owned by `@auto-demo/project`.
It should make captured walkthroughs reusable by later polish, render, editor, and agent
milestones without requiring those milestones to be implemented now.

## Goals

- Define Auto Demo project schema version 1 in `autodemo.project.json`.
- Store all project file references as portable paths relative to the project root.
- Import a WES-147 capture bundle into project-owned raw and metadata paths.
- Validate, load, and save projects through behavior-oriented `@auto-demo/project` APIs.
- Represent variants, previews, and exports explicitly in the manifest while leaving them
  empty until later milestones create those artifacts.
- Keep secrets out of manifests and validation diagnostics.

## Non-Goals

- Generate polish decisions, variants, previews, or exports.
- Add new CLI commands or broaden the existing `autodemo validate` command in this slice.
- Preserve the temporary capture-bundle directory shape inside final projects.
- Keep final projects coupled to an external capture-bundle path.
- Define a packaged single-file project format.
- Implement product source code as part of the planning-only task that creates this spec
  and plan.

## Approved Approach

Use a package-owned portable project format in `@auto-demo/project`.

The package will expose project-level operations instead of only low-level manifest
helpers:

- `createProjectFromCaptureBundle()`
- `loadProject()`
- `saveProject()`
- `validateProject()`

This creates a real project contract for downstream packages while keeping WES-134 small.
Schema-only work would leave the capture-to-project handoff unproven, while adding CLI
import or validation commands now would broaden the milestone before the package contract
is stable.

## Project Layout

An imported project uses this root layout:

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

The temporary capture bundle is input only. Import copies:

- `media/viewport.webm` to `raw/capture.webm`
- `metadata/events.jsonl` to `metadata/events.jsonl`
- `capture.manifest.json` to `metadata/capture.manifest.json`

The final project manifest references the normalized paths. It must not reference the
original capture-bundle directory.

## Manifest Shape

`autodemo.project.json` uses schema version `1` and stores explicit sections:

```json
{
  "schemaVersion": 1,
  "name": "Checkout flow demo",
  "createdAt": "2026-06-29T12:00:00.000Z",
  "updatedAt": "2026-06-29T12:00:00.000Z",
  "sourceCapture": {
    "kind": "browser",
    "status": "completed",
    "source": {
      "kind": "browser",
      "url": "https://example.com"
    },
    "viewport": {
      "width": 1280,
      "height": 720
    },
    "timing": {
      "startedAt": "2026-06-29T12:00:00.000Z",
      "endedAt": "2026-06-29T12:00:02.500Z",
      "durationMs": 2500
    },
    "adapter": {
      "kind": "browser",
      "backend": "playwright"
    },
    "tools": {
      "capturePackage": "0.0.0",
      "playwright": "1.61.1"
    },
    "manifestPath": "metadata/capture.manifest.json"
  },
  "media": {
    "primary": {
      "kind": "viewport",
      "path": "raw/capture.webm",
      "contentType": "video/webm"
    }
  },
  "metadata": {
    "events": {
      "path": "metadata/events.jsonl",
      "contentType": "application/x-ndjson"
    }
  },
  "variants": [],
  "previews": [],
  "exports": []
}
```

All paths in the manifest are relative to the project root. Validation rejects absolute
paths, Windows absolute paths, `..` traversal, and normalized paths that leave the
project root.

`sourceCapture` is a summary of the imported capture bundle, not a second source of truth
for artifact locations. The copied `metadata/capture.manifest.json` preserves the original
capture-runtime metadata for audit and future migration work.

## Package API

### `createProjectFromCaptureBundle(input)`

Input:

- `captureBundlePath`: bundle directory or direct `capture.manifest.json` path.
- `projectDir`: destination project directory.
- `name`: non-empty project display name.
- `now`: optional clock injection for deterministic tests.

Behavior:

1. Validate the WES-147 bundle through `@auto-demo/capture`.
2. Create `raw/`, `metadata/`, `variants/`, `previews/`, and `exports/`.
3. Copy viewport media, event metadata, and capture manifest into normalized project paths.
4. Write `autodemo.project.json` using temp-file-then-rename.
5. Return the loaded project result.

Expected invalid capture bundles return structured project-level validation errors with
stable non-secret messages. They must not forward capture-package error text because
capture diagnostics can contain manifest-controlled artifact paths. Unexpected
file-system or programming failures may throw.

### `validateProject(projectDirOrManifest)`

Reads `autodemo.project.json` from either a project directory or direct manifest path and
returns a structured result:

```ts
type ProjectValidationResult =
  | {
      ok: true;
      projectDir: string;
      manifestPath: string;
      manifest: ProjectManifest;
    }
  | {
      ok: false;
      projectDir: string;
      manifestPath: string;
      errors: ProjectValidationError[];
    };
```

Validation checks:

- manifest JSON is parseable and a JSON object;
- `schemaVersion` is supported;
- required fields and explicit sections are present;
- timestamps are ISO-parseable;
- file references are portable relative paths;
- required referenced files exist;
- `variants`, `previews`, and `exports` are arrays with length 0 in schema v1 until a
  later schema version defines their contents;
- diagnostics do not expose raw typed values or obvious secret-bearing fields.

Validation errors should use stable codes plus concise non-secret messages.

### `loadProject(projectDirOrManifest)`

Loads and validates a project. Expected invalid input returns the same structured errors as
`validateProject()`. Successful results include the project root, manifest path, and parsed
manifest so downstream packages can resolve artifacts from a known base path.

### `saveProject(project)`

Revalidates the manifest, writes formatted JSON through temp-file-then-rename, and returns
the saved project. It does not copy, delete, or mutate referenced artifact files.

## Error Handling

Expected invalid input returns structured results instead of throwing. This includes
unsupported schema versions, malformed manifests, missing required files, unsafe paths, and
missing explicit empty sections.

The package may throw for unexpected file-system failures, permission errors, or
programming mistakes. Public diagnostics must avoid raw typed values, cookies, local
storage, request bodies, environment dumps, token values, and secret-bearing URL query or
fragment content.

## Testing

Tests should be black-box and behavior-oriented:

- Importing a representative WES-147 capture bundle creates the normalized project layout
  and a valid manifest.
- Loaded projects expose project root, manifest path, and relative artifact paths.
- Saving a project round-trips formatted JSON without changing referenced artifacts.
- Validation reports useful structured errors for malformed JSON, unsupported schema
  versions, missing required files, absolute paths, `..` paths, and paths that leave the
  project root.
- Empty `variants`, `previews`, and `exports` sections validate without requiring concrete
  downstream artifacts, and non-empty sections are rejected in schema v1.

Tests should not assert private implementation details such as helper function names,
copy ordering, or internal parser structure.

## Documentation

Update `README.md` package/status text only if the implementation changes user-facing
behavior enough to make the current README stale. Update
`docs/linear/auto-demo-project-structure.md` with this WES-134 spec, implementation plan,
selected scope, and next-task/decomposition notes.

## Acceptance Criteria Mapping

- Portable schema: `autodemo.project.json` version 1 stores relative project-owned paths.
- Raw media and metadata: import copies capture media/events/manifest into normalized
  project paths.
- Variants, previews, exports: manifest includes explicit empty sections for later
  milestones.
- Validation: `validateProject()` checks manifest shape, schema, paths, files, and
  secret-safe diagnostics.
- Load/save behavior: `loadProject()` and `saveProject()` operate through structured
  project results and formatted atomic manifest writes.
- Capture handoff: WES-147 capture bundles are accepted as input without becoming the
  final schema.
