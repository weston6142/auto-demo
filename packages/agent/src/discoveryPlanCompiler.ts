import { createHash } from "node:crypto";
import type {
  DiscoveryAction,
  DiscoveryExpectation,
  DiscoveryInteractiveTarget,
  DiscoveryObservation,
  DiscoverySessionV1,
  FinalizedDiscoveryAttempt,
  WalkthroughPlan,
  WalkthroughPlanAssertion,
  WalkthroughPlanStep,
  WalkthroughPlanStepProvenance,
  WalkthroughPlanTargetHint,
} from "./index.js";
import { validateDiscoverySession } from "./discoveryValidation.js";
import {
  isWalkthroughPlan,
  sanitizeWalkthroughText,
  sanitizeWalkthroughUrl,
} from "./walkthroughValidation.js";

export type DiscoveryPlanCompilationErrorCode =
  | "invalid_discovery_session"
  | "incomplete_discovery_session"
  | "missing_selected_path"
  | "missing_compilation_reference"
  | "unsupported_compilation_action"
  | "unsafe_compilation_content"
  | "invalid_compiled_plan";

export type DiscoveryPlanCompilationError = {
  code: DiscoveryPlanCompilationErrorCode;
  message: string;
  attemptId?: string;
  expectationId?: string;
};

export type CompileDiscoverySessionOptions = { mode?: "validate-first" };
export type CompileDiscoverySessionResult =
  { ok: true; plan: WalkthroughPlan } | { ok: false; errors: DiscoveryPlanCompilationError[] };

type UnnumberedStep = Omit<WalkthroughPlanStep, "id" | "order">;

class CompilationFailure extends Error {
  constructor(readonly error: DiscoveryPlanCompilationError) {
    super(error.code);
  }
}

export function compileDiscoverySessionToWalkthroughPlan(
  value: unknown,
  options: CompileDiscoverySessionOptions = {},
): CompileDiscoverySessionResult {
  if (options.mode !== undefined && options.mode !== "validate-first") {
    return failure("invalid_compiled_plan", "Discovery plans require validate-first mode.");
  }
  const validated = validateDiscoverySession(value);
  if (!validated.ok) {
    return failure(
      "invalid_discovery_session",
      "Discovery plan compilation requires a valid session.",
    );
  }
  try {
    return compileValidatedSession(validated.session);
  } catch (error) {
    if (error instanceof CompilationFailure) return { ok: false, errors: [error.error] };
    return failure("invalid_compiled_plan", "Discovery plan compilation failed safely.");
  }
}

function compileValidatedSession(session: DiscoverySessionV1): CompileDiscoverySessionResult {
  if (session.status !== "completed" || session.terminal?.status !== "completed") {
    return failure(
      "incomplete_discovery_session",
      "Discovery plan compilation requires a completed session.",
    );
  }
  if (session.selectedPath === undefined || session.selectedPath.attemptIds.length === 0) {
    return failure("missing_selected_path", "Discovery plan compilation requires a selected path.");
  }

  const observations = new Map(
    session.observations.map((observation) => [observation.id, observation]),
  );
  const attempts = new Map(session.attempts.map((attempt) => [attempt.id, attempt]));
  const selected = session.selectedPath.attemptIds.map((attemptId) => {
    const attempt = attempts.get(attemptId);
    if (attempt === undefined || attempt.status !== "succeeded") {
      throw referenceFailure(attemptId);
    }
    return attempt;
  });
  const firstBefore = observations.get(selected[0].beforeObservationId);
  if (firstBefore === undefined) throw referenceFailure(selected[0].id);

  const unnumbered: UnnumberedStep[] = [];
  let normalized = false;
  for (const attempt of selected) {
    const before = observations.get(attempt.beforeObservationId);
    const after =
      attempt.afterObservationId === undefined
        ? undefined
        : observations.get(attempt.afterObservationId);
    if (before === undefined || after === undefined) throw referenceFailure(attempt.id);

    const action = compileAction(session, attempt, before, after);
    if (action !== undefined) unnumbered.push(action);
    if (
      attempt.action.kind === "inspect" ||
      attempt.action.kind === "back" ||
      attempt.action.kind === "refresh"
    ) {
      normalized = true;
    }
    for (const expectation of [...attempt.expectations, ...attempt.derivedExpectations]) {
      const effect = attempt.observedEffects.find(
        (candidate) =>
          candidate.expectationId === expectation.id &&
          candidate.status === "matched" &&
          candidate.observationId === after.id,
      );
      if (effect === undefined) throw referenceFailure(attempt.id, expectation.id);
      unnumbered.push(compileAssertion(session, attempt, expectation, after));
    }
  }

  const steps = unnumbered.map((step, index): WalkthroughPlanStep => ({
    ...step,
    id: `step-${index + 1}`,
    order: index + 1,
  }));
  const targetUrl = sanitizeWalkthroughUrl(firstBefore.page.url);
  const selectedPathFingerprint = sha256({
    attemptIds: selected.map((attempt) => attempt.id),
    attempts: selected.map((attempt) =>
      selectedAttemptFingerprintProjection(session, attempt, observations),
    ),
  });
  const planHash = sha256({ target: targetUrl, mode: "validate-first", steps })
    .slice("sha256:".length)
    .slice(0, 12);
  const plan: WalkthroughPlan = {
    id: `plan-${planHash}`,
    target: { kind: "browser", url: targetUrl },
    ...(session.launchProfile === undefined
      ? {}
      : { launchProfile: structuredClone(session.launchProfile) }),
    mode: "validate-first",
    state: "draft",
    source: {
      parser: "discovery-v1",
      script: steps.map((step) => step.sourceText).join(" "),
      discovery: { schemaVersion: 1, sessionId: session.id, selectedPathFingerprint },
    },
    steps,
    questions: [],
    approvals: { required: true, approved: false },
    execution: { status: "not-started" },
    warnings: normalized
      ? [
          {
            code: "normalized_discovery_action",
            message: "Discovery-only actions were normalized for deterministic walkthrough replay.",
          },
        ]
      : [],
  };
  if (!isWalkthroughPlan(plan)) {
    return failure("invalid_compiled_plan", "Discovery plan compilation produced an invalid plan.");
  }
  return { ok: true, plan };
}

