import {
  chromium,
  type Browser,
  type BrowserContext,
  type Download,
  type Locator,
  type Page,
  type Route,
} from "playwright";
import { hasCredentialLikeUrlData } from "./actionSafety.js";
import { DISCOVERY_LIMITS, type DiscoveryInteractiveTarget } from "./discoveryContract.js";
import {
  authorizeDiscoveryPolicyAction,
  validateDiscoveryPolicy,
  type DiscoveryPolicy,
  type DiscoveryPolicyPermit,
  type DiscoveryRuntimeTargetRisk,
  type ValidatedDiscoveryPolicy,
} from "./discoveryPolicy.js";
import {
  DiscoveryReplayBrowserError,
  type DiscoveryReplayBrowser,
  type DiscoveryReplayBrowserFactory,
  type DiscoveryReplayMatch,
} from "./discoveryReplay.js";
import {
  installPlaywrightDiscoveryPolicyGuard,
  type PlaywrightDiscoveryPolicyGuard,
} from "./playwrightDiscoveryPolicyGuard.js";
import { classifyDiscoveryNetworkRequest } from "./discoveryNetworkClassification.js";
import { decideDiscoveryNetworkRequest } from "./discoveryNetworkPolicy.js";
import type { WalkthroughPlanAssertion, WalkthroughPlanTargetHint } from "./index.js";

const MAX_RUNTIME_MATCHES = DISCOVERY_LIMITS.interactiveTargetsPerObservation;

export type PlaywrightDiscoveryReplayOptions = {
  viewport?: { width: number; height: number };
  actionTimeoutMs?: number;
  stabilityDurationMs?: number;
};

type ResolvedPlaywrightDiscoveryReplayOptions = {
  viewport: { width: number; height: number };
  actionTimeoutMs: number;
  stabilityDurationMs: number;
};

export function createPlaywrightDiscoveryReplayBrowserFactory(
  options: PlaywrightDiscoveryReplayOptions = {},
): DiscoveryReplayBrowserFactory {
  const resolvedOptions = validateOptions(options);
  return {
    async create({ policy }) {
      return new PlaywrightDiscoveryReplayBrowser(policy, resolvedOptions);
    },
  };
}

class PlaywrightDiscoveryReplayBrowser implements DiscoveryReplayBrowser {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private guard?: PlaywrightDiscoveryPolicyGuard;
  private validatedPolicy?: ValidatedDiscoveryPolicy;
  private readonly locators = new Map<string, Locator>();
  private routedWebSocketViolation = false;
  private nextMatchId = 1;

  constructor(
    private readonly policy: DiscoveryPolicy,
    private readonly options: ResolvedPlaywrightDiscoveryReplayOptions,
  ) {}

