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
const publicBrowsePolicy = () =>
  policy({ mode: "public-browse", allowedOrigins: ["https://example.test"] });
const yoloPolicy = () => policy({ mode: "yolo" });
const disposablePolicy = () =>
  policy({
    mode: "disposable",
    acknowledgement: "environment-is-disposable",
    allowedOrigins: ["https://example.test"],
  });

describe("validateDiscoveryPolicy", () => {
  it("accepts public-browse and unrestricted yolo policies", () => {
    expect(
      validateDiscoveryPolicy(
        { mode: "public-browse", allowedOrigins: ["https://example.test"] },
        CURRENT_URL,
      ),
    ).toEqual({
      ok: true,
      policy: { mode: "public-browse", allowedOrigins: new Set(["https://example.test"]) },
    });
    expect(validateDiscoveryPolicy({ mode: "yolo" }, CURRENT_URL)).toEqual({
      ok: true,
      policy: { mode: "yolo", allowedOrigins: new Set() },
    });
  });

  it.each([
    [
      "safe acknowledgement",
      {
        mode: "safe",
        allowedOrigins: ["https://example.test"],
        acknowledgement: "environment-is-disposable",
      },
    ],
    [
      "public-browse acknowledgement",
      {
        mode: "public-browse",
        allowedOrigins: ["https://example.test"],
        acknowledgement: "environment-is-disposable",
      },
    ],
    [
      "disposable extra field",
      {
        mode: "disposable",
        allowedOrigins: ["https://example.test"],
        acknowledgement: "environment-is-disposable",
        unrestricted: true,
      },
    ],
    ["scoped yolo", { mode: "yolo", allowedOrigins: ["https://example.test"] }],
    ["acknowledged yolo", { mode: "yolo", acknowledgement: "environment-is-disposable" }],
  ])("rejects mode-inapplicable policy fields for %s", (_label, input) => {
    expect(validateDiscoveryPolicy(input as never, CURRENT_URL)).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_discovery_policy" }],
    });
  });

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

  it("permits public search submits but blocks destructive public actions", () => {
    const searchTarget = {
      id: "target-search",
      label: "Search inventory",
      role: "button",
      disabled: false,
      actionRisk: "potentially-mutating" as const,
    };
    expect(
      authorizeDiscoveryPolicyAction({
        policy: publicBrowsePolicy(),
        observationUrl: CURRENT_URL,
        action: { kind: "click", targetId: searchTarget.id },
        target: searchTarget,
        risk: NO_RISK,
      }),
    ).toMatchObject({ decision: "allow", permit: { mode: "public-browse" } });

    const deleteTarget = { ...searchTarget, id: "target-delete", label: "Delete saved search" };
    expect(
      authorizeDiscoveryPolicyAction({
        policy: publicBrowsePolicy(),
        observationUrl: CURRENT_URL,
        action: { kind: "click", targetId: deleteTarget.id },
        target: deleteTarget,
        risk: NO_RISK,
      }),
    ).toMatchObject({
      decision: "block",
      reason: { code: "destructive_action_blocked" },
    });
  });

  it("bypasses Auto Demo action and origin safeguards in yolo mode", () => {
    let navigation: ReturnType<typeof authorizeDiscoveryPolicyAction> | undefined;
    expect(() => {
      navigation = authorizeDiscoveryPolicyAction({
        policy: yoloPolicy(),
        observationUrl: CURRENT_URL,
        action: { kind: "navigate", url: "https://other.test/account" },
      });
    }).not.toThrow();
    expect(navigation).toMatchObject({ decision: "allow", permit: { mode: "yolo" } });

    expect(
      authorizeDiscoveryPolicyAction({
        policy: yoloPolicy(),
        observationUrl: CURRENT_URL,
        action: {
          kind: "type",
          targetId: "target-password",
          inputBinding: "password",
          valueClass: "demo-data",
        },
        target: {
          id: "target-password",
          label: "Password",
          role: "textbox",
          disabled: false,
        },
        risk: { ...NO_RISK, credential: true },
      }),
    ).toMatchObject({ decision: "allow", permit: { mode: "yolo" } });
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
