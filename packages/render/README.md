# @auto-demo/render

Orchestrates rendering saved Auto Demo project variants into export artifacts.
WES-167 selected the MVP export preset and canonical validation fixture. WES-163
implements the local renderer API and `autodemo export` CLI path.

## MVP Export Preset

The first supported preset key is `mp4-demo`.

`mp4-demo` renders an MP4 container with H.264 video, `yuv420p` pixel format, 30
frames per second, and no audio track for the MVP fixture. Output dimensions are
derived from the saved variant's `exportIntent.aspectRatio`:

- `16:9`: `1280x720`
- `4:3`: `1024x768`
- `9:16`: `720x1280`

The `demo` quality target favors predictable local rendering over high bitrate.
The schema's `high` quality intent remains valid project data, but WES-163 may
map it to the same MVP settings until rendered output evidence justifies
distinct high-fidelity production presets.

## Canonical Validation Fixture

The canonical fixture for WES-163 and WES-165 is
`fixtures/export/basic-saved-variant`. It represents a completed browser capture
for "Checkout flow demo" at `https://example.com/checkout`, 1280x720 source
viewport media, one saved `baseline-polish` variant, and
`exportIntent: { format: "mp4", quality: "demo", aspectRatio: "16:9" }`.

`renderSavedVariant()` and `autodemo export --project <project> --json` write:

- `exports/baseline-polish.mp4`
- `exports/baseline-polish.render.json`

The render summary records the source project manifest path, source variant
identifier, preset key, render settings, output path, started and ended
timestamps, duration when available, and non-secret renderer diagnostics on
failure.

The default local runner shells out to `ffmpeg`, scales and pads the source
media into the target dimensions, encodes H.264 video, and omits audio. Tests
and future integrations can inject a runner for deterministic rendering behavior.

## Failure Contract

Export work should fail with structured, non-secret errors for invalid project
input, missing variant selection, missing media or metadata, unsupported preset
keys, unsupported non-MP4 variant export intent, and renderer failure. Renderer
diagnostics may include command name, exit code, preset key, variant id, and
project-relative output paths, but must not echo secret-bearing URLs, raw event
payloads, typed values, or arbitrary renderer output.

## Deferrals

Non-MP4 formats, hosted rendering, batch rendering infrastructure, package
distribution, curated marketing samples, and distinct high-fidelity production
presets are deferred until after the first local MP4 export path is validated.
