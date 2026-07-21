import {
  validateBrowserLaunchProfilePlan,
  type BrowserLaunchProfilePlanV1,
  type BrowserLaunchProfileV1,
} from "@auto-demo/browser-profile";
import type { Page } from "playwright";
import type {
  DiscoveryObservation,
  DiscoverySessionV1,
  DiscoveryHostProvenance,
} from "./discoveryContract.js";
import { DISCOVERY_LIMITS } from "./discoveryContract.js";
import type { DiscoveryInputResolver, DiscoveryRehearsalActionInput, DiscoveryRehearsalDiagnostic } from "./discoveryRehearsal.js";
import type { DiscoveryPolicy } from "./discoveryPolicy.js";
import { validateDiscoveryPolicy } from "./discoveryPolicy.js";
import type {
  DiscoveryPlanRepairProvider,
  DiscoveryReplayFailureEvidence,
  DiscoveryReplayResult,
} from "./discoveryReplay.js";
import type { DiscoveryBrowserLauncher } from "./playwrightDiscoveryBrowserLauncher.js";
import type { WalkthroughPlan, ValidatedWalkthroughPlan } from "./index.js";
import type { CompileDiscoverySessionResult } from "./discoveryPlanCompiler.js";
import { compileDiscoverySessionToWalkthroughPlan } from "./discoveryPlanCompiler.js";
import type { WalkthroughPlanReview, WalkthroughPlanReviewResult } from "./walkthroughReview.js";
import { reviewWalkthroughPlan } from "./walkthroughReview.js";
import { isSafeDiscoveryId } from "./discoveryValidation.js";
import { createPlaywrightDiscoveryBrowserLauncher } from "./playwrightDiscoveryBrowserLauncher.js";
import { createPolicyEnforcedPlaywrightDiscoveryRehearsalController } from "./playwrightPolicyDiscoveryRehearsal.js";
import { createPlaywrightDiscoveryReplayBrowserFactory } from "./playwrightDiscoveryReplay.js";
import { replayAndRepairDiscoveryPlan } from "./discoveryReplay.js";
import {
  verifyWalkthroughPlanApproval,
  walkthroughPlanFingerprint,
} from "./walkthroughApproval.js";
import type { WalkthroughExecutionResult } from "./walkthroughExecution.js";
import type {
  AutonomousDiscoveryArtifactKind,
  AutonomousDiscoveryRunCheckpoint,
  AutonomousDiscoverySessionArtifact,
  AutonomousDiscoveryStore,
} from "./autonomousDiscoveryStore.js";

export type AutonomousDiscoveryDecision =
  | { kind: "act"; input: DiscoveryRehearsalActionInput }
  | {
      kind: "complete";
      attemptIds: string[];
      source: "host-agent" | "user-directed";
    }
  | { kind: "abandon"; reason: { code: string; summary: string } };

export type AutonomousDiscoveryDecisionProvider = {
  decide(input: {
    session: DiscoverySessionV1;
    observation: DiscoveryObservation;
    diagnostics: DiscoveryRehearsalDiagnostic[];
    repair?: { number: 1 | 2; failure: DiscoveryReplayFailureEvidence };
  }): Promise<AutonomousDiscoveryDecision>;
};

export type AutonomousDiscoveryRunnerInput = {
  runId: string;
  targetUrl: string;
  goal: string;
  host: DiscoveryHostProvenance;
  policy: DiscoveryPolicy;
  launchProfilePlan: BrowserLaunchProfilePlanV1;
  inputBindings?: Record<string, unknown>;
};

type RunnerControllerResult =
  | {
      ok: true;
      session: DiscoverySessionV1;
      observation?: DiscoveryObservation;
      diagnostics: DiscoveryRehearsalDiagnostic[];
    }
  | { ok: false; session?: DiscoverySessionV1; errors: Array<{ code: string; message: string }> };

