import type { WalkthroughPlan, WalkthroughPlanStepAction } from "./index.js";
import { verifyWalkthroughPlanApproval } from "./walkthroughApproval.js";
import {
  isWalkthroughPlan,
  isUnsafeWalkthroughAction,
  sanitizeWalkthroughText,
  sanitizeWalkthroughUrl,
  type WalkthroughPlanValidationBlocker,
  type WalkthroughPlanValidationCheck,
  type WalkthroughPlanReplayValidation,
  type WalkthroughValidationMatch,
} from "./walkthroughValidation.js";

export type WalkthroughPlanReview = {
  planId: string;
  source: WalkthroughPlan["source"]["parser"];
  target: string;
  mode: WalkthroughPlan["mode"];
  state: WalkthroughPlan["state"];
  steps: Array<{
    id: string;
    order: number;
    action: WalkthroughPlanStepAction;
    summary: string;
  }>;
  warnings: Array<{ code: string; message: string }>;
  questions: Array<{ id: string; stepId: string; prompt: string }>;
  validation?:
    | {
        status: "ready" | "blocked";
        validatedAt: string;
        mode: "dry-run";
        checks: WalkthroughPlanValidationCheck[];
      }
    | {
        status: "ready" | "blocked";
        validatedAt: string;
        mode: "discovery-replay";
        checks: WalkthroughPlanValidationCheck[];
        replay: WalkthroughPlanReplayValidation["replay"];
      };
  blockers: WalkthroughPlanValidationBlocker[];
  approval: {
    eligible: boolean;
    basis?: "validated" | "best-guess-bypass";
    reason?: string;
  };
  summary: string;
};

export type WalkthroughPlanReviewResult =
  | { ok: true; review: WalkthroughPlanReview }
  | {
      ok: false;
      errors: Array<{ code: "invalid_plan"; message: string }>;
    };

export function reviewWalkthroughPlan(plan: WalkthroughPlan): WalkthroughPlanReviewResult {
  if (!isWalkthroughPlan(plan)) {
    return {
      ok: false,
      errors: [{ code: "invalid_plan", message: "Walkthrough review requires a valid plan." }],
    };
  }

  const target = sanitizeWalkthroughUrl(plan.target.url);
  const steps = plan.steps.map((step) => ({
    id: sanitizeWalkthroughText(step.id),
    order: step.order,
    action: step.action,
    summary: sanitizeWalkthroughText(step.public.summary),
  }));
  const warnings = plan.warnings.map((warning) => ({
    code: sanitizeWalkthroughText(warning.code),
    message: sanitizeWalkthroughText(warning.message),
  }));
  const questions = plan.questions.map((question) => ({
    id: sanitizeWalkthroughText(question.id),
    stepId: sanitizeWalkthroughText(question.stepId),
    prompt: sanitizeWalkthroughText(question.prompt),
  }));
  const validation =
    plan.validation === undefined
      ? undefined
      : plan.validation.mode === "discovery-replay"
        ? {
            status: plan.validation.status,
            validatedAt: plan.validation.validatedAt,
            mode: "discovery-replay" as const,
            checks: plan.validation.checks.map(sanitizeCheck),
            replay: structuredClone(plan.validation.replay),
          }
        : {
            status: plan.validation.status,
            validatedAt: plan.validation.validatedAt,
            mode: "dry-run" as const,
            checks: plan.validation.checks.map(sanitizeCheck),
          };
  const blockers = (plan.validation?.blockers ?? []).map(sanitizeBlocker);
  const approval = approvalEligibility(plan, blockers);
  const lines = [
    `Target: ${target}`,
    `Source: ${plan.source.parser}`,
    `Mode: ${plan.mode}`,
    `State: ${plan.state}`,
    "Steps:",
    ...steps.map((step) => `${step.order}. ${step.summary}`),
  ];

  if (validation !== undefined) {
    lines.push(
      `Validation: ${validation.status}`,
      "Validation checks:",
      ...validation.checks.map((check) => `- ${check.stepId}: ${check.status} — ${check.summary}`),
    );
    if (validation.mode === "discovery-replay") {
      lines.push(`Fresh-context replay: passed after ${validation.replay.attempts} attempts.`);
    }
  }
  if (questions.length > 0) {
    lines.push("Questions:", ...questions.map((question) => `- ${question.prompt}`));
  }

  if (blockers.length > 0) {
    lines.push("Blockers:", ...blockers.map((blocker) => `- ${blocker.question}`));
  }
  if (warnings.length > 0) {
    lines.push("Warnings:", ...warnings.map((warning) => `- ${warning.message}`));
  }
  lines.push(approvalSummary(plan, approval));

  return {
    ok: true,
    review: {
      planId: sanitizeWalkthroughText(plan.id),
      source: plan.source.parser,
      target,
      mode: plan.mode,
      state: plan.state,
      steps,
      warnings,
      questions,
      ...(validation === undefined ? {} : { validation }),
      blockers,
      approval,
      summary: lines.join("\n"),
    },
  };
}

