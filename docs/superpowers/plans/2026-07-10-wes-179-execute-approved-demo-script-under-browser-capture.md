# WES-179 Execute Approved Demo Script Under Browser Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `autodemo agent execute` so a verifiably approved walkthrough plan drives the same Playwright page being recorded and returns a completed or diagnostically preserved failed capture bundle.

**Architecture:** `@auto-demo/agent` owns approval-aware execution policy through a fakeable core service and structural capture/controller interfaces. `@auto-demo/capture` implements those interfaces on its existing recorded Playwright page, while `@auto-demo/cli` loads immutable artifacts, composes the packages, handles interruption, and emits one transcript-safe JSON result.

**Tech Stack:** TypeScript, Node.js 22, npm workspaces, Playwright 1.61, Vitest, existing Auto Demo capture manifest and walkthrough approval APIs.

---

## Execution Preconditions

- Run the `linear-sync-gate` skill in `pre-task` mode for WES-179 before Task 1. Confirm the project map still points to WES-179, then move WES-179 to In Progress.
- Use `superpowers:test-driven-development` for every behavior change below.
- Keep the approved design open: `docs/superpowers/specs/2026-07-10-wes-179-execute-approved-demo-script-under-browser-capture-design.md`.
- Preserve unrelated existing files: `docs/superpowers/plans/2026-07-10-check-codex-usage-skill.md`, `docs/superpowers/specs/2026-07-10-check-codex-usage-skill-design.md`, and `packages/agent/skills/auto-demo-linear-brainstorming/`.
- Do not start WES-180 project import, variant generation, editor handoff, or export work.

## File Structure

### Create

- `packages/agent/src/walkthroughExecution.ts` — execution types, preflight, pacing, step sequencing, lifecycle transitions, and sanitized results.
- `packages/agent/src/walkthroughExecution.test.ts` — black-box execution-core behavior with fake capture/controller dependencies.
- `packages/capture/src/playwrightExecutionController.ts` — strict accessible target resolution and actions on one wrapped Playwright page.
- `packages/capture/src/playwrightExecutionController.test.ts` — controller behavior for zero/one/many targets, navigation, typing, assertions, and settling.
- `packages/cli/src/agentExecuteCommand.ts` — execute command parser, immutable file loading, output collision inspection, and core composition.
- `packages/cli/src/agentExecuteCommand.test.ts` — CLI JSON contract and file-safety tests with fake execution dependencies.
- `packages/cli/src/agentExecuteCommand.smoke.test.ts` — real Playwright success and mid-script-failure capture paths against a local HTTP fixture.
- `packages/agent/fixtures/codex-walkthrough-execution.md` — operator transcript showing approval, runtime bindings, execution result, and failure handling.

### Modify

- `packages/agent/src/index.ts:142` — structured per-step execution data and execution lifecycle types; export the execution API.
- `packages/agent/src/index.test.ts:305` — intake behavior for navigation URLs, input-binding keys, and wait durations.
- `packages/agent/src/walkthroughValidation.ts:416` — validate and sanitize new execution-relevant fields.
- `packages/agent/src/walkthroughValidation.test.ts` — schema/sanitization behavior for the new fields.
- `packages/agent/src/walkthroughApproval.ts:96` — include execution-relevant fields in approval fingerprints.
- `packages/agent/src/walkthroughApproval.test.ts:151` — stale approval coverage for each new field.
- `packages/agent/package.json:14` — include execution tests.
- `packages/capture/src/index.ts:1` — public controllable capture/controller types and factory return type.
- `packages/capture/src/playwrightDriver.ts:1` — let the wrapped page create an execution controller without exposing raw Playwright handles.
- `packages/capture/src/playwrightAdapter.ts:1` — return the controller on the same capture session that owns video and metadata.
- `packages/capture/src/playwrightAdapter.test.ts` — prove controller and recorder share one fake page and preserve stop behavior.
- `packages/capture/package.json:11` — include controller tests.
- `packages/cli/src/index.ts:1` — route `agent execute`, inject the controllable adapter and interrupt watcher, and update help.
- `packages/cli/src/index.test.ts` — routing/help/exit behavior.
- `packages/cli/package.json:18` — include execute unit and smoke tests.
- `README.md` — document approval-to-execution and remove stale downstream wording.
- `packages/agent/README.md` — document runtime bindings, safety, results, and WES-180 boundary.
- `packages/agent/skills/codex-auto-demo/SKILL.md` — add agent-host execute instructions and explicit non-secret input requirements.
- `packages/agent/claude-wrapper-parity.md` — add host-neutral execution parity.
- `packages/agent/src/wrapper-docs.test.ts` — enforce the published command and safety contract.
- `packages/cli/README.md` — document execute flags and exit codes.
- `docs/linear/auto-demo-project-structure.md` — implementation evidence, completion evidence, and next-task pointer.

### Do Not Modify

- `packages/project/**`, `packages/polish/**`, `packages/editor/**`, and `packages/render/**`; those packages belong to WES-180 or established downstream workflows.

## Task 1: Make Walkthrough Plans Execution-Ready

**Files:**

- Modify: `packages/agent/src/index.ts:142`
- Modify: `packages/agent/src/index.test.ts:305`
- Modify: `packages/agent/src/walkthroughValidation.ts:416`
- Modify: `packages/agent/src/walkthroughValidation.test.ts`
- Modify: `packages/agent/src/walkthroughApproval.ts:96`
- Modify: `packages/agent/src/walkthroughApproval.test.ts:151`

- [ ] **Step 1: Write failing intake tests for structured execution data**

Add behavior cases that create a plan from:

