# WES-180 Capture-To-Project Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a successful WES-179 execution result into a new validated Auto Demo project with a saved baseline variant and structured editor/export next steps.

**Architecture:** Add a focused JSON-only `agent handoff` CLI adapter that validates successful execution evidence and required artifact files, delegates capture import and variant persistence to `@auto-demo/project`, and delegates initial baseline generation to `@auto-demo/polish`. Keep execute, editor, and export lifecycles separate so retries never repeat a successful recording or trigger long-lived/destructive side effects.

**Tech Stack:** TypeScript ESM, Node filesystem APIs, npm workspaces, Vitest, Playwright smoke tests, existing `@auto-demo/agent`, `@auto-demo/project`, and `@auto-demo/polish` APIs.

---

## Scope And File Map

- Create `packages/cli/src/agentHandoffCommand.ts`: parse handoff arguments, validate execution JSON and artifact presence, orchestrate import/generation, map safe errors, and serialize the success summary.
- Create `packages/cli/src/agentHandoffCommand.test.ts`: behavior-first command tests using real capture import/project persistence where practical and injected failure only for generation failure.
- Modify `packages/cli/src/index.ts`: route `agent handoff` and document its CLI help contract.
- Modify `packages/cli/src/agentExecuteCommand.smoke.test.ts`: continue the successful real Playwright execution through handoff and project load.
- Modify `packages/cli/package.json`: include the new focused test file in the package test script.
- Modify `README.md`, `packages/agent/README.md`, `packages/agent/skills/codex-auto-demo/SKILL.md`, `packages/agent/claude-wrapper-parity.md`, and relevant agent fixtures/tests: document the resumable two-command operator flow and WES-180 boundary completion.
- Modify `docs/linear/auto-demo-project-structure.md`: record plan, implementation, verification, PR, and completion-gate evidence.

Do not change capture/project/polish schemas, add overwrite behavior, start the editor, render an export, or touch the primary checkout.

### Task 1: Successful Handoff Command Core

**Files:**

- Create: `packages/cli/src/agentHandoffCommand.test.ts`
- Create: `packages/cli/src/agentHandoffCommand.ts`
- Modify: `packages/cli/package.json`

- [ ] **Step 1: Write the failing successful-handoff behavior test**

Build a real completed capture bundle fixture using public capture-manifest fields and write a successful execution wrapper whose `capture` object points to those files. Call the wished-for command API:

```ts
const result = await runAgentHandoffCommand(
  ["--execution", executionPath, "--project", projectDir, "--name", "Checkout Demo", "--json"],
  { now: () => new Date("2026-07-11T12:00:00.000Z") },
);

expect(result).toMatchObject({ exitCode: 0, stderr: "" });
expect(JSON.parse(result.stdout)).toMatchObject({
  ok: true,
  execution: { captureDir, manifestPath: captureManifestPath },
  project: { projectDir, name: "Checkout Demo" },
  variant: { id: "baseline-polish", path: "variants/baseline-polish.json" },
  nextSteps: {
    editor: {
      command: "npm",
      args: ["run", "autodemo", "--", "open", "--project", projectDir],
    },
    export: {
      command: "npm",
      args: [
        "run",
        "autodemo",
        "--",
        "export",
        "--project",
        projectDir,
        "--variant",
        "baseline-polish",
        "--json",
      ],
    },
  },
});

const loaded = await loadProject(projectDir);
expect(loaded.ok && loaded.manifest.variants.map((variant) => variant.id)).toEqual([
  "baseline-polish",
]);
expect(await readFile(join(projectDir, "variants", "baseline-polish.json"), "utf8")).toContain(
  '"id": "baseline-polish"',
);
expect(await readFile(executionPath, "utf8")).toBe(executionText);
```

The fixture event JSONL must contain public click/navigation metadata and no secrets so the existing deterministic baseline generator can succeed.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm exec vitest run packages/cli/src/agentHandoffCommand.test.ts
```

Expected: FAIL because `./agentHandoffCommand.js` does not exist.

- [ ] **Step 3: Implement the minimal successful command**

Create the public adapter types and dependency seam:

```ts
import { stat, readFile } from "node:fs/promises";
import { generateBaselinePolishVariant } from "@auto-demo/polish";
import { createProjectFromCaptureBundle, savePolishVariant } from "@auto-demo/project";

