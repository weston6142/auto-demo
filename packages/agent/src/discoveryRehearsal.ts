import { randomUUID } from "node:crypto";
import type {
  DiscoveryAction,
  DiscoveryAttempt,
  DiscoveryConfidence,
  DiscoveryExpectation,
  DiscoveryInteractiveTarget,
  DiscoveryObservation,
  DiscoveryObservedEffect,
  DiscoverySessionV1,
} from "./discoveryContract.js";
import type {
  DiscoveryObservationDiagnostic,
  DiscoveryObservationExtractionResult,
} from "./discoveryObservation.js";
import type {
  DiscoveryBlockedNetworkEvidence,
  DiscoveryNetworkDiagnostic,
} from "./discoveryNetworkClassification.js";
import {
  abandonDiscoverySession,
  beginDiscoveryAttempt,
  completeDiscoverySession,
  createDiscoverySession,
  failDiscoverySession,
  finishDiscoveryAttempt,
  recordDiscoveryObservation,
  selectDiscoveryPath,
  type CreateDiscoverySessionInput,
} from "./discoverySession.js";
import { matchesNavigationExpectation } from "./discoveryValidation.js";

export type DiscoveryRehearsalStartInput = Omit<CreateDiscoverySessionInput, "createdAt">;

export type DiscoveryActionAuthorization<TPermit> =
  | { decision: "allow"; permit: TPermit }
  | { decision: "block"; reason: { code: string; summary: string } };

export interface DiscoveryActionAuthorizer<TPermit> {
  authorize(input: {
    session: DiscoverySessionV1;
    observation: DiscoveryObservation;
    action: DiscoveryAction;
    target?: DiscoveryInteractiveTarget;
  }): Promise<DiscoveryActionAuthorization<TPermit>>;
}

export interface DiscoveryInputResolver {
  resolve(
    inputBinding: string,
  ): Promise<
    { ok: true; value: string } | { ok: false; code: "input_binding_unavailable"; summary: string }
  >;
}

export type DiscoveryRehearsalDriverResult =
  | {
      ok: true;
      code: string;
      summary: string;
      blockedNetworkEvidence?: DiscoveryBlockedNetworkEvidence;
    }
  | {
      ok: false;
      code: string;
      summary: string;
      recoverable: boolean;
      blockedNetworkEvidence?: DiscoveryBlockedNetworkEvidence;
    };

export type DiscoveryRehearsalDiagnostic =
  DiscoveryObservationDiagnostic | DiscoveryNetworkDiagnostic;

export interface DiscoveryRehearsalDriver<TPermit> {
  observe(): Promise<DiscoveryObservationExtractionResult>;
  hasLiveTarget(targetId: string): Promise<boolean>;
  execute(input: {
    action: DiscoveryAction;
    permit: TPermit;
    resolvedValue?: string;
  }): Promise<DiscoveryRehearsalDriverResult>;
  isAvailable(): Promise<boolean>;
}

export type DiscoveryRehearsalActionInput = {
  action: DiscoveryAction;
  expectations: DiscoveryExpectation[];
  confidence: DiscoveryConfidence;
  retryOfAttemptId?: string;
};

export type DiscoveryRehearsalStopInput =
  | {
      outcome: "complete";
      attemptIds: string[];
      source: "host-agent" | "user-directed";
    }
  | { outcome: "abandon"; reason: { code: string; summary: string } };

export type DiscoveryRehearsalError = {
  code: string;
  message: string;
  path?: string;
  recordId?: string;
};

export type DiscoveryRehearsalResult =
  | {
      ok: true;
      session: DiscoverySessionV1;
      observation?: DiscoveryObservation;
      attempt?: DiscoveryAttempt;
      diagnostics: DiscoveryRehearsalDiagnostic[];
    }
  | { ok: false; session?: DiscoverySessionV1; errors: DiscoveryRehearsalError[] };

export type DiscoveryRehearsalControllerDependencies<TPermit> = {
  driver: DiscoveryRehearsalDriver<TPermit>;
  authorizer: DiscoveryActionAuthorizer<TPermit>;
  inputResolver: DiscoveryInputResolver;
  driverFailureOutcome?: (
    result: Extract<DiscoveryRehearsalDriverResult, { ok: false }>,
  ) => { code: string; summary: string } | undefined;
  clock?: () => string;
  idGenerator?: () => string;
};

const latestObservation = (session: DiscoverySessionV1) => session.observations.at(-1);

const normalizePublicCondition = (value: string) => value.trim().replace(/\s+/g, " ");

