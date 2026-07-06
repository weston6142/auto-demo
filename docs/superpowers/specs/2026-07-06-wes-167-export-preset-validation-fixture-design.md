# WES-167 Export Preset And Validation Fixture Decision Design

Date: 2026-07-06

## Linear Issue

- Issue: WES-167, "Open question: choose MVP export preset and validation fixture"
- Project: Auto Demo Balanced MVP
- Milestone: Export And Packaging

## Context

Export And Packaging starts with a dependency conflict: the local project map
pointed at WES-163, but live Linear records WES-167 as a blocker for WES-163 and
WES-165. The correction is to settle the preset and fixture decision before
implementing MP4 rendering.

The existing product contracts already narrow the answer:

- Project variants carry `exportIntent.format: "mp4"` plus `quality` of `demo`
  or `high` and an aspect ratio of `16:9`, `4:3`, or `9:16`.
- Captures and fixtures currently use `1280x720` browser viewport media.
- Saved variants are durable project files at `variants/<variant-id>.json` and
  are produced by both headless generation and browser editor saves.
- WES-165 owns final demo bundle validation and operator instructions, so this
  issue should identify the fixture and expected artifacts without building new
  sample content or implementing rendering.

## Selected Decision

Use one MVP export preset with stable key `mp4-demo`.

`mp4-demo` means MP4 container, H.264 video, `yuv420p` pixel format, 30 frames
per second, no audio track for the MVP fixture, and dimensions derived from the
variant's `exportIntent.aspectRatio`. The default 16:9 output size is
`1280x720`; 4:3 maps to `1024x768`; 9:16 maps to `720x1280`. The `demo`
quality target should prefer predictable local rendering over high bitrate. A
future `high` quality request may use the same settings until WES-163 has
evidence to safely expose a distinct high-quality profile.

The canonical validation fixture is a repo-owned synthetic project fixture,
`fixtures/export/basic-saved-variant`, with one completed browser capture,
`raw/capture.webm`, `metadata/events.jsonl`, `metadata/capture.manifest.json`,
`autodemo.project.json`, and one saved variant named `baseline-polish`. The
fixture source should match the existing saved-variant test shape: project name
"Checkout flow demo", source URL `https://example.com/checkout`, 1280x720
viewport, a six-second capture, and a `baseline-polish` variant with
`exportIntent` set to `{ format: "mp4", quality: "demo", aspectRatio: "16:9" }`.

The expected exported artifacts for the fixture are:

- `exports/baseline-polish.mp4`
- `exports/baseline-polish.render.json`

The render summary must include the source project manifest path, source variant
identifier, preset key, render settings, output path, started/ended timestamps,
duration if available, and non-secret renderer diagnostics on failure.

## Rationale

This decision keeps WES-163 implementable without pretending to solve product
polish before the first renderer exists. MP4/H.264 with `yuv420p` is the most
portable local demo target. A 1280x720 default matches the current capture
viewport and test fixtures, avoids inventing upscaling behavior, and gives
WES-165 a practical artifact to inspect.

The fixture should be synthetic and repo-owned because WES-167 is not supposed
to build new sample content or depend on a secret/private project. A small
validated fixture lets WES-163 test the render contract and lets WES-165 later
document a repeatable demo-readiness checklist. It also avoids making WES-163
depend on browser-editor UI flows just to obtain a saved variant.

## Alternatives Considered

### Option A: Stable `mp4-demo` Preset And Synthetic Saved-Variant Fixture

This is selected. It is enough for the first export implementation, matches the
current project schema, and keeps product-unknown visual polish configurable
inside the renderer implementation rather than exposed as multiple user-facing
presets.

### Option B: Defer Preset Details To WES-163

This would leave WES-163 guessing codec, frame rate, output dimensions, and
fixture expectations even though Linear explicitly created WES-167 to remove
that ambiguity.

### Option C: Define Multiple Production Presets Now

Multiple presets such as "social", "high", or "vertical" would look more
complete, but they would force product and visual-fidelity decisions before the
first renderer can provide evidence. The schema can already express aspect
ratio and quality intent; the MVP implementation should start with one preset.

## Required Updates

- Add the export preset decision to `packages/render/README.md`.
- Add the export handoff summary to the root README where rendering is currently
  described as planned work.
- Add behavior-oriented documentation tests that verify the public docs preserve
  the `mp4-demo` preset, codec/container, dimensions, fixture identity, expected
  artifacts, fallback behavior, and deferrals.
- Update the project map with WES-167 spec/plan links, the corrected pre-task
  selection, and the next-task pointer to WES-163 after completion.
- Add concise Linear readiness notes to WES-163 and WES-165 after validation.

## Fallback Behavior

WES-163 should return structured, non-secret failures instead of partial success
when:

- the project cannot be loaded or validated;
- the requested variant is missing;
- the variant references missing media or metadata;
- the variant requests a non-MP4 export format;
- the requested preset key is unsupported;
- the renderer process fails or does not produce the expected MP4 artifact.

Renderer failures may include the command name, exit code, preset key, variant
id, and project-relative output paths. They must not echo secret-bearing URLs,
raw event payloads, typed values, or arbitrary command output.

## Deferrals

- Implementing MP4 rendering and the `autodemo export` command, owned by
  WES-163.
- Building or curating marketing/demo sample content beyond identifying the
  fixture shape.
- Non-MP4 formats, hosted or batch rendering infrastructure, and published
  package distribution.
- Distinct high-fidelity production presets until rendered output evidence
  justifies them.

## Testing Strategy

This is a decision issue, so tests should treat documentation as public
behavior. They should verify that the render package README and root README
preserve the selected preset key, MP4/H.264 settings, default dimensions,
fixture path, expected artifacts, fallback categories, and explicit deferrals.

Tests should not assert heading order, exact prose, or private formatting. Run
the focused render documentation test first, then `npm run validate`.

## Spec Self-Review

- Placeholder scan: no TBD, TODO, or incomplete markers remain.
- Consistency: the decision matches schema v1 `ProjectVariantExportIntent`, the
  existing 1280x720 fixture convention, and WES-167's scope as a decision gate.
- Scope: this is one decision and documentation task; rendering implementation,
  export CLI behavior, and demo bundle validation remain downstream work.
- Ambiguity: the preset key, codec/container, dimensions, fixture identity,
  expected artifacts, fallback behavior, and deferrals are explicit.
