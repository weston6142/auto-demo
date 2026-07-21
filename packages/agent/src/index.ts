import { generateHeadlessVariants, type HeadlessVariantGenerationResult } from "@auto-demo/polish";
import type { BrowserLaunchProfileV1 } from "@auto-demo/browser-profile";
import type { DiscoveryExpectationOrigin, DiscoveryTargetStructure } from "./discoveryContract.js";
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
  type WalkthroughPlanReplayValidation,
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

export {
  executeWalkthroughPlan,
  NATURAL_EXECUTION_PACING,
  type WalkthroughExecutionBrowser,
  type WalkthroughExecutionCaptureOutput,
  type WalkthroughExecutionCaptureSession,
  type WalkthroughExecutionCaptureStartResult,
  type WalkthroughExecutionCaptureStopResult,
  type WalkthroughExecutionDependencies,
  type WalkthroughExecutionError,
  type WalkthroughExecutionErrorCode,
  type WalkthroughExecutionInput,
  type WalkthroughExecutionResult,
  type WalkthroughExecutionTarget,
} from "./walkthroughExecution.js";

export {
  DISCOVERY_LIMITS,
  DISCOVERY_SCHEMA_VERSION,
  type DiscoveryAction,
  type DiscoveryArtifactReference,
  type DiscoveryAttempt,
  type DiscoveryAttemptBase,
  type DiscoveryAttemptStatus,
  type DiscoveryConfidence,
  type DiscoveryConfidenceBasis,
  type DiscoveryConfidenceLevel,
  type DiscoveryContractError,
  type DiscoveryContractErrorCode,
  type DiscoveryContractResult,
  type DiscoveryExpectation,
  type DiscoveryExpectationOrigin,
  type DiscoveryHostProvenance,
  type DiscoveryInteractiveTarget,
  type DiscoveryObservation,
  type DiscoveryObservedEffect,
  type DiscoverySelectedPath,
  type DiscoverySessionStatus,
  type DiscoveryStructuralContainer,
  type DiscoveryStructuralItem,
  type DiscoveryTargetStructure,
  type DiscoverySessionV1,
  type DiscoveryTerminal,
  type DiscoveryVisibleState,
  type FinalizedDiscoveryAttempt,
  type PendingDiscoveryAttempt,
} from "./discoveryContract.js";

export {
  COORDINATE_DISCOVERY_LIMITS,
  parseCoordinateActionBatch,
  type CoordinateActionBatch,
  type CoordinateActionBatchResult,
  type CoordinateDiscoveryAction,
  type CoordinateDiscoveryContractError,
  type CoordinateFrame,
} from "./coordinateDiscoveryContract.js";

export {
  createCoordinateDiscoverySession,
  type CoordinateDiscoveryActResult,
  type CoordinateDiscoveryBoundary,
  type CoordinateDiscoveryPage,
  type CoordinateDiscoverySession,
  type CoordinatePageState,
  type CoordinateTraceRecord,
} from "./coordinateDiscoverySession.js";

export {
  createFileCoordinateDiscoveryStore,
  type CoordinateDiscoveryCheckpoint,
  type CoordinateDiscoveryPhase,
  type CoordinateDiscoveryStore,
  type CoordinateDiscoveryStoreError,
  type CoordinateDiscoveryStoreErrorCode,
} from "./coordinateDiscoveryStore.js";

export {
  finalizeCoordinateDiscovery,
  type CoordinateDiscoveryFinalizeDependencies,
  type CoordinateDiscoveryFinalizeInput,
  type CoordinateDiscoveryFinalizeResult,
  type CoordinateReplayResult,
} from "./coordinateDiscoveryFinalize.js";

export {
  PlaywrightCoordinateDiscoveryPage,
  type BrowserWindowCapture,
  type CapturedCoordinateFrame,
  type CoordinateTargetEvidence,
  type PlaywrightCoordinateDiscoveryPageOptions,
} from "./playwrightCoordinateDiscoveryPage.js";

export {
  createMacOsBrowserWindowCapture,
  type MacOsBrowserWindowCaptureOptions,
} from "./macOsBrowserWindowCapture.js";

export {
  abandonDiscoverySession,
  beginDiscoveryAttempt,
  completeDiscoverySession,
  createChildDiscoverySession,
  createDiscoverySession,
  failDiscoverySession,
  finishDiscoveryAttempt,
  recordDiscoveryObservation,
  selectDiscoveryPath,
  type AbandonDiscoverySessionInput,
  type BeginDiscoveryAttemptInput,
  type CompleteDiscoverySessionInput,
  type CreateDiscoverySessionInput,
  type FailDiscoverySessionInput,
  type FinishDiscoveryAttemptInput,
  type RecordDiscoveryObservationInput,
  type SelectDiscoveryPathInput,
} from "./discoverySession.js";
export {
  matchesNavigationExpectation,
  validateDiscoverySession,
  validateSelectedPath,
} from "./discoveryValidation.js";

