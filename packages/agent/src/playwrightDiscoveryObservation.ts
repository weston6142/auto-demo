/// <reference lib="dom" />

import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import {
  createDiscoveryObservationExtractor,
  type DiscoveryObservationExtractor,
  type DiscoveryObservationExtractorDependencies,
  type DiscoveryObservationPage,
  type DiscoveryObservationPageSnapshot,
  type DiscoveryObservationRawTarget,
  type DiscoveryObservationRawVisibleState,
} from "./discoveryObservation.js";

export type PlaywrightDiscoveryObservationOptions = Omit<
  DiscoveryObservationExtractorDependencies,
  "page"
>;

type BrowserCollection = DiscoveryObservationPageSnapshot;

export function createPlaywrightDiscoveryObservationExtractor(
  page: Page,
  options: PlaywrightDiscoveryObservationOptions = {},
): DiscoveryObservationExtractor {
  return createDiscoveryObservationExtractor({
    ...options,
    page: new PlaywrightDiscoveryObservationPage(page),
  });
}

class PlaywrightDiscoveryObservationPage implements DiscoveryObservationPage {
  private readonly registryKey = `__auto_demo_discovery_${randomUUID().replaceAll("-", "_")}`;
  private baselineNavigationIndex: number | undefined;
  private currentNavigationIndex: number | undefined;

  constructor(private readonly page: Page) {}

  async isAvailable() {
    return !this.page.isClosed();
  }

  async readDocumentToken() {
    const current = await this.page.evaluate(registryState, this.registryKey);
    this.baselineNavigationIndex ??= current.navigationIndex;
    this.currentNavigationIndex = current.navigationIndex;
    return current.token;
  }

  async collectSnapshot(): Promise<BrowserCollection> {
    return await this.page.evaluate(collectBrowserSnapshot, {
      registryKey: this.registryKey,
      canGoBack:
        this.baselineNavigationIndex !== undefined &&
        this.currentNavigationIndex !== undefined &&
        this.currentNavigationIndex > this.baselineNavigationIndex,
    });
  }

  async captureViewportPng() {
    return await this.page.screenshot({ type: "png" });
  }

  async hasLiveIdentity(identityKey: string, documentToken: string) {
    return await this.page.evaluate(
      ({ registryKey, identityKey, documentToken }) => {
        const root = globalThis as typeof globalThis & Record<string, unknown>;
        const state = root[registryKey] as
          { token: string; elements: Map<string, Element> } | undefined;
        if (state === undefined || state.token !== documentToken) return false;
        const element = state.elements.get(identityKey);
        if (element === undefined || !element.isConnected) {
          state.elements.delete(identityKey);
          return false;
        }
        return true;
      },
      { registryKey: this.registryKey, identityKey, documentToken },
    );
  }
}

