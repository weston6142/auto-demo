import type {
  DiscoveryExpectation,
  DiscoveryInteractiveTarget,
  DiscoveryObservation,
  DiscoveryObservedEffect,
  DiscoverySessionV1,
} from "./discoveryContract.js";
import { compileValidatedDiscoverySessionToWalkthroughPlan } from "./discoveryPlanCompiler.js";
import { validateDiscoverySession } from "./discoveryValidation.js";
import {
  beginDiscoveryAttempt,
  completeDiscoverySession,
  createDiscoverySession,
  finishDiscoveryAttempt,
  recordDiscoveryObservation,
  selectDiscoveryPath,
} from "./discoverySession.js";
import type { CoordinateTraceRecord } from "./coordinateDiscoverySession.js";
import type { WalkthroughPlan } from "./index.js";
import type { WalkthroughPlanReview, WalkthroughPlanReviewResult } from "./walkthroughReview.js";

export type CoordinateDiscoveryFinalizeInput = {
  sessionId: string;
  targetUrl: string;
  goal: string;
  trace: CoordinateTraceRecord[];
  runtimeBindings: Record<string, string>;
};

export type CoordinateReplayResult =
  | { ok: true; attempts: number; plan: WalkthroughPlan }
  | {
      ok: false;
      attempts: number;
      failure: { code: string; stepId?: string };
    };

export type CoordinateDiscoveryFinalizeDependencies = {
  now: () => Date;
  replay(input: {
    sourceSession: DiscoverySessionV1;
    plan: WalkthroughPlan;
    runtimeBindings: Record<string, string>;
  }): Promise<CoordinateReplayResult>;
  review(plan: WalkthroughPlan): WalkthroughPlanReviewResult;
};

export type CoordinateDiscoveryFinalizeResult =
  | {
      ok: true;
      phase: "review_required";
      plan: WalkthroughPlan;
      review: WalkthroughPlanReview;
      replayAttempts: number;
      sourceSession: DiscoverySessionV1;
    }
  | {
      ok: true;
      phase: "repairing";
      replayAttempts: number;
      failure: { code: string; stepId?: string };
    }
  | {
      ok: false;
      code:
        | "unmappable_coordinate_action"
        | "coordinate_compilation_failed"
        | "coordinate_review_failed";
      message: string;
      actionIndex?: number;
    };

export async function finalizeCoordinateDiscovery(
  input: CoordinateDiscoveryFinalizeInput,
  dependencies: CoordinateDiscoveryFinalizeDependencies,
): Promise<CoordinateDiscoveryFinalizeResult> {
  const unmappable = input.trace.find(
    (record) =>
      record.semanticAction === undefined &&
      (record.publicEffect === "navigation" || record.publicEffect === "form-change"),
  );
  if (unmappable !== undefined) {
    return {
      ok: false,
      code: "unmappable_coordinate_action",
      message: "Coordinate action could not be mapped to replayable intent.",
      actionIndex: unmappable.actionIndex,
    };
  }

  const sourceSession = buildDiscoverySession(input, dependencies.now().toISOString());
  const sourceValidation = validateDiscoverySession(sourceSession);
  if (!sourceValidation.ok) {
    return {
      ok: false,
      code: "coordinate_compilation_failed",
      message: "Coordinate discovery could not be compiled safely.",
    };
  }
  const compiled = compileValidatedDiscoverySessionToWalkthroughPlan(sourceValidation.session);
  if (!compiled.ok) {
    return {
      ok: false,
      code: "coordinate_compilation_failed",
      message: "Coordinate discovery could not be compiled safely.",
    };
  }
  const replayed = await dependencies.replay({
    sourceSession,
    plan: compiled.plan,
    runtimeBindings: { ...input.runtimeBindings },
  });
  if (!replayed.ok) {
    return {
      ok: true,
      phase: "repairing",
      replayAttempts: replayed.attempts,
      failure: { ...replayed.failure },
    };
  }
  const reviewed = dependencies.review(replayed.plan);
  if (!reviewed.ok) {
    return {
      ok: false,
      code: "coordinate_review_failed",
      message: "Replay-validated coordinate plan could not be reviewed safely.",
    };
  }
  return {
    ok: true,
    phase: "review_required",
    plan: replayed.plan,
    review: reviewed.review,
    replayAttempts: replayed.attempts,
    sourceSession,
  };
}

