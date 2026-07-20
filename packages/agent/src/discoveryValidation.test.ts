import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createDiscoverySession, DISCOVERY_LIMITS, validateDiscoverySession } from "./index.js";

const valid = createDiscoverySession({
  id: "session-checkout",
  target: { kind: "browser", startUrl: "https://example.com/checkout" },
  goal: "Show checkout",
  host: { name: "codex", version: "1.0.0" },
  createdAt: "2026-07-13T12:00:00.000Z",
});

const agentRoot =
  basename(process.cwd()) === "agent" ? process.cwd() : join(process.cwd(), "packages", "agent");

async function readFixture(name: string) {
  return JSON.parse(await readFile(join(agentRoot, "fixtures", name), "utf8"));
}

describe("discovery session validation", () => {
  it("round-trips a valid JSON artifact", () => {
    expect(valid.ok).toBe(true);
    const artifact = JSON.parse(JSON.stringify(valid.ok ? valid.session : null));
    expect(validateDiscoverySession(artifact)).toEqual(valid);
  });

  it("rejects unsupported versions and unknown properties", () => {
    expect(validateDiscoverySession({ schemaVersion: 2 })).toMatchObject({
      ok: false,
      errors: [{ code: "unsupported_discovery_schema" }],
    });
    expect(
      validateDiscoverySession({
        ...(valid.ok ? valid.session : {}),
        extraSecret: "sk-live-secret",
      }),
    ).toMatchObject({
      ok: false,
      errors: [{ code: "unsafe_discovery_content", path: "unknown" }],
    });
  });

  it("returns stable limit errors for oversized loaded artifacts", () => {
    if (!valid.ok) throw new Error("fixture session must be valid");
    for (const artifact of [
      {
        ...valid.session,
        observations: Array.from({ length: DISCOVERY_LIMITS.observations + 1 }, () => ({})),
      },
      {
        ...valid.session,
        attempts: Array.from({ length: DISCOVERY_LIMITS.attempts + 1 }, () => ({})),
      },
      {
        ...valid.session,
        goal: "x".repeat(DISCOVERY_LIMITS.serializedBytes),
      },
    ]) {
      expect(validateDiscoverySession(artifact)).toMatchObject({
        ok: false,
        errors: [{ code: "session_limit_exceeded" }],
      });
    }
  });

  it("validates portable fixtures and rejects their deliberate defects", async () => {
    for (const name of [
      "discovery-session-completed.json",
      "discovery-session-with-abandoned-attempts.json",
    ]) {
      expect(validateDiscoverySession(await readFixture(name)), name).toMatchObject({
        ok: true,
        session: { status: "completed" },
      });
    }
    expect(
      validateDiscoverySession(await readFixture("discovery-session-invalid-version.json")),
    ).toMatchObject({ ok: false, errors: [{ code: "unsupported_discovery_schema" }] });
    expect(
      validateDiscoverySession(await readFixture("discovery-session-invalid-reference.json")),
    ).toMatchObject({ ok: false, errors: [{ code: "invalid_selected_path" }] });
    const unsafe = validateDiscoverySession(
      await readFixture("discovery-session-unsafe-content.json"),
    );
    expect(unsafe).toMatchObject({
      ok: false,
      errors: [{ code: "unsafe_discovery_content", path: "unknown" }],
    });
    expect(JSON.stringify(unsafe)).not.toContain("hunter2");
  });

  it("rejects unsanitized loaded host metadata without echoing it", () => {
    if (!valid.ok) throw new Error("fixture session must be valid");
    const secret = "sk-live-secretvalue";
    const result = validateDiscoverySession({
      ...valid.session,
      host: { ...valid.session.host, model: secret },
    });
    expect(result).toMatchObject({
      ok: false,
      errors: [{ code: "unsafe_discovery_content", path: "host.model" }],
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("rejects malformed, contradictory, and pre-action selected evidence", async () => {
    const completed = await readFixture("discovery-session-completed.json");
    const malformed = structuredClone(completed);
    malformed.attempts[0].expectations[0].url = null;
    expect(() => validateDiscoverySession(malformed)).not.toThrow();
    expect(validateDiscoverySession(malformed)).toMatchObject({ ok: false });

    const contradictory = structuredClone(completed);
    contradictory.attempts[0].expectations[0].url = "https://example.com/account";
    expect(validateDiscoverySession(contradictory)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: "invalid_selected_path" })]),
    });

    const preAction = structuredClone(completed);
    preAction.observations[1].observedAt = "2026-07-13T12:00:01.500Z";
    expect(validateDiscoverySession(preAction)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: "invalid_selected_path" })]),
    });
  });

  it("rejects control-state evidence that contradicts the after observation", async () => {
    const completed = await readFixture("discovery-session-completed.json");
    completed.observations[1].interactiveTargets = [
      {
        id: "target-condition",
        label: "Condition",
        role: "combobox",
        disabled: false,
        form: {
          required: true,
          hasValue: true,
          validity: "valid",
          selectedOption: "New",
          options: [{ label: "New", disabled: false, selected: true }],
        },
      },
    ];
    completed.attempts[0].derivedExpectations.push({
      id: "expectation-condition-state",
      kind: "control-state",
      origin: "derived-from-observation",
      targetId: "target-condition",
      state: { selectedOption: "New" },
    });
    completed.attempts[0].observedEffects.push({
      expectationId: "expectation-condition-state",
      status: "matched",
      observationId: "observation-payment-attempt-checkout",
      summary: "Condition is New",
    });
    expect(validateDiscoverySession(completed)).toMatchObject({ ok: true });

    completed.attempts[0].derivedExpectations.at(-1).state.selectedOption = "Used";
    expect(validateDiscoverySession(completed)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: "invalid_selected_path" })]),
    });
  });

  it("accepts bounded structural target context and rejects unsafe variants", async () => {
    const completed = await readFixture("discovery-session-completed.json");
    const target = completed.observations[0].interactiveTargets[0];
    target.structure = {
      container: { role: "list", label: "Vehicle results", occurrence: 1 },
      item: {
        role: "listitem",
        position: 1,
        promotion: "exclude-marked-promoted",
      },
    };

    expect(validateDiscoverySession(completed)).toMatchObject({ ok: true });

    const invalidStructures: unknown[] = [
      { ...target.structure, extra: true },
      { ...target.structure, container: { ...target.structure.container, label: "" } },
      { ...target.structure, container: { role: "dialog" } },
      { ...target.structure, item: { ...target.structure.item, position: 0 } },
      { ...target.structure, item: { ...target.structure.item, position: 1.5 } },
      { ...target.structure, item: { ...target.structure.item, position: 101 } },
      {
        ...target.structure,
        container: { role: "form", label: "Search" },
        item: { ...target.structure.item },
      },
      { ...target.structure, container: { role: "list", label: "token=private-value" } },
    ];

    for (const structure of invalidStructures) {
      const malformed = structuredClone(completed);
      malformed.observations[0].interactiveTargets[0].structure = structure;
      const result = validateDiscoverySession(malformed);
      expect(result).toMatchObject({ ok: false });
      expect(JSON.stringify(result)).not.toContain("private-value");
    }
  });

  it("never echoes attacker-controlled unknown property names", () => {
    if (!valid.ok) throw new Error("fixture session must be valid");
    const result = validateDiscoverySession({
      ...valid.session,
      "password=hunter2": true,
    });
    expect(result).toMatchObject({
      ok: false,
      errors: [{ code: "unsafe_discovery_content", path: "unknown" }],
    });
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });
});