```ts
const result = createWalkthroughPlan({
  targetUrl: "https://example.com/start",
  script:
    "Go to https://example.com/dashboard. Type launch demo into Search. Wait 2 seconds. Verify Results.",
  mode: "best-guess",
});

expect(result.ok && result.plan.steps).toMatchObject([
  { id: "step-1", action: "navigate", navigationUrl: "https://example.com/dashboard" },
  { id: "step-2", action: "type", inputBinding: "step-2" },
  { id: "step-3", action: "wait", waitDurationMs: 2_000 },
  { id: "step-4", action: "assert" },
]);
expect(JSON.stringify(result)).not.toContain("launch demo");
```

Also cover `Wait 250 ms`, a wait over 60 seconds remaining without `waitDurationMs`, and a navigation URL containing credentials being parsed without exposing its query value. Task 2 must reject that credential-bearing URL during execution preflight.

- [ ] **Step 2: Run the intake tests and verify the red state**

Run:

```bash
rtk npx vitest run packages/agent/src/index.test.ts
```

Expected: FAIL because `navigationUrl`, `inputBinding`, and `waitDurationMs` are absent.

- [ ] **Step 3: Add optional structured execution fields and deterministic intake parsing**

Extend the public step type exactly once:

```ts
export type WalkthroughPlanStep = {
  id: string;
  order: number;
  action: WalkthroughPlanStepAction;
  resolution: WalkthroughPlanStepResolution;
  sourceText: string;
  public: { summary: string };
  questionId?: string;
  targetHint?: WalkthroughPlanTargetHint;
  navigationUrl?: string;
  inputBinding?: string;
  waitDurationMs?: number;
};
```

When building each resolved step, add:

```ts
const executionData = executionDataForStep(normalized.action, stepText, stepId);
return {
  id: stepId,
  order: index + 1,
  action: normalized.action,
  resolution: "resolved",
  sourceText: normalized.action === "type" ? normalized.summary : stepText,
  public: { summary: normalized.summary },
  ...executionData,
};
```

Implement parsing with safe, bounded outputs:

```ts
function executionDataForStep(
  action: WalkthroughPlanStepAction,
  sourceText: string,
  stepId: string,
): Pick<WalkthroughPlanStep, "navigationUrl" | "inputBinding" | "waitDurationMs"> {
  if (action === "type") return { inputBinding: stepId };
  if (action === "navigate") {
    const candidate = sourceText.match(/https?:\/\/[^\s]+/i)?.[0]?.replace(/[.!?,;:]+$/, "");
    return candidate !== undefined && isHttpUrl(candidate) ? { navigationUrl: candidate } : {};
  }
  if (action === "wait") {
    const match = sourceText.match(/^wait\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|seconds?)\b/i);
    if (match === null) return {};
    const amount = Number(match[1]);
    const durationMs = /^m/i.test(match[2]) ? amount : amount * 1_000;
    return Number.isInteger(durationMs) && durationMs > 0 && durationMs <= 60_000
      ? { waitDurationMs: durationMs }
      : {};
  }
  return {};
}
```

- [ ] **Step 4: Write failing schema, sanitizer, and fingerprint tests**

Add tests that prove:

```ts
expect(isWalkthroughPlan(planWithExecutionData)).toBe(true);
expect(sanitizeWalkthroughPlanArtifact(planWithExecutionData).steps[0]).toMatchObject({
  navigationUrl: "https://example.com/dashboard",
});

const approved = approveWalkthroughPlan(validatedPlanWithExecutionData);
if (!approved.ok) throw new Error("expected approval");
approved.plan.steps[0].waitDurationMs = 3_000;
expect(verifyWalkthroughPlanApproval(approved.plan)).toMatchObject({
  ok: false,
  errors: [{ code: "stale_approval" }],
});
```

Repeat the stale-approval assertion for `navigationUrl` and `inputBinding`. Assert sanitization strips URL query/fragment data and rejects unsafe or malformed optional fields.

- [ ] **Step 5: Run schema and approval tests and verify the red state**

Run:

```bash
rtk npx vitest run packages/agent/src/walkthroughValidation.test.ts packages/agent/src/walkthroughApproval.test.ts
```

Expected: FAIL because validation, sanitization, and fingerprinting ignore the new fields.

- [ ] **Step 6: Validate, sanitize, and fingerprint every execution-relevant field**

Update `isWalkthroughPlanStep()` with action-scoped optional validation:

```ts
const executionDataValid =
  (step.navigationUrl === undefined ||
    (step.action === "navigate" && isSafeHttpUrl(step.navigationUrl))) &&
  (step.inputBinding === undefined ||
    (step.action === "type" && isSafeIdentifier(step.inputBinding))) &&
  (step.waitDurationMs === undefined ||
    (step.action === "wait" &&
      Number.isInteger(step.waitDurationMs) &&
      step.waitDurationMs > 0 &&
      step.waitDurationMs <= 60_000));
```

Copy the three fields in `sanitizePlan()` using sanitized URLs/identifiers and bounded numbers. Add them to the canonical step object in `walkthroughPlanFingerprint()`:

```ts
navigationUrl: step.navigationUrl ?? null,
inputBinding: step.inputBinding ?? null,
waitDurationMs: step.waitDurationMs ?? null,
```

- [ ] **Step 7: Run focused agent tests and make them green**

Run:

```bash
rtk npx vitest run packages/agent/src/index.test.ts packages/agent/src/walkthroughValidation.test.ts packages/agent/src/walkthroughApproval.test.ts
```

Expected: PASS with no typed value or URL secret in serialized results.

- [ ] **Step 8: Commit the execution-ready plan contract**

```bash
git add packages/agent/src/index.ts packages/agent/src/index.test.ts packages/agent/src/walkthroughValidation.ts packages/agent/src/walkthroughValidation.test.ts packages/agent/src/walkthroughApproval.ts packages/agent/src/walkthroughApproval.test.ts
git commit -m "feat(agent): add executable walkthrough step data"
```

## Task 2: Add Approval-Aware Execution Preflight

