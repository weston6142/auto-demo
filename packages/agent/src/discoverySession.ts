import {
  browserLaunchProfileId,
  validateBrowserLaunchProfile,
  type BrowserLaunchProfileV1,
} from "@auto-demo/browser-profile";
import {
  DISCOVERY_LIMITS,
  DISCOVERY_SCHEMA_VERSION,
  type DiscoveryContractResult,
  type DiscoveryExpectation,
  type DiscoveryHostProvenance,
  type DiscoveryObservation,
  type DiscoveryObservedEffect,
  type DiscoverySelectedPath,
  type FinalizedDiscoveryAttempt,
  type PendingDiscoveryAttempt,
  type DiscoverySessionV1,
} from "./discoveryContract.js";
import {
  discoveryError,
  finalizeAttemptInput,
  hasOnlyKeys,
  isNormalizedIsoTime,
  isRecord,
  isSafeDiscoveryId,
  sanitizeObservationInput,
  sanitizeAttemptInput,
  sanitizeDiscoveryText,
  sanitizeDiscoveryUrl,
  serializedDiscoveryBytes,
  validateSelectedPath,
  validateDiscoverySession,
} from "./discoveryValidation.js";

export type CreateDiscoverySessionInput = {
  id: string;
  target: { kind: "browser"; startUrl: string };
  goal: string;
  host: DiscoveryHostProvenance;
  launchProfile?: BrowserLaunchProfileV1;
  parentSessionId?: string;
  createdAt: string;
};

export function createDiscoverySession(
  input: CreateDiscoverySessionInput,
): DiscoveryContractResult {
  if (
    !isRecord(input) ||
    !hasOnlyKeys(input, [
      "id",
      "target",
      "goal",
      "host",
      "launchProfile",
      "parentSessionId",
      "createdAt",
    ]) ||
    !isRecord(input.target) ||
    !hasOnlyKeys(input.target, ["kind", "startUrl"]) ||
    input.target.kind !== "browser" ||
    typeof input.target.startUrl !== "string" ||
    !isRecord(input.host) ||
    !hasOnlyKeys(input.host, ["name", "version", "model"]) ||
    typeof input.goal !== "string" ||
    typeof input.host.name !== "string" ||
    typeof input.host.version !== "string" ||
    (input.host.model !== undefined && typeof input.host.model !== "string")
  ) {
    return {
      ok: false,
      errors: [discoveryError("invalid_discovery_input", "Discovery session input is invalid.")],
    };
  }

  const launchProfileValidation =
    input.launchProfile === undefined
      ? undefined
      : validateBrowserLaunchProfile(input.launchProfile);
  if (launchProfileValidation !== undefined && !launchProfileValidation.ok) {
    return {
      ok: false,
      errors: [discoveryError("invalid_discovery_input", "Discovery launch profile is invalid.")],
    };
  }

  const startUrl = sanitizeDiscoveryUrl(input.target.startUrl);
  const hostValues = [input.host.name, input.host.version, input.host.model].filter(
    (value): value is string => value !== undefined,
  );
  if (
    input.id.length > DISCOVERY_LIMITS.identifierCharacters ||
    (input.parentSessionId !== undefined &&
      input.parentSessionId.length > DISCOVERY_LIMITS.identifierCharacters) ||
    input.target.startUrl.length > DISCOVERY_LIMITS.publicStringCharacters ||
    input.goal.length > DISCOVERY_LIMITS.publicStringCharacters ||
    hostValues.some((value) => value.length > DISCOVERY_LIMITS.identifierCharacters)
  ) {
    return {
      ok: false,
      errors: [discoveryError("session_limit_exceeded", "Discovery public text is too long.")],
    };
  }

  const goal = sanitizeDiscoveryText(input.goal);
  const hostName = sanitizeDiscoveryText(input.host.name);
  const hostVersion = sanitizeDiscoveryText(input.host.version);
  const hostModel =
    input.host.model === undefined ? undefined : sanitizeDiscoveryText(input.host.model);
  if (
    !isSafeDiscoveryId(input.id) ||
    (input.parentSessionId !== undefined && !isSafeDiscoveryId(input.parentSessionId)) ||
    !isNormalizedIsoTime(input.createdAt) ||
    startUrl === undefined ||
    goal.length === 0 ||
    hostName.length === 0 ||
    hostVersion.length === 0 ||
    (input.host.model !== undefined && hostModel?.length === 0)
  ) {
    return {
      ok: false,
      errors: [discoveryError("invalid_discovery_input", "Discovery session input is invalid.")],
    };
  }

  return validateDiscoverySession({
    schemaVersion: DISCOVERY_SCHEMA_VERSION,
    id: input.id,
    status: "active",
    target: { kind: "browser", startUrl },
    goal,
    host: {
      name: hostName,
      version: hostVersion,
      ...(hostModel === undefined ? {} : { model: hostModel }),
    },
    ...(launchProfileValidation?.ok === true
      ? { launchProfile: launchProfileValidation.profile }
      : {}),
    ...(input.parentSessionId === undefined ? {} : { parentSessionId: input.parentSessionId }),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    observations: [],
    attempts: [],
  });
}

