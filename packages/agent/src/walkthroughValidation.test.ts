import { describe, expect, it } from "vitest";
import {
  approveWalkthroughPlan,
  isWalkthroughPlan,
  validateWalkthroughPlan,
  WalkthroughValidationRunnerError,
  type WalkthroughValidationBrowserRunner,
  type WalkthroughValidationMatch,
  type WalkthroughValidationPageState,
} from "./index.js";
import { legacyWalkthroughPlanFixture } from "./walkthroughTestFixtures.js";

function plan(script: string) {
  const result = {
    ok: true as const,
    plan: legacyWalkthroughPlanFixture({
      targetUrl: "https://example.com/signup",
      script,
      mode: "validate-first",
    }),
  };
  if (!result.ok) {
    throw new Error("test plan should be valid");
  }
  return result.plan;
}

function runner(
  matchesByStep: Record<string, WalkthroughValidationMatch[]>,
  options: {
    initialState?: WalkthroughValidationPageState;
    stateAfterClick?: WalkthroughValidationPageState;
  } = {},
): WalkthroughValidationBrowserRunner {
  let state =
    options.initialState ??
    ({ url: "https://example.com/signup", title: "Signup", authWall: false } as const);

  return {
    async open(url) {
      expect(url).toBe("https://example.com/signup");
    },
    async navigate() {},
    async inspectPage() {
      return state;
    },
    async findMatches(step) {
      return matchesByStep[step.id] ?? [{ id: `${step.id}-match`, label: step.public.summary }];
    },
    async click(match) {
      expect(match.id).toContain("match");
      if (options.stateAfterClick !== undefined) {
        state = options.stateAfterClick;
      }
    },
    async type(match) {
      expect(match.id).toContain("match");
    },
    async waitForIdle() {},
    async close() {},
  };
}

