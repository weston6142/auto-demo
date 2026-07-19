import type { BrowserContext, CDPSession, Download, Page, Route } from "playwright";
import { hasCredentialLikeUrlData, normalizeHttpOrigin } from "./actionSafety.js";
import {
  DISCOVERY_POLICY_SUMMARIES,
  type DiscoveryPolicyOutcomeCode,
  type DiscoveryPolicyPermit,
  type ValidatedDiscoveryPolicy,
} from "./discoveryPolicy.js";
import {
  classifyDiscoveryNetworkRequest,
  type DiscoveryBlockedNetworkClassification,
  type DiscoveryBlockedNetworkEvidence,
  type DiscoveryNetworkClassification,
} from "./discoveryNetworkClassification.js";

export type DiscoveryPolicyViolation = {
  code: DiscoveryPolicyOutcomeCode;
  summary: string;
  blockedNetworkEvidence?: DiscoveryBlockedNetworkEvidence;
};

export type PlaywrightDiscoveryPolicyGuard = {
  arm(permit: DiscoveryPolicyPermit): void;
  finishAction(): Promise<DiscoveryPolicyViolation | undefined>;
  checkForViolation(): DiscoveryPolicyViolation | undefined;
  dispose(): Promise<void>;
};

export class DiscoveryPolicyGuardError extends Error {
  constructor(
    readonly code: "policy_guard_unavailable",
    message = DISCOVERY_POLICY_SUMMARIES.policy_guard_unavailable,
    private cleanupOperation?: () => Promise<void>,
  ) {
    super(message);
    this.name = "DiscoveryPolicyGuardError";
  }

  async cleanup(): Promise<void> {
    if (this.cleanupOperation === undefined) return;
    await this.cleanupOperation();
    this.cleanupOperation = undefined;
  }
}

type FetchRequestPaused = {
  requestId: string;
  request: { url: string; method: string };
  resourceType?: string;
  frameId?: string;
};

type FrameTreeResult = { frameTree: { frame: { id: string } } };
type FrameNavigated = { frame: { id: string; url: string } };

const ROUTE_MATCHER = "**/*";
const MAX_NETWORK_CLASSIFICATIONS = 8;
const ACTION_QUIET_PERIOD_MS = 200;
const ACTION_SETTLE_TIMEOUT_MS = 750;

type BlockedNetworkAccumulator = {
  classifications: Map<string, DiscoveryBlockedNetworkClassification>;
  omittedClassificationKeys: Set<string>;
  totalBlockedRequestCount: number;
};

function createBlockedNetworkAccumulator(): BlockedNetworkAccumulator {
  return {
    classifications: new Map(),
    omittedClassificationKeys: new Set(),
    totalBlockedRequestCount: 0,
  };
}

function classificationKey(classification: DiscoveryNetworkClassification): string {
  return [
    classification.requestClass,
    classification.methodCategory,
    classification.originRelation,
    classification.scope,
  ].join(":");
}

function recordBlockedNetworkClassification(
  accumulator: BlockedNetworkAccumulator,
  classification: DiscoveryNetworkClassification,
): void {
  accumulator.totalBlockedRequestCount += 1;
  const key = classificationKey(classification);
  const existing = accumulator.classifications.get(key);
  if (existing !== undefined) {
    existing.blockedRequestCount += 1;
    return;
  }
  if (accumulator.classifications.size < MAX_NETWORK_CLASSIFICATIONS) {
    accumulator.classifications.set(key, { ...classification, blockedRequestCount: 1 });
    return;
  }
  accumulator.omittedClassificationKeys.add(key);
}

function blockedNetworkEvidence(
  accumulator: BlockedNetworkAccumulator,
): DiscoveryBlockedNetworkEvidence | undefined {
  if (accumulator.totalBlockedRequestCount === 0) return undefined;
  const omittedClassificationCount = accumulator.omittedClassificationKeys.size;
  return {
    classifications: [...accumulator.classifications.values()].map((classification) => ({
      ...classification,
    })),
    totalBlockedRequestCount: accumulator.totalBlockedRequestCount,
    ...(omittedClassificationCount === 0 ? {} : { omittedClassificationCount }),
  };
}