**Files:**

- Create: `packages/agent/src/walkthroughExecution.ts`
- Create: `packages/agent/src/walkthroughExecution.test.ts`
- Modify: `packages/agent/src/index.ts:1`
- Modify: `packages/agent/package.json:14`

- [ ] **Step 1: Write failing black-box preflight tests**

Create helpers that approve a best-guess plan through `approveWalkthroughPlan(..., { allowBestGuessBypass: true })`, then test public `executeWalkthroughPlan()` behavior:

```ts
it("rejects an unapproved plan before capture starts", async () => {
  let starts = 0;
  const result = await executeWalkthroughPlan(
    { plan: createPlan(), outputDir: "/tmp/demo", inputBindings: {} },
    dependencies({
      startCapture: async () => {
        starts += 1;
        return captureSession();
      },
    }),
  );

  expect(result).toMatchObject({
    ok: false,
    phase: "preflight",
    errors: [{ code: "unapproved_plan" }],
  });
  expect(starts).toBe(0);
});
```

Add cases for stale approval, missing/extra/non-string bindings, missing navigation/wait data, credential-like type targets, unsupported `question` actions, and `outputDirectoryState()` returning `non-empty`. Every case must assert the lazy capture factory was not called and serialized output excludes the bound value.

- [ ] **Step 2: Run the new test file and verify the red state**

Run:

```bash
rtk npx vitest run packages/agent/src/walkthroughExecution.test.ts
```

Expected: FAIL because the module and exports do not exist.

- [ ] **Step 3: Define the public execution contract and stable errors**

Define these public shapes in `walkthroughExecution.ts` and export them from `index.ts`:

```ts
export type WalkthroughExecutionErrorCode =
  | "invalid_execution_plan"
  | "unapproved_plan"
  | "stale_approval"
  | "unsupported_execution_action"
  | "missing_execution_data"
  | "invalid_navigation_url"
  | "invalid_wait_duration"
  | "missing_input_binding"
  | "unexpected_input_binding"
  | "invalid_input_binding"
  | "prohibited_input_target"
  | "capture_output_collision"
  | "capture_setup_failed"
  | "capture_stop_failed"
  | "target_not_found"
  | "ambiguous_target"
  | "navigation_failed"
  | "action_failed"
  | "assertion_failed"
  | "execution_timeout"
  | "execution_interrupted";

export type WalkthroughExecutionError = {
  code: WalkthroughExecutionErrorCode;
  message: string;
  stepId?: string;
  bindingKey?: string;
};

export type WalkthroughExecutionInput = {
  plan: WalkthroughPlan;
  outputDir: string;
  viewport: { width: number; height: number };
  inputBindings?: Record<string, unknown>;
};
```

Define structural capture dependencies without importing capture or Playwright packages:

```ts
export type WalkthroughExecutionTarget = {
  label: string;
  role?: string;
  occurrence?: number;
};

export type WalkthroughExecutionBrowser = {
  navigate(url: string): Promise<void>;
  click(target: WalkthroughExecutionTarget): Promise<void>;
  type(
    target: WalkthroughExecutionTarget,
    value: string,
    options: { delayMs: number },
  ): Promise<void>;
  assertVisible(target: WalkthroughExecutionTarget): Promise<void>;
  waitForSettled(): Promise<void>;
};

export type WalkthroughExecutionCaptureSession = {
  browser: WalkthroughExecutionBrowser;
  outputDir: string;
  manifestPath: string;
  stop(
    reason: "completed" | "failed" | "interrupted",
  ): Promise<WalkthroughExecutionCaptureStopResult>;
};

export type WalkthroughExecutionCaptureOutput = {
  outputDir: string;
  manifestPath: string;
  mediaPath: string;
  metadataPath: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
};

export type WalkthroughExecutionCaptureStopResult =
  | { ok: true; output: WalkthroughExecutionCaptureOutput }
  | {
      ok: false;
      code: "capture_stop_failed";
      outputDir: string;
      manifestPath: string;
    };

export type WalkthroughExecutionCaptureStartResult =
  | { ok: true; session: WalkthroughExecutionCaptureSession }
  | {
      ok: false;
      code: "capture_setup_failed";
      outputDir: string;
      manifestPath: string;
    };

export type WalkthroughExecutionStepOutcome = {
  stepId: string;
  action: WalkthroughPlanStep["action"];
  status: "completed" | "failed" | "skipped";
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  errorCode?: WalkthroughExecutionErrorCode;
};

export type WalkthroughExecutionSuccess = {
  ok: true;
  phase: "completed";
  plan: WalkthroughPlan;
  steps: WalkthroughExecutionStepOutcome[];
  capture: WalkthroughExecutionCaptureOutput;
};

export type WalkthroughExecutionFailureResult = {
  ok: false;
  phase: "preflight" | "capture-setup" | "execution" | "capture-finalize";
  plan?: WalkthroughPlan;
  steps: WalkthroughExecutionStepOutcome[];
  capture?: Partial<WalkthroughExecutionCaptureOutput> & {
    outputDir: string;
    manifestPath: string;
  };
  errors: WalkthroughExecutionError[];
  interrupted?: true;
};

export type WalkthroughExecutionResult =
  WalkthroughExecutionSuccess | WalkthroughExecutionFailureResult;

export type WalkthroughExecutionDependencies = {
  now: () => Date;
  sleep: (durationMs: number) => Promise<void>;
  interrupted: Promise<void>;
  outputDirectoryState: (path: string) => Promise<"missing" | "empty" | "non-empty">;
  startCapture: (options: {
    sourceUrl: string;
    outputDir: string;
    viewport: { width: number; height: number };
  }) => Promise<WalkthroughExecutionCaptureStartResult>;
};
```

Use these exact result types throughout later tasks; do not introduce a second CLI-only execution result schema.

