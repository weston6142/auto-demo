import { describe, expect, it } from "vitest";
import {
  createDiscoveryRehearsalController,
  type DiscoveryActionAuthorization,
  type DiscoveryActionAuthorizer,
  type DiscoveryInputResolver,
  type DiscoveryRehearsalDriver,
} from "./index.js";

const initialObservation = {
  id: "observation-1",
  observedAt: "2026-07-15T12:00:01.000Z",
  page: {
    url: "https://example.test/start",
    title: "Start",
    viewport: { width: 1280, height: 720 },
    navigation: { canGoBack: false },
  },
  visibleStates: [{ id: "visible-start", kind: "text" as const, summary: "Ready" }],
  interactiveTargets: [{ id: "target-next", label: "Next", role: "button", disabled: false }],
  artifacts: [],
};

function dependencies() {
  const driver: DiscoveryRehearsalDriver<{ policy: "test" }> = {
    async observe() {
      return { ok: true as const, observation: initialObservation, diagnostics: [] };
    },
    async hasLiveTarget() {
      return true;
    },
    async execute() {
      return { ok: true as const, code: "action_completed", summary: "Action completed." };
    },
    async isAvailable() {
      return true;
    },
  };
  const authorizer: DiscoveryActionAuthorizer<{ policy: "test" }> = {
    async authorize(): Promise<DiscoveryActionAuthorization<{ policy: "test" }>> {
      return { decision: "allow", permit: { policy: "test" } };
    },
  };
  const inputResolver: DiscoveryInputResolver = {
    async resolve() {
      return { ok: true, value: "demo value" };
    },
  };
  const times = [
    "2026-07-15T12:00:00.000Z",
    "2026-07-15T12:00:02.000Z",
    "2026-07-15T12:00:05.000Z",
    "2026-07-15T12:00:08.000Z",
  ];
  let nextAttempt = 1;
  return {
    driver,
    authorizer,
    inputResolver,
    clock: () => times.shift() ?? "2026-07-15T12:00:20.000Z",
    idGenerator: () => `attempt-${nextAttempt++}`,
  };
}

const startInput = {
  id: "session-1",
  target: { kind: "browser" as const, startUrl: "https://example.test/start" },
  goal: "Show the next screen",
  host: { name: "codex", version: "1.0.0" },
};

async function controllerWithExploredBranch() {
  const deps = dependencies();
  const observations = [
    initialObservation,
    {
      ...initialObservation,
      id: "observation-wrong",
      observedAt: "2026-07-15T12:00:03.000Z",
      page: {
        ...initialObservation.page,
        navigation: { canGoBack: true },
      },
      visibleStates: [{ id: "visible-wrong", kind: "text" as const, summary: "Wrong route" }],
    },
    {
      ...initialObservation,
      id: "observation-returned",
      observedAt: "2026-07-15T12:00:06.000Z",
    },
    {
      ...initialObservation,
      id: "observation-success",
      observedAt: "2026-07-15T12:00:09.000Z",
      visibleStates: [{ id: "visible-success", kind: "status" as const, summary: "Success" }],
    },
    {
      ...initialObservation,
      id: "observation-inspected",
      observedAt: "2026-07-15T12:00:12.000Z",
      visibleStates: [{ id: "visible-success", kind: "status" as const, summary: "Success" }],
    },
  ];
  const executions = [
    { ok: false as const, code: "wrong_route", summary: "Wrong route.", recoverable: true },
    { ok: true as const, code: "action_completed", summary: "Action completed." },
    { ok: true as const, code: "action_completed", summary: "Action completed." },
    { ok: true as const, code: "action_completed", summary: "Action completed." },
  ];
  deps.driver.observe = async () => ({
    ok: true,
    observation: observations.shift()!,
    diagnostics: [],
  });
  deps.driver.execute = async () => executions.shift()!;
  const times = [
    "2026-07-15T12:00:00.000Z",
    "2026-07-15T12:00:02.000Z",
    "2026-07-15T12:00:04.000Z",
    "2026-07-15T12:00:05.000Z",
    "2026-07-15T12:00:07.000Z",
    "2026-07-15T12:00:08.000Z",
    "2026-07-15T12:00:10.000Z",
    "2026-07-15T12:00:11.000Z",
    "2026-07-15T12:00:13.000Z",
    "2026-07-15T12:00:14.000Z",
    "2026-07-15T12:00:15.000Z",
  ];
  deps.clock = () => times.shift()!;
  const controller = createDiscoveryRehearsalController(deps);
  await controller.start({ ...startInput, goal: "Find success" });
  await controller.perform({
    action: { kind: "click", targetId: "target-next" },
    expectations: [],
    confidence: { level: "medium", bases: ["host-inference"] },
  });
  await controller.perform({
    action: { kind: "back" },
    expectations: [],
    confidence: { level: "high", bases: ["host-inference"] },
  });
  await controller.perform({
    action: { kind: "click", targetId: "target-next" },
    expectations: [],
    confidence: { level: "high", bases: ["exact-accessible-target"] },
  });
  await controller.perform({
    action: { kind: "inspect" },
    expectations: [
      {
        id: "expect-success",
        kind: "visible-state",
        origin: "declared-before-action",
        publicCondition: "Success",
      },
    ],
    confidence: { level: "high", bases: ["expected-visible-state-observed"] },
  });
  return controller;
}

