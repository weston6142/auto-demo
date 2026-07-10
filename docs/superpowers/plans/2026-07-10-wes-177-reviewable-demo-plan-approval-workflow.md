# WES-177 Reviewable Demo Plan Approval Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an agent-conversation review, structured refinement, automatic revalidation, and fingerprinted approval workflow for walkthrough plans before WES-179 execution.

**Architecture:** Add focused review, approval, and refinement modules to `@auto-demo/agent`, keeping conversation interpretation in agent hosts and deterministic lifecycle rules in the library. Extend the existing walkthrough plan and validation contract, expose thin JSON CLI adapters, and verify behavior through public APIs, CLI outputs, and repository-owned wrapper fixtures.

**Tech Stack:** TypeScript, Node.js `crypto`, Vitest, Playwright validation adapters, npm workspaces, Markdown wrapper fixtures.

---

## Execution Prerequisite

WES-177 depends on the current WES-178 implementation, which is intentionally uncommitted and modifies overlapping files including `packages/agent/src/index.ts`, `packages/agent/src/walkthroughValidation.ts`, `packages/cli/src/index.ts`, and their tests and docs. Before Task 1:

- preserve the current WES-178 working tree exactly;
- obtain user direction before committing, moving, or creating a worktree from those changes;
- ensure the execution workspace contains the verified WES-178 baseline;
- do not start from `origin/develop`, where WES-178 is absent;
- do not stage unrelated user changes.

The commit steps below assume the WES-178 baseline has first been established safely on the execution branch. If the user requires another no-commit run, skip commit commands but still complete every test and checkpoint.

## File Structure

### Create

- `packages/agent/src/walkthroughReview.ts` — build transcript-safe review models and approval eligibility explanations.
- `packages/agent/src/walkthroughReview.test.ts` — black-box review behavior and redaction coverage.
- `packages/agent/src/walkthroughApproval.ts` — approve plans, compute canonical fingerprints, and verify approval consistency.
- `packages/agent/src/walkthroughApproval.test.ts` — approval gates, bypass evidence, and stale-fingerprint behavior.
- `packages/agent/src/walkthroughRefinement.ts` — validate and apply atomic structured refinements and coordinate revalidation.
- `packages/agent/src/walkthroughRefinement.test.ts` — candidate selection, step replacement, atomicity, and failure preservation.
- `packages/cli/src/agentReviewCommands.ts` — parse and run `agent review`, `agent refine`, and `agent approve` JSON commands.
- `packages/cli/src/agentReviewCommands.test.ts` — public CLI behavior for the three commands.
- `packages/agent/fixtures/codex-walkthrough-review-approval.md` — parseable agent-conversation happy path.
- `packages/agent/fixtures/codex-walkthrough-refinement.md` — parseable blocked-plan refinement conversation.

### Modify

- `packages/agent/src/index.ts` — extend plan types and export the new workflow APIs.
- `packages/agent/src/index.test.ts` — verify intake remains compatible with expanded lifecycle fields.
- `packages/agent/src/walkthroughValidation.ts` — validate expanded plan shapes, persist target hints, and set lifecycle state from validation.
- `packages/agent/src/walkthroughValidation.test.ts` — verify ready/blocked lifecycle transitions and target-hint sanitization.
- `packages/agent/src/playwrightValidationRunner.ts` — attach durable accessible hints to transcript-safe candidates.
- `packages/agent/src/playwrightValidationRunner.test.ts` — verify role, label, and occurrence hints without raw selectors.
- `packages/agent/package.json` — include new agent test files in the package test command.
- `packages/cli/src/index.ts` — route new agent subcommands and update help output.
- `packages/cli/src/index.test.ts` — preserve existing agent plan/validate behavior and verify routing/help.
- `packages/cli/package.json` — include the focused command test file.
- `packages/agent/README.md` — document the review/refine/approve workflow service.
- `packages/cli/README.md` — document the JSON command contract.
- `packages/agent/skills/codex-auto-demo/SKILL.md` — require conversational review and explicit approval.
- `packages/agent/claude-wrapper-parity.md` — record equivalent host-neutral review semantics.
- `packages/agent/src/wrapper-docs.test.ts` — behavior-check the wrapper contract and fixtures.
- `docs/linear/auto-demo-project-structure.md` — link the plan and record implementation/completion evidence.

## Task 1: Extend The Walkthrough Plan And Validation Lifecycle

**Files:**

- Modify: `packages/agent/src/index.ts:117-170`
- Modify: `packages/agent/src/walkthroughValidation.ts:1-150`
- Modify: `packages/agent/src/walkthroughValidation.ts:570-610`
- Test: `packages/agent/src/index.test.ts:296-390`
- Test: `packages/agent/src/walkthroughValidation.test.ts`

- [ ] **Step 1: Write failing lifecycle and compatibility tests**

Add behavior tests proving ready validation produces `validated`, blocked validation produces `needs-clarification`, intake still produces pending approval, and plan validation accepts complete approved evidence:

```ts
it("sets lifecycle state from the validation result", async () => {
  const ready = await validateWalkthroughPlan(
    plan("Click Get started."),
    { now: () => new Date("2026-07-10T12:00:00.000Z") },
    { browser: runner({}) },
  );
  const blocked = await validateWalkthroughPlan(
    plan("Click Missing control."),
    { now: () => new Date("2026-07-10T12:00:00.000Z") },
    { browser: runner({ "step-1": [] }) },
  );

  expect(ready.ok && ready.plan.state).toBe("validated");
  expect(blocked.ok && blocked.plan.state).toBe("needs-clarification");
  expect(ready.ok && ready.plan.approvals).toEqual({ required: true, approved: false });
});

it("accepts complete approval evidence as a walkthrough plan artifact", () => {
  const approved = plan("Click Get started.");
  approved.state = "approved";
  approved.validation = {
    status: "ready",
    validatedAt: "2026-07-10T11:59:00.000Z",
    mode: "dry-run",
    checks: [],
    blockers: [],
  };
  approved.approvals = {
    required: true,
    approved: true,
    approvedAt: "2026-07-10T12:00:00.000Z",
    planFingerprint: `sha256:${"a".repeat(64)}`,
    basis: "validated",
  };

  expect(isWalkthroughPlan(approved)).toBe(true);
});

it("rejects lifecycle and validation state mismatches", () => {
  const inconsistent = plan("Click Get started.");
  inconsistent.state = "validated";

  expect(isWalkthroughPlan(inconsistent)).toBe(false);
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
rtk npm --workspace @auto-demo/agent test -- src/index.test.ts src/walkthroughValidation.test.ts
```

Expected: FAIL because `validated` and approved evidence are not accepted and validation preserves the prior top-level state.

- [ ] **Step 3: Extend the public plan types**

Update the plan contract in `packages/agent/src/index.ts`:

```ts
export type WalkthroughPlanState =
  "draft" | "needs-clarification" | "validated" | "approved" | "executed";

export type WalkthroughPlanTargetHint = {
  kind: "accessible";
  label: string;
  role?: string;
  occurrence?: number;
};

export type WalkthroughPlanApproval = {
  required: true;
  approved: boolean;
  approvedAt?: string;
  planFingerprint?: string;
  basis?: "validated" | "best-guess-bypass";
};
```

Add `targetHint?: WalkthroughPlanTargetHint` to `WalkthroughPlanStep`, change `approvals` to `WalkthroughPlanApproval`, and add:

```ts
validation?: import("./walkthroughValidation.js").WalkthroughPlanValidation;
```

to `WalkthroughPlan`. Keep `createWalkthroughPlan()` output unchanged except for satisfying the expanded types.

- [ ] **Step 4: Enforce consistent plan and approval shapes**

Update `isWalkthroughPlan()` so it accepts `validated`, validates optional target hints, and requires complete evidence only when `approved` is true:

```ts
function isWalkthroughPlanApproval(
  value: WalkthroughPlan["approvals"] | undefined,
  state: WalkthroughPlanState | undefined,
): boolean {
  if (value?.required !== true || typeof value.approved !== "boolean") return false;
  if (!value.approved) {
    return (
      value.approvedAt === undefined &&
      value.planFingerprint === undefined &&
      value.basis === undefined &&
      state !== "approved"
    );
  }
  return (
    state === "approved" &&
    typeof value.approvedAt === "string" &&
    !Number.isNaN(Date.parse(value.approvedAt)) &&
    typeof value.planFingerprint === "string" &&
    /^sha256:[a-f0-9]{64}$/.test(value.planFingerprint) &&
    (value.basis === "validated" || value.basis === "best-guess-bypass")
  );
}
```

Validate target hints as sanitized non-empty accessible labels, optional non-empty roles, and positive integer occurrences. Preserve them in `sanitizePlan()`. Validate optional validation payloads and enforce these cross-field invariants: `validated` requires ready validation; blocked validation requires `needs-clarification`; `approved` with basis `validated` retains ready validation; `draft` cannot carry validation; and pending approval cannot use state `approved`.

- [ ] **Step 5: Set lifecycle state during validation**

Build validation once, attach it to the sanitized plan, and derive state from blockers:

```ts
const validation: WalkthroughPlanValidation = {
  status: blockers.length === 0 ? "ready" : "blocked",
  validatedAt: now().toISOString(),
  mode: "dry-run",
  checks,
  blockers,
};

return {
  ok: true,
  plan: {
    ...sanitizePlan(plan),
    state: validation.status === "ready" ? "validated" : "needs-clarification",
    validation,
  },
};
```

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
rtk npm --workspace @auto-demo/agent test -- src/index.test.ts src/walkthroughValidation.test.ts
rtk npm --workspace @auto-demo/agent run typecheck
```

Expected: PASS with all existing intake and validation tests still green.

- [ ] **Step 7: Commit the lifecycle foundation**

```bash
rtk git add packages/agent/src/index.ts packages/agent/src/index.test.ts packages/agent/src/walkthroughValidation.ts packages/agent/src/walkthroughValidation.test.ts
rtk git commit -m "feat(agent): add walkthrough review lifecycle"
```

## Task 2: Add Transcript-Safe Plan Reviews

**Files:**

- Create: `packages/agent/src/walkthroughReview.ts`
- Create: `packages/agent/src/walkthroughReview.test.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/package.json`

- [ ] **Step 1: Write failing review behavior tests**

Cover ordered summaries, blockers, candidates, approval eligibility, and secret removal:

```ts
function validatedPlan(): WalkthroughPlan {
  const created = createWalkthroughPlan({
    targetUrl: "https://example.com/signup",
    script: "Navigate to https://example.com/signup. Click Get started.",
    mode: "validate-first",
  });
  if (!created.ok) throw new Error("test plan should be valid");
  created.plan.state = "validated";
  created.plan.validation = {
    status: "ready",
    validatedAt: "2026-07-10T12:00:00.000Z",
    mode: "dry-run",
    checks: created.plan.steps.map((step) => ({
      id: `check-${step.order}`,
      stepId: step.id,
      action: step.action,
      status: "passed",
      summary: `Validated: ${step.public.summary}`,
    })),
    blockers: [],
  };
  return created.plan;
}

