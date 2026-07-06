# Auto Demo

Auto Demo is an open-source, agent-first demo recorder and editor for browser-first product walkthroughs.

The MVP focuses on web app demos. Agents such as Codex or Claude should be able to operate a browser, capture the walkthrough, produce a reusable Auto Demo project, generate polished variants, and export demos without forcing the user into a manual editor.

Auto Demo is Mac-first for the initial audience, but browser-first for the initial capture workflow. Native Mac capture can be added later through the capture adapter boundary.

## Status

This repository is in early capture-to-project setup. The package structure exists, and `autodemo capture` now launches a Playwright-controlled Chromium browser for viewport media recording, writes browser interaction metadata to JSONL, emits a temporary capture bundle manifest, and preserves non-secret failed/interrupted diagnostics when artifacts exist. `@auto-demo/project` can import a validated capture bundle into the first normalized Auto Demo project layout, validate/load project directories or manifests, save manifests atomically before revalidation, validate MVP polish variant definitions, and persist saved variants under `variants/`. `@auto-demo/polish` can generate a deterministic baseline variant from project event metadata and expose baseline-only headless dry-run, selected-save, and save-all JSON summaries. `autodemo open` now serves a local browser editor that loads validated projects, previews saved variants with approximate browser fidelity, provides schema-backed draft controls for trims, viewport framing, captions, callouts, cursor/click emphasis, and direct style fields, and saves browser edits back as updated or copied project variants. `autodemo agent run` provides the first noninteractive agent handoff summary for selecting or generating saved variants and optionally starting the editor. `@auto-demo/render` and `autodemo export --project <project> --json` render saved variants with the MVP `mp4-demo` preset: MP4 container, H.264 video, `yuv420p`, 30 frames per second, 1280x720 for 16:9 saved variants, and adjacent render summary metadata for the repo-owned `fixtures/export/basic-saved-variant` validation fixture shape.

## Quick Start

```bash
npm install
npm run validate
```

To use `autodemo capture` or run browser smoke tests on a fresh machine, install Playwright's Chromium browser once:

```bash
npm run setup:browser
```

## Packages

- `@auto-demo/cli`: `autodemo` command entrypoint, command routing, async `capture` lifecycle, capture bundle validation, the baseline-only dry-run/save `generate` JSON contract, local editor startup, agent workflow handoff, and JSON export routing.
- `@auto-demo/project`: Auto Demo schema v1 project manifest types, strict validation with accumulated structured errors, MVP polish variant definition and saved-file validation, capture-bundle import into the normalized project layout, and project load/save/generated/browser variant persistence APIs.
- `@auto-demo/capture`: browser-first capture adapter contract, default Playwright viewport recorder, interaction metadata JSONL capture, temporary capture manifest APIs, capture output paths, and unsupported-backend fallback.
- `@auto-demo/polish`: deterministic baseline edit-decision generation from project event metadata, the baseline-only MVP style preset contract, and headless dry-run/save batch summaries.
- `@auto-demo/render`: export and render orchestration for saved variants, including the WES-167 `mp4-demo` preset, local ffmpeg runner boundary, and render summary metadata.
- `@auto-demo/editor`: local browser editor server, approximate variant preview, schema-backed local finishing UI, and update/copy saves for browser-edited variants.
- `@auto-demo/agent`: agent-facing workflow helpers, JSON handoff summaries, and repository-owned Codex wrapper artifacts.

## CLI

```bash
autodemo init
autodemo capture
autodemo generate --project <project-dir-or-manifest> --dry-run --json [--styles baseline] [--source-variant baseline-polish]
autodemo generate --project <project-dir-or-manifest> --json --save <variant-id|all> [--styles baseline] [--source-variant <source-variant-id>]
autodemo agent run --project <project-dir-or-manifest> --json [--variant <variant-id>]
autodemo agent run --project <project-dir-or-manifest> --json --generate baseline --source-variant <source-variant-id> --save <baseline-polish|all>
autodemo agent run --project <project-dir-or-manifest> --json --open-editor [--host 127.0.0.1] [--port 0] [--no-browser]
autodemo export --project <project-dir-or-manifest> --json [--variant baseline-polish] [--preset mp4-demo]
autodemo open --project <project-dir-or-manifest> [--host 127.0.0.1] [--port 0] [--no-browser]
autodemo validate <capture-dir-or-manifest>
```