function selectedAttemptFingerprintProjection(
  session: DiscoverySessionV1,
  attempt: FinalizedDiscoveryAttempt,
  observations: Map<string, DiscoveryObservation>,
): unknown {
  const before = observations.get(attempt.beforeObservationId);
  const after =
    attempt.afterObservationId === undefined
      ? undefined
      : observations.get(attempt.afterObservationId);
  if (before === undefined || after === undefined) throw referenceFailure(attempt.id);
  const compiledAction = compileAction(session, attempt, before, after);
  return {
    id: attempt.id,
    action:
      compiledAction === undefined
        ? { kind: "inspect" }
        : {
            kind: attempt.action.kind,
            action: compiledAction.action,
            targetHint: compiledAction.targetHint ?? null,
            navigationUrl: compiledAction.navigationUrl ?? null,
            inputBinding: compiledAction.inputBinding ?? null,
            waitDurationMs: compiledAction.waitDurationMs ?? null,
            normalizedFrom: compiledAction.provenance?.normalizedFrom ?? null,
          },
    expectations: [...attempt.expectations, ...attempt.derivedExpectations],
    matchedEffects: [...attempt.expectations, ...attempt.derivedExpectations].map((expectation) => {
      const effect = attempt.observedEffects.find(
        (candidate) =>
          candidate.expectationId === expectation.id &&
          candidate.status === "matched" &&
          candidate.observationId === after.id,
      );
      if (effect === undefined) throw referenceFailure(attempt.id, expectation.id);
      return { expectationId: effect.expectationId, observationId: effect.observationId };
    }),
  };
}

function compileAction(
  session: DiscoverySessionV1,
  attempt: FinalizedDiscoveryAttempt,
  before: DiscoveryObservation,
  after: DiscoveryObservation,
): UnnumberedStep | undefined {
  const provenance = baseProvenance(session, attempt);
  switch (attempt.action.kind) {
    case "navigate":
      return navigationStep(attempt.action.url, provenance);
    case "click":
      return targetStep("click", actionTarget(before, attempt.action, attempt.id), provenance);
    case "type":
      return {
        ...targetStep("type", actionTarget(before, attempt.action, attempt.id), provenance),
        inputBinding: attempt.action.inputBinding,
      };
    case "select":
      return {
        ...targetStep("select", actionTarget(before, attempt.action, attempt.id), provenance),
        optionLabel: sanitizeWalkthroughText(attempt.action.optionLabel),
      };
    case "wait":
      return {
        action: "wait",
        resolution: "resolved",
        sourceText: `Wait ${attempt.action.durationMs} milliseconds.`,
        public: { summary: `Wait ${attempt.action.durationMs} milliseconds.` },
        waitDurationMs: attempt.action.durationMs,
        provenance,
      };
    case "back":
    case "refresh":
      return navigationStep(after.page.url, {
        ...provenance,
        normalizedFrom: attempt.action.kind,
      });
    case "inspect":
      return undefined;
    default:
      return unsupportedAction(attempt.action);
  }
}

