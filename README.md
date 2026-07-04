# Auto Demo

Auto Demo is an open-source, agent-first demo recorder and editor for browser-first product walkthroughs.

The MVP focuses on web app demos. Agents such as Codex or Claude should be able to operate a browser, capture the walkthrough, produce a reusable Auto Demo project, generate polished variants, and export demos without forcing the user into a manual editor.

Auto Demo is Mac-first for the initial audience, but browser-first for the initial capture workflow. Native Mac capture can be added later through the capture adapter boundary.

## Status

This repository is in early capture-to-project setup. The package structure exists, and `autodemo capture` now launches a Playwright-controlled Chromium browser for viewport media recording, writes browser interaction metadata to JSONL, emits a temporary capture bundle manifest, and preserves non-secret failed/interrupted diagnostics when artifacts exist. `@auto-demo/project` can import a validated capture bundle into the first normalized Auto Demo project layout, validate/load project directories or manifests, save manifests atomically before revalidation, validate MVP polish variant definitions, and persist saved variants under `variants/`. `@auto-demo/polish` can generate a deterministic baseline variant from project event metadata and expose baseline-only headless dry-run batch summaries. Render and editor behavior are still planned work.

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

- `@auto-demo/cli`: `autodemo` command entrypoint, command routing, async `capture` lifecycle, capture bundle validation, and the baseline-only dry-run `generate` JSON contract.
- `@auto-demo/project`: Auto Demo schema v1 project manifest types, strict validation with accumulated structured errors, MVP polish variant definition and saved-file validation, capture-bundle import into the normalized project layout, and project load/save/variant persistence APIs.
- `@auto-demo/capture`: browser-first capture adapter contract, default Playwright viewport recorder, interaction metadata JSONL capture, temporary capture manifest APIs, capture output paths, and unsupported-backend fallback.
- `@auto-demo/polish`: deterministic baseline edit-decision generation from project event metadata, the baseline-only MVP style preset contract, and headless dry-run batch summaries.
- `@auto-demo/render`: export and render orchestration boundary.
- `@auto-demo/editor`: local browser editor package.
- `@auto-demo/agent`: agent-facing workflow helpers.

## CLI

```bash
autodemo init
autodemo capture
autodemo generate --project <project-dir-or-manifest> --dry-run --json
autodemo export
autodemo open
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

The project importer validates the source bundle, copies supported artifacts into project-owned paths, writes a sanitized capture summary to `metadata/capture.manifest.json`, and leaves the original capture bundle unchanged. Project package APIs can also validate or load a project directory or direct `autodemo.project.json` path, report missing manifests, invalid JSON, schema errors, and missing referenced files with structured non-secret errors, save formatted manifests atomically before revalidating the saved project, and persist generated polish variants as `variants/<variant-id>.json` files indexed by the project manifest.

Headless generation currently supports the first dry-run contract:

```bash
autodemo generate --project <project-dir-or-manifest> --dry-run --json [--styles baseline] [--source-variant baseline-polish]
```

The command loads a valid Auto Demo project with a persisted source variant, resolves the requested MVP style list, generates one deterministic `baseline` batch summary, and prints machine-readable JSON with the generated id, display name, project/source-variant references, dry-run save status, batch metadata, validation errors, and non-secret warnings. The approved MVP style preset list is baseline-only: stable key `baseline`, display name `Baseline Polish`. `--styles` accepts a comma-separated list, which may contain only `baseline` once in the MVP; `--source-variant` defaults to `baseline-polish`. Unsupported style keys, duplicate style requests, invalid counts, missing source variants, and save/output modes outside dry-run JSON return structured errors. Selected/all save modes, run summary files, rendering, exports, and additional themed presets remain planned follow-up work.

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
