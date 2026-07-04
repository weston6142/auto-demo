# WES-155 Deterministic Named Variant Batches Design

Date: 2026-07-04

## Linear Issue

- Issue: WES-155, "Generate deterministic named variant batches"
- Project: Auto Demo Balanced MVP
- Milestone: Headless Variant Generation

## Context

WES-151 defined schema-valid `ProjectVariant` objects. WES-152 generates a
deterministic baseline polish variant from a loaded project. WES-153 persists
saved variants in project files. WES-154 exposed the first headless dry-run
contract through `generateHeadlessVariants()` and
`autodemo generate --project <project> --dry-run --json`. WES-166 decided that
the MVP style preset list is baseline-only: stable key `baseline`, display name
`Baseline Polish`.

WES-155 expands the WES-154 dry-run contract from "one hard-coded baseline
summary" into deterministic named batch semantics while respecting the
baseline-only MVP decision. The feature must not invent themed variants,
rendering differences, save modes, or browser-editor behavior.

## Goals

- Load a valid Auto Demo project through `loadProject()`.
- Require an existing persisted source variant for batch generation, defaulting
  to `baseline-polish` when no source id is supplied.
- Generate deterministic dry-run summary entries for requested MVP style keys.
- Use `MVP_STYLE_PRESETS` as the source of truth for allowed keys and display
  names.
- Return stable ids, display names, source references, style keys, variant
  metadata, save status, and non-secret warnings.
- Reject unsupported style keys, invalid counts, duplicate requested names, and
  missing source variants with structured errors.
- Keep generated output within WES-151 schema and WES-153 persistence rules by
  deriving summary data from `generateBaselinePolishVariant()` and the loaded
  source variant.
- Cover the behavior with tests that assert public API and CLI output rather
  than private helper mechanics.

## Non-Goals

- Saving generated variants or run summaries. WES-156 owns selected/all save
  modes and summary persistence.
- Creating additional named presets such as focused, cinematic, captioned, dark,
  social, or brand-like styles.
- Rendering media, producing previews, exporting MP4 files, or visually proving
  differences between styles.
- Adding a browser preset picker or browser editor mutation workflow.
- Accepting capture bundles directly. Generation continues to require a valid
  Auto Demo project.

## Approach Options

### Option A: Baseline-Only Batch Contract

`generateHeadlessVariants()` accepts a style list and emits one deterministic
summary per requested style. Because the approved MVP preset list contains only
`baseline`, the default batch contains one baseline summary. Unsupported styles
and duplicate requested styles are structured errors. This keeps WES-155 honest:
the API becomes batch-shaped without pretending there are multiple visual
presets.

This is the selected approach.

### Option B: Synthetic Multiple Baseline Copies

The generator could satisfy "multiple distinct variants" by creating repeated
baseline copies with suffixes such as `baseline-polish-2`. That would make the
batch interface look fuller, but the variants would not be meaningfully distinct
and would conflict with WES-166's instruction to avoid fake visual presets.

### Option C: Add More MVP Presets Now

The generator could add focused or captioned presets during WES-155. That would
reopen WES-166 and introduce unvalidated product behavior before renderer/editor
fidelity exists. This is out of scope.

## Public API

`@auto-demo/polish` will extend the existing `HeadlessVariantGenerationOptions`
shape:

```ts
type HeadlessVariantGenerationOptions = {
  projectPath: string;
  dryRun?: boolean;
  json?: boolean;
  count?: number;
  style?: string;
  styles?: string[];
  sourceVariantId?: string;
  save?: boolean;
  mode?: string;
};
```

Request normalization:

- `style` is retained for backwards compatibility and treated as a one-item
  style list.
- `styles` is the batch-oriented input. If omitted, it defaults to all
  `MVP_STYLE_PRESETS` keys, which is currently `["baseline"]`.
- Passing both `style` and `styles` is rejected as a structured option error.
- `count` must equal the resolved style-list length. With the baseline-only
  preset list, omitted count and `count: 1` are valid.
- `sourceVariantId` defaults to `baseline-polish`.

Successful results keep the existing compact CLI-friendly shape and add
batch/source metadata:

```ts
type HeadlessVariantSummary = {
  id: string;
  displayName: string;
  style: "baseline";
  source: {
    projectPath: string;
    manifestPath: string;
    mediaPath: string;
    eventsPath: string;
    variantId: string;
  };
  metadata: {
    presetKey: "baseline";
    presetDisplayName: "Baseline Polish";
    batchIndex: number;
    batchSize: number;
    sourceVariantId: string;
  };
  save: {
    mode: "dry-run";
    saved: false;
  };
  warnings: PolishWarning[];
};
```

Structured error codes add:

- `conflicting_style_options` when both `style` and `styles` are provided.
- `duplicate_style` when a requested style key appears more than once.
- `missing_source_variant` when `sourceVariantId` is not present in the loaded
  project manifest.

Existing error behavior remains for missing project path, unsupported output
mode, unsupported save mode, invalid count, unsupported style, malformed CLI
arguments, and invalid projects.

## CLI Contract

Supported command:

```bash
autodemo generate --project <project-dir-or-manifest> --dry-run --json
```

Supported batch flags:

```bash
--style baseline
--styles baseline
--count 1
--source-variant baseline-polish
```

`--styles` accepts a comma-separated list without spaces. In the MVP this list
may contain only `baseline` once. The CLI prints one JSON object to stdout. It
exits `0` on success and `1` for structured errors. Stderr remains empty in JSON
mode.

The API and CLI do not save files in WES-155. Successful summaries include
`save: { mode: "dry-run", saved: false }`.

## Data Flow

1. Parse CLI flags into `HeadlessVariantGenerationOptions`.
2. Normalize requested style keys from `style`, `styles`, and
   `MVP_STYLE_PRESETS`.
3. Validate dry-run/json/save/count/style/source option constraints before
   loading project files when possible.
4. Load the project through `loadProject()`.
5. Find the source variant in `loadedProject.manifest.variants` by
   `sourceVariantId`.
6. Generate the baseline variant with `generateBaselinePolishVariant()`.
7. Build deterministic summary entries using preset metadata, source project
   paths, source variant id, and generated variant warnings.

The generated summary id remains `baseline-polish` for the default baseline
request. Display name remains `Baseline Polish`. Future preset additions can add
additional entries without changing the response structure.

## Error Handling

All expected product/input errors return structured non-secret errors. Messages
must not echo raw manifest contents, event payloads, typed values, credentialed
URLs, or secret-bearing paths beyond the already supplied project path field in
the existing result shape.

Duplicate requested style keys are rejected because WES-155 should not create
synthetic copies of the same baseline preset. Missing source variants are
rejected because the issue specifically builds from a saved project with a
persisted baseline polish variant.

## Testing

Behavior-first tests will cover:

- API success for a project with a persisted `baseline-polish` source variant
  returns one deterministic baseline batch summary with source variant metadata
  and no saved files.
- Repeated API calls with identical input return identical batch summaries.
- Missing source variant returns `missing_source_variant`.
- Unsupported style keys, duplicate styles, count/style-list mismatch, and
  conflicting `style`/`styles` inputs return structured errors.
- CLI success with `--styles baseline --source-variant baseline-polish` prints
  the same batch metadata and exits `0`.
- CLI duplicate or unsupported styles in JSON mode print structured JSON errors
  and exit `1`.

Tests will assert public results, CLI stdout/stderr/exit codes, and filesystem
effects. They will not assert private parser/helper names or internal call order.

## Documentation

Update:

- `README.md` headless generation section to describe baseline-only batch
  semantics and source variant requirements.
- `packages/polish/README.md` to document the new API options and structured
  errors.
- `docs/linear/auto-demo-project-structure.md` with WES-155 investigation and
  completion evidence.

## Spec Self-Review

- Placeholder scan: no TBD/TODO placeholders remain.
- Consistency: the design follows WES-166 baseline-only presets and WES-154's
  dry-run JSON contract.
- Scope: saving, run summaries, rendering, exports, and browser editing remain
  deferred to downstream issues.
- Ambiguity: duplicate baseline requests are explicitly rejected instead of
  creating synthetic repeated variants.
