import type { DiscoveryAction, DiscoveryInteractiveTarget } from "./discoveryContract.js";
import {
  hasCredentialLikeUrlData,
  hasDestructiveActionLanguage,
  normalizeHttpOrigin,
} from "./actionSafety.js";
import type { DiscoveryTargetRuntimeRisk } from "./discoveryTargetRegistry.js";

export type SafeDiscoveryPolicy = {
  mode: "safe";
  allowedOrigins: string[];
};

export type PublicBrowseDiscoveryPolicy = {
  mode: "public-browse";
  allowedOrigins: string[];
};

export type DisposableDiscoveryPolicy = {
  mode: "disposable";
  acknowledgement: "environment-is-disposable";
  allowedOrigins: string[];
};

export type YoloDiscoveryPolicy = {
  mode: "yolo";
};

export type DiscoveryPolicy =
  | SafeDiscoveryPolicy
  | PublicBrowseDiscoveryPolicy
  | DisposableDiscoveryPolicy
  | YoloDiscoveryPolicy;

export type ValidatedDiscoveryPolicy = {
  readonly mode: "safe" | "public-browse" | "disposable" | "yolo";
  readonly allowedOrigins: ReadonlySet<string>;
};

export type DiscoveryPolicyValidationErrorCode =
  "invalid_discovery_policy" | "disposable_acknowledgement_required" | "origin_not_allowed";

export type DiscoveryPolicyValidationError = {
  code: DiscoveryPolicyValidationErrorCode;
  message: string;
  path?: string;
};

export type DiscoveryPolicyValidationResult =
  | { ok: true; policy: ValidatedDiscoveryPolicy }
  | { ok: false; errors: DiscoveryPolicyValidationError[] };

export type DiscoveryRuntimeTargetRisk = DiscoveryTargetRuntimeRisk;

export type DiscoveryPolicyOutcomeCode =
  | "credential_action_blocked"
  | "sensitive_input_blocked"
  | "destructive_action_blocked"
  | "origin_not_allowed"
  | "unsafe_navigation_blocked"
  | "network_request_blocked"
  | "websocket_blocked"
  | "download_blocked"
  | "upload_blocked"
  | "policy_guard_unavailable";

export const DISCOVERY_POLICY_SUMMARIES: Record<DiscoveryPolicyOutcomeCode, string> = {
  credential_action_blocked: "Discovery blocked credential entry.",
  sensitive_input_blocked: "Discovery blocked sensitive input.",
  destructive_action_blocked: "Discovery blocked a potentially destructive action.",
  origin_not_allowed: "Discovery blocked an origin outside the approved scope.",
  unsafe_navigation_blocked: "Discovery blocked unsafe navigation.",
  network_request_blocked: "Discovery blocked classified network activity.",
  websocket_blocked: "Discovery blocked a WebSocket connection.",
  download_blocked: "Discovery blocked a download.",
  upload_blocked: "Discovery blocked an upload control.",
  policy_guard_unavailable: "Discovery policy enforcement is unavailable.",
};

export type DiscoveryPolicyPermit = {
  readonly token: symbol;
  readonly mode: "safe" | "public-browse" | "disposable" | "yolo";
  readonly allowedOrigins: ReadonlySet<string>;
};

export type DiscoveryPolicyAuthorization =
  | { decision: "allow"; permit: DiscoveryPolicyPermit }
  | {
      decision: "block";
      reason: { code: DiscoveryPolicyOutcomeCode; summary: string };
    };

const policyError = (
  code: DiscoveryPolicyValidationErrorCode,
  message: string,
  path?: string,
): DiscoveryPolicyValidationResult => ({
  ok: false,
  errors: [{ code, message, ...(path === undefined ? {} : { path }) }],
});

