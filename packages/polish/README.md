# @auto-demo/polish

Creates edit decisions from project metadata.

The package currently exposes `generateBaselinePolishVariant(project, options)`,
which reads a validated Auto Demo project's `metadata/events.jsonl` file and
returns one deterministic schema v1 project variant plus structured warnings.
The baseline generator uses conservative trim, focus, cursor, and click-emphasis
rules so downstream persistence, rendering, and editor work can consume a stable
first-pass variant.

```ts
import { loadProject } from "@auto-demo/project";
import { savePolishVariant } from "@auto-demo/project";
import { generateBaselinePolishVariant } from "@auto-demo/polish";

const project = await loadProject("projects/checkout-demo");

if (project.ok) {
  const { variant, warnings } = await generateBaselinePolishVariant(project, {
    id: "baseline-polish",
    displayName: "Baseline Polish",
  });
  const saved = await savePolishVariant(project, variant);
}
```

The generator returns a variant object only. Persisting that variant is owned by
`@auto-demo/project` through `savePolishVariant()`, which writes
`variants/<variant-id>.json`, updates `autodemo.project.json`, and revalidates
the saved project. `options.id` must be a lowercase slug, and invalid labels
fall back to `baseline-polish` and `Baseline Polish` so the returned variant
remains schema-valid.

Warnings are stable, structured, and non-secret. They cover unreadable or empty
event files, malformed JSONL lines, missing action events, missing usable click
coordinates, and failed or interrupted source captures without echoing raw event
payloads, URLs, typed values, or local paths.

Planned work still owns named style batches, rendered previews, exports, and
editor controls.
