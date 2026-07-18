import type {
  WalkthroughPlan,
  WalkthroughPlanAssertion,
  WalkthroughPlanSource,
  WalkthroughPlanStep,
  WalkthroughPlanStepAction,
  WalkthroughPlanStepProvenance,
  WalkthroughPlanTargetHint,
} from "./index.js";
import {
  hasCredentialLikeUrlData,
  hasDestructiveActionLanguage,
  isSecretLikeValue,
} from "./actionSafety.js";

export type WalkthroughPlanValidationStatus = "ready" | "blocked";
export type WalkthroughPlanValidationCheckStatus = "passed" | "blocked" | "skipped";
export type WalkthroughPlanValidationReason =
  | "unresolved_plan_question"
  | "missing_element"
  | "multiple_matching_elements"
  | "unexpected_navigation"
  | "navigation_failed"
  | "auth_wall_detected"
  | "timing_failure"
  | "unsafe_dependent_step"
  | "unsafe_action"
  | "unsupported_step_action";

export type WalkthroughValidationMatch = {
  id: string;
  label: string;
  role?: string;
  actionRisk?: "potentially-mutating";
  targetHint?: WalkthroughPlanTargetHint;
};

export type WalkthroughValidationPageState = {
  url: string;
  title: string;
  authWall: boolean;
};

export type WalkthroughPlanValidationCheck = {
  id: string;
  stepId: string;
  action: WalkthroughPlanStepAction;
  status: WalkthroughPlanValidationCheckStatus;
  reason?: WalkthroughPlanValidationReason;
  summary: string;
};

export type WalkthroughPlanValidationBlocker = {
  id: string;
  stepId: string;
  reason: WalkthroughPlanValidationReason;
  question: string;
  candidates?: WalkthroughValidationMatch[];
};

type WalkthroughPlanValidationBase = {
  status: WalkthroughPlanValidationStatus;
  validatedAt: string;
  checks: WalkthroughPlanValidationCheck[];
  blockers: WalkthroughPlanValidationBlocker[];
};

export type WalkthroughPlanReplayValidation = WalkthroughPlanValidationBase & {
  mode: "discovery-replay";
  replay: {
    replayId: string;
    attempts: 1 | 2 | 3;
    sourceSessionId: string;
    selectedPathFingerprint: string;
  };
};

export type WalkthroughPlanValidation =
  (WalkthroughPlanValidationBase & { mode: "dry-run" }) | WalkthroughPlanReplayValidation;

export type ValidatedWalkthroughPlan = WalkthroughPlan & {
  validation: WalkthroughPlanValidation;
};

export type WalkthroughValidationErrorCode =
  | "invalid_plan"
  | "discovery_replay_required"
  | "unsafe_target_url"
  | "browser_setup_failed"
  | "navigation_failed";

export type WalkthroughValidationError = {
  code: WalkthroughValidationErrorCode;
  message: string;
};

export type WalkthroughValidationResult =
  | { ok: true; plan: ValidatedWalkthroughPlan }
  | { ok: false; errors: WalkthroughValidationError[] };

export type WalkthroughValidationOptions = {
  now?: () => Date;
};

export type WalkthroughValidationBrowserRunner = {
  open(url: string): Promise<void>;
  navigate(url: string): Promise<void>;
  inspectPage(): Promise<WalkthroughValidationPageState>;
  findMatches(step: WalkthroughPlanStep): Promise<WalkthroughValidationMatch[]>;
  click(match: WalkthroughValidationMatch): Promise<void>;
  type(match: WalkthroughValidationMatch, options: { redactedValue: true }): Promise<void>;
  waitForIdle(): Promise<void>;
  close(): Promise<void>;
};

export type WalkthroughValidationDependencies = {
  browser: WalkthroughValidationBrowserRunner;
};

export class WalkthroughValidationRunnerError extends Error {
  constructor(readonly code: "navigation_failed" | "unsafe_action") {
    super(code);
    this.name = "WalkthroughValidationRunnerError";
  }
}

export function isWalkthroughPlan(value: unknown): value is WalkthroughPlan {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<WalkthroughPlan>;
  return (
    isSafeIdentifier(candidate.id) &&
    candidate.target?.kind === "browser" &&
    isSafeHttpUrl(candidate.target.url) &&
    (candidate.mode === "validate-first" || candidate.mode === "best-guess") &&
    (candidate.state === "draft" ||
      candidate.state === "needs-clarification" ||
      candidate.state === "validated" ||
      candidate.state === "approved" ||
      candidate.state === "executed") &&
    isWalkthroughPlanSource(candidate.source) &&
    Array.isArray(candidate.steps) &&
    candidate.steps.length > 0 &&
    candidate.steps.every(
      (step, index) => isWalkthroughPlanStep(step) && step.order === index + 1,
    ) &&
    Array.isArray(candidate.questions) &&
    candidate.questions.every(isWalkthroughPlanQuestion) &&
    isWalkthroughPlanApproval(candidate.approvals, candidate.state) &&
    isWalkthroughPlanExecution(candidate.execution, candidate.state, candidate.steps) &&
    Array.isArray(candidate.warnings) &&
    candidate.warnings.every(isPlanWarning) &&
    (candidate.validation === undefined || isWalkthroughPlanValidation(candidate.validation)) &&
    hasConsistentPlanRelationships(candidate as WalkthroughPlan)
  );
}

