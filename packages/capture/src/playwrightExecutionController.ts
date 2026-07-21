/// <reference lib="dom" />

import type { Locator, Page } from "playwright";
import type {
  BrowserCaptureController,
  BrowserExecutionTarget,
  BrowserNavigationExpectation,
} from "./index.js";
import {
  clickWithVisiblePointer,
  selectWithVisiblePointer,
  typeWithVisiblePointer,
} from "./playwrightPointerActions.js";

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
        await clickWithVisiblePointer(page, locator);
      } catch (error) {
        throw new PlaywrightExecutionControllerError(
          isPlaywrightTimeout(error) ? "execution_timeout" : "action_failed",
        );
      }
    },
    async type(target, value, typeOptions) {
      const locator = await requireOneVisibleTarget(page, target, timeoutMs);
      try {
        await typeWithVisiblePointer(page, locator, value, { delayMs: typeOptions.delayMs });
      } catch (error) {
        throw new PlaywrightExecutionControllerError(
          isPlaywrightTimeout(error) ? "execution_timeout" : "action_failed",
        );
      }
    },
    async select(target, optionLabel) {
      const locator = await requireOneVisibleTarget(page, target, timeoutMs);
      try {
        await selectWithVisiblePointer(page, locator, optionLabel);
      } catch (error) {
        if (error instanceof PlaywrightExecutionControllerError) throw error;
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
    async assertControlState(assertion) {
      const locator = await requireOneVisibleTarget(page, assertion.target, timeoutMs);
      const state = await locator.evaluate((element) => {
        if (!(
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
        )) {
          return undefined;
        }
        const checkable =
          element instanceof HTMLInputElement &&
          (element.type === "checkbox" || element.type === "radio");
        return {
          hasValue: checkable ? element.checked : element.value.length > 0,
          validity: element.willValidate
            ? element.validity.valid
              ? "valid"
              : "invalid"
            : "unknown",
          ...(checkable ? { checked: element.checked } : {}),
          ...(element instanceof HTMLSelectElement
            ? {
                selectedOption: element.selectedOptions[0]?.textContent
                  ?.replace(/\s+/g, " ")
                  .trim(),
              }
            : {}),
        };
      });
      if (
        state === undefined ||
        !Object.entries(assertion.state).every(
          ([key, value]) => state[key as keyof typeof state] === value,
        )
      ) {
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
    let locators =
      target.structure === undefined
        ? matchingLocators(page, target)
        : await structuralTargetLocators(page, target);
    if (target.structure !== undefined) {
      if (target.structure.item === undefined && target.occurrence !== undefined) {
        const selected = locators[target.occurrence - 1];
        locators = selected === undefined ? [] : [selected];
      } else if (locators.length > 1) {
        throw new PlaywrightExecutionControllerError("ambiguous_target");
      }
    }
    for (let locatorIndex = 0; locatorIndex < locators.length; locatorIndex += 1) {
      const locator = locators[locatorIndex];
      const visible = await visibleLocators(locator);
      if (visible.length === 0) continue;
      if (target.structure === undefined && target.occurrence !== undefined) {
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

async function structuralTargetLocators(
  page: Page,
  target: BrowserExecutionTarget,
): Promise<Locator[]> {
  const structure = target.structure;
  if (structure === undefined) return [];
  const containerLocator = page.getByRole(
    structure.container.role as Parameters<Page["getByRole"]>[0],
    structure.container.label === undefined
      ? undefined
      : { name: structure.container.label, exact: true },
  );
  let containers = await visibleLocators(containerLocator);
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
      matches.push(...(await visibleLocators(locator)));
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
      ...(await visibleLocators(
        item.getByRole(target.role as Parameters<Locator["getByRole"]>[0]),
      )),
    );
  }
  return matches;
}

async function visibleStructuralItems(
  container: Locator,
  itemRole: "listitem" | "article",
): Promise<Locator[]> {
  const locator = container.getByRole(itemRole as Parameters<Locator["getByRole"]>[0]);
  const containerElement = await container.elementHandle();
  if (containerElement === null) return [];
  const direct: Locator[] = [];
  for (let index = 0; index < (await locator.count()) && direct.length < 100; index += 1) {
    const item = locator.nth(index);
    if (!(await item.isVisible().catch(() => false))) continue;
    const belongs = await item.evaluate((element, expectedContainer) => {
      let depth = 0;
      const composedParent = (candidate: Element) => {
        if (candidate.parentElement !== null) return candidate.parentElement;
        const root = candidate.getRootNode();
        return root instanceof ShadowRoot ? root.host : null;
      };
      for (
        let current = composedParent(element);
        current !== null && depth < 32;
        current = composedParent(current), depth += 1
      ) {
        const role = current.getAttribute("role")?.toLowerCase();
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

async function visibleLocators(locator: Locator): Promise<Locator[]> {
  const visible: Locator[] = [];
  for (let index = 0; index < Math.min(await locator.count(), 100); index += 1) {
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