describe("createDiscoveryRehearsalController", () => {
  it("starts by creating a session and recording one bounded observation", async () => {
    const controller = createDiscoveryRehearsalController(dependencies());

    const result = await controller.start(startInput);

    expect(result).toMatchObject({
      ok: true,
      session: {
        id: "session-1",
        status: "active",
        createdAt: "2026-07-15T12:00:00.000Z",
        observations: [{ id: "observation-1", sequence: 1 }],
      },
      observation: { id: "observation-1", sequence: 1 },
      diagnostics: [],
    });
    expect(controller.getSession()).toEqual(result.ok ? result.session : undefined);
  });

  it("remains unstarted when the initial observation fails", async () => {
    const deps = dependencies();
    deps.driver.observe = async () => ({
      ok: false,
      errors: [
        { code: "browser_unavailable", message: "Discovery observation browser is unavailable." },
      ],
    });
    const controller = createDiscoveryRehearsalController(deps);

    const result = await controller.start(startInput);

    expect(result).toMatchObject({ ok: false, errors: [{ code: "browser_unavailable" }] });
    expect(controller.getSession()).toBeUndefined();
  });

  it("records a blocked action without executing or resolving input", async () => {
    const deps = dependencies();
    let executed = 0;
    let resolved = 0;
    deps.driver.execute = async () => {
      executed += 1;
      return { ok: true, code: "action_completed", summary: "Action completed." };
    };
    deps.inputResolver.resolve = async () => {
      resolved += 1;
      return { ok: true, value: "must-not-be-read" };
    };
    deps.authorizer.authorize = async () => ({
      decision: "block",
      reason: { code: "credential_target", summary: "Credential input is blocked." },
    });
    const controller = createDiscoveryRehearsalController(deps);
    await controller.start(startInput);

    const result = await controller.perform({
      action: {
        kind: "type",
        targetId: "target-next",
        inputBinding: "demo-name",
        valueClass: "demo-data",
      },
      expectations: [],
      confidence: { level: "high", bases: ["exact-accessible-target"] },
    });

    expect(result).toMatchObject({
      ok: true,
      attempt: { status: "blocked", outcome: { code: "credential_target" } },
      session: { attempts: [{ status: "blocked" }] },
    });
    expect(executed).toBe(0);
    expect(resolved).toBe(0);
    expect(JSON.stringify(result)).not.toContain("must-not-be-read");
  });

  it("executes an allowed type with a runtime-only value and records matched evidence", async () => {
    const deps = dependencies();
    let driverValue: string | undefined;
    deps.driver.execute = async (input) => {
      driverValue = input.resolvedValue;
      return {
        ok: true,
        code: "action_completed",
        summary: `Stored ${input.resolvedValue}`,
      };
    };
    const observations = [
      initialObservation,
      {
        ...initialObservation,
        id: "observation-2",
        observedAt: "2026-07-15T12:00:04.000Z",
        visibleStates: [{ id: "visible-done", kind: "status" as const, summary: "Saved" }],
      },
    ];
    deps.driver.observe = async () => ({
      ok: true,
      observation: observations.shift()!,
      diagnostics: [],
    });
    const controller = createDiscoveryRehearsalController(deps);
    await controller.start({ ...startInput, goal: "Save demo data" });

    const result = await controller.perform({
      action: {
        kind: "type",
        targetId: "target-next",
        inputBinding: "demo-name",
        valueClass: "demo-data",
      },
      expectations: [
        {
          id: "expect-saved",
          kind: "visible-state",
          origin: "declared-before-action",
          publicCondition: "Saved",
        },
      ],
      confidence: { level: "high", bases: ["expected-visible-state-observed"] },
    });

    expect(driverValue).toBe("demo value");
    expect(result).toMatchObject({
      ok: true,
      attempt: {
        status: "succeeded",
        observedEffects: [
          {
            expectationId: "expect-saved",
            status: "matched",
            observationId: "observation-2",
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain("demo value");
  });

  it("records an expectation mismatch as a failed attempt", async () => {
    const deps = dependencies();
    const observations = [
      initialObservation,
      {
        ...initialObservation,
        id: "observation-2",
        observedAt: "2026-07-15T12:00:04.000Z",
      },
    ];
    deps.driver.observe = async () => ({
      ok: true,
      observation: observations.shift()!,
      diagnostics: [],
    });
    const controller = createDiscoveryRehearsalController(deps);
    await controller.start({ ...startInput, goal: "Find completion" });

    const result = await controller.perform({
      action: { kind: "inspect" },
      expectations: [
        {
          id: "expect-complete",
          kind: "visible-state",
          origin: "declared-before-action",
          publicCondition: "Complete",
        },
      ],
      confidence: { level: "medium", bases: ["host-inference"] },
    });

    expect(result).toMatchObject({
      ok: true,
      attempt: { status: "failed", outcome: { code: "expectation_unmatched" } },
    });
  });

  it.each([
    ["prevents", "Ready", true],
    ["does not prevent", "Saved", false],
  ] as const)(
    "%s an expected visible effect when classified network activity is blocked",
    async (_label, visibleSummary, expectedVisibleEffectPrevented) => {
      const deps = dependencies();
      const observations = [
        initialObservation,
        {
          ...initialObservation,
          id: "observation-2",
          observedAt: "2026-07-15T12:00:04.000Z",
          visibleStates: [
            { id: "visible-after", kind: "status" as const, summary: visibleSummary },
          ],
        },
      ];
      deps.driver.observe = async () => ({
        ok: true,
        observation: observations.shift()!,
        diagnostics: [],
      });
      deps.driver.execute = async () => ({
        ok: false,
        code: "network_request_blocked",
        summary: "Discovery blocked classified network activity.",
        recoverable: true,
        blockedNetworkEvidence: {
          classifications: [
            {
              requestClass: "xhr-fetch",
              methodCategory: "potential-side-effect",
              originRelation: "same-origin",
              scope: "subresource",
              blockedRequestCount: 1,
            },
          ],
          totalBlockedRequestCount: 1,
        },
      });
      const controller = createDiscoveryRehearsalController({
        ...deps,
        driverFailureOutcome: (result) => ({ code: result.code, summary: result.summary }),
      });
      await controller.start(startInput);

      const result = await controller.perform({
        action: { kind: "click", targetId: "target-next" },
        expectations: [
          {
            id: "expect-saved",
            kind: "visible-state",
            origin: "declared-before-action",
            publicCondition: "Saved",
          },
        ],
        confidence: { level: "medium", bases: ["host-inference"] },
      });

      expect(result).toMatchObject({
        ok: true,
        attempt: { status: "failed", outcome: { code: "network_request_blocked" } },
        diagnostics: [
          {
            code: "network_requests_blocked",
            totalBlockedRequestCount: 1,
            classifications: [
              {
                requestClass: "xhr-fetch",
                methodCategory: "potential-side-effect",
                originRelation: "same-origin",
                scope: "subresource",
                blockedRequestCount: 1,
              },
            ],
            expectedVisibleEffectPrevented,
          },
        ],
      });
    },
  );

  it("validates and sanitizes action data before authorization and execution", async () => {
    const deps = dependencies();
    let authorizedUrl: string | undefined;
    let executedUrl: string | undefined;
    deps.authorizer.authorize = async ({ action }) => {
      authorizedUrl = action.kind === "navigate" ? action.url : undefined;
      return { decision: "allow", permit: { policy: "test" } };
    };
    deps.driver.execute = async ({ action }) => {
      executedUrl = action.kind === "navigate" ? action.url : undefined;
      return { ok: true, code: "action_completed", summary: "Action completed." };
    };
    const observations = [
      initialObservation,
      {
        ...initialObservation,
        id: "observation-2",
        observedAt: "2026-07-15T12:00:04.000Z",
        page: {
          ...initialObservation.page,
          url: "https://example.test/next",
          title: "Next",
        },
      },
    ];
    deps.driver.observe = async () => ({
      ok: true,
      observation: observations.shift()!,
      diagnostics: [],
    });
    const controller = createDiscoveryRehearsalController(deps);
    await controller.start(startInput);

    const result = await controller.perform({
      action: { kind: "navigate", url: "https://example.test/next?view=all#section" },
      expectations: [
        {
          id: "expect-next",
          kind: "navigation",
          origin: "declared-before-action",
          url: "https://example.test/next?view=all#section",
          match: "exact-url",
        },
      ],
      confidence: { level: "high", bases: ["expected-navigation-observed"] },
    });

    expect(authorizedUrl).toBe("https://example.test/next");
    expect(executedUrl).toBe("https://example.test/next");
    expect(result).toMatchObject({
      ok: true,
      attempt: {
        status: "succeeded",
        action: { url: "https://example.test/next" },
        expectations: [{ url: "https://example.test/next" }],
      },
    });
  });

  it("rejects invalid actions before calling the authorizer", async () => {
    const deps = dependencies();
    let authorizations = 0;
    deps.authorizer.authorize = async () => {
      authorizations += 1;
      return { decision: "allow", permit: { policy: "test" } };
    };
    const controller = createDiscoveryRehearsalController(deps);
    await controller.start(startInput);

    const result = await controller.perform({
      action: {
        kind: "navigate",
        url: "https://example.test/next?token=abcdefghijklmnopqrstuvwx1234",
      },
      expectations: [],
      confidence: { level: "high", bases: ["expected-navigation-observed"] },
    });

    expect(result).toMatchObject({ ok: false, errors: [{ code: "unsafe_discovery_url" }] });
    expect(authorizations).toBe(0);
    expect(controller.getSession()?.attempts).toEqual([]);
  });

  it("records a stale target once and requires an explicit linked retry", async () => {
    const deps = dependencies();
    let live = false;
    const observations = [
      initialObservation,
      {
        ...initialObservation,
        id: "observation-2",
        observedAt: "2026-07-15T12:00:10.000Z",
      },
    ];
    deps.driver.observe = async () => ({
      ok: true,
      observation: observations.shift()!,
      diagnostics: [],
    });
    deps.driver.hasLiveTarget = async () => live;
    const controller = createDiscoveryRehearsalController(deps);
    await controller.start({ ...startInput, goal: "Continue" });

    const first = await controller.perform({
      action: { kind: "click", targetId: "target-next" },
      expectations: [],
      confidence: { level: "medium", bases: ["exact-accessible-target"] },
    });
    expect(first).toMatchObject({
      ok: true,
      attempt: { status: "failed", outcome: { code: "target_stale" } },
    });

    live = true;
    const retried = await controller.perform({
      action: { kind: "click", targetId: "target-next" },
      expectations: [],
      confidence: { level: "medium", bases: ["exact-accessible-target"] },
      retryOfAttemptId: "attempt-1",
    });
    expect(retried).toMatchObject({
      ok: true,
      attempt: { status: "succeeded", retryOfAttemptId: "attempt-1" },
    });
  });

  it("rejects a concurrent action instead of queuing it", async () => {
    const deps = dependencies();
    let release!: () => void;
    deps.driver.execute = async () =>
      await new Promise((resolve) => {
        release = () =>
          resolve({ ok: true, code: "action_completed", summary: "Action completed." });
      });
    const controller = createDiscoveryRehearsalController(deps);
    await controller.start({ ...startInput, goal: "Inspect" });

    const first = controller.perform({
      action: { kind: "inspect" },
      expectations: [],
      confidence: { level: "high", bases: ["host-inference"] },
    });
    await Promise.resolve();
    const second = await controller.perform({
      action: { kind: "inspect" },
      expectations: [],
      confidence: { level: "high", bases: ["host-inference"] },
    });

    expect(second).toMatchObject({
      ok: false,
      errors: [{ code: "discovery_controller_busy" }],
    });
    release();
    await first;
  });

  it("fails the session without a pending attempt when the browser is lost", async () => {
    const deps = dependencies();
    deps.driver.execute = async () => ({
      ok: false,
      code: "browser_unavailable",
      summary: "token=abcdefghijklmnopqrstuvwx1234",
      recoverable: false,
    });
    deps.driver.isAvailable = async () => false;
    const controller = createDiscoveryRehearsalController(deps);
    await controller.start({ ...startInput, goal: "Inspect" });

    const result = await controller.perform({
      action: { kind: "inspect" },
      expectations: [],
      confidence: { level: "high", bases: ["host-inference"] },
    });

    expect(result).toMatchObject({
      ok: true,
      session: {
        status: "failed",
        terminal: {
          status: "failed",
          reason: { code: "browser_unavailable" },
        },
      },
    });
    if (!result.ok) throw new Error("terminal failure must be recorded");
    expect(result.session.attempts.some((attempt) => attempt.status === "pending")).toBe(false);
    expect(JSON.stringify(result)).not.toContain("abcdefghijklmnopqrstuvwx1234");
  });

  it("finalizes the attempt when a post-action observation cannot be recorded", async () => {
    const deps = dependencies();
    const observations = [initialObservation, initialObservation];
    deps.driver.observe = async () => ({
      ok: true,
      observation: observations.shift()!,
      diagnostics: [],
    });
    const controller = createDiscoveryRehearsalController(deps);
    await controller.start({ ...startInput, goal: "Inspect" });

    const result = await controller.perform({
      action: { kind: "inspect" },
      expectations: [],
      confidence: { level: "high", bases: ["host-inference"] },
    });

    expect(result).toMatchObject({
      ok: true,
      attempt: { status: "failed", outcome: { code: "observation_failed" } },
    });
    expect(controller.getSession()?.attempts.some((attempt) => attempt.status === "pending")).toBe(
      false,
    );
  });

  it("retains a finalized attempt when terminal browser failure cannot be recorded", async () => {
    const deps = dependencies();
    const times = [
      "2026-07-15T12:00:00.000Z",
      "2026-07-15T12:00:02.000Z",
      "2026-07-15T12:00:05.000Z",
      "2026-07-15T12:00:04.000Z",
    ];
    deps.clock = () => times.shift() ?? "2026-07-15T12:00:20.000Z";
    deps.driver.execute = async () => ({
      ok: false,
      code: "browser_unavailable",
      summary: "Discovery browser is unavailable.",
      recoverable: false,
    });
    const controller = createDiscoveryRehearsalController(deps);
    await controller.start({ ...startInput, goal: "Inspect" });

    const result = await controller.perform({
      action: { kind: "inspect" },
      expectations: [],
      confidence: { level: "high", bases: ["host-inference"] },
    });

    expect(result).toMatchObject({
      ok: false,
      session: { status: "active", attempts: [{ status: "failed" }] },
      errors: [{ code: "invalid_discovery_transition" }],
    });
    expect(controller.getSession()?.attempts.some((attempt) => attempt.status === "pending")).toBe(
      false,
    );
  });

  it.each(["authorizer", "resolver", "driver", "observer"] as const)(
    "sanitizes %s failures",
    async (failure) => {
      const deps = dependencies();
      const controller = createDiscoveryRehearsalController(deps);
      await controller.start({ ...startInput, goal: "Inspect" });
      if (failure === "authorizer") {
        deps.authorizer.authorize = async () => {
          throw new Error("token=abcdefghijklmnopqrstuvwx1234");
        };
      }
      if (failure === "resolver") {
        deps.inputResolver.resolve = async () => {
          throw new Error("token=abcdefghijklmnopqrstuvwx1234");
        };
      }
      if (failure === "driver") {
        deps.driver.execute = async () => {
          throw new Error("token=abcdefghijklmnopqrstuvwx1234");
        };
      }
      if (failure === "observer") {
        deps.driver.observe = async () => {
          throw new Error("token=abcdefghijklmnopqrstuvwx1234");
        };
      }
      const input =
        failure === "resolver"
          ? {
              action: {
                kind: "type" as const,
                targetId: "target-next",
                inputBinding: "demo-name",
                valueClass: "demo-data" as const,
              },
              expectations: [],
              confidence: {
                level: "high" as const,
                bases: ["exact-accessible-target" as const],
              },
            }
          : {
              action: { kind: "inspect" as const },
              expectations: [],
              confidence: {
                level: "high" as const,
                bases: ["host-inference" as const],
              },
            };
      const beforeCount = controller.getSession()?.attempts.length;

      const result = await controller.perform(input);

      expect(JSON.stringify(result)).not.toContain("abcdefghijklmnopqrstuvwx1234");
      if (failure === "authorizer") {
        expect(controller.getSession()?.attempts.length).toBe(beforeCount);
      }
      if (failure === "resolver") {
        expect(controller.getSession()?.attempts.at(-1)).toMatchObject({ status: "failed" });
      }
    },
  );

  it("completes only an explicitly selected continuous successful path", async () => {
    const controller = await controllerWithExploredBranch();

    const result = await controller.stop({
      outcome: "complete",
      attemptIds: ["attempt-3", "attempt-4"],
      source: "host-agent",
    });

    expect(result).toMatchObject({
      ok: true,
      session: {
        status: "completed",
        selectedPath: { attemptIds: ["attempt-3", "attempt-4"] },
        terminal: { status: "completed" },
      },
    });
    if (!result.ok) throw new Error("completion must succeed");
    expect(result.session.selectedPath?.attemptIds).not.toContain("attempt-1");
  });

  it("leaves the session active when completion selects an invalid path", async () => {
    const controller = createDiscoveryRehearsalController(dependencies());
    await controller.start(startInput);

    const result = await controller.stop({
      outcome: "complete",
      attemptIds: [],
      source: "host-agent",
    });

    expect(result).toMatchObject({ ok: false, errors: [{ code: "invalid_selected_path" }] });
    expect(controller.getSession()).toMatchObject({ status: "active" });
  });

  it("abandons explicitly, preserves evidence, and rejects later operations", async () => {
    const controller = createDiscoveryRehearsalController(dependencies());
    await controller.start(startInput);

    const result = await controller.stop({
      outcome: "abandon",
      reason: { code: "user_stopped", summary: "User stopped discovery." },
    });

    expect(result).toMatchObject({
      ok: true,
      session: {
        status: "abandoned",
        observations: [{ id: "observation-1" }],
        terminal: { status: "abandoned" },
      },
    });
    const actionAfterStop = await controller.perform({
      action: { kind: "inspect" },
      expectations: [],
      confidence: { level: "high", bases: ["host-inference"] },
    });
    const stopAfterStop = await controller.stop({
      outcome: "abandon",
      reason: { code: "user_stopped", summary: "User stopped discovery." },
    });
    expect(actionAfterStop).toMatchObject({
      ok: false,
      errors: [{ code: "terminal_discovery_session" }],
    });
    expect(stopAfterStop).toMatchObject({
      ok: false,
      errors: [{ code: "terminal_discovery_session" }],
    });
  });
});

export { dependencies, initialObservation, startInput };