export async function validateWalkthroughPlan(
  plan: WalkthroughPlan,
  options: WalkthroughValidationOptions = {},
  dependencies: WalkthroughValidationDependencies,
): Promise<WalkthroughValidationResult> {
  if (!isWalkthroughPlan(plan)) {
    return failure("invalid_plan", "Walkthrough validation requires a valid walkthrough plan.");
  }

  if (plan.source.parser === "discovery-v1") {
    return failure(
      "discovery_replay_required",
      "Discovery plans require fresh-context replay validation before approval.",
    );
  }

  if (hasCredentialLikeUrlData(plan.target.url)) {
    return failure(
      "unsafe_target_url",
      "Walkthrough validation target URL contains credential-like data.",
    );
  }

  try {
    await dependencies.browser.open(plan.target.url);
  } catch (error) {
    await dependencies.browser.close().catch(() => undefined);
    if (error instanceof WalkthroughValidationRunnerError && error.code === "navigation_failed") {
      return failure(
        "navigation_failed",
        "Walkthrough validation could not navigate to the target page.",
      );
    }
    return failure("browser_setup_failed", "Walkthrough validation browser setup failed.");
  }

  const checks: WalkthroughPlanValidationCheck[] = [];
  const blockers: WalkthroughPlanValidationBlocker[] = [];
  let unsafeAfterStateChangeBlocker = false;

  try {
    for (const step of plan.steps) {
      const blockerId = `blocker-${step.order}`;

      if (step.action === "question" || step.resolution === "unresolved") {
        const question =
          plan.questions.find((candidate) => candidate.stepId === step.id)?.prompt ??
          step.public.summary;
        blockers.push({
          id: blockerId,
          stepId: step.id,
          reason: "unresolved_plan_question",
          question: sanitizeText(question),
        });
        checks.push(blockedCheck(step, "unresolved_plan_question", sanitizeText(question)));
        unsafeAfterStateChangeBlocker = true;
        continue;
      }

      if (unsafeAfterStateChangeBlocker && isStateChanging(step)) {
        checks.push({
          id: `check-${step.order}`,
          stepId: step.id,
          action: step.action,
          status: "skipped",
          reason: "unsafe_dependent_step",
          summary: `Skipped because an earlier state-changing step is blocked: ${safeSummary(step)}.`,
        });
        continue;
      }

      const outcome = await validateStep(step, dependencies.browser);
      if (outcome.ok) {
        checks.push({
          id: `check-${step.order}`,
          stepId: step.id,
          action: step.action,
          status: "passed",
          summary: `Validated: ${safeSummary(step)}.`,
        });
        continue;
      }

      blockers.push({
        id: blockerId,
        stepId: step.id,
        reason: outcome.reason,
        question: outcome.question,
        ...(outcome.candidates === undefined ? {} : { candidates: outcome.candidates }),
      });
      checks.push(blockedCheck(step, outcome.reason, outcome.question));
      if (isStateChanging(step)) {
        unsafeAfterStateChangeBlocker = true;
      }
    }
  } finally {
    await dependencies.browser.close().catch(() => undefined);
  }

  const now = options.now ?? (() => new Date());
  const validation: WalkthroughPlanValidation = {
    status: blockers.length === 0 ? "ready" : "blocked",
    validatedAt: now().toISOString(),
    mode: "dry-run",
    checks,
    blockers,
  };
  return {
    ok: true,
    plan: {
      ...sanitizePlan(plan),
      state: validation.status === "ready" ? "validated" : "needs-clarification",
      validation,
    },
  };
}

type StepOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: WalkthroughPlanValidationReason;
      question: string;
      candidates?: WalkthroughValidationMatch[];
    };

