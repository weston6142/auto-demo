# @auto-demo/polish

Creates edit decisions from project metadata.

The package currently exposes `generateBaselinePolishVariant(project, options)`,
which reads a validated Auto Demo project's `metadata/events.jsonl` file and
returns one deterministic schema v1 project variant plus structured warnings.
The baseline generator uses conservative trim, focus, cursor, and click-emphasis
rules so downstream persistence, rendering, and editor work can consume a stable
first-pass variant.

Planned work still owns saving generated variants, named style batches, rendered
previews, exports, and editor controls.