  async open(url: string): Promise<void> {
    if (this.browser !== undefined) throw new DiscoveryReplayBrowserError("replay_setup_failed");
    const validation = validateDiscoveryPolicy(this.policy, url);
    if (!validation.ok || (validation.policy.mode !== "yolo" && hasCredentialLikeUrlData(url))) {
      throw new DiscoveryReplayBrowserError("policy_blocked");
    }
    this.validatedPolicy = validation.policy;
    let bootstrapViolation = false;
    try {
      this.browser = await chromium.launch({ headless: true });
      this.context = await this.browser.newContext({
        ...(validation.policy.mode === "yolo" ? {} : { serviceWorkers: "block" as const }),
        viewport: this.options.viewport,
      });
      this.context.setDefaultTimeout(this.options.actionTimeoutMs);
      this.context.setDefaultNavigationTimeout(this.options.actionTimeoutMs);
      if (validation.policy.mode === "yolo") {
        this.page = await this.context.newPage();
        await this.page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: this.options.actionTimeoutMs,
        });
        await this.page.waitForTimeout(this.options.stabilityDurationMs);
        return;
      }
      let bootstrapActive = true;
      await this.context.routeWebSocket("**/*", async (socket) => {
        this.routedWebSocketViolation = true;
        if (bootstrapActive) bootstrapViolation = true;
        await socket.close({ code: 1008, reason: "blocked" });
      });
      this.page = await this.context.newPage();
      const popup = (popupPage: Page) => {
        if (!bootstrapActive || popupPage === this.page) return;
        bootstrapViolation = true;
        void popupPage.close().catch(() => undefined);
      };
      const download = (value: Download) => {
        if (!bootstrapActive) return;
        bootstrapViolation = true;
        void value.cancel().catch(() => undefined);
      };
      this.context.on("page", popup);
      this.page.on("download", download);
      const bootstrap = async (route: Route) => {
        if (!(await this.bootstrapRoute(route, validation.policy))) bootstrapViolation = true;
      };
      await this.context.route("**/*", bootstrap);
      try {
        await this.page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: this.options.actionTimeoutMs,
        });
        let finalOrigin: string | undefined;
        try {
          finalOrigin = new URL(this.page.url()).origin;
        } catch {
          finalOrigin = undefined;
        }
        if (finalOrigin === undefined || !validation.policy.allowedOrigins.has(finalOrigin)) {
          bootstrapViolation = true;
        }
        await this.page.waitForTimeout(this.options.stabilityDurationMs);
        this.guard = await installPlaywrightDiscoveryPolicyGuard(this.page, validation.policy);
        if (bootstrapViolation) throw new DiscoveryReplayBrowserError("policy_blocked");
      } finally {
        bootstrapActive = false;
        await this.context.unroute("**/*", bootstrap);
        this.context.off("page", popup);
        this.page.off("download", download);
      }
    } catch (error) {
      await this.close();
      if (error instanceof DiscoveryReplayBrowserError) throw error;
      if (bootstrapViolation) throw new DiscoveryReplayBrowserError("policy_blocked");
      throw new DiscoveryReplayBrowserError("replay_setup_failed");
    }
  }

  async findMatches(target: WalkthroughPlanTargetHint): Promise<DiscoveryReplayMatch[]> {
    const page = this.requirePage();
    let locator: Locator;
    if (target.role !== undefined) {
      locator = page.getByRole(target.role as Parameters<Page["getByRole"]>[0], {
        name: target.label,
        exact: true,
      });
    } else {
      const labelled = page.getByLabel(target.label, { exact: true });
      const button = page.getByRole("button", { name: target.label, exact: true });
      locator =
        (await labelled.count()) > 0
          ? labelled
          : (await button.count()) > 0
            ? button
            : page.getByText(target.label, { exact: true });
    }
    const matches: DiscoveryReplayMatch[] = [];
    const count = Math.min(await locator.count(), MAX_RUNTIME_MATCHES);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (!(await candidate.isVisible().catch(() => false))) continue;
      const id = `match-${this.nextMatchId++}`;
      this.locators.set(id, candidate);
      matches.push({
        id,
        label: target.label,
        ...(target.role === undefined ? {} : { role: target.role }),
        occurrence: matches.length + 1,
      });
    }
    return matches;
  }

  async navigate(url: string): Promise<void> {
    const page = this.requirePage();
    const permit = this.authorize({ kind: "navigate", url });
    await this.guarded(
      permit,
      async () => {
        await page.goto(url, { waitUntil: "domcontentloaded" });
      },
      "navigation_failed",
    );
  }

  async click(match: DiscoveryReplayMatch): Promise<void> {
    const locator = this.requireLocator(match);
    const { target, risk } = await inspectTarget(locator, match);
    const permit = this.authorize({ kind: "click", targetId: target.id }, target, risk);
    await this.guarded(permit, () => locator.click(), "action_failed");
  }

  async type(match: DiscoveryReplayMatch, value: string): Promise<void> {
    const locator = this.requireLocator(match);
    const { target, risk } = await inspectTarget(locator, match);
    const permit = this.authorize(
      { kind: "type", targetId: target.id, inputBinding: "replay", valueClass: "demo-data" },
      target,
      risk,
    );
    await this.guarded(permit, () => locator.fill(value), "action_failed");
  }

  async wait(durationMs: number): Promise<void> {
    await this.requirePage().waitForTimeout(durationMs);
    this.assertNoIdleViolation();
  }

  async waitForSettled(): Promise<void> {
    await this.requirePage().waitForLoadState("domcontentloaded");
    await this.requirePage().waitForTimeout(this.options.stabilityDurationMs);
    this.assertNoIdleViolation();
  }

  async assertVisible(
    assertion: Extract<WalkthroughPlanAssertion, { kind: "visible-state" }>,
  ): Promise<void> {
    const page = this.requirePage();
    const locator =
      assertion.role === undefined
        ? page.getByText(assertion.condition, { exact: true })
        : page.getByRole(assertion.role as Parameters<Page["getByRole"]>[0], {
            name: assertion.condition,
            exact: true,
          });
    const selected =
      assertion.occurrence === undefined ? locator : locator.nth(assertion.occurrence - 1);
    if (
      (await selected.count()) === 0 ||
      !(await selected
        .first()
        .isVisible()
        .catch(() => false))
    ) {
      throw new DiscoveryReplayBrowserError("visible_state_mismatch");
    }
    this.assertNoIdleViolation();
  }

  async assertNavigation(
    assertion: Extract<WalkthroughPlanAssertion, { kind: "navigation" }>,
  ): Promise<void> {
    const actual = new URL(this.requirePage().url());
    const expected = new URL(assertion.url);
    const matches =
      assertion.match === "exact-url"
        ? actual.href === expected.href
        : actual.origin === expected.origin && actual.pathname === expected.pathname;
    if (!matches) throw new DiscoveryReplayBrowserError("navigation_mismatch");
    this.assertNoIdleViolation();
  }

  async inspectPage(): Promise<{ url: string }> {
    return { url: this.requirePage().url() };
  }

  async close(): Promise<void> {
    await this.guard?.dispose().catch(() => undefined);
    this.guard = undefined;
    await this.context?.close().catch(() => undefined);
    this.context = undefined;
    await this.browser?.close().catch(() => undefined);
    this.browser = undefined;
    this.page = undefined;
    this.locators.clear();
  }

  private async bootstrapRoute(route: Route, policy: ValidatedDiscoveryPolicy): Promise<boolean> {
    const request = route.request();
    let origin: string;
    try {
      origin = new URL(request.url()).origin;
    } catch {
      await route.abort("blockedbyclient");
      return false;
    }
    let isMainFrame = false;
    try {
      isMainFrame = request.frame() === this.requirePage().mainFrame();
    } catch {
      // Service-worker and early navigation requests may not have a frame.
    }
    const classification = classifyDiscoveryNetworkRequest({
      method: request.method(),
      resourceType: request.resourceType(),
      isNavigationRequest: request.isNavigationRequest(),
      isMainFrame,
      isServiceWorker: request.serviceWorker() !== null,
      currentOrigin: safePageOrigin(this.requirePage().url()),
      requestOrigin: origin,
    });
    const decision = decideDiscoveryNetworkRequest({
      policy,
      classification,
      requestOrigin: origin,
      actionActive: false,
    });
    if (decision.decision === "block") {
      await route.abort("blockedbyclient");
      return false;
    }
    await route.fallback();
    return true;
  }

  private authorize(
    action: Parameters<typeof authorizeDiscoveryPolicyAction>[0]["action"],
    target?: DiscoveryInteractiveTarget,
    risk?: DiscoveryRuntimeTargetRisk,
  ): DiscoveryPolicyPermit {
    const authorization = authorizeDiscoveryPolicyAction({
      policy: this.validatedPolicy!,
      observationUrl: this.requirePage().url(),
      action,
      ...(target === undefined ? {} : { target }),
      ...(risk === undefined ? {} : { risk }),
    });
    if (authorization.decision === "block") throw new DiscoveryReplayBrowserError("policy_blocked");
    return authorization.permit;
  }

  private async guarded(
    permit: DiscoveryPolicyPermit,
    action: () => Promise<unknown>,
    failureCode: "navigation_failed" | "action_failed",
  ): Promise<void> {
    if (this.validatedPolicy?.mode === "yolo") {
      try {
        await action();
        return;
      } catch {
        throw new DiscoveryReplayBrowserError(failureCode);
      }
    }
    const guard = this.guard;
    if (guard === undefined) throw new DiscoveryReplayBrowserError("browser_closed");
    guard.arm(permit);
    try {
      await action();
    } catch {
      const violation = await guard
        .finishAction()
        .catch(() => ({ code: "policy_guard_unavailable" }));
      if (violation !== undefined || this.consumeRoutedWebSocketViolation()) {
        throw new DiscoveryReplayBrowserError("policy_blocked");
      }
      throw new DiscoveryReplayBrowserError(failureCode);
    }
    if ((await guard.finishAction()) !== undefined || this.consumeRoutedWebSocketViolation())
      throw new DiscoveryReplayBrowserError("policy_blocked");
  }

  private requirePage(): Page {
    if (this.page === undefined) throw new DiscoveryReplayBrowserError("browser_closed");
    return this.page;
  }

  private requireLocator(match: DiscoveryReplayMatch): Locator {
    const locator = this.locators.get(match.id);
    if (locator === undefined) throw new DiscoveryReplayBrowserError("candidate_not_found");
    return locator;
  }

  private assertNoIdleViolation(): void {
    if (this.guard?.checkForViolation() !== undefined || this.consumeRoutedWebSocketViolation()) {
      throw new DiscoveryReplayBrowserError("policy_blocked");
    }
  }

  private consumeRoutedWebSocketViolation(): boolean {
    const violation = this.routedWebSocketViolation;
    this.routedWebSocketViolation = false;
    return violation;
  }
}

