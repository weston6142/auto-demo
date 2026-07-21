import { describe, expect, it } from "vitest";
import type { CoordinateTraceRecord } from "./coordinateDiscoverySession.js";
import { finalizeCoordinateDiscovery } from "./coordinateDiscoveryFinalize.js";
import { reviewWalkthroughPlan } from "./walkthroughReview.js";
import type { WalkthroughPlan } from "./index.js";

function readyReview(plan: WalkthroughPlan) {
  return {
    ok: true as const,
    review: {
      planId: plan.id,
      source: plan.source.parser,
      target: plan.target.url,
      mode: plan.mode,
      state: plan.state,
      steps: plan.steps.map((step) => ({
        id: step.id,
        order: step.order,
        action: step.action,
        summary: step.public.summary,
      })),
      warnings: [],
      questions: [],
      blockers: [],
      approval: { eligible: true as const, basis: "validated" as const },
      summary: "Ready for approval.",
    },
  };
}

const makeTarget = {
  id: "target-make",
  label: "Make",
  role: "combobox",
  occurrence: 1,
  disabled: false,
  form: {
    required: false,
    hasValue: true,
    validity: "valid" as const,
    selectedOption: "Any make",
    options: [
      { label: "Any make", disabled: false, selected: true },
      { label: "Kia", disabled: false, selected: false },
    ],
  },
};

function trace(): CoordinateTraceRecord[] {
  return [
    {
      actionIndex: 0,
      actionType: "click",
      semanticAction: { kind: "click", targetId: "target-make" },
      target: makeTarget,
      publicEffect: "popup",
    },
    {
      actionIndex: 1,
      actionType: "keypress",
      semanticAction: { kind: "select", targetId: "target-make", optionLabel: "Kia" },
      target: makeTarget,
      publicEffect: "form-change",
    },
    {
      actionIndex: 2,
      actionType: "click",
      semanticAction: { kind: "click", targetId: "target-first-organic" },
      target: {
        id: "target-first-organic",
        label: "Organic vehicle",
        role: "link",
        occurrence: 1,
        disabled: false,
        structure: {
          container: { role: "list", label: "Results", occurrence: 1 },
          item: { role: "listitem", position: 1, promotion: "exclude-marked-promoted" },
        },
      },
      publicEffect: "navigation",
      pageBefore: { url: "https://example.test/search", title: "Search" },
      pageAfter: { url: "https://example.test/vehicle/1", title: "Vehicle" },
    },
  ];
}

describe("coordinate discovery finalization", () => {
  it("compiles semantic coordinate evidence and returns only replay-validated review artifacts", async () => {
    const result = await finalizeCoordinateDiscovery(
      {
        sessionId: "discovery-123",
        targetUrl: "https://example.test/search",
        goal: "Select Kia and open the first organic result",
        trace: trace(),
        runtimeBindings: {},
      },
      {
        now: () => new Date("2026-07-21T12:00:00.000Z"),
        async replay({ plan }) {
          return {
            ok: true,
            attempts: 1,
            plan: {
              ...plan,
              state: "validated",
            },
          };
        },
        review: readyReview,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      phase: "review_required",
      replayAttempts: 1,
      plan: { state: "validated" },
      review: { blockers: [] },
    });
    if (!result.ok || result.phase !== "review_required") throw new Error("review missing");
    expect(result.plan.steps.filter((step) => step.action !== "assert")).toMatchObject([
      { action: "click", targetHint: { label: "Make", role: "combobox" } },
      { action: "select", optionLabel: "Kia" },
      {
        action: "click",
        targetHint: {
          structure: {
            item: { position: 1, promotion: "exclude-marked-promoted" },
          },
        },
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/"x"\s*:/);
    expect(JSON.stringify(result)).not.toMatch(/"y"\s*:/);
  });

  it("blocks compilation at a state-changing action without semantic intent", async () => {
    const result = await finalizeCoordinateDiscovery(
      {
        sessionId: "discovery-123",
        targetUrl: "https://example.test/search",
        goal: "Open results",
        trace: [
          {
            actionIndex: 4,
            actionType: "keypress",
            publicEffect: "form-change",
          },
        ],
        runtimeBindings: {},
      },
      {
        now: () => new Date("2026-07-21T12:00:00.000Z"),
        async replay() {
          throw new Error("replay must not run");
        },
        review: reviewWalkthroughPlan,
      },
    );

    expect(result).toEqual({
      ok: false,
      code: "unmappable_coordinate_action",
      message: "Coordinate action could not be mapped to replayable intent.",
      actionIndex: 4,
    });
  });

  it("returns bounded repair state when fresh semantic replay fails", async () => {
    const result = await finalizeCoordinateDiscovery(
      {
        sessionId: "discovery-123",
        targetUrl: "https://example.test/search",
        goal: "Select Kia and open results",
        trace: trace(),
        runtimeBindings: {},
      },
      {
        now: () => new Date("2026-07-21T12:00:00.000Z"),
        async replay() {
          return {
            ok: false,
            attempts: 1,
            failure: { code: "target_missing", stepId: "step-3" },
          };
        },
        review: reviewWalkthroughPlan,
      },
    );

    expect(result).toEqual({
      ok: true,
      phase: "repairing",
      replayAttempts: 1,
      failure: { code: "target_missing", stepId: "step-3" },
    });
  });
});