export {
  compileDiscoverySessionToWalkthroughPlan,
  type CompileDiscoverySessionOptions,
  type CompileDiscoverySessionResult,
  type DiscoveryPlanCompilationError,
  type DiscoveryPlanCompilationErrorCode,
} from "./discoveryPlanCompiler.js";

export {
  DISCOVERY_REPLAY_LIMITS,
  replayAndRepairDiscoveryPlan,
  DiscoveryReplayBrowserError,
  type DiscoveryPlanRepairProvider,
  type DiscoveryReplayAttempt,
  type DiscoveryReplayBrowser,
  type DiscoveryReplayBrowserErrorCode,
  type DiscoveryReplayBrowserFactory,
  type DiscoveryReplayDependencies,
  type DiscoveryReplayError,
  type DiscoveryReplayErrorCode,
  type DiscoveryReplayFailureCode,
  type DiscoveryReplayFailureEvidence,
  type DiscoveryReplayMatch,
  type DiscoveryReplayResult,
  type DiscoveryReplayStopReason,
  type ReplayAndRepairDiscoveryPlanInput,
  type ReplayAndRepairDiscoveryPlanOptions,
} from "./discoveryReplay.js";

export {
  createPlaywrightDiscoveryReplayBrowserFactory,
  type PlaywrightDiscoveryReplayOptions,
} from "./playwrightDiscoveryReplay.js";

export {
  createPlaywrightDiscoveryBrowserLauncher,
  type DiscoveryBrowserLaunchAttempt,
  type DiscoveryBrowserLaunchFailure,
  type DiscoveryBrowserLaunchHandle,
  type DiscoveryBrowserLaunchResult,
  type DiscoveryBrowserLauncher,
} from "./playwrightDiscoveryBrowserLauncher.js";

export {
  createFileAutonomousDiscoveryStore,
  type AutonomousDiscoveryArtifactKind,
  type AutonomousDiscoveryPlanArtifact,
  type AutonomousDiscoveryRunCheckpoint,
  type AutonomousDiscoveryRunPhase,
  type AutonomousDiscoverySessionArtifact,
  type AutonomousDiscoveryStore,
  type AutonomousDiscoveryStoreError,
  type AutonomousDiscoveryStoreErrorCode,
  type AutonomousDiscoveryStoreWriteResult,
} from "./autonomousDiscoveryStore.js";

export {
  completeApprovedAutonomousDiscovery,
  createPlaywrightAutonomousDiscoveryRunnerDependencies,
  runAutonomousDiscoveryToReview,
  type AutonomousDiscoveryDecision,
  type AutonomousDiscoveryDecisionProvider,
  type AutonomousDiscoveryHandoffResult,
  type AutonomousDiscoveryRunnerController,
  type AutonomousDiscoveryRunnerDependencies,
  type AutonomousDiscoveryRunnerError,
  type AutonomousDiscoveryRunnerInput,
  type AutonomousDiscoveryToReviewResult,
  type AutonomousDiscoveryVisualFeedback,
  type CompleteApprovedAutonomousDiscoveryDependencies,
  type CompleteApprovedAutonomousDiscoveryInput,
  type CompleteApprovedAutonomousDiscoveryResult,
  type PlaywrightAutonomousDiscoveryRunnerDependencyInput,
} from "./autonomousDiscoveryRunner.js";

export {
  createDiscoveryObservationExtractor,
  type DiscoveryObservationArtifactSink,
  type DiscoveryObservationDiagnostic,
  type DiscoveryObservationDiagnosticCode,
  type DiscoveryObservationExtractionError,
  type DiscoveryObservationExtractionErrorCode,
  type DiscoveryObservationExtractionResult,
  type DiscoveryObservationExtractor,
  type DiscoveryObservationExtractorDependencies,
  type DiscoveryObservationIdKind,
  type DiscoveryObservationPage,
  type DiscoveryObservationPageSnapshot,
  type DiscoveryObservationRawTarget,
  type DiscoveryObservationRawVisibleState,
} from "./discoveryObservation.js";

export {
  classifyDiscoveryNetworkRequest,
  type DiscoveryBlockedNetworkClassification,
  type DiscoveryBlockedNetworkEvidence,
  type DiscoveryNetworkClassification,
  type DiscoveryNetworkDiagnostic,
  type DiscoveryNetworkMethodCategory,
  type DiscoveryNetworkOriginRelation,
  type DiscoveryNetworkRequestClass,
  type DiscoveryNetworkRequestMetadata,
  type DiscoveryNetworkScope,
} from "./discoveryNetworkClassification.js";

export {
  decideDiscoveryNetworkRequest,
  type DiscoveryNetworkDecision,
} from "./discoveryNetworkPolicy.js";