function safePageOrigin(value: string): string | undefined {
  if (hasCredentialLikeUrlData(value)) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function validateOptions(
  options: PlaywrightDiscoveryReplayOptions,
): ResolvedPlaywrightDiscoveryReplayOptions {
  const viewport = options.viewport ?? { width: 1280, height: 720 };
  const actionTimeoutMs = options.actionTimeoutMs ?? 5_000;
  const stabilityDurationMs = options.stabilityDurationMs ?? 200;
  if (
    !boundedInteger(viewport.width, 1, 4096) ||
    !boundedInteger(viewport.height, 1, 4096) ||
    !boundedInteger(actionTimeoutMs, 1, 60_000) ||
    !boundedInteger(stabilityDurationMs, 1, 5_000)
  ) {
    throw new DiscoveryReplayBrowserError("replay_setup_failed");
  }
  return { viewport: { ...viewport }, actionTimeoutMs, stabilityDurationMs };
}

function boundedInteger(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= minimum && value <= maximum;
}

async function inspectTarget(
  locator: Locator,
  match: DiscoveryReplayMatch,
): Promise<{ target: DiscoveryInteractiveTarget; risk: DiscoveryRuntimeTargetRisk }> {
  const inspected = await locator.evaluate((element) => {
    const input = element instanceof HTMLInputElement ? element : undefined;
    const autocomplete = input?.autocomplete.toLowerCase() ?? "";
    const control = element.closest("button, input");
    const explicitType = control?.getAttribute("type")?.toLowerCase();
    return {
      disabled: element.getAttribute("aria-disabled") === "true" || element.matches(":disabled"),
      credential:
        input?.type.toLowerCase() === "password" ||
        /(^|\s)(username|current-password|new-password|one-time-code)(\s|$)/.test(autocomplete),
      sensitivePayment: autocomplete.split(/\s+/).some((token) => /^cc-/.test(token)),
      upload: input?.type.toLowerCase() === "file",
      submitsForm:
        control?.closest("form") !== null &&
        ((control?.tagName === "BUTTON" &&
          (explicitType === undefined || explicitType === "submit")) ||
          (control?.tagName === "INPUT" &&
            (explicitType === "submit" || explicitType === "image"))),
    };
  });
  return {
    target: {
      id: match.id,
      label: match.label,
      ...(match.role === undefined ? {} : { role: match.role }),
      ...(match.occurrence === undefined ? {} : { occurrence: match.occurrence }),
      disabled: inspected.disabled,
      ...(inspected.submitsForm ? { actionRisk: "potentially-mutating" } : {}),
    },
    risk: {
      credential: inspected.credential,
      sensitivePayment: inspected.sensitivePayment,
      upload: inspected.upload,
    },
  };
}