async function validateStep(
  step: WalkthroughPlanStep,
  browser: WalkthroughValidationBrowserRunner,
): Promise<StepOutcome> {
  try {
    const before = await browser.inspectPage();
    if (before.authWall) {
      return {
        ok: false,
        reason: "auth_wall_detected",
        question: `How should validation authenticate before: ${safeSummary(step)}?`,
      };
    }

    if (step.action === "navigate") {
      const destination = navigationUrlForStep(step);
      if (destination === undefined) {
        const unsafeDestination = hasExplicitNavigationScheme(step.sourceText);
        return {
          ok: false,
          reason: unsafeDestination ? "unsafe_action" : "unsupported_step_action",
          question: unsafeDestination
            ? `How should validation navigate without an unsafe URL: ${safeSummary(step)}?`
            : `What URL should validation navigate to for: ${safeSummary(step)}?`,
        };
      }
      if (hasCredentialLikeUrlData(destination)) {
        return {
          ok: false,
          reason: "unsafe_action",
          question: `How should validation navigate without credential-like URL data: ${safeSummary(step)}?`,
        };
      }
      await browser.navigate(destination);
      await browser.waitForIdle();
      const after = await browser.inspectPage();
      if (after.authWall) {
        return {
          ok: false,
          reason: "auth_wall_detected",
          question: `How should validation authenticate before: ${safeSummary(step)}?`,
        };
      }
      if (normalizedLocation(destination) !== normalizedLocation(after.url)) {
        return {
          ok: false,
          reason: "unexpected_navigation",
          question: `Why did ${safeSummary(step)} reach ${sanitizeUrl(after.url)}?`,
        };
      }
      return { ok: true };
    }

    if (step.action === "assert" && step.assertion?.kind === "navigation") {
      return matchesWalkthroughNavigationAssertion(step.assertion, before.url)
        ? { ok: true }
        : {
            ok: false,
            reason: "unexpected_navigation",
            question: `Why did ${safeSummary(step)} reach an unexpected destination?`,
          };
    }

    if (isUnsafeWalkthroughAction(step)) {
      return {
        ok: false,
        reason: "unsafe_action",
        question: `How should this potentially destructive action be validated safely: ${safeSummary(step)}?`,
      };
    }

    if (step.action === "wait") {
      await browser.waitForIdle();
      const after = await browser.inspectPage();
      if (after.authWall) {
        return {
          ok: false,
          reason: "auth_wall_detected",
          question: `How should validation authenticate before: ${safeSummary(step)}?`,
        };
      }
      return { ok: true };
    }

    const matches = await browser.findMatches(step);
    if (matches.length === 0) {
      return {
        ok: false,
        reason: "missing_element",
        question: `What visible page element should satisfy: ${safeSummary(step)}?`,
      };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        reason: "multiple_matching_elements",
        question: `Which '${safeSummary(step)}' target should be used?`,
        candidates: matches.map(sanitizeMatch),
      };
    }

    if (matches[0].actionRisk === "potentially-mutating") {
      return {
        ok: false,
        reason: "unsafe_action",
        question: `How should this potentially destructive action be validated safely: ${safeSummary(step)}?`,
      };
    }

    await performStep(step, matches[0], browser);
    const after = await browser.inspectPage();
    if (after.authWall) {
      return {
        ok: false,
        reason: "auth_wall_detected",
        question: `How should validation authenticate after: ${safeSummary(step)}?`,
      };
    }
    if (isUnexpectedNavigation(before.url, after.url)) {
      return {
        ok: false,
        reason: "unexpected_navigation",
        question: `Should validation continue after ${safeSummary(step)} navigates to ${sanitizeUrl(after.url)}?`,
      };
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof WalkthroughValidationRunnerError && error.code === "unsafe_action") {
      return {
        ok: false,
        reason: "unsafe_action",
        question: `How should this potentially destructive action be validated safely: ${safeSummary(step)}?`,
      };
    }
    return {
      ok: false,
      reason: step.action === "navigate" ? "navigation_failed" : "timing_failure",
      question: `How should validation recover from: ${safeSummary(step)}?`,
    };
  }
}

function matchesWalkthroughNavigationAssertion(
  assertion: Extract<NonNullable<WalkthroughPlanStep["assertion"]>, { kind: "navigation" }>,
  actualValue: string,
): boolean {
  try {
    const expected = new URL(sanitizeUrl(assertion.url));
    const actual = new URL(sanitizeUrl(actualValue));
    if (assertion.match === "exact-url") return expected.href === actual.href;
    return (
      expected.protocol === actual.protocol &&
      expected.hostname === actual.hostname &&
      expected.port === actual.port &&
      expected.pathname === actual.pathname
    );
  } catch {
    return false;
  }
}

async function performStep(
  step: WalkthroughPlanStep,
  match: WalkthroughValidationMatch,
  browser: WalkthroughValidationBrowserRunner,
): Promise<void> {
  if (step.action === "click") {
    await browser.click(match);
    await browser.waitForIdle();
    return;
  }
  if (step.action === "type") {
    await browser.type(match, { redactedValue: true });
    await browser.waitForIdle();
    return;
  }
  if (step.action === "assert") {
    return;
  }
  throw new Error("Unsupported walkthrough validation action.");
}

function failure(
  code: WalkthroughValidationErrorCode,
  message: string,
): WalkthroughValidationResult {
  return { ok: false, errors: [{ code, message }] };
}

function isWalkthroughPlanStep(value: unknown): value is WalkthroughPlanStep {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const step = value as Partial<WalkthroughPlanStep>;
  const executionDataValid =
    (step.navigationUrl === undefined ||
      (step.action === "navigate" && isSafeHttpUrl(step.navigationUrl))) &&
    (step.inputBinding === undefined ||
      (step.action === "type" && isSafeIdentifier(step.inputBinding))) &&
    (step.waitDurationMs === undefined ||
      (step.action === "wait" &&
        typeof step.waitDurationMs === "number" &&
        Number.isInteger(step.waitDurationMs) &&
        step.waitDurationMs > 0 &&
        step.waitDurationMs <= 60_000));
  const assertionValid =
    step.assertion === undefined || isWalkthroughPlanAssertion(step.assertion, step);
  return (
    isSafeIdentifier(step.id) &&
    typeof step.order === "number" &&
    Number.isInteger(step.order) &&
    step.order > 0 &&
    isStepAction(step.action) &&
    (step.resolution === "resolved" || step.resolution === "unresolved") &&
    isNonEmptyString(step.sourceText) &&
    isNonEmptyString(step.public?.summary) &&
    (step.action !== "type" ||
      (isRedactedTypeDescription(step.sourceText) &&
        isRedactedTypeDescription(step.public.summary))) &&
    (step.questionId === undefined || isSafeIdentifier(step.questionId)) &&
    (step.targetHint === undefined || isWalkthroughPlanTargetHint(step.targetHint)) &&
    assertionValid &&
    (step.provenance === undefined || isWalkthroughPlanStepProvenance(step.provenance)) &&
    executionDataValid
  );
}

