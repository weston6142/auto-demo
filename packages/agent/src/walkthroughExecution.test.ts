import { describe, expect, it } from "vitest";
import {
  approveWalkthroughPlan,
  executeWalkthroughPlan,
  isWalkthroughPlan,
  verifyWalkthroughPlanApproval,
  type WalkthroughExecutionBrowser,
  type WalkthroughExecutionCaptureSession,
  type WalkthroughExecutionDependencies,
  type WalkthroughPlan,
} from "./index.js";
import { legacyWalkthroughPlanFixture } from "./walkthroughTestFixtures.js";

function plan(script = "Click Get started. Verify Results."): WalkthroughPlan {
  const created = {
    ok: true as const,
    plan: legacyWalkthroughPlanFixture({
      targetUrl: "https://example.com/start",
      script,
      mode: "best-guess",
    }),
  };
  if (!created.ok) throw new Error("test plan should be valid");
  for (const step of created.plan.steps) {
    if (step.action === "click") step.targetHint = { kind: "accessible", label: "Get started" };
    if (step.action === "type") step.targetHint = { kind: "accessible", label: "Search" };
    if (step.action === "assert") step.targetHint = { kind: "accessible", label: "Results" };
  }
  return created.plan;
}

function approvedPlan(script?: string): WalkthroughPlan {
  const approved = approveWalkthroughPlan(plan(script), {
    allowBestGuessBypass: true,
    now: () => new Date("2026-07-10T17:00:00.000Z"),
  });
  if (!approved.ok) throw new Error("test plan should approve");
  return approved.plan;
}

function browser(actions: string[], failClick = false): WalkthroughExecutionBrowser {
  return {
    async navigate(url) {
      actions.push(`navigate:${url}`);
    },
    async click(target) {
      actions.push(`click:${target.label}`);
      if (failClick)
        throw Object.assign(new Error("private DOM details"), { code: "target_not_found" });
    },
    async type(target, value, options) {
      actions.push(`type:${target.label}:${value}:${options.delayMs}`);
    },
    async select(target, optionLabel) {
      actions.push(`select:${target.label}:${optionLabel}`);
    },
    async assertVisible(target) {
      actions.push(`assert:${target.label}`);
    },
    async assertNavigation(expectation) {
      actions.push(`assert-navigation:${expectation.url}:${expectation.match}`);
    },
    async assertControlState(assertion) {
      actions.push(`assert-control:${assertion.target.label}`);
    },
    async waitForSettled() {
      actions.push("settled");
    },
  };
}

function session(
  executionBrowser: WalkthroughExecutionBrowser,
  stopReasons: string[],
): WalkthroughExecutionCaptureSession {
  return {
    browser: executionBrowser,
    outputDir: "/captures/demo",
    manifestPath: "/captures/demo/capture.manifest.json",
    async stop(reason) {
      stopReasons.push(reason);
      return {
        ok: true,
        output: {
          outputDir: "/captures/demo",
          manifestPath: "/captures/demo/capture.manifest.json",
          mediaPath: "/captures/demo/media/viewport.webm",
          metadataPath: "/captures/demo/metadata/events.jsonl",
          startedAt: "2026-07-10T17:00:00.000Z",
          endedAt: "2026-07-10T17:00:03.000Z",
          durationMs: 3_000,
        },
      };
    },
  };
}

function dependencies(
  captureSession: WalkthroughExecutionCaptureSession,
  starts: string[],
  sleeps: number[] = [],
): WalkthroughExecutionDependencies {
  let tick = 0;
  return {
    now: () => new Date(Date.parse("2026-07-10T17:00:00.000Z") + tick++ * 100),
    async sleep(durationMs) {
      sleeps.push(durationMs);
    },
    interrupted: new Promise<void>(() => {}),
    async outputDirectoryState() {
      return "missing";
    },
    async startCapture(options) {
      starts.push(options.sourceUrl);
      return { ok: true, session: captureSession };
    },
  };
}