export {
  createPlaywrightDiscoveryObservationExtractor,
  type PlaywrightDiscoveryObservationOptions,
} from "./playwrightDiscoveryObservation.js";

export {
  createPlaywrightDiscoveryRehearsalController,
  type PlaywrightDiscoveryRehearsalOptions,
} from "./playwrightDiscoveryRehearsal.js";

export {
  createPolicyEnforcedPlaywrightDiscoveryRehearsalController,
  DiscoveryPolicyControllerError,
  type DiscoveryPolicyControllerErrorCode,
  type PlaywrightPolicyDiscoveryRehearsalOptions,
} from "./playwrightPolicyDiscoveryRehearsal.js";

export {
  type DiscoveryPolicy,
  type DiscoveryPolicyOutcomeCode,
  type DiscoveryPolicyValidationError,
  type DiscoveryPolicyValidationErrorCode,
  type DiscoveryPolicyValidationResult,
  type DisposableDiscoveryPolicy,
  type PublicBrowseDiscoveryPolicy,
  type SafeDiscoveryPolicy,
  type YoloDiscoveryPolicy,
} from "./discoveryPolicy.js";

export {
  createDiscoveryRehearsalController,
  type DiscoveryActionAuthorization,
  type DiscoveryActionAuthorizer,
  type DiscoveryInputResolver,
  type DiscoveryRehearsalActionInput,
  type DiscoveryRehearsalControllerDependencies,
  type DiscoveryRehearsalDriver,
  type DiscoveryRehearsalDriverResult,
  type DiscoveryRehearsalDiagnostic,
  type DiscoveryRehearsalError,
  type DiscoveryRehearsalResult,
  type DiscoveryRehearsalStartInput,
  type DiscoveryRehearsalStopInput,
} from "./discoveryRehearsal.js";

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
  "navigate" | "click" | "type" | "select" | "wait" | "assert" | "question";
export type WalkthroughPlanStepResolution = "resolved" | "unresolved";

export type WalkthroughPlanTargetHint = {
  kind: "accessible";
  label: string;
  role?: string;
  occurrence?: number;
  structure?: DiscoveryTargetStructure;
};

export type WalkthroughPlanSource =
  | { parser: "deterministic-v1"; script: string }
  | {
      parser: "discovery-v1";
      script: string;
      discovery: {
        schemaVersion: 1;
        sessionId: string;
        selectedPathFingerprint: string;
      };
    };

export type WalkthroughPlanAssertion =
  | { kind: "navigation"; url: string; match: "exact-url" | "same-origin-path" }
  | {
      kind: "visible-state";
      condition: string;
      role?: string;
      occurrence?: number;
    }
  | {
      kind: "control-state";
      target: WalkthroughPlanTargetHint;
      state: {
        hasValue?: boolean;
        validity?: "valid" | "invalid" | "unknown";
        checked?: boolean;
        selectedOption?: string;
      };
    };

export type WalkthroughPlanStepProvenance = {
  kind: "discovery";
  sessionId: string;
  attemptId: string;
  expectationId?: string;
  expectationOrigin?: DiscoveryExpectationOrigin;
  normalizedFrom?: "inspect" | "back" | "refresh";
};

export type WalkthroughPlanApproval = {
  required: true;
  approved: boolean;
  approvedAt?: string;
  planFingerprint?: string;
  basis?: "validated" | "best-guess-bypass";
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
  navigationUrl?: string;
  inputBinding?: string;
  optionLabel?: string;
  waitDurationMs?: number;
  assertion?: WalkthroughPlanAssertion;
  provenance?: WalkthroughPlanStepProvenance;
};

export type WalkthroughPlanExecutionStepOutcome = {
  stepId: string;
  action: WalkthroughPlanStepAction;
  status: "completed" | "failed" | "skipped";
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  errorCode?: string;
};

export type WalkthroughPlanExecutionCapture = {
  outputDir: string;
  manifestPath: string;
  mediaPath?: string;
  metadataPath?: string;
};

export type WalkthroughPlanExecution =
  | { status: "not-started" }
  | {
      status: "completed" | "failed";
      startedAt: string;
      endedAt: string;
      durationMs: number;
      pacingProfile: "natural-v1";
      steps: WalkthroughPlanExecutionStepOutcome[];
      capture: WalkthroughPlanExecutionCapture;
    };

export type WalkthroughPlan = {
  id: string;
  target: {
    kind: "browser";
    url: string;
  };
  launchProfile?: BrowserLaunchProfileV1;
  mode: WalkthroughPlanMode;
  state: WalkthroughPlanState;
  source: WalkthroughPlanSource;
  steps: WalkthroughPlanStep[];
  questions: WalkthroughPlanQuestion[];
  approvals: WalkthroughPlanApproval;
  execution: WalkthroughPlanExecution;
  warnings: Array<{ code: string; message: string }>;
  validation?: import("./walkthroughValidation.js").WalkthroughPlanValidation;
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
