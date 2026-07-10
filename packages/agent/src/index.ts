import { createHash } from "node:crypto";
import { generateHeadlessVariants, type HeadlessVariantGenerationResult } from "@auto-demo/polish";
import {
  loadProject,
  type LoadedProject,
  type ProjectValidationError,
  type ProjectVariant,
} from "@auto-demo/project";

export {
  isWalkthroughPlan,
  validateWalkthroughPlan,
  WalkthroughValidationRunnerError,
  type ValidatedWalkthroughPlan,
  type WalkthroughPlanValidation,
  type WalkthroughPlanValidationBlocker,
  type WalkthroughPlanValidationCheck,
  type WalkthroughPlanValidationReason,
  type WalkthroughValidationBrowserRunner,
  type WalkthroughValidationDependencies,
  type WalkthroughValidationError,
  type WalkthroughValidationErrorCode,
  type WalkthroughValidationMatch,
  type WalkthroughValidationOptions,
  type WalkthroughValidationPageState,
  type WalkthroughValidationResult,
} from "./walkthroughValidation.js";

export {
  createPlaywrightValidationRunner,
  type PlaywrightValidationRunnerOptions,
} from "./playwrightValidationRunner.js";

export {
  reviewWalkthroughPlan,
  type WalkthroughPlanReview,
  type WalkthroughPlanReviewResult,
} from "./walkthroughReview.js";

export {
  approveWalkthroughPlan,
  verifyWalkthroughPlanApproval,
  walkthroughPlanFingerprint,
  type WalkthroughApprovalError,
  type WalkthroughApprovalErrorCode,
  type WalkthroughApprovalOptions,
  type WalkthroughPlanApprovalResult,
  type WalkthroughPlanApprovalVerificationResult,
} from "./walkthroughApproval.js";

export {
  refineWalkthroughPlan,
  type WalkthroughPlanRefinement,
  type WalkthroughPlanRefinementResult,
  type WalkthroughRefinementError,
  type WalkthroughRefinementErrorCode,
} from "./walkthroughRefinement.js";

export type AgentPackageRole = "agent-workflow-wrapper";

export const agentPackageRole: AgentPackageRole = "agent-workflow-wrapper";

export type AgentWorkflowOptions = {
  projectPath: string;
  json: boolean;
  variantId?: string;
  generate?: "baseline";
  save?: "all" | string;
  sourceVariantId?: string;
  openEditor?: boolean;
  editor?: {
    host?: string;
    port?: number;
  };
};

export type AgentWorkflowErrorCode =
  | "missing_project_path"
  | "unsupported_agent_command"
  | "unsupported_agent_output"
  | "unknown_agent_argument"
  | "invalid_project"
  | "missing_variant"
  | "variant_not_found"
  | "unsupported_generation"
  | "generation_failed"
  | "editor_unavailable";

export type AgentWorkflowError = {
  code: AgentWorkflowErrorCode;
  message: string;
  projectErrorCode?: ProjectValidationError["code"];
};

export type AgentWorkflowArtifact =
  | {
      kind: "project-manifest";
      path: string;
    }
  | {
      kind: "variant";
      path: string;
    };

export type AgentWorkflowVariantSource = "selected" | "generated";
export type AgentWorkflowSaveTarget = "baseline-polish" | "all";

export type AgentWorkflowSummary = {
  ok: true;
  project: {
    projectPath: string;
    manifestPath: string;
    name: string;
  };
  variant: {
    id: string;
    path: string;
    source: AgentWorkflowVariantSource;
  };
  artifacts: AgentWorkflowArtifact[];
  warnings: Array<{ code: string; message: string }>;
  nextSteps: string[];
  editor?: {
    opened: true;
    lifecycle: "long-lived-local-server";
    url: string;
  };
};

export type AgentWorkflowFailure = {
  ok: false;
  project: {
    projectPath: string;
  };
  errors: AgentWorkflowError[];
};

export type AgentWorkflowResult = AgentWorkflowSummary | AgentWorkflowFailure;

export type AgentWorkflowGenerationResult = HeadlessVariantGenerationResult;

export type WalkthroughPlanMode = "validate-first" | "best-guess";
export type WalkthroughPlanState =
  "draft" | "needs-clarification" | "validated" | "approved" | "executed";
export type WalkthroughPlanStepAction =
  "navigate" | "click" | "type" | "wait" | "assert" | "question";
