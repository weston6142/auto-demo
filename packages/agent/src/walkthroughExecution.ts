import type {
  WalkthroughPlan,
  WalkthroughPlanExecutionStepOutcome,
  WalkthroughPlanStep,
} from "./index.js";
import {
  isUnsafeWalkthroughAction,
  isWalkthroughPlan,
  sanitizeWalkthroughPlanArtifact,
  sanitizeWalkthroughText,
} from "./walkthroughValidation.js";
import { verifyWalkthroughPlanApproval } from "./walkthroughApproval.js";

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

export type WalkthroughExecutionCaptureSession = {
  browser: WalkthroughExecutionBrowser;
  outputDir: string;
  manifestPath: string;
  stop(
    reason: "completed" | "failed" | "interrupted",
  ): Promise<WalkthroughExecutionCaptureStopResult>;
};

export type WalkthroughExecutionCaptureStartResult =
  | { ok: true; session: WalkthroughExecutionCaptureSession }
  | {
      ok: false;
      code: "capture_setup_failed";
      outputDir: string;
      manifestPath: string;
    };

export type WalkthroughExecutionInput = {
  plan: WalkthroughPlan;
  outputDir: string;
  viewport: { width: number; height: number };
  inputBindings?: Record<string, unknown>;
};

export type WalkthroughExecutionDependencies = {
  now: () => Date;
  sleep: (durationMs: number) => Promise<void>;
  interrupted: Promise<void>;
  outputDirectoryState(path: string): Promise<"missing" | "empty" | "non-empty">;
  startCapture(options: {
    sourceUrl: string;
    outputDir: string;
    viewport: { width: number; height: number };
  }): Promise<WalkthroughExecutionCaptureStartResult>;
};

type WalkthroughExecutionSuccess = {
  ok: true;
  phase: "completed";
  plan: WalkthroughPlan;
  steps: WalkthroughPlanExecutionStepOutcome[];
  capture: WalkthroughExecutionCaptureOutput;
};

type WalkthroughExecutionFailureResult = {
  ok: false;
  phase: "preflight" | "capture-setup" | "execution" | "capture-finalize";
  plan?: WalkthroughPlan;
  steps: WalkthroughPlanExecutionStepOutcome[];
  capture?: Partial<WalkthroughExecutionCaptureOutput> & {
    outputDir: string;
    manifestPath: string;
  };
  errors: WalkthroughExecutionError[];
  interrupted?: true;
};

export type WalkthroughExecutionResult =
  WalkthroughExecutionSuccess | WalkthroughExecutionFailureResult;

type PreparedExecution = {
  plan: WalkthroughPlan;
  bindings: Record<string, string>;
  outputDir: string;
  viewport: { width: number; height: number };
};

class ExecutionInterrupted extends Error {}

export async function executeWalkthroughPlan(
  input: WalkthroughExecutionInput,
  dependencies: WalkthroughExecutionDependencies,
): Promise<WalkthroughExecutionResult> {
  const preflight = await prepareExecution(input, dependencies);
  if (!preflight.ok) return preflight.result;

  let started: WalkthroughExecutionCaptureStartResult;
  try {
    started = await dependencies.startCapture({
      sourceUrl: preflight.prepared.plan.target.url,
      outputDir: preflight.prepared.outputDir,
      viewport: preflight.prepared.viewport,
    });
  } catch {
    return {
      ok: false,
      phase: "capture-setup",
      plan: preflight.prepared.plan,
      steps: [],
      errors: [{ code: "capture_setup_failed", message: "Browser capture setup failed." }],
    };
  }
  if (!started.ok) {
    return {
      ok: false,
      phase: "capture-setup",
      plan: preflight.prepared.plan,
      steps: [],
      capture: {
        outputDir: started.outputDir,
        manifestPath: started.manifestPath,
      },
      errors: [{ code: "capture_setup_failed", message: "Browser capture setup failed." }],
    };
  }

  return await runPreparedExecution(preflight.prepared, started.session, dependencies);
}