export type AgentHandoffCliResult = { exitCode: number; stdout: string; stderr: string };

export type AgentHandoffCommandDependencies = {
  now: () => Date;
  createProject?: typeof createProjectFromCaptureBundle;
  generateBaseline?: typeof generateBaselinePolishVariant;
  saveVariant?: typeof savePolishVariant;
  isFile?: (path: string) => Promise<boolean>;
};
```

Parse `--execution`, `--project`, `--name`, and `--json`; read the execution wrapper; require `ok === true`, `phase === "completed"`, `plan.state === "executed"`, `plan.execution.status === "completed"`, and complete top-level capture paths. Check the manifest, media, and metadata with `stat(path).isFile()`.

Then compose only public APIs:

```ts
const imported = await createProject({
  captureBundlePath: execution.capture.outputDir,
  projectDir: parsed.projectDir,
  name: parsed.name.trim(),
  now: dependencies.now,
});
if (!imported.ok) return importFailure(imported);

const generated = await generateBaseline(imported.project);
const saved = await saveVariant(imported.project, generated.variant, {
  now: dependencies.now(),
});
if (!saved.ok) return generationFailure(saved);
```

Return the design-specified project, variant, warnings, and command/argument next steps. Catch filesystem and dependency exceptions at the command boundary and return stable phase-appropriate errors without raw exception messages.

- [ ] **Step 4: Register the focused test**

Append `src/agentHandoffCommand.test.ts` to `@auto-demo/cli`'s explicit Vitest file list.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run the same focused Vitest command. Expected: PASS with a real loadable project and saved `baseline-polish` file.

- [ ] **Step 6: Refactor while green**

Keep parsing, execution decoding, artifact checking, import-error mapping, and success-summary construction as small private functions. Do not expose private parsers or add test-only production APIs. Rerun the focused test; expected PASS.

### Task 2: Structured Failures And Collision Safety

**Files:**

- Modify: `packages/cli/src/agentHandoffCommand.test.ts`
- Modify: `packages/cli/src/agentHandoffCommand.ts`

- [ ] **Step 1: Add one failing behavior test per error class**

Add tests that assert observable JSON and filesystem effects for:

```ts
expect(codeFor(malformedJson)).toBe("invalid_execution_json");
expect(codeFor({ ok: false, phase: "execution" })).toBe("invalid_execution_result");
expect(codeFor(successWithMissingMedia)).toBe("missing_capture_artifact");
expect(codeFor(successWithInvalidManifest)).toBe("invalid_capture_bundle");
expect(codeFor(nonEmptyProjectDirectory)).toBe("project_directory_collision");
expect(codeFor(injectedWorkflowFailure)).toBe("generation_failed");
```

For the collision test, write a sentinel file before running and assert its bytes are unchanged. For generation failure, use `saveVariant` injection returning a public project-validation failure, then assert the imported manifest still exists. Also cover missing required arguments, unknown arguments, empty name, and absent `--json`.

- [ ] **Step 2: Run focused tests and verify RED**

Expected: each new assertion fails because the minimal command does not yet distinguish all error classes.

- [ ] **Step 3: Add stable error mapping**

Use these public codes exactly:

```ts
type AgentHandoffErrorCode =
  | "missing_execution_file"
  | "invalid_execution_json"
  | "invalid_execution_result"
  | "missing_capture_artifact"
  | "invalid_project_input"
  | "project_directory_collision"
  | "invalid_capture_bundle"
  | "generation_failed"
  | "unknown_agent_argument";
```

Map project `project_directory_not_empty` to `project_directory_collision`, `invalid_capture_bundle` to itself, other expected import validation to `invalid_project_input`, and every workflow failure to `generation_failed` while retaining only dependency-provided safe messages. All JSON-mode failures use exit code 1 and empty stderr. Non-JSON invocation returns a concise stderr message without reading the execution file or creating the project.

- [ ] **Step 4: Run focused tests and verify GREEN**

Expected: all error tests pass; malformed/failed/missing/collision cases create no project; generation failure preserves the imported project.

### Task 3: Wire `autodemo agent handoff`

**Files:**

- Modify: `packages/cli/src/index.test.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Write failing route and help tests**

