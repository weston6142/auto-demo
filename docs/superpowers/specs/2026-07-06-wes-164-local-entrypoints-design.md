# WES-164 Local Entrypoints Design

Date: 2026-07-06

## Linear Issue

- Issue: WES-164, "Package CLI and browser editor entrypoints for local installation"
- Project: Auto Demo Balanced MVP
- Milestone: Export And Packaging

## Context

WES-168 selected a clean local checkout run path as the MVP packaging target.
The repository already builds an npm workspace and exposes the logical
`autodemo` command from `@auto-demo/cli`, but the current documented invocation
still requires the workspace-scoped fallback:

```bash
npm --workspace @auto-demo/cli run autodemo -- <subcommand...>
```

That fallback works, but it is not the intended operator or agent contract for a
clean checkout. WES-164 should finish the local packaging surface by making the
repo root own the command a contributor or agent runs after install/build.

## Goals

- Add a repo-root `npm run autodemo -- <subcommand...>` wrapper that executes the
  built CLI without relying on a globally installed `autodemo` package.
- Keep the existing workspace-scoped fallback working for local development and
  as a diagnostic escape hatch.
- Document the clean-checkout setup and current command surface for CLI,
  headless generation, local browser editor, agent handoff, and export.
- Make missing local prerequisites visible before deep workflow execution where
  the repo already has enough information to check them.
- Validate the wrapper and docs through behavior-oriented tests that exercise
  public command output rather than private script internals.

## Non-Goals

- Registry publication, Homebrew, native installers, bundled tarballs, or any
  standalone distribution artifact.
- A separate browser editor executable. The MVP editor entrypoint remains
  `autodemo open`.
- Replacing the WES-160 agent handoff contract. Agent wrappers continue to call
  the same CLI surface through the repo-root npm script.
- End-to-end demo readiness validation. WES-165 owns the full clean-checkout
  validation flow after WES-164 provides the local entrypoints.

## Design Options

### Option A: Root npm Script To Built CLI

Add a root `autodemo` package script that runs `node packages/cli/dist/index.js`.
The root script becomes the documented contract, while package-local tests prove
it reaches the built CLI help and key async command surfaces.

Pros:

- Matches the WES-168 local-only decision.
- Keeps all behavior in the existing CLI package.
- Avoids public-registry resolution pitfalls from `npm exec autodemo`.
- Is simple for agents: `npm run autodemo -- export --project ... --json`.

Cons:

- Requires `npm run build` before use.
- Still assumes the contributor is running from a repository checkout.

### Option B: Root npm Script Delegates To Workspace Script

Add a root script that runs
`npm --workspace @auto-demo/cli run autodemo -- <subcommand...>`.

Pros:

- Reuses the existing package script name.
- Slightly less direct coupling to the built file path.

Cons:

- Keeps the awkward workspace indirection inside the official wrapper.
- Makes argument forwarding harder to reason about in tests.
- Still hides the fact that the executable is the built CLI.

### Option C: Local Global Link Or Packed Artifact

Document `npm link`, `npm pack`, or a local installable artifact.

Pros:

- Looks closer to eventual package installation.

Cons:

- Conflicts with WES-168 deferrals.
- Broadens the task into package publishability and workspace dependency
  packaging.
- Does not help WES-165 validate the selected clean-checkout path.

## Selected Design

Choose Option A. Add a root script:

```json
"autodemo": "node packages/cli/dist/index.js"
```

The supported clean-checkout flow becomes:

```bash
npm install
npm run build
npm run setup:browser
npm run autodemo -- <subcommand...>
```

`npm run setup:browser` remains required for capture and browser smoke tests.
`ffmpeg` remains required for real MP4 export. The wrapper itself should not
attempt to install either prerequisite.

## Command Surface

The repo-root wrapper must route to the same logical command surface already
owned by `@auto-demo/cli`:

- `capture`
- `generate`
- `open`
- `agent run`
- `export`
- `validate`

The root README and `packages/cli/README.md` should describe
`npm run autodemo -- <subcommand...>` as the current clean-checkout invocation
contract. The workspace-scoped fallback can remain documented briefly as a local
diagnostic fallback, but it should no longer be the primary command.

## Failure Behavior

The wrapper should fail early and plainly when the built CLI is missing because
`npm run build` has not been run. The underlying CLI and package workflows retain
their existing structured failures for invalid projects, unsupported command
arguments, missing variants, renderer failures, and editor project validation
errors.

The docs should name the known runtime prerequisites before deep workflow use:

- Node 22.x and npm 10.
- Playwright Chromium through `npm run setup:browser`.
- `ffmpeg` on `PATH` for real MP4 export.

## Testing Strategy

Tests should verify behavior through public outputs:

- The documented root invocation extracted from the README reaches CLI help and
  lists `capture`, `open`, and `export`.
- `npm run autodemo -- export --help` reaches export help from the built CLI.
- Documentation names the repo-root wrapper as the current contract and keeps
  the WES-168 deferrals visible.

Tests should avoid asserting private implementation details like the exact root
script command string. Run the focused CLI packaging docs test first, then
`npm run validate`.

## Project Map Updates

After implementation and verification, update
`docs/linear/auto-demo-project-structure.md` to record the spec, plan, root
wrapper behavior, validation evidence, and WES-165 readiness note. Completion of
WES-164 should make WES-165 the next Export And Packaging task.

## Spec Self-Review

- Placeholder scan: no TBD or TODO placeholders remain.
- Consistency: the selected design matches WES-168's local-only packaging target
  and preserves the WES-160 agent CLI contract.
- Scope: the task is limited to repo-root entrypoints, docs, and behavior tests;
  WES-165 still owns end-to-end demo readiness validation.
- Ambiguity: the command contract, prerequisites, deferrals, and test behavior
  are explicit.
