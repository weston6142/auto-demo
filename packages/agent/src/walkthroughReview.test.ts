import { describe, expect, it } from "vitest";
import { createWalkthroughPlan, reviewWalkthroughPlan, type WalkthroughPlan } from "./index.js";

function plan(script = "Go to https://example.com/signup. Click Get started."): WalkthroughPlan {
  const result = createWalkthroughPlan({
    targetUrl: "https://example.com/signup",
    script,
    mode: "validate-first",
  });
  if (!result.ok) {
    throw new Error("test plan should be valid");
  }
  return result.plan;
}

function validatedPlan(): WalkthroughPlan {
  const result = plan();
  result.state = "validated";
  result.validation = {
    status: "ready",
    validatedAt: "2026-07-10T12:00:00.000Z",
    mode: "dry-run",
    checks: result.steps.map((step) => ({
      id: `check-${step.order}`,
      stepId: step.id,
      action: step.action,
      status: "passed",
      summary: `Validated: ${step.public.summary}`,
    })),
    blockers: [],
  };
  return result;
}

describe("reviewWalkthroughPlan", () => {
  it("identifies discovery-compiled plans without exposing evidence identifiers", () => {
    const discovered = plan("Verify Results.");
    discovered.source = {
      parser: "discovery-v1",
      script: "Verify Results.",
      discovery: {
        schemaVersion: 1,
        sessionId: "private-session-id",
        selectedPathFingerprint: `sha256:${"a".repeat(64)}`,
      },
    };

    const result = reviewWalkthroughPlan(discovered);

    expect(result).toMatchObject({ ok: true, review: { source: "discovery-v1" } });
    expect(result.ok && result.review.summary).toContain("Source: discovery-v1");
    expect(result.ok && result.review.summary).not.toContain("private-session-id");
    expect(result.ok && result.review.summary).not.toContain("sha256:");
  });

  it("builds an ordered readable review for a validated plan", () => {
    const result = reviewWalkthroughPlan(validatedPlan());

    expect(result).toMatchObject({
      ok: true,
      review: {
        target: "https://example.com/signup",
        mode: "validate-first",
        state: "validated",
        steps: [
          { id: "step-1", order: 1, action: "navigate" },
          { id: "step-2", order: 2, action: "click" },
        ],
        questions: [],
        validation: {
          status: "ready",
          checks: [
            { id: "check-1", stepId: "step-1", status: "passed" },
            { id: "check-2", stepId: "step-2", status: "passed" },
          ],
        },
        approval: { eligible: true, basis: "validated" },
      },
    });
    expect(result.ok && result.review.summary).toContain("Validation: ready");
    expect(result.ok && result.review.summary).toContain("Validation checks:");
    expect(result.ok && result.review.summary).toContain("Ready for approval");
    expect(result.ok && result.review.summary).toContain("1. Go to https://example.com/signup.");
    expect(result.ok && result.review.summary).toContain("2. Click Get started.");
  });

  it("summarizes fresh-context replay without exposing repair history", () => {
    const replayed = validatedPlan();
    replayed.source = {
      parser: "discovery-v1",
      script: replayed.source.script,
      discovery: {
        schemaVersion: 1,
        sessionId: "session-repair-1",
        selectedPathFingerprint: `sha256:${"a".repeat(64)}`,
      },
    };
    replayed.validation = {
      ...replayed.validation!,
      mode: "discovery-replay",
      replay: {
        replayId: "replay-1",
        attempts: 2,
        sourceSessionId: "session-repair-1",
        selectedPathFingerprint: `sha256:${"a".repeat(64)}`,
      },
    } as unknown as WalkthroughPlan["validation"];

    const result = reviewWalkthroughPlan(replayed);

    expect(result).toMatchObject({
      ok: true,
      review: {
        validation: {
          mode: "discovery-replay",
          replay: { attempts: 2 },
        },
      },
    });
    expect(result.ok && result.review.summary).toContain(
      "Fresh-context replay: passed after 2 attempts.",
    );
    expect(JSON.stringify(result)).not.toContain("repair history");
  });

  it("includes unresolved questions and names best-guess bypass explicitly", () => {
    const unresolved = reviewWalkthroughPlan(plan("Pick the best option."));
    const bestGuess = plan("Click Get started.");
    bestGuess.mode = "best-guess";
    const bypass = reviewWalkthroughPlan(bestGuess);

    expect(unresolved).toMatchObject({
      ok: true,
      review: {
        questions: [
          {
            id: "question-1",
            stepId: "step-1",
            prompt: "Clarify how to perform: Pick the best option.",
          },
        ],
      },
    });
    expect(unresolved.ok && unresolved.review.summary).toContain("Questions:");
    expect(bypass.ok && bypass.review.summary).toContain(
      "Ready for approval with explicit browser-validation bypass.",
    );
  });

  it("presents validation blockers and candidate choices", () => {
    const blocked = plan("Click Get started.");
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
          reason: "multiple_matching_elements",
          summary: "Choose one target.",
        },
      ],
      blockers: [
        {
          id: "blocker-1",
          stepId: "step-1",
          reason: "multiple_matching_elements",
          question: "Which Get started button should be used?",
          candidates: [
            { id: "candidate-1", label: "Header Get started", role: "button" },
            { id: "candidate-2", label: "Hero Get started", role: "button" },
          ],
        },
      ],
    };

    const result = reviewWalkthroughPlan(blocked);

    expect(result).toMatchObject({
      ok: true,
      review: {
        approval: { eligible: false, reason: "Resolve validation blockers before approval." },
        blockers: [
          {
            id: "blocker-1",
            candidates: [
              { id: "candidate-1", label: "Header Get started" },
              { id: "candidate-2", label: "Hero Get started" },
            ],
          },
        ],
      },
    });
    expect(result.ok && result.review.summary).toContain(
      "Which Get started button should be used?",
    );
  });

  it("removes secrets and raw step internals from review output", () => {
    const unsafe = validatedPlan();
    unsafe.target.url = "https://example.com/signup?access_token=hunter2#secret";
    unsafe.steps[0].sourceText = "Bearer abcdefghijklmnop";
    unsafe.steps[0].public.summary = "Use password=hunter2";
    unsafe.warnings.push({ code: "secret-warning", message: "token=sk-live-secret" });

    const result = reviewWalkthroughPlan(unsafe);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("access_token");
    expect(serialized).not.toContain("#secret");
    expect(serialized).not.toContain("abcdefghijklmnop");
    expect(serialized).not.toContain("sk-live-secret");
    expect(serialized).not.toContain("sourceText");
  });

  it("rejects invalid plan artifacts", () => {
    expect(reviewWalkthroughPlan({ id: "partial" } as never)).toEqual({
      ok: false,
      errors: [{ code: "invalid_plan", message: "Walkthrough review requires a valid plan." }],
    });
  });
});