export type AutonomousDiscoveryRunnerController = {
  start(input: {
    id: string;
    target: { kind: "browser"; startUrl: string };
    goal: string;
    host: DiscoveryHostProvenance;
    launchProfile: BrowserLaunchProfileV1;
    parentSessionId?: string;
  }): Promise<RunnerControllerResult>;
  perform(input: DiscoveryRehearsalActionInput): Promise<RunnerControllerResult>;
  stop(input:
    | {
        outcome: "complete";
        attemptIds: string[];
        source: "host-agent" | "user-directed";
      }
    | { outcome: "abandon"; reason: { code: string; summary: string } }): Promise<RunnerControllerResult>;
  dispose(): Promise<void>;
};

export type AutonomousDiscoveryRunnerDependencies = {
  store: AutonomousDiscoveryStore;
  decisionProvider: AutonomousDiscoveryDecisionProvider;
  inputResolver: DiscoveryInputResolver;
  browserLauncher: DiscoveryBrowserLauncher;
  createController(input: {
    page: Page;
    policy: DiscoveryPolicy;
    inputResolver: DiscoveryInputResolver;
  }): Promise<AutonomousDiscoveryRunnerController>;
  compile(session: DiscoverySessionV1): CompileDiscoverySessionResult;
  replay(input: {
    sourceSession: DiscoverySessionV1;
    plan: WalkthroughPlan;
    policy: DiscoveryPolicy;
    inputBindings: Record<string, unknown>;
    maxRepairs: 0 | 1 | 2;
    repair: DiscoveryPlanRepairProvider;
  }): Promise<DiscoveryReplayResult>;
  review(plan: WalkthroughPlan): WalkthroughPlanReviewResult;
  clock(): string;
  idGenerator(kind: "session" | "repair-session"): string;
};

export type PlaywrightAutonomousDiscoveryRunnerDependencyInput = {
  store: AutonomousDiscoveryStore;
  decisionProvider: AutonomousDiscoveryDecisionProvider;
  inputResolver: DiscoveryInputResolver;
  now?: () => Date;
  idGenerator?: (kind: "session" | "repair-session") => string;
};

export function createPlaywrightAutonomousDiscoveryRunnerDependencies(
  input: PlaywrightAutonomousDiscoveryRunnerDependencyInput,
): AutonomousDiscoveryRunnerDependencies {
  const now = input.now ?? (() => new Date());
  return {
    store: input.store,
    decisionProvider: input.decisionProvider,
    inputResolver: input.inputResolver,
    browserLauncher: createPlaywrightDiscoveryBrowserLauncher(),
    async createController({ page, policy, inputResolver }) {
      return await createPolicyEnforcedPlaywrightDiscoveryRehearsalController(page, {
        chromiumNetworkInstrumentation: "exclusive",
        policy,
        inputResolver,
        clock: () => now().toISOString(),
      });
    },
    compile: compileDiscoverySessionToWalkthroughPlan,
    async replay({ sourceSession, plan, policy, inputBindings, maxRepairs, repair }) {
      return await replayAndRepairDiscoveryPlan(
        { sourceSession, plan, policy, inputBindings },
        {
          maxRepairs,
          now,
          replayIdGenerator: () => `replay-${randomUUID()}`,
        },
        {
          browserFactory: createPlaywrightDiscoveryReplayBrowserFactory(),
          repair,
        },
      );
    },
    review: reviewWalkthroughPlan,
    clock: () => now().toISOString(),
    idGenerator: input.idGenerator ?? ((kind) => `${kind}-${randomUUID()}`),
  };
}

export type AutonomousDiscoveryRunnerError = {
  code:
    | "invalid_runner_input"
    | "artifact_persistence_failed"
    | "browser_launch_failed"
    | "discovery_failed"
    | "compilation_failed"
    | "replay_failed"
    | "review_blocked";
  message: string;
};

export type AutonomousDiscoveryToReviewResult =
  | {
      ok: true;
      phase: "review_required";
      plan: ValidatedWalkthroughPlan;
      review: WalkthroughPlanReview;
      replayAttempts: number;
      checkpoint: AutonomousDiscoveryRunCheckpoint;
    }
  | {
      ok: true;
      phase: "abandoned";
      session: DiscoverySessionV1;
      checkpoint: AutonomousDiscoveryRunCheckpoint;
    }
  | {
      ok: false;
      phase: "preflight" | "launch" | "discovery" | "compilation" | "replay" | "review";
      errors: AutonomousDiscoveryRunnerError[];
    };