function isWalkthroughPlanSource(value: unknown): value is WalkthroughPlan["source"] {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const source = value as Partial<WalkthroughPlanSource> & {
    discovery?: Record<string, unknown>;
  };
  if (!isNonEmptyString(source.script)) return false;
  if (source.parser === "deterministic-v1") {
    return hasExactKeys(value, ["parser", "script"]);
  }
  return (
    source.parser === "discovery-v1" &&
    hasExactKeys(value, ["parser", "script", "discovery"]) &&
    hasExactKeys(source.discovery, ["schemaVersion", "sessionId", "selectedPathFingerprint"]) &&
    source.discovery?.schemaVersion === 1 &&
    isSafeIdentifier(source.discovery.sessionId) &&
    typeof source.discovery.selectedPathFingerprint === "string" &&
    /^sha256:[a-f0-9]{64}$/.test(source.discovery.selectedPathFingerprint)
  );
}

function isWalkthroughPlanAssertion(
  value: WalkthroughPlanAssertion,
  step: Partial<WalkthroughPlanStep>,
): boolean {
  if (step.action !== "assert") return false;
  if (value.kind === "navigation") {
    return (
      hasExactKeys(value, ["kind", "url", "match"]) &&
      step.targetHint === undefined &&
      isSafeHttpUrl(value.url) &&
      (value.match === "exact-url" || value.match === "same-origin-path")
    );
  }
  if (!hasExactKeys(value, ["kind", "condition", "role", "occurrence"])) return false;
  if (!isNonEmptyString(value.condition)) return false;
  if (value.role !== undefined && !isNonEmptyString(value.role)) return false;
  if (
    value.occurrence !== undefined &&
    (!Number.isInteger(value.occurrence) || value.occurrence <= 0)
  ) {
    return false;
  }
  if (step.targetHint === undefined) return false;
  return (
    step.targetHint.label === value.condition &&
    step.targetHint.role === value.role &&
    step.targetHint.occurrence === value.occurrence
  );
}

function isWalkthroughPlanStepProvenance(value: WalkthroughPlanStepProvenance): boolean {
  return (
    hasExactKeys(value, [
      "kind",
      "sessionId",
      "attemptId",
      "expectationId",
      "expectationOrigin",
      "normalizedFrom",
    ]) &&
    value.kind === "discovery" &&
    isSafeIdentifier(value.sessionId) &&
    isSafeIdentifier(value.attemptId) &&
    (value.expectationId === undefined || isSafeIdentifier(value.expectationId)) &&
    (value.expectationOrigin === undefined ||
      value.expectationOrigin === "declared-before-action" ||
      value.expectationOrigin === "derived-from-observation") &&
    (value.normalizedFrom === undefined ||
      value.normalizedFrom === "inspect" ||
      value.normalizedFrom === "back" ||
      value.normalizedFrom === "refresh")
  );
}

function isWalkthroughPlanQuestion(value: unknown): value is WalkthroughPlan["questions"][number] {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const question = value as Partial<WalkthroughPlan["questions"][number]>;
  return (
    isSafeIdentifier(question.id) &&
    isSafeIdentifier(question.stepId) &&
    isNonEmptyString(question.prompt) &&
    question.reason === "unrecognized_step"
  );
}

function isPlanWarning(value: unknown): value is WalkthroughPlan["warnings"][number] {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const warning = value as Partial<WalkthroughPlan["warnings"][number]>;
  return isSafeIdentifier(warning.code) && typeof warning.message === "string";
}

function isWalkthroughPlanTargetHint(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const hint = value as { kind?: unknown; label?: unknown; role?: unknown; occurrence?: unknown };
  return (
    hint.kind === "accessible" &&
    isNonEmptyString(hint.label) &&
    (hint.role === undefined || isNonEmptyString(hint.role)) &&
    (hint.occurrence === undefined ||
      (typeof hint.occurrence === "number" &&
        Number.isInteger(hint.occurrence) &&
        hint.occurrence > 0))
  );
}

function isWalkthroughPlanApproval(
  value: unknown,
  state: WalkthroughPlan["state"] | undefined,
): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const approval = value as Partial<WalkthroughPlan["approvals"]>;
  if (approval.required !== true || typeof approval.approved !== "boolean") {
    return false;
  }
  if (!approval.approved) {
    return (
      approval.approvedAt === undefined &&
      approval.planFingerprint === undefined &&
      approval.basis === undefined &&
      state !== "approved" &&
      state !== "executed"
    );
  }
  return (
    (state === "approved" || state === "executed") &&
    typeof approval.approvedAt === "string" &&
    !Number.isNaN(Date.parse(approval.approvedAt)) &&
    typeof approval.planFingerprint === "string" &&
    /^sha256:[a-f0-9]{64}$/.test(approval.planFingerprint) &&
    (approval.basis === "validated" || approval.basis === "best-guess-bypass")
  );
}

