import { createHash } from "node:crypto";
import type { WalkthroughPlan } from "./index.js";
import {
  isUnsafeWalkthroughAction,
  isWalkthroughPlan,
  sanitizeWalkthroughPlanArtifact,
} from "./walkthroughValidation.js";

export type WalkthroughApprovalErrorCode =
  "invalid_plan" | "plan_not_approvable" | "best_guess_bypass_required" | "stale_approval";

export type WalkthroughApprovalError = {
  code: WalkthroughApprovalErrorCode;
  message: string;
};

export type WalkthroughApprovalOptions = {
  allowBestGuessBypass?: boolean;
  now?: () => Date;
};

export type WalkthroughPlanApprovalResult =
  { ok: true; plan: WalkthroughPlan } | { ok: false; errors: WalkthroughApprovalError[] };

export type WalkthroughPlanApprovalVerificationResult =
  { ok: true } | { ok: false; errors: WalkthroughApprovalError[] };

export function approveWalkthroughPlan(
  plan: WalkthroughPlan,
  options: WalkthroughApprovalOptions = {},
): WalkthroughPlanApprovalResult {
  if (!isWalkthroughPlan(plan)) {
    return failure("invalid_plan", "Walkthrough approval requires a valid plan.");
  }

  const hasUnresolvedWork =
    plan.questions.length > 0 || plan.steps.some((step) => step.resolution !== "resolved");
  if (hasUnresolvedWork) {
    return failure("plan_not_approvable", "Resolve every walkthrough step before approval.");
  }
  if (plan.steps.some(isUnsafeWalkthroughAction)) {
    return failure("plan_not_approvable", "Resolve unsafe browser actions before approval.");
  }

  let basis: "validated" | "best-guess-bypass";
  if (
    plan.state === "validated" &&
    plan.validation?.status === "ready" &&
    plan.validation.blockers.length === 0
  ) {
    basis = "validated";
  } else if (plan.mode === "best-guess" && plan.validation === undefined) {
    if (options.allowBestGuessBypass !== true) {
      return failure(
        "best_guess_bypass_required",
        "Best-guess approval requires explicit validation bypass intent.",
      );
    }
    basis = "best-guess-bypass";
  } else {
    return failure(
      "plan_not_approvable",
      "Walkthrough plan must be validated and blocker-free before approval.",
    );
  }

  const now = options.now ?? (() => new Date());
  const approved = sanitizeWalkthroughPlanArtifact(plan);
  approved.state = "approved";
  approved.approvals = {
    required: true,
    approved: true,
    approvedAt: now().toISOString(),
    planFingerprint: walkthroughPlanFingerprint(approved),
    basis,
  };
  return { ok: true, plan: approved };
}

export function verifyWalkthroughPlanApproval(
  plan: WalkthroughPlan,
): WalkthroughPlanApprovalVerificationResult {
  if (!isWalkthroughPlan(plan) || !plan.approvals.approved) {
    return failure("invalid_plan", "Walkthrough approval verification requires an approved plan.");
  }
  const fingerprintMatches = plan.approvals.planFingerprint === walkthroughPlanFingerprint(plan);
  const preDiscoveryFingerprintMatches =
    plan.launchProfile === undefined &&
    !plan.steps.some(hasDiscoveryStepData) &&
    plan.approvals.planFingerprint === preDiscoveryWalkthroughPlanFingerprint(plan);
  const legacyFingerprintMatches =
    plan.launchProfile === undefined &&
    !plan.steps.some(hasStructuredExecutionData) &&
    plan.approvals.planFingerprint === legacyWalkthroughPlanFingerprint(plan);
  if (!fingerprintMatches && !preDiscoveryFingerprintMatches && !legacyFingerprintMatches) {
    return failure(
      "stale_approval",
      "Walkthrough approval does not match the current execution content.",
    );
  }
  return { ok: true };
}

function preDiscoveryWalkthroughPlanFingerprint(plan: WalkthroughPlan): string {
  return fingerprint({
    target: plan.target,
    mode: plan.mode,
    steps: plan.steps.map((step) => ({
      id: step.id,
      order: step.order,
      action: step.action,
      resolution: step.resolution,
      sourceText: step.sourceText,
      public: step.public,
      targetHint: step.targetHint ?? null,
      questionId: step.questionId ?? null,
      navigationUrl: step.navigationUrl ?? null,
      inputBinding: step.inputBinding ?? null,
      waitDurationMs: step.waitDurationMs ?? null,
    })),
    questions: plan.questions,
    validation: plan.validation ?? null,
  });
}

export function walkthroughPlanFingerprint(plan: WalkthroughPlan): string {
  return fingerprint({
    target: plan.target,
    launchProfile: plan.launchProfile ?? null,
    mode: plan.mode,
    steps: plan.steps.map((step) => ({
      id: step.id,
      order: step.order,
      action: step.action,
      resolution: step.resolution,
      sourceText: step.sourceText,
      public: step.public,
      targetHint: step.targetHint ?? null,
      questionId: step.questionId ?? null,
      navigationUrl: step.navigationUrl ?? null,
      inputBinding: step.inputBinding ?? null,
      ...(step.optionLabel === undefined ? {} : { optionLabel: step.optionLabel }),
      waitDurationMs: step.waitDurationMs ?? null,
      assertion: step.assertion ?? null,
      provenance: step.provenance ?? null,
    })),
    questions: plan.questions,
    validation: plan.validation ?? null,
  });
}

function legacyWalkthroughPlanFingerprint(plan: WalkthroughPlan): string {
  return fingerprint({
    target: plan.target,
    mode: plan.mode,
    steps: plan.steps.map((step) => ({
      id: step.id,
      order: step.order,
      action: step.action,
      resolution: step.resolution,
      sourceText: step.sourceText,
      public: step.public,
      targetHint: step.targetHint ?? null,
      questionId: step.questionId ?? null,
    })),
    questions: plan.questions,
    validation: plan.validation ?? null,
  });
}

function hasStructuredExecutionData(step: WalkthroughPlan["steps"][number]): boolean {
  return (
    step.navigationUrl !== undefined ||
    step.inputBinding !== undefined ||
    step.optionLabel !== undefined ||
    step.waitDurationMs !== undefined ||
    step.assertion !== undefined ||
    step.provenance !== undefined
  );
}

function hasDiscoveryStepData(step: WalkthroughPlan["steps"][number]): boolean {
  return step.assertion !== undefined || step.provenance !== undefined;
}

function fingerprint(value: unknown): string {
  const canonical = canonicalize(value);
  const digest = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  return `sha256:${digest}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

function failure(
  code: WalkthroughApprovalErrorCode,
  message: string,
): { ok: false; errors: WalkthroughApprovalError[] } {
  return { ok: false, errors: [{ code, message }] };
}
