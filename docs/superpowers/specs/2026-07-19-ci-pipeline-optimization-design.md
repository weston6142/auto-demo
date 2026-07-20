# CI Pipeline Optimization Design

## Context

The repository's single `validate` GitHub Actions job currently installs dependencies and Chromium, then runs the root `npm run validate` script. A representative successful run took 5 minutes 23 seconds. The validation command accounted for 4 minutes 36 seconds, including 114 TypeScript compiler invocations caused by recursive workspace lifecycle hooks.

The package-level `prebuild`, `pretypecheck`, and `pretest` scripts are useful when a developer runs one workspace in isolation, but npm also invokes them when the root command traverses every workspace. Dependency builds therefore repeat many times during build, typecheck, and test phases. Browser-backed tests are also mixed into the same workspace test commands as unit and documentation tests, so any failure reruns the entire pipeline.

## Goals

- Preserve or strengthen the current clean-checkout validation coverage.
- Build workspace dependencies once per CI job instead of recursively rebuilding them.
- Separate unit, browser, and documentation contracts so CI can schedule and rerun them independently.
- Keep one stable `CI / validate` required check on every pull-request head.
- Skip expensive browser and unit jobs for Markdown-only changes while still checking formatting and documentation contracts.
- Cancel superseded runs for the same pull request or branch.
- Retain actionable browser-test output as an artifact when the browser job fails.
- Preserve direct package development commands and avoid adding a task-runner dependency.

## Non-goals

- Reducing product test coverage.
- Adding a hosted build cache or new CI service.
- Changing application behavior or public product APIs.
- Hiding nondeterministic browser behavior with broad retries.
- Changing repository branch-protection settings as part of the code change.

## Considered Approaches

### 1. Repository-owned topological task runner (selected)

A small Node script reads the npm workspace manifests, validates their internal dependency graph, topologically orders the packages, and invokes a requested script with npm lifecycle hooks disabled. The root scripts use that runner to build once, typecheck once, and execute each test partition without triggering recursive `pre*` hooks.

This approach adds no dependency, preserves package-local lifecycle behavior, and is directly testable as a public command-line contract. It also minimizes migration risk because package compiler settings remain unchanged.

### 2. TypeScript project references

Project references and `tsc -b` would make TypeScript own the build graph and provide a strong long-term compilation model. Adopting them requires every package to become composite, introduces declaration/build-info considerations, and changes how tests and package-local commands resolve outputs. That is a larger migration than needed to fix the current CI duplication.

### 3. Third-party monorepo task runner

Tools such as Nx or Turborepo provide graph scheduling and caching. They add configuration, dependency, and cache-policy surface area to a small eight-package workspace. The repository can obtain the immediate timing improvements with a focused script and revisit remote caching only if build volume later warrants it.

## Build and Test Command Design

Create `scripts/workspace-task-runner.mjs` with two responsibilities:

1. Discover `packages/*/package.json`, map internal dependencies, and reject missing or cyclic internal workspace references.
2. Execute a requested script in dependency-first order using `npm run <task> --workspace <name> --if-present --ignore-scripts`.

Independent packages at the same dependency level may run concurrently, while dependent levels remain ordered. A non-zero child exit stops new work and makes the command fail.

Root commands become explicit about whether they need a build:

- `npm run build`: one topological workspace build.
- `npm run typecheck`: build once, then run workspace typechecks without lifecycle hooks.
- `npm test`: build once, run root Node tests, then run all workspace tests without lifecycle hooks.
- CI-only composition scripts reuse an already completed build rather than rebuilding before typecheck or tests.

Package test scripts are partitioned by observable runtime requirement:

- `test:unit`: tests that do not launch Chromium.
- `test:browser`: tests that launch a real Chromium process.
- `test:docs`: tests that validate repository documentation or wrapper contracts.

The existing `test` scripts remain the complete package suite for direct developer use. Partition membership is explicit so tests cannot silently move between CI categories through a broad glob.

## Workflow Design

The GitHub workflow keeps the `CI` workflow name and a final job named `validate`, preserving the existing `CI / validate` required-check identity.

The workflow contains these jobs:

1. `changes` checks out full history and classifies the exact diff as `docs-only` when every changed path is Markdown.
2. `static` installs dependencies and always checks lint and formatting. Build and typecheck run for non-docs changes.
3. `docs` installs dependencies, performs one build, and runs documentation contract tests.
4. `unit` runs only for non-docs changes, performs one build, and runs unit tests.
5. `browser` runs only for non-docs changes, installs Chromium, performs one build, and runs real-browser tests. Its combined test log and machine-readable Vitest report are uploaded on failure.
6. `validate` runs with `always()`, verifies that required jobs succeeded and that conditionally skipped jobs match the change classification, and fails closed for cancellation or unexpected skips.

Each job performs its own `npm ci`. The observed install cost is approximately four seconds and is outweighed by parallel execution and isolated reruns. Chromium is installed only in the browser job.

Workflow concurrency groups runs by pull-request number when available and otherwise by Git ref, with `cancel-in-progress: true`.

## Change Classification and Gate Safety

The change classifier is repository-owned and tested independently from YAML. It receives the base and head revisions, reads `git diff --name-only`, and emits GitHub step outputs. Empty or indeterminate diffs fail safe as code changes, which runs the complete pipeline.

Only `.md` files qualify for the reduced route. Workflow files, package manifests, lockfiles, scripts, configuration, fixtures, and source/tests always trigger the complete route.

The final gate accepts:

- `static`, `docs`, `unit`, and `browser` all successful for normal changes; or
- `static` and `docs` successful with `unit` and `browser` skipped for docs-only changes.

Any other result fails the stable required check.

## Browser Failure Diagnostics and Flake Handling

The browser job captures the complete browser test stream with pipe-failure preservation and asks Vitest for a machine-readable report. On failure, `actions/upload-artifact` publishes both outputs with a short retention window.

The previously observed download-policy test nondeterminism is handled as a separate TDD fix inside the same browser suite: first reproduce the inconsistent public outcome, then make the event observation deterministic, and retain a focused regression test. Retries are not used as the correctness mechanism.

## Testing Strategy

Behavior-oriented Node tests will cover:

- dependency-first workspace ordering;
- cycle and missing-workspace rejection;
- lifecycle-hook suppression in generated npm invocations;
- docs-only versus full change classification;
- final-gate acceptance and rejection for every allowed job-result combination;
- workflow structure retaining the stable `validate` job, concurrency cancellation, isolated Chromium installation, conditional expensive jobs, and failure artifact upload.

Existing package tests verify that partitioned commands still cover every current test file. The implementation will use red-green cycles for the task runner, classifier, gate, workflow contract, and flaky browser behavior.

Final verification consists of focused contract tests, each partition command, build, typecheck, lint, formatting, the complete `npm run validate`, and exact-head GitHub Actions on the new pull request. CI timing will be compared with the 5-minute-23-second baseline.

## Rollout and Compatibility

The change is confined to repository scripts, package script declarations, tests, and `.github/workflows/ci.yml`. It introduces no product runtime dependency. Direct package commands retain their current lifecycle hooks; root and CI commands use the optimized explicit graph runner.

If the required-check name is confirmed as `CI / validate`, no branch-protection update is needed. A workflow failure remains fail closed, and pushes to `develop` continue to run the complete path unless their diff is Markdown-only.
