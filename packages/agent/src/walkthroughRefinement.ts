import type { WalkthroughPlan, WalkthroughPlanStep } from "./index.js";
import { reviewWalkthroughPlan, type WalkthroughPlanReview } from "./walkthroughReview.js";
import {
  isWalkthroughPlan,
  isUnsafeWalkthroughAction,
  sanitizeWalkthroughPlan,
  sanitizeWalkthroughText,
  validateWalkthroughPlan,
  type WalkthroughValidationDependencies,
  type WalkthroughValidationError,
  type WalkthroughValidationErrorCode,
  type WalkthroughValidationOptions,
} from "./walkthroughValidation.js";

export type WalkthroughPlanRefinement =
  | {
      kind: "select-candidate";
      stepId: string;
      blockerId: string;
      candidateId: string;
    }
  | {
      kind: "replace-step";
      stepId: string;
      replacement: Omit<WalkthroughPlanStep, "id" | "order" | "questionId">;
    };

export type WalkthroughRefinementErrorCode =
  | "invalid_plan"
  | "invalid_refinement"
  | "unknown_refinement_step"
  | "stale_validation_blocker"
  | "unknown_validation_candidate"
  | "candidate_not_persistable"
  | "unsupported_replacement_action"
  | WalkthroughValidationErrorCode;

export type WalkthroughRefinementError = {
  code: WalkthroughRefinementErrorCode;
  message: string;
};

export type WalkthroughPlanRefinementResult =
  | { ok: true; plan: WalkthroughPlan; review: WalkthroughPlanReview }
  | { ok: false; errors: WalkthroughRefinementError[] }
  | {
      ok: false;
      plan: WalkthroughPlan;
      review: WalkthroughPlanReview;
      errors: WalkthroughRefinementError[];
    };

export async function refineWalkthroughPlan(
  plan: WalkthroughPlan,
  refinements: WalkthroughPlanRefinement[],
  options: WalkthroughValidationOptions = {},
  dependencies: WalkthroughValidationDependencies,
): Promise<WalkthroughPlanRefinementResult> {
  if (!isWalkthroughPlan(plan)) {
    return failure("invalid_plan", "Walkthrough refinement requires a valid plan.");
  }
  if (!Array.isArray(refinements) || refinements.length === 0) {
    return failure("invalid_refinement", "Walkthrough refinement requires at least one change.");
  }
  if (!refinements.every(isWalkthroughPlanRefinement)) {
    return failure("invalid_refinement", "Walkthrough refinement data is malformed.");
  }

  const duplicateStep = refinements.find(
    (refinement, index) =>
      refinements.findIndex((candidate) => candidate.stepId === refinement.stepId) !== index,
  );
  if (duplicateStep !== undefined) {
    return failure("invalid_refinement", "Walkthrough refinement repeats a target step.");
  }

  for (const refinement of refinements) {
    const validationError = validateRefinement(plan, refinement);
    if (validationError !== undefined) {
      return { ok: false, errors: [validationError] };
    }
  }

  const applied = structuredClone(plan);
  for (const refinement of refinements) {
    applyRefinement(applied, refinement);
  }
  const refined = sanitizeWalkthroughPlan(applied);
  refined.approvals = { required: true, approved: false };
  refined.execution = { status: "not-started" };
  refined.state = refined.questions.length > 0 ? "needs-clarification" : "draft";
  delete refined.validation;

  if (refined.mode === "best-guess" || refined.source.parser === "discovery-v1") {
    return { ok: true, plan: refined, review: requiredReview(refined) };
  }

  const validation = await validateWalkthroughPlan(refined, options, dependencies);
  if (!validation.ok) {
    return {
      ok: false,
      plan: refined,
      review: requiredReview(refined),
      errors: validation.errors.map(mapValidationError),
    };
  }
  return {
    ok: true,
    plan: validation.plan,
    review: requiredReview(validation.plan),
  };
}

function validateRefinement(
  plan: WalkthroughPlan,
  refinement: WalkthroughPlanRefinement,
): WalkthroughRefinementError | undefined {
  const step = plan.steps.find((candidate) => candidate.id === refinement.stepId);
  if (step === undefined) {
    return {
      code: "unknown_refinement_step",
      message: "Walkthrough refinement step was not found.",
    };
  }

  if (refinement.kind === "select-candidate") {
    const blocker = plan.validation?.blockers.find(
      (candidate) => candidate.id === refinement.blockerId && candidate.stepId === step.id,
    );
    if (blocker === undefined) {
      return {
        code: "stale_validation_blocker",
        message: "Walkthrough validation blocker is no longer current.",
      };
    }
    const candidate = blocker.candidates?.find((match) => match.id === refinement.candidateId);
    if (candidate === undefined) {
      return {
        code: "unknown_validation_candidate",
        message: "Walkthrough validation candidate was not found.",
      };
    }
    if (candidate.targetHint === undefined) {
      return {
        code: "candidate_not_persistable",
        message: "Walkthrough validation candidate cannot be persisted safely.",
      };
    }
    if (
      sanitizeWalkthroughText(candidate.targetHint.label) !== candidate.targetHint.label ||
      (candidate.targetHint.role !== undefined &&
        sanitizeWalkthroughText(candidate.targetHint.role) !== candidate.targetHint.role)
    ) {
      return {
        code: "candidate_not_persistable",
        message: "Walkthrough validation candidate cannot be persisted safely.",
      };
    }
    return undefined;
  }

  if (!isReplacement(refinement.replacement)) {
    return {
      code: "unsupported_replacement_action",
      message: "Walkthrough replacement must be one resolved browser action.",
    };
  }
  return undefined;
}