`autodemo capture` is the first partially implemented command:

```bash
autodemo capture --url <url> --out <capture-dir> [--viewport <width>x<height>] [--] [walkthrough command...]
```

The CLI validates `--url`, `--out`, optional `--viewport`, and an optional child command after `--`. The default viewport is `1280x720`. The default browser backend uses Playwright's bundled Chromium and records viewport media without OS screen-recording permissions.

Browser captures that complete, fail after startup, or are interrupted after artifacts flush currently create a temporary capture bundle under the output directory:

```text
capture-dir/
  capture.manifest.json
  media/
    viewport.webm
  metadata/
    events.jsonl
```

The manifest uses schema version `1`, records capture status, source, viewport, timing, adapter/tool versions, relative artifact paths, and optional stable error diagnostics, and redacts source URL secrets, child command arguments, and diagnostic URL secrets. If a started capture cannot stop cleanly, the CLI reports the diagnostic bundle path when one can be preserved. Validate a bundle with:

```bash
autodemo validate <capture-dir-or-manifest>
```

Capture bundles can be converted through the `@auto-demo/project` API into a portable project directory:

```text
project-dir/
  autodemo.project.json
  raw/
    capture.webm
  metadata/
    events.jsonl
    capture.manifest.json
  variants/
  previews/
  exports/
```

The project importer validates the source bundle, copies supported artifacts into project-owned paths, writes a sanitized capture summary to `metadata/capture.manifest.json`, and leaves the original capture bundle unchanged. Project package APIs can also validate or load a project directory or direct `autodemo.project.json` path, report missing manifests, invalid JSON, schema errors, and missing referenced files with structured non-secret errors, save formatted manifests atomically before revalidating the saved project, persist generated polish variants append-only, and update or copy browser-edited variants as `variants/<variant-id>.json` files indexed by the project manifest.

Headless generation currently supports the baseline-only dry-run and save
contracts:

```bash
autodemo generate --project <project-dir-or-manifest> --dry-run --json [--styles baseline] [--source-variant baseline-polish]
autodemo generate --project <project-dir-or-manifest> --json --save baseline-polish --source-variant source-baseline
autodemo generate --project <project-dir-or-manifest> --json --save all --source-variant source-baseline
```

The command loads a valid Auto Demo project with a persisted source variant, resolves the requested MVP style list, generates one deterministic `baseline` batch summary, and prints machine-readable JSON with the generated id, display name, project/source-variant references, save status, batch metadata, validation errors, and non-secret warnings. Dry-run mode writes nothing and reports skipped variants. Save mode persists either one selected generated variant or all generated variants through `savePolishVariant()`, then reports saved `variants/<variant-id>.json` paths, skipped variants, final validation status, and next-step hints for editor or export workflows. The approved MVP style preset list is baseline-only: stable key `baseline`, display name `Baseline Polish`. `--styles` accepts a comma-separated list, which may contain only `baseline` once in the MVP; `--source-variant` defaults to `baseline-polish`. Saving a generated id that already exists in the project returns a structured `duplicate_variant_id` error, so callers that use a persisted source variant named `baseline-polish` should select a non-colliding source id when they intend to save a new generated `baseline-polish` variant. Unsupported style keys, duplicate style requests, invalid counts, missing source variants, invalid selected save ids, duplicate generated ids, non-JSON output, and malformed save arguments return structured errors. Local browser preview and save controls are available through `autodemo open`, and saved variants can be rendered through `autodemo export`.

Run the agent-facing workflow handoff with:

```bash
autodemo agent run --project <project-dir-or-manifest> --json
autodemo agent run --project <project-dir-or-manifest> --json --variant baseline-polish
autodemo agent run --project <project-dir-or-manifest> --json --generate baseline --source-variant source-baseline --save all
autodemo agent run --project <project-dir-or-manifest> --json --open-editor [--host 127.0.0.1] [--port 0] [--no-browser]
```

