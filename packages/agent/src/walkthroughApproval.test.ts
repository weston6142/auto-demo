import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  approveWalkthroughPlan,
  reviewWalkthroughPlan,
  verifyWalkthroughPlanApproval,
  type WalkthroughPlan,
} from "./index.js";
import { legacyWalkthroughPlanFixture } from "./walkthroughTestFixtures.js";

function createPlan(mode: "validate-first" | "best-guess", script = "Click Get started.") {
  const result = {
    ok: true as const,
    plan: legacyWalkthroughPlanFixture({
      targetUrl: "https://example.com/signup",
      script,
      mode,
    }),
  };
  if (!result.ok) {
    throw new Error("test plan should be valid");
  }
  return result.plan;
}

function validatedPlan(): WalkthroughPlan {
  const plan = createPlan("validate-first");
  plan.state = "validated";
  plan.validation = {
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
  return plan;
}

function legacyFingerprint(plan: WalkthroughPlan): string {
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  };
  const canonical = canonicalize({
    target: plan.target,
    mode: plan.mode,
    steps: plan.steps.map((step) => ({
      id: step.id,
      order: step.order,
      action: step.action,
      resolution: step.resolution,
      sourceText: step.sourceText,
      public: step.public,
      targetHint: step.targetHint ?? null,
      questionId: step.questionId ?? null,
    })),
    questions: plan.questions,
    validation: plan.validation ?? null,
  });
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}

