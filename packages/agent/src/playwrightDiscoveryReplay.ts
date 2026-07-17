import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Route,
} from "playwright";
import type { DiscoveryInteractiveTarget } from "./discoveryContract.js";
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
import type { WalkthroughPlanAssertion, WalkthroughPlanTargetHint } from "./index.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function createPlaywrightDiscoveryReplayBrowserFactory(): DiscoveryReplayBrowserFactory {
  return {
    async create({ policy }) {
      return new PlaywrightDiscoveryReplayBrowser(policy);
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
  private nextMatchId = 1;

  constructor(private readonly policy: DiscoveryPolicy) {}

  async open(url: string): Promise<void> {
    if (this.browser !== undefined) throw new DiscoveryReplayBrowserError("replay_setup_failed");
    const validation = validateDiscoveryPolicy(this.policy, url);
    if (!validation.ok) throw new DiscoveryReplayBrowserError("policy_blocked");
    this.validatedPolicy = validation.policy;
    try {
      this.browser = await chromium.launch({ headless: true });
      this.context = await this.browser.newContext({ serviceWorkers: "block" });
      this.page = await this.context.newPage();
      const bootstrap = (route: Route) => this.bootstrapRoute(route, validation.policy);
      await this.context.route("**/*", bootstrap);
      try {
        await this.page.goto(url, { waitUntil: "domcontentloaded" });
      } finally {
        await this.context.unroute("**/*", bootstrap);
      }
      this.guard = await installPlaywrightDiscoveryPolicyGuard(this.page, validation.policy);
    } catch (error) {
      await this.close();
      if (error instanceof DiscoveryReplayBrowserError) throw error;
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
      locator =
        (await labelled.count()) > 0 ? labelled : page.getByText(target.label, { exact: true });
    }
    const matches: DiscoveryReplayMatch[] = [];
    for (let index = 0; index < (await locator.count()); index += 1) {
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
  }

  async waitForSettled(): Promise<void> {
    await this.requirePage().waitForLoadState("domcontentloaded");
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

  private async bootstrapRoute(route: Route, policy: ValidatedDiscoveryPolicy): Promise<void> {
    const request = route.request();
    let origin: string;
    try {
      origin = new URL(request.url()).origin;
    } catch {
      await route.abort("blockedbyclient");
      return;
    }
    if (!policy.allowedOrigins.has(origin) || !SAFE_METHODS.has(request.method().toUpperCase())) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
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
    const guard = this.guard;
    if (guard === undefined) throw new DiscoveryReplayBrowserError("browser_closed");
    guard.arm(permit);
    try {
      await action();
    } catch {
      const violation = await guard
        .finishAction()
        .catch(() => ({ code: "policy_guard_unavailable" }));
      if (violation !== undefined) throw new DiscoveryReplayBrowserError("policy_blocked");
      throw new DiscoveryReplayBrowserError(failureCode);
    }
    if ((await guard.finishAction()) !== undefined)
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
