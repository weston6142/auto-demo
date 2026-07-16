import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  compileDiscoverySessionToWalkthroughPlan,
  type DiscoverySessionV1,
} from "./index.js";

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(`../fixtures/${name}`, import.meta.url), "utf8"),
  ) as unknown;
}

describe("compileDiscoverySessionToWalkthroughPlan", () => {
  it("compiles only the selected successful path into a draft unapproved plan", async () => {
    const session = await fixture("discovery-session-with-abandoned-attempts.json");
    const original = structuredClone(session);

    const result = compileDiscoverySessionToWalkthroughPlan(session);

    expect(result).toMatchObject({
      ok: true,
      plan: {
        target: { kind: "browser", url: "https://example.com/checkout" },
        mode: "validate-first",
        state: "draft",
        source: { parser: "discovery-v1" },
        steps: [
          {
            id: "step-1",
            action: "click",
            targetHint: { kind: "accessible", label: "Checkout", role: "button" },
            provenance: { attemptId: "attempt-checkout" },
          },
          {
            id: "step-2",
            action: "assert",
            assertion: {
              kind: "navigation",
              url: "https://example.com/payment",
              match: "same-origin-path",
            },
          },
          {
            id: "step-3",
            action: "assert",
            assertion: { kind: "visible-state", condition: "Payment details" },
            targetHint: { kind: "accessible", label: "Payment details" },
          },
        ],
        questions: [],
        approvals: { required: true, approved: false },
        execution: { status: "not-started" },
      },
    });
    expect(result.ok && result.plan.validation).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("attempt-abandoned");
    expect(session).toEqual(original);
  });

  it("is deterministic and rejects sessions that are not completed", async () => {
    const session = await fixture("discovery-session-completed.json");
    expect(compileDiscoverySessionToWalkthroughPlan(session)).toEqual(
      compileDiscoverySessionToWalkthroughPlan(session),
    );

    const active = structuredClone(session) as DiscoverySessionV1;
    active.status = "active";
    delete active.terminal;
    expect(compileDiscoverySessionToWalkthroughPlan(active)).toEqual({
      ok: false,
      errors: [
        {
          code: "incomplete_discovery_session",
          message: "Discovery plan compilation requires a completed session.",
        },
      ],
    });
  });

  it("normalizes inspect into assertions without a browser action", async () => {
    const session = (await fixture("discovery-session-completed.json")) as DiscoverySessionV1;
    session.attempts[0].action = { kind: "inspect" };

    const result = compileDiscoverySessionToWalkthroughPlan(session);

    expect(result.ok && result.plan.steps.map((step) => step.action)).toEqual([
      "assert",
      "assert",
    ]);
    expect(result.ok && result.plan.steps[0].provenance).toMatchObject({
      normalizedFrom: "inspect",
    });
    expect(result.ok && result.plan.warnings).toEqual([
      {
        code: "normalized_discovery_action",
        message: "Discovery-only actions were normalized for deterministic walkthrough replay.",
      },
    ]);
  });

  it.each([
    ["navigate", { kind: "navigate", url: "https://example.com/payment" }, "navigate"],
    [
      "type",
      {
        kind: "type",
        targetId: "target-checkout",
        inputBinding: "demo-query",
        valueClass: "demo-data",
      },
      "type",
    ],
    ["wait", { kind: "wait", durationMs: 500 }, "wait"],
    ["back", { kind: "back" }, "navigate"],
    ["refresh", { kind: "refresh" }, "navigate"],
  ] as const)("compiles the %s discovery action", async (_name, action, expectedAction) => {
    const session = (await fixture("discovery-session-completed.json")) as DiscoverySessionV1;
    session.attempts[0].action = action;

    const result = compileDiscoverySessionToWalkthroughPlan(session);

    expect(result.ok && result.plan.steps[0]).toMatchObject({ action: expectedAction });
    if (action.kind === "type") {
      expect(result.ok && result.plan.steps[0]).toMatchObject({
        inputBinding: "demo-query",
        targetHint: { label: "Checkout", role: "button" },
      });
    }
    if (action.kind === "wait") {
      expect(result.ok && result.plan.steps[0]).toMatchObject({ waitDurationMs: 500 });
    }
    if (action.kind === "back" || action.kind === "refresh") {
      expect(result.ok && result.plan.steps[0]).toMatchObject({
        navigationUrl: "https://example.com/payment",
        provenance: { normalizedFrom: action.kind },
      });
    }
  });

  it("compiles a public visible-state condition without copying effect text", async () => {
    const session = (await fixture("discovery-session-completed.json")) as DiscoverySessionV1;
    const attempt = session.attempts[0];
    if (attempt.status === "pending") throw new Error("fixture attempt must be finalized");
    attempt.derivedExpectations[0] = {
      id: "expectation-visible-attempt-checkout",
      kind: "visible-state",
      origin: "derived-from-observation",
      publicCondition: "Payment details",
      role: "heading",
    };

    const result = compileDiscoverySessionToWalkthroughPlan(session);

    expect(result.ok && result.plan.steps.at(-1)).toMatchObject({
      assertion: { kind: "visible-state", condition: "Payment details", role: "heading" },
      targetHint: { kind: "accessible", label: "Payment details", role: "heading" },
    });
    expect(JSON.stringify(result)).not.toContain("Payment details are visible");
  });
});