function isWalkthroughPlanExecution(
  value: unknown,
  state: WalkthroughPlan["state"] | undefined,
  steps: WalkthroughPlanStep[] | undefined,
): boolean {
  if (typeof value !== "object" || value === null) return false;
  const execution = value as Partial<WalkthroughPlan["execution"]> & {
    steps?: unknown;
    capture?: unknown;
  };
  if (execution.status === "not-started") return state !== "executed";
  if (execution.status !== "completed" && execution.status !== "failed") return false;
  if (execution.status === "completed" ? state !== "executed" : state !== "approved") return false;
  if (
    typeof execution.startedAt !== "string" ||
    Number.isNaN(Date.parse(execution.startedAt)) ||
    typeof execution.endedAt !== "string" ||
    Number.isNaN(Date.parse(execution.endedAt)) ||
    typeof execution.durationMs !== "number" ||
    !Number.isInteger(execution.durationMs) ||
    execution.durationMs < 0 ||
    execution.pacingProfile !== "natural-v1" ||
    !Array.isArray(execution.steps) ||
    !Array.isArray(steps) ||
    execution.steps.length !== steps.length ||
    typeof execution.capture !== "object" ||
    execution.capture === null
  ) {
    return false;
  }
  const capture = execution.capture as { outputDir?: unknown; manifestPath?: unknown };
  if (!isNonEmptyString(capture.outputDir) || !isNonEmptyString(capture.manifestPath)) return false;
  return execution.steps.every((outcome, index) => {
    if (typeof outcome !== "object" || outcome === null) return false;
    const candidate = outcome as {
      stepId?: unknown;
      action?: unknown;
      status?: unknown;
      errorCode?: unknown;
    };
    return (
      candidate.stepId === steps[index]?.id &&
      candidate.action === steps[index]?.action &&
      (candidate.status === "completed" ||
        candidate.status === "failed" ||
        candidate.status === "skipped") &&
      (candidate.errorCode === undefined || isSafeIdentifier(candidate.errorCode))
    );
  });
}

function isWalkthroughPlanValidation(value: unknown): value is WalkthroughPlanValidation {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const validation = value as Partial<WalkthroughPlanValidation>;
  const commonValid =
    (validation.status === "ready" || validation.status === "blocked") &&
    typeof validation.validatedAt === "string" &&
    !Number.isNaN(Date.parse(validation.validatedAt)) &&
    Array.isArray(validation.checks) &&
    validation.checks.every(isWalkthroughPlanValidationCheck) &&
    Array.isArray(validation.blockers) &&
    validation.blockers.every(isWalkthroughPlanValidationBlocker);
  if (!commonValid) return false;
  if (validation.mode === "dry-run") {
    return hasExactKeys(validation, ["status", "validatedAt", "mode", "checks", "blockers"]);
  }
  if (validation.mode !== "discovery-replay") return false;
  return (
    hasExactKeys(validation, ["status", "validatedAt", "mode", "checks", "blockers", "replay"]) &&
    isWalkthroughPlanReplaySummary(validation.replay)
  );
}

function isWalkthroughPlanReplaySummary(value: unknown): boolean {
  if (
    !hasExactKeys(value, ["replayId", "attempts", "sourceSessionId", "selectedPathFingerprint"])
  ) {
    return false;
  }
  const replay = value as Partial<WalkthroughPlanReplayValidation["replay"]>;
  return (
    isSafeIdentifier(replay.replayId) &&
    (replay.attempts === 1 || replay.attempts === 2 || replay.attempts === 3) &&
    isSafeIdentifier(replay.sourceSessionId) &&
    typeof replay.selectedPathFingerprint === "string" &&
    /^sha256:[a-f0-9]{64}$/.test(replay.selectedPathFingerprint)
  );
}

function isWalkthroughPlanValidationCheck(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const check = value as Partial<WalkthroughPlanValidationCheck>;
  return (
    isSafeIdentifier(check.id) &&
    isSafeIdentifier(check.stepId) &&
    isStepAction(check.action) &&
    (check.status === "passed" || check.status === "blocked" || check.status === "skipped") &&
    (check.reason === undefined || isWalkthroughPlanValidationReason(check.reason)) &&
    typeof check.summary === "string"
  );
}

function isWalkthroughPlanValidationBlocker(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const blocker = value as Partial<WalkthroughPlanValidationBlocker>;
  return (
    isSafeIdentifier(blocker.id) &&
    isSafeIdentifier(blocker.stepId) &&
    isWalkthroughPlanValidationReason(blocker.reason) &&
    isNonEmptyString(blocker.question) &&
    (blocker.candidates === undefined ||
      (Array.isArray(blocker.candidates) && blocker.candidates.every(isWalkthroughValidationMatch)))
  );
}

