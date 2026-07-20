import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import type { WalkthroughPlanStep } from "./index.js";
import {
  WalkthroughValidationRunnerError,
  type WalkthroughValidationBrowserRunner,
  type WalkthroughValidationMatch,
  type WalkthroughValidationPageState,
} from "./walkthroughValidation.js";

type Candidate = WalkthroughValidationMatch & {
  locator: Locator;
};

export type PlaywrightValidationRunnerOptions = {
  viewport?: { width: number; height: number };
  timeoutMs?: number;
  stabilityMs?: number;
};

export function createPlaywrightValidationRunner(
  options: PlaywrightValidationRunnerOptions = {},
): WalkthroughValidationBrowserRunner {
  return new PlaywrightValidationRunner(options);
}

class PlaywrightValidationRunner implements WalkthroughValidationBrowserRunner {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private candidates = new Map<string, Candidate>();
  private blockedUnsafeRequest = false;

  constructor(private readonly options: PlaywrightValidationRunnerOptions) {}

  async open(url: string): Promise<void> {
    this.browser = await chromium.launch();
    this.context = await this.browser.newContext({
      viewport: this.options.viewport ?? { width: 1280, height: 720 },
      serviceWorkers: "block",
    });
    await this.context.route("**/*", async (route) => {
      const method = route.request().method().toUpperCase();
      if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
        await route.continue();
        return;
      }
      this.blockedUnsafeRequest = true;
      await route.abort("blockedbyclient");
    });
    await this.context.routeWebSocket(/^wss?:\/\//, (webSocket) => {
      this.blockedUnsafeRequest = true;
      webSocket.close({ code: 1008, reason: "Blocked during walkthrough validation." });
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.timeoutMs);

    try {
      await this.page.goto(url, { waitUntil: "domcontentloaded" });
      await this.page
        .waitForLoadState("networkidle", { timeout: Math.min(this.timeoutMs, 1000) })
        .catch(() => undefined);
    } catch {
      throw new WalkthroughValidationRunnerError("navigation_failed");
    }
  }

  async inspectPage(): Promise<WalkthroughValidationPageState> {
    this.assertNoUnsafeRequest();
    const page = this.requirePage();
    const title = await page.title();
    const bodyText = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    const hasPasswordField = (await page.locator('input[type="password"]').count()) > 0;
    const authLanguage = /\b(sign in|log in|login|authenticate|authentication)\b/i;

    return {
      url: page.url(),
      title,
      authWall: hasPasswordField && authLanguage.test(`${title}\n${bodyText}`),
    };
  }

  async navigate(url: string): Promise<void> {
    this.assertNoUnsafeRequest();
    try {
      await this.requirePage().goto(url, { waitUntil: "domcontentloaded" });
    } catch {
      throw new WalkthroughValidationRunnerError("navigation_failed");
    }
  }

  async findMatches(step: WalkthroughPlanStep): Promise<WalkthroughValidationMatch[]> {
    const page = this.requirePage();
    const targetText = targetTextForStep(step);
    this.candidates.clear();

    if (targetText.length === 0) {
      return [];
    }

    if (step.targetHint?.structure !== undefined) {
      const locators = await structuralTargetLocators(page, step.targetHint);
      const candidates: Candidate[] = [];
      for (const locator of locators) {
        candidates.push({
          id: `candidate-${candidates.length + 1}`,
          label: targetText,
          ...(step.targetHint.role === undefined ? {} : { role: step.targetHint.role }),
          targetHint: structuredClone(step.targetHint),
          locator,
        });
      }
      candidates.forEach((candidate) => this.candidates.set(candidate.id, candidate));
      return candidates.map(({ locator: _locator, ...match }) => match);
    }

    const strategies = matchingStrategies(page, step, targetText);
    for (const strategy of strategies) {
      let candidates = await visibleCandidates(strategy.locator, targetText, strategy.role);
      if (step.targetHint?.role !== undefined) {
        candidates = candidates.filter((candidate) => candidate.role === step.targetHint?.role);
      }
      if (step.targetHint?.occurrence !== undefined) {
        const selected = candidates[step.targetHint.occurrence - 1];
        candidates = selected === undefined ? [] : [selected];
      }
      if (candidates.length === 0) {
        continue;
      }

      candidates.forEach((candidate, index) => {
        candidate.id = `candidate-${index + 1}`;
        this.candidates.set(candidate.id, candidate);
      });
      return candidates.map(({ locator: _locator, ...match }) => match);
    }

    return [];
  }

  async click(match: WalkthroughValidationMatch): Promise<void> {
    this.assertNoUnsafeRequest();
    await this.requireCandidate(match).locator.click();
  }

  async type(match: WalkthroughValidationMatch): Promise<void> {
    this.assertNoUnsafeRequest();
    await this.requireCandidate(match).locator.fill("typed value redacted");
  }

  async waitForIdle(): Promise<void> {
    const page = this.requirePage();
    await page.waitForLoadState("domcontentloaded", { timeout: this.timeoutMs });
    await waitForDomStability(page, this.timeoutMs, this.options.stabilityMs ?? 500);
    this.assertNoUnsafeRequest();
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.context = undefined;
    this.browser = undefined;
    this.page = undefined;
    this.candidates.clear();
    this.blockedUnsafeRequest = false;
  }

  private get timeoutMs(): number {
    return this.options.timeoutMs ?? 3000;
  }

  private requirePage(): Page {
    if (this.page === undefined) {
      throw new Error("Validation browser is not open.");
    }
    return this.page;
  }

  private requireCandidate(match: WalkthroughValidationMatch): Candidate {
    const candidate = this.candidates.get(match.id);
    if (candidate === undefined) {
      throw new Error("Validation candidate is no longer available.");
    }
    return candidate;
  }

  private assertNoUnsafeRequest(): void {
    if (this.blockedUnsafeRequest) {
      throw new WalkthroughValidationRunnerError("unsafe_action");
    }
  }
}