describe("executeWalkthroughPlan", () => {
  it("uses the approved launch profile for capture when no viewport override is supplied", async () => {
    const draft = plan();
    draft.launchProfile = {
      schemaVersion: 1,
      browser: "chromium",
      channel: "chrome",
      headless: false,
      viewport: { width: 1440, height: 900 },
    };
    const approved = approveWalkthroughPlan(draft, {
      allowBestGuessBypass: true,
      now: () => new Date("2026-07-10T17:00:00.000Z"),
    });
    if (!approved.ok) throw new Error("test plan should approve");
    const base = dependencies(session(browser([]), []), []);
    let captureOptions: Parameters<WalkthroughExecutionDependencies["startCapture"]>[0] | undefined;
    base.startCapture = async (options) => {
      captureOptions = options;
      return { ok: true, session: session(browser([]), []) };
    };

    const result = await executeWalkthroughPlan(
      { plan: approved.plan, outputDir: "/captures/demo" },
      base,
    );

    expect(result.ok).toBe(true);
    expect(captureOptions).toMatchObject({
      viewport: { width: 1440, height: 900 },
      launchProfile: approved.plan.launchProfile,
    });
  });

  it("rejects a viewport override that differs from the approved launch profile", async () => {
    const draft = plan();
    draft.launchProfile = {
      schemaVersion: 1,
      browser: "chromium",
      channel: "bundled",
      headless: true,
      viewport: { width: 1440, height: 900 },
    };
    const approved = approveWalkthroughPlan(draft, {
      allowBestGuessBypass: true,
      now: () => new Date("2026-07-10T17:00:00.000Z"),
    });
    if (!approved.ok) throw new Error("test plan should approve");
    const starts: string[] = [];

    const result = await executeWalkthroughPlan(
      {
        plan: approved.plan,
        outputDir: "/captures/demo",
        viewport: { width: 1280, height: 720 },
      },
      dependencies(session(browser([]), []), starts),
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "preflight",
      errors: [{ code: "launch_profile_mismatch" }],
    });
    expect(starts).toEqual([]);
  });

  it("rejects unapproved plans before capture starts", async () => {
    const starts: string[] = [];
    const result = await executeWalkthroughPlan(
      {
        plan: plan(),
        outputDir: "/captures/demo",
        viewport: { width: 1280, height: 720 },
      },
      dependencies(session(browser([], false), []), starts),
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "preflight",
      errors: [{ code: "unapproved_plan" }],
    });
    expect(starts).toEqual([]);
  });

  it("rejects stale approval, invalid bindings, and output collisions before capture", async () => {
    const stale = approvedPlan();
    stale.steps[0].public.summary = "Click something else.";
    const missingBinding = approvedPlan("Type launch demo into Search.");
    const extraBinding = approvedPlan();
    const starts: string[] = [];
    const base = dependencies(session(browser([]), []), starts);

    const staleResult = await executeWalkthroughPlan(
      { plan: stale, outputDir: "/captures/demo", viewport: { width: 1280, height: 720 } },
      base,
    );
    const missingResult = await executeWalkthroughPlan(
      {
        plan: missingBinding,
        outputDir: "/captures/demo",
        viewport: { width: 1280, height: 720 },
      },
      base,
    );
    const extraResult = await executeWalkthroughPlan(
      {
        plan: extraBinding,
        inputBindings: { unused: "value" },
        outputDir: "/captures/demo",
        viewport: { width: 1280, height: 720 },
      },
      base,
    );
    const collisionDependencies = dependencies(session(browser([]), []), starts);
    collisionDependencies.outputDirectoryState = async () => "non-empty";
    const collisionResult = await executeWalkthroughPlan(
      {
        plan: approvedPlan(),
        outputDir: "/captures/demo",
        viewport: { width: 1280, height: 720 },
      },
      collisionDependencies,
    );

    expect(staleResult).toMatchObject({ errors: [{ code: "stale_approval" }] });
    expect(missingResult).toMatchObject({ errors: [{ code: "missing_input_binding" }] });
    expect(extraResult).toMatchObject({ errors: [{ code: "unexpected_input_binding" }] });
    expect(collisionResult).toMatchObject({ errors: [{ code: "capture_output_collision" }] });
    expect(starts).toEqual([]);
  });

  it("reuses one runtime input binding across multiple type steps", async () => {
    const duplicate = plan("Type alpha into Search. Type beta into Search.");
    duplicate.steps[1].inputBinding = duplicate.steps[0].inputBinding;
    const approved = approveWalkthroughPlan(duplicate, {
      allowBestGuessBypass: true,
      now: () => new Date("2026-07-10T17:00:00.000Z"),
    });
    if (!approved.ok) throw new Error("test plan should approve");
    const starts: string[] = [];
    const actions: string[] = [];

    const result = await executeWalkthroughPlan(
      {
        plan: approved.plan,
        inputBindings: { "step-1": "runtime private value" },
        outputDir: "/captures/demo",
        viewport: { width: 1280, height: 720 },
      },
      dependencies(session(browser(actions), []), starts),
    );

    expect(result).toMatchObject({
      ok: true,
      phase: "completed",
    });
    expect(starts).toEqual(["https://example.com/start"]);
    expect(actions.filter((action) => action.includes("runtime private value"))).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain("runtime private value");
  });

  it("executes a structured navigation assertion without resolving a target", async () => {
    const raw = plan("Verify Results.");
    raw.steps[0].targetHint = undefined;
    raw.steps[0].assertion = {
      kind: "navigation",
      url: "https://example.com/results",
      match: "same-origin-path",
    };
    const approved = approveWalkthroughPlan(raw, { allowBestGuessBypass: true });
    if (!approved.ok) throw new Error("test plan should approve");
    const actions: string[] = [];
    const executionBrowser = browser(actions);

    const result = await executeWalkthroughPlan(
      {
        plan: approved.plan,
        outputDir: "/captures/demo",
        viewport: { width: 1280, height: 720 },
      },
      dependencies(session(executionBrowser, []), []),
    );

    expect(result.ok).toBe(true);
    expect(actions).toContain("assert-navigation:https://example.com/results:same-origin-path");
    expect(actions.some((action) => action.startsWith("assert:"))).toBe(false);
  });

  it("executes an approved semantic selection and control-state assertion", async () => {
    const raw = plan();
    raw.steps[0] = {
      ...raw.steps[0]!,
      action: "select",
      sourceText: "Select New in Condition.",
      public: { summary: "Select New in Condition." },
      targetHint: { kind: "accessible", label: "Condition", role: "combobox" },
      optionLabel: "New",
    };
    raw.steps[1] = {
      ...raw.steps[1]!,
      action: "assert",
      sourceText: "Verify Condition form state.",
      public: { summary: "Verify Condition form state." },
      targetHint: { kind: "accessible", label: "Condition", role: "combobox" },
      assertion: {
        kind: "control-state",
        target: { kind: "accessible", label: "Condition", role: "combobox" },
        state: { selectedOption: "New" },
      },
    };
    const approved = approveWalkthroughPlan(raw, { allowBestGuessBypass: true });
    if (!approved.ok) throw new Error("semantic form plan should approve");
    const actions: string[] = [];

    const result = await executeWalkthroughPlan(
      { plan: approved.plan, outputDir: "/captures/demo" },
      dependencies(session(browser(actions), []), []),
    );

    expect(result.ok).toBe(true);
    expect(actions).toEqual(
      expect.arrayContaining(["select:Condition:New", "assert-control:Condition"]),
    );
  });

  it("executes an approved plan with runtime bindings and natural pacing", async () => {
    const actions: string[] = [];
    const stopReasons: string[] = [];
    const starts: string[] = [];
    const sleeps: number[] = [];
    const input = approvedPlan(
      "Go to https://example.com/start. Click Get started. Type launch demo into Search. Wait 1 second. Verify Results.",
    );

    const result = await executeWalkthroughPlan(
      {
        plan: input,
        inputBindings: { "step-3": "launch demo private" },
        outputDir: "/captures/demo",
        viewport: { width: 1280, height: 720 },
      },
      dependencies(session(browser(actions), stopReasons), starts, sleeps),
    );

    expect(result).toMatchObject({
      ok: true,
      phase: "completed",
      plan: { state: "executed", execution: { status: "completed", pacingProfile: "natural-v1" } },
      steps: [
        { stepId: "step-1", status: "completed" },
        { stepId: "step-2", status: "completed" },
        { stepId: "step-3", status: "completed" },
        { stepId: "step-4", status: "completed" },
        { stepId: "step-5", status: "completed" },
      ],
    });
    expect(starts).toEqual(["https://example.com/start"]);
    expect(actions).toContain("type:Search:launch demo private:75");
    expect(sleeps).toContain(1_000);
    expect(stopReasons).toEqual(["completed"]);
    expect(input.state).toBe("approved");
    expect(JSON.stringify(result)).not.toContain("launch demo private");
    expect(result.ok && result.plan.approvals.approved).toBe(true);
    expect(result.ok && isWalkthroughPlan(result.plan)).toBe(true);
    expect(result.ok && verifyWalkthroughPlanApproval(result.plan)).toEqual({ ok: true });
  });

  it("fails fast, preserves the failed capture, and skips later steps", async () => {
    const actions: string[] = [];
    const stopReasons: string[] = [];
    const result = await executeWalkthroughPlan(
      {
        plan: approvedPlan("Click Get started. Verify Results."),
        outputDir: "/captures/demo",
        viewport: { width: 1280, height: 720 },
      },
      dependencies(session(browser(actions, true), stopReasons), []),
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "execution",
      plan: { state: "approved", execution: { status: "failed" } },
      steps: [
        { stepId: "step-1", status: "failed", errorCode: "target_not_found" },
        { stepId: "step-2", status: "skipped" },
      ],
      errors: [{ code: "target_not_found", stepId: "step-1" }],
    });
    expect(stopReasons).toEqual(["failed"]);
    expect(actions).toEqual(["click:Get started"]);
    expect(JSON.stringify(result)).not.toContain("private DOM details");
    expect(!result.ok && result.plan?.approvals.approved).toBe(true);
    expect(!result.ok && result.plan !== undefined && isWalkthroughPlan(result.plan)).toBe(true);
    expect(
      !result.ok && result.plan !== undefined && verifyWalkthroughPlanApproval(result.plan),
    ).toEqual({
      ok: true,
    });
  });

  it("stops an active capture as interrupted", async () => {
    const stopReasons: string[] = [];
    const deps = dependencies(session(browser([]), stopReasons), []);
    deps.interrupted = Promise.resolve();

    const result = await executeWalkthroughPlan(
      {
        plan: approvedPlan(),
        outputDir: "/captures/demo",
        viewport: { width: 1280, height: 720 },
      },
      deps,
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "execution",
      interrupted: true,
      errors: [{ code: "execution_interrupted" }],
    });
    expect(stopReasons).toEqual(["interrupted"]);
  });

  it("waits for an in-flight browser action to settle before stopping on interruption", async () => {
    let markClickStarted!: () => void;
    let releaseClick!: () => void;
    let interrupt!: () => void;
    const clickStarted = new Promise<void>((resolve) => {
      markClickStarted = resolve;
    });
    const clickReleased = new Promise<void>((resolve) => {
      releaseClick = resolve;
    });
    const interrupted = new Promise<void>((resolve) => {
      interrupt = resolve;
    });
    const stopReasons: string[] = [];
    const executionBrowser = browser([]);
    executionBrowser.click = async () => {
      markClickStarted();
      await clickReleased;
    };
    const deps = dependencies(session(executionBrowser, stopReasons), []);
    deps.interrupted = interrupted;

    const execution = executeWalkthroughPlan(
      {
        plan: approvedPlan("Click Get started."),
        outputDir: "/captures/demo",
        viewport: { width: 1280, height: 720 },
      },
      deps,
    );
    await clickStarted;
    interrupt();
    await Promise.resolve();
    await Promise.resolve();

    expect(stopReasons).toEqual([]);
    releaseClick();
    const result = await execution;
    expect(result).toMatchObject({ ok: false, interrupted: true });
    expect(stopReasons).toEqual(["interrupted"]);
  });

  it("reports capture finalization failure when interrupted capture cannot stop", async () => {
    const failedStop = session(browser([]), []);
    failedStop.stop = async () => ({
      ok: false,
      code: "capture_stop_failed",
      outputDir: "/captures/demo",
      manifestPath: "/captures/demo/capture.manifest.json",
    });
    const deps = dependencies(failedStop, []);
    deps.interrupted = Promise.resolve();

    const result = await executeWalkthroughPlan(
      {
        plan: approvedPlan(),
        outputDir: "/captures/demo",
        viewport: { width: 1280, height: 720 },
      },
      deps,
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "capture-finalize",
      interrupted: true,
      errors: [{ code: "capture_stop_failed" }],
    });
  });

  it("turns unexpected capture setup and pacing exceptions into stable failures", async () => {
    const setupDeps = dependencies(session(browser([]), []), []);
    setupDeps.startCapture = async () => {
      throw new Error("private capture dependency detail");
    };
    const setupResult = await executeWalkthroughPlan(
      {
        plan: approvedPlan(),
        outputDir: "/captures/demo",
        viewport: { width: 1280, height: 720 },
      },
      setupDeps,
    );

    const stopReasons: string[] = [];
    const pacingDeps = dependencies(session(browser([]), stopReasons), []);
    pacingDeps.sleep = async () => {
      throw new Error("private timer dependency detail");
    };
    const pacingResult = await executeWalkthroughPlan(
      {
        plan: approvedPlan(),
        outputDir: "/captures/demo",
        viewport: { width: 1280, height: 720 },
      },
      pacingDeps,
    );

    expect(setupResult).toMatchObject({
      ok: false,
      phase: "capture-setup",
      errors: [{ code: "capture_setup_failed" }],
    });
    expect(pacingResult).toMatchObject({
      ok: false,
      phase: "execution",
      errors: [{ code: "action_failed" }],
    });
    expect(stopReasons).toEqual(["failed"]);
    expect(JSON.stringify([setupResult, pacingResult])).not.toContain("private");
  });

  it("preserves a bounded anti-bot challenge from final capture", async () => {
    const challengeDeps = dependencies(session(browser([]), []), []);
    challengeDeps.startCapture = async () =>
      ({
        ok: false,
        code: "anti_bot_challenge",
        outputDir: "/captures/demo",
        manifestPath: "/captures/demo/capture.manifest.json",
        diagnostic: { provider: "cloudflare", profileId: "sha256:public-profile" },
      }) as unknown as Awaited<ReturnType<WalkthroughExecutionDependencies["startCapture"]>>;

    const result = await executeWalkthroughPlan(
      {
        plan: approvedPlan(),
        outputDir: "/captures/demo",
        viewport: { width: 1280, height: 720 },
      },
      challengeDeps,
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "capture-setup",
      errors: [
        {
          code: "anti_bot_challenge",
          diagnostic: { provider: "cloudflare", profileId: "sha256:public-profile" },
        },
      ],
    });
  });
});
