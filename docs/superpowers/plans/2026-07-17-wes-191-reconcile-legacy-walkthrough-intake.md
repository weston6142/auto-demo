# WES-191 Legacy Walkthrough Intake Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. WES-191's delivery authorization requires inline execution in the current checkout; do not create a worktree or dispatch implementation agents.

**Goal:** Remove natural-language walkthrough parsing and duplicate CLI intake while retaining safe plan-file lifecycle compatibility for existing deterministic and best-guess artifacts.

**Architecture:** `@auto-demo/agent` keeps the durable `WalkthroughPlan` schema and lifecycle but stops creating deterministic plans. `@auto-demo/cli` accepts durable files at validation/review/refine/approve/execute boundaries, while repository documentation teaches discovery compilation as the only new-plan creation path.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, Playwright-backed validation contracts, Markdown documentation, npm workspaces.

---

### Task 1: Lock the supported CLI boundary with failing behavior tests

**Files:**

- Modify: `packages/cli/src/index.test.ts`

- [x] **Step 1: Replace parser-success expectations with retired-command behavior**

Add assertions equivalent to:

```ts
it("rejects the retired agent plan command", async () => {
  const result = await runCli([
    "agent",
    "plan",
    "--url",
    "https://example.com",
    "--script",
    "Click Get started.",
    "--json",
  ]);
  expect(result).toEqual({
    exitCode: 1,
    stdout: "",
    stderr:
      "Unsupported autodemo agent command. Use autodemo agent run, validate, review, refine, approve, execute, or handoff.\n",
  });
});

it("requires a durable plan file for agent validation", async () => {
  const result = await runCli([
    "agent",
    "validate",
    "--url",
    "https://example.com",
    "--script",
    "Click Get started.",
    "--json",
  ]);
  expect(JSON.parse(result.stdout)).toEqual({
    ok: false,
    errors: expect.arrayContaining([
      { code: "unknown_agent_argument", message: "Unknown agent validate argument: --url" },
      { code: "unknown_agent_argument", message: "Unknown agent validate argument: --script" },
      {
        code: "missing_validate_input",
        message: "autodemo agent validate requires --plan <plan-json-file>.",
      },
    ]),
  });
});
```

Retain the existing plan-file success test and missing/malformed/invalid file assertions.

- [x] **Step 2: Run the focused tests and confirm RED**

Run: `rtk npm --workspace @auto-demo/cli exec -- vitest run src/index.test.ts`

Expected: FAIL because `agent plan` and URL/script validation are still accepted.

### Task 2: Remove CLI parser intake and keep plan-file validation

**Files:**

- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/index.test.ts`

- [x] **Step 1: Remove the plan command route and creation dependency**

Delete the `createWalkthroughPlan` import, `runAgentPlanCommand()`, `parseAgentPlanCommand()`, its option parser and parser-only types. Remove the `plan` routing branch. Update the unsupported command message to enumerate supported commands:

```ts
"Unsupported autodemo agent command. Use autodemo agent run, validate, review, refine, approve, execute, or handoff.";
```

- [x] **Step 2: Make validate accept exactly one plan file**

Reduce the parsed success type to:

```ts
type ParsedAgentValidateCommand =
  | { ok: true; json: true; planPath: string }
  | { ok: false; json: boolean; stderr?: string; errors: AgentValidateError[] };