export type CompleteApprovedAutonomousDiscoveryInput = {
  plan: WalkthroughPlan;
  inputBindings?: Record<string, unknown>;
  outputDir: string;
  projectDirectory: string;
  projectName: string;
};

export type AutonomousDiscoveryHandoffResult =
  | {
      ok: true;
      projectDirectory: string;
      projectName: string;
      nextSteps: string[];
    }
  | { ok: false; code: string; message: string };

export type CompleteApprovedAutonomousDiscoveryDependencies = {
  store: AutonomousDiscoveryStore;
  record(input: {
    plan: WalkthroughPlan;
    policy: DiscoveryPolicy;
    launchProfile: BrowserLaunchProfileV1;
    outputDir: string;
    inputBindings: Record<string, unknown>;
  }): Promise<WalkthroughExecutionResult>;
  handoff(input: {
    execution: Extract<WalkthroughExecutionResult, { ok: true }>;
    projectDirectory: string;
    projectName: string;
  }): Promise<AutonomousDiscoveryHandoffResult>;
};

export type CompleteApprovedAutonomousDiscoveryResult =
  | {
      ok: true;
      phase: "completed";
      execution: Extract<WalkthroughExecutionResult, { ok: true }>;
      handoff: Extract<AutonomousDiscoveryHandoffResult, { ok: true }>;
      checkpoint: AutonomousDiscoveryRunCheckpoint;
    }
  | {
      ok: false;
      phase: "approval" | "recording" | "handoff";
      errors: Array<{
        code:
          | "approved_plan_required"
          | "runner_not_reviewable"
          | "approved_plan_mismatch"
          | "artifact_persistence_failed"
          | "recording_failed"
          | "handoff_failed";
        message: string;
      }>;
    };

