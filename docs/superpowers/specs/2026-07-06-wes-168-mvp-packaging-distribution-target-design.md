# WES-168 MVP Packaging And Distribution Target Design

Date: 2026-07-06

## Linear Issue

- Issue: WES-168, "Open question: decide MVP packaging and distribution target"
- Project: Auto Demo Balanced MVP
- Milestone: Export And Packaging

## Context

Export and Packaging is the last incomplete milestone. WES-163 established the
first local MP4 export path, and WES-165 remains blocked by packaging because
the project still lacks one explicit MVP install and run contract.

Current repository evidence narrows the packaging decision:

- The root repository is a private npm workspace with `packageManager:
"npm@10"` and no published package workflow.
- `packages/cli/package.json` exposes the only executable entrypoint through the
  `autodemo` bin, while `packages/editor` is launched through `autodemo open`
  rather than a separate executable.
- The CLI package depends on private workspace packages pinned at `0.0.0`
  (`@auto-demo/agent`, `@auto-demo/capture`, `@auto-demo/editor`,
  `@auto-demo/polish`, `@auto-demo/project`, and `@auto-demo/render`), so a
  registry-published package or standalone tarball would require extra bundling
  or publishability work that does not exist yet.
- A repo-root `npm exec autodemo -- --help` currently fails by resolving
  `autodemo` from the public registry, which proves the local invocation surface
  is not yet packaged well enough for contributors or agents.
- A workspace-scoped execution path already exists:
  `npm --workspace @auto-demo/cli exec autodemo -- ...`. That is functional but
  too awkward to treat as the final MVP operator contract.
- The balanced MVP design is Mac-first, not multi-platform packaging first.
  Native desktop distribution, hosted deployment, and registry publication are
  already outside the MVP shape.
- Agent integrations already rely on the CLI plus Codex wrapper, so packaging
  must preserve a stable local command surface for `capture`, `generate`,
  `open`, `agent run`, and `export`.

## Decision Options

### Option A: Local-Only Clean Checkout Run Path

The MVP target is a clean local install and run path from a repository checkout,
with no published package or standalone installable artifact required. WES-164
would standardize repo-root setup and invocation commands, make missing runtime
prerequisites fail clearly, and document one supported environment.

Pros:

- Matches the current workspace/private-package topology.
- Keeps WES-164 focused on stable scripts, docs, and prerequisite checks instead
  of dependency bundling or release mechanics.
- Preserves the CLI plus Codex wrapper path accepted in WES-160 and WES-169.
- Gives WES-165 a repeatable clean-checkout validation flow.

Cons:

- Users must work from a clone instead of installing a published package.
- WES-164 still needs to add a friendlier repo-root command surface because the
  current workspace-scoped exec command is not acceptable UX.

### Option B: Hybrid Local Package Artifact

The MVP would require an installable local tarball or similar package artifact,
but still defer registry publication.

Pros:

- Produces a more packaging-like deliverable than a repo checkout alone.
- Reduces the chance that local scripts accidentally depend on undeclared
  workspace behavior.

Cons:

- The CLI package currently depends on multiple private `0.0.0` workspace
  packages, so a real local artifact would force bundling, packaging of
  transitive workspace dependencies, or a broader publishability refactor.
- The editor is a CLI-launched workflow, not a separately packaged app, so a
  local artifact target still leaves unresolved questions about fixture assets,
  build outputs, and repo-relative assumptions.
- This broadens WES-164 substantially without adding MVP product evidence that
  the extra artifact is needed.

### Option C: Published Package Or Registry Distribution

The MVP would require publishing installable package artifacts to a registry or
other distribution channel.

Pros:

- Clearest eventual user-install story.
- Most closely resembles long-term distribution.

Cons:

- Conflicts with the current private-workspace topology and missing versioning,
  release, and credential workflows.
- Pulls registry credentials, release automation, and support expectations into
  scope before the project has validated its local demo loop.
- Adds substantial non-product work that the balanced MVP design explicitly
  deprioritizes.

## Selected Decision

Choose Option A: **the MVP packaging target is a clean local checkout run path
only**.

More specifically:

- Supported runtime environment: macOS, current repo-supported Node 22.x, npm
  10, Playwright Chromium installed through `npm run setup:browser`, and
  `ffmpeg` available on `PATH`.