function evaluateExpectations(
  expectations: DiscoveryExpectation[],
  observation: DiscoveryObservation,
): DiscoveryObservedEffect[] {
  return expectations.map((expectation) => {
    const matched =
      expectation.kind === "navigation"
        ? matchesNavigationExpectation(expectation, observation.page.url)
        : expectation.targetId !== undefined
          ? observation.visibleStates.some((state) => state.id === expectation.targetId) ||
            observation.interactiveTargets.some((target) => target.id === expectation.targetId)
          : expectation.publicCondition !== undefined &&
            [
              ...observation.visibleStates.map((state) => state.summary),
              ...observation.interactiveTargets.map((target) => target.label),
            ].some(
              (value) =>
                normalizePublicCondition(value) ===
                normalizePublicCondition(expectation.publicCondition!),
            );
    return {
      expectationId: expectation.id,
      status: matched ? "matched" : "not-matched",
      observationId: observation.id,
      summary: matched
        ? "Expected page evidence matched."
        : "Expected page evidence did not match.",
    };
  });
}

export function createDiscoveryRehearsalController<TPermit>(
  dependencies: DiscoveryRehearsalControllerDependencies<TPermit>,
) {
  const clock = dependencies.clock ?? (() => new Date().toISOString());
  let current: DiscoverySessionV1 | undefined;
  let busy = false;

  const getSession = () => (current === undefined ? undefined : structuredClone(current));

  const start = async (input: DiscoveryRehearsalStartInput): Promise<DiscoveryRehearsalResult> => {
    if (busy) {
      return {
        ok: false,
        errors: [{ code: "discovery_controller_busy", message: "Discovery controller is busy." }],
      };
    }
    if (current !== undefined) {
      return {
        ok: false,
        session: getSession(),
        errors: [
          {
            code: "discovery_controller_already_started",
            message: "Discovery controller already started.",
          },
        ],
      };
    }
    busy = true;
    try {
      const created = createDiscoverySession({ ...input, createdAt: clock() });
      if (!created.ok) return { ok: false, errors: created.errors };
      let observed: DiscoveryObservationExtractionResult;
      try {
        observed = await dependencies.driver.observe();
      } catch {
        return {
          ok: false,
          errors: [
            {
              code: "page_evaluation_failed",
              message: "Initial discovery observation failed.",
            },
          ],
        };
      }
      if (!observed.ok) return { ok: false, errors: observed.errors };
      const recorded = recordDiscoveryObservation(created.session, observed.observation);
      if (!recorded.ok) return { ok: false, errors: recorded.errors };
      current = recorded.session;
      const observation = current.observations.at(-1);
      return {
        ok: true,
        session: structuredClone(current),
        ...(observation === undefined ? {} : { observation: structuredClone(observation) }),
        diagnostics: observed.diagnostics,
      };
    } finally {
      busy = false;
    }
  };

  const finalizeFailedAttempt = (
    attemptId: string,
    code: string,
    summary: string,
  ): DiscoveryRehearsalResult => {
    const finished = finishDiscoveryAttempt(current!, attemptId, {
      status: "failed",
      finishedAt: clock(),
      derivedExpectations: [],
      observedEffects: [],
      outcome: { code, summary },
    });
    if (!finished.ok) return { ok: false, session: getSession(), errors: finished.errors };
    current = finished.session;
    return {
      ok: true,
      session: structuredClone(current),
      attempt: structuredClone(current.attempts.at(-1)!),
      diagnostics: [],
    };
  };

  const failForUnavailableBrowser = (attemptId: string): DiscoveryRehearsalResult => {
    const finalized = finishDiscoveryAttempt(current!, attemptId, {
      status: "failed",
      finishedAt: clock(),
      derivedExpectations: [],
      observedEffects: [],
      outcome: {
        code: "browser_unavailable",
        summary: "Discovery browser is unavailable.",
      },
    });
    if (!finalized.ok) return { ok: false, session: getSession(), errors: finalized.errors };
    current = finalized.session;
    const failed = failDiscoverySession(current, {
      failedAt: clock(),
      reason: {
        code: "browser_unavailable",
        summary: "Discovery browser is unavailable.",
      },
    });
    if (!failed.ok) {
      return {
        ok: false,
        session: structuredClone(current),
        errors: failed.errors,
      };
    }
    current = failed.session;
    return {
      ok: true,
      session: structuredClone(current),
      attempt: structuredClone(current.attempts.at(-1)!),
      diagnostics: [],
    };
  };

  const performAllowed = async (
    input: DiscoveryRehearsalActionInput,
    attemptId: string,
    permit: TPermit,
  ): Promise<DiscoveryRehearsalResult> => {
    const before = latestObservation(current!);
    if (input.action.kind === "back" && before?.page.navigation.canGoBack !== true) {
      return finalizeFailedAttempt(
        attemptId,
        "back_unavailable",
        "Discovery back navigation is unavailable.",
      );
    }
    if (input.action.kind === "click" || input.action.kind === "type") {
      let targetIsLive = false;
      try {
        targetIsLive = await dependencies.driver.hasLiveTarget(input.action.targetId);
      } catch {
        targetIsLive = false;
      }
      if (!targetIsLive) {
        const available = await dependencies.driver.isAvailable().catch(() => false);
        if (!available) return failForUnavailableBrowser(attemptId);
        return finalizeFailedAttempt(
          attemptId,
          "target_stale",
          "Discovery target is no longer live.",
        );
      }
    }

    let resolvedValue: string | undefined;
    if (input.action.kind === "type") {
      try {
        const resolved = await dependencies.inputResolver.resolve(input.action.inputBinding);
        if (!resolved.ok) {
          return finalizeFailedAttempt(
            attemptId,
            resolved.code,
            "Discovery input could not be resolved.",
          );
        }
        resolvedValue = resolved.value;
      } catch {
        return finalizeFailedAttempt(
          attemptId,
          "input_resolution_failed",
          "Discovery input could not be resolved.",
        );
      }
    }

    let executed: DiscoveryRehearsalDriverResult;
    try {
      executed = await dependencies.driver.execute({
        action: input.action,
        permit,
        ...(resolvedValue === undefined ? {} : { resolvedValue }),
      });
    } catch {
      const available = await dependencies.driver.isAvailable().catch(() => false);
      executed = {
        ok: false,
        code: "action_failed",
        summary: "Discovery action failed.",
        recoverable: available,
      };
    } finally {
      resolvedValue = undefined;
    }
    if (!executed.ok && !executed.recoverable) return failForUnavailableBrowser(attemptId);

    let observed: DiscoveryObservationExtractionResult;
    try {
      observed = await dependencies.driver.observe();
    } catch {
      const available = await dependencies.driver.isAvailable().catch(() => false);
      if (!available) return failForUnavailableBrowser(attemptId);
      return finalizeFailedAttempt(
        attemptId,
        "observation_failed",
        "Discovery result could not be observed.",
      );
    }
    if (!observed.ok) {
      if (observed.errors.some((error) => error.code === "browser_unavailable")) {
        return failForUnavailableBrowser(attemptId);
      }
      return finalizeFailedAttempt(
        attemptId,
        "observation_failed",
        "Discovery result could not be observed.",
      );
    }

    const recorded = recordDiscoveryObservation(current!, observed.observation);
    if (!recorded.ok) {
      return finalizeFailedAttempt(
        attemptId,
        "observation_failed",
        "Discovery result could not be recorded.",
      );
    }
    current = recorded.session;
    const after = latestObservation(current)!;
    const effects = evaluateExpectations(input.expectations, after);
    const matched = effects.every((effect) => effect.status === "matched");
    const networkDiagnostics: DiscoveryNetworkDiagnostic[] =
      executed.blockedNetworkEvidence === undefined
        ? []
        : [
            {
              code: "network_requests_blocked",
              ...structuredClone(executed.blockedNetworkEvidence),
              expectedVisibleEffectPrevented:
                input.expectations.length > 0 &&
                effects.some((effect) => effect.status !== "matched"),
            },
          ];
    let driverFailureOutcome: { code: string; summary: string } | undefined;
    if (!executed.ok) {
      try {
        driverFailureOutcome = dependencies.driverFailureOutcome?.(executed);
      } catch {
        driverFailureOutcome = undefined;
      }
    }
    const finished = finishDiscoveryAttempt(current, attemptId, {
      status: executed.ok && matched ? "succeeded" : "failed",
      finishedAt: clock(),
      derivedExpectations: [],
      observedEffects: effects,
      afterObservationId: after.id,
      outcome:
        executed.ok && matched
          ? { code: "action_completed", summary: "Discovery action completed." }
          : !executed.ok
            ? (driverFailureOutcome ?? {
                code: "action_failed",
                summary: "Discovery action failed.",
              })
            : {
                code: "expectation_unmatched",
                summary: "Discovery expectation did not match.",
              },
    });
    if (!finished.ok) return { ok: false, session: getSession(), errors: finished.errors };
    current = finished.session;
    return {
      ok: true,
      session: structuredClone(current),
      observation: structuredClone(after),
      attempt: structuredClone(current.attempts.at(-1)!),
      diagnostics: [...observed.diagnostics, ...networkDiagnostics],
    };
  };

  const perform = async (
    input: DiscoveryRehearsalActionInput,
  ): Promise<DiscoveryRehearsalResult> => {
    if (busy) {
      return {
        ok: false,
        session: getSession(),
        errors: [{ code: "discovery_controller_busy", message: "Discovery controller is busy." }],
      };
    }
    if (current === undefined) {
      return {
        ok: false,
        errors: [
          {
            code: "discovery_controller_not_started",
            message: "Discovery controller is not started.",
          },
        ],
      };
    }
    if (current.status !== "active") {
      return {
        ok: false,
        session: getSession(),
        errors: [{ code: "terminal_discovery_session", message: "Discovery session is terminal." }],
      };
    }
    busy = true;
    try {
      const before = latestObservation(current);
      if (before === undefined) {
        return {
          ok: false,
          session: getSession(),
          errors: [
            {
              code: "invalid_discovery_rehearsal_input",
              message: "Discovery observation is missing.",
            },
          ],
        };
      }
      const attemptId = dependencies.idGenerator?.() ?? `attempt-${randomUUID()}`;
      const prepared = beginDiscoveryAttempt(current, {
        id: attemptId,
        startedAt: clock(),
        beforeObservationId: before.id,
        action: input.action,
        expectations: input.expectations,
        confidence: input.confidence,
        ...(input.retryOfAttemptId === undefined
          ? {}
          : { retryOfAttemptId: input.retryOfAttemptId }),
      });
      if (!prepared.ok) return { ok: false, session: getSession(), errors: prepared.errors };
      const preparedAttempt = prepared.session.attempts.at(-1);
      if (preparedAttempt === undefined || preparedAttempt.status !== "pending") {
        return {
          ok: false,
          session: getSession(),
          errors: [
            {
              code: "invalid_discovery_rehearsal_input",
              message: "Discovery attempt could not be prepared.",
            },
          ],
        };
      }
      const preparedInput: DiscoveryRehearsalActionInput = {
        action: preparedAttempt.action,
        expectations: preparedAttempt.expectations,
        confidence: preparedAttempt.confidence,
        ...(preparedAttempt.retryOfAttemptId === undefined
          ? {}
          : { retryOfAttemptId: preparedAttempt.retryOfAttemptId }),
      };
      const targetId =
        preparedInput.action.kind === "click" || preparedInput.action.kind === "type"
          ? preparedInput.action.targetId
          : undefined;
      const target =
        targetId === undefined
          ? undefined
          : before.interactiveTargets.find((candidate) => candidate.id === targetId);
      let authorization: DiscoveryActionAuthorization<TPermit>;
      try {
        authorization = await dependencies.authorizer.authorize({
          session: structuredClone(current),
          observation: structuredClone(before),
          action: structuredClone(preparedInput.action),
          ...(target === undefined ? {} : { target: structuredClone(target) }),
        });
      } catch {
        return {
          ok: false,
          session: getSession(),
          errors: [
            {
              code: "discovery_authorization_failed",
              message: "Discovery action authorization failed.",
            },
          ],
        };
      }

      current = prepared.session;

      if (authorization.decision === "block") {
        const finished = finishDiscoveryAttempt(current, attemptId, {
          status: "blocked",
          finishedAt: clock(),
          derivedExpectations: [],
          observedEffects: [],
          outcome: authorization.reason,
        });
        if (!finished.ok) return { ok: false, session: getSession(), errors: finished.errors };
        current = finished.session;
        return {
          ok: true,
          session: structuredClone(current),
          attempt: structuredClone(current.attempts.at(-1)!),
          diagnostics: [],
        };
      }
      return await performAllowed(preparedInput, attemptId, authorization.permit);
    } finally {
      busy = false;
    }
  };

  const stop = async (input: DiscoveryRehearsalStopInput): Promise<DiscoveryRehearsalResult> => {
    if (busy) {
      return {
        ok: false,
        session: getSession(),
        errors: [{ code: "discovery_controller_busy", message: "Discovery controller is busy." }],
      };
    }
    if (current === undefined) {
      return {
        ok: false,
        errors: [
          {
            code: "discovery_controller_not_started",
            message: "Discovery controller is not started.",
          },
        ],
      };
    }
    if (current.status !== "active") {
      return {
        ok: false,
        session: getSession(),
        errors: [{ code: "terminal_discovery_session", message: "Discovery session is terminal." }],
      };
    }
    busy = true;
    try {
      if (input.outcome === "abandon") {
        const abandoned = abandonDiscoverySession(current, {
          abandonedAt: clock(),
          reason: input.reason,
        });
        if (!abandoned.ok) {
          return { ok: false, session: getSession(), errors: abandoned.errors };
        }
        current = abandoned.session;
        return { ok: true, session: structuredClone(current), diagnostics: [] };
      }

      const selected = selectDiscoveryPath(current, {
        attemptIds: input.attemptIds,
        selectedAt: clock(),
        source: input.source,
      });
      if (!selected.ok) return { ok: false, session: getSession(), errors: selected.errors };
      const completed = completeDiscoverySession(selected.session, { completedAt: clock() });
      if (!completed.ok) {
        return { ok: false, session: getSession(), errors: completed.errors };
      }
      current = completed.session;
      return { ok: true, session: structuredClone(current), diagnostics: [] };
    } finally {
      busy = false;
    }
  };

  return { start, perform, stop, getSession };
}
