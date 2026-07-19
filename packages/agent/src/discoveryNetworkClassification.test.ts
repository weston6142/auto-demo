import { describe, expect, it } from "vitest";
import { classifyDiscoveryNetworkRequest } from "./index.js";

describe("classifyDiscoveryNetworkRequest", () => {
  it.each([
    [
      "document navigation",
      {
        resourceType: "Document",
        isNavigationRequest: true,
        isMainFrame: true,
        isServiceWorker: false,
      },
      "document-navigation",
      "top-level",
    ],
    [
      "XHR",
      {
        resourceType: "XHR",
        isNavigationRequest: false,
        isMainFrame: false,
        isServiceWorker: false,
      },
      "xhr-fetch",
      "subresource",
    ],
    [
      "fetch",
      {
        resourceType: "Fetch",
        isNavigationRequest: false,
        isMainFrame: false,
        isServiceWorker: false,
      },
      "xhr-fetch",
      "subresource",
    ],
    [
      "beacon",
      {
        resourceType: "Ping",
        isNavigationRequest: false,
        isMainFrame: false,
        isServiceWorker: false,
      },
      "beacon",
      "subresource",
    ],
    [
      "service worker",
      {
        resourceType: "Fetch",
        isNavigationRequest: false,
        isMainFrame: false,
        isServiceWorker: true,
      },
      "service-worker",
      "subresource",
    ],
    [
      "other",
      {
        resourceType: "Image",
        isNavigationRequest: false,
        isMainFrame: false,
        isServiceWorker: false,
      },
      "other",
      "subresource",
    ],
  ] as const)("classifies %s", (_label, request, requestClass, scope) => {
    expect(
      classifyDiscoveryNetworkRequest({
        method: "POST",
        currentOrigin: "https://example.test",
        requestOrigin: "https://example.test",
        ...request,
      }),
    ).toEqual({
      requestClass,
      methodCategory: "potential-side-effect",
      originRelation: "same-origin",
      scope,
    });
  });

  it.each([
    ["GET", "read"],
    ["HEAD", "read"],
    ["OPTIONS", "read"],
    ["POST", "potential-side-effect"],
    ["PUT", "potential-side-effect"],
    ["PATCH", "potential-side-effect"],
    ["DELETE", "potential-side-effect"],
    ["PROPFIND", "other"],
  ] as const)("classifies %s methods", (method, methodCategory) => {
    expect(
      classifyDiscoveryNetworkRequest({
        method,
        resourceType: "Fetch",
        isNavigationRequest: false,
        isMainFrame: false,
        isServiceWorker: false,
        currentOrigin: "https://example.test",
        requestOrigin: "https://other.test",
      }),
    ).toMatchObject({ methodCategory, originRelation: "cross-origin" });
  });

  it("classifies an absent origin without retaining arbitrary request strings", () => {
    const secret = "do-not-record-secret-token";
    const result = classifyDiscoveryNetworkRequest({
      method: `POST-${secret}`,
      resourceType: `Fetch-${secret}`,
      isNavigationRequest: false,
      isMainFrame: false,
      isServiceWorker: false,
      currentOrigin: "https://example.test",
      requestOrigin: undefined,
    });

    expect(result).toEqual({
      requestClass: "other",
      methodCategory: "other",
      originRelation: "unknown",
      scope: "subresource",
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
