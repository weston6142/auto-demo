# WES-181 Script Intake Walkthrough Plan Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first script intake contract that turns a target URL plus natural-language browser demo script into a structured walkthrough plan.

**Architecture:** Add a pure `createWalkthroughPlan()` API to `@auto-demo/agent`, then expose it through `autodemo agent plan`. Keep the normalizer deterministic and conservative so unresolved script text becomes user-answerable questions instead of fake executable actions.

**Tech Stack:** TypeScript, Vitest, npm workspaces, existing Auto Demo CLI/agent packages.

---

## File Structure

- Modify `packages/agent/src/index.ts`: add walkthrough plan types, validation, deterministic id generation, step normalization, and redaction.
- Modify `packages/agent/src/index.test.ts`: add behavior-first tests for simple, ambiguous, typed-value, and invalid input cases.
- Modify `packages/agent/fixtures/walkthrough-plan-simple.json`: add a checked-in simple fixture.
- Modify `packages/agent/fixtures/walkthrough-plan-ambiguous.json`: add a checked-in ambiguous fixture.
- Modify `packages/agent/src/wrapper-docs.test.ts`: verify fixtures parse and document the public contract.
- Modify `packages/agent/README.md`: document the plan API and CLI command.
- Modify `packages/cli/src/index.ts`: parse and run `autodemo agent plan`.
- Modify `packages/cli/src/index.test.ts`: add CLI behavior tests.
- Modify `docs/linear/auto-demo-project-structure.md`: link the spec/plan and update WES-181 progress notes.

### Task 1: Agent Plan API

- [ ] **Step 1: Write failing API tests**

Add tests to `packages/agent/src/index.test.ts` importing `createWalkthroughPlan`.

```ts
it("creates a draft walkthrough plan for a simple click-through script", () => {
  const result = createWalkthroughPlan({
    targetUrl: "https://example.com/signup",
    script: "Go to https://example.com/signup. Click Get started. Verify the pricing page appears.",
    mode: "validate-first",
  });

  expect(result).toMatchObject({
    ok: true,
    plan: {
      target: { kind: "browser", url: "https://example.com/signup" },
      mode: "validate-first",
      state: "draft",
      approvals: { required: true, approved: false },
      execution: { status: "not-started" },
      questions: [],
    },
  });
  expect(result.ok && result.plan.steps.map((step) => step.action)).toEqual([
    "navigate",
    "click",
    "assert",
  ]);
});

it("keeps ambiguous script text as an unresolved user question", () => {
  const result = createWalkthroughPlan({
    targetUrl: "https://example.com",
    script: "Open the dashboard. Pick the best option.",
    mode: "validate-first",
  });

  expect(result.ok && result.plan.state).toBe("needs-clarification");
  expect(result.ok && result.plan.questions).toEqual([
    {
      id: "question-2",
      stepId: "step-2",
      prompt: "Clarify how to perform: Pick the best option.",
      reason: "unrecognized_step",
    },
  ]);
});

it("redacts typed values from public action details", () => {
  const result = createWalkthroughPlan({
    targetUrl: "https://example.com/login",
    script: "Type hunter2 into the password field.",
    mode: "best-guess",
  });

  expect(result.ok && result.plan.steps[0]).toMatchObject({
    action: "type",
    resolution: "resolved",
    public: { summary: "Type [redacted] into the password field." },
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `rtk npm --workspace @auto-demo/agent test -- src/index.test.ts`

Expected: FAIL because `createWalkthroughPlan` is not exported.

- [ ] **Step 3: Implement minimal API**

In `packages/agent/src/index.ts`, add exported plan types and `createWalkthroughPlan(input)`. Use `node:crypto` `createHash("sha256")` for deterministic ids. Split scripts on newlines and sentence-ending punctuation. Recognize `go/open/navigate`, `click`, `type/enter/fill`, `wait`, and `see/verify/assert/check`. Return structured errors for missing or invalid target URL, missing script, and unsupported mode.

- [ ] **Step 4: Run focused agent tests**

Run: `rtk npm --workspace @auto-demo/agent test -- src/index.test.ts`

Expected: PASS.

### Task 2: Fixtures And Docs

- [ ] **Step 1: Write failing docs/fixture tests**

In `packages/agent/src/wrapper-docs.test.ts`, add tests that parse `fixtures/walkthrough-plan-simple.json` and `fixtures/walkthrough-plan-ambiguous.json`, asserting `ok: true`, the simple fixture state is `draft`, and the ambiguous fixture state is `needs-clarification`.

- [ ] **Step 2: Run docs test to verify RED**

Run: `rtk npm --workspace @auto-demo/agent test -- src/wrapper-docs.test.ts`

Expected: FAIL because the fixtures do not exist.

- [ ] **Step 3: Add fixtures and README section**

Create the two fixture JSON files using the public result shape from `createWalkthroughPlan()`. Update `packages/agent/README.md` with `createWalkthroughPlan()` and `autodemo agent plan --url ... --script ... --mode validate-first --json`, explicit deferrals, and stable error codes.

- [ ] **Step 4: Run docs tests**

Run: `rtk npm --workspace @auto-demo/agent test -- src/wrapper-docs.test.ts`

Expected: PASS.

### Task 3: CLI Plan Command

- [ ] **Step 1: Write failing CLI tests**

In `packages/cli/src/index.test.ts`, add tests for `agent plan --url --script --json`, missing JSON output, unsupported mode, and missing URL/script.

- [ ] **Step 2: Run CLI test to verify RED**

Run: `rtk npm --workspace @auto-demo/cli test -- src/index.test.ts`

Expected: FAIL because `agent plan` is unsupported.

- [ ] **Step 3: Implement CLI parsing and execution**

Modify `packages/cli/src/index.ts` to import `createWalkthroughPlan`, add `ParsedAgentPlanCommand`, allow `agent plan`, parse `--url`, `--script`, `--mode`, and `--json`, and print JSON results with exit code `0` for success and `1` for expected failures.

- [ ] **Step 4: Run focused CLI tests**

Run: `rtk npm --workspace @auto-demo/cli test -- src/index.test.ts`

Expected: PASS.

### Task 4: Validation And Bookkeeping

- [ ] **Step 1: Update project map**

Add WES-181 spec/plan links, local implementation summary, and verification notes to `docs/linear/auto-demo-project-structure.md`.

- [ ] **Step 2: Run package checks**

Run:

```bash
rtk npm --workspace @auto-demo/agent test
rtk npm --workspace @auto-demo/agent run typecheck
rtk npm --workspace @auto-demo/agent run build
rtk npm --workspace @auto-demo/cli test
rtk npm --workspace @auto-demo/cli run typecheck
rtk npm --workspace @auto-demo/cli run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Run repository validation**

Run: `rtk npm run validate`

Expected: exit 0.

- [ ] **Step 4: Commit scoped changes**

Run:

```bash
rtk git status --short
rtk git add packages/agent packages/cli docs/superpowers/specs/2026-07-07-wes-181-script-intake-walkthrough-plan-contract-design.md docs/superpowers/plans/2026-07-07-wes-181-script-intake-walkthrough-plan-contract.md docs/linear/auto-demo-project-structure.md
rtk git commit -m "feat(agent): add walkthrough plan intake contract"
```

Expected: commit succeeds with only WES-181 scoped files.

## Self-Review

- Spec coverage: tasks cover API contract, CLI command, fixtures, docs, tests, and map bookkeeping.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: the plan uses `createWalkthroughPlan`, `WalkthroughPlan`, `WalkthroughPlanResult`, and `autodemo agent plan` consistently.