- [ ] **Step 4: Implement preflight as a pure gate before the lazy capture factory**

Use `isWalkthroughPlan()`, `verifyWalkthroughPlanApproval()`, and existing unsafe-action helpers. The entry point must follow this ordering:

```ts
export async function executeWalkthroughPlan(
  input: WalkthroughExecutionInput,
  dependencies: WalkthroughExecutionDependencies,
): Promise<WalkthroughExecutionResult> {
  const preflight = await prepareExecution(input, dependencies);
  if (!preflight.ok) return preflight.result;

  const started = await dependencies.startCapture({
    sourceUrl: preflight.prepared.plan.target.url,
    outputDir: preflight.prepared.outputDir,
    viewport: preflight.prepared.viewport,
  });
  if (!started.ok) {
    return captureSetupFailure(preflight.prepared.plan, preflight.prepared.outputDir, started);
  }

  return await runPreparedExecution(preflight.prepared, started.session, dependencies);
}
```

`prepareExecution()` must copy/sanitize the plan, verify state and fingerprint, validate the exact binding set, reject sensitive targets using the approved target hint/public summary, validate output state, and return bindings only in a private prepared object. Never attach bindings to a public result.

Define the private contract used by Task 3 so later signatures remain consistent:

```ts
type PreparedExecution = {
  plan: WalkthroughPlan;
  bindings: Record<string, string>;
  outputDir: string;
  viewport: { width: number; height: number };
};

type ExecutionPreparation =
  | { ok: true; prepared: PreparedExecution }
  | { ok: false; result: WalkthroughExecutionFailureResult };

declare function prepareExecution(
  input: WalkthroughExecutionInput,
  dependencies: WalkthroughExecutionDependencies,
): Promise<ExecutionPreparation>;

declare function captureSetupFailure(
  plan: WalkthroughPlan,
  outputDir: string,
  started: Extract<WalkthroughExecutionCaptureStartResult, { ok: false }>,
): WalkthroughExecutionFailureResult;

declare function runPreparedExecution(
  prepared: PreparedExecution,
  session: WalkthroughExecutionCaptureSession,
  dependencies: WalkthroughExecutionDependencies,
): Promise<WalkthroughExecutionResult>;
```

- [ ] **Step 5: Add the test file to the agent package test script**

Append `src/walkthroughExecution.test.ts` to the existing Vitest file list in `packages/agent/package.json`.

- [ ] **Step 6: Run preflight tests and make them green**

Run:

```bash
rtk npx vitest run packages/agent/src/walkthroughExecution.test.ts
rtk npm --workspace @auto-demo/agent run typecheck
```

Expected: all preflight cases PASS and TypeScript reports no errors.

- [ ] **Step 7: Commit execution preflight**

```bash
git add packages/agent/src/walkthroughExecution.ts packages/agent/src/walkthroughExecution.test.ts packages/agent/src/index.ts packages/agent/package.json
git commit -m "feat(agent): verify plans before walkthrough execution"
```

## Task 3: Execute Steps with Natural Pacing and Fail-Fast Results

**Files:**

- Modify: `packages/agent/src/walkthroughExecution.ts`
- Modify: `packages/agent/src/walkthroughExecution.test.ts`
- Modify: `packages/agent/src/index.ts:190`

- [ ] **Step 1: Write failing success, failure, and interruption tests**

Cover one approved plan containing navigate, click, type, wait, and assert. The fake browser should record observable actions, while the fake clock advances through an injected `sleep(ms)`:

```ts
expect(result).toMatchObject({
  ok: true,
  plan: { state: "executed", execution: { status: "completed", pacingProfile: "natural-v1" } },
  capture: { manifestPath: "/captures/demo/capture.manifest.json" },
  steps: [
    { stepId: "step-1", status: "completed" },
    { stepId: "step-2", status: "completed" },
    { stepId: "step-3", status: "completed" },
    { stepId: "step-4", status: "completed" },
    { stepId: "step-5", status: "completed" },
  ],
});
expect(fakeBrowser.typed).toEqual([
  { target: { label: "Search" }, value: "launch demo", delayMs: 75 },
]);
```

Add a mid-script `target_not_found` case that expects capture stop reason `failed`, top-level state `approved`, execution status `failed`, later steps `skipped`, and no secret value in the result. Add interruption expecting stop reason `interrupted`, error `execution_interrupted`, and the caller-visible exit classification for 130.

- [ ] **Step 2: Run execution behavior tests and verify the red state**

Run:

```bash
rtk npx vitest run packages/agent/src/walkthroughExecution.test.ts
```

Expected: FAIL because prepared execution does not yet sequence actions or build lifecycle results.

- [ ] **Step 3: Add the versioned pacing profile and execution lifecycle types**

Use one exported read-only profile:

```ts
export const NATURAL_EXECUTION_PACING = {
  name: "natural-v1",
  preRollMs: 750,
  anticipationMs: 250,
  typingDelayMs: 75,
  actionSettleMs: 500,
  navigationSettleMs: 750,
  finalHoldMs: 750,
  actionTimeoutMs: 10_000,
} as const;

class WalkthroughExecutionFailure extends Error {
  constructor(
    public readonly code: WalkthroughExecutionErrorCode,
    public readonly stepId: string,
  ) {
    super(code);
  }
}
```

Extend `WalkthroughPlan["execution"]` to a discriminated union for `not-started`, `completed`, and `failed`. Completed and failed variants include timestamps, duration, pacing profile, sanitized step outcomes, and capture references; only the completed variant may accompany top-level `state: "executed"`. Update `isWalkthroughPlan()`, `isWalkthroughPlanApproval()`, and sanitizers so approved fingerprint evidence remains valid in both `approved` and `executed` states while enforcing that only `executed` may pair with completed execution.

- [ ] **Step 4: Implement sequential action execution**