export type WalkthroughPlanStepResolution = "resolved" | "unresolved";

export type WalkthroughPlanTargetHint = {
  kind: "accessible";
  label: string;
  role?: string;
  occurrence?: number;
};

export type WalkthroughPlanApproval = {
  required: true;
  approved: boolean;
  approvedAt?: string;
  planFingerprint?: string;
  basis?: "validated" | "best-guess-bypass";
};

export type WalkthroughPlanInput = {
  targetUrl: string;
  script: string;
  mode?: WalkthroughPlanMode;
};

export type WalkthroughPlanQuestion = {
  id: string;
  stepId: string;
  prompt: string;
  reason: "unrecognized_step";
};

export type WalkthroughPlanStep = {
  id: string;
  order: number;
  action: WalkthroughPlanStepAction;
  resolution: WalkthroughPlanStepResolution;
  sourceText: string;
  public: {
    summary: string;
  };
  questionId?: string;
  targetHint?: WalkthroughPlanTargetHint;
};

export type WalkthroughPlan = {
  id: string;
  target: {
    kind: "browser";
    url: string;
  };
  mode: WalkthroughPlanMode;
  state: WalkthroughPlanState;
  source: {
    script: string;
    parser: "deterministic-v1";
  };
  steps: WalkthroughPlanStep[];
  questions: WalkthroughPlanQuestion[];
  approvals: WalkthroughPlanApproval;
  execution: {
    status: "not-started";
  };
  warnings: Array<{ code: string; message: string }>;
  validation?: import("./walkthroughValidation.js").WalkthroughPlanValidation;
};

export type WalkthroughPlanErrorCode =
  | "missing_target_url"
  | "invalid_target_url"
  | "missing_script"
  | "unsupported_plan_mode"
  | "unknown_agent_argument";

export type WalkthroughPlanError = {
  code: WalkthroughPlanErrorCode;
  message: string;
};

export type WalkthroughPlanResult =
  | {
      ok: true;
      plan: WalkthroughPlan;
    }
  | {
      ok: false;
      errors: WalkthroughPlanError[];
    };

export type AgentWorkflowDependencies = {
  loadProject?: typeof loadProject;
  generateHeadlessVariants?: typeof generateHeadlessVariants;
  startEditorServer?: (options: { projectPath: string; host?: string; port?: number }) => Promise<{
    url: string;
    close: () => Promise<void>;
  }>;
};

const activeEditorHandoffs = new Set<() => Promise<void>>();

