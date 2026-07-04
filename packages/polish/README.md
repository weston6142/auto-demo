# @auto-demo/polish

Creates edit decisions from project metadata.

The package currently exposes `generateBaselinePolishVariant(project, options)`,
which reads a validated Auto Demo project's `metadata/events.jsonl` file and
returns one deterministic schema v1 project variant plus structured warnings.
It also exposes the baseline-only `MVP_STYLE_PRESETS` contract and
`generateHeadlessVariants(options)` for the first headless dry-run generation
contract used by `autodemo generate`. The baseline generator uses conservative
trim, focus, cursor, and click-emphasis rules so downstream persistence,
rendering, and editor work can consume a stable first-pass variant.

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
summary without saving files:

```ts
const summary = await generateHeadlessVariants({
  projectPath: "projects/checkout-demo",
  dryRun: true,
  json: true,
  count: 1,
  style: MVP_STYLE_PRESETS[0].key,
});
```

The WES-166 MVP preset decision is baseline-only. `MVP_STYLE_PRESETS` exports one
approved preset with stable key `baseline` and display name `Baseline Polish`,
giving WES-155 and browser-editor planning a shared source of truth without
introducing themed visual behavior before rendering/editor validation exists.
Unsupported style keys, counts other than `1`, save modes, non-JSON output, and
invalid project input return structured non-secret errors.

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

Planned work still owns named style batches, selected/all save modes, rendered
previews, exports, and editor controls.