async function structuralTargetLocators(
  page: Page,
  target: NonNullable<WalkthroughPlanStep["targetHint"]>,
): Promise<Locator[]> {
  const structure = target.structure;
  if (structure === undefined) return [];
  const containerLocator = page.getByRole(
    structure.container.role as Parameters<Page["getByRole"]>[0],
    structure.container.label === undefined
      ? undefined
      : { name: structure.container.label, exact: true },
  );
  let containers = await visibleLocatorArray(containerLocator);
  if (structure.container.occurrence !== undefined) {
    const selected = containers[structure.container.occurrence - 1];
    containers = selected === undefined ? [] : [selected];
  }
  const matches: Locator[] = [];
  for (const container of containers) {
    if (structure.item === undefined) {
      const locator =
        target.role === undefined
          ? container.getByText(target.label, { exact: true })
          : container.getByRole(target.role as Parameters<Locator["getByRole"]>[0], {
              name: target.label,
              exact: true,
            });
      matches.push(...(await visibleLocatorArray(locator)));
      continue;
    }
    if (target.role === undefined) continue;
    let items = await visibleStructuralItems(container, structure.item.role);
    if (structure.item.promotion === "exclude-marked-promoted") {
      const promotionFlags = await Promise.all(
        items.map((item) =>
          item.evaluate((element) => {
            const marker = /^(sponsored|promoted|ad|advertisement)$/i;
            return Array.from(element.childNodes).some((child) =>
              marker.test((child.textContent ?? "").replace(/\s+/g, " ").trim()),
            );
          }),
        ),
      );
      items = items.filter((_item, index) => !promotionFlags[index]);
    }
    const item = items[structure.item.position - 1];
    if (item === undefined) continue;
    matches.push(
      ...(await visibleLocatorArray(
        item.getByRole(target.role as Parameters<Locator["getByRole"]>[0]),
      )),
    );
  }
  return matches.slice(0, 100);
}

async function visibleStructuralItems(
  container: Locator,
  itemRole: "listitem" | "article",
): Promise<Locator[]> {
  const items = await visibleLocatorArray(
    container.getByRole(itemRole as Parameters<Locator["getByRole"]>[0]),
  );
  const containerElement = await container.elementHandle();
  if (containerElement === null) return [];
  const direct: Locator[] = [];
  for (const item of items) {
    const belongs = await item.evaluate((element, expectedContainer) => {
      const explicit = (candidate: Element) => candidate.getAttribute("role")?.toLowerCase();
      let depth = 0;
      for (
        let current = element.parentElement;
        current !== null && depth < 32;
        current = current.parentElement, depth += 1
      ) {
        const role = explicit(current);
        const structural =
          ["form", "region", "main", "list", "feed"].includes(role ?? "") ||
          ["FORM", "MAIN", "UL", "OL"].includes(current.tagName);
        if (structural) return current === expectedContainer;
      }
      return false;
    }, containerElement);
    if (belongs) direct.push(item);
  }
  return direct;
}

async function visibleLocatorArray(locator: Locator): Promise<Locator[]> {
  const count = Math.min(await locator.count().catch(() => 0), 100);
  const visible: Locator[] = [];
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) visible.push(candidate);
  }
  return visible;
}