async function prepareExecution(
  input: WalkthroughExecutionInput,
  dependencies: WalkthroughExecutionDependencies,
): Promise<
  | { ok: true; prepared: PreparedExecution }
  | { ok: false; result: WalkthroughExecutionFailureResult }
> {
  if (!isWalkthroughPlan(input.plan)) {
    return preflightFailure("invalid_execution_plan", "Execution requires a valid plan.");
  }
  if (input.plan.state !== "approved" || !input.plan.approvals.approved) {
    return preflightFailure("unapproved_plan", "Execution requires an approved plan.");
  }
  const approval = verifyWalkthroughPlanApproval(input.plan);
  if (!approval.ok) {
    const stale = approval.errors.some((error) => error.code === "stale_approval");
    return preflightFailure(
      stale ? "stale_approval" : "invalid_execution_plan",
      stale
        ? "Walkthrough approval does not match the current execution content."
        : "Execution requires valid approval evidence.",
    );
  }
  if ((await dependencies.outputDirectoryState(input.outputDir)) === "non-empty") {
    return preflightFailure(
      "capture_output_collision",
      "Execution capture output directory must be missing or empty.",
    );
  }

  const errors: WalkthroughExecutionError[] = [];
  const bindings: Record<string, string> = {};
  const provided = input.inputBindings ?? {};
  const expectedBindings = new Set<string>();
  for (const step of input.plan.steps) {
    if (step.action === "question" || step.resolution !== "resolved") {
      errors.push(
        stepError("unsupported_execution_action", step, "Execution steps must be resolved."),
      );
      continue;
    }
    if (step.action !== "navigate" && isUnsafeWalkthroughAction(step)) {
      errors.push(
        stepError("prohibited_input_target", step, "Execution step is not browser-safe."),
      );
      continue;
    }
    if (step.action === "navigate") {
      if (step.navigationUrl === undefined) {
        errors.push(stepError("missing_execution_data", step, "Navigation step requires a URL."));
      } else if (!isSafeExecutionUrl(step.navigationUrl)) {
        errors.push(stepError("invalid_navigation_url", step, "Navigation URL is not safe."));
      }
    }
    if (step.action === "wait" && step.waitDurationMs === undefined) {
      errors.push(stepError("missing_execution_data", step, "Wait step requires a duration."));
    }
    if (step.action === "type") {
      if (step.inputBinding === undefined) {
        errors.push(
          stepError("missing_execution_data", step, "Type step requires an input binding."),
        );
        continue;
      }
      if (expectedBindings.has(step.inputBinding)) {
        errors.push({
          ...stepError(
            "invalid_input_binding",
            step,
            "Each type step requires a unique runtime input binding.",
          ),
          bindingKey: sanitizeWalkthroughText(step.inputBinding),
        });
        continue;
      }
      expectedBindings.add(step.inputBinding);
      const value = provided[step.inputBinding];
      if (value === undefined) {
        errors.push({
          ...stepError("missing_input_binding", step, "Runtime input binding is missing."),
          bindingKey: step.inputBinding,
        });
      } else if (typeof value !== "string") {
        errors.push({
          ...stepError("invalid_input_binding", step, "Runtime input binding must be a string."),
          bindingKey: step.inputBinding,
        });
      } else {
        bindings[step.inputBinding] = value;
      }
    }
  }
  for (const key of Object.keys(provided)) {
    if (!expectedBindings.has(key)) {
      errors.push({
        code: "unexpected_input_binding",
        message: "Runtime input binding is not used by the approved plan.",
        bindingKey: sanitizeWalkthroughText(key),
      });
    }
  }
  if (errors.length > 0) {
    return { ok: false, result: { ok: false, phase: "preflight", steps: [], errors } };
  }

  return {
    ok: true,
    prepared: {
      plan: approvedExecutionPlan(input.plan),
      bindings,
      outputDir: input.outputDir,
      viewport: input.viewport,
    },
  };
}

function approvedExecutionPlan(plan: WalkthroughPlan): WalkthroughPlan {
  const sanitized = sanitizeWalkthroughPlanArtifact(plan);
  return {
    ...sanitized,
    state: "approved",
    approvals: { ...plan.approvals },
  };
}

