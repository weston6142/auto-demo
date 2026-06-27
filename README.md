# Auto Demo

Auto Demo is an open-source, agent-first demo recorder and editor for browser-first product walkthroughs.

The MVP focuses on web app demos. Agents such as Codex or Claude should be able to operate a browser, capture the walkthrough, produce a reusable Auto Demo project, generate polished variants, and export demos without forcing the user into a manual editor.

Auto Demo is Mac-first for the initial audience, but browser-first for the initial capture workflow. Native Mac capture can be added later through the capture adapter boundary.

## Status

This repository is in foundation setup. The package structure and command contracts exist before real capture, polish, render, and editor behavior.

## Quick Start

```bash
npm install
npm run validate
```

## Packages

- `@auto-demo/cli`: `autodemo` command entrypoint and command routing.
- `@auto-demo/project`: Auto Demo project schema, path conventions, validation, and load/save APIs.
- `@auto-demo/capture`: browser-first capture adapter contract with room for native Mac capture later.
- `@auto-demo/polish`: edit-decision generation boundary.
- `@auto-demo/render`: export and render orchestration boundary.
- `@auto-demo/editor`: local browser editor package.
- `@auto-demo/agent`: agent-facing workflow helpers.

## Planned CLI

```bash
autodemo init
autodemo capture
autodemo generate
autodemo export
autodemo open
autodemo validate
```

Commands may exist before their behavior is implemented. Unimplemented commands fail clearly.

## Development

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run format:check
npm run validate
```

Tests should verify behavior and user-facing outputs rather than implementation details.

## License

MIT
