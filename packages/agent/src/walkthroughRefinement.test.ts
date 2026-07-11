import { describe, expect, it } from "vitest";
import {
  approveWalkthroughPlan,
  createWalkthroughPlan,
  refineWalkthroughPlan,
  type WalkthroughPlan,
  type WalkthroughPlanRefinement,
  type WalkthroughPlanStep,
  type WalkthroughValidationBrowserRunner,
} from "./index.js";

function createPlan(script = "Click Get started."): WalkthroughPlan {
  const result = createWalkthroughPlan({
    targetUrl: "https://example.com/signup",
    script,
    mode: "validate-first",
  });
  if (!result.ok) throw new Error("test plan should be valid");
  return result.plan;
}

function ambiguousPlan(): WalkthroughPlan {
  const plan = createPlan();
  plan.state = "needs-clarification";
  plan.validation = {
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
          {
            id: "candidate-1",
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
            id: "candidate-2",
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
  return plan;
}

function runner(): WalkthroughValidationBrowserRunner {
  return {
    async open() {},
    async navigate() {},
    async inspectPage() {
      return { url: "https://example.com/signup", title: "Signup", authWall: false };
    },
    async findMatches(step) {
      return [
        {
          id: `${step.id}-match`,
          label: step.targetHint?.label ?? step.public.summary,
          ...(step.targetHint?.role === undefined ? {} : { role: step.targetHint.role }),
          ...(step.targetHint === undefined ? {} : { targetHint: step.targetHint }),
        },
      ];
    },
    async click() {},
    async type() {},
    async waitForIdle() {},
    async close() {},
  };
}

function replacement(): Omit<WalkthroughPlanStep, "id" | "order" | "questionId"> {
  return {
    action: "click",
    resolution: "resolved",
    sourceText: "Click Get started.",
    public: { summary: "Click Get started." },
    targetHint: { kind: "accessible", label: "Get started", role: "button" },
  };
}

describe("refineWalkthroughPlan", () => {
  it("selects a durable candidate hint and automatically revalidates", async () => {
    const result = await refineWalkthroughPlan(
      ambiguousPlan(),
      [
        {
          kind: "select-candidate",
          stepId: "step-1",
          blockerId: "blocker-1",
          candidateId: "candidate-2",
        },
      ],
      { now: () => new Date("2026-07-10T14:00:00.000Z") },
      { browser: runner() },
    );

    expect(result).toMatchObject({
      ok: true,
      plan: {
        state: "validated",
        steps: [{ targetHint: { kind: "accessible", occurrence: 2 } }],
        approvals: { approved: false },
        validation: { status: "ready", validatedAt: "2026-07-10T14:00:00.000Z" },
      },
      review: { approval: { eligible: true } },
    });
  });

  it("replaces an unresolved step while preserving identity and order", async () => {
    const input = createPlan("Pick the best option. Verify dashboard appears.");
    const result = await refineWalkthroughPlan(
      input,
      [{ kind: "replace-step", stepId: "step-1", replacement: replacement() }],
      {},
      { browser: runner() },
    );

    expect(result).toMatchObject({
      ok: true,
      plan: {
        steps: [
          { id: "step-1", order: 1, action: "click", resolution: "resolved" },
          { id: "step-2", order: 2, action: "assert" },
        ],
        questions: [],
      },
    });
  });

  it("rejects replacement fields that try to overwrite step identity", async () => {
    const result = await refineWalkthroughPlan(
      createPlan("Pick the best option."),
      [
        {
          kind: "replace-step",
          stepId: "step-1",
          replacement: {
            ...replacement(),
            id: "step-99",
            order: 1,
          },
        },
      ] as never,
      {},
      { browser: runner() },
    );

    expect(result).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_refinement" }],
    });
  });

  it("rejects a mixed batch atomically", async () => {
    const refinements: WalkthroughPlanRefinement[] = [
      {
        kind: "select-candidate",
        stepId: "step-1",
        blockerId: "blocker-1",
        candidateId: "candidate-2",
      },
      { kind: "replace-step", stepId: "missing", replacement: replacement() },
    ];

    const result = await refineWalkthroughPlan(
      ambiguousPlan(),
      refinements,
      {},
      { browser: runner() },
    );

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "unknown_refinement_step",
          message: "Walkthrough refinement step was not found.",
        },
      ],
    });
  });

  it("rejects stale or non-persistable candidate choices", async () => {
    const stale = await refineWalkthroughPlan(
      ambiguousPlan(),
      [
        {
          kind: "select-candidate",
          stepId: "step-1",
          blockerId: "missing-blocker",
          candidateId: "candidate-2",
        },
      ],
      {},
      { browser: runner() },
    );
    const withoutHint = ambiguousPlan();
    delete withoutHint.validation?.blockers[0].candidates?.[0].targetHint;
    const nonPersistable = await refineWalkthroughPlan(
      withoutHint,
      [
        {
          kind: "select-candidate",
          stepId: "step-1",
          blockerId: "blocker-1",
          candidateId: "candidate-1",
        },
      ],
      {},
      { browser: runner() },
    );

    expect(stale).toMatchObject({ ok: false, errors: [{ code: "stale_validation_blocker" }] });
    expect(nonPersistable).toMatchObject({
      ok: false,
      errors: [{ code: "candidate_not_persistable" }],
    });
  });

  it("clears approval and preserves the refined plan when revalidation cannot start", async () => {
    const approved = approveWalkthroughPlan(
      {
        ...ambiguousPlan(),
        state: "validated",
        validation: {
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
        },
      },
      { now: () => new Date("2026-07-10T13:00:00.000Z") },
    );
    if (!approved.ok) throw new Error("test plan should approve");
    const failing = runner();
    failing.open = async () => {
      throw new Error("browser unavailable");
    };

    const result = await refineWalkthroughPlan(
      approved.plan,
      [{ kind: "replace-step", stepId: "step-1", replacement: replacement() }],
      {},
      { browser: failing },
    );

    expect(result).toMatchObject({
      ok: false,
      plan: { state: "draft", approvals: { approved: false } },
      errors: [{ code: "browser_setup_failed" }],
    });
    expect(result.ok || !("plan" in result) || result.plan.validation).toBeUndefined();
  });

  it("rejects secret-bearing or destructive replacement steps", async () => {
    const bestGuess = createPlan("Pick the best option.");
    bestGuess.mode = "best-guess";
    const typedSecret = await refineWalkthroughPlan(
      bestGuess,
      [
        {
          kind: "replace-step",
          stepId: "step-1",
          replacement: {
            action: "type",
            resolution: "resolved",
            sourceText: "Type hunter2 into Password.",
            public: { summary: "Type hunter2 into Password." },
          },
        },
      ],
      {},
      { browser: runner() },
    );
    const destructive = await refineWalkthroughPlan(
      bestGuess,
      [
        {
          kind: "replace-step",
          stepId: "step-1",
          replacement: {
            action: "click",
            resolution: "resolved",
            sourceText: "Click Delete account.",
            public: { summary: "Click Delete account." },
          },
        },
      ],
      {},
      { browser: runner() },
    );
    const disguisedDestructive = await refineWalkthroughPlan(
      bestGuess,
      [
        {
          kind: "replace-step",
          stepId: "step-1",
          replacement: {
            action: "click",
            resolution: "resolved",
            sourceText: "Click profile.",
            public: { summary: "Click profile." },
            targetHint: {
              kind: "accessible",
              label: "Delete account",
              role: "button",
            },
          },
        },
      ],
      {},
      { browser: runner() },
    );
    const unsafeNavigation = await refineWalkthroughPlan(
      bestGuess,
      [
        {
          kind: "replace-step",
          stepId: "step-1",
          replacement: {
            action: "navigate",
            resolution: "resolved",
            sourceText: "Navigate to javascript:alert(1).",
            public: { summary: "Navigate to javascript:alert(1)." },
          },
        },
      ],
      {},
      { browser: runner() },
    );

    expect(typedSecret).toMatchObject({
      ok: false,
      errors: [{ code: "unsupported_replacement_action" }],
    });
    expect(destructive).toMatchObject({
      ok: false,
      errors: [{ code: "unsupported_replacement_action" }],
    });
    expect(disguisedDestructive).toMatchObject({
      ok: false,
      errors: [{ code: "unsupported_replacement_action" }],
    });
    expect(unsafeNavigation).toMatchObject({
      ok: false,
      errors: [{ code: "unsupported_replacement_action" }],
    });
    expect(JSON.stringify([typedSecret, destructive, disguisedDestructive])).not.toContain(
      "hunter2",
    );
  });

  it("preserves execution data on safe replacement steps", async () => {
    const bestGuess = createPlan("Pick the best option.");
    bestGuess.mode = "best-guess";

    const result = await refineWalkthroughPlan(
      bestGuess,
      [
        {
          kind: "replace-step",
          stepId: "step-1",
          replacement: {
            action: "type",
            resolution: "resolved",
            sourceText: "Type [redacted] into Search.",
            public: { summary: "Type [redacted] into Search." },
            targetHint: { kind: "accessible", label: "Search" },
            inputBinding: "step-1",
          },
        },
      ],
      {},
      { browser: runner() },
    );

    expect(result).toMatchObject({
      ok: true,
      plan: {
        steps: [
          {
            action: "type",
            inputBinding: "step-1",
            targetHint: { label: "Search" },
          },
        ],
      },
    });
  });

  it("returns structured errors for malformed refinement data and unsafe hints", async () => {
    const malformed = await refineWalkthroughPlan(
      ambiguousPlan(),
      [null] as never,
      {},
      { browser: runner() },
    );
    const unsafe = ambiguousPlan();
    const candidate = unsafe.validation?.blockers[0]?.candidates?.[0];
    if (candidate?.targetHint === undefined) throw new Error("test candidate should have a hint");
    candidate.targetHint.label = "password=hunter2";
    const unsafeHint = await refineWalkthroughPlan(
      unsafe,
      [
        {
          kind: "select-candidate",
          stepId: "step-1",
          blockerId: "blocker-1",
          candidateId: "candidate-1",
        },
      ],
      {},
      { browser: runner() },
    );

    expect(malformed).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_refinement" }],
    });
    expect(unsafeHint).toMatchObject({
      ok: false,
      errors: [{ code: "candidate_not_persistable" }],
    });
    expect(JSON.stringify(unsafeHint)).not.toContain("hunter2");
  });

  it("does not echo malformed refinement identifiers", async () => {
    const result = await refineWalkthroughPlan(
      ambiguousPlan(),
      [
        {
          kind: "select-candidate",
          stepId: "password=hunter2",
          blockerId: "blocker-1",
          candidateId: "candidate-1",
        },
      ],
      {},
      { browser: runner() },
    );

    expect(result).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_refinement" }],
    });
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });

  it("allowlists refined best-guess output fields", async () => {
    const bestGuess = createPlan("Pick the best option.");
    bestGuess.mode = "best-guess";
    Object.assign(bestGuess, { extraSecret: "password=hunter2" });
    const replacementWithExtra = {
      ...replacement(),
      extraSecret: "token=sk-live-secret",
    };

    const result = await refineWalkthroughPlan(
      bestGuess,
      [
        {
          kind: "replace-step",
          stepId: "step-1",
          replacement: replacementWithExtra,
        },
      ],
      {},
      { browser: runner() },
    );
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({ ok: true, plan: { state: "draft" } });
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("sk-live-secret");
    expect(serialized).not.toContain("extraSecret");
  });
});