export type RecordDiscoveryObservationInput = Omit<DiscoveryObservation, "sequence">;

export type BeginDiscoveryAttemptInput = Omit<PendingDiscoveryAttempt, "sequence" | "status">;

export type FinishDiscoveryAttemptInput = {
  status: FinalizedDiscoveryAttempt["status"];
  finishedAt: string;
  derivedExpectations: DiscoveryExpectation[];
  observedEffects: DiscoveryObservedEffect[];
  afterObservationId?: string;
  outcome: FinalizedDiscoveryAttempt["outcome"];
};

function requireActiveSession(session: DiscoverySessionV1): DiscoveryContractResult {
  const validated = validateDiscoverySession(session);
  if (!validated.ok) return validated;
  if (validated.session.status !== "active") {
    return {
      ok: false,
      errors: [discoveryError("terminal_discovery_session", "Discovery session is terminal.")],
    };
  }
  return validated;
}

function limitError(message: string): DiscoveryContractResult {
  return { ok: false, errors: [discoveryError("session_limit_exceeded", message)] };
}

function invalidInputError(message: string): DiscoveryContractResult {
  return { ok: false, errors: [discoveryError("invalid_discovery_input", message)] };
}

function validateCandidate(session: DiscoverySessionV1): DiscoveryContractResult {
  if (
    serializedDiscoveryBytes(session) >
    DISCOVERY_LIMITS.serializedBytes - DISCOVERY_LIMITS.terminalReserveBytes
  ) {
    return limitError("Discovery evidence size limit reached.");
  }
  return validateDiscoverySession(session);
}

function validateFullCandidate(session: DiscoverySessionV1): DiscoveryContractResult {
  if (serializedDiscoveryBytes(session) > DISCOVERY_LIMITS.serializedBytes) {
    return limitError("Discovery session is too large.");
  }
  return validateDiscoverySession(session);
}

export function recordDiscoveryObservation(
  session: DiscoverySessionV1,
  input: RecordDiscoveryObservationInput,
): DiscoveryContractResult {
  const active = requireActiveSession(session);
  if (!active.ok) return active;
  if (!isRecord(input)) return invalidInputError("Observation input is invalid.");
  if (session.observations.some((observation) => observation.id === input.id)) {
    return {
      ok: false,
      errors: [
        discoveryError("duplicate_discovery_record", "Observation id already exists.", {
          recordId: isSafeDiscoveryId(input.id) ? input.id : undefined,
        }),
      ],
    };
  }
  if (session.observations.length >= DISCOVERY_LIMITS.observations) {
    return limitError("Observation limit reached.");
  }
  const observation = sanitizeObservationInput(input, session.observations.length + 1);
  if (Array.isArray(observation)) return { ok: false, errors: observation };
  if (observation.observedAt < session.updatedAt) {
    return {
      ok: false,
      errors: [
        discoveryError("invalid_discovery_transition", "Observation time moves backward.", {
          path: "observedAt",
        }),
      ],
    };
  }
  return validateCandidate({
    ...structuredClone(session),
    updatedAt: observation.observedAt,
    observations: [...session.observations, observation],
  });
}