function matchingStrategies(
  page: Page,
  step: WalkthroughPlanStep,
  targetText: string,
): Array<{ locator: Locator; role?: string }> {
  if (step.action === "type") {
    return [
      { locator: page.getByLabel(targetText, { exact: true }), role: "textbox" },
      { locator: page.getByPlaceholder(targetText, { exact: true }), role: "textbox" },
      { locator: page.getByRole("textbox", { name: targetText, exact: true }), role: "textbox" },
      { locator: page.locator(fieldNameSelector(targetText)), role: "textbox" },
    ];
  }

  return [
    { locator: page.getByText(targetText, { exact: true }) },
    { locator: page.getByRole("button", { name: targetText, exact: true }), role: "button" },
    { locator: page.getByRole("link", { name: targetText, exact: true }), role: "link" },
  ];
}

async function visibleCandidates(
  locator: Locator,
  label: string,
  fallbackRole?: string,
): Promise<Candidate[]> {
  const count = await locator.count().catch(() => 0);
  const candidates: Candidate[] = [];
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (!(await item.isVisible().catch(() => false))) {
      continue;
    }
    const role = fallbackRole ?? (await inferredRole(item));
    const actionRisk = await inferredActionRisk(item);
    candidates.push({
      id: "",
      label,
      ...(role === undefined ? {} : { role }),
      ...(actionRisk === undefined ? {} : { actionRisk }),
      locator: item,
    });
  }
  if (candidates.length > 1) {
    candidates.forEach((candidate, index) => {
      const kind = candidate.role ?? "target";
      candidate.targetHint = {
        kind: "accessible",
        label,
        ...(candidate.role === undefined ? {} : { role: candidate.role }),
        occurrence: index + 1,
      };
      candidate.label = `${candidate.label} (${kind} ${index + 1} of ${candidates.length})`;
    });
  } else if (candidates[0] !== undefined) {
    candidates[0].targetHint = {
      kind: "accessible",
      label,
      ...(candidates[0].role === undefined ? {} : { role: candidates[0].role }),
    };
  }
  return candidates;
}

async function waitForDomStability(
  page: Page,
  timeoutMs: number,
  stabilityMs: number,
): Promise<void> {
  const body = page.locator("body");
  const pollMs = 50;
  const quietWindowMs = Math.min(stabilityMs, timeoutMs);
  const deadline = Date.now() + timeoutMs;
  let previous = await body.evaluate((element) => element.innerHTML);
  let stableSince = Date.now();

  while (Date.now() < deadline) {
    await page.waitForTimeout(pollMs);
    const current = await body.evaluate((element) => element.innerHTML);
    if (current !== previous) {
      previous = current;
      stableSince = Date.now();
      continue;
    }
    if (Date.now() - stableSince >= quietWindowMs) {
      return;
    }
  }

  throw new Error("Validation page did not reach a stable DOM state.");
}

async function inferredActionRisk(
  locator: Locator,
): Promise<WalkthroughValidationMatch["actionRisk"]> {
  return await locator
    .evaluate((element) => {
      const control = element.closest('button, input, [role="button"]');
      if (control === null || control.closest("form") === null) {
        return undefined;
      }

      const tagName = control.tagName;
      const explicitType = control.getAttribute("type")?.toLowerCase();
      const submitsForm =
        (tagName === "BUTTON" && (explicitType === undefined || explicitType === "submit")) ||
        (tagName === "INPUT" && (explicitType === "submit" || explicitType === "image"));
      return submitsForm ? "potentially-mutating" : undefined;
    })
    .catch(() => undefined);
}

async function inferredRole(locator: Locator): Promise<string | undefined> {
  return await locator
    .evaluate((element) => {
      const explicitRole = element.getAttribute("role");
      if (explicitRole !== null) {
        return explicitRole;
      }
      switch (element.tagName) {
        case "BUTTON":
          return "button";
        case "A":
          return "link";
        case "INPUT":
        case "TEXTAREA":
          return "textbox";
        default:
          return undefined;
      }
    })
    .catch(() => undefined);
}

function fieldNameSelector(targetText: string): string {
  const escaped = targetText.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `input[name="${escaped}"], textarea[name="${escaped}"]`;
}

function targetTextForStep(step: WalkthroughPlanStep): string {
  if (step.targetHint !== undefined) {
    return step.targetHint.label;
  }
  return step.public.summary
    .replace(/^Click\s+/i, "")
    .replace(/^(Verify|See|Assert|Check)\s+/i, "")
    .replace(/^(Type|Enter|Fill)\s+\[redacted\]\s+into\s+/i, "")
    .replace(/[.!?]$/, "")
    .trim();
}
