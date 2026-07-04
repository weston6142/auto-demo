# WES-153 Persist Generated Polish Variant Design

Date: 2026-07-03

## Linear Issue

- Issue: WES-153, "Persist generated polish variant into project files"
- Project: Auto Demo Balanced MVP
- Milestone: Auto Polish Engine

## Context

WES-151 added schema v1 validation for `ProjectVariant` entries in
`autodemo.project.json`. WES-152 added `@auto-demo/polish` generation of one
schema-valid baseline variant from loaded project event metadata, but it returns
the variant in memory only. WES-150 `saveProject()` validates and atomically
writes the project manifest, then revalidates required raw media and metadata
files. It does not create variant artifact files or validate those files.

WES-153 makes generated polish output durable for downstream milestone work.
The saved project must round-trip through load/validate, preserve imported raw
capture artifacts, and provide a stable handoff contract for headless variant
generation, browser editing, and export.

## Goals

- Add a project-package API named `savePolishVariant(project, variant, options?)`.
- Write the variant payload to `variants/<variant-id>.json` as formatted JSON.
- Append the schema-valid variant to `autodemo.project.json` and revalidate the
  saved project.
- Validate saved variant files during `validateProject()` and `loadProject()`.
- Return structured non-secret errors for duplicate ids, invalid variant data,
  unsafe variant paths, missing variant files, and malformed variant files.
- Preserve raw capture media and metadata bytes when saving variants.
- Cover the full handoff flow: WES-149 import, WES-152 generation, save variant,
  reload, and validate.
- Document the saved-variant contract for Milestone 5 Headless Variant
  Generation and Milestone 6 Browser Editor.

## Non-Goals

- Rendering media previews or final exports.
- Choosing, generating, or saving multiple named style variants.
- Adding CLI commands for generation or persistence.
- Browser editor mutation workflows.
- Changing the in-manifest `ProjectVariant` schema fields.
- Making variants the source of truth outside `autodemo.project.json`; the
  manifest remains the authoritative project index.

## Approach Options

### Option A: Project-Owned Variant Persistence API

Add `savePolishVariant()` to `@auto-demo/project`. The function validates a
single `ProjectVariant`, writes `variants/<id>.json`, updates the manifest
`variants` array, writes the manifest through the existing atomic save path, and
revalidates both manifest and variant files.

This is the selected approach. Persistence belongs with project layout and
validation behavior, while generation remains in `@auto-demo/polish`.

### Option B: Polish Package Saves Variants

`@auto-demo/polish` could generate and save the variant in one call. That would
couple generation to project file layout and duplicate save/revalidation rules
that already live in `@auto-demo/project`.

### Option C: Manifest-Only Persistence

The existing `saveProject()` can already save variants directly in the manifest.
That is too narrow for WES-153 because the acceptance criteria require variant
data under `variants/` and missing/invalid variant file validation.

## Public API

`@auto-demo/project` will export:

```ts
type SavePolishVariantOptions = {
  now?: Date;
};

type SavePolishVariantResult = ProjectValidationResult;

async function savePolishVariant(
  project: LoadedProject,
  variant: ProjectVariant,
  options?: SavePolishVariantOptions,
): Promise<SavePolishVariantResult>;
```

The function returns the same result shape as `saveProject()`. Expected
validation failures return `{ ok: false, errors }`; unexpected filesystem
failures may still throw, matching existing project-package behavior.

`options.now` exists for deterministic tests and for future callers that need a
controlled `updatedAt`. When omitted, the function uses the current time.

## Saved File Contract

The first saved-variant contract is intentionally simple:

```text
project-dir/
  variants/
    baseline-polish.json
```

Each file contains exactly the formatted `ProjectVariant` JSON object stored in
the manifest entry with the same `id`. The file path is derived from the
validated slug id: `variants/${variant.id}.json`. Callers cannot provide an
arbitrary variant path, so unsafe-path writes are avoided by construction.

`validateProject()` checks every manifest variant has a matching file at this
derived path. It parses each file and confirms the object equals the manifest
entry. A missing file returns `missing_project_file`. Invalid JSON, non-object
JSON, mismatched variant ids, mismatched decision data, or schema-invalid file
content returns `invalid_project_manifest`. Error messages do not echo raw
variant text, local paths, URLs, or typed event values.

## Save Behavior

`savePolishVariant(project, variant, options)`:

1. Builds a candidate manifest by appending `variant` to
   `project.manifest.variants` and setting `updatedAt`.
2. Validates the candidate manifest using the existing schema v1 validation.
   Duplicate ids, unsafe source paths, and invalid variant decisions fail here
   before any file is written.
3. Ensures the `variants/` directory exists.
4. Writes `variants/<id>.json` atomically with formatted JSON.
5. Writes the updated manifest with the existing atomic project save path.
6. Revalidates the project from disk, including the variant file.

The function does not copy, delete, or mutate `raw/`, `metadata/`, `previews/`,
or `exports/`.

## Testing

Tests are behavior-first and file-system oriented:

- Import a capture bundle, generate a baseline variant through
  `generateBaselinePolishVariant()`, save it with `savePolishVariant()`, reload
  the project, and confirm the manifest and `variants/<id>.json` round-trip.
- Confirm raw capture media and metadata bytes are unchanged after saving.
- Confirm duplicate ids return the existing structured manifest validation
  error and do not overwrite the existing variant file or manifest.
- Confirm invalid variant data returns structured validation errors before
  writing files.
- Confirm `validateProject()` reports a missing saved variant file.
- Confirm `validateProject()` reports invalid or mismatched variant file JSON.

Tests should assert public results, files, and reload behavior rather than
private helper names or internal write order.

## Documentation

Update `packages/project/README.md` with the saved-variant file contract and
API. Update `packages/polish/README.md` and the root `README.md` to show the
handoff from baseline generation to project persistence. Update the Linear
project map after completion with WES-153 evidence and the next-task pointer.

## Spec Self-Review

- Placeholder scan: no TBD or TODO placeholders remain.
- Consistency: generation remains in `@auto-demo/polish`; project layout,
  persistence, and validation remain in `@auto-demo/project`.
- Scope: the design saves one variant and validates saved variant files; CLI,
  rendering, presets, editor mutation, previews, and exports are explicitly
  deferred.
- Ambiguity: file naming, validation behavior, atomic save flow, raw artifact
  immutability, and error categories are concrete enough for implementation.