function isWalkthroughValidationMatch(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const match = value as Partial<WalkthroughValidationMatch>;
  return (
    isNonEmptyString(match.id) &&
    isNonEmptyString(match.label) &&
    (match.role === undefined || isNonEmptyString(match.role)) &&
    (match.actionRisk === undefined || match.actionRisk === "potentially-mutating") &&
    (match.targetHint === undefined || isWalkthroughPlanTargetHint(match.targetHint))
  );
}

function isWalkthroughPlanValidationReason(value: unknown): boolean {
  return (
    value === "unresolved_plan_question" ||
    value === "missing_element" ||
    value === "multiple_matching_elements" ||
    value === "unexpected_navigation" ||
    value === "navigation_failed" ||
    value === "auth_wall_detected" ||
    value === "timing_failure" ||
    value === "unsafe_dependent_step" ||
    value === "unsafe_action" ||
    value === "unsupported_step_action"
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_-]*$/i.test(value);
}

function hasExactKeys(value: unknown, allowed: readonly string[]): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function hasConsistentPlanRelationships(plan: WalkthroughPlan): boolean {
  if (plan.source.script.trim().length === 0) {
    return false;
  }

  if (plan.source.parser === "discovery-v1") {
    if (plan.mode !== "validate-first") return false;
    if (plan.validation !== undefined) {
      if (plan.validation.mode !== "discovery-replay") return false;
      if (
        plan.validation.replay.sourceSessionId !== plan.source.discovery.sessionId ||
        plan.validation.replay.selectedPathFingerprint !==
          plan.source.discovery.selectedPathFingerprint
      ) {
        return false;
      }
    }
  }

  const stepIds = new Set(plan.steps.map((step) => step.id));
  const questionIds = new Set(plan.questions.map((question) => question.id));
  if (stepIds.size !== plan.steps.length || questionIds.size !== plan.questions.length) {
    return false;
  }

  const unresolvedSteps = plan.steps.filter(
    (step) => step.action === "question" || step.resolution === "unresolved",
  );
  if (unresolvedSteps.length !== plan.questions.length) {
    return false;
  }

  for (const step of plan.steps) {
    const question = plan.questions.find((candidate) => candidate.stepId === step.id);
    if (step.action === "question" || step.resolution === "unresolved") {
      if (step.questionId === undefined || question?.id !== step.questionId) {
        return false;
      }
    } else if (step.questionId !== undefined || question !== undefined) {
      return false;
    }
  }

  if (plan.questions.length > 0 && plan.state !== "needs-clarification") {
    return false;
  }

  if (plan.validation !== undefined && !hasConsistentValidationEvidence(plan)) {
    return false;
  }

  if (plan.state === "approved" || plan.state === "executed") {
    const lifecycleMatches =
      plan.state === "executed"
        ? plan.execution.status === "completed"
        : plan.execution.status !== "completed";
    if (!lifecycleMatches) return false;
    if (plan.approvals.basis === "validated") {
      return plan.validation?.status === "ready";
    }
    return (
      plan.approvals.basis === "best-guess-bypass" &&
      plan.mode === "best-guess" &&
      plan.validation === undefined
    );
  }

  if (plan.validation?.status === "blocked") {
    return plan.state === "needs-clarification";
  }
  if (plan.validation?.status === "ready") {
    return plan.state === "validated";
  }
  if (plan.state === "validated") {
    return false;
  }
  if (plan.state === "needs-clarification") {
    return plan.questions.length > 0;
  }
  return true;
}

function hasConsistentValidationEvidence(plan: WalkthroughPlan): boolean {
  const validation = plan.validation;
  if (validation === undefined) return true;

  const stepById = new Map(plan.steps.map((step) => [step.id, step]));
  const checkIds = new Set(validation.checks.map((check) => check.id));
  const blockerIds = new Set(validation.blockers.map((blocker) => blocker.id));
  if (
    validation.checks.length !== plan.steps.length ||
    checkIds.size !== validation.checks.length ||
    blockerIds.size !== validation.blockers.length
  ) {
    return false;
  }

  for (const check of validation.checks) {
    const step = stepById.get(check.stepId);
    if (
      step === undefined ||
      step.action !== check.action ||
      (check.status === "passed" ? check.reason !== undefined : check.reason === undefined)
    ) {
      return false;
    }
    if (
      check.status === "blocked" &&
      !validation.blockers.some(
        (blocker) => blocker.stepId === check.stepId && blocker.reason === check.reason,
      )
    ) {
      return false;
    }
  }

  for (const step of plan.steps) {
    if (validation.checks.filter((check) => check.stepId === step.id).length !== 1) {
      return false;
    }
  }

  for (const blocker of validation.blockers) {
    if (
      !stepById.has(blocker.stepId) ||
      !validation.checks.some(
        (check) =>
          check.stepId === blocker.stepId &&
          check.status === "blocked" &&
          check.reason === blocker.reason,
      )
    ) {
      return false;
    }
  }

  return validation.status === "ready"
    ? validation.blockers.length === 0 &&
        validation.checks.every((check) => check.status === "passed")
    : validation.blockers.length > 0;
}

function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

function isStepAction(value: unknown): value is WalkthroughPlanStepAction {
  return (
    value === "navigate" ||
    value === "click" ||
    value === "type" ||
    value === "wait" ||
    value === "assert" ||
    value === "question"
  );
}

