import { describe, expect, it } from "vitest";
import {
  abandonDiscoverySession,
  beginDiscoveryAttempt,
  completeDiscoverySession,
  createDiscoverySession,
  createChildDiscoverySession,
  DISCOVERY_LIMITS,
  DISCOVERY_SCHEMA_VERSION,
  failDiscoverySession,
  finishDiscoveryAttempt,
  recordDiscoveryObservation,
  selectDiscoveryPath,
  validateDiscoverySession,
  type DiscoveryAction,
  type FinalizedDiscoveryAttempt,
  type DiscoverySessionV1,
} from "./index.js";

const SESSION_INPUT = {
  id: "session-checkout",
  target: { kind: "browser" as const, startUrl: "https://example.com/checkout" },
  goal: "Show the checkout flow",
  host: { name: "codex", version: "1.0.0", model: "gpt-5" },
  createdAt: "2026-07-13T12:00:00.000Z",
};

const OBSERVATION_INPUT = {
  id: "observation-1",
  observedAt: "2026-07-13T12:00:01.000Z",
  page: {
    url: "https://example.com/checkout",
    title: "Checkout",
    viewport: { width: 1280, height: 720 },
    navigation: { canGoBack: false },
  },
  visibleStates: [{ id: "visible-cart", kind: "text" as const, summary: "Your cart" }],
  interactiveTargets: [
    {
      id: "target-checkout",
      label: "Checkout",
      role: "button",
      disabled: false,
    },
  ],
  artifacts: [
    {
      id: "artifact-1",
      kind: "screenshot" as const,
      path: "artifacts/observation-1.png",
      mediaType: "image/png" as const,
    },
  ],
};

function session() {
  const result = createDiscoverySession(SESSION_INPUT);
  if (!result.ok) throw new Error("fixture session must be valid");
  return result.session;
}

function observedSession() {
  const result = recordDiscoveryObservation(session(), OBSERVATION_INPUT);
  if (!result.ok) throw new Error("fixture observation must be valid");
  return result.session;
}

const ATTEMPT_INPUT = {
  id: "attempt-1",
  startedAt: "2026-07-13T12:00:02.000Z",
  beforeObservationId: "observation-1",
  action: { kind: "click" as const, targetId: "target-checkout" },
  expectations: [
    {
      id: "expectation-1",
      kind: "navigation" as const,
      origin: "declared-before-action" as const,
      url: "https://example.com/payment",
      match: "same-origin-path" as const,
    },
  ],
  confidence: {
    level: "high" as const,
    bases: ["exact-accessible-target" as const],
  },
};

const SECRET_VALUES = [
  "password=hunter2",
  "Bearer abcdefghijklmnop",
  "sk-live-secretvalue",
  "eyJhbGciOiJIUzI1NiJ9.payload.signature",
  "token=abcdefghijklmnopqrstuvwx1234",
];

function successfulAttemptSession() {
  const begun = beginDiscoveryAttempt(observedSession(), ATTEMPT_INPUT);
  if (!begun.ok) throw new Error("fixture attempt must begin");
  const after = recordDiscoveryObservation(begun.session, {
    ...OBSERVATION_INPUT,
    id: "observation-2",
    observedAt: "2026-07-13T12:00:03.000Z",
    page: {
      ...OBSERVATION_INPUT.page,
      url: "https://example.com/payment",
      title: "Payment",
    },
    visibleStates: [{ id: "visible-payment", kind: "text", summary: "Payment details" }],
  });
  if (!after.ok) throw new Error("fixture observation must be valid");
  const finished = finishDiscoveryAttempt(after.session, "attempt-1", {
    status: "succeeded",
    finishedAt: "2026-07-13T12:00:04.000Z",
    afterObservationId: "observation-2",
    derivedExpectations: [
      {
        id: "expectation-2",
        kind: "visible-state",
        origin: "derived-from-observation",
        targetId: "visible-payment",
      },
    ],
    observedEffects: [
      {
        expectationId: "expectation-1",
        status: "matched",
        observationId: "observation-2",
        summary: "Reached payment",
      },
      {
        expectationId: "expectation-2",
        status: "matched",
        observationId: "observation-2",
        summary: "Payment details are visible",
      },
    ],
    outcome: { code: "action_completed", summary: "Checkout opened payment" },
  });
  if (!finished.ok) throw new Error("fixture attempt must finish");
  return finished.session;
}