export async function completeApprovedAutonomousDiscovery(
  input: CompleteApprovedAutonomousDiscoveryInput,
  dependencies: CompleteApprovedAutonomousDiscoveryDependencies,
): Promise<CompleteApprovedAutonomousDiscoveryResult> {
  const checkpointResult = await dependencies.store.loadCheckpoint();
  if (!checkpointResult.ok || checkpointResult.checkpoint.phase !== "review-required") {
    return completionFailure(
      "approval",
      "runner_not_reviewable",
      "Autonomous discovery run is not waiting for approval.",
    );
  }
  const approval = verifyWalkthroughPlanApproval(input.plan);
  if (!approval.ok) {
    return completionFailure(
      "approval",
      "approved_plan_required",
      "Autonomous discovery completion requires an explicitly approved plan.",
    );
  }
  const persistedPlan = await dependencies.store.loadPlan("replay-validated");
  if (
    !persistedPlan.ok ||
    walkthroughPlanFingerprint(persistedPlan.plan) !== walkthroughPlanFingerprint(input.plan) ||
    input.plan.launchProfile === undefined ||
    !sameProfile(input.plan.launchProfile, checkpointResult.checkpoint.launchProfile) ||
    input.plan.target.url !== checkpointResult.checkpoint.target.url
  ) {
    return completionFailure(
      "approval",
      "approved_plan_mismatch",
      "Approved plan does not match the replay-validated discovery checkpoint.",
    );
  }
  if (
    input.outputDir.trim().length === 0 ||
    input.projectDirectory.trim().length === 0 ||
    input.projectName.trim().length === 0
  ) {
    return completionFailure(
      "approval",
      "approved_plan_mismatch",
      "Approved completion paths and project name are invalid.",
    );
  }

  let checkpoint = checkpointResult.checkpoint;
  const approvedWrite = await dependencies.store.writePlan("approved", input.plan);
  if (!approvedWrite.ok) {
    return completionFailure(
      "approval",
      "artifact_persistence_failed",
      approvedWrite.message,
    );
  }
  checkpoint = withArtifact(checkpoint, "approved-plan", approvedWrite.path);
  checkpoint = { ...checkpoint, phase: "recording" };
  const recordingCheckpoint = await dependencies.store.writeCheckpoint(checkpoint);
  if (!recordingCheckpoint.ok) {
    return completionFailure(
      "recording",
      "artifact_persistence_failed",
      recordingCheckpoint.message,
    );
  }

  let execution: WalkthroughExecutionResult;
  try {
    execution = await dependencies.record({
      plan: structuredClone(input.plan),
      policy: structuredClone(checkpoint.policy),
      launchProfile: structuredClone(checkpoint.launchProfile),
      outputDir: input.outputDir,
      inputBindings: input.inputBindings ?? {},
    });
  } catch {
    return completionFailure(
      "recording",
      "recording_failed",
      "Autonomous discovery recording failed.",
    );
  }
  if (!execution.ok) {
    return completionFailure(
      "recording",
      "recording_failed",
      "Autonomous discovery recording failed.",
    );
  }
  const executionWrite = await dependencies.store.writeExecution(execution);
  if (!executionWrite.ok) {
    return completionFailure(
      "recording",
      "artifact_persistence_failed",
      executionWrite.message,
    );
  }
  checkpoint = withArtifact(checkpoint, "execution", executionWrite.path);

  let handoff: AutonomousDiscoveryHandoffResult;
  try {
    handoff = await dependencies.handoff({
      execution,
      projectDirectory: input.projectDirectory,
      projectName: input.projectName,
    });
  } catch {
    return completionFailure(
      "handoff",
      "handoff_failed",
      "Autonomous discovery project handoff failed.",
    );
  }
  if (!handoff.ok) {
    return completionFailure(
      "handoff",
      "handoff_failed",
      "Autonomous discovery project handoff failed.",
    );
  }
  const handoffWrite = await dependencies.store.writeHandoff(handoff);
  if (!handoffWrite.ok) {
    return completionFailure("handoff", "artifact_persistence_failed", handoffWrite.message);
  }
  checkpoint = withArtifact(checkpoint, "handoff", handoffWrite.path);
  checkpoint = { ...checkpoint, phase: "completed" };
  const completedWrite = await dependencies.store.writeCheckpoint(checkpoint);
  if (!completedWrite.ok) {
    return completionFailure("handoff", "artifact_persistence_failed", completedWrite.message);
  }
  return {
    ok: true,
    phase: "completed",
    execution: structuredClone(execution),
    handoff: structuredClone(handoff),
    checkpoint: structuredClone(checkpoint),
  };
}