export async function installPlaywrightDiscoveryPolicyGuard(
  page: Page,
  policy: ValidatedDiscoveryPolicy,
): Promise<PlaywrightDiscoveryPolicyGuard> {
  const context = page.context();
  requireIsolatedChromiumPage(context, page);

  let activePermit: DiscoveryPolicyPermit | undefined;
  let activeViolation: DiscoveryPolicyViolation | undefined;
  let idleViolation: DiscoveryPolicyViolation | undefined;
  let activeBlockedNetwork = createBlockedNetworkAccumulator();
  let idleBlockedNetwork = createBlockedNetworkAccumulator();
  let disposed = false;
  let unhealthy = false;
  const consumedTokens = new Set<symbol>();
  const pendingInterceptions = new Set<Promise<void>>();
  const pendingSideEffects = new Set<Promise<void>>();
  let lastActivityAt = Date.now();
  let lastSafePageOrigin = safeRequestOrigin(page.url());
  if (lastSafePageOrigin === undefined) {
    throw new DiscoveryPolicyGuardError("policy_guard_unavailable");
  }
  let unsafePageState = false;

  const markActivity = () => {
    lastActivityAt = Date.now();
  };

  const recordViolation = (code: DiscoveryPolicyOutcomeCode) => {
    const violation = { code, summary: DISCOVERY_POLICY_SUMMARIES[code] };
    if (activePermit === undefined) {
      idleViolation ??= violation;
    } else {
      activeViolation ??= violation;
    }
  };

  const recordNetworkViolation = (classification: DiscoveryNetworkClassification) => {
    const violation = activePermit === undefined ? idleViolation : activeViolation;
    if (violation !== undefined && violation.code !== "network_request_blocked") return;
    recordBlockedNetworkClassification(
      activePermit === undefined ? idleBlockedNetwork : activeBlockedNetwork,
      classification,
    );
    recordViolation("network_request_blocked");
  };

  const withBlockedNetworkEvidence = (
    violation: DiscoveryPolicyViolation | undefined,
    accumulator: BlockedNetworkAccumulator,
  ): DiscoveryPolicyViolation | undefined => {
    if (violation?.code !== "network_request_blocked") return violation;
    const evidence = blockedNetworkEvidence(accumulator);
    return evidence === undefined ? violation : { ...violation, blockedNetworkEvidence: evidence };
  };

  let cdpSession: CDPSession | undefined;
  let mainFrameId: string | undefined;
  let popupRouteInstalled = false;
  let downloadListenerInstalled = false;
  let fetchListenerInstalled = false;
  let webSocketListenerInstalled = false;
  let frameListenerInstalled = false;
  let popupListenerInstalled = false;
  let fetchEnabled = false;
  let serviceWorkerBypassEnabled = false;
  let webSocketBlockEnabled = false;

  const failRequest = async (requestId: string) => {
    await cdpSession!.send("Fetch.failRequest", {
      requestId,
      errorReason: "BlockedByClient",
    });
  };

  const handlePausedRequest = async (event: FetchRequestPaused) => {
    const requestOrigin = safeRequestOrigin(event.request.url);
    const topLevelNavigation =
      event.resourceType === "Document" &&
      event.frameId !== undefined &&
      event.frameId === mainFrameId;

    if (requestOrigin === undefined) {
      recordViolation("unsafe_navigation_blocked");
      await failRequest(event.requestId);
      return;
    }
    if (topLevelNavigation && !policy.allowedOrigins.has(requestOrigin)) {
      recordViolation("origin_not_allowed");
      await failRequest(event.requestId);
      return;
    }

    const classification = classifyDiscoveryNetworkRequest({
      method: event.request.method,
      resourceType: event.resourceType,
      isNavigationRequest: event.resourceType === "Document",
      isMainFrame: topLevelNavigation,
      isServiceWorker: event.resourceType !== "Document" && event.frameId === undefined,
      currentOrigin: safeRequestOrigin(page.url()),
      requestOrigin,
    });
    if (classification.methodCategory !== "read") {
      const disposableMutationAllowed =
        classification.methodCategory === "potential-side-effect" &&
        activePermit?.mode === "disposable" &&
        activePermit.allowedOrigins.has(requestOrigin) &&
        policy.allowedOrigins.has(requestOrigin);
      if (!disposableMutationAllowed) {
        recordNetworkViolation(classification);
        await failRequest(event.requestId);
        return;
      }
    }

    await cdpSession!.send("Fetch.continueRequest", { requestId: event.requestId });
  };

  const fetchHandler = (event: FetchRequestPaused) => {
    markActivity();
    const tracked = handlePausedRequest(event).catch(async () => {
      unhealthy = true;
      recordViolation("policy_guard_unavailable");
      await failRequest(event.requestId).catch(() => undefined);
    });
    pendingInterceptions.add(tracked);
    void tracked.finally(() => pendingInterceptions.delete(tracked));
  };

  const popupRouteHandler = async (route: Route) => {
    const request = route.request();
    try {
      if (request.frame().page() === page) {
        await route.fallback();
        return;
      }
    } catch {
      // A popup's first navigation can exist before its frame does.
    }
    recordViolation("unsafe_navigation_blocked");
    markActivity();
    await route.abort("blockedbyclient");
  };

  const popupHandler = (popup: Page) => {
    if (popup === page) return;
    recordViolation("unsafe_navigation_blocked");
    markActivity();
    const tracked = popup.close().catch(() => undefined);
    pendingSideEffects.add(tracked);
    void tracked.finally(() => pendingSideEffects.delete(tracked));
  };

  const downloadHandler = (download: Download) => {
    recordViolation("download_blocked");
    markActivity();
    const tracked = download.cancel().catch(() => undefined);
    pendingSideEffects.add(tracked);
    void tracked.finally(() => pendingSideEffects.delete(tracked));
  };

  const webSocketHandler = () => {
    recordViolation("websocket_blocked");
    markActivity();
  };

  const frameNavigatedHandler = (event: FrameNavigated) => {
    if (event.frame.id !== mainFrameId) return;
    markActivity();
    const origin = safeRequestOrigin(event.frame.url);
    if (origin === undefined) {
      unsafePageState = true;
      recordViolation("unsafe_navigation_blocked");
      void cdpSession?.send("Page.stopLoading").catch(() => undefined);
      return;
    }
    if (!policy.allowedOrigins.has(origin)) {
      unsafePageState = true;
      recordViolation("origin_not_allowed");
      void cdpSession?.send("Page.stopLoading").catch(() => undefined);
      return;
    }
    lastSafePageOrigin = origin;
    unsafePageState = false;
  };

  const cleanup = async () => {
    const failures: unknown[] = [];
    if (popupRouteInstalled) {
      try {
        await context.unroute(ROUTE_MATCHER, popupRouteHandler);
        popupRouteInstalled = false;
      } catch (error) {
        failures.push(error);
      }
    }
    if (downloadListenerInstalled) {
      page.off("download", downloadHandler);
      downloadListenerInstalled = false;
    }
    if (popupListenerInstalled) {
      context.off("page", popupHandler);
      popupListenerInstalled = false;
    }
    if (cdpSession !== undefined) {
      if (fetchEnabled) {
        try {
          await cdpSession.send("Fetch.disable");
          fetchEnabled = false;
        } catch (error) {
          failures.push(error);
        }
      }
      if (!fetchEnabled && fetchListenerInstalled) {
        cdpSession.off("Fetch.requestPaused", fetchHandler);
        fetchListenerInstalled = false;
      }
      if (webSocketBlockEnabled) {
        try {
          await cdpSession.send("Network.setBlockedURLs", { urls: [] });
          webSocketBlockEnabled = false;
        } catch (error) {
          failures.push(error);
        }
      }
      if (!webSocketBlockEnabled && webSocketListenerInstalled) {
        cdpSession.off("Network.webSocketCreated", webSocketHandler);
        webSocketListenerInstalled = false;
      }
      if (frameListenerInstalled) {
        cdpSession.off("Page.frameNavigated", frameNavigatedHandler);
        frameListenerInstalled = false;
      }
      if (serviceWorkerBypassEnabled) {
        try {
          await cdpSession.send("Network.setBypassServiceWorker", { bypass: false });
          serviceWorkerBypassEnabled = false;
        } catch (error) {
          failures.push(error);
        }
      }
      if (
        failures.length === 0 &&
        !fetchEnabled &&
        !webSocketBlockEnabled &&
        !serviceWorkerBypassEnabled
      ) {
        try {
          await cdpSession.detach();
          cdpSession = undefined;
        } catch (error) {
          failures.push(error);
        }
      }
    }
    if (failures.length > 0) {
      throw new DiscoveryPolicyGuardError("policy_guard_unavailable");
    }
  };

  try {
    cdpSession = await context.newCDPSession(page);
    const frameTree = (await cdpSession.send("Page.getFrameTree")) as FrameTreeResult;
    mainFrameId = frameTree.frameTree.frame.id;
    cdpSession.on("Page.frameNavigated", frameNavigatedHandler);
    frameListenerInstalled = true;
    await cdpSession.send("Network.enable");
    await cdpSession.send("Network.setBypassServiceWorker", { bypass: true });
    serviceWorkerBypassEnabled = true;
    cdpSession.on("Network.webSocketCreated", webSocketHandler);
    webSocketListenerInstalled = true;
    await cdpSession.send("Network.setBlockedURLs", { urls: ["ws://*", "wss://*"] });
    webSocketBlockEnabled = true;
    cdpSession.on("Fetch.requestPaused", fetchHandler);
    fetchListenerInstalled = true;
    await cdpSession.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    fetchEnabled = true;
    await context.route(ROUTE_MATCHER, popupRouteHandler);
    popupRouteInstalled = true;
    context.on("page", popupHandler);
    popupListenerInstalled = true;
    page.on("download", downloadHandler);
    downloadListenerInstalled = true;
  } catch {
    let cleanupFinished = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await cleanup();
        cleanupFinished = true;
        break;
      } catch {
        await Promise.resolve();
      }
    }
    throw new DiscoveryPolicyGuardError(
      "policy_guard_unavailable",
      DISCOVERY_POLICY_SUMMARIES.policy_guard_unavailable,
      cleanupFinished ? undefined : cleanup,
    );
  }

  return {
    arm(permit) {
      if (disposed) {
        throw new DiscoveryPolicyGuardError(
          "policy_guard_unavailable",
          "Discovery policy guard is disposed.",
        );
      }
      if (unhealthy) {
        throw new DiscoveryPolicyGuardError(
          "policy_guard_unavailable",
          "Discovery policy guard is unavailable.",
        );
      }
      if (activePermit !== undefined) {
        throw new DiscoveryPolicyGuardError(
          "policy_guard_unavailable",
          "Discovery policy guard already has an active action.",
        );
      }
      if (consumedTokens.has(permit.token)) {
        throw new DiscoveryPolicyGuardError(
          "policy_guard_unavailable",
          "Discovery policy permit has already been consumed.",
        );
      }
      consumedTokens.add(permit.token);
      activePermit = permit;
      activeViolation = undefined;
      activeBlockedNetwork = createBlockedNetworkAccumulator();
      markActivity();
    },
    async finishAction() {
      markActivity();
      const deadline = Date.now() + ACTION_SETTLE_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (pendingInterceptions.size > 0 || pendingSideEffects.size > 0) {
          const pending = Promise.all([...pendingInterceptions, ...pendingSideEffects]);
          const remaining = Math.max(0, deadline - Date.now());
          let timeout: ReturnType<typeof setTimeout> | undefined;
          const completed = await Promise.race([
            pending.then(() => true),
            new Promise<false>((resolve) => {
              timeout = setTimeout(() => resolve(false), remaining);
            }),
          ]);
          if (timeout !== undefined) clearTimeout(timeout);
          if (!completed) {
            unhealthy = true;
            activeViolation = {
              code: "policy_guard_unavailable",
              summary: DISCOVERY_POLICY_SUMMARIES.policy_guard_unavailable,
            };
            break;
          }
          continue;
        }
        if (Date.now() - lastActivityAt >= ACTION_QUIET_PERIOD_MS) break;
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      const currentOrigin = safeRequestOrigin(page.url());
      if (currentOrigin === undefined) {
        unsafePageState = true;
        recordViolation("unsafe_navigation_blocked");
      } else if (!policy.allowedOrigins.has(currentOrigin)) {
        unsafePageState = true;
        recordViolation("origin_not_allowed");
      }
      if (unsafePageState) {
        try {
          await page.goto(lastSafePageOrigin, { waitUntil: "domcontentloaded", timeout: 500 });
          unsafePageState = false;
        } catch {
          unhealthy = true;
          recordViolation("policy_guard_unavailable");
        }
      }
      const violation = withBlockedNetworkEvidence(activeViolation, activeBlockedNetwork);
      activePermit = undefined;
      activeViolation = undefined;
      activeBlockedNetwork = createBlockedNetworkAccumulator();
      return violation;
    },
    checkForViolation() {
      const violation = withBlockedNetworkEvidence(idleViolation, idleBlockedNetwork);
      idleViolation = undefined;
      idleBlockedNetwork = createBlockedNetworkAccumulator();
      return violation;
    },
    async dispose() {
      if (disposed) return;
      if (
        activePermit !== undefined ||
        (!unhealthy && (pendingInterceptions.size > 0 || pendingSideEffects.size > 0))
      ) {
        throw new DiscoveryPolicyGuardError(
          "policy_guard_unavailable",
          "Discovery policy guard has an active action.",
        );
      }
      await cleanup();
      disposed = true;
    },
  };
}

function requireIsolatedChromiumPage(context: BrowserContext, page: Page): void {
  const pages = context.pages();
  if (pages.length !== 1 || pages[0] !== page) {
    throw new DiscoveryPolicyGuardError("policy_guard_unavailable");
  }
}

function safeRequestOrigin(value: string): string | undefined {
  if (hasCredentialLikeUrlData(value)) return undefined;
  return normalizeHttpOrigin(value);
}