describe("discovery session contract", () => {
  it("publishes one fixed version and bounded JSON contract", () => {
    expect(DISCOVERY_SCHEMA_VERSION).toBe(1);
    expect(DISCOVERY_LIMITS).toEqual({
      observations: 256,
      attempts: 256,
      selectedPathAttempts: 128,
      interactiveTargetsPerObservation: 100,
      visibleStatesPerObservation: 50,
      artifactReferencesPerObservation: 8,
      identifierCharacters: 128,
      publicStringCharacters: 2_000,
      waitDurationMs: 30_000,
      serializedBytes: 5 * 1024 * 1024,
      terminalReserveBytes: 64 * 1024,
    });

    const action: DiscoveryAction = {
      kind: "type",
      targetId: "target-company",
      inputBinding: "companyName",
      valueClass: "demo-data",
    };
    expect("value" in action).toBe(false);

    const compileOnly: DiscoverySessionV1 | undefined = undefined;
    expect(compileOnly).toBeUndefined();
  });

  it("creates an immutable active session from explicit identity and time", () => {
    const result = createDiscoverySession(SESSION_INPUT);

    expect(result).toEqual({
      ok: true,
      session: {
        schemaVersion: 1,
        id: "session-checkout",
        status: "active",
        target: { kind: "browser", startUrl: "https://example.com/checkout" },
        goal: "Show the checkout flow",
        host: { name: "codex", version: "1.0.0", model: "gpt-5" },
        createdAt: "2026-07-13T12:00:00.000Z",
        updatedAt: "2026-07-13T12:00:00.000Z",
        observations: [],
        attempts: [],
      },
    });
    expect(SESSION_INPUT).toEqual({
      id: "session-checkout",
      target: { kind: "browser", startUrl: "https://example.com/checkout" },
      goal: "Show the checkout flow",
      host: { name: "codex", version: "1.0.0", model: "gpt-5" },
      createdAt: "2026-07-13T12:00:00.000Z",
    });
  });

  it("records a sanitized bounded observation without mutating the session", () => {
    const before = session();
    const result = recordDiscoveryObservation(before, OBSERVATION_INPUT);

    expect(result.ok && result.session.observations[0]).toMatchObject({
      id: "observation-1",
      sequence: 1,
      page: { title: "Checkout", navigation: { canGoBack: false } },
    });
    expect(before.observations).toEqual([]);
  });

  it("rejects duplicate observation ids and unsafe artifact paths", () => {
    const first = recordDiscoveryObservation(session(), OBSERVATION_INPUT);
    if (!first.ok) throw new Error("first observation must be valid");
    expect(recordDiscoveryObservation(first.session, OBSERVATION_INPUT)).toMatchObject({
      ok: false,
      errors: [{ code: "duplicate_discovery_record", recordId: "observation-1" }],
    });
    expect(
      recordDiscoveryObservation(session(), {
        ...OBSERVATION_INPUT,
        artifacts: [{ ...OBSERVATION_INPUT.artifacts[0], path: "../secret.png" }],
      }),
    ).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_discovery_artifact_reference" }],
    });
  });

  it("begins and finishes one successful attempt around a resulting observation", () => {
    const finished = successfulAttemptSession();
    expect(finished.attempts[0]).toMatchObject({
      status: "succeeded",
      afterObservationId: "observation-2",
    });
  });

  it("rejects a second pending attempt", () => {
    const begun = beginDiscoveryAttempt(observedSession(), ATTEMPT_INPUT);
    if (!begun.ok) throw new Error("attempt must begin");
    expect(
      beginDiscoveryAttempt(begun.session, { ...ATTEMPT_INPUT, id: "attempt-2" }),
    ).toMatchObject({ ok: false, errors: [{ code: "pending_attempt_conflict" }] });
  });

  it("rejects persisted type values without exposing them", () => {
    const unsafe = {
      ...ATTEMPT_INPUT,
      action: {
        kind: "type",
        targetId: "target-checkout",
        inputBinding: "companyName",
        valueClass: "demo-data",
        value: "password=hunter2",
      },
    } as unknown as typeof ATTEMPT_INPUT;

    const result = beginDiscoveryAttempt(observedSession(), unsafe);
    expect(result).toMatchObject({
      ok: false,
      errors: [{ code: "unsafe_discovery_content" }],
    });
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });

  it("rejects pre-action observations as successful attempt evidence", () => {
    const begun = beginDiscoveryAttempt(observedSession(), ATTEMPT_INPUT);
    if (!begun.ok) throw new Error("attempt must begin");
    expect(
      finishDiscoveryAttempt(begun.session, "attempt-1", {
        status: "succeeded",
        finishedAt: "2026-07-13T12:00:03.000Z",
        afterObservationId: "observation-1",
        derivedExpectations: [
          {
            id: "expectation-visible-cart",
            kind: "visible-state",
            origin: "derived-from-observation",
            targetId: "visible-cart",
          },
        ],
        observedEffects: [
          {
            expectationId: "expectation-1",
            status: "matched",
            observationId: "observation-1",
            summary: "Claimed payment navigation",
          },
          {
            expectationId: "expectation-visible-cart",
            status: "matched",
            observationId: "observation-1",
            summary: "Cart remained visible",
          },
        ],
        outcome: { code: "action_completed", summary: "Claimed success" },
      }),
    ).toMatchObject({
      ok: false,
      errors: [{ code: "inconsistent_discovery_reference" }],
    });
  });

  it("selects and completes one continuous evidence-backed path", () => {
    const selected = selectDiscoveryPath(successfulAttemptSession(), {
      attemptIds: ["attempt-1"],
      selectedAt: "2026-07-13T12:00:05.000Z",
      source: "host-agent",
    });
    if (!selected.ok) throw new Error("path must select");

    const completed = completeDiscoverySession(selected.session, {
      completedAt: "2026-07-13T12:00:06.000Z",
    });
    expect(completed.ok && completed.session).toMatchObject({
      status: "completed",
      selectedPath: { attemptIds: ["attempt-1"], source: "host-agent" },
      terminal: { status: "completed", completedAt: "2026-07-13T12:00:06.000Z" },
    });
    if (!completed.ok) throw new Error("session must complete");
    expect(recordDiscoveryObservation(completed.session, OBSERVATION_INPUT)).toMatchObject({
      ok: false,
      errors: [{ code: "terminal_discovery_session" }],
    });
  });

  it("rejects missing selected attempts", () => {
    expect(
      selectDiscoveryPath(successfulAttemptSession(), {
        attemptIds: ["missing-attempt"],
        selectedAt: "2026-07-13T12:00:05.000Z",
        source: "host-agent",
      }),
    ).toMatchObject({ ok: false, errors: [{ code: "invalid_selected_path" }] });
  });

  it("fails or abandons explicitly and creates a fresh active child", () => {
    const failed = failDiscoverySession(observedSession(), {
      failedAt: "2026-07-13T12:00:05.000Z",
      reason: { code: "browser_unavailable", summary: "Browser became unavailable" },
    });
    if (!failed.ok) throw new Error("session must fail");
    const child = createChildDiscoverySession(failed.session, {
      ...SESSION_INPUT,
      id: "session-checkout-repair-1",
      createdAt: "2026-07-13T12:01:00.000Z",
    });
    expect(child.ok && child.session).toMatchObject({
      status: "active",
      parentSessionId: "session-checkout",
      observations: [],
      attempts: [],
    });

    const abandoned = abandonDiscoverySession(observedSession(), {
      abandonedAt: "2026-07-13T12:00:05.000Z",
      reason: { code: "user_stopped", summary: "User stopped discovery" },
    });
    expect(abandoned.ok && abandoned.session).toMatchObject({
      status: "abandoned",
      terminal: { status: "abandoned" },
    });
  });

  it("rejects corrupted selected-path relationships", () => {
    const selected = selectDiscoveryPath(successfulAttemptSession(), {
      attemptIds: ["attempt-1"],
      selectedAt: "2026-07-13T12:00:05.000Z",
      source: "host-agent",
    });
    if (!selected.ok) throw new Error("fixture path must select");

    const corruptions: Array<{
      name: string;
      mutate(value: DiscoverySessionV1): void;
      code: string;
    }> = [
      {
        name: "empty path",
        mutate: (value) => {
          value.selectedPath = { ...value.selectedPath!, attemptIds: [] };
        },
        code: "invalid_selected_path",
      },
      {
        name: "pending attempt",
        mutate: (value) => {
          value.attempts[0].status = "pending";
        },
        code: "invalid_selected_path",
      },
      {
        name: "unmatched expectation",
        mutate: (value) => {
          const attempt = value.attempts[0] as FinalizedDiscoveryAttempt;
          attempt.observedEffects[0].status = "not-matched";
        },
        code: "expectation_evidence_missing",
      },
      {
        name: "missing visible evidence",
        mutate: (value) => {
          const attempt = value.attempts[0] as FinalizedDiscoveryAttempt;
          attempt.derivedExpectations = [];
          attempt.observedEffects = attempt.observedEffects.filter(
            (effect) => effect.expectationId !== "expectation-2",
          );
        },
        code: "invalid_selected_path",
      },
      {
        name: "non-increasing sequence",
        mutate: (value) => {
          value.attempts[0].sequence = 0;
        },
        code: "invalid_discovery_session",
      },
    ];

    for (const testCase of corruptions) {
      const value = structuredClone(selected.session);
      testCase.mutate(value);
      expect(validateDiscoverySession(value), testCase.name).toMatchObject({
        ok: false,
        errors: expect.arrayContaining([expect.objectContaining({ code: testCase.code })]),
      });
    }
  });

  it.each([
    "/absolute.png",
    "../secret.png",
    "artifacts\\secret.png",
    "a//b.png",
    "https://example.com/a.png",
  ])("rejects unsafe artifact path %s", (path) => {
    expect(
      recordDiscoveryObservation(session(), {
        ...OBSERVATION_INPUT,
        artifacts: [{ ...OBSERVATION_INPUT.artifacts[0], path }],
      }),
    ).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_discovery_artifact_reference" }],
    });
  });

  it("sanitizes secret-like public fields across the lifecycle", () => {
    for (const secret of SECRET_VALUES) {
      const created = createDiscoverySession({
        ...SESSION_INPUT,
        id: "session-secret-check",
        goal: `Show checkout with ${secret}`,
        host: { name: `codex ${secret}`, version: "1.0.0", model: secret },
      });
      expect(created.ok).toBe(true);
      expect(JSON.stringify(created)).not.toContain(secret);

      const observed = recordDiscoveryObservation(session(), {
        ...OBSERVATION_INPUT,
        page: { ...OBSERVATION_INPUT.page, title: `Checkout ${secret}` },
        visibleStates: [{ ...OBSERVATION_INPUT.visibleStates[0], summary: `Cart ${secret}` }],
        interactiveTargets: [
          {
            ...OBSERVATION_INPUT.interactiveTargets[0],
            label: `Checkout ${secret}`,
            role: `button ${secret}`,
          },
        ],
      });
      expect(observed.ok).toBe(true);
      expect(JSON.stringify(observed)).not.toContain(secret);

      const begun = beginDiscoveryAttempt(observedSession(), {
        ...ATTEMPT_INPUT,
        expectations: [
          {
            id: "expectation-secret",
            kind: "visible-state",
            origin: "declared-before-action",
            publicCondition: `Payment ${secret}`,
          },
        ],
        confidence: { ...ATTEMPT_INPUT.confidence, note: `Selected ${secret}` },
      });
      expect(begun.ok).toBe(true);
      expect(JSON.stringify(begun)).not.toContain(secret);
      if (!begun.ok) continue;
      const finished = finishDiscoveryAttempt(begun.session, "attempt-1", {
        status: "failed",
        finishedAt: "2026-07-13T12:00:03.000Z",
        derivedExpectations: [],
        observedEffects: [],
        outcome: { code: "not_matched", summary: `Not matched ${secret}` },
      });
      expect(finished.ok).toBe(true);
      expect(JSON.stringify(finished)).not.toContain(secret);

      const failed = failDiscoverySession(observedSession(), {
        failedAt: "2026-07-13T12:00:05.000Z",
        reason: { code: "browser_unavailable", summary: `Stopped ${secret}` },
      });
      expect(failed.ok).toBe(true);
      expect(JSON.stringify(failed)).not.toContain(secret);
    }
  });

  it("returns limit errors for every bounded public collection", () => {
    expect(createDiscoverySession({ ...SESSION_INPUT, id: "x".repeat(129) })).toMatchObject({
      ok: false,
      errors: [{ code: "session_limit_exceeded" }],
    });
    expect(createDiscoverySession({ ...SESSION_INPUT, goal: "x".repeat(2_001) })).toMatchObject({
      ok: false,
      errors: [{ code: "session_limit_exceeded" }],
    });
    expect(
      createDiscoverySession({
        ...SESSION_INPUT,
        target: {
          kind: "browser",
          startUrl: `https://example.com/${"x".repeat(2_001)}`,
        },
      }),
    ).toMatchObject({
      ok: false,
      errors: [{ code: "session_limit_exceeded" }],
    });
    expect(
      recordDiscoveryObservation(session(), {
        ...OBSERVATION_INPUT,
        interactiveTargets: Array.from({ length: 101 }, (_, index) => ({
          id: `target-${index}`,
          label: `Target ${index}`,
          disabled: false,
        })),
      }),
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: "session_limit_exceeded" })]),
    });
    expect(
      recordDiscoveryObservation(session(), {
        ...OBSERVATION_INPUT,
        artifacts: [
          {
            ...OBSERVATION_INPUT.artifacts[0],
            path: `artifacts/${"x".repeat(2_001)}.png`,
          },
        ],
      }),
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: "session_limit_exceeded" })]),
    });
    expect(
      recordDiscoveryObservation(session(), {
        ...OBSERVATION_INPUT,
        visibleStates: Array.from({ length: 51 }, (_, index) => ({
          id: `visible-${index}`,
          kind: "text",
          summary: `Visible ${index}`,
        })),
      }),
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: "session_limit_exceeded" })]),
    });
    expect(
      recordDiscoveryObservation(session(), {
        ...OBSERVATION_INPUT,
        artifacts: Array.from({ length: 9 }, (_, index) => ({
          id: `artifact-${index}`,
          kind: "screenshot",
          path: `artifacts/${index}.png`,
          mediaType: "image/png",
        })),
      }),
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: "session_limit_exceeded" })]),
    });
    expect(
      beginDiscoveryAttempt(observedSession(), {
        ...ATTEMPT_INPUT,
        action: { kind: "wait", durationMs: 30_001 },
      }),
    ).toMatchObject({ ok: false, errors: [{ code: "session_limit_exceeded" }] });
    expect(
      selectDiscoveryPath(successfulAttemptSession(), {
        attemptIds: Array.from({ length: 129 }, () => "attempt-1"),
        selectedAt: "2026-07-13T12:00:05.000Z",
        source: "host-agent",
      }),
    ).toMatchObject({ ok: false, errors: [{ code: "session_limit_exceeded" }] });
  });

  it("returns structured errors instead of throwing for malformed runtime inputs", () => {
    const malformed = null as never;
    expect(recordDiscoveryObservation(session(), malformed)).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_discovery_input" }],
    });
    expect(beginDiscoveryAttempt(observedSession(), malformed)).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_discovery_input" }],
    });
    expect(selectDiscoveryPath(successfulAttemptSession(), malformed)).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_selected_path" }],
    });
    expect(completeDiscoverySession(successfulAttemptSession(), malformed)).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_discovery_input" }],
    });
    expect(failDiscoverySession(observedSession(), malformed)).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_discovery_input" }],
    });
    expect(createChildDiscoverySession(session(), malformed)).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_discovery_transition" }],
    });
    const failed = failDiscoverySession(observedSession(), {
      failedAt: "2026-07-13T12:00:05.000Z",
      reason: { code: "browser_unavailable", summary: "Browser became unavailable" },
    });
    if (!failed.ok) throw new Error("fixture session must fail");
    expect(createChildDiscoverySession(failed.session, malformed)).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_discovery_input" }],
    });
  });
});