function isStateChanging(step: WalkthroughPlanStep): boolean {
  return step.action === "click" || step.action === "type" || step.action === "navigate";
}

export function isUnsafeWalkthroughAction(
  step: Pick<WalkthroughPlanStep, "action" | "sourceText" | "public" | "targetHint">,
): boolean {
  const description = [
    step.sourceText,
    step.public.summary,
    step.targetHint?.label,
    step.targetHint?.role,
  ]
    .filter((value): value is string => value !== undefined)
    .join(" ");
  if (step.action === "navigate") {
    const destination = navigationUrlForStep(step);
    return destination === undefined || hasCredentialLikeUrlData(destination);
  }
  if (step.action === "click") {
    return hasDestructiveActionLanguage(description);
  }
  if (step.action === "type") {
    return /\b(password|passcode|secret|token|credential|api[ _-]?key|credit card|card number|security code|ssn|social security)\b/i.test(
      description,
    );
  }
  return false;
}

function isRedactedTypeDescription(value: string): boolean {
  return /^(type|enter|fill)\s+\[redacted\](?:\s+into\s+.+)?[.!?]?$/i.test(value.trim());
}

function hasExplicitNavigationScheme(value: string): boolean {
  return /\b[a-z][a-z0-9+.-]*:(?:\/\/)?[^\s]+/i.test(value);
}

function safeSummary(step: WalkthroughPlanStep): string {
  return sanitizeText(step.public.summary);
}

function blockedCheck(
  step: WalkthroughPlanStep,
  reason: WalkthroughPlanValidationReason,
  summary: string,
): WalkthroughPlanValidationCheck {
  return {
    id: `check-${step.order}`,
    stepId: step.id,
    action: step.action,
    status: "blocked",
    reason,
    summary,
  };
}

function sanitizeMatch(match: WalkthroughValidationMatch): WalkthroughValidationMatch {
  return {
    id: sanitizeText(match.id),
    label: sanitizeText(match.label).slice(0, 120),
    ...(match.role === undefined ? {} : { role: sanitizeText(match.role) }),
    ...(match.actionRisk === undefined ? {} : { actionRisk: match.actionRisk }),
    ...(match.targetHint === undefined
      ? {}
      : {
          targetHint: {
            kind: "accessible" as const,
            label: sanitizeText(match.targetHint.label),
            ...(match.targetHint.role === undefined
              ? {}
              : { role: sanitizeText(match.targetHint.role) }),
            ...(match.targetHint.occurrence === undefined
              ? {}
              : { occurrence: match.targetHint.occurrence }),
          },
        }),
  };
}

function sanitizePlan(plan: WalkthroughPlan): WalkthroughPlan {
  const steps = plan.steps.map((step) => ({
    id: sanitizeIdentifier(step.id),
    order: step.order,
    action: step.action,
    resolution: step.resolution,
    sourceText: sanitizeText(step.sourceText),
    public: { summary: sanitizeText(step.public.summary) },
    ...(step.questionId === undefined ? {} : { questionId: sanitizeIdentifier(step.questionId) }),
    ...(step.targetHint === undefined
      ? {}
      : {
          targetHint: {
            kind: "accessible" as const,
            label: sanitizeText(step.targetHint.label),
            ...(step.targetHint.role === undefined
              ? {}
              : { role: sanitizeText(step.targetHint.role) }),
            ...(step.targetHint.occurrence === undefined
              ? {}
              : { occurrence: step.targetHint.occurrence }),
          },
        }),
    ...(step.navigationUrl === undefined ? {} : { navigationUrl: sanitizeUrl(step.navigationUrl) }),
    ...(step.inputBinding === undefined
      ? {}
      : { inputBinding: sanitizeIdentifier(step.inputBinding) }),
    ...(step.waitDurationMs === undefined ? {} : { waitDurationMs: step.waitDurationMs }),
    ...(step.assertion === undefined
      ? {}
      : {
          assertion:
            step.assertion.kind === "navigation"
              ? {
                  kind: "navigation" as const,
                  url: sanitizeUrl(step.assertion.url),
                  match: step.assertion.match,
                }
              : {
                  kind: "visible-state" as const,
                  condition: sanitizeText(step.assertion.condition),
                  ...(step.assertion.role === undefined
                    ? {}
                    : { role: sanitizeText(step.assertion.role) }),
                  ...(step.assertion.occurrence === undefined
                    ? {}
                    : { occurrence: step.assertion.occurrence }),
                },
        }),
    ...(step.provenance === undefined
      ? {}
      : {
          provenance: {
            kind: "discovery" as const,
            sessionId: sanitizeIdentifier(step.provenance.sessionId),
            attemptId: sanitizeIdentifier(step.provenance.attemptId),
            ...(step.provenance.expectationId === undefined
              ? {}
              : { expectationId: sanitizeIdentifier(step.provenance.expectationId) }),
            ...(step.provenance.expectationOrigin === undefined
              ? {}
              : { expectationOrigin: step.provenance.expectationOrigin }),
            ...(step.provenance.normalizedFrom === undefined
              ? {}
              : { normalizedFrom: step.provenance.normalizedFrom }),
          },
        }),
  }));
  return {
    id: sanitizeIdentifier(plan.id),
    target: { kind: "browser", url: sanitizeUrl(plan.target.url) },
    mode: plan.mode,
    state: plan.state,
    source:
      plan.source.parser === "discovery-v1"
        ? {
            script: steps.map((step) => step.sourceText).join(" "),
            parser: "discovery-v1",
            discovery: {
              schemaVersion: 1,
              sessionId: sanitizeIdentifier(plan.source.discovery.sessionId),
              selectedPathFingerprint: plan.source.discovery.selectedPathFingerprint,
            },
          }
        : {
            script: steps.map((step) => step.sourceText).join(" "),
            parser: "deterministic-v1",
          },
    steps,
    questions: plan.questions.map((question) => ({
      id: sanitizeIdentifier(question.id),
      stepId: sanitizeIdentifier(question.stepId),
      prompt: sanitizeText(question.prompt),
      reason: "unrecognized_step",
    })),
    approvals: { required: true, approved: false },
    execution: { status: "not-started" },
    warnings: plan.warnings.map((warning) => ({
      code: sanitizeIdentifier(warning.code),
      message: sanitizeText(warning.message),
    })),
  };
}

