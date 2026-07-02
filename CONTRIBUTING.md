# Contributing

Auto Demo uses npm workspaces and TypeScript.

## Setup

```bash
npm install
npm run validate
```

For capture development or browser smoke tests, install Playwright's Chromium browser once:

```bash
npm run setup:browser
```

## Local Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run format:check
```

Run `npm run validate` before opening a pull request.

## Testing Guidance

Prefer behavior-oriented tests. Test what the command, package API, or user-facing workflow produces. Avoid tests that assert private implementation details.

## Project Structure

- `packages/cli`: command entrypoint and routing
- `packages/project`: schema v1 project manifest types, validation contracts, capture import, and project load/save helpers
- `packages/capture`: capture adapter contracts, Playwright viewport recording, and metadata JSONL capture
- `packages/polish`: edit-decision generation
- `packages/render`: render/export orchestration
- `packages/editor`: local browser editor
- `packages/agent`: agent workflow helpers
- `docs`: specs, plans, and Linear project mapping

## Pull Requests

Keep changes focused. Include tests for behavior changes and update docs when package contracts or commands change.