function planContainingSecrets(): WalkthroughPlan {
  const unsafe = validatedPlan();
  unsafe.target.url = "https://example.com/signup?access_token=hunter2#secret";
  unsafe.steps[0].sourceText = "Bearer abcdefghijklmnop";
  unsafe.steps[0].public.summary = "Use password=hunter2";
  return unsafe;
}

it("builds a readable ordered review for an annotated plan", () => {
  const result = reviewWalkthroughPlan(validatedPlan());

  expect(result).toMatchObject({
    ok: true,
    review: {
      state: "validated",
      approval: { eligible: true, basis: "validated" },
      steps: [
        { order: 1, action: "navigate" },
        { order: 2, action: "click" },
      ],
    },
  });
  expect(result.ok && result.review.summary).toContain("Ready for approval");
});

it("does not expose secrets or raw plan internals", () => {
  const result = reviewWalkthroughPlan(planContainingSecrets());
  const serialized = JSON.stringify(result);

  expect(serialized).not.toContain("hunter2");
  expect(serialized).not.toContain("access_token");
  expect(serialized).not.toContain("sourceText");
  expect(serialized).not.toContain("css=");
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

```bash
rtk npm --workspace @auto-demo/agent test -- src/walkthroughReview.test.ts
```

Expected: FAIL because `reviewWalkthroughPlan()` and the review types do not exist.

- [ ] **Step 3: Implement the review model and builder**

Create a pure module with these public shapes:

```ts
export type WalkthroughPlanReview = {
  planId: string;
  target: string;
  mode: WalkthroughPlan["mode"];
  state: WalkthroughPlan["state"];
  steps: Array<{
    id: string;
    order: number;
    action: WalkthroughPlanStepAction;
    summary: string;
  }>;
  warnings: Array<{ code: string; message: string }>;
  blockers: WalkthroughPlanValidationBlocker[];
  approval: {
    eligible: boolean;
    basis?: "validated" | "best-guess-bypass";
    reason?: string;
  };
  summary: string;
};

export type WalkthroughPlanReviewResult =
  | { ok: true; review: WalkthroughPlanReview }
  | { ok: false; errors: Array<{ code: "invalid_plan"; message: string }> };
```

Implement `reviewWalkthroughPlan()` by validating the artifact, mapping only public step fields, copying already-sanitized validation blockers and candidate hints, sanitizing target/warnings again, and producing deterministic plain text in this order: target, mode/state, numbered steps, blockers, warnings, approval status.

- [ ] **Step 4: Export the review API and include its tests**

Re-export the builder and types from `packages/agent/src/index.ts` and add `src/walkthroughReview.test.ts` to the agent package test script.

- [ ] **Step 5: Run review tests and the agent suite**

```bash
rtk npm --workspace @auto-demo/agent test -- src/walkthroughReview.test.ts
rtk npm --workspace @auto-demo/agent test
rtk npm --workspace @auto-demo/agent run typecheck
```

Expected: PASS; existing plan and validation behavior remains green.

- [ ] **Step 6: Commit transcript-safe reviews**

```bash
rtk git add packages/agent/src/walkthroughReview.ts packages/agent/src/walkthroughReview.test.ts packages/agent/src/index.ts packages/agent/package.json
rtk git commit -m "feat(agent): add walkthrough plan reviews"
```

## Task 3: Add Fingerprinted Approval And Verification

**Files:**

- Create: `packages/agent/src/walkthroughApproval.ts`
- Create: `packages/agent/src/walkthroughApproval.test.ts`
- Modify: `packages/agent/src/walkthroughReview.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/package.json`

- [ ] **Step 1: Write failing approval behavior tests**

```ts
function validatedPlan(): WalkthroughPlan {
  const created = createWalkthroughPlan({
    targetUrl: "https://example.com/signup",
    script: "Click Get started.",
    mode: "validate-first",
  });
  if (!created.ok) throw new Error("test plan should be valid");
  created.plan.state = "validated";
  created.plan.validation = {
    status: "ready",
    validatedAt: "2026-07-10T12:00:00.000Z",
    mode: "dry-run",
    checks: [
      {
        id: "check-1",
        stepId: "step-1",
        action: "click",
        status: "passed",
        summary: "Validated: Click Get started.",
      },
    ],
    blockers: [],
  };
  return created.plan;
}

function bestGuessPlan(): WalkthroughPlan {
  const created = createWalkthroughPlan({
    targetUrl: "https://example.com/signup",
    script: "Click Get started.",
    mode: "best-guess",
  });
  if (!created.ok) throw new Error("test plan should be valid");
  return created.plan;
}

function unresolvedBestGuessPlan(): WalkthroughPlan {
  const created = createWalkthroughPlan({
    targetUrl: "https://example.com/signup",
    script: "Pick the best option.",
    mode: "best-guess",
  });
  if (!created.ok) throw new Error("test plan should be valid");
  return created.plan;
}

it("approves a ready plan with portable fingerprint evidence", () => {
  const result = approveWalkthroughPlan(validatedPlan(), {
    now: () => new Date("2026-07-10T13:00:00.000Z"),
  });

  expect(result).toMatchObject({
    ok: true,
    plan: {
      state: "approved",
      approvals: {
        required: true,
        approved: true,
        approvedAt: "2026-07-10T13:00:00.000Z",
        basis: "validated",
        planFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    },
  });
  expect(result.ok && verifyWalkthroughPlanApproval(result.plan)).toEqual({ ok: true });
});

it("requires an explicit best-guess bypass and rejects unresolved work", () => {
  expect(approveWalkthroughPlan(bestGuessPlan(), {})).toMatchObject({
    ok: false,
    errors: [{ code: "best_guess_bypass_required" }],
  });
  expect(approveWalkthroughPlan(bestGuessPlan(), { allowBestGuessBypass: true })).toMatchObject({
    ok: true,
    plan: { approvals: { basis: "best-guess-bypass" } },
  });
  expect(
    approveWalkthroughPlan(unresolvedBestGuessPlan(), { allowBestGuessBypass: true }),
  ).toMatchObject({ ok: false, errors: [{ code: "plan_not_approvable" }] });
});

it("detects execution-relevant changes after approval", () => {
  const approved = approveWalkthroughPlan(validatedPlan(), {});
  if (!approved.ok) throw new Error("test plan should approve");
  approved.plan.steps[0].public.summary = "Click a different control";

  expect(verifyWalkthroughPlanApproval(approved.plan)).toMatchObject({
    ok: false,
    errors: [{ code: "stale_approval" }],
  });
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

```bash
rtk npm --workspace @auto-demo/agent test -- src/walkthroughApproval.test.ts
```

Expected: FAIL because approval APIs are missing.

- [ ] **Step 3: Implement canonical approval content and fingerprinting**

Create a fixed-shape payload that excludes lifecycle, approval, execution, and source script:

```ts
function approvalContent(plan: WalkthroughPlan): object {
  return {
    target: plan.target,
    mode: plan.mode,
    steps: plan.steps.map((step) => ({
      id: step.id,
      order: step.order,
      action: step.action,
      resolution: step.resolution,
      public: step.public,
      targetHint: step.targetHint ?? null,
      questionId: step.questionId ?? null,
    })),
    questions: plan.questions,
    validation: plan.validation ?? null,
  };
}

export function walkthroughPlanFingerprint(plan: WalkthroughPlan): string {
  const canonical = canonicalize(approvalContent(plan));
  const digest = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  return `sha256:${digest}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}
```

- [ ] **Step 4: Implement approval gates and verification**

Use these result codes and behavior:

```ts
export type WalkthroughApprovalErrorCode =
  "invalid_plan" | "plan_not_approvable" | "best_guess_bypass_required" | "stale_approval";
```

Validated approval requires state `validated`, ready validation, no blockers, and no unresolved work. Best-guess bypass requires mode `best-guess`, no validation, no unresolved work, and `allowBestGuessBypass: true`. Return copied plans rather than mutating the input.

- [ ] **Step 5: Make reviews report verified approval state**

Update `reviewWalkthroughPlan()` so an approved plan calls verification. Valid approval reports `Approved`; mismatch reports ineligible with `Approval is stale because execution content changed.` Best-guess bypass is named explicitly in the summary.

- [ ] **Step 6: Export, run tests, and typecheck**

```bash
rtk npm --workspace @auto-demo/agent test -- src/walkthroughApproval.test.ts src/walkthroughReview.test.ts
rtk npm --workspace @auto-demo/agent test
rtk npm --workspace @auto-demo/agent run typecheck
```

Expected: PASS with deterministic 64-character SHA-256 evidence.

- [ ] **Step 7: Commit approval evidence**

```bash
rtk git add packages/agent/src/walkthroughApproval.ts packages/agent/src/walkthroughApproval.test.ts packages/agent/src/walkthroughReview.ts packages/agent/src/index.ts packages/agent/package.json
rtk git commit -m "feat(agent): add walkthrough plan approval evidence"
```

## Task 4: Add Atomic Refinement And Automatic Revalidation

**Files:**

- Create: `packages/agent/src/walkthroughRefinement.ts`
- Create: `packages/agent/src/walkthroughRefinement.test.ts`
- Modify: `packages/agent/src/walkthroughValidation.ts`
- Modify: `packages/agent/src/playwrightValidationRunner.ts`
- Modify: `packages/agent/src/playwrightValidationRunner.test.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/package.json`

- [ ] **Step 1: Write failing candidate-hint adapter tests**

Extend the existing two-button Playwright test:

```ts
expect(matches).toEqual([
  expect.objectContaining({
    label: "Get started (button 1 of 2)",
    role: "button",
    targetHint: {
      kind: "accessible",
      label: "Get started",
      role: "button",
      occurrence: 1,
    },
  }),
  expect.objectContaining({
    targetHint: {
      kind: "accessible",
      label: "Get started",
      role: "button",
      occurrence: 2,
    },
  }),
]);

const selectedStep = step("Click Get started.");
selectedStep.targetHint = {
  kind: "accessible",
  label: "Get started",
  role: "button",
  occurrence: 2,
};
await expect(browser.findMatches(selectedStep)).resolves.toEqual([
  expect.objectContaining({
    label: "Get started (button 2 of 2)",
    targetHint: selectedStep.targetHint,
  }),
]);
```

- [ ] **Step 2: Write failing refinement behavior tests**

Cover candidate selection, replacement, atomic failure, automatic validation, and preserved drafts:

```ts
function ambiguousValidatedPlan(): WalkthroughPlan {
  const created = createWalkthroughPlan({
    targetUrl: "https://example.com/signup",
    script: "Click Get started.",
    mode: "validate-first",
  });
  if (!created.ok) throw new Error("test plan should be valid");
  created.plan.state = "needs-clarification";
  created.plan.validation = {
    status: "blocked",
    validatedAt: "2026-07-10T12:00:00.000Z",
    mode: "dry-run",
    checks: [
      {
        id: "check-1",
        stepId: "step-1",
        action: "click",
        status: "blocked",
        reason: "multiple_matching_elements",
        summary: "Choose one Get started button.",
      },
    ],
    blockers: [
      {
        id: "blocker-1",
        stepId: "step-1",
        reason: "multiple_matching_elements",
        question: "Which Get started button should be used?",
        candidates: [
          {
            id: "match-1",
            label: "Get started (button 1 of 2)",
            role: "button",
            targetHint: {
              kind: "accessible",
              label: "Get started",
              role: "button",
              occurrence: 1,
            },
          },
          {
            id: "match-2",
            label: "Get started (button 2 of 2)",
            role: "button",
            targetHint: {
              kind: "accessible",
              label: "Get started",
              role: "button",
              occurrence: 2,
            },
          },
        ],
      },
    ],
  };
  return created.plan;
}

function blockedPlan(): WalkthroughPlan {
  const created = createWalkthroughPlan({
    targetUrl: "https://example.com/signup",
    script: "Pick the best option.",
    mode: "validate-first",
  });
  if (!created.ok) throw new Error("test plan should be valid");
  return created.plan;
}

function resolvedClickStep(): Omit<WalkthroughPlanStep, "id" | "order" | "questionId"> {
  return {
    action: "click",
    resolution: "resolved",
    sourceText: "Click Get started.",
    public: { summary: "Click Get started." },
    targetHint: { kind: "accessible", label: "Get started", role: "button" },
  };
}

function runnerForSelectedCandidate(): WalkthroughValidationBrowserRunner {
  return {
    async open() {},
    async navigate() {},
    async inspectPage() {
      return { url: "https://example.com/signup", title: "Signup", authWall: false };
    },
    async findMatches(step) {
      return [
        {
          id: `${step.id}-selected`,
          label: step.targetHint?.label ?? step.public.summary,
          role: step.targetHint?.role,
          targetHint: step.targetHint,
        },
      ];
    },
    async click() {},
    async type() {},
    async waitForIdle() {},
    async close() {},
  };
}

function failingBrowserSetupRunner(): WalkthroughValidationBrowserRunner {
  return {
    ...runnerForSelectedCandidate(),
    async open() {
      throw new Error("browser unavailable");
    },
  };
}

function validCandidateRefinement(): WalkthroughPlanRefinement {
  return {
    kind: "select-candidate",
    stepId: "step-1",
    blockerId: "blocker-1",
    candidateId: "match-2",
  };
}

it("selects a candidate, persists its accessible hint, and revalidates", async () => {
  const result = await refineWalkthroughPlan(
    ambiguousValidatedPlan(),
    [validCandidateRefinement()],
    { now: () => new Date("2026-07-10T14:00:00.000Z") },
    { browser: runnerForSelectedCandidate() },
  );

  expect(result).toMatchObject({
    ok: true,
    plan: {
      state: "validated",
      steps: [{ targetHint: { kind: "accessible", occurrence: 2 } }],
      approvals: { approved: false },
    },
  });
});

it("rejects a mixed refinement batch without partial output", async () => {
  const result = await refineWalkthroughPlan(
    ambiguousValidatedPlan(),
    [
      validCandidateRefinement(),
      { kind: "replace-step", stepId: "missing", replacement: resolvedClickStep() },
    ],
    {},
    { browser: runnerForSelectedCandidate() },
  );

  expect(result).toMatchObject({
    ok: false,
    errors: [{ code: "unknown_refinement_step" }],
  });
  expect("plan" in result).toBe(false);
});

it("preserves a refined unvalidated plan when the browser cannot start", async () => {
  const result = await refineWalkthroughPlan(
    blockedPlan(),
    [{ kind: "replace-step", stepId: "step-1", replacement: resolvedClickStep() }],
    {},
    { browser: failingBrowserSetupRunner() },
  );

  expect(result).toMatchObject({
    ok: false,
    plan: { state: "draft", validation: undefined, approvals: { approved: false } },
    errors: [{ code: "browser_setup_failed" }],
  });
});
```

- [ ] **Step 3: Run adapter and refinement tests and verify they fail**

```bash
rtk npm --workspace @auto-demo/agent test -- src/playwrightValidationRunner.test.ts src/walkthroughRefinement.test.ts
```

Expected: FAIL because candidates lack target hints and refinement APIs do not exist.

- [ ] **Step 4: Add sanitized durable hints to candidates**

Extend `WalkthroughValidationMatch` with `targetHint?: WalkthroughPlanTargetHint`. In `visibleCandidates()`, emit the accessible label before ordinal decoration, inferred role, and a one-based occurrence only when multiple candidates exist. When a step already has a target hint, `findMatches()` must use its label and role and return only the requested occurrence; missing or changed occurrences return no match so validation reports a blocker. Update `sanitizeMatch()` to sanitize and preserve the hint. Never include a locator, selector, or element handle in public output.

- [ ] **Step 5: Define refinement inputs and stable errors**

Create these public types in `walkthroughRefinement.ts`:

```ts
export type WalkthroughPlanRefinement =
  | {
      kind: "select-candidate";
      stepId: string;
      blockerId: string;
      candidateId: string;
    }
  | {
      kind: "replace-step";
      stepId: string;
      replacement: Omit<WalkthroughPlanStep, "id" | "order" | "questionId">;
    };

export type WalkthroughRefinementErrorCode =
  | "invalid_plan"
  | "invalid_refinement"
  | "unknown_refinement_step"
  | "stale_validation_blocker"
  | "unknown_validation_candidate"
  | "candidate_not_persistable"
  | "unsupported_replacement_action"
  | WalkthroughValidationErrorCode;
```

- [ ] **Step 6: Implement atomic refinement and approval clearing**

Validate the complete batch before cloning. Reject duplicate target steps. For candidate selection, require the current blocker, candidate, and candidate target hint. For replacement, allow only resolved `navigate`, `click`, `type`, `wait`, or `assert` actions; preserve the old id and order; remove the old question. Clear approval with:

```ts
function clearApproval(plan: WalkthroughPlan): WalkthroughPlan {
  const { validation: _validation, ...withoutValidation } = plan;
  return {
    ...withoutValidation,
    state: plan.questions.length > 0 ? "needs-clarification" : "draft",
    approvals: { required: true, approved: false },
    execution: { status: "not-started" },
  };
}
```

Calculate the state after applying and removing questions, not from the pre-refinement plan.

- [ ] **Step 7: Coordinate automatic revalidation and review**

For `validate-first`, call `validateWalkthroughPlan()` with the supplied clock and browser. Return blocked validation as `ok: true`. If validation returns an operational error, return `ok: false` with the refined unvalidated plan, a review of that plan, and the validation errors. For `best-guess`, return the unvalidated plan and review directly.

- [ ] **Step 8: Export APIs and run the full agent suite**

```bash
rtk npm --workspace @auto-demo/agent test -- src/playwrightValidationRunner.test.ts src/walkthroughRefinement.test.ts
rtk npm --workspace @auto-demo/agent test
rtk npm --workspace @auto-demo/agent run typecheck
```

Expected: PASS with refinement behavior covered through public outputs.

- [ ] **Step 9: Commit structured refinement**

```bash
rtk git add packages/agent/src/walkthroughRefinement.ts packages/agent/src/walkthroughRefinement.test.ts packages/agent/src/walkthroughValidation.ts packages/agent/src/playwrightValidationRunner.ts packages/agent/src/playwrightValidationRunner.test.ts packages/agent/src/index.ts packages/agent/package.json
rtk git commit -m "feat(agent): refine and revalidate walkthrough plans"
```

## Task 5: Expose Review, Refine, And Approve CLI Commands

**Files:**

- Create: `packages/cli/src/agentReviewCommands.ts`
- Create: `packages/cli/src/agentReviewCommands.test.ts`
- Modify: `packages/cli/src/index.ts:1-150`
- Modify: `packages/cli/src/index.ts:350-470`
- Modify: `packages/cli/src/index.ts:1690-1740`
- Modify: `packages/cli/src/index.test.ts`
- Modify: `packages/cli/package.json`

- [ ] **Step 1: Write failing public CLI happy-path tests**

Call `runCliAsync()` rather than testing parser internals:

```ts
function commandDependencies(): CliDependencies {
  return {
    browserCaptureAdapter: {
      kind: "browser",
      async start() {
        throw new Error("capture must not start during review command tests");
      },
    },
    createValidationRunner: () => ({
      async open() {},
      async navigate() {},
      async inspectPage() {
        return { url: "https://example.com/signup", title: "Signup", authWall: false };
      },
      async findMatches(step) {
        return [{ id: `${step.id}-match`, label: step.public.summary }];
      },
      async click() {},
      async type() {},
      async waitForIdle() {},
      async close() {},
    }),
    now: () => new Date("2026-07-10T15:00:00.000Z"),
    async runChildCommand() {
      return { exitCode: 0 };
    },
  };
}

async function writeReadyPlan(path: string): Promise<void> {
  const created = createWalkthroughPlan({
    targetUrl: "https://example.com/signup",
    script: "Click Get started.",
    mode: "validate-first",
  });
  if (!created.ok) throw new Error("test plan should be valid");
  created.plan.state = "validated";
  created.plan.validation = {
    status: "ready",
    validatedAt: "2026-07-10T14:59:00.000Z",
    mode: "dry-run",
    checks: [],
    blockers: [],
  };
  await writeFile(path, `${JSON.stringify(created.plan, null, 2)}\n`);
}

it("reviews, refines, and approves plan artifacts through JSON commands", async () => {
  const directory = await mkdtemp(join(tmpdir(), "autodemo-review-cli-"));
  const readyPlanPath = join(directory, "ready-plan.json");
  const blockedPlanPath = join(directory, "blocked-plan.json");
  const refinementsPath = join(directory, "refinements.json");
  await writeReadyPlan(readyPlanPath);
  const blocked = createWalkthroughPlan({
    targetUrl: "https://example.com/signup",
    script: "Pick the best option.",
    mode: "validate-first",
  });
  if (!blocked.ok) throw new Error("test plan should be valid");
  await writeFile(blockedPlanPath, `${JSON.stringify(blocked.plan, null, 2)}\n`);
  await writeFile(
    refinementsPath,
    `${JSON.stringify([
      {
        kind: "replace-step",
        stepId: "step-1",
        replacement: {
          action: "click",
          resolution: "resolved",
          sourceText: "Click Get started.",
          public: { summary: "Click Get started." },
        },
      },
    ])}\n`,
  );
  const dependencies = commandDependencies();

  const review = await runCliAsync(
    ["agent", "review", "--plan", readyPlanPath, "--json"],
    dependencies,
  );
  expect(review.exitCode).toBe(0);
  expect(JSON.parse(review.stdout)).toMatchObject({ ok: true, review: { state: "validated" } });

  const refine = await runCliAsync(
    ["agent", "refine", "--plan", blockedPlanPath, "--refinements", refinementsPath, "--json"],
    dependencies,
  );
  expect(JSON.parse(refine.stdout)).toMatchObject({ ok: true, plan: { state: "validated" } });

  const approve = await runCliAsync(
    ["agent", "approve", "--plan", readyPlanPath, "--json"],
    dependencies,
  );
  expect(JSON.parse(approve.stdout)).toMatchObject({
    ok: true,
    plan: { state: "approved", approvals: { approved: true } },
  });
});
```

- [ ] **Step 2: Write failing CLI error tests**

Cover missing plan/refinement files, malformed JSON, unknown arguments, non-JSON invocation, invalid refinement arrays, ineligible approval, and explicit best-guess bypass:

```ts
it("requires explicit best-guess bypass intent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "autodemo-review-cli-error-"));
  const bestGuessPath = join(directory, "best-guess-plan.json");
  const created = createWalkthroughPlan({
    targetUrl: "https://example.com/signup",
    script: "Click Get started.",
    mode: "best-guess",
  });
  if (!created.ok) throw new Error("test plan should be valid");
  await writeFile(bestGuessPath, `${JSON.stringify(created.plan, null, 2)}\n`);

  const result = await runCliAsync(
    ["agent", "approve", "--plan", bestGuessPath, "--json"],
    commandDependencies(),
  );

  expect(JSON.parse(result.stdout)).toMatchObject({
    ok: false,
    errors: [{ code: "best_guess_bypass_required" }],
  });
});
```

- [ ] **Step 3: Run the focused CLI tests and verify they fail**

```bash
rtk npm --workspace @auto-demo/cli test -- src/agentReviewCommands.test.ts
```

Expected: FAIL because the new commands are routed as unsupported agent arguments.

- [ ] **Step 4: Implement the focused command adapter**

Export one dispatcher with a narrow dependency contract:

```ts
export type AgentReviewCommandDependencies = {
  now: () => Date;
  createValidationRunner: () => WalkthroughValidationBrowserRunner;
};

export async function runAgentReviewCommand(
  command: "review" | "refine" | "approve",
  args: string[],
  dependencies: AgentReviewCommandDependencies,
): Promise<{ exitCode: number; stdout: string; stderr: string }>;
```

Require `--plan` and `--json` for all commands, `--refinements` only for refine, and `--allow-best-guess-bypass` only for approve. Read either a raw plan or `{ plan }` envelope, require refinements to be a JSON array, and return stable JSON failures.

- [ ] **Step 5: Route commands and update help**

In `runAgentCommand()`, route before the existing plan/validate/run parser:

```ts
if (args[0] === "review" || args[0] === "refine" || args[0] === "approve") {
  return await runAgentReviewCommand(args[0], args.slice(1), {
    now: dependencies.now,
    createValidationRunner: dependencies.createValidationRunner ?? createPlaywrightValidationRunner,
  });
}
```

Add all three command forms and their options to `agentHelpText()` and the root help's agent section.

- [ ] **Step 6: Include focused tests and verify existing routes**

Add `src/agentReviewCommands.test.ts` to the CLI test script, then run:

```bash
rtk npm --workspace @auto-demo/cli test -- src/agentReviewCommands.test.ts src/index.test.ts
rtk npm --workspace @auto-demo/cli run typecheck
```

Expected: PASS; existing `agent run`, `agent plan`, and `agent validate` behavior remains unchanged except for ready plans now using state `validated`.

- [ ] **Step 7: Commit the CLI adapter**

```bash
rtk git add packages/cli/src/agentReviewCommands.ts packages/cli/src/agentReviewCommands.test.ts packages/cli/src/index.ts packages/cli/src/index.test.ts packages/cli/package.json
rtk git commit -m "feat(cli): add walkthrough review commands"
```

## Task 6: Publish The Agent Conversation Contract And Fixtures

**Files:**

- Create: `packages/agent/fixtures/codex-walkthrough-review-approval.md`
- Create: `packages/agent/fixtures/codex-walkthrough-refinement.md`
- Modify: `packages/agent/README.md`
- Modify: `packages/cli/README.md`
- Modify: `packages/agent/skills/codex-auto-demo/SKILL.md`
- Modify: `packages/agent/claude-wrapper-parity.md`
- Modify: `packages/agent/src/wrapper-docs.test.ts`
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Write failing wrapper artifact tests**

Assert the Codex skill and parity document require review, structured refinement, automatic revalidation, and explicit approval. Parse the new fixture JSON blocks:

```ts
it("documents conversational review and explicit approval", async () => {
  const skill = await readAgentDoc("skills/codex-auto-demo/SKILL.md");
  const approvalFixture = await readAgentDoc("fixtures/codex-walkthrough-review-approval.md");
  const refinementFixture = await readAgentDoc("fixtures/codex-walkthrough-refinement.md");

  expect(skill).toContain("autodemo agent review --plan <plan-json-file> --json");
  expect(skill).toContain("Ask for explicit approval");
  expect(skill).toContain("autodemo agent approve --plan <plan-json-file> --json");
  expect(jsonBlock(approvalFixture, "Approved plan artifact")).toMatchObject({
    ok: true,
    plan: { state: "approved", approvals: { approved: true, basis: "validated" } },
  });
  expect(jsonBlock(refinementFixture, "Revalidated plan artifact")).toMatchObject({
    ok: true,
    plan: { state: "validated", validation: { status: "ready" } },
  });
});
```

- [ ] **Step 2: Run wrapper tests and verify they fail**

```bash
rtk npm --workspace @auto-demo/agent test -- src/wrapper-docs.test.ts
```

Expected: FAIL because the commands and fixtures are not documented.

- [ ] **Step 3: Write the two conversation fixtures**

The approval fixture must show: agent reads review JSON, summarizes target and ordered steps, asks for approval, user explicitly confirms, agent invokes approve, and a parseable approved plan is returned. The refinement fixture must show: agent presents one blocker, user selects a candidate, agent writes a structured refinement array, refine automatically revalidates, and the resulting plan is ready for review. Use only public example values and stable identifiers.

- [ ] **Step 4: Update the Codex and Claude host contracts**

Document this exact sequence in `codex-auto-demo/SKILL.md`:

```text
plan -> validate -> review -> conversational clarification -> refine -> review -> explicit confirmation -> approve
```

State that the agent must not edit plan JSON directly, omit blockers, invoke approval before confirmation, or silently pass `--allow-best-guess-bypass`. Add equivalent command semantics and deferrals to `claude-wrapper-parity.md` without claiming a production Claude wrapper exists.

- [ ] **Step 5: Update package documentation and the project map**

Document public library APIs, CLI commands, lifecycle states, stable errors, output persistence, approval fingerprint limitations, and WES-179 verification. Add the implementation plan link and a concise WES-177 planning note to `docs/linear/auto-demo-project-structure.md`.

- [ ] **Step 6: Run documentation and package tests**

```bash
rtk npm --workspace @auto-demo/agent test -- src/wrapper-docs.test.ts
rtk npm --workspace @auto-demo/agent test
rtk npm --workspace @auto-demo/cli test
```

Expected: PASS with both fixtures parseable and all commands documented.

- [ ] **Step 7: Commit wrapper and documentation changes**

```bash
rtk git add packages/agent/fixtures/codex-walkthrough-review-approval.md packages/agent/fixtures/codex-walkthrough-refinement.md packages/agent/README.md packages/cli/README.md packages/agent/skills/codex-auto-demo/SKILL.md packages/agent/claude-wrapper-parity.md packages/agent/src/wrapper-docs.test.ts docs/linear/auto-demo-project-structure.md
rtk git commit -m "docs(agent): publish walkthrough approval workflow"
```

## Task 7: Run Full Verification And Completion Sync

**Files:**

- Modify if evidence changes: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Run focused agent and CLI suites**

```bash
rtk npm --workspace @auto-demo/agent test
rtk npm --workspace @auto-demo/cli test
```

Expected: all agent and CLI tests pass with zero failures.

- [ ] **Step 2: Run package typechecks and builds**

```bash
rtk npm --workspace @auto-demo/agent run typecheck
rtk npm --workspace @auto-demo/agent run build
rtk npm --workspace @auto-demo/cli run typecheck
rtk npm --workspace @auto-demo/cli run build
```

Expected: all four commands exit 0.

- [ ] **Step 3: Run repository validation**

```bash
rtk npm run validate
```

Expected: build, workspace typechecks, ESLint, all tests, and Prettier exit 0.

- [ ] **Step 4: Inspect the final diff and public command help**

```bash
rtk git diff --check
rtk npm run autodemo -- agent --help
```

Expected: no whitespace errors; help lists `review`, `refine`, and `approve` with JSON artifact options.

- [ ] **Step 5: Run the Linear completion sync gate**

Use `linear-sync-gate` in `completion-gate` mode with WES-177, the implementation summary, fresh verification output, current project map, and nearby WES-176/WES-179/WES-180 state. Apply only clear project-map and Linear writes. Do not mark WES-177 Done without complete verification evidence.

- [ ] **Step 6: Record final evidence and commit only if needed**

If the completion gate adds project-map evidence after the documentation commit:

```bash
rtk git add docs/linear/auto-demo-project-structure.md
rtk git commit -m "docs: record WES-177 completion evidence"
```

If the user requested no commits, leave the verified changes unstaged and report that state explicitly.