Implement one switch that consumes only prepared, approved steps:

```ts
async function performStep(
  step: WalkthroughPlanStep,
  prepared: PreparedExecution,
  browser: WalkthroughExecutionBrowser,
  sleep: (durationMs: number) => Promise<void>,
): Promise<void> {
  if (step.action === "navigate") {
    await browser.navigate(requiredNavigationUrl(step, prepared.plan.target.url));
    await browser.waitForSettled();
    await sleep(NATURAL_EXECUTION_PACING.navigationSettleMs);
    return;
  }
  if (step.action === "wait") {
    await sleep(requiredWaitDuration(step));
    return;
  }
  const target = executionTargetForStep(step);
  await sleep(NATURAL_EXECUTION_PACING.anticipationMs);
  if (step.action === "click") await browser.click(target);
  else if (step.action === "type") {
    await browser.type(target, prepared.bindings[requiredBinding(step)], {
      delayMs: NATURAL_EXECUTION_PACING.typingDelayMs,
    });
  } else if (step.action === "assert") await browser.assertVisible(target);
  else throw new WalkthroughExecutionFailure("unsupported_execution_action", step.id);
  await browser.waitForSettled();
  await sleep(NATURAL_EXECUTION_PACING.actionSettleMs);
}
```

Before the switch, detect whether the first plan step is a navigation to the same normalized URL as `plan.target.url`. The capture factory already performed that navigation, so record the step as completed after pre-roll without issuing a duplicate `browser.navigate()` call:

```ts
function isInitialTargetNavigation(step: WalkthroughPlanStep, plan: WalkthroughPlan): boolean {
  if (step.order !== 1 || step.action !== "navigate" || step.navigationUrl === undefined) {
    return false;
  }
  return normalizedHttpUrl(step.navigationUrl) === normalizedHttpUrl(plan.target.url);
}

function normalizedHttpUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}
```

Apply pre-roll before the first non-initial action and final hold before completed stop. Race each active operation against the injected interruption promise. Map only known controller failures to stable public errors; sanitize unexpected exceptions to `action_failed` or `navigation_failed` without copying exception text.

- [ ] **Step 5: Implement immutable completed and failed artifacts**

Build all returned plans from copies. Success sets `state: "executed"` and `execution.status: "completed"` only after `session.stop("completed")` succeeds. Step failure stops with `failed`, keeps `state: "approved"`, records `execution.status: "failed"`, and marks later outcomes skipped. Stop failure overrides the primary result with `capture_stop_failed` while retaining available manifest/output paths.

- [ ] **Step 6: Run agent execution and schema tests**

Run:

```bash
rtk npx vitest run packages/agent/src/walkthroughExecution.test.ts packages/agent/src/walkthroughValidation.test.ts packages/agent/src/walkthroughApproval.test.ts
rtk npm --workspace @auto-demo/agent run typecheck
```

Expected: PASS, including immutable input and secret-redaction assertions.

- [ ] **Step 7: Commit execution sequencing**

```bash
git add packages/agent/src/walkthroughExecution.ts packages/agent/src/walkthroughExecution.test.ts packages/agent/src/index.ts packages/agent/src/walkthroughValidation.ts packages/agent/src/walkthroughValidation.test.ts
git commit -m "feat(agent): execute approved walkthrough plans"
```

## Task 4: Control the Same Playwright Page Being Recorded

**Files:**

- Create: `packages/capture/src/playwrightExecutionController.ts`
- Create: `packages/capture/src/playwrightExecutionController.test.ts`
- Modify: `packages/capture/src/index.ts:1`
- Modify: `packages/capture/src/playwrightDriver.ts:1`
- Modify: `packages/capture/src/playwrightAdapter.ts:1`
- Modify: `packages/capture/src/playwrightAdapter.test.ts`
- Modify: `packages/capture/package.json:11`

- [ ] **Step 1: Write failing controller behavior tests**

Use a small local/data page and assert public effects:

```ts
await controller.click({ label: "Get started", role: "button" });
await controller.type({ label: "Search" }, "launch demo", { delayMs: 1 });
await controller.assertVisible({ label: "Results" });

expect(await page.locator("[data-clicked=true]").count()).toBe(1);
expect(await page.getByLabel("Search").inputValue()).toBe("launch demo");
```

Add zero-match `target_not_found`, multiple-match `ambiguous_target`, occurrence selection, unsafe navigation, action timeout, and assertion failure cases. Public errors must contain only stable code/message/target description, never selector or DOM content.

- [ ] **Step 2: Run controller tests and verify the red state**

Run:

```bash
rtk npx vitest run packages/capture/src/playwrightExecutionController.test.ts
```

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: Add public controllable capture types**

Extend `packages/capture/src/index.ts`:

```ts
export type BrowserExecutionTarget = {
  label: string;
  role?: string;
  occurrence?: number;
};

export type BrowserCaptureController = {
  navigate(url: string): Promise<void>;
  click(target: BrowserExecutionTarget): Promise<void>;
  type(target: BrowserExecutionTarget, value: string, options: { delayMs: number }): Promise<void>;
  assertVisible(target: BrowserExecutionTarget): Promise<void>;
  waitForSettled(): Promise<void>;
};

export type ControllableCaptureSession = CaptureSession & {
  readonly browser: BrowserCaptureController;
};
```

Define controllable start/adapter result types that refine the existing capture result without breaking `autodemo capture` consumers.

- [ ] **Step 4: Implement strict accessible resolution inside the page wrapper**

Create `createPlaywrightExecutionController(page, options)`. Resolve in stable order: explicit role/name, label, button name, then exact visible text. Use the first strategy with visible candidates. Apply the approved occurrence when present; otherwise require exactly one match.

The core resolver must return only an internal locator:

