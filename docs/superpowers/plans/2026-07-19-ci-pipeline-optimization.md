# CI Pipeline Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute this plan inline. Apply `superpowers:test-driven-development` to script behavior and `superpowers:systematic-debugging` to the flaky browser test.

**Goal:** Reduce pull-request CI wall time while preserving the stable `CI / validate` gate and all existing validation coverage.

**Architecture:** A repository-owned Node runner executes workspace tasks in dependency order with npm lifecycle hooks disabled, and explicit test partitions separate unit, documentation, and real-browser coverage. GitHub Actions classifies Markdown-only diffs, runs independent jobs in parallel, uploads browser failure evidence, and closes through an always-running fail-closed `validate` aggregator.

**Tech Stack:** Node.js 22, npm workspaces, TypeScript, Vitest, Playwright, GitHub Actions.

---

## File Map

- Create `scripts/workspace-task-runner.mjs`: discover the workspace graph and execute one package task dependency-first without implicit lifecycle hooks.
- Create `scripts/workspace-task-runner.test.mjs`: black-box and pure-function coverage for graph ordering, invalid graphs, and generated npm invocation behavior.
- Create `scripts/ci-policy.mjs`: classify changed paths and validate final job results.
- Create `scripts/ci-policy.test.mjs`: public policy coverage for full/docs-only routes and fail-closed aggregation.
- Create `scripts/ci-workflow.test.mjs`: repository contract test for triggers, concurrency, partitioned jobs, Chromium isolation, failure artifacts, and the stable `validate` job.
- Modify `package.json`: expose optimized root and CI composition commands and include the new Node tests in the root test contract.
- Modify `packages/agent/package.json`: declare explicit unit, docs, and browser partitions.
- Modify `packages/browser-profile/package.json`: declare its unit partition.
- Modify `packages/capture/package.json`: declare explicit unit and browser partitions.
- Modify `packages/cli/package.json`: declare explicit unit, docs, and browser partitions.
- Modify `packages/editor/package.json`: declare its unit partition.
- Modify `packages/polish/package.json`: declare its unit partition.
- Modify `packages/project/package.json`: declare its unit partition.
- Modify `packages/render/package.json`: declare unit and docs partitions.
- Modify `.github/workflows/ci.yml`: implement classification, parallel validation jobs, browser artifacts, concurrency, and stable aggregation.
- Modify `packages/agent/src/playwrightPolicyDiscoveryRehearsal.test.ts`: remove scheduler-dependent delay from the download policy fixture while retaining the public `download_blocked` assertion.

### Task 1: Topological workspace task runner

**Files:**

- Create: `scripts/workspace-task-runner.mjs`
- Create: `scripts/workspace-task-runner.test.mjs`

- [ ] **Step 1: Write failing graph and command-contract tests**

Add Node tests that import `buildWorkspaceLevels()` and `workspaceTaskCommand()` and assert:

```js
assert.deepEqual(
  buildWorkspaceLevels([
    { name: "@auto-demo/cli", internalDependencies: ["@auto-demo/agent"] },
    { name: "@auto-demo/agent", internalDependencies: ["@auto-demo/project"] },
    { name: "@auto-demo/project", internalDependencies: [] },
  ]),
  [["@auto-demo/project"], ["@auto-demo/agent"], ["@auto-demo/cli"]],
);
assert.deepEqual(workspaceTaskCommand("build", "@auto-demo/project", ["--reporter=junit"]), {
  command: "npm",
  args: [
    "run",
    "build",
    "--workspace",
    "@auto-demo/project",
    "--if-present",
    "--ignore-scripts",
    "--",
    "--reporter=junit",
  ],
});
```