describe("walkthrough approval", () => {
  it("rejects discovery plans without matching replay validation", () => {
    const dryRun = validatedPlan();
    dryRun.source = {
      parser: "discovery-v1",
      script: dryRun.source.script,
      discovery: {
        schemaVersion: 1,
        sessionId: "session-1",
        selectedPathFingerprint: `sha256:${"a".repeat(64)}`,
      },
    };
    expect(approveWalkthroughPlan(dryRun)).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_plan" }],
    });

    const bestGuess = createPlan("best-guess");
    bestGuess.source = {
      parser: "discovery-v1",
      script: bestGuess.source.script,
      discovery: {
        schemaVersion: 1,
        sessionId: "session-1",
        selectedPathFingerprint: `sha256:${"a".repeat(64)}`,
      },
    };
    expect(approveWalkthroughPlan(bestGuess, { allowBestGuessBypass: true })).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_plan" }],
    });
  });

  it("invalidates approval when discovery replay evidence changes", () => {
    const input = validatedPlan();
    input.source = {
      parser: "discovery-v1",
      script: input.source.script,
      discovery: {
        schemaVersion: 1,
        sessionId: "session-1",
        selectedPathFingerprint: `sha256:${"a".repeat(64)}`,
      },
    };
    input.validation = {
      ...input.validation!,
      mode: "discovery-replay",
      replay: {
        replayId: "replay-1",
        attempts: 1,
        sourceSessionId: "session-1",
        selectedPathFingerprint: `sha256:${"a".repeat(64)}`,
      },
    };
    const approved = approveWalkthroughPlan(input);
    if (!approved.ok) throw new Error("replayed plan should approve");
    if (approved.plan.validation?.mode !== "discovery-replay") {
      throw new Error("approved plan should retain replay evidence");
    }
    approved.plan.validation.replay.attempts = 2;

    expect(verifyWalkthroughPlanApproval(approved.plan)).toMatchObject({
      ok: false,
      errors: [{ code: "stale_approval" }],
    });
  });

  it("fingerprints structured assertions and discovery provenance", () => {
    const input = createPlan("best-guess", "Verify Results.");
    input.steps[0].targetHint = { kind: "accessible", label: "Results" };
    input.steps[0].assertion = { kind: "visible-state", condition: "Results" };
    input.steps[0].provenance = {
      kind: "discovery",
      sessionId: "session-1",
      attemptId: "attempt-1",
      expectationId: "expectation-1",
      expectationOrigin: "declared-before-action",
    };
    const approved = approveWalkthroughPlan(input, { allowBestGuessBypass: true });
    if (!approved.ok) throw new Error("test plan should approve");

    const changedAssertion = structuredClone(approved.plan);
    changedAssertion.steps[0].assertion = {
      kind: "visible-state",
      condition: "Changed results",
    };
    changedAssertion.steps[0].targetHint = {
      kind: "accessible",
      label: "Changed results",
    };
    expect(verifyWalkthroughPlanApproval(changedAssertion)).toMatchObject({
      ok: false,
      errors: [{ code: "stale_approval" }],
    });

    const changedProvenance = structuredClone(approved.plan);
    if (changedProvenance.steps[0].provenance === undefined) {
      throw new Error("test plan should retain provenance");
    }
    changedProvenance.steps[0].provenance.expectationId = "expectation-2";
    expect(verifyWalkthroughPlanApproval(changedProvenance)).toMatchObject({
      ok: false,
      errors: [{ code: "stale_approval" }],
    });
  });

  it("approves a validated plan with portable fingerprint evidence", () => {
    const input = validatedPlan();
    const result = approveWalkthroughPlan(input, {
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
    expect(input.state).toBe("validated");
    expect(input.approvals.approved).toBe(false);
    expect(result.ok && verifyWalkthroughPlanApproval(result.plan)).toEqual({ ok: true });
  });

  it("requires explicit best-guess bypass intent", () => {
    const input = createPlan("best-guess");

    expect(approveWalkthroughPlan(input)).toEqual({
      ok: false,
      errors: [
        {
          code: "best_guess_bypass_required",
          message: "Best-guess approval requires explicit validation bypass intent.",
        },
      ],
    });

    expect(
      approveWalkthroughPlan(input, {
        allowBestGuessBypass: true,
        now: () => new Date("2026-07-10T13:00:00.000Z"),
      }),
    ).toMatchObject({
      ok: true,
      plan: { state: "approved", approvals: { basis: "best-guess-bypass" } },
    });
  });

  it("does not allow best-guess bypass with unresolved work", () => {
    const input = createPlan("best-guess", "Pick the best option.");

    expect(approveWalkthroughPlan(input, { allowBestGuessBypass: true })).toEqual({
      ok: false,
      errors: [
        {
          code: "plan_not_approvable",
          message: "Resolve every walkthrough step before approval.",
        },
      ],
    });
  });

  it("rejects draft or blocked validate-first plans", () => {
    expect(approveWalkthroughPlan(createPlan("validate-first"))).toMatchObject({
      ok: false,
      errors: [{ code: "plan_not_approvable" }],
    });

    const blocked = createPlan("validate-first");
    blocked.state = "needs-clarification";
    blocked.validation = {
      status: "blocked",
      validatedAt: "2026-07-10T12:00:00.000Z",
      mode: "dry-run",
      checks: [
        {
          id: "check-1",
          stepId: "step-1",
          action: "click",
          status: "blocked",
          reason: "missing_element",
          summary: "Target was not found.",
        },
      ],
      blockers: [
        {
          id: "blocker-1",
          stepId: "step-1",
          reason: "missing_element",
          question: "Which element should be used?",
        },
      ],
    };

    expect(approveWalkthroughPlan(blocked)).toMatchObject({
      ok: false,
      errors: [{ code: "plan_not_approvable" }],
    });
  });

  it("detects execution-relevant changes after approval", () => {
    const result = approveWalkthroughPlan(validatedPlan());
    if (!result.ok) {
      throw new Error("test plan should approve");
    }
    result.plan.steps[0].public.summary = "Click a different control.";

    expect(verifyWalkthroughPlanApproval(result.plan)).toEqual({
      ok: false,
      errors: [
        {
          code: "stale_approval",
          message: "Walkthrough approval does not match the current execution content.",
        },
      ],
    });
  });

  it("fingerprints structured execution data", () => {
    const typePlan = createPlan("best-guess", "Type launch demo into Search.");
    const waitPlan = createPlan("best-guess", "Wait 2 seconds.");
    const navigationPlan = createPlan("best-guess", "Go to https://example.com/dashboard.");
    const selectPlan = createPlan("best-guess");
    selectPlan.steps[0] = {
      ...selectPlan.steps[0],
      action: "select",
      optionLabel: "New",
    };
    const approvedPlans = [typePlan, waitPlan, navigationPlan, selectPlan].map((plan) =>
      approveWalkthroughPlan(plan, { allowBestGuessBypass: true }),
    );
    for (const approved of approvedPlans) {
      if (!approved.ok) throw new Error("test plan should approve");
    }

    const [approvedType, approvedWait, approvedNavigation, approvedSelect] = approvedPlans;
    if (!approvedType.ok || !approvedWait.ok || !approvedNavigation.ok || !approvedSelect.ok) {
      throw new Error("test plans should approve");
    }
    expect(approvedType.plan.steps[0]).toMatchObject({ inputBinding: "step-1" });
    expect(approvedWait.plan.steps[0]).toMatchObject({ waitDurationMs: 2_000 });
    expect(approvedNavigation.plan.steps[0]).toMatchObject({
      navigationUrl: "https://example.com/dashboard",
    });
    expect(approvedSelect.plan.steps[0]).toMatchObject({ optionLabel: "New" });

    approvedType.plan.steps[0].inputBinding = "replacement";
    approvedWait.plan.steps[0].waitDurationMs = 3_000;
    approvedNavigation.plan.steps[0].navigationUrl = "https://example.com/other";
    approvedSelect.plan.steps[0].optionLabel = "Used";

    for (const approved of [approvedType, approvedWait, approvedNavigation, approvedSelect]) {
      expect(verifyWalkthroughPlanApproval(approved.plan)).toMatchObject({
        ok: false,
        errors: [{ code: "stale_approval" }],
      });
    }
  });

  it("accepts legacy approval fingerprints only when new execution fields are absent", () => {
    const approved = approveWalkthroughPlan(validatedPlan());
    if (!approved.ok) throw new Error("test plan should approve");
    approved.plan.approvals.planFingerprint = legacyFingerprint(approved.plan);

    expect(verifyWalkthroughPlanApproval(approved.plan)).toEqual({ ok: true });

    approved.plan.steps[0].inputBinding = "new-binding";
    expect(verifyWalkthroughPlanApproval(approved.plan)).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_plan" }],
    });
  });

  it("does not invalidate approval for non-execution source text changes", () => {
    const result = approveWalkthroughPlan(validatedPlan());
    if (!result.ok) {
      throw new Error("test plan should approve");
    }
    result.plan.source.script = "Conversation wording changed.";

    expect(verifyWalkthroughPlanApproval(result.plan)).toEqual({ ok: true });
  });

  it("reports approved and stale approval states in reviews", () => {
    const approved = approveWalkthroughPlan(validatedPlan());
    if (!approved.ok) {
      throw new Error("test plan should approve");
    }
    const currentReview = reviewWalkthroughPlan(approved.plan);
    approved.plan.steps[0].public.summary = "Click a different control.";
    const staleReview = reviewWalkthroughPlan(approved.plan);

    expect(currentReview.ok && currentReview.review.summary).toContain("Approved.");
    expect(staleReview).toMatchObject({
      ok: true,
      review: {
        approval: {
          eligible: false,
          reason: "Approval is stale because execution content changed.",
        },
      },
    });
  });

  it("rejects approval evidence whose basis conflicts with validation", () => {
    const approved = approveWalkthroughPlan(validatedPlan());
    if (!approved.ok) throw new Error("test plan should approve");
    approved.plan.approvals.basis = "best-guess-bypass";

    expect(verifyWalkthroughPlanApproval(approved.plan)).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_plan" }],
    });
  });

  it("never emits raw typed input from best-guess approval", () => {
    const safeTyped = createPlan("best-guess", "Type hunter2 into the search field.");
    const unsafeTyped = createPlan("best-guess", "Type hunter2 into the password field.");

    const approved = approveWalkthroughPlan(safeTyped, { allowBestGuessBypass: true });
    const rejected = approveWalkthroughPlan(unsafeTyped, { allowBestGuessBypass: true });
    const serialized = JSON.stringify([approved, rejected]);

    expect(approved).toMatchObject({
      ok: true,
      plan: { source: { script: "Type [redacted] into the search field." } },
    });
    expect(rejected).toMatchObject({
      ok: false,
      errors: [{ code: "plan_not_approvable" }],
    });
    expect(serialized).not.toContain("hunter2");
  });

  it("rejects hand-authored raw type values and unsafe navigation", () => {
    const rawTyped = createPlan("best-guess", "Type safe-value into the search field.");
    rawTyped.steps[0].sourceText = "Type sensitive-value into the search field.";
    rawTyped.steps[0].public.summary = "Type sensitive-value into the search field.";
    const unsafeNavigation = createPlan("best-guess", "Navigate to javascript:alert(1).");

    const typedResult = approveWalkthroughPlan(rawTyped, { allowBestGuessBypass: true });
    const navigationResult = approveWalkthroughPlan(unsafeNavigation, {
      allowBestGuessBypass: true,
    });

    expect(typedResult).toMatchObject({ ok: false, errors: [{ code: "invalid_plan" }] });
    expect(navigationResult).toMatchObject({
      ok: false,
      errors: [{ code: "plan_not_approvable" }],
    });
    expect(JSON.stringify([typedResult, navigationResult])).not.toContain("sensitive-value");
  });
});
