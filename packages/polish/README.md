# @auto-demo/polish

Creates edit decisions from project metadata.

The package currently exposes `generateBaselinePolishVariant(project, options)`,
which reads a validated Auto Demo project's `metadata/events.jsonl` file and
returns one deterministic schema v1 project variant plus structured warnings.
It also exposes the baseline-only `MVP_STYLE_PRESETS` contract and
`generateHeadlessVariants(options)` for the headless dry-run and save contracts
used by `autodemo generate`. The baseline generator uses conservative trim,
focus, cursor, and click-emphasis rules so downstream persistence, rendering,
and editor work can consume a stable first-pass variant.

```ts
import { loadProject } from "@auto-demo/project";
import { savePolishVariant } from "@auto-demo/project";
import {
  MVP_STYLE_PRESETS,
  generateBaselinePolishVariant,
  generateHeadlessVariants,
} from "@auto-demo/polish";

const project = await loadProject("projects/checkout-demo");

if (project.ok) {
  const { variant, warnings } = await generateBaselinePolishVariant(project, {
    id: "baseline-polish",
    displayName: "Baseline Polish",
  });
  const saved = await savePolishVariant(project, variant);
}
```

Headless generation accepts a project path and returns a compact JSON-ready
batch summary. The project must already contain the source variant in
`autodemo.project.json` and a matching `variants/<source-variant-id>.json` file.
Dry-run mode writes nothing:

```ts
const summary = await generateHeadlessVariants({
  projectPath: "projects/checkout-demo",
  dryRun: true,
  json: true,
  count: 1,
  styles: [MVP_STYLE_PRESETS[0].key],
  sourceVariantId: "baseline-polish",
});
```

Save mode persists one selected generated variant or all generated variants
through `savePolishVariant()` and returns saved paths, skipped variants, final
validation status, and next-step hints:

```ts
const saved = await generateHeadlessVariants({
  projectPath: "projects/checkout-demo",
  json: true,
  styles: [MVP_STYLE_PRESETS[0].key],
  sourceVariantId: "source-baseline",
  save: true,
  selectedVariantId: "baseline-polish",
});

const savedAll = await generateHeadlessVariants({
  projectPath: "projects/checkout-demo",
  json: true,
  styles: [MVP_STYLE_PRESETS[0].key],
  sourceVariantId: "source-baseline",
  save: true,
  mode: "all",
});
```

The WES-166 MVP preset decision is baseline-only. `MVP_STYLE_PRESETS` exports one
approved preset with stable key `baseline` and display name `Baseline Polish`,
giving WES-155 and browser-editor planning a shared source of truth without
introducing themed visual behavior before rendering/editor validation exists.
Unsupported style keys, duplicate style requests, counts that do not match the
baseline-only MVP batch size, missing source variants, invalid selected save
ids, duplicate generated variant ids, malformed save arguments, non-JSON output,
and invalid project input return structured non-secret errors. If the persisted
source variant is already named `baseline-polish`, saving the generated
`baseline-polish` variant returns a structured `duplicate_variant_id` error; use
a non-colliding source variant id when saving a new generated baseline variant.

The baseline generator returns a variant object only. Persisting that variant is
owned by `@auto-demo/project` through `savePolishVariant()`, which writes
`variants/<variant-id>.json`, updates `autodemo.project.json`, and revalidates
the saved project. `options.id` must be a lowercase slug, and invalid labels
fall back to `baseline-polish` and `Baseline Polish` so the returned variant
remains schema-valid.

Warnings are stable, structured, and non-secret. They cover unreadable or empty
event files, malformed JSONL lines, missing action events, missing usable click
coordinates, and failed or interrupted source captures without echoing raw event
payloads, URLs, typed values, or local paths.

Planned work still owns run summary files on disk, rendered previews, exports,
additional themed presets, and persistence for browser editor draft changes.