```ts
async function requireOneVisibleTarget(
  page: Page,
  target: BrowserExecutionTarget,
): Promise<Locator> {
  for (const locator of matchingLocators(page, target)) {
    const visible = await visibleLocators(locator);
    if (visible.length === 0) continue;
    if (target.occurrence !== undefined) {
      const selected = visible[target.occurrence - 1];
      if (selected === undefined) throw controllerError("target_not_found");
      return selected;
    }
    if (visible.length > 1) throw controllerError("ambiguous_target");
    return visible[0];
  }
  throw controllerError("target_not_found");
}
```

Use `locator.click()`, `locator.pressSequentially(value, { delay })`, `locator.isVisible()`, and bounded `domcontentloaded` plus DOM-stability settling. Reject non-HTTP(S) navigation and credential-bearing URLs before `page.goto()`.

- [ ] **Step 5: Expose the controller from the existing captured page**

Add `executionController()` to the wrapped `PlaywrightPage`. In `startPlaywrightCapture()`, create the controller from the same `page` passed to `createPlaywrightMetadataRecorder()`, and expose it on `PlaywrightCaptureSession` as `browser`.

Update the fake driver test to prove identity behavior: an action through `start.session.browser` changes the same `FakePage` whose `video()` and metadata handlers are used. Keep `stop()` idempotence and manifest behavior unchanged.

- [ ] **Step 6: Verify metadata continues to redact typed values**

Add or extend a behavior test that types `launch demo private` through the controller, triggers the existing fill metadata path, and asserts:

```ts
expect(JSON.stringify(writer.events)).not.toContain("launch demo private");
expect(writer.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "fill" })]));
```

- [ ] **Step 7: Add controller tests to the capture package and run them**

Append `src/playwrightExecutionController.test.ts` to `packages/capture/package.json`, then run:

```bash
rtk npx vitest run packages/capture/src/playwrightExecutionController.test.ts packages/capture/src/playwrightAdapter.test.ts packages/capture/src/playwrightMetadataRecorder.test.ts
rtk npm --workspace @auto-demo/capture run typecheck
```

Expected: PASS with existing capture bundle behavior unchanged.

- [ ] **Step 8: Commit the controllable capture session**

```bash
git add packages/capture/src/index.ts packages/capture/src/playwrightDriver.ts packages/capture/src/playwrightExecutionController.ts packages/capture/src/playwrightExecutionController.test.ts packages/capture/src/playwrightAdapter.ts packages/capture/src/playwrightAdapter.test.ts packages/capture/src/playwrightMetadataRecorder.test.ts packages/capture/package.json
git commit -m "feat(capture): expose recorded browser execution control"
```

## Task 5: Add the `agent execute` CLI Contract

**Files:**

- Create: `packages/cli/src/agentExecuteCommand.ts`
- Create: `packages/cli/src/agentExecuteCommand.test.ts`
- Modify: `packages/cli/src/index.ts:1`
- Modify: `packages/cli/src/index.test.ts`
- Modify: `packages/cli/package.json:18`

- [ ] **Step 1: Write failing CLI parsing and immutable-file tests**

Cover the approved command:

```ts
const result = await runCliAsync(
  [
    "agent",
    "execute",
    "--plan",
    planPath,
    "--inputs",
    inputsPath,
    "--out",
    outputDir,
    "--viewport",
    "1280x720",
    "--json",
  ],
  dependencies,
);

expect(result.exitCode).toBe(0);
expect(JSON.parse(result.stdout)).toMatchObject({
  ok: true,
  plan: { state: "executed", execution: { status: "completed" } },
});
expect(await readFile(planPath, "utf8")).toBe(originalPlanText);
expect(await readFile(inputsPath, "utf8")).toBe(originalInputsText);
```

Add missing/invalid plan, missing/invalid inputs, missing output, missing JSON, invalid viewport, unknown argument, non-empty output collision, expected failure exit 1, and interrupted exit 130 cases. Assert stderr and stdout never contain a bound sentinel value.

- [ ] **Step 2: Run CLI execute tests and verify the red state**

Run:

```bash
rtk npx vitest run packages/cli/src/agentExecuteCommand.test.ts packages/cli/src/index.test.ts
```

Expected: FAIL because `agent execute` is routed to the older agent workflow parser.

- [ ] **Step 3: Implement a dedicated parser and immutable artifact loaders**

In `agentExecuteCommand.ts`, accept only `--plan`, optional `--inputs`, `--out`, optional `--viewport`, and `--json`. Define file errors with stable codes instead of leaking filesystem messages:

```ts
type AgentExecuteFileErrorCode =
  | "missing_plan_file"
  | "invalid_plan_json"
  | "missing_inputs_file"
  | "invalid_inputs_json"
  | "missing_capture_output"
  | "unknown_agent_argument";
```

Accept either a raw plan or `{ "plan": ... }` wrapper, as existing plan readers do. Inputs must be a non-array JSON object. Use `stat()` and `readdir()` to classify output as missing, empty, or non-empty without creating it.

- [ ] **Step 4: Compose the agent core with the controllable capture adapter**

Adapt the capture start result structurally:

```ts
const result = await executeWalkthroughPlan(
  { plan, inputBindings, outputDir, viewport },
  {
    now: dependencies.now,
    sleep: dependencies.sleep,
    interrupted: dependencies.interrupted,
    outputDirectoryState: dependencies.outputDirectoryState,
    async startCapture(options) {
      const started = await dependencies.captureAdapter.start({
        source: { kind: "browser", url: options.sourceUrl },
        outputDir: options.outputDir,
        viewport: options.viewport,
        startedAt: dependencies.now().toISOString(),
      });
      return adaptCaptureStartResult(started);
    },
  },
);
```

Create one interrupt watcher per execute invocation, pass `watcher.interrupted` into the dependencies above, and call `watcher.dispose()` in `finally` after execution settles. Do not translate errors through prose. Serialize the structured result directly with two-space JSON formatting and a trailing newline.