function compileAssertion(
  session: DiscoverySessionV1,
  attempt: FinalizedDiscoveryAttempt,
  expectation: DiscoveryExpectation,
  after: DiscoveryObservation,
): UnnumberedStep {
  if (expectation.kind === "control-state") {
    const target = after.interactiveTargets.find(
      (candidate) => candidate.id === expectation.targetId,
    );
    if (target === undefined) throw referenceFailure(attempt.id, expectation.id);
    const targetHint = accessibleTarget(target);
    return {
      ...assertionStep(
        { kind: "control-state", target: targetHint, state: structuredClone(expectation.state) },
        `Verify ${targetHint.label} form state.`,
        {
          ...baseProvenance(session, attempt),
          expectationId: expectation.id,
          expectationOrigin: expectation.origin,
        },
      ),
      targetHint,
    };
  }
  const provenance: WalkthroughPlanStepProvenance = {
    ...baseProvenance(session, attempt),
    expectationId: expectation.id,
    expectationOrigin: expectation.origin,
    ...(attempt.action.kind === "inspect" ? { normalizedFrom: "inspect" } : {}),
  };
  if (expectation.kind === "navigation") {
    const url = sanitizeWalkthroughUrl(expectation.url);
    return assertionStep(
      { kind: "navigation", url, match: expectation.match },
      `Verify destination ${url}.`,
      provenance,
    );
  }
  const target = visibleTarget(expectation, after, attempt.id);
  const assertion: WalkthroughPlanAssertion = {
    kind: "visible-state",
    condition: target.label,
    ...(target.role === undefined ? {} : { role: target.role }),
    ...(target.occurrence === undefined ? {} : { occurrence: target.occurrence }),
  };
  return {
    ...assertionStep(assertion, `Verify ${target.label}.`, provenance),
    targetHint: target,
  };
}

function navigationStep(value: string, provenance: WalkthroughPlanStepProvenance): UnnumberedStep {
  const url = sanitizeWalkthroughUrl(value);
  const summary = `Navigate to ${url}.`;
  return {
    action: "navigate",
    resolution: "resolved",
    sourceText: summary,
    public: { summary },
    navigationUrl: url,
    provenance,
  };
}

function targetStep(
  action: "click" | "type" | "select",
  targetHint: WalkthroughPlanTargetHint,
  provenance: WalkthroughPlanStepProvenance,
): UnnumberedStep {
  const summary =
    action === "click"
      ? `Click ${targetHint.label}.`
      : action === "type"
        ? `Type [redacted] into ${targetHint.label}.`
        : `Select an option in ${targetHint.label}.`;
  return {
    action,
    resolution: "resolved",
    sourceText: summary,
    public: { summary },
    targetHint,
    provenance,
  };
}

function assertionStep(
  assertion: WalkthroughPlanAssertion,
  summary: string,
  provenance: WalkthroughPlanStepProvenance,
): UnnumberedStep {
  return {
    action: "assert",
    resolution: "resolved",
    sourceText: sanitizeWalkthroughText(summary),
    public: { summary: sanitizeWalkthroughText(summary) },
    assertion,
    provenance,
  };
}

function actionTarget(
  observation: DiscoveryObservation,
  action: Extract<DiscoveryAction, { kind: "click" | "type" | "select" }>,
  attemptId: string,
): WalkthroughPlanTargetHint {
  const target = observation.interactiveTargets.find(
    (candidate) => candidate.id === action.targetId,
  );
  if (target === undefined) throw referenceFailure(attemptId);
  return accessibleTarget(target);
}

function visibleTarget(
  expectation: Extract<DiscoveryExpectation, { kind: "visible-state" }>,
  observation: DiscoveryObservation,
  attemptId: string,
): WalkthroughPlanTargetHint {
  if (expectation.publicCondition !== undefined) {
    return {
      kind: "accessible",
      label: sanitizeWalkthroughText(expectation.publicCondition),
      ...(expectation.role === undefined
        ? {}
        : { role: sanitizeWalkthroughText(expectation.role) }),
    };
  }
  const interactive = observation.interactiveTargets.find(
    (candidate) => candidate.id === expectation.targetId,
  );
  if (interactive !== undefined) return accessibleTarget(interactive);
  const visible = observation.visibleStates.find(
    (candidate) => candidate.id === expectation.targetId,
  );
  if (visible !== undefined) {
    return { kind: "accessible", label: sanitizeWalkthroughText(visible.summary) };
  }
  throw referenceFailure(attemptId, expectation.id);
}

function accessibleTarget(target: DiscoveryInteractiveTarget): WalkthroughPlanTargetHint {
  return {
    kind: "accessible",
    label: sanitizeWalkthroughText(target.label),
    ...(target.role === undefined ? {} : { role: sanitizeWalkthroughText(target.role) }),
    ...(target.occurrence === undefined ? {} : { occurrence: target.occurrence }),
    ...(target.structure === undefined ? {} : { structure: structuredClone(target.structure) }),
  };
}

function baseProvenance(
  session: DiscoverySessionV1,
  attempt: FinalizedDiscoveryAttempt,
): WalkthroughPlanStepProvenance {
  return { kind: "discovery", sessionId: session.id, attemptId: attempt.id };
}

function unsupportedAction(action: DiscoveryAction): never {
  void action;
  throw new CompilationFailure({
    code: "unsupported_compilation_action",
    message: "Discovery plan compilation encountered an unsupported action.",
  });
}

function referenceFailure(attemptId: string, expectationId?: string): CompilationFailure {
  return new CompilationFailure({
    code: "missing_compilation_reference",
    message: "Discovery plan compilation is missing required selected-path evidence.",
    attemptId,
    ...(expectationId === undefined ? {} : { expectationId }),
  });
}

function failure(
  code: DiscoveryPlanCompilationErrorCode,
  message: string,
): { ok: false; errors: DiscoveryPlanCompilationError[] } {
  return { ok: false, errors: [{ code, message }] };
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}