function approvalEligibility(
  plan: WalkthroughPlan,
  blockers: WalkthroughPlanValidationBlocker[],
): WalkthroughPlanReview["approval"] {
  if (plan.approvals.approved) {
    const verification = verifyWalkthroughPlanApproval(plan);
    if (verification.ok) {
      return { eligible: true, basis: plan.approvals.basis };
    }
    return { eligible: false, reason: "Approval is stale because execution content changed." };
  }
  if (plan.steps.some(isUnsafeWalkthroughAction)) {
    return { eligible: false, reason: "Resolve unsafe browser actions before approval." };
  }
  if (
    plan.state === "validated" &&
    plan.validation?.status === "ready" &&
    blockers.length === 0 &&
    plan.questions.length === 0 &&
    plan.steps.every((step) => step.resolution === "resolved")
  ) {
    return { eligible: true, basis: "validated" };
  }
  if (blockers.length > 0) {
    return { eligible: false, reason: "Resolve validation blockers before approval." };
  }
  if (
    plan.mode === "best-guess" &&
    plan.questions.length === 0 &&
    plan.steps.every((step) => step.resolution === "resolved")
  ) {
    return { eligible: true, basis: "best-guess-bypass" };
  }
  return { eligible: false, reason: "Validate and resolve the plan before approval." };
}

function approvalSummary(
  plan: WalkthroughPlan,
  approval: WalkthroughPlanReview["approval"],
): string {
  if (!approval.eligible) return approval.reason ?? "Not approvable.";
  if (approval.basis === "best-guess-bypass") {
    return plan.approvals.approved
      ? "Approved with explicit browser-validation bypass."
      : "Ready for approval with explicit browser-validation bypass.";
  }
  return plan.approvals.approved ? "Approved." : "Ready for approval.";
}

function sanitizeCheck(check: WalkthroughPlanValidationCheck): WalkthroughPlanValidationCheck {
  return {
    id: sanitizeWalkthroughText(check.id),
    stepId: sanitizeWalkthroughText(check.stepId),
    action: check.action,
    status: check.status,
    ...(check.reason === undefined ? {} : { reason: check.reason }),
    summary: sanitizeWalkthroughText(check.summary),
  };
}

function sanitizeBlocker(
  blocker: WalkthroughPlanValidationBlocker,
): WalkthroughPlanValidationBlocker {
  return {
    id: sanitizeWalkthroughText(blocker.id),
    stepId: sanitizeWalkthroughText(blocker.stepId),
    reason: blocker.reason,
    question: sanitizeWalkthroughText(blocker.question),
    ...(blocker.candidates === undefined
      ? {}
      : { candidates: blocker.candidates.map(sanitizeCandidate) }),
  };
}

function sanitizeCandidate(candidate: WalkthroughValidationMatch): WalkthroughValidationMatch {
  return {
    id: sanitizeWalkthroughText(candidate.id),
    label: sanitizeWalkthroughText(candidate.label),
    ...(candidate.role === undefined ? {} : { role: sanitizeWalkthroughText(candidate.role) }),
    ...(candidate.actionRisk === undefined ? {} : { actionRisk: candidate.actionRisk }),
    ...(candidate.targetHint === undefined
      ? {}
      : {
          targetHint: {
            kind: "accessible" as const,
            label: sanitizeWalkthroughText(candidate.targetHint.label),
            ...(candidate.targetHint.role === undefined
              ? {}
              : { role: sanitizeWalkthroughText(candidate.targetHint.role) }),
            ...(candidate.targetHint.occurrence === undefined
              ? {}
              : { occurrence: candidate.targetHint.occurrence }),
            ...(candidate.targetHint.structure === undefined
              ? {}
              : {
                  structure: {
                    container: {
                      role: candidate.targetHint.structure.container.role,
                      ...(candidate.targetHint.structure.container.label === undefined
                        ? {}
                        : {
                            label: sanitizeWalkthroughText(
                              candidate.targetHint.structure.container.label,
                            ),
                          }),
                      ...(candidate.targetHint.structure.container.occurrence === undefined
                        ? {}
                        : { occurrence: candidate.targetHint.structure.container.occurrence }),
                    },
                    ...(candidate.targetHint.structure.item === undefined
                      ? {}
                      : { item: { ...candidate.targetHint.structure.item } }),
                  },
                }),
          },
        }),
  };
}