export async function runAutonomousDiscoveryToReview(
  input: AutonomousDiscoveryRunnerInput,
  dependencies: AutonomousDiscoveryRunnerDependencies,
): Promise<AutonomousDiscoveryToReviewResult> {
  const prepared = prepareInput(input);
  if (!prepared.ok) return runnerFailure("preflight", "invalid_runner_input", prepared.message);

  let checkpoint: AutonomousDiscoveryRunCheckpoint = {
    schemaVersion: 1,
    runId: input.runId,
    phase: "discovering",
    policy: structuredClone(input.policy),
    target: { url: input.targetUrl, goal: input.goal },
    launchProfile: prepared.profilePlan.primary,
    artifacts: {},
  };
  const initialized = await dependencies.store.initialize(checkpoint);
  if (!initialized.ok) {
    return runnerFailure("preflight", "artifact_persistence_failed", initialized.message);
  }

  const launched = await dependencies.browserLauncher.launch({
    url: input.targetUrl,
    profilePlan: prepared.profilePlan,
  });
  if (!launched.ok) {
    return runnerFailure("launch", "browser_launch_failed", launched.message);
  }
  if (!sameProfile(checkpoint.launchProfile, launched.profile)) {
    checkpoint = { ...checkpoint, launchProfile: structuredClone(launched.profile) };
    const selected = await dependencies.store.writeCheckpoint(checkpoint);
    if (!selected.ok) {
      await launched.close().catch(() => undefined);
      return runnerFailure("launch", "artifact_persistence_failed", selected.message);
    }
  }

  let controller: AutonomousDiscoveryRunnerController | undefined;
  try {
    controller = await dependencies.createController({
      page: launched.page,
      policy: input.policy,
      inputResolver: dependencies.inputResolver,
    });
    const started = await controller.start({
      id: dependencies.idGenerator("session"),
      target: { kind: "browser", startUrl: input.targetUrl },
      goal: input.goal,
      host: input.host,
      launchProfile: launched.profile,
    });
    if (!started.ok || started.observation === undefined) {
      return runnerFailure("discovery", "discovery_failed", "Autonomous discovery could not start.");
    }
    let current = started;
    const firstWrite = await dependencies.store.writeSession("root", current.session);
    if (!firstWrite.ok) {
      return runnerFailure("discovery", "artifact_persistence_failed", firstWrite.message);
    }

    while (true) {
      let decision: AutonomousDiscoveryDecision;
      try {
        decision = await dependencies.decisionProvider.decide({
          session: structuredClone(current.session),
          observation: structuredClone(current.observation!),
          diagnostics: structuredClone(current.diagnostics),
        });
      } catch {
        return runnerFailure("discovery", "discovery_failed", "Autonomous discovery decision failed.");
      }

      if (decision.kind === "act") {
        const performed = await controller.perform(decision.input);
        if (!performed.ok || performed.observation === undefined) {
          return runnerFailure("discovery", "discovery_failed", "Autonomous discovery action failed.");
        }
        const written = await dependencies.store.writeSession("root", performed.session);
        if (!written.ok) {
          return runnerFailure("discovery", "artifact_persistence_failed", written.message);
        }
        current = performed;
        continue;
      }

      const stopped = await controller.stop(
        decision.kind === "complete"
          ? {
              outcome: "complete",
              attemptIds: decision.attemptIds,
              source: decision.source,
            }
          : { outcome: "abandon", reason: decision.reason },
      );
      if (!stopped.ok) {
        return runnerFailure("discovery", "discovery_failed", "Autonomous discovery could not stop.");
      }
      const terminalWrite = await dependencies.store.writeSession("root", stopped.session);
      if (!terminalWrite.ok) {
        return runnerFailure("discovery", "artifact_persistence_failed", terminalWrite.message);
      }
      checkpoint = withArtifact(checkpoint, "root-session", terminalWrite.path);

      if (decision.kind === "abandon") {
        checkpoint = { ...checkpoint, phase: "abandoned" };
        const checkpointWrite = await dependencies.store.writeCheckpoint(checkpoint);
        if (!checkpointWrite.ok) {
          return runnerFailure("discovery", "artifact_persistence_failed", checkpointWrite.message);
        }
        return {
          ok: true,
          phase: "abandoned",
          session: structuredClone(stopped.session),
          checkpoint: structuredClone(checkpoint),
        };
      }

      const compiled = dependencies.compile(stopped.session);
      if (!compiled.ok) {
        return runnerFailure(
          "compilation",
          "compilation_failed",
          "Autonomous discovery session could not be compiled.",
        );
      }
      const draftWrite = await dependencies.store.writePlan("draft", compiled.plan);
      if (!draftWrite.ok) {
        return runnerFailure("compilation", "artifact_persistence_failed", draftWrite.message);
      }
      checkpoint = withArtifact(checkpoint, "draft-plan", draftWrite.path);
      checkpoint = { ...checkpoint, phase: "replaying" };
      const replayCheckpoint = await dependencies.store.writeCheckpoint(checkpoint);
      if (!replayCheckpoint.ok) {
        return runnerFailure("replay", "artifact_persistence_failed", replayCheckpoint.message);
      }

      const repair: DiscoveryPlanRepairProvider = {
        async repair(repairInput) {
          const repairResult = await runRepairSession({
            input,
            checkpoint,
            dependencies,
            repairNumber: repairInput.repairNumber,
            parentSession: repairInput.parentSession,
            failure: repairInput.failure,
          });
          if (repairResult.decision === "repaired") {
            const artifactKind = `repair-${repairInput.repairNumber}-session` as const;
            checkpoint = withArtifact(checkpoint, artifactKind, repairResult.path);
          }
          return repairResult.decision === "repaired"
            ? { decision: "repaired", session: repairResult.session }
            : { decision: "stop", reason: repairResult.reason };
        },
      };
      const replay = await dependencies.replay({
        sourceSession: stopped.session,
        plan: compiled.plan,
        policy: input.policy,
        inputBindings: input.inputBindings ?? {},
        maxRepairs: 2,
        repair,
      });
      const replayWrite = await dependencies.store.writeReplay(replay);
      if (!replayWrite.ok) {
        return runnerFailure("replay", "artifact_persistence_failed", replayWrite.message);
      }
      checkpoint = withArtifact(checkpoint, "replay", replayWrite.path);
      if (!replay.ok) {
        return runnerFailure("replay", "replay_failed", "Autonomous discovery replay failed.");
      }
      const planWrite = await dependencies.store.writePlan("replay-validated", replay.plan);
      if (!planWrite.ok) {
        return runnerFailure("replay", "artifact_persistence_failed", planWrite.message);
      }
      checkpoint = withArtifact(checkpoint, "replay-validated-plan", planWrite.path);
      const review = dependencies.review(replay.plan);
      if (!review.ok || !review.review.approval.eligible || review.review.blockers.length > 0) {
        return runnerFailure("review", "review_blocked", "Autonomous discovery review is blocked.");
      }
      const reviewWrite = await dependencies.store.writeReview(review.review);
      if (!reviewWrite.ok) {
        return runnerFailure("review", "artifact_persistence_failed", reviewWrite.message);
      }
      checkpoint = withArtifact(checkpoint, "review", reviewWrite.path);
      checkpoint = { ...checkpoint, phase: "review-required" };
      const finalCheckpoint = await dependencies.store.writeCheckpoint(checkpoint);
      if (!finalCheckpoint.ok) {
        return runnerFailure("review", "artifact_persistence_failed", finalCheckpoint.message);
      }
      return {
        ok: true,
        phase: "review_required",
        plan: structuredClone(replay.plan),
        review: structuredClone(review.review),
        replayAttempts: replay.attempts.length,
        checkpoint: structuredClone(checkpoint),
      };
    }
  } catch {
    return runnerFailure("discovery", "discovery_failed", "Autonomous discovery failed.");
  } finally {
    await controller?.dispose().catch(() => undefined);
    await launched.close().catch(() => undefined);
  }
}