describe("validateWalkthroughPlan", () => {
  it("requires validate-first mode for discovery plans", () => {
    const discovered = plan("Verify Results.");
    discovered.mode = "best-guess";
    discovered.source = {
      parser: "discovery-v1",
      script: "Verify Results.",
      discovery: {
        schemaVersion: 1,
        sessionId: "session-1",
        selectedPathFingerprint: `sha256:${"a".repeat(64)}`,
      },
    };

    expect(isWalkthroughPlan(discovered)).toBe(false);
  });

  it("requires fresh-context replay instead of dry-run validation for discovery plans", async () => {
    const discovered = plan("Verify Results.");
    discovered.source = {
      parser: "discovery-v1",
      script: "Verify Results.",
      discovery: {
        schemaVersion: 1,
        sessionId: "session-1",
        selectedPathFingerprint: `sha256:${"a".repeat(64)}`,
      },
    };

    await expect(validateWalkthroughPlan(discovered, {}, { browser: runner({}) })).resolves.toEqual(
      {
        ok: false,
        errors: [
          {
            code: "discovery_replay_required",
            message: "Discovery plans require fresh-context replay validation before approval.",
          },
        ],
      },
    );
  });

  it("accepts bounded discovery source, assertion, and provenance fields", () => {
    const discovered = plan("Verify Results.");
    discovered.source = {
      parser: "discovery-v1",
      script: "Verify Results.",
      discovery: {
        schemaVersion: 1,
        sessionId: "session-1",
        selectedPathFingerprint: `sha256:${"a".repeat(64)}`,
      },
    };
    discovered.steps[0] = {
      ...discovered.steps[0],
      assertion: { kind: "visible-state", condition: "Results", role: "heading" },
      targetHint: { kind: "accessible", label: "Results", role: "heading" },
      provenance: {
        kind: "discovery",
        sessionId: "session-1",
        attemptId: "attempt-1",
        expectationId: "expectation-1",
        expectationOrigin: "declared-before-action",
      },
    };

    expect(isWalkthroughPlan(discovered)).toBe(true);

    const mismatched = structuredClone(discovered);
    mismatched.steps[0].action = "click";
    expect(isWalkthroughPlan(mismatched)).toBe(false);
  });

  it("requires replay metadata only for discovery replay validation", () => {
    const discovered = plan("Verify Results.");
    discovered.source = {
      parser: "discovery-v1",
      script: "Verify Results.",
      discovery: {
        schemaVersion: 1,
        sessionId: "session-1",
        selectedPathFingerprint: `sha256:${"a".repeat(64)}`,
      },
    };
    discovered.state = "validated";
    (discovered as unknown as { validation: unknown }).validation = {
      status: "ready",
      validatedAt: "2026-07-16T12:00:00.000Z",
      mode: "discovery-replay",
      checks: [
        {
          id: "check-1",
          stepId: "step-1",
          action: "assert",
          status: "passed",
          summary: "Validated: Verify Results.",
        },
      ],
      blockers: [],
      replay: {
        replayId: "replay-1",
        attempts: 2,
        sourceSessionId: "session-repair-1",
        selectedPathFingerprint: `sha256:${"b".repeat(64)}`,
      },
    };

    expect(isWalkthroughPlan(discovered)).toBe(false);

    if (discovered.validation?.mode !== "discovery-replay") {
      throw new Error("test plan should carry replay evidence");
    }
    discovered.validation.replay.sourceSessionId = "session-1";
    discovered.validation.replay.selectedPathFingerprint = `sha256:${"a".repeat(64)}`;
    expect(isWalkthroughPlan(discovered)).toBe(true);

    const missing = structuredClone(discovered);
    delete (missing.validation as unknown as { replay?: unknown }).replay;
    expect(isWalkthroughPlan(missing)).toBe(false);

    const dryRun = structuredClone(discovered);
    (dryRun.validation as unknown as { mode: string }).mode = "dry-run";
    expect(isWalkthroughPlan(dryRun)).toBe(false);
  });

  it("rejects unknown discovery source, assertion, and provenance fields", () => {
    const discovered = plan("Verify Results.");
    discovered.source = {
      parser: "discovery-v1",
      script: "Verify Results.",
      discovery: {
        schemaVersion: 1,
        sessionId: "session-1",
        selectedPathFingerprint: `sha256:${"a".repeat(64)}`,
      },
    };
    discovered.steps[0] = {
      ...discovered.steps[0],
      assertion: { kind: "visible-state", condition: "Results" },
      targetHint: { kind: "accessible", label: "Results" },
      provenance: {
        kind: "discovery",
        sessionId: "session-1",
        attemptId: "attempt-1",
      },
    };

    for (const mutate of [
      (candidate: typeof discovered) =>
        ((candidate.source as unknown as Record<string, unknown>).extra = true),
      (candidate: typeof discovered) =>
        ((candidate.source as { discovery: Record<string, unknown> }).discovery.extra = true),
      (candidate: typeof discovered) =>
        ((candidate.steps[0].assertion as unknown as Record<string, unknown>).extra = true),
      (candidate: typeof discovered) =>
        ((candidate.steps[0].provenance as unknown as Record<string, unknown>).extra = true),
    ]) {
      const invalid = structuredClone(discovered);
      mutate(invalid);
      expect(isWalkthroughPlan(invalid)).toBe(false);
    }
  });

  it("accepts navigation assertions without accessible targets", () => {
    const discovered = plan("Verify destination.");
    discovered.steps[0] = {
      ...discovered.steps[0],
      targetHint: undefined,
      assertion: {
        kind: "navigation",
        url: "https://example.com/results",
        match: "same-origin-path",
      },
    };

    expect(isWalkthroughPlan(discovered)).toBe(true);
  });

  it("blocks a structured navigation assertion at an unexpected destination", async () => {
    const discovered = plan("Verify destination.");
    discovered.steps[0].targetHint = undefined;
    discovered.steps[0].assertion = {
      kind: "navigation",
      url: "https://example.com/results",
      match: "same-origin-path",
    };

    const result = await validateWalkthroughPlan(
      discovered,
      {},
      {
        browser: runner(
          {},
          {
            initialState: {
              url: "https://example.com/other",
              title: "Other",
              authWall: false,
            },
          },
        ),
      },
    );

    expect(result).toMatchObject({
      ok: true,
      plan: {
        state: "needs-clarification",
        validation: {
          status: "blocked",
          blockers: [{ stepId: "step-1", reason: "unexpected_navigation" }],
        },
      },
    });
  });

  it("accepts only consistent completed and failed execution lifecycles", () => {
    const created = {
      ok: true as const,
      plan: legacyWalkthroughPlanFixture({
        targetUrl: "https://example.com",
        script: "Click Get started.",
        mode: "best-guess",
      }),
    };
    if (!created.ok) throw new Error("test plan should be valid");
    const approved = approveWalkthroughPlan(created.plan, { allowBestGuessBypass: true });
    if (!approved.ok) throw new Error("test plan should approve");

    const completed = structuredClone(approved.plan);
    completed.state = "executed";
    completed.execution = {
      status: "completed",
      startedAt: "2026-07-10T17:00:00.000Z",
      endedAt: "2026-07-10T17:00:01.000Z",
      durationMs: 1_000,
      pacingProfile: "natural-v1",
      steps: [{ stepId: "step-1", action: "click", status: "completed" }],
      capture: {
        outputDir: "/captures/demo",
        manifestPath: "/captures/demo/capture.manifest.json",
      },
    };
    const failed = structuredClone(completed);
    failed.state = "approved";
    failed.execution.status = "failed";

    expect(isWalkthroughPlan(completed)).toBe(true);
    expect(isWalkthroughPlan(failed)).toBe(true);

    failed.state = "executed";
    expect(isWalkthroughPlan(failed)).toBe(false);
  });

  it("preserves safe execution data and rejects malformed action fields", async () => {
    const executable = plan("Type launch demo into Search. Wait 2 seconds.");

    const result = await validateWalkthroughPlan(executable, {}, { browser: runner({}) });

    expect(result.ok && result.plan.steps).toMatchObject([
      { action: "type", inputBinding: "step-1" },
      { action: "wait", waitDurationMs: 2_000 },
    ]);

    executable.steps[0].waitDurationMs = 500;
    expect(isWalkthroughPlan(executable)).toBe(false);
  });

  it("rejects incomplete or non-browser-safe plan shapes", async () => {
    const invalidPlan = {
      id: "partial-plan",
      target: { kind: "browser", url: "file:///etc/passwd" },
      mode: "validate-first",
      steps: [],
      questions: [],
    };

    const result = await validateWalkthroughPlan(
      invalidPlan as never,
      {},
      {
        browser: runner({}),
      },
    );

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "invalid_plan",
          message: "Walkthrough validation requires a valid walkthrough plan.",
        },
      ],
    });
  });

  it("rejects plans with inconsistent steps and questions", async () => {
    const emptyPlan = plan("Click Get started.");
    emptyPlan.source.script = "";
    emptyPlan.steps = [];

    const mismatchedPlan = plan("Pick the best option.");
    mismatchedPlan.questions[0].stepId = "missing-step";

    for (const invalidPlan of [emptyPlan, mismatchedPlan]) {
      await expect(
        validateWalkthroughPlan(invalidPlan, {}, { browser: runner({}) }),
      ).resolves.toMatchObject({
        ok: false,
        errors: [{ code: "invalid_plan" }],
      });
    }
  });

  it("rejects contradictory or cross-referenced validation evidence", () => {
    const contradictory = plan("Click Get started.");
    contradictory.state = "validated";
    contradictory.validation = {
      status: "ready",
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
      blockers: [],
    };

    const crossReferenced = plan("Click Get started.");
    crossReferenced.state = "needs-clarification";
    crossReferenced.validation = {
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
          stepId: "missing-step",
          reason: "missing_element",
          question: "Which element should be used?",
        },
      ],
    };

    expect(isWalkthroughPlan(contradictory)).toBe(false);
    expect(isWalkthroughPlan(crossReferenced)).toBe(false);
  });

  it("rejects target URLs with credential-like query parameters", async () => {
    for (const url of [
      "https://example.com/signup?auth=hunter2",
      "https://example.com/signup?X-Amz-Signature=abcdef123456",
      "https://example.com/signup#access_token=hunter2",
      "https://example.com/signup#sk-live-secret",
      "https://example.com/signup#eyJhbGciOiJIUzI1NiJ9.payload.signature",
      "https://example.com/signup#100%",
      "https://example.com/signup?state=eyJhbGciOiJIUzI1NiJ9.payload.signature",
    ]) {
      const unsafePlan = plan("Click Get started.");
      unsafePlan.target.url = url;

      await expect(
        validateWalkthroughPlan(unsafePlan, {}, { browser: runner({}) }),
      ).resolves.toEqual({
        ok: false,
        errors: [
          {
            code: "unsafe_target_url",
            message: "Walkthrough validation target URL contains credential-like data.",
          },
        ],
      });
    }
  });

  it("blocks destructive and credential-like actions without performing them", async () => {
    let performedAction = false;
    const browser = runner({});
    browser.click = async () => {
      performedAction = true;
    };
    browser.type = async () => {
      performedAction = true;
    };

    const result = await validateWalkthroughPlan(
      plan("Click Delete account. Type hunter2 into Password."),
      {},
      { browser },
    );

    expect(performedAction).toBe(false);
    expect(result.ok && result.plan.validation.blockers).toEqual([
      {
        id: "blocker-1",
        stepId: "step-1",
        reason: "unsafe_action",
        question:
          "How should this potentially destructive action be validated safely: Click Delete account.?",
      },
    ]);
    expect(result.ok && result.plan.validation.checks.map((check) => check.status)).toEqual([
      "blocked",
      "skipped",
    ]);
  });

  it("blocks broader destructive actions and potentially mutating controls", async () => {
    let clicked = false;
    const browser = runner({});
    browser.click = async () => {
      clicked = true;
    };

    const result = await validateWalkthroughPlan(plan("Click Erase all data."), {}, { browser });

    const mutatingControl = runner({
      "step-1": [
        {
          id: "submit-match",
          label: "Continue",
          role: "button",
          actionRisk: "potentially-mutating",
        },
      ],
    });
    mutatingControl.click = async () => {
      clicked = true;
    };
    const controlResult = await validateWalkthroughPlan(
      plan("Click Continue."),
      {},
      {
        browser: mutatingControl,
      },
    );

    expect(clicked).toBe(false);
    expect(result.ok && result.plan.validation.blockers.map((blocker) => blocker.reason)).toEqual([
      "unsafe_action",
    ]);
    expect(
      controlResult.ok && controlResult.plan.validation.blockers.map((blocker) => blocker.reason),
    ).toEqual(["unsafe_action"]);
  });

  it("reports blocked non-idempotent browser requests as unsafe actions", async () => {
    const browser = runner({});
    browser.waitForIdle = async () => {
      throw new WalkthroughValidationRunnerError("unsafe_action");
    };

    const result = await validateWalkthroughPlan(plan("Click Get started."), {}, { browser });

    expect(result.ok && result.plan.validation.blockers).toContainEqual({
      id: "blocker-1",
      stepId: "step-1",
      reason: "unsafe_action",
      question:
        "How should this potentially destructive action be validated safely: Click Get started.?",
    });
  });

  it("redacts secret-like text from every serialized plan field", async () => {
    const unsafePlan = plan("Pick sk-live-secret.");
    unsafePlan.source.script = "Pick sk-live-secret.";
    unsafePlan.steps[0].sourceText = "Pick sk-live-secret.";
    unsafePlan.steps[0].public.summary = "Pick sk-live-secret.";
    unsafePlan.questions[0].prompt = "Use token=sk-live-secret and password is hunter2";
    unsafePlan.warnings.push({
      code: "token-warning",
      message: "Bearer abcdefghijklmnop eyJhbGciOiJIUzI1NiJ9.payload.signature",
    });
    Object.assign(unsafePlan, { extraSecret: "password=secret-value" });

    const result = await validateWalkthroughPlan(unsafePlan, {}, { browser: runner({}) });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("sk-live-secret");
    expect(serialized).not.toContain("abcdefghijklmnop");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(serialized).not.toContain("secret-value");
    expect(serialized).not.toContain("extraSecret");
    expect(serialized).toContain("[redacted-secret]");
  });

  it("sanitizes every candidate field", async () => {
    const result = await validateWalkthroughPlan(
      plan("Click Get started."),
      {},
      {
        browser: runner({
          "step-1": [
            {
              id: "token=sk-live-secret",
              label: "password is hunter2",
              role: "credential abcdefghijklmnop eyJhbGciOiJIUzI1NiJ9.payload.signature",
            },
            { id: "safe-id", label: "Get started", role: "button" },
          ],
        }),
      },
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("sk-live-secret");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("abcdefghijklmnop");
    expect(serialized).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("marks a straightforward resolved plan as ready", async () => {
    const result = await validateWalkthroughPlan(
      plan("Go to https://example.com/signup. Click Get started. Verify pricing appears."),
      { now: () => new Date("2026-07-09T12:00:00.000Z") },
      { browser: runner({}) },
    );

    expect(result).toMatchObject({
      ok: true,
      plan: {
        state: "validated",
        validation: {
          status: "ready",
          validatedAt: "2026-07-09T12:00:00.000Z",
          mode: "dry-run",
          blockers: [],
        },
      },
    });
    expect(result.ok && result.plan.validation.checks.map((check) => check.status)).toEqual([
      "passed",
      "passed",
      "passed",
    ]);
  });

  it("returns all safely discoverable blockers and skips unsafe dependent actions", async () => {
    const result = await validateWalkthroughPlan(
      plan("Click Get started. Type hunter2 into the password field. Verify dashboard appears."),
      { now: () => new Date("2026-07-09T12:00:00.000Z") },
      {
        browser: runner({
          "step-1": [
            { id: "candidate-1-match", label: "Header: Get started", role: "button" },
            { id: "candidate-2-match", label: "Hero: Get started", role: "button" },
          ],
          "step-3": [],
        }),
      },
    );

    expect(result.ok && result.plan.validation.status).toBe("blocked");
    expect(result.ok && result.plan.state).toBe("needs-clarification");
    expect(result.ok && result.plan.validation.blockers).toEqual([
      {
        id: "blocker-1",
        stepId: "step-1",
        reason: "multiple_matching_elements",
        question: "Which 'Click Get started.' target should be used?",
        candidates: [
          { id: "candidate-1-match", label: "Header: Get started", role: "button" },
          { id: "candidate-2-match", label: "Hero: Get started", role: "button" },
        ],
      },
      {
        id: "blocker-3",
        stepId: "step-3",
        reason: "missing_element",
        question: "What visible page element should satisfy: Verify dashboard appears.?",
      },
    ]);
    expect(result.ok && result.plan.validation.checks.map((check) => check.status)).toEqual([
      "blocked",
      "skipped",
      "blocked",
    ]);
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });

  it("preserves unresolved plan questions as validation blockers", async () => {
    const result = await validateWalkthroughPlan(
      plan("Open the dashboard. Pick the best option."),
      { now: () => new Date("2026-07-09T12:00:00.000Z") },
      { browser: runner({}) },
    );

    expect(result.ok && result.plan.validation.status).toBe("blocked");
    expect(result.ok && result.plan.validation.blockers).toContainEqual({
      id: "blocker-2",
      stepId: "step-2",
      reason: "unresolved_plan_question",
      question: "Clarify how to perform: Pick the best option.",
    });
  });

  it("accepts complete approved walkthrough plan artifacts", async () => {
    const validated = await validateWalkthroughPlan(
      plan("Click Get started."),
      { now: () => new Date("2026-07-09T12:00:00.000Z") },
      { browser: runner({}) },
    );
    if (!validated.ok) {
      throw new Error("test plan should validate");
    }
    const approved = {
      ...validated.plan,
      state: "approved" as const,
      approvals: {
        required: true as const,
        approved: true,
        approvedAt: "2026-07-10T12:00:00.000Z",
        planFingerprint: `sha256:${"a".repeat(64)}`,
        basis: "validated" as const,
      },
    };

    expect(isWalkthroughPlan(approved)).toBe(true);
  });

  it("skips actions after unresolved prerequisites but continues safe inspection", async () => {
    let clicked = false;
    const browser = runner({ "step-3": [] });
    browser.click = async () => {
      clicked = true;
    };

    const result = await validateWalkthroughPlan(
      plan("Pick the best option. Click Continue. Verify landing appears."),
      {},
      { browser },
    );

    expect(clicked).toBe(false);
    expect(result.ok && result.plan.validation.checks.map((check) => check.status)).toEqual([
      "blocked",
      "skipped",
      "blocked",
    ]);
    expect(result.ok && result.plan.validation.blockers.map((blocker) => blocker.reason)).toEqual([
      "unresolved_plan_question",
      "missing_element",
    ]);
  });

  it("rehearses explicit navigation steps against their destination", async () => {
    const navigated: string[] = [];
    let state: WalkthroughValidationPageState = {
      url: "https://example.com/signup",
      title: "Signup",
      authWall: false,
    };
    const browser = {
      ...runner({}),
      async navigate(url: string) {
        navigated.push(url);
        state = { url, title: "Dashboard", authWall: false };
      },
      async inspectPage() {
        return state;
      },
    };

    const result = await validateWalkthroughPlan(
      plan("Go to https://example.com/dashboard."),
      {},
      { browser },
    );

    expect(navigated).toEqual(["https://example.com/dashboard"]);
    expect(result.ok && result.plan.validation.status).toBe("ready");
  });

  it("blocks navigation steps that have no explicit destination", async () => {
    const result = await validateWalkthroughPlan(
      plan("Open the dashboard."),
      {},
      {
        browser: runner({}),
      },
    );

    expect(result.ok && result.plan.validation.blockers).toEqual([
      {
        id: "blocker-1",
        stepId: "step-1",
        reason: "unsupported_step_action",
        question: "What URL should validation navigate to for: Open the dashboard.?",
      },
    ]);
  });

  it("reports auth walls without trying to match page controls", async () => {
    let inspectedControls = false;
    const browser = runner(
      {},
      {
        initialState: {
          url: "https://example.com/login",
          title: "Sign in",
          authWall: true,
        },
      },
    );
    browser.findMatches = async () => {
      inspectedControls = true;
      return [];
    };

    const result = await validateWalkthroughPlan(plan("Click Get started."), {}, { browser });

    expect(inspectedControls).toBe(false);
    expect(result.ok && result.plan.validation.blockers).toEqual([
      {
        id: "blocker-1",
        stepId: "step-1",
        reason: "auth_wall_detected",
        question: "How should validation authenticate before: Click Get started.?",
      },
    ]);
  });

  it("reports unexpected cross-origin navigation after an action", async () => {
    const result = await validateWalkthroughPlan(
      plan("Click Get started."),
      {},
      {
        browser: runner(
          {},
          {
            stateAfterClick: {
              url: "https://other.example/landing?token=secret#private",
              title: "Landing",
              authWall: false,
            },
          },
        ),
      },
    );

    expect(result.ok && result.plan.validation.blockers).toEqual([
      {
        id: "blocker-1",
        stepId: "step-1",
        reason: "unexpected_navigation",
        question:
          "Should validation continue after Click Get started. navigates to https://other.example/landing?",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("token=secret");
  });

  it("reports unexpected same-origin route changes after an action", async () => {
    const result = await validateWalkthroughPlan(
      plan("Click Get started."),
      {},
      {
        browser: runner(
          {},
          {
            stateAfterClick: {
              url: "https://example.com/admin",
              title: "Admin",
              authWall: false,
            },
          },
        ),
      },
    );

    expect(result.ok && result.plan.validation.blockers).toContainEqual({
      id: "blocker-1",
      stepId: "step-1",
      reason: "unexpected_navigation",
      question:
        "Should validation continue after Click Get started. navigates to https://example.com/admin?",
    });
  });

  it("reports unexpected hash-route changes without exposing the fragment", async () => {
    const result = await validateWalkthroughPlan(
      plan("Click Get started."),
      {},
      {
        browser: runner(
          {},
          {
            initialState: {
              url: "https://example.com/app#/home",
              title: "Home",
              authWall: false,
            },
            stateAfterClick: {
              url: "https://example.com/app#/admin?token=secret",
              title: "Admin",
              authWall: false,
            },
          },
        ),
      },
    );

    expect(result.ok && result.plan.validation.blockers).toContainEqual({
      id: "blocker-1",
      stepId: "step-1",
      reason: "unexpected_navigation",
      question:
        "Should validation continue after Click Get started. navigates to https://example.com/app?",
    });
    expect(JSON.stringify(result)).not.toContain("#/admin");
  });

  it("returns a structured setup failure and still closes the browser", async () => {
    let closed = false;
    const result = await validateWalkthroughPlan(
      plan("Click Get started."),
      {},
      {
        browser: {
          async open() {
            throw new Error("browser unavailable with token=secret");
          },
          async inspectPage() {
            throw new Error("browser is not open");
          },
          async navigate() {},
          async findMatches() {
            return [];
          },
          async click() {},
          async type() {},
          async waitForIdle() {},
          async close() {
            closed = true;
          },
        },
      },
    );

    expect(closed).toBe(true);
    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "browser_setup_failed",
          message: "Walkthrough validation browser setup failed.",
        },
      ],
    });
  });

  it("returns a structured navigation failure from the browser runner", async () => {
    const result = await validateWalkthroughPlan(
      plan("Click Get started."),
      {},
      {
        browser: {
          ...runner({}),
          async open() {
            throw new WalkthroughValidationRunnerError("navigation_failed");
          },
        },
      },
    );

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "navigation_failed",
          message: "Walkthrough validation could not navigate to the target page.",
        },
      ],
    });
  });
});
