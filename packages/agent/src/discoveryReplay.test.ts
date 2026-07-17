import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  compileDiscoverySessionToWalkthroughPlan,
  replayAndRepairDiscoveryPlan,
  type DiscoveryReplayBrowser,
  type DiscoveryReplayBrowserFactory,
  type DiscoveryReplayMatch,
  type DiscoverySessionV1,
  type WalkthroughPlan,
} from "./index.js";

class FakeReplayBrowser implements DiscoveryReplayBrowser {
  readonly calls: string[] = [];
  readonly typedValues: string[] = [];
  closeCalls = 0;
  matches: DiscoveryReplayMatch[] = [
    { id: "candidate-1", label: "Checkout", role: "button" },
  ];
  failNavigationAssertion = false;

  async open(url: string) {
    this.calls.push(`open:${url}`);
  }
  async findMatches() {
    this.calls.push("findMatches");
    return structuredClone(this.matches);
  }
  async navigate(url: string) {
    this.calls.push(`navigate:${url}`);
  }
  async click(match: DiscoveryReplayMatch) {
    this.calls.push(`click:${match.id}`);
  }
  async type(match: DiscoveryReplayMatch, value: string) {
    this.calls.push(`type:${match.id}`);
    this.typedValues.push(value);
  }
  async wait(durationMs: number) {
    this.calls.push(`wait:${durationMs}`);
  }
  async waitForSettled() {
    this.calls.push("settled");
  }
  async assertVisible() {
    this.calls.push("assertVisible");
  }
  async assertNavigation() {
    this.calls.push("assertNavigation");
    if (this.failNavigationAssertion) throw new Error("private page failure");
  }
  async inspectPage() {
    return { url: "https://example.com/payment?token=private" };
  }
  async close() {
    this.closeCalls += 1;
  }
}

async function compiledFixture(): Promise<{
  sourceSession: DiscoverySessionV1;
  plan: WalkthroughPlan;
}> {
  const sourceSession = JSON.parse(
    await readFile(
      new URL("../fixtures/discovery-session-completed.json", import.meta.url),
      "utf8",
    ),
  ) as DiscoverySessionV1;
  const compiled = compileDiscoverySessionToWalkthroughPlan(sourceSession);
  if (!compiled.ok) throw new Error("replay fixture must compile");
  return { sourceSession, plan: compiled.plan };
}

async function safeCompiledFixture(): Promise<{
  sourceSession: DiscoverySessionV1;
  plan: WalkthroughPlan;
}> {
  const input = await compiledFixture();
  input.sourceSession.observations[0].interactiveTargets[0].label = "Continue";
  const compiled = compileDiscoverySessionToWalkthroughPlan(input.sourceSession);
  if (!compiled.ok) throw new Error("safe replay fixture must compile");
  return { sourceSession: input.sourceSession, plan: compiled.plan };
}

function countingFactory(counter: { creates: number }): DiscoveryReplayBrowserFactory {
  return {
    async create() {
      counter.creates += 1;
      throw new Error("preflight tests must not create a browser");
    },
  };
}

function browserFactory(browser: DiscoveryReplayBrowser): DiscoveryReplayBrowserFactory {
  return { async create() { return browser; } };
}

describe("replayAndRepairDiscoveryPlan preflight", () => {
  it("rejects a plan that does not canonically match its source session", async () => {
    const input = await compiledFixture();
    input.plan.steps[0].public.summary = "Tampered step";
    const counter = { creates: 0 };

    const result = await replayAndRepairDiscoveryPlan(input, {}, {
      browserFactory: countingFactory(counter),
    });

    expect(result).toEqual({
      ok: false,
      phase: "preflight",
      attempts: [],
      errors: [
        {
          code: "plan_source_mismatch",
          message: "Discovery replay plan does not match its compiled source session.",
        },
      ],
    });
    expect(counter.creates).toBe(0);
  });

  it("rejects non-draft lifecycle state before creating a browser", async () => {
    const input = await compiledFixture();
    input.plan.state = "validated";
    const counter = { creates: 0 };

    const result = await replayAndRepairDiscoveryPlan(input, {}, {
      browserFactory: countingFactory(counter),
    });

    expect(result).toMatchObject({
      ok: false,
      phase: "preflight",
      errors: [{ code: "invalid_replay_state" }],
    });
    expect(counter.creates).toBe(0);
  });

  it("requires exact runtime bindings without serializing their values", async () => {
    const input = await compiledFixture();
    input.sourceSession.attempts[0].action = {
      kind: "type",
      targetId: "target-checkout",
      inputBinding: "demo-name",
      valueClass: "demo-data",
    };
    const compiled = compileDiscoverySessionToWalkthroughPlan(input.sourceSession);
    if (!compiled.ok) throw new Error("type replay fixture must compile");
    input.plan = compiled.plan;
    const counter = { creates: 0 };

    const missing = await replayAndRepairDiscoveryPlan(input, {}, {
      browserFactory: countingFactory(counter),
    });
    const secret = await replayAndRepairDiscoveryPlan(
      { ...input, inputBindings: { "demo-name": "sk-example123456789" } },
      {},
      { browserFactory: countingFactory(counter) },
    );
    const unexpected = await replayAndRepairDiscoveryPlan(
      { ...input, inputBindings: { "demo-name": "Demo Person", unused: "value" } },
      {},
      { browserFactory: countingFactory(counter) },
    );

    expect(missing).toMatchObject({ errors: [{ code: "missing_input_binding" }] });
    expect(secret).toMatchObject({ errors: [{ code: "invalid_input_binding" }] });
    expect(unexpected).toMatchObject({ errors: [{ code: "unexpected_input_binding" }] });
    expect(JSON.stringify(secret)).not.toContain("sk-example123456789");
    expect(counter.creates).toBe(0);
  });

  it("rejects invalid repair limits and undeclared navigation origins", async () => {
    const input = await compiledFixture();
    const counter = { creates: 0 };
    const invalidLimit = await replayAndRepairDiscoveryPlan(
      input,
      { maxRepairs: 3 as 2 },
      { browserFactory: countingFactory(counter) },
    );

    input.sourceSession.attempts[0].action = {
      kind: "navigate",
      url: "https://other.example.com/payment",
    };
    const compiled = compileDiscoverySessionToWalkthroughPlan(input.sourceSession);
    if (!compiled.ok) throw new Error("navigation replay fixture must compile");
    input.plan = compiled.plan;
    const outOfScope = await replayAndRepairDiscoveryPlan(input, {}, {
      browserFactory: countingFactory(counter),
    });

    expect(invalidLimit).toMatchObject({ errors: [{ code: "invalid_replay_options" }] });
    expect(outOfScope).toMatchObject({
      errors: [{ code: "replay_navigation_out_of_scope" }],
    });
    expect(counter.creates).toBe(0);
  });
});

