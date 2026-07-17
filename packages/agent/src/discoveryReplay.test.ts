import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  compileDiscoverySessionToWalkthroughPlan,
  replayAndRepairDiscoveryPlan,
  type DiscoveryReplayBrowserFactory,
  type DiscoverySessionV1,
  type WalkthroughPlan,
} from "./index.js";

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

function countingFactory(counter: { creates: number }): DiscoveryReplayBrowserFactory {
  return {
    async create() {
      counter.creates += 1;
      throw new Error("preflight tests must not create a browser");
    },
  };
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