async function runRepairSession(input: {
  input: AutonomousDiscoveryRunnerInput;
  checkpoint: AutonomousDiscoveryRunCheckpoint;
  dependencies: AutonomousDiscoveryRunnerDependencies;
  repairNumber: 1 | 2;
  parentSession: DiscoverySessionV1;
  failure: DiscoveryReplayFailureEvidence;
}): Promise<
  | { decision: "repaired"; session: DiscoverySessionV1; path: string }
  | { decision: "stop"; reason: "manual_review_required" | "repair_declined" }
> {
  const launched = await input.dependencies.browserLauncher.launch({
    url: input.parentSession.target.startUrl,
    profilePlan: { schemaVersion: 1, primary: input.checkpoint.launchProfile },
  });
  if (!launched.ok || !sameProfile(launched.profile, input.checkpoint.launchProfile)) {
    if (launched.ok) await launched.close().catch(() => undefined);
    return { decision: "stop", reason: "manual_review_required" };
  }
  let controller: AutonomousDiscoveryRunnerController | undefined;
  try {
    controller = await input.dependencies.createController({
      page: launched.page,
      policy: input.input.policy,
      inputResolver: input.dependencies.inputResolver,
    });
    const started = await controller.start({
      id: input.dependencies.idGenerator("repair-session"),
      target: { kind: "browser", startUrl: input.parentSession.target.startUrl },
      goal: input.parentSession.goal,
      host: input.parentSession.host,
      launchProfile: input.checkpoint.launchProfile,
      parentSessionId: input.parentSession.id,
    });
    if (!started.ok || started.observation === undefined) {
      return { decision: "stop", reason: "manual_review_required" };
    }
    let current = started;
    const artifactKind = `repair-${input.repairNumber}` as AutonomousDiscoverySessionArtifact;
    const initialWrite = await input.dependencies.store.writeSession(artifactKind, current.session);
    if (!initialWrite.ok) throw new Error("persistence");

    while (true) {
      const decision = await input.dependencies.decisionProvider.decide({
        session: structuredClone(current.session),
        observation: structuredClone(current.observation!),
        diagnostics: structuredClone(current.diagnostics),
        repair: { number: input.repairNumber, failure: structuredClone(input.failure) },
      });
      if (decision.kind === "act") {
        const performed = await controller.perform(decision.input);
        if (!performed.ok || performed.observation === undefined) {
          return { decision: "stop", reason: "manual_review_required" };
        }
        const written = await input.dependencies.store.writeSession(artifactKind, performed.session);
        if (!written.ok) throw new Error("persistence");
        current = performed;
        continue;
      }
      const stopped = await controller.stop(
        decision.kind === "complete"
          ? { outcome: "complete", attemptIds: decision.attemptIds, source: decision.source }
          : { outcome: "abandon", reason: decision.reason },
      );
      if (!stopped.ok) return { decision: "stop", reason: "manual_review_required" };
      const written = await input.dependencies.store.writeSession(artifactKind, stopped.session);
      if (!written.ok) throw new Error("persistence");
      if (decision.kind === "abandon") return { decision: "stop", reason: "repair_declined" };
      return { decision: "repaired", session: stopped.session, path: written.path };
    }
  } finally {
    await controller?.dispose().catch(() => undefined);
    await launched.close().catch(() => undefined);
  }
}