function buildDiscoverySession(
  input: CoordinateDiscoveryFinalizeInput,
  timestamp: string,
): DiscoverySessionV1 {
  const selected = input.trace.filter(
    (
      record,
    ): record is CoordinateTraceRecord & {
      semanticAction: NonNullable<CoordinateTraceRecord["semanticAction"]>;
    } => record.semanticAction !== undefined,
  );
  const targets = new Map<string, DiscoveryInteractiveTarget>();
  for (const record of selected) {
    if (record.target !== undefined && !targets.has(record.target.id)) {
      targets.set(record.target.id, structuredClone(record.target));
    }
  }
  let currentUrl = input.targetUrl;
  let currentTitle = "Untitled page";
  let session = requireSession(
    createDiscoverySession({
      id: input.sessionId,
      target: { kind: "browser", startUrl: input.targetUrl },
      goal: input.goal,
      host: { name: "autodemo-coordinate-cli", version: "1" },
      createdAt: timestamp,
    }),
  );
  session = requireSession(
    recordDiscoveryObservation(
      session,
      observationInput(
        "coordinate-observation-1",
        currentUrl,
        currentTitle,
        timestamp,
        [...targets.values()].map((target) => structuredClone(target)),
      ),
    ),
  );
  const selectedAttemptIds: string[] = [];
  for (let index = 0; index < selected.length; index += 1) {
    const record = selected[index]!;
    const beforeId = `coordinate-observation-${index + 1}`;
    const afterId = `coordinate-observation-${index + 2}`;
    const attemptId = `coordinate-attempt-${index + 1}`;
    session = requireSession(
      beginDiscoveryAttempt(session, {
        id: attemptId,
        startedAt: timestamp,
        beforeObservationId: beforeId,
        action: structuredClone(record.semanticAction),
        expectations: [],
        confidence: {
          level: "high",
          bases: [
            record.target?.structure === undefined
              ? "exact-accessible-target"
              : "positional-intent",
          ],
        },
      }),
    );
    if (record.target !== undefined) {
      targets.set(record.target.id, afterTargetState(record, record.target));
    }
    currentUrl = record.pageAfter?.url ?? record.pageBefore?.url ?? currentUrl;
    currentTitle = record.pageAfter?.title ?? record.pageBefore?.title ?? currentTitle;
    session = requireSession(
      recordDiscoveryObservation(
        session,
        observationInput(
          afterId,
          currentUrl,
          currentTitle,
          timestamp,
          [...targets.values()].map((target) => structuredClone(target)),
        ),
      ),
    );
    const evidence = replayEvidence(record, index, afterId);
    session = requireSession(
      finishDiscoveryAttempt(session, attemptId, {
        status: "succeeded",
        finishedAt: timestamp,
        derivedExpectations: evidence.expectations,
        observedEffects: evidence.effects,
        afterObservationId: afterId,
        outcome: {
          code: "coordinate_action_completed",
          summary: "Coordinate action completed.",
        },
      }),
    );
    selectedAttemptIds.push(attemptId);
  }
  session = requireSession(
    selectDiscoveryPath(session, {
      attemptIds: selectedAttemptIds,
      selectedAt: timestamp,
      source: "host-agent",
    }),
  );
  return requireSession(completeDiscoverySession(session, { completedAt: timestamp }));
}

function replayEvidence(
  record: CoordinateTraceRecord,
  index: number,
  afterObservationId: string,
): {
  expectations: DiscoveryExpectation[];
  effects: DiscoveryObservedEffect[];
} {
  const id = `coordinate-expectation-${index + 1}`;
  const targetId =
    record.semanticAction && "targetId" in record.semanticAction
      ? record.semanticAction.targetId
      : undefined;
  const expectation =
    record.semanticAction?.kind === "select" && targetId !== undefined
      ? {
          id,
          kind: "control-state" as const,
          origin: "derived-from-observation" as const,
          targetId,
          state: { selectedOption: record.semanticAction.optionLabel },
        }
      : record.semanticAction?.kind === "type" && targetId !== undefined
        ? {
            id,
            kind: "control-state" as const,
            origin: "derived-from-observation" as const,
            targetId,
            state: { hasValue: true },
          }
        : index === 0 && targetId !== undefined
          ? {
              id,
              kind: "visible-state" as const,
              origin: "derived-from-observation" as const,
              targetId,
            }
          : undefined;
  return expectation === undefined
    ? { expectations: [], effects: [] }
    : {
        expectations: [expectation],
        effects: [
          {
            expectationId: id,
            status: "matched",
            observationId: afterObservationId,
            summary: "Expected public evidence matched.",
          },
        ],
      };
}

function observationInput(
  id: string,
  url: string,
  title: string,
  observedAt: string,
  interactiveTargets: DiscoveryInteractiveTarget[],
): Omit<DiscoveryObservation, "sequence"> {
  return {
    id,
    observedAt,
    page: {
      url,
      title,
      viewport: { width: 1280, height: 720 },
      navigation: { canGoBack: false },
    },
    visibleStates: [],
    interactiveTargets,
    artifacts: [],
  };
}

function requireSession(result: ReturnType<typeof createDiscoverySession>): DiscoverySessionV1 {
  if (!result.ok) throw new Error(result.errors[0]?.code ?? "coordinate_session_invalid");
  return result.session;
}

function afterTargetState(
  record: CoordinateTraceRecord,
  sourceTarget: DiscoveryInteractiveTarget,
): DiscoveryInteractiveTarget {
  const target = structuredClone(sourceTarget);
  if (record.semanticAction?.kind === "select" && target.form !== undefined) {
    const selectedLabel = record.semanticAction.optionLabel;
    target.form.selectedOption = selectedLabel;
    target.form.options = target.form.options?.map((option) => ({
      ...option,
      selected: option.label === selectedLabel,
    }));
  }
  if (record.semanticAction?.kind === "type" && target.form !== undefined) {
    target.form.hasValue = true;
  }
  return target;
}
