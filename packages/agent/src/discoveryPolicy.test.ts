import { describe, expect, it } from "vitest";
import {
  authorizeDiscoveryPolicyAction,
  validateDiscoveryPolicy,
  type DiscoveryPolicy,
  type DiscoveryRuntimeTargetRisk,
  type ValidatedDiscoveryPolicy,
} from "./discoveryPolicy.js";

const CURRENT_URL = "https://example.test/start";
const NO_RISK: DiscoveryRuntimeTargetRisk = {
  credential: false,
  sensitivePayment: false,
  upload: false,
};

function policy(input: DiscoveryPolicy): ValidatedDiscoveryPolicy {
  const result = validateDiscoveryPolicy(input, CURRENT_URL);
  if (!result.ok) throw new Error("policy fixture must validate");
  return result.policy;
}

const safePolicy = () => policy({ mode: "safe", allowedOrigins: ["https://example.test"] });
const disposablePolicy = () =>
  policy({
    mode: "disposable",
    acknowledgement: "environment-is-disposable",
    allowedOrigins: ["https://example.test"],
  });

describe("validateDiscoveryPolicy", () => {
  it("normalizes and deduplicates exact origins", () => {
    expect(
      validateDiscoveryPolicy(
        { mode: "safe", allowedOrigins: ["https://example.test/", "https://example.test"] },
        CURRENT_URL,
      ),
    ).toEqual({
      ok: true,
      policy: { mode: "safe", allowedOrigins: new Set(["https://example.test"]) },
    });
  });

  it.each([
    ["paths", "https://example.test/path"],
    ["normalized dot paths", "https://example.test/."],
    ["query strings", "https://example.test/?mode=test"],
    ["empty query delimiters", "https://example.test?"],
    ["fragments", "https://example.test/#demo"],
    ["empty fragment delimiters", "https://example.test#"],
    ["wildcard hosts", "https://*.example.test"],
    ["embedded credentials", "https://user:password@example.test"],
    ["non-HTTP schemes", "file:///tmp/demo"],
  ])("rejects allowed origins containing %s", (_label, origin) => {
    expect(
      validateDiscoveryPolicy({ mode: "safe", allowedOrigins: [origin] }, CURRENT_URL),
    ).toMatchObject({ ok: false, errors: [{ code: "invalid_discovery_policy" }] });
  });

  it("requires explicit disposable acknowledgement", () => {
    expect(
      validateDiscoveryPolicy(
        { mode: "disposable", allowedOrigins: ["https://example.test"] } as never,
        CURRENT_URL,
      ),
    ).toMatchObject({
      ok: false,
      errors: [{ code: "disposable_acknowledgement_required" }],
    });
  });

  it("requires the current origin to be in scope", () => {
    expect(
      validateDiscoveryPolicy(
        { mode: "safe", allowedOrigins: ["https://other.test"] },
        CURRENT_URL,
      ),
    ).toMatchObject({ ok: false, errors: [{ code: "origin_not_allowed" }] });
  });
});

describe("authorizeDiscoveryPolicyAction", () => {
  const mutatingTarget = {
    id: "target-save",
    label: "Save",
    role: "button",
    disabled: false,
    actionRisk: "potentially-mutating" as const,
  };

  it("blocks mutating clicks in safe mode and permits them when disposable", () => {
    const action = { kind: "click", targetId: mutatingTarget.id } as const;
    expect(
      authorizeDiscoveryPolicyAction({
        policy: safePolicy(),
        observationUrl: CURRENT_URL,
        action,
        target: mutatingTarget,
        risk: NO_RISK,
      }),
    ).toMatchObject({
      decision: "block",
      reason: {
        code: "destructive_action_blocked",
        summary: "Discovery blocked a potentially destructive action.",
      },
    });
    expect(
      authorizeDiscoveryPolicyAction({
        policy: disposablePolicy(),
        observationUrl: CURRENT_URL,
        action,
        target: mutatingTarget,
        risk: NO_RISK,
      }),
    ).toMatchObject({ decision: "allow", permit: { mode: "disposable" } });
  });

  it.each([
    ["credentials", { ...NO_RISK, credential: true }, "credential_action_blocked"],
    ["payment fields", { ...NO_RISK, sensitivePayment: true }, "sensitive_input_blocked"],
  ] as const)("blocks typing into %s in every mode", (_label, risk, code) => {
    const result = authorizeDiscoveryPolicyAction({
      policy: disposablePolicy(),
      observationUrl: CURRENT_URL,
      action: {
        kind: "type",
        targetId: "target-input",
        inputBinding: "demo-name",
        valueClass: "demo-data",
      },
      target: { id: "target-input", label: "Input", role: "textbox", disabled: false },
      risk,
    });
    expect(result).toMatchObject({ decision: "block", reason: { code } });
  });

  it("blocks upload controls in every mode", () => {
    expect(
      authorizeDiscoveryPolicyAction({
        policy: disposablePolicy(),
        observationUrl: CURRENT_URL,
        action: { kind: "click", targetId: "target-upload" },
        target: { id: "target-upload", label: "Choose file", disabled: false },
        risk: { ...NO_RISK, upload: true },
      }),
    ).toMatchObject({ decision: "block", reason: { code: "upload_blocked" } });
  });

  it("fails closed when runtime risk metadata is unavailable", () => {
    expect(
      authorizeDiscoveryPolicyAction({
        policy: disposablePolicy(),
        observationUrl: CURRENT_URL,
        action: { kind: "click", targetId: "target-plain" },
        target: { id: "target-plain", label: "Continue", disabled: false },
      }),
    ).toMatchObject({
      decision: "block",
      reason: { code: "destructive_action_blocked" },
    });
  });

  it.each(["javascript:alert(1)", "https://example.test/?token=secret-value-123456789"])(
    "blocks unsafe navigation without echoing the URL: %s",
    (url) => {
      const result = authorizeDiscoveryPolicyAction({
        policy: disposablePolicy(),
        observationUrl: CURRENT_URL,
        action: { kind: "navigate", url },
      });
      expect(result).toMatchObject({
        decision: "block",
        reason: { code: "unsafe_navigation_blocked" },
      });
      expect(JSON.stringify(result)).not.toContain(url);
    },
  );

  it("blocks navigation outside exact allowed origins", () => {
    expect(
      authorizeDiscoveryPolicyAction({
        policy: disposablePolicy(),
        observationUrl: CURRENT_URL,
        action: { kind: "navigate", url: "https://sub.example.test/next" },
      }),
    ).toMatchObject({ decision: "block", reason: { code: "origin_not_allowed" } });
  });

  it("permits inspect without a target and uses a one-use opaque permit", () => {
    const result = authorizeDiscoveryPolicyAction({
      policy: safePolicy(),
      observationUrl: CURRENT_URL,
      action: { kind: "inspect" },
    });
    expect(result).toMatchObject({ decision: "allow", permit: { mode: "safe" } });
    if (result.decision !== "allow") throw new Error("inspect must be allowed");
    expect(typeof result.permit.token).toBe("symbol");
    expect(JSON.stringify(result)).not.toContain("token");
  });
});