function registryState(registryKey: string) {
  const root = globalThis as typeof globalThis & Record<string, unknown>;
  type State = {
    token: string;
    nextIdentity: number;
    identities: WeakMap<Element, string>;
    elements: Map<string, Element>;
  };
  let state = root[registryKey] as State | undefined;
  if (state === undefined) {
    state = {
      token: `document-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      nextIdentity: 1,
      identities: new WeakMap<Element, string>(),
      elements: new Map<string, Element>(),
    };
    Object.defineProperty(root, registryKey, { value: state, configurable: true });
  }
  const navigationIndex = (root.navigation as { currentEntry?: { index?: unknown } } | undefined)
    ?.currentEntry?.index;
  return {
    token: state.token,
    ...(typeof navigationIndex === "number" && Number.isInteger(navigationIndex)
      ? { navigationIndex }
      : {}),
  };
}

function collectBrowserSnapshot(input: {
  registryKey: string;
  canGoBack: boolean;
}): BrowserCollection {
  const root = globalThis as typeof globalThis & Record<string, unknown>;
  type State = {
    token: string;
    nextIdentity: number;
    identities: WeakMap<Element, string>;
    elements: Map<string, Element>;
  };
  let state = root[input.registryKey] as State | undefined;
  if (state === undefined) {
    state = {
      token: `document-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      nextIdentity: 1,
      identities: new WeakMap<Element, string>(),
      elements: new Map<string, Element>(),
    };
    Object.defineProperty(root, input.registryKey, { value: state, configurable: true });
  }
  const documentToken = state.token;
  const retainedPerTier = 100;
  const rawTextLimit = 2_048;
  let truncatedContent = 0;
  const boundedText = (value: string) => {
    if (value.length <= rawTextLimit) return value;
    truncatedContent += 1;
    return value.slice(0, rawTextLimit);
  };

  for (const [identity, element] of state.elements) {
    if (!element.isConnected) state.elements.delete(identity);
  }

  const identity = (element: Element) => {
    const existing = state.identities.get(element);
    if (existing !== undefined) return existing;
    const created = `element-${state.nextIdentity++}`;
    state.identities.set(element, created);
    state.elements.set(created, element);
    return created;
  };

  const elements: Element[] = [];
  const walk = (element: Element) => {
    elements.push(element);
    if (element instanceof HTMLElement && element.shadowRoot !== null) {
      for (const child of Array.from(element.shadowRoot.children)) walk(child);
    }
    if (element.tagName !== "IFRAME") {
      for (const child of Array.from(element.children)) walk(child);
    }
  };
  walk(document.documentElement);

  const composedParent = (element: Element): Element | null => {
    if (element.parentElement !== null) return element.parentElement;
    const rootNode = element.getRootNode();
    return rootNode instanceof ShadowRoot ? rootNode.host : null;
  };

  const visible = (element: Element) => {
    if (!(element instanceof HTMLElement)) return false;
    for (
      let current: Element | null = element;
      current !== null;
      current = composedParent(current)
    ) {
      if (
        (current instanceof HTMLElement && current.hidden) ||
        current.hasAttribute("inert") ||
        current.getAttribute("aria-hidden") === "true"
      ) {
        return false;
      }
      const style = getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
      }
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const valueBearing = (element: Element) =>
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    (element instanceof HTMLElement && element.isContentEditable);

  const insideValueBearingContent = (element: Element) => {
    for (
      let current: Element | null = element;
      current !== null;
      current = composedParent(current)
    ) {
      if (valueBearing(current)) return true;
    }
    return false;
  };

  const excludedTextContainers = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"]);
  const safeText = (element: Element, directOnly = false, includeHidden = false) => {
    if (valueBearing(element)) return "";
    let result = "";
    let truncated = false;
    const appendText = (value: Text) => {
      if (value.length === 0 || truncated) return;
      const separator = result.length === 0 ? "" : " ";
      const remaining = rawTextLimit - result.length - separator.length;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      const length = Math.min(value.length, remaining);
      result += separator + value.substringData(0, length);
      if (value.length > length) truncated = true;
    };
    const visit = (node: Node, rootElement: Element) => {
      if (truncated) return;
      if (node.nodeType === Node.TEXT_NODE) {
        appendText(node as Text);
        return;
      }
      if (!(node instanceof Element)) return;
      if (
        excludedTextContainers.has(node.tagName) ||
        (node !== rootElement &&
          (valueBearing(node) || node.tagName === "OPTION" || (!includeHidden && !visible(node))))
      ) {
        return;
      }
      for (const child of Array.from(node.childNodes)) {
        visit(child, rootElement);
        if (truncated) break;
      }
      if (node instanceof HTMLElement && node.shadowRoot !== null) {
        for (const child of Array.from(node.shadowRoot.childNodes)) {
          visit(child, rootElement);
          if (truncated) break;
        }
      }
    };
    if (directOnly) {
      for (const child of Array.from(element.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) appendText(child as Text);
        if (truncated) break;
      }
    } else {
      visit(element, element);
    }
    if (truncated) truncatedContent += 1;
    return result.trim();
  };

  const combineText = (values: Iterable<string>) => {
    let result = "";
    for (const value of values) {
      if (value.trim().length === 0) continue;
      const separator = result.length === 0 ? "" : " ";
      const remaining = rawTextLimit - result.length - separator.length;
      if (remaining <= 0) {
        truncatedContent += 1;
        break;
      }
      result += separator + value.slice(0, remaining);
      if (value.length > remaining) {
        truncatedContent += 1;
        break;
      }
    }
    return result.trim();
  };

  const publicSummaryKey = (value: string) => {
    const isSecretLike = (candidate: string) =>
      /^sk-[a-z0-9_-]{8,}$/i.test(candidate) ||
      /^[a-z0-9_-]{8,}\.[a-z0-9_-]{4,}\.[a-z0-9_-]{4,}$/i.test(candidate) ||
      (candidate.length >= 24 && /[a-z]/i.test(candidate) && /\d/.test(candidate));
    const sanitizeUrl = (candidate: string) => {
      try {
        const url = new URL(candidate);
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/$/, url.pathname === "/" ? "/" : "");
      } catch {
        return "[redacted-url]";
      }
    };
    return value
      .replace(/\s+/g, " ")
      .trim()
      .replace(/https?:\/\/[^\s]+/gi, (url) => sanitizeUrl(url))
      .replace(/\bsk-[a-z0-9_-]{8,}\b/gi, "[redacted-secret]")
      .replace(/\b[a-z0-9_-]{8,}\.[a-z0-9_-]{4,}\.[a-z0-9_-]{4,}\b/gi, "[redacted-secret]")
      .replace(/\bBearer\s+[a-z0-9._~-]{8,}\b/gi, "Bearer [redacted-secret]")
      .replace(
        /\b(token|api[ _-]?key|password|passcode|secret|credential)\s*[:=]\s*[^\s,;]+/gi,
        "$1=[redacted-secret]",
      )
      .replace(
        /\b(token|api[ _-]?key|password|passcode|secret|credential)\s+(is\s+)?(?!field\b|input\b|manager\b|reset\b)([^\s,;]+)/gi,
        (_match, kind: string, linking: string | undefined) =>
          `${kind} ${linking ?? ""}[redacted-secret]`,
      )
      .replace(/\b[a-z0-9_-]{24,}\b/gi, (candidate) =>
        isSecretLike(candidate) ? "[redacted-secret]" : candidate,
      )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500)
      .trim();
  };

  const label = (element: Element) => {
    const labelledBy = boundedText(element.getAttribute("aria-labelledby") ?? "");
    const elementRoot = element.getRootNode();
    const labelledIds = labelledBy.split(/\s+/).filter((id) => id.length > 0);
    if (labelledIds.length > 32) truncatedContent += 1;
    const labelledText = combineText(
      labelledIds.slice(0, 32).map((id) => {
        if (elementRoot instanceof Document || elementRoot instanceof ShadowRoot) {
          const labelledElement = elementRoot.getElementById(id);
          return labelledElement === null ? "" : safeText(labelledElement, false, true);
        }
        const labelledElement = document.getElementById(id);
        return labelledElement === null ? "" : safeText(labelledElement, false, true);
      }),
    );
    if (labelledText.length > 0) return labelledText;
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel !== null && ariaLabel.trim().length > 0) return boundedText(ariaLabel);
    const labels = (element as Element & { labels?: NodeListOf<HTMLLabelElement> }).labels;
    if (labels !== undefined && labels.length > 0) {
      const labelTexts: string[] = [];
      for (let index = 0; index < Math.min(labels.length, 32); index += 1) {
        const current = labels.item(index);
        if (current !== null && visible(current)) labelTexts.push(safeText(current));
      }
      if (labels.length > 32) truncatedContent += 1;
      const labelsText = combineText(labelTexts);
      if (labelsText.length > 0) return labelsText;
    }
    for (const candidate of [
      element.getAttribute("placeholder"),
      element.getAttribute("alt"),
      element.getAttribute("title"),
    ]) {
      if (candidate !== null && candidate.trim().length > 0) return boundedText(candidate);
    }
    return valueBearing(element) ? "" : safeText(element);
  };

  const role = (element: Element): string | undefined => {
    const explicit = element.getAttribute("role")?.toLowerCase();
    if (explicit !== undefined) return explicit;
    if (element instanceof HTMLAnchorElement && element.hasAttribute("href")) return "link";
    if (element instanceof HTMLButtonElement) return "button";
    if (element instanceof HTMLTextAreaElement) return "textbox";
    if (element instanceof HTMLSelectElement) return "combobox";
    if (element instanceof HTMLInputElement) {
      const type = element.type.toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      if (type === "number") return "spinbutton";
      if (type !== "hidden" && type !== "submit" && type !== "button" && type !== "image") {
        return type === "search" ? "searchbox" : "textbox";
      }
      return "button";
    }
    if (element instanceof HTMLElement && element.isContentEditable) return "textbox";
    return undefined;
  };

  const roleAllowlist = new Set([
    "button",
    "link",
    "textbox",
    "searchbox",
    "checkbox",
    "radio",
    "switch",
    "combobox",
    "listbox",
    "option",
    "tab",
    "menuitem",
    "slider",
    "spinbutton",
  ]);
  const native = (element: Element) =>
    (element instanceof HTMLAnchorElement && element.hasAttribute("href")) ||
    element instanceof HTMLButtonElement ||
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    element.tagName === "SUMMARY";

  const semanticTargets: DiscoveryObservationRawTarget[] = [];
  const fallbackTargets: DiscoveryObservationRawTarget[] = [];
  let omittedInteractiveTargets = 0;
  const interactiveElements = new WeakSet<Element>();
  elements.forEach((element, order) => {
    if (!visible(element)) return;
    const inferredRole = role(element);
    const semantic =
      native(element) || (inferredRole !== undefined && roleAllowlist.has(inferredRole));
    const html = element instanceof HTMLElement ? element : undefined;
    const fallback =
      !semantic &&
      html !== undefined &&
      ((html.hasAttribute("tabindex") && html.tabIndex >= 0) ||
        html.isContentEditable ||
        getComputedStyle(html).cursor === "pointer");
    if (!semantic && !fallback) return;
    const publicLabel = boundedText(label(element).trim());
    if (publicLabel.length === 0) return;
    for (let parent = composedParent(element); parent !== null; parent = composedParent(parent)) {
      if (fallback && interactiveElements.has(parent)) return;
    }
    interactiveElements.add(element);
    const targetTier = semantic ? semanticTargets : fallbackTargets;
    if (targetTier.length >= retainedPerTier) {
      omittedInteractiveTargets += 1;
      return;
    }
    const inputElement = element instanceof HTMLInputElement ? element : undefined;
    const autocomplete = inputElement?.autocomplete.toLowerCase() ?? "";
    const credential =
      inputElement?.type.toLowerCase() === "password" ||
      /(^|\s)(username|current-password|new-password|one-time-code)(\s|$)/.test(autocomplete);
    const formControl = element.closest("button, input");
    const explicitType = formControl?.getAttribute("type")?.toLowerCase();
    const submitsForm =
      formControl?.closest("form") !== null &&
      ((formControl?.tagName === "BUTTON" &&
        (explicitType === undefined || explicitType === "submit")) ||
        (formControl?.tagName === "INPUT" &&
          (explicitType === "submit" || explicitType === "image")));
    const target: DiscoveryObservationRawTarget = {
      identityKey: identity(element),
      tier: semantic ? "semantic" : "fallback",
      label: publicLabel,
      ...(inferredRole === undefined ? {} : { role: inferredRole }),
      order,
      disabled: element.getAttribute("aria-disabled") === "true" || element.matches(":disabled"),
      credential,
      ...(submitsForm ? { actionRisk: "potentially-mutating" as const } : {}),
    };
    targetTier.push(target);
  });

  const interactiveTargets = [...semanticTargets, ...fallbackTargets];
  const interactiveLabels = new Set(
    interactiveTargets.map((target) => publicSummaryKey(target.label)),
  );

  const statusCandidates: DiscoveryObservationRawVisibleState[] = [];
  const headingCandidates: DiscoveryObservationRawVisibleState[] = [];
  const textCandidates: DiscoveryObservationRawVisibleState[] = [];
  const candidateCounts = { status: 0, heading: 0, text: 0 };
  const isPriority = (element: Element) => {
    const elementRole = element.getAttribute("role")?.toLowerCase();
    return (
      elementRole === "status" ||
      elementRole === "alert" ||
      elementRole === "heading" ||
      /^H[1-6]$/.test(element.tagName)
    );
  };
  const hasPriorityAncestor = (element: Element) => {
    for (let parent = composedParent(element); parent !== null; parent = composedParent(parent)) {
      if (isPriority(parent)) return true;
    }
    return false;
  };
  const seenVisibleSummaries = new Set<string>();
  for (const requestedKind of ["status", "heading", "text"] as const) {
    elements.forEach((element, order) => {
      if (
        !visible(element) ||
        interactiveElements.has(element) ||
        insideValueBearingContent(element) ||
        hasPriorityAncestor(element)
      ) {
        return;
      }
      const elementRole = element.getAttribute("role")?.toLowerCase();
      const tag = element.tagName;
      const isStatus = elementRole === "status" || elementRole === "alert";
      const isHeading = /^H[1-6]$/.test(tag) || elementRole === "heading";
      const kind = isStatus ? "status" : isHeading ? "heading" : "text";
      if (kind !== requestedKind) return;
      const summary = safeText(element, kind === "text");
      if (summary.length === 0) return;
      const normalizedSummary = publicSummaryKey(summary);
      if (
        seenVisibleSummaries.has(normalizedSummary) ||
        (kind === "text" && interactiveLabels.has(normalizedSummary))
      ) {
        return;
      }
      seenVisibleSummaries.add(normalizedSummary);
      candidateCounts[kind] += 1;
      const candidate: DiscoveryObservationRawVisibleState = {
        identityKey: `visible-${order}`,
        kind,
        summary,
        order,
      };
      const candidateTier =
        kind === "status"
          ? statusCandidates
          : kind === "heading"
            ? headingCandidates
            : textCandidates;
      if (candidateTier.length < retainedPerTier) candidateTier.push(candidate);
    });
  }

  const visibleStates = [...statusCandidates, ...headingCandidates, ...textCandidates];
  const omittedVisibleStates =
    candidateCounts.status + candidateCounts.heading + candidateCounts.text - visibleStates.length;

  return {
    documentToken,
    url: location.href,
    title:
      safeText(document.querySelector("title") ?? document.documentElement, true) ||
      "Untitled page",
    viewport: { width: innerWidth, height: innerHeight },
    canGoBack: input.canGoBack,
    visibleStates,
    interactiveTargets,
    ...(omittedVisibleStates === 0 ? {} : { omittedVisibleStates }),
    ...(omittedInteractiveTargets === 0 ? {} : { omittedInteractiveTargets }),
    ...(truncatedContent === 0 ? {} : { truncatedContent }),
  };
}
