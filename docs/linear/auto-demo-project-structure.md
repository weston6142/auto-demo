# Auto Demo Linear Project Map

Last updated: 2026-06-29

## Project

- Linear project: Auto Demo Balanced MVP
- Project ID: `4d54d7dd-094f-411b-96a2-0768ec5d7eb7`
- Project URL: https://linear.app/weston-bushyeager/project/auto-demo-balanced-mvp-d31ba2ab0940
- Current project state: Planned

## Local Context

- Current workspace: `/Users/weston.bushyeager/code/personal/auto-demo`
- Git repository: https://github.com/weston6142/auto-demo
- Primary branch: `develop`
- Product design spec: `docs/superpowers/specs/2026-06-27-auto-demo-balanced-mvp-design.md`
- WES-136 foundation design spec: `docs/superpowers/specs/2026-06-27-wes-136-public-repo-foundation-design.md`
- WES-135 capture backend research: `docs/research/2026-06-27-capture-backend-research.md`
- WES-144 capture runtime design spec: `docs/superpowers/specs/2026-06-28-wes-144-capture-runtime-design.md`
- WES-143 implementation plan: `docs/superpowers/plans/2026-06-28-wes-143-browser-capture-adapter-cli-contract-plan.md`
- Current Capture Runtime baseline: `packages/cli/src/index.ts` owns capture lifecycle orchestration; `packages/capture/src/index.ts` exposes the default Playwright browser adapter plus unsupported fallback behavior. The runtime writes viewport media, browser interaction metadata JSONL, temporary capture manifests, and stable failed/interrupted diagnostics.
- WES-147 capture bundle writer design spec: `docs/superpowers/specs/2026-06-29-wes-147-capture-bundle-writer-design.md`
- Linear sync gate design spec: `docs/superpowers/specs/2026-06-28-linear-sync-gate-design.md`
- Linear sync gate implementation plan: `docs/superpowers/plans/2026-06-28-linear-sync-gate-plan.md`

## Milestone Order

Milestone order is taken from the balanced MVP design spec because the Linear CLI milestone list currently returns the milestones alphabetically.

1. Public Repo And Project Foundation
2. Capture Runtime
3. Demo Project Format
4. Auto Polish Engine
5. Headless Variant Generation
6. Browser Editor
7. Agent Integrations
8. Export And Packaging

## Current Next-Task Selection Rule

Prefer the earliest milestone with incomplete issues. Within that milestone, prefer started issues, then unblocked design/spec issues, then implementation issues whose dependencies are satisfied. Current active local product task: WES-134.

## Issues By Milestone

### 1. Public Repo And Project Foundation

- WES-141: Document repo project structure and Linear map - Done - https://linear.app/weston-bushyeager/issue/WES-141/document-repo-project-structure-and-linear-map
- WES-136: Milestone 1: Public repo and project foundation - Done - https://linear.app/weston-bushyeager/issue/WES-136/milestone-1-public-repo-and-project-foundation

### 2. Capture Runtime

- WES-135: Milestone 2: Capture runtime tracker - Done - https://linear.app/weston-bushyeager/issue/WES-135/milestone-2-capture-runtime-tracker
- WES-144: Capture runtime design/spec - Done - https://linear.app/weston-bushyeager/issue/WES-144/capture-runtime-designspec
- WES-143: Browser capture adapter skeleton and CLI contract - Done - https://linear.app/weston-bushyeager/issue/WES-143/browser-capture-adapter-skeleton-and-cli-contract
- WES-142: Playwright viewport media recording - Done - https://linear.app/weston-bushyeager/issue/WES-142/playwright-viewport-media-recording
- WES-145: Browser interaction metadata capture - Done - https://linear.app/weston-bushyeager/issue/WES-145/browser-interaction-metadata-capture
- WES-147: Capture bundle writer and manifest - Done - https://linear.app/weston-bushyeager/issue/WES-147/capture-bundle-writer-and-manifest
- WES-146: Failure handling and capture validation tests - Done - https://linear.app/weston-bushyeager/issue/WES-146/failure-handling-and-capture-validation-tests

### 3. Demo Project Format

- WES-134: Milestone 3: Demo project format - Backlog - https://linear.app/weston-bushyeager/issue/WES-134/milestone-3-demo-project-format

### 4. Auto Polish Engine

- WES-133: Milestone 4: Auto polish engine - Backlog - https://linear.app/weston-bushyeager/issue/WES-133/milestone-4-auto-polish-engine

### 5. Headless Variant Generation

- WES-137: Milestone 5: Headless variant generation - Backlog - https://linear.app/weston-bushyeager/issue/WES-137/milestone-5-headless-variant-generation