export function sanitizeWalkthroughPlan(plan: WalkthroughPlan): WalkthroughPlan {
  return sanitizePlan(plan);
}

export function sanitizeWalkthroughPlanArtifact(plan: WalkthroughPlan): WalkthroughPlan {
  const sanitized = sanitizePlan(plan);
  if (plan.validation !== undefined) {
    const common = {
      status: plan.validation.status,
      validatedAt: plan.validation.validatedAt,
      checks: plan.validation.checks.map((check) => ({
        id: sanitizeIdentifier(check.id),
        stepId: sanitizeIdentifier(check.stepId),
        action: check.action,
        status: check.status,
        ...(check.reason === undefined ? {} : { reason: check.reason }),
        summary: sanitizeText(check.summary),
      })),
      blockers: plan.validation.blockers.map((blocker) => ({
        id: sanitizeIdentifier(blocker.id),
        stepId: sanitizeIdentifier(blocker.stepId),
        reason: blocker.reason,
        question: sanitizeText(blocker.question),
        ...(blocker.candidates === undefined
          ? {}
          : { candidates: blocker.candidates.map(sanitizeMatch) }),
      })),
    };
    sanitized.validation =
      plan.validation.mode === "discovery-replay"
        ? {
            ...common,
            mode: "discovery-replay",
            replay: {
              replayId: sanitizeIdentifier(plan.validation.replay.replayId),
              attempts: plan.validation.replay.attempts,
              sourceSessionId: sanitizeIdentifier(plan.validation.replay.sourceSessionId),
              selectedPathFingerprint: plan.validation.replay.selectedPathFingerprint,
            },
          }
        : { ...common, mode: "dry-run" };
  }
  return sanitized;
}

function sanitizeText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s]+/gi, (url) => sanitizeUrl(url))
    .replace(/\bsk-[a-z0-9_-]{8,}\b/gi, "[redacted-secret]")
    .replace(/\b[a-z0-9_-]{8,}\.[a-z0-9_-]{4,}\.[a-z0-9_-]{4,}\b/gi, "[redacted-secret]")
    .replace(/\bBearer\s+[a-z0-9._~-]{8,}\b/gi, "Bearer [redacted-secret]")
    .replace(
      /\b(token|api[ _-]?key|password|passcode|secret|credential)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[redacted-secret]",
    )
    .replace(
      /\b(token|api[ _-]?key|password|passcode|secret|credential)\s+(is\s+)?(?!field\b|input\b|manager\b|reset\b)([^\s,;]+)/gi,
      (_match, kind: string, linking: string | undefined) =>
        `${kind} ${linking ?? ""}[redacted-secret]`,
    )
    .replace(/\b[a-z0-9_-]{24,}\b/gi, (candidate) =>
      isSecretLikeValue(candidate) ? "[redacted-secret]" : candidate,
    )
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeIdentifier(value: string): string {
  if (
    /^(?:attempt|observation|visible-state|target|artifact)-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    return value;
  }
  const sanitized = sanitizeText(value);
  return sanitized === value && isSafeIdentifier(value) ? value : "redacted-id";
}

export function sanitizeWalkthroughText(value: string): string {
  return sanitizeText(value);
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, url.pathname === "/" ? "/" : "");
  } catch {
    return "[redacted-url]";
  }
}

export function sanitizeWalkthroughUrl(value: string): string {
  return sanitizeUrl(value);
}

function isUnexpectedNavigation(before: string, after: string): boolean {
  return normalizedLocation(before) !== normalizedLocation(after);
}

function normalizedLocation(value: string): string {
  try {
    const url = new URL(value);
    return url.toString();
  } catch {
    return value;
  }
}

function navigationUrlForStep(step: Pick<WalkthroughPlanStep, "sourceText">): string | undefined {
  const match = step.sourceText.match(/https?:\/\/[^\s]+/i)?.[0];
  if (match === undefined) {
    return undefined;
  }
  const candidate = match.replace(/[.!?,;:]+$/, "");
  return isSafeHttpUrl(candidate) ? candidate : undefined;
}