async function runPreparedExecution(
  prepared: PreparedExecution,
  session: WalkthroughExecutionCaptureSession,
  dependencies: WalkthroughExecutionDependencies,
): Promise<WalkthroughExecutionResult> {
  const startedAt = dependencies.now();
  const outcomes: WalkthroughPlanExecutionStepOutcome[] = [];
  try {
    await withInterruption(
      dependencies.sleep(NATURAL_EXECUTION_PACING.preRollMs),
      dependencies.interrupted,
    );
  } catch (error) {
    if (error instanceof ExecutionInterrupted) {
      return await interruptedExecution(
        prepared.plan,
        outcomes,
        startedAt,
        dependencies.now(),
        session,
      );
    }
    return await unexpectedExecutionFailure(
      prepared.plan,
      outcomes,
      startedAt,
      dependencies.now(),
      session,
    );
  }

  for (const step of prepared.plan.steps) {
    const stepStartedAt = dependencies.now();
    try {
      if (!isInitialTargetNavigation(step, prepared.plan)) {
        await withInterruption(
          performStep(step, prepared, session.browser, dependencies.sleep),
          dependencies.interrupted,
        );
      }
      const endedAt = dependencies.now();
      outcomes.push({
        stepId: step.id,
        action: step.action,
        status: "completed",
        startedAt: stepStartedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationMs: endedAt.getTime() - stepStartedAt.getTime(),
      });
    } catch (error) {
      if (error instanceof ExecutionInterrupted) {
        outcomes.push({
          stepId: step.id,
          action: step.action,
          status: "failed",
          errorCode: "execution_interrupted",
        });
        return await interruptedExecution(
          prepared.plan,
          outcomes,
          startedAt,
          dependencies.now(),
          session,
        );
      }
      const code = browserErrorCode(error, step);
      const endedAt = dependencies.now();
      outcomes.push({
        stepId: step.id,
        action: step.action,
        status: "failed",
        startedAt: stepStartedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationMs: endedAt.getTime() - stepStartedAt.getTime(),
        errorCode: code,
      });
      for (const skipped of prepared.plan.steps.slice(outcomes.length)) {
        outcomes.push({
          stepId: skipped.id,
          action: skipped.action,
          status: "skipped",
          errorCode: code,
        });
      }
      const stopped = await safeStop(session, "failed");
      return failedExecution(prepared.plan, outcomes, startedAt, endedAt, session, stopped, {
        code,
        message: "Walkthrough execution step failed.",
        stepId: step.id,
      });
    }
  }

  try {
    await withInterruption(
      dependencies.sleep(NATURAL_EXECUTION_PACING.finalHoldMs),
      dependencies.interrupted,
    );
  } catch (error) {
    if (error instanceof ExecutionInterrupted) {
      return await interruptedExecution(
        prepared.plan,
        outcomes,
        startedAt,
        dependencies.now(),
        session,
      );
    }
    return await unexpectedExecutionFailure(
      prepared.plan,
      outcomes,
      startedAt,
      dependencies.now(),
      session,
    );
  }
  const stopped = await safeStop(session, "completed");
  const endedAt = dependencies.now();
  if (!stopped.ok) {
    return {
      ok: false,
      phase: "capture-finalize",
      plan: executionPlan(prepared.plan, "failed", outcomes, startedAt, endedAt, session),
      steps: outcomes,
      capture: { outputDir: stopped.outputDir, manifestPath: stopped.manifestPath },
      errors: [{ code: "capture_stop_failed", message: "Browser capture stop failed." }],
    };
  }

  const executed = executionPlan(
    prepared.plan,
    "completed",
    outcomes,
    startedAt,
    endedAt,
    stopped.output,
  );
  executed.state = "executed";
  return { ok: true, phase: "completed", plan: executed, steps: outcomes, capture: stopped.output };
}

