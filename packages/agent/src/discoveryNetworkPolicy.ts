import type { DiscoveryNetworkClassification } from "./discoveryNetworkClassification.js";
import type { ValidatedDiscoveryPolicy } from "./discoveryPolicy.js";

export type DiscoveryNetworkDecision =
  { decision: "allow" } | { decision: "block"; code: "network_request_blocked" };

const ALLOW: DiscoveryNetworkDecision = { decision: "allow" };
const BLOCK: DiscoveryNetworkDecision = {
  decision: "block",
  code: "network_request_blocked",
};

export function decideDiscoveryNetworkRequest(input: {
  policy: ValidatedDiscoveryPolicy;
  classification: DiscoveryNetworkClassification;
  requestOrigin?: string;
  actionActive: boolean;
}): DiscoveryNetworkDecision {
  if (input.policy.mode === "yolo") return ALLOW;
  if (input.requestOrigin === undefined) return BLOCK;

  const exactOrigin = input.policy.allowedOrigins.has(input.requestOrigin);
  if (input.classification.scope === "top-level" && !exactOrigin) return BLOCK;
  if (input.classification.methodCategory === "read") return ALLOW;
  if (input.classification.methodCategory === "other") return BLOCK;

  if (input.policy.mode === "safe") return BLOCK;
  if (input.policy.mode === "disposable") {
    return exactOrigin && input.actionActive ? ALLOW : BLOCK;
  }

  if (input.classification.requestClass === "document-navigation") {
    return input.classification.scope === "top-level" && exactOrigin && input.actionActive
      ? ALLOW
      : BLOCK;
  }
  if (input.classification.scope !== "subresource") return BLOCK;
  if (input.classification.requestClass === "beacon") return ALLOW;
  if (
    (input.classification.requestClass === "xhr-fetch" ||
      input.classification.requestClass === "service-worker") &&
    input.classification.originRelation === "same-origin" &&
    exactOrigin
  ) {
    return ALLOW;
  }
  return BLOCK;
}