- Required setup path: clone the repository, run `npm install`, run
  `npm run build`, run `npm run setup:browser`, and use a repo-root validation
  or help command before deep workflow execution.
- Required execution surface: for WES-168 documentation, the supported
  clean-checkout command is
  `npm --workspace @auto-demo/cli exec autodemo -- <subcommand...>` after the
  setup path above. WES-164 must later add and document one repo-root wrapper,
  with `npm run autodemo -- <subcommand...>` as the intended contract, without
  depending on a globally published package.
- Accepted runnable artifact: the checked-out repository plus built workspace
  outputs and local prerequisites. A tarball, native app, Homebrew formula, or
  registry-published package is not part of the MVP definition of done.
- WES-165 should validate the clean-checkout path, not a global installation or
  publish flow.

## Rationale

This decision keeps the milestone aligned with the current product state rather
than inventing distribution work for its own sake. The repo already proves the
CLI-first workflow, saved variants, local editor, and export path inside one
workspace. What it does not yet prove is that a new contributor or agent can
start from a clean checkout and reliably run that workflow without reverse
engineering internal package commands.

Option A is therefore the narrowest decision that unblocks both downstream
issues:

- WES-164 can implement one clear repo-root setup and execution path, plus
  prerequisite checks for Playwright Chromium and `ffmpeg`.
- WES-165 can validate that path end-to-end on the canonical saved-variant
  fixture without layering registry publication or artifact bundling concerns on
  top.

Option B sounds attractive, but the current private workspace dependency graph
would turn "just pack it locally" into a real packaging architecture problem.
Option C is even broader and would consume effort on publishability instead of
the product loop the MVP is supposed to prove.

## Required Updates

- Document the packaging target in the root `README.md`.
- Create `packages/cli/README.md` as the package-local home for the clean
  checkout packaging contract and repo-root invocation expectations.
- Add a behavior-oriented docs test in `packages/cli/src/packaging-docs.test.ts`
  so the public packaging target, environment, commands, and deferrals remain
  visible.
- Update `packages/cli/package.json` so the docs test runs with the existing CLI
  test suite.
- Update `docs/linear/auto-demo-project-structure.md` with WES-168 spec/plan
  links, selection notes, and the resulting next-task pointer to WES-164.
- After local validation, add concise readiness notes to WES-164 and WES-165.

## Fallback And Failure Expectations

WES-164 should treat the following as acceptance-critical failure modes for the
selected target:

- missing Node or unsupported npm/runtime versions;
- Playwright Chromium not installed through `npm run setup:browser`;
- `ffmpeg` missing from `PATH`;
- repo-root install/build commands that succeed only because of undeclared local
  state;
- CLI/editor/export entrypoints that require contributors to know workspace-only
  internals.

The packaging flow should fail early with concise, non-secret messages that name
the missing prerequisite or incorrect command surface.

## Deferrals

- Registry publication or package-distribution credentials.
- Homebrew, native app, or installer artifacts.
- Bundled standalone tarballs that hide the current workspace dependency graph.
- Hosted deployment or managed updates.
- Cross-platform packaging commitments beyond the current Mac-first MVP path.

## Testing Strategy

This is a decision issue, so tests should treat public documentation as the
behavior. They should verify that the root README and CLI package README state:

- the local-only packaging target;
- the supported environment (`macOS`, Node 22.x, npm 10, Playwright Chromium,
  and `ffmpeg`);
- the required setup commands (`npm install`, `npm run build`,
  `npm run setup:browser`);
- the current workspace-scoped execution contract for the existing `autodemo`
  subcommands, plus the future WES-164 repo-root wrapper note; and
- the explicit deferral of registry publication and standalone distribution
  artifacts.

Tests should not assert exact heading order or prose. Run the focused CLI docs
test first, then `npm run validate`.

## Spec Self-Review

- Placeholder scan: no TBD or TODO markers remain.
- Consistency: the decision matches the private workspace topology, the current
  CLI/editor/export architecture, and the Mac-first MVP boundaries already in
  repo docs.
- Scope: this defines the target only. WES-164 still owns implementing the
  repo-root command surface and prerequisite checks, and WES-165 still owns the
  end-to-end validation evidence.
- Ambiguity: the supported environment, required commands, accepted artifact
  type, downstream expectations, and deferrals are explicit.
