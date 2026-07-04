# WES-166 MVP Named Style Presets Design

Date: 2026-07-04

## Linear Issue

- Issue: WES-166, "Open question: define MVP named style presets"
- Project: Auto Demo Balanced MVP
- Milestone: Headless Variant Generation

## Context

WES-151 defined the schema-backed `ProjectVariant` fields for timeline, viewport,
cursor, click emphasis, captions, callouts, style, and export intent. WES-152
implemented deterministic baseline polish generation, WES-153 persisted saved
variants, and WES-154 exposed the first headless dry-run contract:
`autodemo generate --project <project> --dry-run --json`.

The WES-154 contract intentionally accepts only `--style baseline` and
`--count 1`. WES-155 is blocked until WES-166 decides whether MVP headless
generation should create named style batches beyond baseline. WES-158 also needs
to know whether browser editor theme/preset controls are visible in the MVP.

## Decision

The MVP ships a single named style preset:

| Stable key | Display name      | Purpose                                                                                        |
| ---------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| `baseline` | `Baseline Polish` | Conservative, schema-backed polish generated from capture events without themed visual claims. |

No additional named style presets ship in the MVP. Themed presets are explicitly
post-MVP scope until rendering fidelity, editor controls, and visual QA can prove
the differences are meaningful.

## Rationale

### Option A: Baseline Only

Baseline only keeps WES-155 deterministic without introducing product styling
that the renderer and browser editor cannot yet preview or validate. It matches
the current WES-154 public contract, uses only fields already covered by WES-151,
and avoids pretending that small data-field tweaks are a real visual preset
system.

This is the selected approach.

### Option B: Small Fixed Set

A small fixed set such as `baseline`, `focused`, and `captioned` would give
WES-155 multiple variants to batch immediately. The tradeoff is that captions,
callouts, and visual personality would either be empty placeholders or heuristic
behavior not yet validated by renderer/editor workflows. That creates product
ambiguity in WES-155 instead of resolving it.

### Option C: Defer All Presets

Deferring even `baseline` would make the headless API less useful and conflict
with the already shipped WES-154 `baseline` style key. The MVP needs at least one
stable key so agents can call generation consistently.

## WES-155 Direction

WES-155 should generate deterministic batches using the approved preset list,
which currently contains only `baseline`. A valid MVP batch may therefore
produce one baseline variant by default and should reject unsupported style keys
with structured errors.

If WES-155 needs multiple outputs for a batch-oriented interface, it should keep
the behavior schema-backed and explicit:

- default style list: `["baseline"]`;
- allowed style keys: `baseline` only;
- display name source: `Baseline Polish`, with deterministic suffixing only when
  duplicate ids/names are explicitly requested;
- unsupported style keys: structured non-secret error;
- no themed aliases, randomization, or hidden visual variants.

WES-155 should not create fake `focused`, `social`, `executive`, `dark`, or
brand-like styles inside the MVP. Those require a follow-up product/design issue
after rendering and editor preview behavior exist.

## WES-158 Direction

The browser editor should hide theme or preset selection controls for the MVP.
It may show the loaded variant's style fields as part of focused finishing
controls where schema-backed, but it should not expose a preset picker until
multiple approved presets exist.

This keeps WES-158 aligned with WES-151: trim, framing, cursor/click emphasis,
captions/callouts where schema-backed, and style fields can be edited directly,
while preset selection remains deferred.

## Documentation And API Contract

Document the MVP preset decision in:

- `README.md` near the headless generation contract;
- `packages/polish/README.md` near `generateHeadlessVariants()`;
- `docs/linear/auto-demo-project-structure.md` investigation/completion notes.

Implementation should add a small public preset contract in `@auto-demo/polish`
only if it reduces ambiguity for WES-155. The contract should expose the single
approved preset without adding a new schema version or renderer dependency.

Recommended shape:

```ts
type MvpStylePresetKey = "baseline";

type MvpStylePreset = {
  key: MvpStylePresetKey;
  displayName: "Baseline Polish";
};

const MVP_STYLE_PRESETS: readonly MvpStylePreset[];
```

The contract is deliberately narrow. It is a shared source of truth for allowed
keys and display names, not a themed style engine.

## Testing

Tests should verify public behavior and exported contract shape:

- `@auto-demo/polish` exports exactly the MVP preset list with key `baseline` and
  display name `Baseline Polish`.
- Headless generation continues to accept `style: "baseline"`.
- Unsupported style keys remain rejected with structured errors.

Tests should not assert private helper functions or internal parsing mechanics.

## Non-Goals

- Implementing multiple named style presets.
- Designing brand templates, social formats, LLM-authored captions, or themed
  visual systems.
- Changing the WES-151 `ProjectVariant` schema.
- Rendering or visually validating preset output.
- Adding a browser editor preset picker.

## Spec Self-Review

- Placeholder scan: no TBD/TODO placeholders remain.
- Consistency: the decision matches the shipped WES-154 baseline-only contract
  and gives WES-155 stable keys/display names.
- Scope: the implementation is limited to docs and a narrow exported preset
  contract; generation, saving, rendering, and editor UI remain in their existing
  issues.
- Ambiguity: unsupported named styles and browser preset controls are explicitly
  deferred, so downstream issues do not need to invent MVP behavior.
