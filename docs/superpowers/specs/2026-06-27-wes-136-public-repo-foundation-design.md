# WES-136 Public Repo Foundation Design

Date: 2026-06-27

## Linear Issue

- Issue: WES-136, "Milestone 1: Public repo and project foundation"
- Project: Auto Demo Balanced MVP
- Milestone: Public Repo And Project Foundation
- Goal: Initialize Auto Demo as a public open-source project with license, README, contribution guidance, package layout, development scripts, and architecture skeleton.

## Context

Auto Demo is a Mac-first, browser-first demo recorder and editor. Most expected demos are web app demos, so the foundation should optimize for browser automation, browser capture metadata, project portability, and fast contributor iteration.

The repository should not start with a native Mac capture implementation. Native Mac capture remains important for later desktop or browser-chrome capture, but it should enter through a capture adapter boundary after the browser-first loop is proven.

## Recommended Foundation

Use an npm TypeScript workspace. npm is the default package manager because it is familiar, ships with Node, and creates the fewest setup assumptions for open-source contributors.

Use the MIT license.

The initial repository should establish package boundaries and development quality gates, not real product behavior. Placeholders should be explicit contracts, not fake working features.

## Repository Structure

The initial structure should be:

```text
.
├── .github/workflows/ci.yml
├── docs/
├── packages/
│   ├── agent/
│   ├── capture/
│   ├── cli/
│   ├── editor/
│   ├── polish/
│   ├── project/
│   └── render/
├── LICENSE
├── README.md
├── CONTRIBUTING.md
├── package.json
├── package-lock.json
├── tsconfig.base.json
├── eslint.config.js
└── prettier.config.js
```

Package responsibilities:

- `packages/cli`: `autodemo` command entrypoint and command routing.
- `packages/project`: Auto Demo project schema, path conventions, validation, and load/save APIs.
- `packages/capture`: capture adapter interface and browser-first capture contract.
- `packages/polish`: edit-decision generation boundary.
- `packages/render`: export/render orchestration boundary.
- `packages/editor`: local browser editor package placeholder.
- `packages/agent`: agent-facing wrappers or command helpers.

## Capture Architecture

The capture package should expose an adapter boundary from day one. The first adapter is browser-first and can later use Playwright, CDP, or a related browser automation path. The interface should leave room for a later Mac-native adapter backed by ScreenCaptureKit or another native helper.

The rest of the system should depend on capture outputs and project manifests, not on the concrete capture mechanism. This keeps future native capture from forcing changes in the CLI, project format, editor, polish engine, or render path.

WES-136 should define the contract shape only. It should not implement real browser capture or native Mac capture.

## Developer Experience

The repository should support these root commands:

- `npm install`: install workspace dependencies.
- `npm run build`: build all packages.
- `npm test`: run behavior-oriented tests across packages.
- `npm run lint`: run lint checks.
- `npm run typecheck`: run TypeScript checks.
- `npm run format`: apply formatting.
- `npm run format:check`: verify formatting.
- `npm run validate`: run the full local quality gate.

Initial tooling:

- TypeScript for all packages.
- npm workspaces for package orchestration.
- Vitest for tests.
- ESLint and Prettier for consistency.
- No Turborepo, Bun, pnpm, or native build system in this milestone.
- No frontend framework decision in this milestone unless a minimal editor package requires one. The editor can remain a package stub.

## Initial Package Contracts

`packages/project` should define the core project concepts:

- project root path
- manifest filename, `autodemo.project.json`
- project schema version
- basic manifest type
- validate/load/save API shape

Project validation should distinguish these cases:

- missing manifest
- invalid JSON
- unsupported project version
- structurally invalid manifest

`packages/capture` should define:

- `BrowserCaptureAdapter`
- `CaptureSession`
- `BrowserCaptureOptions`
- browser-first capture source metadata
- capture output shape that can become an Auto Demo project

The initial WES-136 placeholder contract was superseded by WES-143, which narrowed the public adapter surface to browser capture, added `DEFAULT_BROWSER_VIEWPORT`, `CAPTURE_MANIFEST_FILENAME`, `manifestPathForOutputDir()`, and `createUnsupportedBrowserCaptureAdapter()`, and deferred native capture to a later adapter.

`packages/cli` should expose the planned command surface:

- `autodemo init`
- `autodemo capture`
- `autodemo generate`
- `autodemo export`
- `autodemo open`
- `autodemo validate`

Commands that are not implemented should print a clear "not implemented yet" message and exit nonzero. `autodemo capture` now has an async argument-parsing and adapter-invocation contract, but the default browser backend still fails clearly until recording is implemented. Unknown commands should print help and exit nonzero.

`packages/polish`, `packages/render`, `packages/editor`, and `packages/agent` should start as minimal packages with public module boundaries and short README notes explaining their future role.

## Documentation

The README should cover:

- what Auto Demo is
- browser-first MVP direction
- Mac-first target audience
- quick start for contributors
- package map
- command surface
- development workflow
- project status and non-goals

`CONTRIBUTING.md` should cover:

- npm-based setup
- local validation commands
- behavior-oriented testing guidance
- issue/PR expectations
- project structure overview

The docs directory should retain:

- balanced MVP design spec
- Linear project map
- this WES-136 foundation design spec

## CI

Add minimal GitHub Actions CI as repository setup verification, not product completeness validation.

The workflow should run on pull requests and pushes to `main`:

```text
npm ci
npm run validate
```

Use a single Ubuntu runner and a single current Node LTS version. Do not add matrix builds, release jobs, browser downloads, coverage gates, or native Mac runners in this milestone.

## Error Handling

Foundation error handling should be predictable:

- CLI unknown commands print help and exit nonzero.
- Known but unimplemented commands print a clear message and exit nonzero.
- Project validation returns typed or documented errors.
- Package APIs should not throw ad hoc string errors.
- Error messages must avoid secrets and should include non-secret paths or command names when helpful.

## Testing Strategy

Tests should verify behavior and user-facing outputs, not implementation details.

Initial tests should cover:

- CLI help and unknown command behavior.
- CLI known-but-unimplemented command behavior.
- project manifest validation outcomes.
- package import/build boundaries.
- root `npm run validate` runs the expected checks.

## Out Of Scope

WES-136 should not include:

- real browser capture
- real Mac-native capture
- real rendering or export
- real browser editor UI
- MCP integration
- package publishing
- release automation
- multi-platform CI matrix
- native macOS CI runner

## Success Criteria

WES-136 is complete when:

- the repository has a public open-source foundation with MIT license, README, contributing guide, npm workspace config, package layout, and architecture skeleton;
- root npm scripts provide install, build, test, lint, typecheck, format, format check, and validate workflows;
- package boundaries exist for CLI, project, capture, polish, render, editor, and agent responsibilities;
- capture is designed around a browser-first adapter interface with room for later Mac-native capture;
- placeholder commands and APIs fail clearly when not implemented;
- minimal CI verifies clean install and `npm run validate`;
- tests focus on behavior rather than internal implementation details.