Add a CLI-level test that passes a valid execution fixture through `runCliAsync(["agent", "handoff", ...])` and observes the same public success JSON. Add help assertions for:

```text
autodemo agent handoff --execution <execution-result-json-file> --project <new-project-directory> --name <project-name> --json
```

Also assert the unsupported-agent-command message names `handoff` among supported subcommands.

- [ ] **Step 2: Run CLI tests and verify RED**

Run:

```bash
npm exec vitest run packages/cli/src/index.test.ts
```

Expected: FAIL because `agent handoff` routes through the legacy `agent run` parser.

- [ ] **Step 3: Add the route and production dependencies**

Import `runAgentHandoffCommand`. In `runAgentCommand()` route `args[0] === "handoff"` before review/validate/plan and call:

```ts
return await runAgentHandoffCommand(args.slice(1), { now: dependencies.now });
```

Add the exact usage line to root and agent help. Preserve all existing routes and exit codes.

- [ ] **Step 4: Run CLI and focused handoff tests and verify GREEN**

Expected: both files PASS.

### Task 4: Extend The Real Playwright Smoke Path

**Files:**

- Modify: `packages/cli/src/agentExecuteCommand.smoke.test.ts`

- [ ] **Step 1: Extend the successful smoke test and verify RED**

After successful execute, persist `result.stdout` to `execution.json`, run `agent handoff`, and assert:

```ts
const handoff = await runCliAsync([
  "agent",
  "handoff",
  "--execution",
  executionPath,
  "--project",
  projectDir,
  "--name",
  "Playwright Smoke Demo",
  "--json",
]);
expect(handoff.exitCode).toBe(0);
const loaded = await loadProject(projectDir);
expect(loaded.ok).toBe(true);
expect(loaded.ok && loaded.manifest.sourceCapture.status).toBe("completed");
expect(loaded.ok && loaded.manifest.variants[0]?.id).toBe("baseline-polish");
expect((await stat(join(projectDir, "variants", "baseline-polish.json"))).size).toBeGreaterThan(0);
```

Run only the smoke file. Expected initial RED if any real capture/result assumption differs from focused fixtures.

- [ ] **Step 2: Make the smallest contract correction**

Correct the adapter only if the real WES-179 output exposes a public-path mismatch. Do not weaken the smoke assertion or add private Playwright coupling.

- [ ] **Step 3: Run the smoke test and verify GREEN**

Run:

```bash
npm exec vitest run packages/cli/src/agentExecuteCommand.smoke.test.ts
```

Expected: successful real browser execution creates a completed capture and a loadable project with saved baseline; the existing failure smoke remains green.

### Task 5: Operator And Wrapper Documentation

**Files:**

- Modify: `README.md`
- Modify: `packages/agent/README.md`
- Modify: `packages/agent/skills/codex-auto-demo/SKILL.md`
- Modify: `packages/agent/claude-wrapper-parity.md`
- Modify: `packages/agent/fixtures/codex-walkthrough-execution.md`
- Modify: `packages/agent/src/wrapper-docs.test.ts`
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Write failing documentation-contract assertions**

Require wrapper docs to include `agent handoff`, `--execution`, `--project`, `--name`, `baseline-polish`, collision/no-overwrite behavior, resumable retry after successful capture, and both editor/export next steps. Remove assertions that say WES-180 is future work.

- [ ] **Step 2: Run wrapper-doc tests and verify RED**

Expected: FAIL because current docs stop at the WES-179 capture bundle.

- [ ] **Step 3: Update operator docs**

Document the exact execute redirection and handoff commands from the design. Explain that typed runtime input remains excluded from JSON/metadata, handoff accepts only successful execution evidence, existing non-empty project directories are rejected, generation failure leaves the imported project for inspection, and the returned editor/export commands are next steps rather than automatic side effects.

Add the plan path and a concise planning/implementation note to the project map. Do not mark WES-180 or WES-176 Done before completion-gate evidence.

- [ ] **Step 4: Run wrapper-doc tests and verify GREEN**

Expected: PASS.

### Task 6: Focused And Repository Verification

**Files:**