Add cases for a dependency cycle, a missing internal dependency, deterministic alphabetical ordering within a level, optional task-argument passthrough, and propagation of a child process failure.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test scripts/workspace-task-runner.test.mjs`

Expected: FAIL because `scripts/workspace-task-runner.mjs` does not exist.

- [ ] **Step 3: Implement the graph runner**

Implement named exports:

```js
export function discoverWorkspaces(repositoryRoot) {}
export function buildWorkspaceLevels(workspaces) {}
export function workspaceTaskCommand(task, workspaceName, taskArguments = []) {}
export async function runWorkspaceTask({ repositoryRoot, task, taskArguments, runCommand }) {}
```

The CLI accepts a task argument plus optional task arguments after `--`, discovers `packages/*/package.json`, and executes each dependency level with `Promise.all`. It spawns npm with `stdio: "inherit"`, `cwd` set to the repository root, and no shell. It rejects malformed manifests, duplicate names, missing internal references, cycles, empty task names, and non-zero child exits with concise non-secret messages.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test scripts/workspace-task-runner.test.mjs`

Expected: all task-runner tests pass.

- [ ] **Step 5: Commit the runner**

```bash
git add scripts/workspace-task-runner.mjs scripts/workspace-task-runner.test.mjs
git commit -m "build: add dependency-aware workspace runner"
```

### Task 2: Explicit test partitions and optimized root commands

**Files:**

- Modify: `package.json`
- Modify: `packages/agent/package.json`
- Modify: `packages/browser-profile/package.json`
- Modify: `packages/capture/package.json`
- Modify: `packages/cli/package.json`
- Modify: `packages/editor/package.json`
- Modify: `packages/polish/package.json`
- Modify: `packages/project/package.json`
- Modify: `packages/render/package.json`
- Create: `scripts/ci-test-partitions.test.mjs`

- [ ] **Step 1: Write a failing partition-coverage test**

For every package, parse its `test` command into `.test.ts` paths and assert that the union of `test:unit`, `test:docs`, and `test:browser` equals the full set exactly, with no overlap. Also assert that each real-browser file is in `test:browser`:

```js
const browserFiles = new Set([
  "src/playwrightDiscoveryObservation.test.ts",
  "src/playwrightDiscoveryRehearsal.test.ts",
  "src/playwrightDiscoveryPolicyGuard.test.ts",
  "src/playwrightPolicyDiscoveryRehearsal.test.ts",
  "src/playwrightDiscoveryReplay.test.ts",
  "src/playwrightMetadataRecorder.test.ts",
  "src/playwrightExecutionController.test.ts",
  "src/agenticDiscoveryAcceptance.test.ts",
]);
```

Documentation partitions must contain `wrapper-docs.test.ts`, `packaging-docs.test.ts`, and `render-docs.test.ts`. Packages without a category omit that script.

- [ ] **Step 2: Run the partition test and verify RED**

Run: `node --test scripts/ci-test-partitions.test.mjs`

Expected: FAIL because partition scripts do not exist.

- [ ] **Step 3: Add package partition scripts**

Keep each current `test` command unchanged. Add explicit `test:unit`, `test:docs`, and `test:browser` commands using the same Vitest invocation and exact file lists. Unit lists exclude every docs and browser file.

- [ ] **Step 4: Replace recursive root traversal with explicit graph commands**

Set root scripts to this composition:

```json
{
  "build": "node scripts/workspace-task-runner.mjs build",
  "typecheck": "npm run build && npm run typecheck:ci",
  "typecheck:ci": "node scripts/workspace-task-runner.mjs typecheck",
  "test": "npm run build && npm run test:ci",
  "test:ci": "node --test scripts/*.test.mjs && node scripts/workspace-task-runner.mjs test",
  "test:unit:ci": "node --test scripts/*.test.mjs && node scripts/workspace-task-runner.mjs test:unit",
  "test:docs:ci": "node scripts/workspace-task-runner.mjs test:docs",
  "test:browser:ci": "node scripts/workspace-task-runner.mjs test:browser",
  "validate": "npm run build && npm run typecheck:ci && npm run lint && npm run test:ci && npm run format:check"
}
```

The `test:ci` script includes root Node tests once and uses workspace `test` commands with lifecycle hooks suppressed by the runner.

- [ ] **Step 5: Verify partition coverage and commands**

Run:

```bash
node --test scripts/ci-test-partitions.test.mjs
npm run build
npm run typecheck:ci
npm run test:unit:ci
npm run test:docs:ci
npm run test:browser:ci
```

Expected: every command exits 0; the partition test proves complete, disjoint coverage.

- [ ] **Step 6: Commit scripts and manifests**

```bash
git add package.json packages/*/package.json scripts/ci-test-partitions.test.mjs
git commit -m "test: partition CI suites without recursive builds"
```

### Task 3: Change classification and fail-closed final gate

**Files:**

- Create: `scripts/ci-policy.mjs`
- Create: `scripts/ci-policy.test.mjs`

- [ ] **Step 1: Write failing public policy tests**

Test these path classifications:

```js
assert.equal(classifyChangedPaths(["README.md", "docs/guide.md"]), "docs-only");
assert.equal(classifyChangedPaths(["README.md", "package.json"]), "full");
assert.equal(classifyChangedPaths([]), "full");
```

Test final-gate outcomes:

```js
assert.equal(
  validateCiResults({
    route: "full",
    static: "success",
    docs: "success",
    unit: "success",
    browser: "success",
  }).ok,
  true,
);
assert.equal(
  validateCiResults({
    route: "docs-only",
    static: "success",
    docs: "success",
    unit: "skipped",
    browser: "skipped",
  }).ok,
  true,
);
assert.equal(
  validateCiResults({
    route: "docs-only",
    static: "success",
    docs: "failure",
    unit: "skipped",
    browser: "skipped",
  }).ok,
  false,
);
assert.equal(
  validateCiResults({
    route: "full",
    static: "success",
    docs: "success",
    unit: "skipped",
    browser: "success",
  }).ok,
  false,
);
```

Cover failure, cancelled, skipped, and unknown values for every required job.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test scripts/ci-policy.test.mjs`

