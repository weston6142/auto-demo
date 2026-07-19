export type DiscoveryNetworkRequestClass =
  "document-navigation" | "xhr-fetch" | "beacon" | "service-worker" | "other";

export type DiscoveryNetworkMethodCategory = "read" | "potential-side-effect" | "other";

export type DiscoveryNetworkOriginRelation = "same-origin" | "cross-origin" | "unknown";

export type DiscoveryNetworkScope = "top-level" | "subresource";

export type DiscoveryNetworkClassification = {
  requestClass: DiscoveryNetworkRequestClass;
  methodCategory: DiscoveryNetworkMethodCategory;
  originRelation: DiscoveryNetworkOriginRelation;
  scope: DiscoveryNetworkScope;
};

export type DiscoveryNetworkRequestMetadata = {
  method: string;
  resourceType?: string;
  isNavigationRequest: boolean;
  isMainFrame: boolean;
  isServiceWorker: boolean;
  currentOrigin?: string;
  requestOrigin?: string;
};

export type DiscoveryBlockedNetworkClassification = DiscoveryNetworkClassification & {
  blockedRequestCount: number;
};

export type DiscoveryBlockedNetworkEvidence = {
  classifications: DiscoveryBlockedNetworkClassification[];
  totalBlockedRequestCount: number;
  omittedClassificationCount?: number;
};

export type DiscoveryNetworkDiagnostic = DiscoveryBlockedNetworkEvidence & {
  code: "network_requests_blocked";
  expectedVisibleEffectPrevented: boolean;
};

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SIDE_EFFECT_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function classifyDiscoveryNetworkRequest(
  input: DiscoveryNetworkRequestMetadata,
): DiscoveryNetworkClassification {
  const resourceType = input.resourceType?.toUpperCase();
  const method = input.method.toUpperCase();

  return {
    requestClass: input.isServiceWorker
      ? "service-worker"
      : input.isNavigationRequest && resourceType === "DOCUMENT"
        ? "document-navigation"
        : resourceType === "XHR" || resourceType === "FETCH"
          ? "xhr-fetch"
          : resourceType === "PING"
            ? "beacon"
            : "other",
    methodCategory: READ_METHODS.has(method)
      ? "read"
      : SIDE_EFFECT_METHODS.has(method)
        ? "potential-side-effect"
        : "other",
    originRelation:
      input.currentOrigin === undefined || input.requestOrigin === undefined
        ? "unknown"
        : input.currentOrigin === input.requestOrigin
          ? "same-origin"
          : "cross-origin",
    scope: input.isMainFrame && input.isNavigationRequest ? "top-level" : "subresource",
  };
}