export function beginDiscoveryAttempt(
  session: DiscoverySessionV1,
  input: BeginDiscoveryAttemptInput,
): DiscoveryContractResult {
  const active = requireActiveSession(session);
  if (!active.ok) return active;
  if (!isRecord(input)) return invalidInputError("Attempt input is invalid.");
  if (session.attempts.some((attempt) => attempt.status === "pending")) {
    return {
      ok: false,
      errors: [
        discoveryError("pending_attempt_conflict", "A discovery attempt is already pending."),
      ],
    };
  }
  if (session.attempts.some((attempt) => attempt.id === input.id)) {
    return {
      ok: false,
      errors: [
        discoveryError("duplicate_discovery_record", "Attempt id already exists.", {
          recordId: isSafeDiscoveryId(input.id) ? input.id : undefined,
        }),
      ],
    };
  }
  if (session.attempts.length >= DISCOVERY_LIMITS.attempts) {
    return limitError("Attempt limit reached.");
  }
  const attempt = sanitizeAttemptInput(session, input, session.attempts.length + 1);
  if (Array.isArray(attempt)) return { ok: false, errors: attempt };
  if (attempt.startedAt < session.updatedAt) {
    return {
      ok: false,
      errors: [
        discoveryError("invalid_discovery_transition", "Attempt time moves backward.", {
          path: "startedAt",
        }),
      ],
    };
  }
  return validateCandidate({
    ...structuredClone(session),
    updatedAt: attempt.startedAt,
    attempts: [...session.attempts, attempt],
  });
}

export function finishDiscoveryAttempt(
  session: DiscoverySessionV1,
  attemptId: string,
  input: FinishDiscoveryAttemptInput,
): DiscoveryContractResult {
  const active = requireActiveSession(session);
  if (!active.ok) return active;
  const attemptIndex = session.attempts.findIndex((attempt) => attempt.id === attemptId);
  if (attemptIndex < 0) {
    return {
      ok: false,
      errors: [
        discoveryError("missing_discovery_reference", "Attempt does not exist.", {
          recordId: isSafeDiscoveryId(attemptId) ? attemptId : undefined,
        }),
      ],
    };
  }
  const attempt = session.attempts[attemptIndex];
  if (attempt.status !== "pending") {
    return {
      ok: false,
      errors: [
        discoveryError("pending_attempt_required", "Attempt is not pending.", {
          recordId: attempt.id,
        }),
      ],
    };
  }
  const finalized = finalizeAttemptInput(session, attempt, input);
  if (Array.isArray(finalized)) return { ok: false, errors: finalized };
  if (finalized.finishedAt < session.updatedAt) {
    return {
      ok: false,
      errors: [
        discoveryError("invalid_discovery_transition", "Attempt time moves backward.", {
          path: "finishedAt",
          recordId: attempt.id,
        }),
      ],
    };
  }
  const attempts = [...session.attempts];
  attempts[attemptIndex] = finalized;
  return validateCandidate({
    ...structuredClone(session),
    updatedAt: finalized.finishedAt,
    attempts,
  });
}

export type SelectDiscoveryPathInput = DiscoverySelectedPath;
export type CompleteDiscoverySessionInput = { completedAt: string };
export type FailDiscoverySessionInput = {
  failedAt: string;
  reason: { code: string; summary: string };
};
export type AbandonDiscoverySessionInput = {
  abandonedAt: string;
  reason: { code: string; summary: string };
};

function validateTransitionTime(session: DiscoverySessionV1, value: string, path: string) {
  if (!isNormalizedIsoTime(value) || value < session.updatedAt) {
    return discoveryError("invalid_discovery_transition", "Transition time is invalid.", {
      path,
    });
  }
  return undefined;
}

export function selectDiscoveryPath(
  session: DiscoverySessionV1,
  input: SelectDiscoveryPathInput,
): DiscoveryContractResult {
  const active = requireActiveSession(session);
  if (!active.ok) return active;
  if (session.attempts.some((attempt) => attempt.status === "pending")) {
    return {
      ok: false,
      errors: [discoveryError("pending_attempt_conflict", "A discovery attempt is pending.")],
    };
  }
  const errors = validateSelectedPath(session, input);
  if (errors.length > 0) return { ok: false, errors };
  const selectedPath = structuredClone(input);
  const timeError = validateTransitionTime(session, selectedPath.selectedAt, "selectedAt");
  if (timeError !== undefined) return { ok: false, errors: [timeError] };
  return validateFullCandidate({
    ...structuredClone(session),
    updatedAt: selectedPath.selectedAt,
    selectedPath,
  });
}

