import { describe, expect, it } from "vitest";
import type { DiscoveryNetworkClassification } from "./discoveryNetworkClassification.js";
import { decideDiscoveryNetworkRequest } from "./discoveryNetworkPolicy.js";
import {
  validateDiscoveryPolicy,
  type DiscoveryPolicy,
  type ValidatedDiscoveryPolicy,
} from "./discoveryPolicy.js";

const ORIGIN = "https://example.test";
const OTHER_ORIGIN = "https://analytics.test";

function policy(input: DiscoveryPolicy): ValidatedDiscoveryPolicy {
  const result = validateDiscoveryPolicy(input, `${ORIGIN}/start`);
  if (!result.ok) throw new Error("policy fixture must validate");
  return result.policy;
}

const safe = () => policy({ mode: "safe", allowedOrigins: [ORIGIN] });
const publicBrowse = () => policy({ mode: "public-browse", allowedOrigins: [ORIGIN] });
const disposable = () =>
  policy({
    mode: "disposable",
    acknowledgement: "environment-is-disposable",
    allowedOrigins: [ORIGIN],
  });
const yolo = () => policy({ mode: "yolo" });

function classification(
  overrides: Partial<DiscoveryNetworkClassification> = {},
): DiscoveryNetworkClassification {
  return {
    requestClass: "xhr-fetch",
    methodCategory: "potential-side-effect",
    originRelation: "same-origin",
    scope: "subresource",
    ...overrides,
  };
}

describe("decideDiscoveryNetworkRequest", () => {
  it("keeps safe read-only and disposable exact-origin mutation behavior", () => {
    expect(
      decideDiscoveryNetworkRequest({
        policy: safe(),
        classification: classification({ methodCategory: "read" }),
        requestOrigin: OTHER_ORIGIN,
        actionActive: false,
      }),
    ).toEqual({ decision: "allow" });
    expect(
      decideDiscoveryNetworkRequest({
        policy: safe(),
        classification: classification(),
        requestOrigin: ORIGIN,
        actionActive: true,
      }),
    ).toEqual({ decision: "block", code: "network_request_blocked" });
    expect(
      decideDiscoveryNetworkRequest({
        policy: disposable(),
        classification: classification(),
        requestOrigin: ORIGIN,
        actionActive: true,
      }),
    ).toEqual({ decision: "allow" });
    expect(
      decideDiscoveryNetworkRequest({
        policy: disposable(),
        classification: classification(),
        requestOrigin: ORIGIN,
        actionActive: false,
      }),
    ).toEqual({ decision: "block", code: "network_request_blocked" });
    expect(
      decideDiscoveryNetworkRequest({
        policy: disposable(),
        classification: classification({ originRelation: "cross-origin" }),
        requestOrigin: OTHER_ORIGIN,
        actionActive: true,
      }),
    ).toEqual({ decision: "block", code: "network_request_blocked" });
  });

  it("allows classified public browsing traffic without allowing unknown or mutating traffic", () => {
    const allowed = [
      {
        value: classification({
          requestClass: "document-navigation",
          scope: "top-level",
        }),
        requestOrigin: ORIGIN,
        actionActive: true,
      },
      { value: classification(), requestOrigin: ORIGIN, actionActive: false },
      {
        value: classification({ requestClass: "service-worker" }),
        requestOrigin: ORIGIN,
        actionActive: false,
      },
      {
        value: classification({ requestClass: "beacon", originRelation: "cross-origin" }),
        requestOrigin: OTHER_ORIGIN,
        actionActive: false,
      },
    ];
    for (const input of allowed) {
      expect(
        decideDiscoveryNetworkRequest({
          policy: publicBrowse(),
          classification: input.value,
          requestOrigin: input.requestOrigin,
          actionActive: input.actionActive,
        }),
      ).toEqual({ decision: "allow" });
    }

    const blocked = [
      {
        value: classification({
          requestClass: "document-navigation",
          scope: "top-level",
        }),
        requestOrigin: ORIGIN,
        actionActive: false,
      },
      {
        value: classification({ originRelation: "cross-origin" }),
        requestOrigin: OTHER_ORIGIN,
        actionActive: true,
      },
      {
        value: classification({ requestClass: "other" }),
        requestOrigin: ORIGIN,
        actionActive: true,
      },
      {
        value: classification({ methodCategory: "other" }),
        requestOrigin: ORIGIN,
        actionActive: true,
      },
      { value: classification(), requestOrigin: undefined, actionActive: true },
    ];
    for (const input of blocked) {
      expect(
        decideDiscoveryNetworkRequest({
          policy: publicBrowse(),
          classification: input.value,
          requestOrigin: input.requestOrigin,
          actionActive: input.actionActive,
        }),
      ).toEqual({ decision: "block", code: "network_request_blocked" });
    }
  });

  it("does not apply Auto Demo network safeguards in yolo mode", () => {
    expect(
      decideDiscoveryNetworkRequest({
        policy: yolo(),
        classification: classification({
          requestClass: "other",
          methodCategory: "other",
          originRelation: "unknown",
          scope: "top-level",
        }),
        actionActive: false,
      }),
    ).toEqual({ decision: "allow" });
  });

  it("returns only a sanitized decision and policy outcome code", () => {
    const result = decideDiscoveryNetworkRequest({
      policy: publicBrowse(),
      classification: classification({ originRelation: "cross-origin" }),
      requestOrigin: OTHER_ORIGIN,
      actionActive: true,
    });
    expect(result).toEqual({ decision: "block", code: "network_request_blocked" });
    expect(JSON.stringify(result)).not.toContain(OTHER_ORIGIN);
  });
});