### 6. Browser Editor

- WES-140: Milestone 6: Browser editor - Backlog - https://linear.app/weston-bushyeager/issue/WES-140/milestone-6-browser-editor

### 7. Agent Integrations

- WES-138: Milestone 7: Agent integrations - Backlog - https://linear.app/weston-bushyeager/issue/WES-138/milestone-7-agent-integrations

### 8. Export And Packaging

- WES-139: Milestone 8: Export and packaging - Backlog - https://linear.app/weston-bushyeager/issue/WES-139/milestone-8-export-and-packaging

## Investigation Notes

- Selected next task: WES-141, because the project map did not exist and this document is the local orientation layer for subsequent Linear work.
- WES-141 expected outcome is concrete: create and maintain this repo-local Markdown map with project URL, milestone order, issue grouping, status conventions, spec links, and update rules.
- 2026-06-27 recheck: Linear still shows WES-141 in Backlog, but this repo-local map now exists and contains the requested project URL, milestone order, issue grouping, status conventions, spec links, investigation notes, completion evidence, and update rules. Recommended next action is to add completion evidence to Linear and move WES-141 to Done before selecting WES-135 for the next product brainstorming cycle.
- WES-136 has been brainstormed into a foundation design spec. The approved direction is an npm TypeScript workspace, MIT license, browser-first capture adapter boundary, minimal package skeleton, behavior-oriented tests, and minimal GitHub Actions CI for setup validation.
- The current workspace is a Git repository on `develop` with the npm workspace foundation committed, including root docs, tooling config, and package directories for agent, capture, CLI, editor, polish, project, and render.
- 2026-06-27 next-task investigation: Linear shows WES-136 and WES-141 as Done; all remaining milestone issues are Backlog. WES-135 is the earliest incomplete milestone issue, so it is the selected next product task.
- WES-135 summary: implement CLI capture that records screen media and structured interaction metadata while an agent performs a walkthrough.
- WES-135 readiness: ready for brainstorming. The desired outcome is concrete enough for design, and the approved balanced MVP spec names the key constraints: browser-first capture, CLI/agent non-interactive operation, reusable project output, partial-artifact preservation on failures, and behavior-oriented tests. The main design decisions still to make are the first capture backend, event metadata model, project handoff boundary, and failure/cleanup behavior.
- WES-135 capture backend research saved on 2026-06-27. Recommendation: start with a Playwright-controlled browser capture adapter and first-class interaction metadata; defer native OS/window capture and Chrome extension capture to later adapters.
- 2026-06-27 scope correction: WES-135 was too large as a single implementation issue, so it is now a Capture Runtime milestone tracker with focused child issues. Next task is WES-144, which should produce the design/spec before implementation begins.
- Capture Runtime dependency order: WES-143 was blocked by WES-144; WES-142 and WES-145 were blocked by WES-143; WES-147 is blocked by WES-142 and WES-145; WES-146 is blocked by WES-142, WES-145, and WES-147.
- 2026-06-28 next-task investigation: Linear still shows WES-144 and all Capture Runtime child issues in Backlog. WES-144 remains the selected next task because it is the first unblocked child issue in the earliest incomplete milestone.
- WES-144 readiness: ready for brainstorming. Its scope is a design/spec for `autodemo capture`, capture adapter boundaries, temporary bundle layout, interaction event model, lifecycle/timestamp/artifact/failure rules, and explicit deferrals to Demo Project Format. The acceptance criteria are concrete and the work is small enough for one spec cycle.
- WES-144 recommended first implementation issue after design approval: WES-143, "Browser capture adapter skeleton and CLI contract", unless the design reveals a missing prerequisite.
- 2026-06-28 recheck: Linear still shows WES-144 and WES-143 as Backlog, but local repo evidence shows WES-144 has a completed design spec and WES-143 has implemented the browser capture adapter skeleton and CLI contract. Recommended immediate action is to add Linear completion evidence and move WES-144 and WES-143 to Done before starting WES-142.
- 2026-06-28 cleanup: completion evidence comments were added to WES-144 and WES-143 in Linear, both issues were moved to Done, and the next active Capture Runtime child is WES-142.
- 2026-06-28 WES-142 state review: WES-143 already implemented more than a thin skeleton. The CLI now parses `autodemo capture`, invokes the injected browser adapter, runs child-command or manual capture lifecycles, handles SIGINT, and stops sessions with `completed`, `failed`, or `interrupted`. Focused verification passed: `npm --workspace @auto-demo/capture test` and `npm --workspace @auto-demo/cli test`.
- WES-142 readiness: ready for brainstorming with narrowed scope. It should not redesign CLI lifecycle. Its expected outcome is concrete: add a real Playwright-backed browser capture adapter that launches bundled Chromium only, records viewport media to the capture output directory, stops deterministically through the existing session API, and reports media artifact path plus basic timing. Connecting to an existing browser, interaction metadata, durable manifest writing, and broad failure validation remain deferred to later Capture Runtime issues.
- WES-142 open design decisions: how to introduce Playwright as a package dependency; whether the default adapter should switch from unsupported to Playwright in this issue; where backend-specific code should live inside `packages/capture`; the minimal output shape needed for media path and timing before WES-147 writes the durable manifest; and how to test behavior without asserting private Playwright mechanics or requiring brittle real-browser tests for every case.
- 2026-06-28 sync-gate design: future `linear-next-task` runs should use a `pre-task` sync gate before issue selection, and Linear-backed finishing flows should use a blocking `completion-gate` before work is called done. The gate reconciles the active issue, project map, and nearby dependency issues so future tasks do not start from stale scope.
- 2026-06-28 pre-task sync: Linear shows WES-143 and WES-144 as Done, with WES-142, WES-145, WES-147, WES-146, and WES-135 still Backlog in Capture Runtime. Local code at that point confirmed the adapter remained unsupported while `packages/cli/src/index.ts` already owned capture lifecycle orchestration. WES-142 was the next-task pointer before local Playwright implementation.
- 2026-06-28 WES-142 implementation plan: Playwright becomes the default `autodemo capture` backend. WES-142 returns media path and timing from `session.stop()` but does not write the durable manifest; WES-147 later added manifest writing. WES-145 later added interaction metadata.
- 2026-06-28 pre-task sync: Linear still had WES-142 in Backlog, but local evidence showed WES-142 was implemented and merged in PR #2. A completion evidence comment was added to WES-142 and the issue was moved to Done. Active Capture Runtime issues are now WES-145, WES-147, WES-146, and WES-135.
- 2026-06-28 next-task investigation: WES-145 is the selected next product task because it is the earliest incomplete Capture Runtime child whose dependencies are satisfied by WES-142. WES-145 is ready for brainstorming. The expected outcome is concrete: capture timestamped browser interaction metadata in parallel with viewport media, including navigation/URL changes, viewport/page lifecycle timing, click/key/typing/wait markers, page/console errors, timestamp normalization, and sensitive typed-value handling according to the approved design.
- WES-145 design decisions for brainstorming: whether metadata is written as JSONL during capture or returned in memory until WES-147 writes the bundle; how to keep sensitive typed values redacted by default; how the Playwright adapter should observe clicks/keys/navigation without asserting private Playwright internals; whether child-command step markers need an explicit API now or can be deferred; and how much page/console error detail is non-secret enough for the first pass.
- 2026-06-29 WES-145 implementation: browser interaction metadata capture writes `metadata/events.jsonl` alongside Playwright viewport media, returns a metadata artifact path in `CaptureOutput`, redacts typed values by default with coarse classification, and preserves CLI lifecycle behavior. WES-147 later added durable manifest writing.
- 2026-06-29 pre-task sync from firstmate: WES-145 was stale in Linear, completion evidence was added, and WES-145 was moved to Done. WES-147 is the selected next Capture Runtime child because WES-142 and WES-145 are complete.
- 2026-06-29 WES-147 design: capture bundle writing remains package-owned in `@auto-demo/capture`; `capture.manifest.json` stores portable relative artifact paths, capture source, target URL, viewport, timing, status, adapter/tool versions, and artifact paths. `autodemo validate <capture-dir-or-manifest>` is the lightweight CLI check. This bundle is temporary Capture Runtime input for the later Demo Project Format milestone, not final Auto Demo project schema.
- 2026-06-29 WES-147 implementation: `@auto-demo/capture` now exports `writeCaptureManifest()`, `readCaptureManifest()`, and `validateCaptureBundle()`. The Playwright adapter writes `capture.manifest.json` after media and metadata artifacts are flushed, and `autodemo validate <capture-dir-or-manifest>` validates the temporary bundle.
- 2026-06-29 WES-146 implementation: failed and interrupted Playwright capture stops now write stable non-secret manifest diagnostics when artifacts exist, stop failures best-effort preserve a diagnostic bundle, and the CLI reports the manifest path when a started capture cannot stop cleanly.
- 2026-06-29 pre-task sync: Linear shows WES-135 and all Capture Runtime child issues WES-142, WES-143, WES-144, WES-145, WES-146, and WES-147 as Done. Capture Runtime is complete, so WES-134 is the next task in the earliest incomplete milestone, Demo Project Format.

