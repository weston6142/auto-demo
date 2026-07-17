import { isSecretLikeValue, normalizeHttpOrigin } from "./actionSafety.js";
import {
  DISCOVERY_LIMITS,
  type DiscoverySessionV1,
} from "./discoveryContract.js";
import { compileDiscoverySessionToWalkthroughPlan } from "./discoveryPlanCompiler.js";
import {
  validateDiscoveryPolicy,
  type DiscoveryPolicy,
  type ValidatedDiscoveryPolicy,
} from "./discoveryPolicy.js";
import { validateDiscoverySession } from "./discoveryValidation.js";
import type {
  WalkthroughPlan,
  WalkthroughPlanAssertion,
  WalkthroughPlanStepAction,
  WalkthroughPlanStepProvenance,
  WalkthroughPlanTargetHint,
} from "./index.js";
import { walkthroughPlanFingerprint } from "./walkthroughApproval.js";
import type { WalkthroughPlanReview } from "./walkthroughReview.js";
import {
  isWalkthroughPlan,
  type ValidatedWalkthroughPlan,
  type WalkthroughPlanValidationCheck,
} from "./walkthroughValidation.js";

export const DISCOVERY_REPLAY_LIMITS = {
  maxRepairs: 2,
  maxAttempts: 3,
  candidates: 5,
  serializedBytes: 256_000,
} as const;

export type DiscoveryReplayMatch = {
  id: string;
  label: string;
  role?: string;
  occurrence?: number;
};

export type DiscoveryReplayBrowser = {
  open(url: string): Promise<void>;
  findMatches(target: WalkthroughPlanTargetHint): Promise<DiscoveryReplayMatch[]>;
  navigate(url: string): Promise<void>;
  click(match: DiscoveryReplayMatch): Promise<void>;
  type(match: DiscoveryReplayMatch, value: string): Promise<void>;
  wait(durationMs: number): Promise<void>;
  waitForSettled(): Promise<void>;
  assertVisible(
    assertion: Extract<WalkthroughPlanAssertion, { kind: "visible-state" }>,
  ): Promise<void>;
  assertNavigation(
    assertion: Extract<WalkthroughPlanAssertion, { kind: "navigation" }>,
  ): Promise<void>;
  inspectPage(): Promise<{ url: string }>;
  close(): Promise<void>;
};

export type DiscoveryReplayBrowserFactory = {
  create(input: { policy: DiscoveryPolicy; attempt: number }): Promise<DiscoveryReplayBrowser>;
};

export type ReplayAndRepairDiscoveryPlanInput = {
  plan: unknown;
  sourceSession: unknown;
  inputBindings?: Record<string, unknown>;
  policy?: DiscoveryPolicy;
};

export type ReplayAndRepairDiscoveryPlanOptions = {
  maxRepairs?: 0 | 1 | 2;
  now?: () => Date;
  replayIdGenerator?: () => string;
};

export type DiscoveryReplayFailureCode =
  | "target_not_found"
  | "ambiguous_target"
  | "navigation_mismatch"
  | "visible_state_mismatch"
  | "navigation_failed"
  | "action_failed"
  | "timing_failure"
  | "policy_blocked"
  | "replay_setup_failed";

export type DiscoveryReplayFailureEvidence = {
  schemaVersion: 1;
  code: DiscoveryReplayFailureCode;
  repairability: "repairable" | "hard-boundary";
  step?: {
    id: string;
    order: number;
    action: WalkthroughPlanStepAction;
    summary: string;
    provenance?: WalkthroughPlanStepProvenance;
  };
  expected?: WalkthroughPlanAssertion | WalkthroughPlanTargetHint;
  observed: { url?: string; candidates?: DiscoveryReplayMatch[] };
  recommendation:
    | "rediscover-target"
    | "rediscover-route"
    | "refresh-expectation"
    | "retry-after-stability"
    | "request-policy-boundary";
};

export type DiscoveryReplayAttempt = {
  attempt: 1 | 2 | 3;
  replayId: string;
  planId: string;
  sourceSessionId: string;
  selectedPathFingerprint: string;
  status: "passed" | "failed";
  checks: WalkthroughPlanValidationCheck[];
  failure?: DiscoveryReplayFailureEvidence;
};

export type DiscoveryReplayStopReason = "manual_review_required" | "repair_declined";

export type DiscoveryPlanRepairProvider = {
  repair(input: {
    repairNumber: 1 | 2;
    parentSession: DiscoverySessionV1;
    failedPlan: WalkthroughPlan;
    failure: DiscoveryReplayFailureEvidence;
  }): Promise<
    | { decision: "repaired"; session: unknown }
    | { decision: "stop"; reason: DiscoveryReplayStopReason }
  >;
};