```

Parse only `--json` and `--plan`. For all other flags, append `unknown_agent_argument`. When `--plan` is absent, append:

```ts
{
  code: "missing_validate_input",
  message: "autodemo agent validate requires --plan <plan-json-file>."
}
```

Then load only the file:

```ts
const planResult = await readPlanFile(parsed.planPath);
```

- [x] **Step 3: Remove retired help lines and describe the durable boundary**

Remove `agent plan`, URL/script validation, parser mode, and plan-specific URL/script flags from root and agent help. Keep:

```text
autodemo agent validate --plan <plan-json-file> --json
```

- [x] **Step 4: Run the focused CLI tests and confirm GREEN**

Run: `rtk npm --workspace @auto-demo/cli exec -- vitest run src/index.test.ts`

Expected: PASS.

### Task 3: Remove deterministic plan creation while centralizing legacy test artifacts

**Files:**

- Create: `packages/agent/src/walkthroughTestFixtures.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/src/index.test.ts`
- Modify: `packages/agent/src/playwrightValidationRunner.test.ts`
- Modify: `packages/agent/src/walkthroughApproval.test.ts`
- Modify: `packages/agent/src/walkthroughExecution.test.ts`
- Modify: `packages/agent/src/walkthroughRefinement.test.ts`
- Modify: `packages/agent/src/walkthroughReview.test.ts`
- Modify: `packages/agent/src/walkthroughValidation.test.ts`
- Modify: `packages/agent/src/wrapper-docs.test.ts`
- Modify: `packages/cli/src/agentExecuteCommand.smoke.test.ts`
- Modify: `packages/cli/src/agentExecuteCommand.test.ts`
- Modify: `packages/cli/src/agentReviewCommands.test.ts`
- Modify: `packages/cli/src/index.test.ts`

- [x] **Step 1: Add one explicit compatibility fixture builder**

Create a test-only builder with a complete valid artifact shape:

```ts
export function legacyWalkthroughPlanFixture(
  options: {
    mode?: "validate-first" | "best-guess";
    targetUrl?: string;
    action?: "click" | "type" | "wait" | "navigate";
    summary?: string;
  } = {},
): WalkthroughPlan {
  const mode = options.mode ?? "validate-first";
  const targetUrl = options.targetUrl ?? "https://example.com";
  const action = options.action ?? "click";
  const summary = options.summary ?? "Click Get started.";
  return {
    id: "legacy-plan-fixture",
    target: { kind: "browser", url: targetUrl },
    mode,
    state: "draft",
    source: { parser: "deterministic-v1", script: summary },
    steps: [
      {
        id: "step-1",
        order: 1,
        action,
        resolution: "resolved",
        sourceText: action === "type" ? "Type [input-1] into Search." : summary,
        public: { summary },
        ...(action === "type" ? { inputBinding: "input-1" } : {}),
        ...(action === "wait" ? { waitDurationMs: 1000 } : {}),
        ...(action === "navigate" ? { navigationUrl: targetUrl } : {}),
      },
    ],
    questions: [],
    approvals: { required: true, approved: false },
    execution: { status: "not-started" },
    warnings:
      mode === "best-guess"
        ? [{ code: "best_guess_mode", message: "Deprecated compatibility plan." }]
        : [],
  };
}
```

Extend options only where an existing behavior test requires a blocker, candidate, or multi-step artifact. Keep assertions focused on lifecycle behavior, not builder internals.

- [x] **Step 2: Migrate lifecycle tests away from the production parser**

Replace test imports and setup calls to `createWalkthroughPlan()` with the explicit fixture builder or existing discovery compiler fixtures. Delete the parser-specific `describe("createWalkthroughPlan")` block from `packages/agent/src/index.test.ts`; retain tests for `runAgentWorkflow()` and other public behavior.

- [x] **Step 3: Run agent and CLI suites and confirm fixture behavior**

Run: `rtk npm --workspace @auto-demo/agent test`

Run: `rtk npm --workspace @auto-demo/cli test`

Expected: PASS before production parser deletion, proving lifecycle tests no longer depend on parser behavior.

- [x] **Step 4: Delete the production parser**

Remove from `packages/agent/src/index.ts`:

```ts
export type WalkthroughPlanInput = { ... };
export type WalkthroughPlanErrorCode = ...;
export type WalkthroughPlanError = { ... };
export type WalkthroughPlanResult = ...;
export function createWalkthroughPlan(...) { ... }
```

Also remove parser-only helpers including `splitScript()`, `normalizeStep()`, parser URL extraction, and plan-ID generation when `rtk rg` proves they have no retained consumer. Keep `WalkthroughPlanMode`, `WalkthroughPlanSource`, artifact validation, and lifecycle compatibility.

- [x] **Step 5: Run typecheck and focused suites and confirm GREEN**

Run: `rtk npm --workspace @auto-demo/agent run typecheck`

Run: `rtk npm --workspace @auto-demo/agent test`

Run: `rtk npm --workspace @auto-demo/cli test`

Expected: PASS with no import or artifact-validation regressions.

### Task 4: Lock documentation and wrapper parity with failing tests

**Files:**

- Modify: `packages/agent/src/wrapper-docs.test.ts`
- Modify: `packages/cli/src/packaging-docs.test.ts`

- [x] **Step 1: Assert retired paths are absent and compatibility wording is present**

Add behavior assertions over published docs/help:

```ts
expect(documentation).not.toContain("agent plan --url");
expect(documentation).not.toContain("agent validate --url");
expect(documentation).toContain("existing deterministic-v1");
expect(documentation).toContain("discovery plans never use the best-guess bypass");
```

Assert Codex and Claude guidance both describe compile → replay/repair → review → approve → execute → handoff and neither presents parser creation as supported.

- [x] **Step 2: Run documentation tests and confirm RED**

Run: `rtk npm --workspace @auto-demo/agent exec -- vitest run src/wrapper-docs.test.ts`

Run: `rtk npm --workspace @auto-demo/cli exec -- vitest run src/packaging-docs.test.ts`

Expected: FAIL because current docs still advertise the retired paths.

### Task 5: Publish one discovery-to-artifact workflow and migration statement

**Files:**

- Modify: `README.md`
- Modify: `packages/agent/README.md`
- Modify: `packages/cli/README.md`
- Modify: `packages/agent/skills/codex-auto-demo/SKILL.md`
- Modify: `packages/agent/claude-wrapper-parity.md`
- Modify: `packages/agent/fixtures/codex-walkthrough-review-approval.md`
- Modify: `packages/agent/fixtures/codex-walkthrough-refinement.md`
- Modify: `packages/agent/src/wrapper-docs.test.ts`

- [x] **Step 1: Remove parser and URL/script validation instructions**

Delete public examples for `agent plan`, `agent validate --url`, deterministic text parsing, and new best-guess creation. Make every new workflow start from discovery compilation and persist a plan artifact.

- [x] **Step 2: Add the explicit compatibility contract**

Use consistent language:

```text
Plan-file validation, review, refinement, approval, and execution accept existing deterministic-v1 artifacts for migration compatibility. New plans must come from evidence-backed discovery compilation. Existing best-guess artifacts still require an explicit bypass approval, but discovery plans never use the best-guess bypass.
```

Update transcript fixtures that still claim `deterministic-v1` is the normal source. Retain only examples needed to demonstrate saved-artifact migration and redaction behavior.

- [x] **Step 3: Run documentation tests and confirm GREEN**

Run: `rtk npm --workspace @auto-demo/agent exec -- vitest run src/wrapper-docs.test.ts`

Run: `rtk npm --workspace @auto-demo/cli exec -- vitest run src/packaging-docs.test.ts`

Expected: PASS.

### Task 6: Verify compatibility, remove obsolete fixtures, and record evidence

**Files:**

- Delete if unreferenced: `packages/agent/fixtures/walkthrough-plan-simple.json`
- Delete if unreferenced: `packages/agent/fixtures/walkthrough-plan-ambiguous.json`
- Modify: `docs/linear/auto-demo-project-structure.md`
- Modify: `docs/superpowers/plans/2026-07-17-wes-191-reconcile-legacy-walkthrough-intake.md`

- [x] **Step 1: Audit the final public and code surface**

Run:

```sh
rtk rg -n "createWalkthroughPlan|normalizeStep|agent plan --url|agent validate --url" packages README.md fixtures
```

Expected: no production or public-document matches; any retained historical compatibility fixture reference is explicitly justified in the spec and tests.

Run:

```sh
rtk rg -n "deterministic-v1|best-guess" packages README.md
```

Expected: matches are limited to schema compatibility, safety/lifecycle logic, explicit migration documentation, and behavior-first compatibility tests.

- [x] **Step 2: Remove unreferenced parser fixtures**

Delete only fixtures with zero supported test or documentation consumers. Preserve minimum fixtures that prove old saved artifacts remain readable and transcript-safe.

- [x] **Step 3: Run targeted regression suites**

Run: `rtk npm --workspace @auto-demo/agent test`

Run: `rtk npm --workspace @auto-demo/cli test`

Expected: PASS.

- [x] **Step 4: Run the complete repository verification**

Run: `rtk npm run validate`

Run: `rtk git diff --check`

Expected: both exit 0; build, every workspace typecheck, ESLint, all Node/Vitest tests, and repository-wide Prettier pass.

- [x] **Step 5: Record verified implementation evidence**

Append a WES-191 implementation note to the project map naming the removed paths, retained compatibility boundary, exact passing commands/counts, review result, branch, and pending PR state. Mark every completed plan checkbox only after its associated command passes.

### Task 7: Independent review, publication, and completion synchronization

**Files:**

- Modify as findings require: WES-191-owned files only
- Modify before merge: `docs/linear/auto-demo-project-structure.md`

- [x] **Step 1: Request independent read-only review**

Review the Linear issue, design spec, this plan, base `b85e984`, current diff, compatibility guarantees, security/transcript safety, and test evidence. Fix verified Critical/Important findings and low-risk valid Minor findings with focused red-green verification.

- [x] **Step 2: Re-run complete verification after review fixes**

Run: `rtk npm run validate`

Run: `rtk git diff --check`

Expected: both exit 0.

- [x] **Step 3: Commit only issue-owned paths and publish the PR**

Stage explicit WES-191 paths, excluding `.gitignore`. Commit with `WES-191: retire legacy walkthrough intake`, push `wes-191-reconcile-legacy-intake`, and create a squash-merge PR against `develop` containing issue/spec/plan links and exact verification evidence.

- [x] **Step 4: Monitor checks and review threads**

Use `gh pr checks <number> --watch`. Diagnose failures before changes, apply issue-scoped fixes with TDD, and resolve only addressed or technically invalidated feedback.

- [ ] **Step 5: Update the map and squash merge**

Before merge, record passing CI, review disposition, completion evidence, and next-task pointer WES-190 in the project map and include that change in the PR. Squash merge only when required checks pass and no actionable findings remain.

- [ ] **Step 6: Synchronize local develop and Linear**

Switch to `develop`, fetch the verified base remote/ref, run `rtk git pull --ff-only origin develop`, confirm the squash commit locally, run the completion sync audit, add concise Linear completion evidence, move WES-191 to Done, add a readiness note to WES-190 and tracker update to WES-182, and reconcile the map pointer. Preserve `.gitignore` throughout.
