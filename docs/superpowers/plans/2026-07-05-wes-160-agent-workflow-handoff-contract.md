# WES-160 Agent Workflow Handoff Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a noninteractive agent workflow API and CLI command that selects or generates a saved project variant and emits a stable JSON handoff summary.

**Architecture:** `@auto-demo/agent` owns the orchestration contract and calls existing project and polish APIs. `@auto-demo/cli` parses `autodemo agent run` arguments, injects the existing editor starter, and prints JSON. Existing project, polish, and editor behavior remain the source of truth.

**Tech Stack:** TypeScript npm workspaces, Vitest, existing `@auto-demo/project`, `@auto-demo/polish`, `@auto-demo/editor`, and CLI patterns.

---

## File Structure

- Modify `packages/agent/package.json`: add dependencies on `@auto-demo/project` and `@auto-demo/polish`, and add a `test` script.
- Modify `packages/agent/src/index.ts`: export workflow option/result types and `runAgentWorkflow()`.
- Create `packages/agent/src/index.test.ts`: behavior-first API tests with filesystem fixtures.
- Modify `packages/cli/package.json`: add dependency on `@auto-demo/agent`; make prebuild/pretest build the agent package.
- Modify `packages/cli/src/index.ts`: add `agent` command routing, parser, JSON output, help text, and editor dependency injection.
- Modify `packages/cli/src/index.test.ts`: CLI behavior tests for success, parser failures, and editor handoff.
- Modify `packages/agent/README.md` and `README.md`: document the workflow contract and deferrals.
- Modify `docs/linear/auto-demo-project-structure.md`: record WES-160 selection and spec/plan paths.

## Task 1: Agent Package Contract

**Files:**

- Modify: `packages/agent/package.json`
- Modify: `packages/agent/src/index.ts`
- Create: `packages/agent/src/index.test.ts`

- [ ] **Step 1: Write failing agent API tests**

Add tests that create valid project fixtures with saved variants and assert:

```ts
const result = await runAgentWorkflow({ projectPath, json: true });
expect(result.ok).toBe(true);
expect(result.variant).toMatchObject({
  id: "baseline-polish",
  path: "variants/baseline-polish.json",
  source: "selected",
});
expect(result.artifacts).toContainEqual({
  kind: "variant",
  path: "variants/baseline-polish.json",
});
```

Also test requested variant selection, missing variants, generation save using an injected `generateHeadlessVariants`, reload-after-generation selection, and editor handoff using an injected `startEditorServer`.

- [ ] **Step 2: Verify red**

Run:

```bash
npm --workspace @auto-demo/agent test -- src/index.test.ts
```

Expected: fail because `runAgentWorkflow` and result types are not implemented.

- [ ] **Step 3: Implement agent workflow**

Implement exported types:

```ts
export type AgentWorkflowOptions = {
  projectPath: string;
  json: boolean;
  variantId?: string;
  generate?: "baseline";
  save?: "all" | string;
  sourceVariantId?: string;
  openEditor?: boolean;
};
```

Implement `runAgentWorkflow(options, dependencies)` to load the project, optionally generate and save through `generateHeadlessVariants`, reload the project, select a variant, optionally start the editor, and return stable `ok: true` or `ok: false` objects with non-secret errors.

- [ ] **Step 4: Verify green**

Run:

```bash
npm --workspace @auto-demo/agent test -- src/index.test.ts
npm --workspace @auto-demo/agent run typecheck
npm --workspace @auto-demo/agent run build
```

Expected: all pass.

## Task 2: CLI Command

**Files:**

- Modify: `packages/cli/package.json`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/index.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Add `runCliAsync()` tests for:

```ts
const result = await runCliAsync(["agent", "run", "--project", projectDir, "--json"]);
const output = JSON.parse(result.stdout);
expect(result.exitCode).toBe(0);
expect(output.ok).toBe(true);
expect(output.variant.id).toBe("baseline-polish");
expect(result.stderr).toBe("");
```

Also test missing `--json`, missing project, unsupported subcommand, unknown arguments, `--generate cinematic`, `--generate baseline --source-variant source-baseline --save all`, and `--open-editor` returning `editor.url`.

- [ ] **Step 2: Verify red**

Run:

```bash
npm --workspace @auto-demo/cli test -- src/index.test.ts
```

Expected: fail because `agent` is still unknown.

- [ ] **Step 3: Implement CLI routing**

Import `runAgentWorkflow`. Reuse the existing optional `startEditorServer` dependency for editor handoff. Add `agent` to async routing before capture. Parse only `agent run`; require `--json`; support `--project`, `--variant`, `--generate baseline`, `--source-variant <id>`, `--save <id|all>`, `--open-editor`, `--host`, `--port`, `--no-browser`, and `--help`.

- [ ] **Step 4: Verify green**

Run:

```bash
npm --workspace @auto-demo/cli test -- src/index.test.ts
npm --workspace @auto-demo/cli run typecheck
npm --workspace @auto-demo/cli run build
```

Expected: all pass.

## Task 3: Documentation And Project Map

**Files:**

- Modify: `packages/agent/README.md`
- Modify: `README.md`
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Document public behavior**

Document examples:

```bash
autodemo agent run --project projects/checkout --json
autodemo agent run --project projects/checkout --generate baseline --source-variant source-baseline --save all --json
autodemo agent run --project projects/checkout --variant baseline-polish --open-editor --json
```

Document summary fields, error codes, exit codes, and deferrals to WES-161, WES-162, and export work.

- [ ] **Step 2: Update project map**

Add WES-160 spec and plan paths to Local Context and add a 2026-07-05 pre-task note: WES-160 selected, moved to In Progress, and scoped to the agent workflow CLI/API handoff contract.

- [ ] **Step 3: Run docs and formatting checks**

Run:

```bash
npm run format:check
```

Expected: pass.

## Task 4: Final Verification And Commit

**Files:**

- All scoped WES-160 files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm --workspace @auto-demo/agent test -- src/index.test.ts
npm --workspace @auto-demo/cli test -- src/index.test.ts
```

Expected: pass.

- [ ] **Step 2: Run relevant package typecheck/build**

Run:

```bash
npm --workspace @auto-demo/agent run typecheck
npm --workspace @auto-demo/agent run build
npm --workspace @auto-demo/cli run typecheck
npm --workspace @auto-demo/cli run build
```

Expected: pass.

- [ ] **Step 3: Run full validation**

Run:

```bash
npm run validate
```

Expected: pass.

- [ ] **Step 4: Commit scoped changes**

Stage only WES-160 implementation, tests, docs, spec, plan, package metadata, and project map:

```bash
git add packages/agent packages/cli README.md docs/superpowers/specs/2026-07-05-wes-160-agent-workflow-handoff-contract-design.md docs/superpowers/plans/2026-07-05-wes-160-agent-workflow-handoff-contract.md docs/linear/auto-demo-project-structure.md package-lock.json
git commit -m "feat: add agent workflow handoff contract"
```

## Plan Self-Review

- Spec coverage: tasks cover the agent API, CLI command, summaries, deterministic errors, editor handoff, documentation, project map, and deferrals.
- Placeholder scan: no TBD, TODO, or "implement later" placeholders remain.
- Type consistency: command and option names match the spec; `baseline`, `all`, `selected`, and `generated` labels are used consistently.
