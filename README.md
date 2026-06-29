# Auto Demo

Auto Demo is an open-source, agent-first demo recorder and editor for browser-first product walkthroughs.

The MVP focuses on web app demos. Agents such as Codex or Claude should be able to operate a browser, capture the walkthrough, produce a reusable Auto Demo project, generate polished variants, and export demos without forcing the user into a manual editor.

Auto Demo is Mac-first for the initial audience, but browser-first for the initial capture workflow. Native Mac capture can be added later through the capture adapter boundary.

## Status

This repository is in early capture-runtime setup. The package structure exists, and `autodemo capture` now launches a Playwright-controlled Chromium browser for viewport media recording and writes browser interaction metadata to JSONL. Durable manifests, polish, render, and editor behavior are still planned work.

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

- `@auto-demo/cli`: `autodemo` command entrypoint, command routing, and the async `capture` CLI contract.
- `@auto-demo/project`: Auto Demo project schema, path conventions, validation, and load/save APIs.
- `@auto-demo/capture`: browser-first capture adapter contract, default Playwright viewport recorder, interaction metadata JSONL capture, capture output paths, and unsupported-backend fallback.
- `@auto-demo/polish`: edit-decision generation boundary.
- `@auto-demo/render`: export and render orchestration boundary.
- `@auto-demo/editor`: local browser editor package.
- `@auto-demo/agent`: agent-facing workflow helpers.

## CLI

```bash
autodemo init
autodemo capture
autodemo generate
autodemo export
autodemo open
autodemo validate
```

`autodemo capture` is the first partially implemented command:

```bash
autodemo capture --url <url> --out <capture-dir> [--viewport <width>x<height>] [--] [walkthrough command...]
```

The CLI validates `--url`, `--out`, optional `--viewport`, and an optional child command after `--`. The default viewport is `1280x720`. The default browser backend uses Playwright's bundled Chromium and records viewport media without OS screen-recording permissions.

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