describe("replayAndRepairDiscoveryPlan single attempt", () => {
  it("validates a blocker-free replay without approving or capturing", async () => {
    const input = await safeCompiledFixture();
    const browser = new FakeReplayBrowser();
    browser.matches = [{ id: "candidate-1", label: "Continue", role: "button" }];

    const result = await replayAndRepairDiscoveryPlan(
      input,
      {
        maxRepairs: 0,
        now: () => new Date("2026-07-16T12:00:00.000Z"),
        replayIdGenerator: () => "replay-1",
      },
      { browserFactory: browserFactory(browser) },
    );

    expect(result).toMatchObject({
      ok: true,
      plan: {
        state: "validated",
        approvals: { required: true, approved: false },
        execution: { status: "not-started" },
        validation: {
          status: "ready",
          mode: "discovery-replay",
          replay: { replayId: "replay-1", attempts: 1 },
        },
      },
      attempts: [{ attempt: 1, status: "passed" }],
      review: { approval: { eligible: true, basis: "validated" } },
    });
    expect(browser.calls).toEqual([
      "open:https://example.com/checkout",
      "findMatches",
      "click:candidate-1",
      "settled",
      "assertNavigation",
      "assertVisible",
    ]);
    expect(browser.closeCalls).toBe(1);
  });

  it("uses runtime input without serializing its value", async () => {
    const input = await compiledFixture();
    input.sourceSession.attempts[0].action = {
      kind: "type",
      targetId: "target-checkout",
      inputBinding: "demo-name",
      valueClass: "demo-data",
    };
    const compiled = compileDiscoverySessionToWalkthroughPlan(input.sourceSession);
    if (!compiled.ok) throw new Error("type replay fixture must compile");
    input.plan = compiled.plan;
    const browser = new FakeReplayBrowser();

    const result = await replayAndRepairDiscoveryPlan(
      { ...input, inputBindings: { "demo-name": "Demo Person" } },
      { maxRepairs: 0 },
      { browserFactory: browserFactory(browser) },
    );

    expect(result.ok).toBe(true);
    expect(browser.typedValues).toEqual(["Demo Person"]);
    expect(JSON.stringify(result)).not.toContain("Demo Person");
  });

  it("returns provenance-linked failure evidence and stops at the failed step", async () => {
    const input = await compiledFixture();
    const browser = new FakeReplayBrowser();
    browser.matches = [];

    const result = await replayAndRepairDiscoveryPlan(
      input,
      { maxRepairs: 0, replayIdGenerator: () => "replay-failed" },
      { browserFactory: browserFactory(browser) },
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "replay",
      attempts: [
        {
          attempt: 1,
          status: "failed",
          failure: {
            code: "target_not_found",
            repairability: "repairable",
            step: {
              id: "step-1",
              provenance: { attemptId: "attempt-checkout" },
            },
            recommendation: "rediscover-target",
          },
        },
      ],
      errors: [{ code: "repair_limit_reached" }],
    });
    expect(browser.calls).toEqual(["open:https://example.com/checkout", "findMatches"]);
    expect(browser.closeCalls).toBe(1);
    expect(JSON.stringify(result)).not.toContain("token=private");
  });

  it("sanitizes assertion failures and always closes the browser", async () => {
    const input = await compiledFixture();
    const browser = new FakeReplayBrowser();
    browser.failNavigationAssertion = true;

    const result = await replayAndRepairDiscoveryPlan(
      input,
      { maxRepairs: 0 },
      { browserFactory: browserFactory(browser) },
    );

    expect(result).toMatchObject({
      ok: false,
      attempts: [{ failure: { code: "navigation_mismatch" } }],
    });
    expect(JSON.stringify(result)).not.toContain("private page failure");
    expect(JSON.stringify(result)).not.toContain("token=private");
    expect(browser.closeCalls).toBe(1);
  });
});