export function createWalkthroughPlan(input: WalkthroughPlanInput): WalkthroughPlanResult {
  const mode = input.mode ?? "validate-first";
  const errors: WalkthroughPlanError[] = [];
  const targetUrl = input.targetUrl.trim();
  const script = input.script.trim();

  if (targetUrl.length === 0) {
    errors.push({
      code: "missing_target_url",
      message: "Walkthrough plan requires --url <target-url>.",
    });
  } else if (!isHttpUrl(targetUrl)) {
    errors.push({
      code: "invalid_target_url",
      message: "Walkthrough plan target URL must be an absolute http(s) URL.",
    });
  }

  if (script.length === 0) {
    errors.push({
      code: "missing_script",
      message: "Walkthrough plan requires non-empty script text.",
    });
  }

  if (!isWalkthroughPlanMode(mode)) {
    errors.push({
      code: "unsupported_plan_mode",
      message: "Walkthrough plan mode must be validate-first or best-guess.",
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const normalizedSteps = splitScript(script);
  const questions: WalkthroughPlanQuestion[] = [];
  const steps = normalizedSteps.map((stepText, index): WalkthroughPlanStep => {
    const stepId = `step-${index + 1}`;
    const normalized = normalizeStep(stepText);
    if (normalized.action !== "question") {
      return {
        id: stepId,
        order: index + 1,
        action: normalized.action,
        resolution: "resolved",
        sourceText: normalized.action === "type" ? normalized.summary : stepText,
        public: { summary: normalized.summary },
      };
    }

    const question: WalkthroughPlanQuestion = {
      id: `question-${index + 1}`,
      stepId,
      prompt: `Clarify how to perform: ${stepText}`,
      reason: "unrecognized_step",
    };
    questions.push(question);
    return {
      id: stepId,
      order: index + 1,
      action: "question",
      resolution: "unresolved",
      sourceText: stepText,
      public: { summary: question.prompt },
      questionId: question.id,
    };
  });

  return {
    ok: true,
    plan: {
      id: planId(targetUrl, script, mode),
      target: { kind: "browser", url: targetUrl },
      mode,
      state: questions.length === 0 ? "draft" : "needs-clarification",
      source: {
        script,
        parser: "deterministic-v1",
      },
      steps,
      questions,
      approvals: { required: true, approved: false },
      execution: { status: "not-started" },
      warnings:
        mode === "best-guess"
          ? [
              {
                code: "best_guess_mode",
                message: "Best-guess mode may proceed without validation; review before execution.",
              },
            ]
          : [],
    },
  };
}

export async function runAgentWorkflow(
  options: AgentWorkflowOptions,
  dependencies: AgentWorkflowDependencies = {},
): Promise<AgentWorkflowResult> {
  const projectPath = options.projectPath;
  if (projectPath.trim().length === 0) {
    return failure(projectPath, {
      code: "missing_project_path",
      message: "autodemo agent run requires --project <project-dir-or-manifest>.",
    });
  }

  if (!options.json) {
    return failure(projectPath, {
      code: "unsupported_agent_output",
      message: "autodemo agent run currently requires --json output.",
    });
  }

  const load = dependencies.loadProject ?? loadProject;
  const initialProject = await load(projectPath);
  if (!initialProject.ok) {
    return invalidProjectFailure(projectPath, initialProject.errors);
  }

  let project: LoadedProject = initialProject;
  let generatedVariantId: string | undefined;
  let generatedWarnings: AgentWorkflowSummary["warnings"] = [];
  let nextSteps = ["open-editor", "export-variant"];

  if (options.generate !== undefined) {
    if (options.generate !== "baseline" || options.save === undefined) {
      return failure(projectPath, {
        code: "unsupported_generation",
        message:
          "autodemo agent run supports only --generate baseline with --save baseline-polish or --save all.",
      });
    }
    if (!isSupportedAgentSaveTarget(options.save)) {
      return failure(projectPath, {
        code: "unsupported_generation",
        message: "autodemo agent run supports only --save baseline-polish or --save all.",
      });
    }

    const generate = dependencies.generateHeadlessVariants ?? generateHeadlessVariants;
    const generation = await generate({
      projectPath,
      json: true,
      styles: ["baseline"],
      sourceVariantId: options.sourceVariantId,
      save: true,
      mode: options.save === "all" ? "all" : undefined,
      selectedVariantId: options.save === "all" ? undefined : options.save,
    });

    if (!generation.ok) {
      return failure(
        projectPath,
        ...generation.errors.map((error) => ({
          code: "generation_failed" as const,
          message: error.message,
        })),
      );
    }

    const savedVariant = generation.summary.saved[0];
    if (savedVariant === undefined) {
      return failure(projectPath, {
        code: "variant_not_found",
        message: "Generation completed without a saved variant for agent handoff.",
      });
    }

    generatedVariantId = savedVariant.id;
    generatedWarnings = generation.variants.flatMap((variant) => variant.warnings);
    nextSteps = generation.summary.nextSteps;

    const reloadedProject = await load(projectPath);
    if (!reloadedProject.ok) {
      return invalidProjectFailure(projectPath, reloadedProject.errors);
    }
    project = reloadedProject;
  }

  const source: AgentWorkflowVariantSource =
    generatedVariantId === undefined ? "selected" : "generated";
  const selectedVariant = selectVariant(
    project.manifest.variants,
    generatedVariantId ?? options.variantId,
  );
  if (selectedVariant === undefined) {
    return failure(projectPath, {
      code:
        project.manifest.variants.length === 0 &&
        (generatedVariantId ?? options.variantId) === undefined
          ? "missing_variant"
          : "variant_not_found",
      message:
        project.manifest.variants.length === 0
          ? "Project does not contain a saved variant for agent handoff."
          : "Requested variant was not found in the project manifest.",
    });
  }

  const summary: AgentWorkflowSummary = {
    ok: true,
    project: {
      projectPath: project.projectDir,
      manifestPath: project.manifestPath,
      name: project.manifest.name,
    },
    variant: {
      id: selectedVariant.id,
      path: variantPath(selectedVariant.id),
      source,
    },
    artifacts: [
      { kind: "project-manifest", path: project.manifestPath },
      { kind: "variant", path: variantPath(selectedVariant.id) },
    ],
    warnings: generatedWarnings,
    nextSteps,
  };

  if (options.openEditor) {
    if (dependencies.startEditorServer === undefined) {
      return failure(projectPath, {
        code: "editor_unavailable",
        message: "Editor handoff is unavailable in this agent workflow environment.",
      });
    }

    try {
      const editor = await dependencies.startEditorServer({
        projectPath,
        host: options.editor?.host,
        port: options.editor?.port,
      });
      activeEditorHandoffs.add(editor.close);
      summary.editor = {
        opened: true,
        lifecycle: "long-lived-local-server",
        url: editor.url,
      };
    } catch {
      return failure(projectPath, {
        code: "editor_unavailable",
        message: "The local editor could not be started for agent handoff.",
      });
    }
  }

  return summary;
}

function selectVariant(
  variants: ProjectVariant[],
  requestedVariantId: string | undefined,
): ProjectVariant | undefined {
  if (requestedVariantId === undefined) {
    return variants[0];
  }

  return variants.find((variant) => variant.id === requestedVariantId);
}

function variantPath(variantId: string): string {
  return `variants/${variantId}.json`;
}

function isSupportedAgentSaveTarget(save: string): save is AgentWorkflowSaveTarget {
  return save === "baseline-polish" || save === "all";
}

function invalidProjectFailure(
  projectPath: string,
  errors: ProjectValidationError[],
): AgentWorkflowFailure {
  return failure(
    projectPath,
    ...errors.map((error) => ({
      code: "invalid_project" as const,
      projectErrorCode: error.code,
      message: error.message,
    })),
  );
}

function failure(projectPath: string, ...errors: AgentWorkflowError[]): AgentWorkflowFailure {
  return {
    ok: false,
    project: { projectPath },
    errors,
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isWalkthroughPlanMode(value: string): value is WalkthroughPlanMode {
  return value === "validate-first" || value === "best-guess";
}

function planId(targetUrl: string, script: string, mode: WalkthroughPlanMode): string {
  const hash = createHash("sha256")
    .update(`${targetUrl}\n${mode}\n${script}`)
    .digest("hex")
    .slice(0, 12);
  return `plan-${hash}`;
}

function splitScript(script: string): string[] {
  const urls: string[] = [];
  const protectedScript = script.replace(/https?:\/\/\S+/g, (url) => {
    const trailing = url.match(/[.!?]$/)?.[0] ?? "";
    const cleanUrl = trailing.length > 0 ? url.slice(0, -1) : url;
    const token = `__URL_${urls.length}__`;
    urls.push(cleanUrl);
    return `${token}${trailing}`;
  });
  const matches = protectedScript.match(/[^.!?\n]+[.!?]?/g) ?? [];
  return matches
    .map((step) =>
      step.trim().replace(/__URL_(\d+)__/g, (_, index: string) => urls[Number(index)] ?? ""),
    )
    .filter((step) => step.length > 0);
}

function normalizeStep(stepText: string): {
  action: WalkthroughPlanStepAction;
  summary: string;
} {
  if (/^(go to|navigate to)\s+/i.test(stepText) || /^https?:\/\//i.test(stepText)) {
    return { action: "navigate", summary: stepText };
  }

  if (/^open\s+/i.test(stepText)) {
    return { action: "navigate", summary: stepText };
  }

  if (/^click\s+/i.test(stepText)) {
    return { action: "click", summary: stepText };
  }

  if (/^(type|enter|fill)\s+/i.test(stepText)) {
    return { action: "type", summary: redactTypedValue(stepText) };
  }

  if (/^wait\s+/i.test(stepText)) {
    return { action: "wait", summary: stepText };
  }

  if (/^(see|verify|assert|check)\s+/i.test(stepText)) {
    return { action: "assert", summary: stepText };
  }

  return { action: "question", summary: stepText };
}

function redactTypedValue(stepText: string): string {
  const typedInto = stepText.match(/^(type|enter|fill)\s+(.+?)\s+into\s+(.+)$/i);
  if (typedInto !== null) {
    return `${capitalize(typedInto[1])} [redacted] into ${typedInto[3]}`;
  }

  return stepText.replace(/^(type|enter|fill)\s+.+$/i, (_, verb: string) => {
    return `${capitalize(verb)} [redacted]`;
  });
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1).toLowerCase()}`;
}