export type DiscoveryReplayDependencies = {
  browserFactory: DiscoveryReplayBrowserFactory;
  repair?: DiscoveryPlanRepairProvider;
};

export type DiscoveryReplayErrorCode =
  | "invalid_source_session"
  | "invalid_replay_plan"
  | "invalid_replay_state"
  | "plan_source_mismatch"
  | "invalid_replay_options"
  | "missing_input_binding"
  | "unexpected_input_binding"
  | "invalid_input_binding"
  | "invalid_replay_policy"
  | "replay_navigation_out_of_scope"
  | "replay_setup_failed"
  | "repair_provider_failed"
  | "repair_not_available"
  | "repair_limit_reached"
  | "repair_declined"
  | "invalid_repair_session"
  | "repair_lineage_mismatch"
  | "repair_goal_mismatch"
  | "repair_target_out_of_scope"
  | "unchanged_repair_path"
  | "invalid_promoted_plan"
  | "replay_result_limit_exceeded";

export type DiscoveryReplayError = {
  code: DiscoveryReplayErrorCode;
  message: string;
  bindingKey?: string;
};

export type DiscoveryReplayResult =
  | {
      ok: true;
      plan: ValidatedWalkthroughPlan;
      sourceSession: DiscoverySessionV1;
      attempts: DiscoveryReplayAttempt[];
      review: WalkthroughPlanReview;
    }
  | {
      ok: false;
      phase: "preflight" | "replay" | "repair";
      plan?: WalkthroughPlan;
      sourceSession?: DiscoverySessionV1;
      attempts: DiscoveryReplayAttempt[];
      errors: DiscoveryReplayError[];
    };

type PreparedReplay = {
  plan: WalkthroughPlan;
  sourceSession: DiscoverySessionV1;
  bindings: Record<string, string>;
  policy: DiscoveryPolicy;
  validatedPolicy: ValidatedDiscoveryPolicy;
  maxRepairs: 0 | 1 | 2;
};

type PreflightResult =
  | { ok: true; prepared: PreparedReplay }
  | { ok: false; result: Extract<DiscoveryReplayResult, { ok: false }> };

export async function replayAndRepairDiscoveryPlan(
  input: ReplayAndRepairDiscoveryPlanInput,
  options: ReplayAndRepairDiscoveryPlanOptions = {},
  dependencies: DiscoveryReplayDependencies,
): Promise<DiscoveryReplayResult> {
  const preflight = prepareReplay(input, options);
  if (!preflight.ok) return preflight.result;

  let browser: DiscoveryReplayBrowser | undefined;
  try {
    browser = await dependencies.browserFactory.create({
      policy: preflight.prepared.policy,
      attempt: 1,
    });
    await browser.open(preflight.prepared.plan.target.url);
  } catch {
    return replayFailure(preflight.prepared, "replay_setup_failed", "Discovery replay setup failed.");
  } finally {
    await browser?.close().catch(() => undefined);
  }
  return replayFailure(preflight.prepared, "replay_setup_failed", "Discovery replay attempt failed.");
}

function prepareReplay(
  input: ReplayAndRepairDiscoveryPlanInput,
  options: ReplayAndRepairDiscoveryPlanOptions,
): PreflightResult {
  const validatedSession = validateDiscoverySession(input.sourceSession);
  if (!validatedSession.ok || validatedSession.session.status !== "completed") {
    return preflightFailure(
      "invalid_source_session",
      "Discovery replay requires a completed source session.",
    );
  }

  if (typeof input.plan !== "object" || input.plan === null) {
    return preflightFailure("invalid_replay_plan", "Discovery replay requires a valid plan.");
  }
  const rawPlan = input.plan as Partial<WalkthroughPlan>;
  if (
    rawPlan.state !== "draft" ||
    rawPlan.approvals?.approved === true ||
    rawPlan.execution?.status !== "not-started"
  ) {
    return preflightFailure(
      "invalid_replay_state",
      "Discovery replay requires a draft unapproved plan.",
    );
  }
  if (!isWalkthroughPlan(input.plan) || input.plan.source.parser !== "discovery-v1") {
    return preflightFailure("invalid_replay_plan", "Discovery replay requires a valid discovery plan.");
  }

  const compiled = compileDiscoverySessionToWalkthroughPlan(validatedSession.session);
  if (
    !compiled.ok ||
    compiled.plan.id !== input.plan.id ||
    compiled.plan.source.parser !== "discovery-v1" ||
    compiled.plan.source.discovery.sessionId !== input.plan.source.discovery.sessionId ||
    compiled.plan.source.discovery.selectedPathFingerprint !==
      input.plan.source.discovery.selectedPathFingerprint ||
    walkthroughPlanFingerprint(compiled.plan) !== walkthroughPlanFingerprint(input.plan)
  ) {
    return preflightFailure(
      "plan_source_mismatch",
      "Discovery replay plan does not match its compiled source session.",
    );
  }

  const maxRepairs = options.maxRepairs ?? 2;
  if (maxRepairs !== 0 && maxRepairs !== 1 && maxRepairs !== 2) {
    return preflightFailure(
      "invalid_replay_options",
      "Discovery replay repair limit must be between zero and two.",
    );
  }

  const policy = input.policy ?? defaultPolicy(input.plan.target.url);
  const policyValidation = validateDiscoveryPolicy(policy, input.plan.target.url);
  if (!policyValidation.ok) {
    return preflightFailure("invalid_replay_policy", "Discovery replay policy is invalid.");
  }
  if (!planNavigationIsAllowed(input.plan, policyValidation.policy)) {
    return preflightFailure(
      "replay_navigation_out_of_scope",
      "Discovery replay navigation is outside the approved policy scope.",
    );
  }

  const bindings = prepareBindings(input.plan, input.inputBindings ?? {});
  if (!bindings.ok) return { ok: false, result: bindings.result };

  return {
    ok: true,
    prepared: {
      plan: structuredClone(input.plan),
      sourceSession: structuredClone(validatedSession.session),
      bindings: bindings.bindings,
      policy: structuredClone(policy),
      validatedPolicy: policyValidation.policy,
      maxRepairs,
    },
  };
}