- [ ] **Step 5: Route execute before the existing generic agent parser**

In `runAgentCommand()` add `execute` beside review/refine/approve/validate/plan. Extend `CliDependencies` with a controllable capture adapter and injectable sleep/output inspection as needed, while keeping existing capture tests source-compatible. The default uses `createPlaywrightBrowserCaptureAdapter()` for both ordinary capture and controllable execution.

Update root and agent help with:

```text
autodemo agent execute --plan <approved-plan-json-file> [--inputs <runtime-inputs-json-file>] --out <capture-directory> [--viewport <width>x<height>] --json
```

Document exit 130 for interruption and do not add any unapproved-execution flag.

- [ ] **Step 6: Add execute tests to the CLI package and run focused verification**

Append `src/agentExecuteCommand.test.ts` to `packages/cli/package.json`, then run:

```bash
rtk npx vitest run packages/cli/src/agentExecuteCommand.test.ts packages/cli/src/index.test.ts packages/cli/src/defaultBackend.test.ts
rtk npm --workspace @auto-demo/cli run typecheck
```

Expected: PASS with existing capture, plan, validate, review, refine, approve, and agent run routes unchanged.

- [ ] **Step 7: Commit the CLI contract**

```bash
git add packages/cli/src/agentExecuteCommand.ts packages/cli/src/agentExecuteCommand.test.ts packages/cli/src/index.ts packages/cli/src/index.test.ts packages/cli/package.json
git commit -m "feat(cli): execute approved walkthrough plans"
```

## Task 6: Prove Real Recorded Execution and Failure Preservation

**Files:**

- Create: `packages/cli/src/agentExecuteCommand.smoke.test.ts`
- Modify: `packages/cli/package.json:18`

- [ ] **Step 1: Write the real Playwright success smoke test**

Start a local HTTP server serving a deterministic page with a `Get started` button, labeled `Search` input, and initially hidden `Results` heading. Build a best-guess plan, add durable target hints and wait duration, approve it with explicit bypass, and write plan plus inputs to temporary files.

Invoke the real command path and assert only observable artifacts:

```ts
expect(result.exitCode).toBe(0);
const output = JSON.parse(result.stdout);
expect(output).toMatchObject({
  ok: true,
  plan: { state: "executed", execution: { status: "completed", pacingProfile: "natural-v1" } },
});
expect((await stat(output.capture.media.path)).size).toBeGreaterThan(0);
expect(await validateCaptureBundle(output.capture.manifestPath)).toMatchObject({ ok: true });
const metadata = await readFile(output.capture.metadata.path, "utf8");
expect(metadata).not.toContain("launch demo private");
```

- [ ] **Step 2: Write the real mid-script failure smoke test**

Use a plan whose first click succeeds and whose second approved target is absent. Assert exit 1, top-level state remains approved, first step completed, second failed with `target_not_found`, later steps skipped, manifest status failed, partial video/events exist, and neither the bound value nor raw DOM appears in output or metadata.

- [ ] **Step 3: Run smoke tests and verify the initial failures**

Run:

```bash
rtk npx vitest run packages/cli/src/agentExecuteCommand.smoke.test.ts
```

Expected on the first run: FAIL on whichever real integration edge is not yet wired, without modifying the tests to assert implementation details.

- [ ] **Step 4: Complete the capture-result adapter used by the real path**

Make the CLI adapter preserve the capture package's public paths and timing without leaking package-specific error objects:

```ts
function adaptCaptureStartResult(
  started: ControllableCaptureStartResult,
): WalkthroughExecutionCaptureStartResult {
  if (!started.ok) {
    return {
      ok: false,
      code: "capture_setup_failed",
      outputDir: started.outputDir,
      manifestPath: started.manifestPath,
    };
  }
  return {
    ok: true,
    session: {
      browser: started.session.browser,
      outputDir: started.session.outputDir,
      manifestPath: started.session.manifestPath,
      async stop(reason) {
        const stopped = await started.session.stop(reason);
        if (!stopped.ok) {
          return {
            ok: false,
            code: "capture_stop_failed",
            outputDir: stopped.outputDir,
            manifestPath: stopped.manifestPath,
          };
        }
        return {
          ok: true,
          output: {
            outputDir: stopped.output.outputDir,
            manifestPath: stopped.output.manifestPath,
            mediaPath: stopped.output.media.path,
            metadataPath: stopped.output.metadata.path,
            ...stopped.output.timing,
          },
        };
      },
    },
  };
}
```

If the smoke test still fails, change only the owning package behavior proven by the failing assertion. Do not weaken assertions or add retries, selector fallbacks, project import, or pacing configuration.

- [ ] **Step 5: Add the smoke file to the CLI package test script and rerun**

Run:

```bash
rtk npx vitest run packages/cli/src/agentExecuteCommand.smoke.test.ts
rtk npm --workspace @auto-demo/cli test
```

Expected: both smoke paths and all CLI tests PASS.

- [ ] **Step 6: Commit real-browser execution coverage**

```bash
git add packages/cli/src/agentExecuteCommand.smoke.test.ts packages/cli/package.json packages/agent/src/walkthroughExecution.ts packages/capture/src/index.ts packages/capture/src/playwrightDriver.ts packages/capture/src/playwrightExecutionController.ts packages/capture/src/playwrightAdapter.ts packages/cli/src/agentExecuteCommand.ts packages/cli/src/index.ts
git commit -m "test: cover recorded walkthrough execution"
```

Before committing, inspect `git diff --name-only` and remove any unrelated path from the staging command.

## Task 7: Publish the Operator and Agent-Host Contract

**Files:**