function prepareInput(input: AutonomousDiscoveryRunnerInput):
  | { ok: true; profilePlan: BrowserLaunchProfilePlanV1 }
  | { ok: false; message: string } {
  if (
    !isSafeDiscoveryId(input.runId) ||
    input.goal.trim().length === 0 ||
    input.goal.length > DISCOVERY_LIMITS.publicStringCharacters ||
    input.targetUrl.length > DISCOVERY_LIMITS.publicStringCharacters ||
    typeof input.host?.name !== "string" ||
    typeof input.host?.version !== "string" ||
    input.host.name.length > DISCOVERY_LIMITS.identifierCharacters ||
    input.host.version.length > DISCOVERY_LIMITS.identifierCharacters ||
    (input.host.model !== undefined &&
      (typeof input.host.model !== "string" ||
        input.host.model.length > DISCOVERY_LIMITS.identifierCharacters))
  ) {
    return { ok: false, message: "Autonomous discovery runner input is invalid." };
  }
  const profiles = validateBrowserLaunchProfilePlan(input.launchProfilePlan);
  const policy = validateDiscoveryPolicy(input.policy, input.targetUrl);
  if (!profiles.ok || !policy.ok) {
    return { ok: false, message: "Autonomous discovery runner input is invalid." };
  }
  return { ok: true, profilePlan: profiles.plan };
}

function sameProfile(left: BrowserLaunchProfileV1, right: BrowserLaunchProfileV1): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function withArtifact(
  checkpoint: AutonomousDiscoveryRunCheckpoint,
  kind: AutonomousDiscoveryArtifactKind,
  path: string,
): AutonomousDiscoveryRunCheckpoint {
  return {
    ...checkpoint,
    artifacts: { ...checkpoint.artifacts, [kind]: path },
  };
}

function runnerFailure(
  phase: Extract<AutonomousDiscoveryToReviewResult, { ok: false }>["phase"],
  code: AutonomousDiscoveryRunnerError["code"],
  message: string,
): Extract<AutonomousDiscoveryToReviewResult, { ok: false }> {
  return { ok: false, phase, errors: [{ code, message }] };
}

function completionFailure(
  phase: Extract<CompleteApprovedAutonomousDiscoveryResult, { ok: false }>["phase"],
  code: Extract<CompleteApprovedAutonomousDiscoveryResult, { ok: false }>["errors"][number]["code"],
  message: string,
): Extract<CompleteApprovedAutonomousDiscoveryResult, { ok: false }> {
  return { ok: false, phase, errors: [{ code, message }] };
}
import { randomUUID } from "node:crypto";