## Temporary Capture Bundle

WES-147 owns the current Capture Runtime bundle:

```text
capture-dir/
  capture.manifest.json
  media/
    viewport.webm
  metadata/
    events.jsonl
```

`capture.manifest.json` uses schema version `1`, records `completed`, `failed`, or `interrupted` status, and stores artifact paths relative to the bundle root. Demo Project Format will later define the final project schema and conversion from this temporary bundle.

## Completion Evidence

- WES-136: Repository foundation initialized as an npm TypeScript workspace.
- GitHub repository: https://github.com/weston6142/auto-demo
- Primary/default branch: `develop`
- License: MIT.
- Package boundaries: CLI, project, capture, polish, render, editor, and agent.
- Capture direction: browser-first adapter contract with future Mac-native adapter room.
- Validation: `npm run validate --cache ./.npm-cache` passed locally.
- Security baseline: `npm audit --cache ./.npm-cache` reported 0 vulnerabilities.
- CI: `.github/workflows/ci.yml` runs `npm ci` and `npm run validate` on pull requests and pushes to `develop`; latest run passed on `develop`.
- Linear: evidence comment added and WES-136 moved to Done.
- WES-141: Repo-local project map exists at `docs/linear/auto-demo-project-structure.md` with project URL and ID, milestone order, issue grouping, selection rule, spec links, investigation notes, completion evidence, and update rules.
- Linear: evidence comment added and WES-141 moved to Done on 2026-06-27.
- WES-143: Browser capture adapter skeleton and CLI contract implemented with capture package contracts, `autodemo capture` argument validation, injected browser adapter invocation, default unsupported backend failure, and behavior-oriented tests.
- WES-144: Capture runtime design spec exists at `docs/superpowers/specs/2026-06-28-wes-144-capture-runtime-design.md`; it defines CLI lifecycle, adapter boundary, temporary bundle layout, event model, timestamps, artifact paths, partial-artifact rules, deferrals, and identifies WES-143 as the first implementation issue.
- Linear: evidence comments added and WES-144 and WES-143 moved to Done on 2026-06-28.
- WES-143 verification rechecked on 2026-06-28: capture package focused tests passed with 1 test; CLI focused tests passed with 14 tests. The remaining WES-142 gap is real Playwright media capture, not CLI orchestration.
- Linear sync gate design spec and implementation plan were created to keep Linear, the project map, and dependency issue scope synchronized before task selection and before completion claims.
- WES-142: Playwright viewport media recording implemented as the default CLI capture backend; smoke test verifies a non-empty viewport video file, and unit tests cover adapter start/stop behavior through fakes.
- Linear: evidence comment added and WES-142 moved to Done on 2026-06-28.
- WES-145 verification: `npm --workspace @auto-demo/capture test`, `npm --workspace @auto-demo/cli test`, `npm run validate`, and `npm --workspace @auto-demo/capture run test:smoke` passed locally on 2026-06-29.
- WES-147: Capture bundle manifest writing and validation merged in PR #4 (`c1c714e`). `@auto-demo/capture` now writes and validates `capture.manifest.json` with portable artifact paths, sanitized source and child-command fields, adapter/tool versions, status, timing, media, and metadata artifacts. `autodemo validate <capture-dir-or-manifest>` validates temporary capture bundles.
- WES-147 verification: local `npm --workspace @auto-demo/capture test`, `npm --workspace @auto-demo/cli test`, and `npm run validate` passed before no-mistakes. No-mistakes PR #4 passed review, test, document, lint, and GitHub CI `validate` before merge.
- WES-146: Capture failure hardening implemented for started captures. Non-completed stops write `failed` or `interrupted` manifests with stable non-secret diagnostics, diagnostic manifests are preserved best-effort after stop failures when artifacts exist, manifest diagnostics are sanitized, and CLI stop failures include the capture bundle path.
- WES-146 verification: local `npm --workspace @auto-demo/capture test`, `npm --workspace @auto-demo/cli test`, and `npm run validate` passed on 2026-06-29.
- WES-135: Capture Runtime tracker completed after all child issues WES-142, WES-143, WES-144, WES-145, WES-146, and WES-147 moved to Done.
- Linear: evidence comment added and WES-135 moved to Done on 2026-06-29.

## Update Rules

Update this document when:

- Linear issues in the Auto Demo Balanced MVP project are created, edited, completed, reprioritized, or materially investigated.
- Milestones are added, renamed, reordered, completed, or canceled.
- Local specs, plans, or architecture documents are added or superseded.
- Completion evidence is gathered for finished Linear issues.

Keep entries concise. This file should orient future work; Linear remains the source of truth for full issue descriptions, comments, and state transitions.