export function validateDiscoveryPolicy(
  input: DiscoveryPolicy,
  currentUrl: string,
): DiscoveryPolicyValidationResult {
  if (input === null || typeof input !== "object") {
    return policyError("invalid_discovery_policy", "Discovery policy is invalid.");
  }
  if (
    input.mode !== "safe" &&
    input.mode !== "public-browse" &&
    input.mode !== "disposable" &&
    input.mode !== "yolo"
  ) {
    return policyError("invalid_discovery_policy", "Discovery policy mode is invalid.", "mode");
  }
  if (input.mode === "yolo") {
    return { ok: true, policy: { mode: "yolo", allowedOrigins: new Set() } };
  }
  if (input.mode === "disposable" && input.acknowledgement !== "environment-is-disposable") {
    return policyError(
      "disposable_acknowledgement_required",
      "Disposable discovery requires explicit acknowledgement.",
      "acknowledgement",
    );
  }
  if (!Array.isArray(input.allowedOrigins) || input.allowedOrigins.length === 0) {
    return policyError(
      "invalid_discovery_policy",
      "Discovery policy requires at least one allowed origin.",
      "allowedOrigins",
    );
  }

  const allowedOrigins = new Set<string>();
  for (const [index, candidate] of input.allowedOrigins.entries()) {
    if (typeof candidate !== "string" || !isExactHttpOrigin(candidate)) {
      return policyError(
        "invalid_discovery_policy",
        "Discovery policy origins must be exact HTTP or HTTPS origins.",
        `allowedOrigins.${index}`,
      );
    }
    allowedOrigins.add(new URL(candidate).origin);
  }

  const currentOrigin = safeOrigin(currentUrl);
  if (currentOrigin === undefined || !allowedOrigins.has(currentOrigin)) {
    return policyError(
      "origin_not_allowed",
      "The current page origin is outside the approved discovery scope.",
    );
  }

  return { ok: true, policy: { mode: input.mode, allowedOrigins } };
}

export function authorizeDiscoveryPolicyAction(input: {
  policy: ValidatedDiscoveryPolicy;
  observationUrl: string;
  action: DiscoveryAction;
  target?: DiscoveryInteractiveTarget;
  risk?: DiscoveryRuntimeTargetRisk;
}): DiscoveryPolicyAuthorization {
  if (input.policy.mode === "yolo") {
    return allow(input.policy);
  }
  const observationOrigin = safeOrigin(input.observationUrl);
  if (observationOrigin === undefined) {
    return block("unsafe_navigation_blocked");
  }
  if (!input.policy.allowedOrigins.has(observationOrigin)) {
    return block("origin_not_allowed");
  }

  if (input.action.kind === "navigate") {
    const destinationOrigin = safeOrigin(input.action.url);
    if (destinationOrigin === undefined) {
      return block("unsafe_navigation_blocked");
    }
    if (!input.policy.allowedOrigins.has(destinationOrigin)) {
      return block("origin_not_allowed");
    }
    return allow(input.policy);
  }

  if (input.action.kind === "click" || input.action.kind === "type") {
    if (input.target === undefined || input.target.disabled) {
      return block(
        input.action.kind === "type" ? "sensitive_input_blocked" : "destructive_action_blocked",
      );
    }
    if (input.risk === undefined) {
      return block(
        input.action.kind === "type" ? "sensitive_input_blocked" : "destructive_action_blocked",
      );
    }
    const risk = input.risk;
    if (risk.upload) {
      return block("upload_blocked");
    }
    if (input.action.kind === "type") {
      if (risk.credential) {
        return block("credential_action_blocked");
      }
      if (risk.sensitivePayment || hasSensitiveInputLanguage(input.target)) {
        return block("sensitive_input_blocked");
      }
      return allow(input.policy);
    }
    const destructiveLanguage = hasDestructiveActionLanguage(targetDescription(input.target));
    if (
      (input.policy.mode === "safe" && input.target.actionRisk === "potentially-mutating") ||
      ((input.policy.mode === "safe" || input.policy.mode === "public-browse") &&
        destructiveLanguage)
    ) {
      return block("destructive_action_blocked");
    }
  }

  return allow(input.policy);
}

function allow(policy: ValidatedDiscoveryPolicy): DiscoveryPolicyAuthorization {
  return {
    decision: "allow",
    permit: {
      token: Symbol("discovery-policy-permit"),
      mode: policy.mode,
      allowedOrigins: policy.allowedOrigins,
    },
  };
}

function block(code: DiscoveryPolicyOutcomeCode): DiscoveryPolicyAuthorization {
  return { decision: "block", reason: { code, summary: DISCOVERY_POLICY_SUMMARIES[code] } };
}

function isExactHttpOrigin(value: string): boolean {
  if (!/^https?:\/\/[^/?#]+\/?$/i.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      normalizeHttpOrigin(value) !== undefined &&
      !url.hostname.includes("*") &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function safeOrigin(value: string): string | undefined {
  if (hasCredentialLikeUrlData(value)) {
    return undefined;
  }
  return normalizeHttpOrigin(value);
}

function targetDescription(target: DiscoveryInteractiveTarget): string {
  return `${target.label} ${target.role ?? ""}`;
}

function hasSensitiveInputLanguage(target: DiscoveryInteractiveTarget): boolean {
  return /\b(password|passcode|secret|token|credential|api[ _-]?key|credit card|card number|security code|ssn|social security)\b/i.test(
    targetDescription(target),
  );
}