function prepareBindings(
  plan: WalkthroughPlan,
  provided: Record<string, unknown>,
):
  | { ok: true; bindings: Record<string, string> }
  | { ok: false; result: Extract<DiscoveryReplayResult, { ok: false }> } {
  const expected = new Set(
    plan.steps.flatMap((step) =>
      step.action === "type" && step.inputBinding !== undefined ? [step.inputBinding] : [],
    ),
  );
  const bindings: Record<string, string> = {};
  for (const key of expected) {
    const value = provided[key];
    if (value === undefined) {
      return bindingFailure("missing_input_binding", "Runtime input binding is missing.", key);
    }
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > DISCOVERY_LIMITS.publicStringCharacters ||
      isSecretLikeValue(value)
    ) {
      return bindingFailure("invalid_input_binding", "Runtime input binding is invalid.", key);
    }
    bindings[key] = value;
  }
  for (const key of Object.keys(provided)) {
    if (!expected.has(key)) {
      return bindingFailure(
        "unexpected_input_binding",
        "Runtime input binding is not used by the discovery plan.",
        safeBindingKey(key),
      );
    }
  }
  return { ok: true, bindings };
}

function defaultPolicy(targetUrl: string): DiscoveryPolicy {
  return { mode: "safe", allowedOrigins: [new URL(targetUrl).origin] };
}

function planNavigationIsAllowed(plan: WalkthroughPlan, policy: ValidatedDiscoveryPolicy): boolean {
  const urls = plan.steps.flatMap((step) => {
    const values: string[] = [];
    if (step.navigationUrl !== undefined) values.push(step.navigationUrl);
    if (step.assertion?.kind === "navigation") values.push(step.assertion.url);
    return values;
  });
  return urls.every((url) => {
    const origin = normalizeHttpOrigin(url);
    return origin !== undefined && policy.allowedOrigins.has(origin);
  });
}

function safeBindingKey(value: string): string | undefined {
  return /^[a-z0-9][a-z0-9_-]*$/i.test(value) ? value : undefined;
}

function bindingFailure(
  code: "missing_input_binding" | "unexpected_input_binding" | "invalid_input_binding",
  message: string,
  bindingKey: string | undefined,
): { ok: false; result: Extract<DiscoveryReplayResult, { ok: false }> } {
  return {
    ok: false,
    result: {
      ok: false,
      phase: "preflight",
      attempts: [],
      errors: [{ code, message, ...(bindingKey === undefined ? {} : { bindingKey }) }],
    },
  };
}

function preflightFailure(
  code: DiscoveryReplayErrorCode,
  message: string,
): { ok: false; result: Extract<DiscoveryReplayResult, { ok: false }> } {
  return {
    ok: false,
    result: { ok: false, phase: "preflight", attempts: [], errors: [{ code, message }] },
  };
}

function replayFailure(
  prepared: PreparedReplay,
  code: DiscoveryReplayErrorCode,
  message: string,
): Extract<DiscoveryReplayResult, { ok: false }> {
  return {
    ok: false,
    phase: "replay",
    plan: prepared.plan,
    sourceSession: prepared.sourceSession,
    attempts: [],
    errors: [{ code, message }],
  };
}