- Modify only files needed to resolve verified WES-180 failures.

- [ ] **Step 1: Run focused tests**

```bash
npm exec vitest run packages/cli/src/agentHandoffCommand.test.ts packages/cli/src/index.test.ts packages/cli/src/agentExecuteCommand.smoke.test.ts packages/agent/src/wrapper-docs.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run relevant package typecheck and build**

```bash
npm run typecheck -w @auto-demo/cli
npm run build -w @auto-demo/cli
```

Expected: PASS, including prerequisite workspace builds.

- [ ] **Step 3: Run the repository validation gate**

```bash
npm run validate
```

Expected: build, workspace typechecks, ESLint, all tests, and Prettier PASS.

- [ ] **Step 4: Inspect scope and whitespace**

```bash
git diff --check
git status --short
git diff --stat
```

Expected: no whitespace errors and only WES-180 code, tests, spec, plan, map, and necessary docs.

- [ ] **Step 5: Commit the implementation**

```bash
git add README.md docs/linear/auto-demo-project-structure.md docs/superpowers/specs/2026-07-11-wes-180-capture-to-project-handoff-design.md docs/superpowers/plans/2026-07-11-wes-180-capture-to-project-handoff.md packages/agent packages/cli
git commit -m "feat: complete executed demo project handoff"
```

Expected: one scoped WES-180 commit on `fm/auto-demo-next-after-wes179-n4`, with a clean worktree.

### Task 7: No-Mistakes, Completion Sync, CI, And Merge

**Files:**

- Modify only through no-mistakes response flow while a gate is active.
- Modify `docs/linear/auto-demo-project-structure.md` for narrow post-green completion bookkeeping.

- [ ] **Step 1: Run no-mistakes home view and pipeline**

Run `no-mistakes axi`, then blocking `no-mistakes axi run --intent <full WES-180 intent>`. The intent must name the successful-execution-only handoff, fresh-directory collision policy, saved baseline, structured next steps, explicit non-goals, behavior-first TDD, focused/Playwright smoke evidence, and docs.

- [ ] **Step 2: Drive every gate through `axi respond`**

Use fix/approve for clear auto-fix or no-op findings. Escalate any `ask-user`, destructive, or security-sensitive finding through the firstmate status file. Do not hand-edit or abort around an active gate. Continue until `checks-passed` on the current head and record the PR URL.

- [ ] **Step 3: Run the Linear completion gate**

Reconcile WES-180, WES-176, live Linear, the exact implementation head, tests, no-mistakes result, PR, and GitHub CI. Add concise completion evidence, move WES-180 to Done, and move WES-176 to Done only when all children and final project acceptance are verified. Update the map state, next pointer, and evidence.

- [ ] **Step 4: Publish narrow bookkeeping and recheck exact-head CI**

If only map/tracker bookkeeping changed, commit it, run `git diff --check` plus available doc/map validation, push/update the same PR, and wait for required GitHub CI on that exact head without rerunning no-mistakes. If behavior changed, rerun the full no-mistakes gate.

- [ ] **Step 5: Confirm base and merge**

Verify PR base is `develop`, no-mistakes is checks-passed, and required GitHub CI is green on the current head. Merge the PR without pushing to `develop`. Verify remote merged state and record merge commit/time.

- [ ] **Step 6: Reconcile final checkout and usage**

Fetch `origin/develop` in the isolated worktree and verify the merge is present. Do not pull or modify the intentionally dirty primary checkout; record its exact blocker. Finish `codex-usage task finish --task WES-180`, save the final JSON to `/Users/weston.bushyeager/code/personal/firstmate/data/auto-demo-next-after-wes179-n4/usage.json`, and append the required final `done:` status line.

## Plan Self-Review

- Spec coverage: command evidence validation, missing artifacts, import, collision safety, baseline persistence, structured next steps, retry behavior, smoke validation, docs, completion sync, and merge all map to explicit tasks.
- Placeholder scan: every code-changing step contains concrete code or exact observable behavior; no placeholder steps remain.
- Type consistency: the plan consistently uses `runAgentHandoffCommand`, `AgentHandoffCommandDependencies`, `baseline-polish`, `execution.capture`, `project_directory_collision`, and structured command/argument next steps.