Expected: FAIL because `scripts/ci-policy.mjs` does not exist.

- [ ] **Step 3: Implement classifier and gate CLI**

Export `classifyChangedPaths(paths)` and `validateCiResults(results)`. Add CLI modes:

```text
node scripts/ci-policy.mjs classify <base-sha> <head-sha>
node scripts/ci-policy.mjs gate <route> <static> <docs> <unit> <browser>
```

`classify` invokes `git diff --name-only --diff-filter=ACMR <base> <head>`, writes `route=docs-only` or `route=full` to `$GITHUB_OUTPUT`, and defaults to `full` on empty or invalid input. `gate` exits non-zero with a concise list of unacceptable results.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test scripts/ci-policy.test.mjs`

Expected: all classifier and gate tests pass.

- [ ] **Step 5: Commit CI policy**

```bash
git add scripts/ci-policy.mjs scripts/ci-policy.test.mjs
git commit -m "ci: add docs routing and fail-closed gate policy"
```

### Task 4: Parallel GitHub Actions workflow

**Files:**

- Modify: `.github/workflows/ci.yml`
- Create: `scripts/ci-workflow.test.mjs`

- [ ] **Step 1: Write a failing workflow contract test**

Read `.github/workflows/ci.yml` and verify externally important behavior:

- pull requests and pushes to `develop` remain triggers;
- concurrency contains `cancel-in-progress: true` and groups by PR number or ref;
- jobs include `changes`, `static`, `docs`, `unit`, `browser`, and `validate`;
- only `browser` installs Chromium;
- `unit` and `browser` are conditional on the full route;
- browser execution preserves pipeline exit status while writing `artifacts/browser-tests.log`;
- a Vitest report and browser log are uploaded with `actions/upload-artifact@v4` on failure;
- final `validate` has `if: always()`, depends on all validation jobs, and invokes `ci-policy.mjs gate`.

- [ ] **Step 2: Run the workflow contract and verify RED**

Run: `node --test scripts/ci-workflow.test.mjs`

Expected: FAIL against the current single-job workflow.

- [ ] **Step 3: Implement the partitioned workflow**

Use `actions/checkout@v7` and `actions/setup-node@v6` with Node 22 and npm caching. These action versions run on the current Node action runtime while the repository itself remains tested on Node 22. `changes` checks out with `fetch-depth: 0` and selects the comparison base from `github.event.pull_request.base.sha` or `github.event.before`.

All validation jobs run `npm ci`. `static` always runs lint and format, and only builds/typechecks on the full route. `docs` builds once and runs `npm run test:docs:ci`. `unit` builds once and runs `npm run test:unit:ci`. `browser` installs Chromium and builds once, then invokes the `agent`, `capture`, and `cli` browser partitions explicitly with lifecycle hooks disabled. Each invocation writes a uniquely named JUnit file under the repository-root `artifacts/` directory, while the combined command stream is captured through `tee` with `pipefail`. Upload `artifacts/` only when the browser step fails.

Keep the aggregator job identifier `validate` and name `validate` so the required context remains `CI / validate`.

- [ ] **Step 4: Verify workflow behavior**

Run:

```bash
node --test scripts/ci-workflow.test.mjs scripts/ci-policy.test.mjs
npx prettier --check .github/workflows/ci.yml
```

Expected: all tests and formatting pass.

- [ ] **Step 5: Commit workflow**

```bash
git add .github/workflows/ci.yml scripts/ci-workflow.test.mjs
git commit -m "ci: parallelize validation behind a stable gate"
```

### Task 5: Remove scheduler-dependent browser-test flake

**Files:**

- Modify: `packages/agent/src/playwrightPolicyDiscoveryRehearsal.test.ts`

- [ ] **Step 1: Apply systematic debugging to the recorded failure**

Confirm the test's public purpose is download blocking, while its fixture currently delays the synthetic anchor click by 125 milliseconds inside a 200-millisecond quiet window. Record that CPU scheduling can consume the margin without changing production behavior, yielding `action_no_observable_effect`.

- [ ] **Step 2: Establish focused stress evidence**

Run the existing file repeatedly before modification:

```bash
for run in {1..20}; do npm --workspace @auto-demo/agent exec -- vitest run src/playwrightPolicyDiscoveryRehearsal.test.ts || exit 1; done
```

Expected: preserve the exact run count and any observed failure; the prior exact-head CI failure remains the recorded reproduction if local runs do not fail.

- [ ] **Step 3: Make the fixture deterministic without weakening its assertion**

Replace the timer-based fixture handler:

```html
<button
  onclick="const link = document.createElement('a'); link.href = '/download'; link.download = ''; link.click()"
