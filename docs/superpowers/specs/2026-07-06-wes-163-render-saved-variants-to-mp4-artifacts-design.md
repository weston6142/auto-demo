# WES-163 Render Saved Variants To MP4 Artifacts Design

Date: 2026-07-06

## Linear Issue

- Issue: WES-163, "Render saved variants to MP4 artifacts"
- Project: Auto Demo Balanced MVP
- Milestone: Export And Packaging

## Context

WES-167 resolved the export preset ambiguity that previously blocked this work.
The MVP export path now has one stable preset, `mp4-demo`, and one canonical
fixture shape: `fixtures/export/basic-saved-variant` with a saved
`baseline-polish` variant. Existing upstream work already produces saved
variants through headless generation and browser editor saves.

The current render package is only a boundary stub. The CLI still treats
`autodemo export` as planned work. WES-163 should implement the first local MP4
render path without changing project schema, editor save behavior, agent
handoff behavior, or packaging decisions.

## Selected Approach

Add a render package API that loads and validates an Auto Demo project, selects
one saved variant, resolves the `mp4-demo` settings from the variant export
intent, invokes a renderer runner, writes `exports/<variant-id>.mp4`, and writes
`exports/<variant-id>.render.json` with non-secret completion or failure
metadata.

The default runner shells out to `ffmpeg` with portable MVP settings:

- MP4 container through the output file extension.
- H.264 video codec (`libx264`).
- `yuv420p` pixel format.
- 30 frames per second.
- No audio track.
- Output dimensions from the selected variant aspect ratio:
  - `16:9`: `1280x720`
  - `4:3`: `1024x768`
  - `9:16`: `720x1280`

The renderer should scale and pad the project media into the target dimensions.
It may not implement visual overlays for captions, callouts, cursor emphasis, or
browser framing in this slice. Those decisions remain represented in the saved
variant and summary metadata so later fidelity work can consume them.

## Public API

`@auto-demo/render` will export:

- `MVP_EXPORT_PRESET_KEY`, equal to `mp4-demo`.
- `MVP_EXPORT_PRESET`, containing codec, pixel format, frame rate, no-audio
  behavior, and aspect-ratio dimensions.
- `renderSavedVariant(input, dependencies?)`.
- TypeScript types for render input, result, errors, summary, and runner
  dependencies.

The input contains:

- `projectPath`: project directory or direct `autodemo.project.json` path.
- `variantId`: optional saved variant id. Defaults to the only saved variant,
  or to `baseline-polish` when present.
- `preset`: optional preset key. Defaults to `mp4-demo`.
- `now`: optional clock for deterministic tests.

The result is JSON-ready:

- success: `ok: true`, project manifest path, variant id, output path, summary
  path, preset key, render settings, started/ended timestamps, and renderer
  diagnostics limited to command name and exit code.
- failure: `ok: false` plus structured non-secret errors and, when rendering
  reached the runner, the failure summary path.

## CLI Contract

`autodemo export` becomes async and supports:

```text
autodemo export --project <project-dir-or-manifest> [--variant <variant-id>] [--preset mp4-demo] --json
```

The command requires `--json` for MVP consistency with `generate` and `agent`.
Successful output is exactly the `renderSavedVariant()` JSON result. Expected
validation, selection, preset, unsupported export-intent, missing file, and
renderer failures exit `1` and print structured JSON to stdout without stderr
noise.

## Error Handling

Use stable error codes:

- `invalid_project`
- `missing_variant`
- `missing_media`
- `unsupported_preset`
- `unsupported_export_intent`
- `renderer_failure`
- `invalid_export_request`

Failure messages should be operator-readable and non-secret. They may include
the project manifest path, variant id, preset key, project-relative artifact
paths, ffmpeg command name, and exit code. They must not echo source URLs, raw
event payloads, typed values, or arbitrary renderer stderr.

When the renderer fails after output setup, write
`exports/<variant-id>.render.json` with `ok: false`, the selected preset,
settings, source variant id, intended output path, and sanitized diagnostics.

## Testing Strategy

Tests are behavior-first:

- render package tests create project fixtures through public project layout and
  verify success writes the MP4 path and render summary with the expected
  `mp4-demo` settings.
- render tests inject a fake runner instead of asserting private ffmpeg command
  construction for most cases.
- one focused runner test can verify default runner failure classification with
  a missing renderer command, but no test should require inspecting private
  process internals.
- CLI tests call `runCliAsync()` and assert JSON behavior, exit codes, and
  injected render dependency behavior.

Run focused render and CLI tests first, then package typecheck/build, then
`npm run validate`.

## Deferrals

- Hosted or batch rendering infrastructure.
- Non-MP4 outputs.
- Audio tracks.
- Exact browser-editor preview parity.
- Rendering captions, callouts, cursor effects, browser chrome, or click
  emphasis into video.
- Packaging or distribution target decisions, owned by WES-168 and WES-164.
- End-to-end demo readiness validation and operator instructions, owned by
  WES-165.

## Spec Self-Review

- Placeholder scan: no TBD, TODO, or incomplete markers remain.
- Consistency: the design follows WES-167 `mp4-demo`, existing project schema
  v1, saved variant files, and the CLI's JSON-first generated/agent patterns.
- Scope: this is one local MP4 renderer and CLI export slice. Packaging,
  hosted rendering, non-MP4 formats, and final demo validation stay downstream.
- Ambiguity: variant selection defaults, preset settings, output paths, summary
  path, error codes, and deferrals are explicit.
