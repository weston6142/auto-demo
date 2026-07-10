import { describe, expect, it } from "vitest";
import {
  approveWalkthroughPlan,
  createWalkthroughPlan,
  reviewWalkthroughPlan,
  verifyWalkthroughPlanApproval,
  type WalkthroughPlan,
} from "./index.js";

function createPlan(mode: "validate-first" | "best-guess", script = "Click Get started.") {
  const result = createWalkthroughPlan({
    targetUrl: "https://example.com/signup",
    script,
    mode,
  });
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

describe("walkthrough approval", () => {
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