>
  Download report
</button>
```

Keep the existing black-box assertion that the controller returns `attempt.status: "failed"`, outcome code `download_blocked`, and no private filename. Do not add retries or change product policy code.

- [ ] **Step 4: Repeat focused stress verification**

Run the same test file 20 times.

Expected: 20 successful runs with the unchanged public outcome assertion.

- [ ] **Step 5: Commit the deterministic fixture**

```bash
git add packages/agent/src/playwrightPolicyDiscoveryRehearsal.test.ts
git commit -m "test: make download policy fixture deterministic"
```

### Task 6: Full verification, timing, and PR publication

**Files:**

- Include: `docs/superpowers/specs/2026-07-19-ci-pipeline-optimization-design.md`
- Include: `docs/superpowers/plans/2026-07-19-ci-pipeline-optimization.md`

- [ ] **Step 1: Run focused script and workflow contracts**

Run:

```bash
node --test scripts/workspace-task-runner.test.mjs scripts/ci-test-partitions.test.mjs scripts/ci-policy.test.mjs scripts/ci-workflow.test.mjs
```

Expected: every Node contract test passes.

- [ ] **Step 2: Run every CI partition**

Run:

```bash
npm run build
npm run typecheck:ci
npm run lint
npm run test:unit:ci
npm run test:docs:ci
npm run test:browser:ci
npm run format:check
```

Expected: all commands exit 0 and together cover every existing test file.

- [ ] **Step 3: Run the complete compatibility gate and capture timing**

Run:

```bash
/usr/bin/time -p npm run validate
```

Expected: build, typecheck, lint, all 685 or more tests, and formatting pass. Compare elapsed time and compiler invocation count with the 5-minute-23-second CI and 114-invocation baseline.

- [ ] **Step 4: Verify diff and commit documentation**

Run:

```bash
git diff --check
git status -sb
git diff --stat origin/develop...HEAD
```

Then stage the approved spec and plan explicitly and commit:

```bash
git add docs/superpowers/specs/2026-07-19-ci-pipeline-optimization-design.md docs/superpowers/plans/2026-07-19-ci-pipeline-optimization.md
git commit -m "docs: record CI optimization design"
```

- [ ] **Step 5: Push and open the PR**

Push `ci/pipeline-optimization` to `origin` and open a draft PR targeting `develop`. The PR body includes the 5m23s baseline, before/after compiler counts and local timing, exact validation commands, docs-only behavior, stable-gate compatibility, and no product security/access-control impact.

- [ ] **Step 6: Monitor exact-head GitHub checks**

Watch the PR's exact-head checks to completion. If CI fails, inspect only the failing partition, fix through TDD or systematic debugging, push, and repeat until `CI / validate` passes. Report per-job timing and the total wall-clock improvement without merging the PR.