export function completeDiscoverySession(
  session: DiscoverySessionV1,
  input: CompleteDiscoverySessionInput,
): DiscoveryContractResult {
  const active = requireActiveSession(session);
  if (!active.ok) return active;
  if (
    !isRecord(input) ||
    !hasOnlyKeys(input, ["completedAt"]) ||
    typeof input.completedAt !== "string"
  ) {
    return invalidInputError("Completion input is invalid.");
  }
  if (session.selectedPath === undefined) {
    return {
      ok: false,
      errors: [discoveryError("invalid_selected_path", "Completed session requires a path.")],
    };
  }
  if (session.attempts.some((attempt) => attempt.status === "pending")) {
    return {
      ok: false,
      errors: [discoveryError("pending_attempt_conflict", "A discovery attempt is pending.")],
    };
  }
  const timeError = validateTransitionTime(session, input.completedAt, "completedAt");
  if (timeError !== undefined) return { ok: false, errors: [timeError] };
  return validateFullCandidate({
    ...structuredClone(session),
    status: "completed",
    updatedAt: input.completedAt,
    terminal: { status: "completed", completedAt: input.completedAt },
  });
}

function terminateWithReason(
  session: DiscoverySessionV1,
  status: "failed" | "abandoned",
  at: string,
  reason: { code: string; summary: string },
): DiscoveryContractResult {
  const active = requireActiveSession(session);
  if (!active.ok) return active;
  const timeError = validateTransitionTime(
    session,
    at,
    status === "failed" ? "failedAt" : "abandonedAt",
  );
  if (timeError !== undefined) return { ok: false, errors: [timeError] };
  if (
    !isRecord(reason) ||
    !hasOnlyKeys(reason, ["code", "summary"]) ||
    !isSafeDiscoveryId(reason.code) ||
    typeof reason.summary !== "string"
  ) {
    return {
      ok: false,
      errors: [discoveryError("invalid_discovery_input", "Terminal reason is invalid.")],
    };
  }
  if (reason.summary.length > DISCOVERY_LIMITS.publicStringCharacters) {
    return limitError("Terminal reason is too long.");
  }
  const summary = sanitizeDiscoveryText(reason.summary);
  if (summary.length === 0) {
    return {
      ok: false,
      errors: [discoveryError("invalid_discovery_input", "Terminal reason is empty.")],
    };
  }
  const terminal =
    status === "failed"
      ? { status: "failed" as const, failedAt: at, reason: { code: reason.code, summary } }
      : {
          status: "abandoned" as const,
          abandonedAt: at,
          reason: { code: reason.code, summary },
        };
  return validateFullCandidate({
    ...structuredClone(session),
    status,
    updatedAt: at,
    terminal,
  });
}

export function failDiscoverySession(
  session: DiscoverySessionV1,
  input: FailDiscoverySessionInput,
): DiscoveryContractResult {
  if (
    !isRecord(input) ||
    !hasOnlyKeys(input, ["failedAt", "reason"]) ||
    typeof input.failedAt !== "string" ||
    !isRecord(input.reason)
  ) {
    return invalidInputError("Failure input is invalid.");
  }
  return terminateWithReason(session, "failed", input.failedAt, input.reason);
}

export function abandonDiscoverySession(
  session: DiscoverySessionV1,
  input: AbandonDiscoverySessionInput,
): DiscoveryContractResult {
  if (
    !isRecord(input) ||
    !hasOnlyKeys(input, ["abandonedAt", "reason"]) ||
    typeof input.abandonedAt !== "string" ||
    !isRecord(input.reason)
  ) {
    return invalidInputError("Abandon input is invalid.");
  }
  return terminateWithReason(session, "abandoned", input.abandonedAt, input.reason);
}

export function createChildDiscoverySession(
  terminalSession: DiscoverySessionV1,
  input: Omit<CreateDiscoverySessionInput, "parentSessionId">,
): DiscoveryContractResult {
  const validated = validateDiscoverySession(terminalSession);
  if (!validated.ok) return validated;
  if (terminalSession.status === "active" || terminalSession.terminal === undefined) {
    return {
      ok: false,
      errors: [discoveryError("invalid_discovery_transition", "Child requires terminal parent.")],
    };
  }
  if (!isRecord(input)) return invalidInputError("Child session input is invalid.");
  if (input.id === terminalSession.id) {
    return {
      ok: false,
      errors: [discoveryError("invalid_discovery_input", "Child session id must be new.")],
    };
  }
  if (validated.session.launchProfile !== undefined) {
    const childProfile = validateBrowserLaunchProfile(input.launchProfile);
    if (
      !childProfile.ok ||
      browserLaunchProfileId(validated.session.launchProfile) !== childProfile.profileId
    ) {
      return {
        ok: false,
        errors: [
          discoveryError(
            "invalid_discovery_transition",
            "Child discovery must preserve the parent launch profile.",
          ),
        ],
      };
    }
  }
  return createDiscoverySession({ ...input, parentSessionId: terminalSession.id });
}