async function performStep(
  step: WalkthroughPlanStep,
  prepared: PreparedExecution,
  browser: WalkthroughExecutionBrowser,
  sleep: (durationMs: number) => Promise<void>,
): Promise<void> {
  if (step.action === "navigate") {
    await browser.navigate(step.navigationUrl as string);
    await browser.waitForSettled();
    await sleep(NATURAL_EXECUTION_PACING.navigationSettleMs);
    return;
  }
  if (step.action === "wait") {
    await sleep(step.waitDurationMs as number);
    return;
  }
  const target = executionTargetForStep(step);
  if (step.action === "click") {
    await sleep(NATURAL_EXECUTION_PACING.anticipationMs);
    await browser.click(target);
  } else if (step.action === "type") {
    await sleep(NATURAL_EXECUTION_PACING.anticipationMs);
    await browser.type(target, prepared.bindings[step.inputBinding as string], {
      delayMs: NATURAL_EXECUTION_PACING.typingDelayMs,
    });
  } else if (step.action === "assert") await browser.assertVisible(target);
  else throw Object.assign(new Error("unsupported"), { code: "unsupported_execution_action" });
  await browser.waitForSettled();
  await sleep(NATURAL_EXECUTION_PACING.actionSettleMs);
}

function executionTargetForStep(step: WalkthroughPlanStep): WalkthroughExecutionTarget {
  if (step.targetHint !== undefined) {
    return {
      label: step.targetHint.label,
      ...(step.targetHint.role === undefined ? {} : { role: step.targetHint.role }),
      ...(step.targetHint.occurrence === undefined
        ? {}
        : { occurrence: step.targetHint.occurrence }),
    };
  }
  const label = step.public.summary
    .replace(/^(Click|Verify|See|Assert|Check)\s+/i, "")
    .replace(/^(Type|Enter|Fill)\s+\[redacted\]\s+into\s+/i, "")
    .replace(/[.!?]$/, "")
    .trim();
  return { label };
}

function isInitialTargetNavigation(step: WalkthroughPlanStep, plan: WalkthroughPlan): boolean {
  return (
    step.order === 1 &&
    step.action === "navigate" &&
    step.navigationUrl !== undefined &&
    normalizedUrl(step.navigationUrl) === normalizedUrl(plan.target.url)
  );
}

function normalizedUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function isSafeExecutionUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return false;
    }
    for (const [key, parameterValue] of url.searchParams) {
      if (
        /(^|[-_.])(auth|authorization|token|api[-_]?key|secret|password|passcode|credential|signature|sig|code)($|[-_.])/i.test(
          key,
        ) ||
        parameterValue.length >= 24
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function browserErrorCode(
  error: unknown,
  step: WalkthroughPlanStep,
): WalkthroughExecutionErrorCode {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  if (
    code === "target_not_found" ||
    code === "ambiguous_target" ||
    code === "navigation_failed" ||
    code === "action_failed" ||
    code === "assertion_failed" ||
    code === "execution_timeout" ||
    code === "unsupported_execution_action"
  ) {
    return code;
  }
  if (step.action === "navigate") return "navigation_failed";
  if (step.action === "assert") return "assertion_failed";
  return "action_failed";
}

function executionPlan(
  plan: WalkthroughPlan,
  status: "completed" | "failed",
  outcomes: WalkthroughPlanExecutionStepOutcome[],
  startedAt: Date,
  endedAt: Date,
  capture: { outputDir: string; manifestPath: string; mediaPath?: string; metadataPath?: string },
): WalkthroughPlan {
  return {
    ...plan,
    execution: {
      status,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      pacingProfile: "natural-v1",
      steps: outcomes,
      capture: {
        outputDir: capture.outputDir,
        manifestPath: capture.manifestPath,
        ...(capture.mediaPath === undefined ? {} : { mediaPath: capture.mediaPath }),
        ...(capture.metadataPath === undefined ? {} : { metadataPath: capture.metadataPath }),
      },
    },
  };
}

function failedExecution(
  plan: WalkthroughPlan,
  outcomes: WalkthroughPlanExecutionStepOutcome[],
  startedAt: Date,
  endedAt: Date,
  session: WalkthroughExecutionCaptureSession,
  stopped: WalkthroughExecutionCaptureStopResult,
  error: WalkthroughExecutionError,
): WalkthroughExecutionFailureResult {
  const capture = stopped.ok
    ? stopped.output
    : { outputDir: stopped.outputDir, manifestPath: stopped.manifestPath };
  return {
    ok: false,
    phase: stopped.ok ? "execution" : "capture-finalize",
    plan: executionPlan(plan, "failed", outcomes, startedAt, endedAt, capture),
    steps: outcomes,
    capture,
    errors: stopped.ok
      ? [error]
      : [{ code: "capture_stop_failed", message: "Browser capture stop failed." }],
  };
}

async function interruptedExecution(
  plan: WalkthroughPlan,
  outcomes: WalkthroughPlanExecutionStepOutcome[],
  startedAt: Date,
  endedAt: Date,
  session: WalkthroughExecutionCaptureSession,
): Promise<WalkthroughExecutionFailureResult> {
  for (const skipped of plan.steps.slice(outcomes.length)) {
    outcomes.push({
      stepId: skipped.id,
      action: skipped.action,
      status: "skipped",
      errorCode: "execution_interrupted",
    });
  }
  const stopped = await safeStop(session, "interrupted");
  const capture = stopped.ok
    ? stopped.output
    : { outputDir: stopped.outputDir, manifestPath: stopped.manifestPath };
  return {
    ok: false,
    phase: stopped.ok ? "execution" : "capture-finalize",
    interrupted: true,
    plan: executionPlan(plan, "failed", outcomes, startedAt, endedAt, capture),
    steps: outcomes,
    capture,
    errors: stopped.ok
      ? [
          {
            code: "execution_interrupted",
            message: "Walkthrough execution was interrupted.",
          },
        ]
      : [{ code: "capture_stop_failed", message: "Browser capture stop failed." }],
  };
}

async function withInterruption<T>(operation: Promise<T>, interrupted: Promise<void>): Promise<T> {
  const completion = operation.then(
    (value) => ({ kind: "completed" as const, value }),
    (error: unknown) => ({ kind: "failed" as const, error }),
  );
  const outcome = await Promise.race([
    completion,
    interrupted.then(() => ({ kind: "interrupted" as const })),
  ]);
  if (outcome.kind === "interrupted") {
    await completion;
    throw new ExecutionInterrupted();
  }
  if (outcome.kind === "failed") throw outcome.error;
  return outcome.value;
}

async function unexpectedExecutionFailure(
  plan: WalkthroughPlan,
  outcomes: WalkthroughPlanExecutionStepOutcome[],
  startedAt: Date,
  endedAt: Date,
  session: WalkthroughExecutionCaptureSession,
): Promise<WalkthroughExecutionFailureResult> {
  for (const skipped of plan.steps.slice(outcomes.length)) {
    outcomes.push({
      stepId: skipped.id,
      action: skipped.action,
      status: "skipped",
      errorCode: "action_failed",
    });
  }
  const stopped = await safeStop(session, "failed");
  return failedExecution(plan, outcomes, startedAt, endedAt, session, stopped, {
    code: "action_failed",
    message: "Walkthrough execution failed.",
  });
}

async function safeStop(
  session: WalkthroughExecutionCaptureSession,
  reason: "completed" | "failed" | "interrupted",
): Promise<WalkthroughExecutionCaptureStopResult> {
  try {
    return await session.stop(reason);
  } catch {
    return {
      ok: false,
      code: "capture_stop_failed",
      outputDir: session.outputDir,
      manifestPath: session.manifestPath,
    };
  }
}

function preflightFailure(
  code: WalkthroughExecutionErrorCode,
  message: string,
): { ok: false; result: WalkthroughExecutionFailureResult } {
  return {
    ok: false,
    result: { ok: false, phase: "preflight", steps: [], errors: [{ code, message }] },
  };
}

function stepError(
  code: WalkthroughExecutionErrorCode,
  step: WalkthroughPlanStep,
  message: string,
): WalkthroughExecutionError {
  return { code, message, stepId: step.id };
}
