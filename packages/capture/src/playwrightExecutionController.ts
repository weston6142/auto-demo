import type { Locator, Page } from "playwright";
import type {
  BrowserCaptureController,
  BrowserExecutionTarget,
  BrowserNavigationExpectation,
} from "./index.js";

export type PlaywrightExecutionControllerOptions = {
  timeoutMs?: number;
};

export class PlaywrightExecutionControllerError extends Error {
  constructor(
    readonly code:
      | "target_not_found"
      | "ambiguous_target"
      | "navigation_failed"
      | "action_failed"
      | "assertion_failed"
      | "execution_timeout",
  ) {
    super(code);
    this.name = "PlaywrightExecutionControllerError";
  }
}

export function createPlaywrightExecutionController(
  page: Page,
  options: PlaywrightExecutionControllerOptions = {},
): BrowserCaptureController {
  const timeoutMs = options.timeoutMs ?? 10_000;
  return {
    async navigate(url) {
      if (!isSafeNavigationUrl(url)) {
        throw new PlaywrightExecutionControllerError("navigation_failed");
      }
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      } catch {
        throw new PlaywrightExecutionControllerError("navigation_failed");
      }
    },
    async click(target) {
      const locator = await requireOneVisibleTarget(page, target, timeoutMs);
      try {
        await locator.click({ timeout: timeoutMs });
      } catch (error) {
        throw new PlaywrightExecutionControllerError(
          isPlaywrightTimeout(error) ? "execution_timeout" : "action_failed",
        );
      }
    },
    async type(target, value, typeOptions) {
      const locator = await requireOneVisibleTarget(page, target, timeoutMs);
      try {
        await locator.fill("", { timeout: timeoutMs });
        await locator.pressSequentially(value, {
          delay: typeOptions.delayMs,
          timeout: timeoutMs,
        });
      } catch (error) {
        throw new PlaywrightExecutionControllerError(
          isPlaywrightTimeout(error) ? "execution_timeout" : "action_failed",
        );
      }
    },
    async assertVisible(target) {
      const locator = await requireOneVisibleTarget(page, target, timeoutMs);
      if (!(await locator.isVisible())) {
        throw new PlaywrightExecutionControllerError("assertion_failed");
      }
    },
    async assertNavigation(expectation) {
      if (!matchesNavigation(expectation, page.url())) {
        throw new PlaywrightExecutionControllerError("assertion_failed");
      }
    },
    async waitForSettled() {
      try {
        await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs });
        await waitForPageReadiness(page, timeoutMs);
      } catch {
        throw new PlaywrightExecutionControllerError("execution_timeout");
      }
    },
  };
}

function matchesNavigation(
  expectation: BrowserNavigationExpectation,
  actualValue: string,
): boolean {
  const expected = sanitizedNavigationUrl(expectation.url);
  const actual = sanitizedNavigationUrl(actualValue);
  if (expected === undefined || actual === undefined) return false;
  if (expectation.match === "exact-url") return expected.href === actual.href;
  return (
    expected.protocol === actual.protocol &&
    expected.hostname === actual.hostname &&
    expected.port === actual.port &&
    expected.pathname === actual.pathname
  );
}

function sanitizedNavigationUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return;
  }
}

async function requireOneVisibleTarget(
  page: Page,
  target: BrowserExecutionTarget,
  timeoutMs: number,
): Promise<Locator> {
  const deadline = Date.now() + timeoutMs;
  const quietWindowMs = Math.min(150, Math.max(25, Math.floor(timeoutMs / 2)));
  let candidateKey: string | undefined;
  let candidateSince = 0;
  do {
    let foundCandidate = false;
    const locators = matchingLocators(page, target);
    for (let locatorIndex = 0; locatorIndex < locators.length; locatorIndex += 1) {
      const locator = locators[locatorIndex];
      const visible = await visibleLocators(locator);
      if (visible.length === 0) continue;
      if (target.occurrence !== undefined) {
        const selected = visible[target.occurrence - 1];
        if (selected === undefined) continue;
        const key = `${locatorIndex}:${visible.length}:${target.occurrence}`;
        if (candidateKey !== key) {
          candidateKey = key;
          candidateSince = Date.now();
        }
        if (Date.now() - candidateSince >= quietWindowMs) return selected;
        foundCandidate = true;
        break;
      }
      if (visible.length > 1) {
        throw new PlaywrightExecutionControllerError("ambiguous_target");
      }
      const key = `${locatorIndex}:1`;
      if (candidateKey !== key) {
        candidateKey = key;
        candidateSince = Date.now();
      }
      if (Date.now() - candidateSince >= quietWindowMs) return visible[0];
      foundCandidate = true;
      break;
    }
    if (!foundCandidate) {
      candidateKey = undefined;
      candidateSince = 0;
    }
    if (Date.now() < deadline) {
      await page.waitForTimeout(Math.min(25, deadline - Date.now()));
    }
  } while (Date.now() < deadline);
  throw new PlaywrightExecutionControllerError("target_not_found");
}

async function waitForPageReadiness(page: Page, timeoutMs: number): Promise<void> {
  await page.locator("body").waitFor({ state: "attached", timeout: timeoutMs });
  await page.evaluate(`
    new Promise((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
    })
  `);
  if (timeoutMs > 0) await page.waitForTimeout(Math.min(100, timeoutMs));
}

function isPlaywrightTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

function matchingLocators(page: Page, target: BrowserExecutionTarget): Locator[] {
  if (target.role !== undefined) {
    return [
      page.getByRole(target.role as Parameters<Page["getByRole"]>[0], {
        name: target.label,
        exact: true,
      }),
    ];
  }
  return [
    page.getByLabel(target.label, { exact: true }),
    page.getByRole("button", { name: target.label, exact: true }),
    page.getByText(target.label, { exact: true }),
  ];
}

async function visibleLocators(locator: Locator): Promise<Locator[]> {
  const visible: Locator[] = [];
  for (let index = 0; index < (await locator.count()); index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible()) visible.push(candidate);
  }
  return visible;
}

function isSafeNavigationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return false;
    }
    for (const [key, parameterValue] of url.searchParams) {
      if (
        /(^|[-_.])(auth|authorization|token|api[-_]?key|secret|password|passcode|credential|signature|sig|code)($|[-_.])/i.test(
          key,
        ) ||
        isSecretLikeValue(parameterValue)
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function isSecretLikeValue(value: string): boolean {
  return (
    /^sk-[a-z0-9_-]{8,}$/i.test(value) ||
    /^[a-z0-9_-]{8,}\.[a-z0-9_-]{4,}\.[a-z0-9_-]{4,}$/i.test(value) ||
    (value.length >= 24 && /[a-z]/i.test(value) && /\d/.test(value))
  );
}