function applyRefinement(plan: WalkthroughPlan, refinement: WalkthroughPlanRefinement): void {
  const stepIndex = plan.steps.findIndex((step) => step.id === refinement.stepId);
  const existing = plan.steps[stepIndex];
  if (existing === undefined) return;

  if (refinement.kind === "select-candidate") {
    const candidate = plan.validation?.blockers
      .find((blocker) => blocker.id === refinement.blockerId)
      ?.candidates?.find((match) => match.id === refinement.candidateId);
    if (candidate?.targetHint !== undefined) {
      existing.targetHint = structuredClone(candidate.targetHint);
      existing.resolution = "resolved";
    }
    return;
  }

  plan.steps[stepIndex] = {
    id: existing.id,
    order: existing.order,
    action: refinement.replacement.action,
    resolution: refinement.replacement.resolution,
    sourceText: refinement.replacement.sourceText,
    public: structuredClone(refinement.replacement.public),
    ...(refinement.replacement.targetHint === undefined
      ? {}
      : { targetHint: structuredClone(refinement.replacement.targetHint) }),
    ...(refinement.replacement.navigationUrl === undefined
      ? {}
      : { navigationUrl: refinement.replacement.navigationUrl }),
    ...(refinement.replacement.inputBinding === undefined
      ? {}
      : { inputBinding: refinement.replacement.inputBinding }),
    ...(refinement.replacement.waitDurationMs === undefined
      ? {}
      : { waitDurationMs: refinement.replacement.waitDurationMs }),
  };
  plan.questions = plan.questions.filter((question) => question.stepId !== existing.id);
}

function isWalkthroughPlanRefinement(value: unknown): value is WalkthroughPlanRefinement {
  if (typeof value !== "object" || value === null) return false;
  const refinement = value as Partial<WalkthroughPlanRefinement>;
  if (!isSafeRefinementIdentifier(refinement.stepId)) return false;
  if (refinement.kind === "select-candidate") {
    return (
      isSafeRefinementIdentifier(refinement.blockerId) &&
      isSafeRefinementIdentifier(refinement.candidateId)
    );
  }
  return refinement.kind === "replace-step" && isReplacementShape(refinement.replacement);
}

type WalkthroughStepReplacement = Omit<WalkthroughPlanStep, "id" | "order" | "questionId">;

function isReplacementShape(value: unknown): value is WalkthroughStepReplacement {
  if (typeof value !== "object" || value === null) return false;
  const replacement = value as Partial<WalkthroughPlanStep>;
  return (
    !("id" in value) &&
    !("order" in value) &&
    !("questionId" in value) &&
    (replacement.action === "navigate" ||
      replacement.action === "click" ||
      replacement.action === "type" ||
      replacement.action === "wait" ||
      replacement.action === "assert") &&
    replacement.resolution === "resolved" &&
    typeof replacement.sourceText === "string" &&
    replacement.sourceText.trim().length > 0 &&
    typeof replacement.public?.summary === "string" &&
    replacement.public.summary.trim().length > 0
  );
}

function isReplacement(value: unknown): value is WalkthroughStepReplacement {
  if (!isReplacementShape(value)) return false;
  const replacement = value;
  if (
    sanitizeWalkthroughText(replacement.sourceText) !== replacement.sourceText ||
    sanitizeWalkthroughText(replacement.public.summary) !== replacement.public.summary
  ) {
    return false;
  }
  if (
    replacement.targetHint !== undefined &&
    (replacement.targetHint.kind !== "accessible" ||
      sanitizeWalkthroughText(replacement.targetHint.label) !== replacement.targetHint.label ||
      (replacement.targetHint.role !== undefined &&
        sanitizeWalkthroughText(replacement.targetHint.role) !== replacement.targetHint.role) ||
      (replacement.targetHint.occurrence !== undefined &&
        (!Number.isInteger(replacement.targetHint.occurrence) ||
          replacement.targetHint.occurrence < 1)))
  ) {
    return false;
  }
  if (
    (replacement.navigationUrl !== undefined &&
      (replacement.action !== "navigate" || !isSafeHttpUrl(replacement.navigationUrl))) ||
    (replacement.inputBinding !== undefined &&
      (replacement.action !== "type" || !isSafeRefinementIdentifier(replacement.inputBinding))) ||
    (replacement.waitDurationMs !== undefined &&
      (replacement.action !== "wait" ||
        !Number.isInteger(replacement.waitDurationMs) ||
        replacement.waitDurationMs < 1 ||
        replacement.waitDurationMs > 60_000))
  ) {
    return false;
  }
  if (replacement.action === "type") {
    return (
      replacement.inputBinding !== undefined &&
      replacement.sourceText.includes("[redacted]") &&
      replacement.public.summary.includes("[redacted]") &&
      !isUnsafeWalkthroughAction(replacement)
    );
  }
  if (replacement.action === "navigate" && replacement.navigationUrl === undefined) return false;
  if (replacement.action === "wait" && replacement.waitDurationMs === undefined) return false;
  return !isUnsafeWalkthroughAction(replacement);
}

function isSafeHttpUrl(value: string): boolean {
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

function isSafeRefinementIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_-]*$/i.test(value);
}

function requiredReview(plan: WalkthroughPlan): WalkthroughPlanReview {
  const result = reviewWalkthroughPlan(plan);
  if (!result.ok) {
    throw new Error("Refined walkthrough plan could not be reviewed.");
  }
  return result.review;
}

function mapValidationError(error: WalkthroughValidationError): WalkthroughRefinementError {
  return { code: error.code, message: error.message };
}

function failure(
  code: WalkthroughRefinementErrorCode,
  message: string,
): { ok: false; errors: WalkthroughRefinementError[] } {
  return { ok: false, errors: [{ code, message }] };
}