- Create: `packages/agent/fixtures/codex-walkthrough-execution.md`
- Modify: `README.md`
- Modify: `packages/agent/README.md`
- Modify: `packages/agent/skills/codex-auto-demo/SKILL.md`
- Modify: `packages/agent/claude-wrapper-parity.md`
- Modify: `packages/agent/src/wrapper-docs.test.ts`
- Modify: `packages/cli/README.md`
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Write failing documentation contract tests**

Add assertions for the exact execute command, approval invariant, optional input file, non-secret demo-data warning, natural pacing, failed-bundle preservation, and WES-180 boundary:

```ts
for (const required of [
  "autodemo agent execute --plan <approved-plan-json-file>",
  "--inputs <runtime-inputs-json-file>",
  "--out <capture-directory>",
  "natural-v1",
  "non-secret demo data",
  "failed capture bundle",
  "WES-180",
]) {
  expect(combinedDocs).toContain(required);
}
expect(combinedDocs).not.toContain("execute --allow-unapproved");
```

Parse the JSON blocks in the new fixture and assert successful output is executed while failed output remains approved.

- [ ] **Step 2: Run wrapper documentation tests and verify the red state**

Run:

```bash
rtk npx vitest run packages/agent/src/wrapper-docs.test.ts packages/cli/src/packaging-docs.test.ts
```

Expected: FAIL because the execution contract is not documented.

- [ ] **Step 3: Update operator docs and agent-host guidance**

Document this sequence consistently:

```bash
npm run autodemo -- agent approve --plan reviewed-plan.json --json > approved-plan.json
npm run autodemo -- agent execute \
  --plan approved-plan.json \
  --inputs demo-inputs.json \
  --out captures/approved-demo \
  --json > execution-result.json
```

State explicitly that:

- execute always verifies approval and has no unapproved shortcut;
- input values may appear in recorded pixels and therefore must be non-secret demo data;
- values do not appear in plan artifacts, metadata, diagnostics, or JSON output;
- strict target matching and fail-fast behavior prevent misleading footage;
- WES-179 returns a capture bundle and WES-180 creates the project/variant handoff.

Correct the root README paragraph that still says validation and approval are downstream work.

- [ ] **Step 4: Add the reviewable host transcript fixture**

Include parseable approved-plan input, runtime-bindings input, successful execution output, and a separate sanitized mid-script failure. Use synthetic values and relative paths only. The transcript must tell Codex/Claude not to print or paste binding values into conversation logs.

- [ ] **Step 5: Update the project map implementation note**

Add the WES-179 plan link under Local Context and an implementation note naming the command, controllable capture session, execution core, strict resolution, runtime bindings, pacing profile, tests, and WES-180 boundary. Do not mark WES-179 Done yet.

- [ ] **Step 6: Run documentation tests and formatting**

Run:

```bash
rtk npx vitest run packages/agent/src/wrapper-docs.test.ts packages/cli/src/packaging-docs.test.ts
rtk npx prettier --check README.md packages/agent/README.md packages/agent/skills/codex-auto-demo/SKILL.md packages/agent/claude-wrapper-parity.md packages/agent/fixtures/codex-walkthrough-execution.md packages/cli/README.md docs/linear/auto-demo-project-structure.md
```

Expected: PASS.

- [ ] **Step 7: Commit documentation and project-map evidence**

```bash
git add README.md packages/agent/README.md packages/agent/skills/codex-auto-demo/SKILL.md packages/agent/claude-wrapper-parity.md packages/agent/fixtures/codex-walkthrough-execution.md packages/agent/src/wrapper-docs.test.ts packages/cli/README.md docs/linear/auto-demo-project-structure.md
git commit -m "docs: publish approved walkthrough execution workflow"
```

## Task 8: Verify WES-179 and Run the Linear Completion Gate

**Files:**

- Modify if evidence requires it: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Run all focused package tests**

```bash
rtk npm --workspace @auto-demo/agent test
rtk npm --workspace @auto-demo/capture test
rtk npm --workspace @auto-demo/cli test
```

Expected: all agent, capture, CLI, and real execution smoke tests PASS.

- [ ] **Step 2: Run focused typechecks and build**

```bash
rtk npm --workspace @auto-demo/agent run typecheck
rtk npm --workspace @auto-demo/capture run typecheck
rtk npm --workspace @auto-demo/cli run typecheck
rtk npm run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Run repository validation**

```bash
rtk npm run validate
```

Expected: build, all workspace typechecks, ESLint, every test, and repository formatting PASS. If validation fails only on an unrelated pre-existing untracked file, preserve the exact failure, run scoped Prettier on WES-179 files, and report the unrelated blocker without claiming root validation passed.

- [ ] **Step 4: Run final hygiene checks**

```bash
rtk git diff --check
rtk git status --short
rtk git log -8 --oneline
```

Expected: no whitespace errors; only intended WES-179 changes plus preserved unrelated user files; task commits are present.

- [ ] **Step 5: Request code review**

Invoke `superpowers:requesting-code-review`. Resolve Critical and Important findings with focused red/green tests, then rerun the affected package tests and repository validation.

- [ ] **Step 6: Run `linear-sync-gate` in completion-gate mode**

Provide WES-179, the implementation summary, changed files, test commands/results, commit hashes, and capture-bundle smoke evidence. Reconcile WES-176, WES-180, and the project map.

Clear completion writes should:

- add concise non-secret completion evidence to WES-179;
- move WES-179 to Done only if acceptance criteria and verification passed;
- add a readiness note to WES-180 that the executed capture bundle and immutable execution result are available;
- keep WES-176 open until WES-180 is complete;
- update the project-map next pointer to WES-180.

- [ ] **Step 7: Commit any completion-gate project-map update**

```bash
git add docs/linear/auto-demo-project-structure.md
git commit -m "docs: sync WES-179 completion evidence"
```

Skip this commit if the completion gate requires no local edit. Do not push or open a PR unless the user explicitly requests it.