The command validates the project, selects an existing saved variant or saves a generated baseline variant, and prints one JSON summary with the project manifest path, selected variant id, variant artifact path, warnings, and next-step hints for agent logs. The WES-160 baseline-only MVP accepts `--save baseline-polish` or `--save all`; arbitrary generated variant ids are not part of this agent contract, and `--save` or `--source-variant` require `--generate baseline`. `--open-editor` starts the existing local editor, includes its URL in the same JSON output, and keeps the local editor server alive until the process is stopped; `--host` and `--port` override the bind address, while `--no-browser` is accepted as a no-op compatibility flag because the workflow does not auto-launch a browser. The WES-160 agent workflow requires JSON output and returns structured non-secret errors for unknown agent subcommands or arguments, missing projects, invalid projects, missing variants, unsupported generation requests, generation failures, and unavailable editor handoff. Successful handoffs exit `0`; expected validation, generation, or handoff failures exit `1`. The WES-169 MVP host decision treats a Codex production wrapper as acceptance-critical for the first demo. Claude wrapper parity is documented follow-up scope.

MCP is deferred from the MVP. The current accepted agent path is the CLI plus Codex wrapper: `autodemo agent run --project <project> --json` produces the non-secret JSON handoff that agents consume. Reopen MCP work after export and packaging evidence shows a need for persistent project/session discovery, editor handoff lifecycle control, artifact inspection across multiple outputs, repeated orchestration mistakes that typed tools would prevent, or a host requires MCP instead of shell commands. Future MCP work does not introduce a new project schema, hosted services, or final MP4 export behavior.

## Exporting MP4 Artifacts

Render a saved variant with:

```bash
autodemo export --project <project-dir-or-manifest> --json [--variant baseline-polish] [--preset mp4-demo]
```

The MVP export preset key is `mp4-demo`. It targets MP4 container, H.264 video,
`yuv420p`, 30 frames per second, and dimensions derived from
`variant.exportIntent.aspectRatio`: `1280x720` for `16:9`, `1024x768` for `4:3`,
and `720x1280` for `9:16`. The canonical validation fixture is
`fixtures/export/basic-saved-variant`, with expected artifacts
`exports/baseline-polish.mp4` and `exports/baseline-polish.render.json` for the
saved `baseline-polish` variant.

The command validates the project, defaults to `baseline-polish` when no
variant is supplied, invokes the local renderer, writes the MP4 under
`exports/`, writes adjacent render metadata, and prints a JSON result with the
manifest path, variant id, output path, summary path, preset settings, timing,
and sanitized renderer diagnostics.

Exporter failures report structured non-secret causes for invalid
project input, missing variant selection, missing media or metadata, unsupported
preset keys, unsupported non-MP4 export intent, and renderer failure. Non-MP4
formats, hosted rendering, package distribution, curated marketing samples, and
distinct high-fidelity production presets remain deferred. Exact browser preview
parity, overlay rendering for captions/callouts/cursor emphasis, audio tracks,
and demo-ready bundle validation remain follow-up work.

Open a validated project in the local browser editor with:

```bash
autodemo open --project <project-dir-or-manifest>
```

The command starts an HTTP server on `127.0.0.1` and an OS-assigned port by default, then prints the local URL. Use `--host` and `--port` to override the bind address; `--port 0` keeps OS port assignment. `--no-browser` is accepted as a no-op compatibility flag because the editor does not auto-launch a browser. The editor shell loads the project through the same validation path as `@auto-demo/project`, reports stable operator-readable validation errors, and shows saved/generated variants from the project manifest. Projects with no saved variants show a guidance message pointing back to `autodemo generate --project <project> --json --save all`. Saved variants open in an approximate browser preview with schema-backed local draft controls for trim, viewport, captions, callouts, cursor/click emphasis, and direct style fields. Save controls can update the selected variant or save the current draft as a named copy through `POST /api/variants`; successful saves write `variants/<variant-id>.json`, update `autodemo.project.json`, and refresh the browser from `/api/project`. Exact export parity, named preset picker UI, export rendering, browser auto-launch, autosave, and hosted sync remain deferred.

Other planned commands may exist before their behavior is implemented. Unimplemented commands fail clearly.

## Development

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run format:check
npm run validate
npm run test:smoke
```

Run `npm run setup:browser` before `npm run test:smoke` when Playwright's Chromium browser is not already installed.

Tests should verify behavior and user-facing outputs rather than implementation details.

## License

MIT
