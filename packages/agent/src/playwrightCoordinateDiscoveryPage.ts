/// <reference lib="dom" />

import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import {
  createNaturalInputDriver,
  type NaturalInputDriver,
  type ScreenPoint,
} from "@auto-demo/browser-input";
import type { Page } from "playwright";
import type { CoordinateDiscoveryAction } from "./coordinateDiscoveryContract.js";
import type {
  DiscoveryFormState,
  DiscoveryInteractiveTarget,
  DiscoveryTargetStructure,
} from "./discoveryContract.js";
import type { DiscoveryTargetRuntimeRisk } from "./discoveryTargetRegistry.js";
import type { CoordinatePageState } from "./coordinateDiscoverySession.js";

export type BrowserWindowCapture = {
  capture(): Promise<Uint8Array | undefined>;
};

export type CapturedCoordinateFrame = {
  id: string;
  png: Buffer;
  width: number;
  height: number;
  deviceScaleFactor: 1;
  pointer: ScreenPoint;
};

export type CoordinateTargetEvidence = {
  identityKey: string;
  target: DiscoveryInteractiveTarget;
  risk: DiscoveryTargetRuntimeRisk;
  formBefore?: DiscoveryFormState;
  structure?: DiscoveryTargetStructure;
};

export type PlaywrightCoordinateDiscoveryPageOptions = {
  windowCapture?: BrowserWindowCapture;
};

export class PlaywrightCoordinateDiscoveryPage {
  private readonly input: NaturalInputDriver;
  private nativePopupOpen = false;
  private cachedState: CoordinatePageState | undefined;

  constructor(
    private readonly page: Page,
    private readonly options: PlaywrightCoordinateDiscoveryPageOptions = {},
    pointer: ScreenPoint = { x: 0, y: 0 },
  ) {
    this.input = createNaturalInputDriver(
      {
        move: async ({ x, y }) => await page.mouse.move(x, y),
        down: async (button) => await page.mouse.down({ button }),
        up: async (button) => await page.mouse.up({ button }),
        wheel: async (deltaX, deltaY) => await page.mouse.wheel(deltaX, deltaY),
        keypress: async (key) => await page.keyboard.press(playwrightKey(key)),
        type: async (text) => await page.keyboard.type(text),
        wait: async (durationMs) => await page.waitForTimeout(durationMs),
      },
      { pointer },
    );
  }

  pointer(): ScreenPoint {
    return this.input.pointer();
  }

  async captureFrame(input: {
    id: string;
    pointer: ScreenPoint;
    grid: boolean;
  }): Promise<CapturedCoordinateFrame> {
    const viewport = this.page.viewportSize();
    if (viewport === null) throw new Error("coordinate_viewport_unavailable");
    if ((await this.nativeUiState()) === "open") {
      const captured = await this.options.windowCapture?.capture();
      if (captured === undefined) throw new Error("native_window_capture_unavailable");
      return {
        id: input.id,
        png: Buffer.from(captured),
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        pointer: { ...input.pointer },
      };
    }
    const raw = await this.page.screenshot({ type: "png", animations: "disabled" });
    const png = PNG.sync.read(raw);
    if (png.width !== viewport.width || png.height !== viewport.height) {
      throw new Error("coordinate_viewport_mismatch");
    }
    if (input.grid) paintGrid(png);
    paintCursor(png, input.pointer);
    return {
      id: input.id,
      png: PNG.sync.write(png),
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      pointer: { ...input.pointer },
    };
  }

  async inspectPoint(point: ScreenPoint): Promise<CoordinateTargetEvidence | undefined> {
    return await this.page.evaluate(inspectCoordinateTarget, point);
  }

  async layoutIdentity(): Promise<string> {
    const snapshot = await this.page.evaluate(() => ({
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight },
      scroll: { x: scrollX, y: scrollY },
      targets: Array.from(
        document.querySelectorAll(
          'a[href],button,input,select,textarea,[role="button"],[role="link"],[role="combobox"]',
        ),
      )
        .slice(0, 100)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return [
            element.tagName,
            Math.round(rect.x),
            Math.round(rect.y),
            Math.round(rect.width),
            Math.round(rect.height),
          ];
        }),
    }));
    return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  }

  async state(): Promise<CoordinatePageState> {
    if (this.nativePopupOpen) {
      if (this.cachedState === undefined) throw new Error("coordinate_state_unavailable");
      return { ...this.cachedState, popup: "open" };
    }
    const state = await this.page.evaluate(() => {
      const root = globalThis as typeof globalThis & { __autoDemoCoordinateDocument?: string };
      root.__autoDemoCoordinateDocument ??= `document-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return {
        documentToken: root.__autoDemoCoordinateDocument,
        url: location.href,
        title: document.title,
        viewport: { width: innerWidth, height: innerHeight },
        scroll: { x: scrollX, y: scrollY },
        popup: "closed" as const,
      };
    });
    const result = { ...state, layoutIdentity: await this.layoutIdentity() };
    this.cachedState = result;
    return result;
  }

  async nativeUiState(): Promise<"closed" | "open"> {
    return this.nativePopupOpen ? "open" : "closed";
  }

  async execute(action: CoordinateDiscoveryAction): Promise<void> {
    switch (action.type) {
      case "move":
        await this.input.move(action);
        return;
      case "click":
        this.nativePopupOpen = await this.page.evaluate(
          ({ x, y }) => document.elementFromPoint(x, y)?.closest("select") !== null,
          action,
        );
        try {
          await this.input.click(action);
          if (!this.nativePopupOpen) {
            await new Promise<void>((resolve) => setTimeout(resolve, 50));
            await this.page
              .waitForLoadState("domcontentloaded", { timeout: 2_000 })
              .catch(() => undefined);
          }
        } catch (error) {
          this.nativePopupOpen = false;
          throw error;
        }
        return;
      case "double-click":
        await this.input.doubleClick(action);
        return;
      case "scroll":
        await this.input.scroll(action, action.deltaX ?? 0, action.deltaY);
        return;
      case "keypress":
        await this.input.keypress(action.keys);
        if (action.keys.some((key) => ["ENTER", "ESCAPE", "TAB"].includes(key))) {
          this.nativePopupOpen = false;
        }
        return;
      case "type":
        await this.input.type(action.text);
        return;
      case "wait":
        await this.page.waitForTimeout(action.durationMs);
    }
  }

  async close(): Promise<void> {
    await this.page.context().close();
  }
}

function inspectCoordinateTarget(point: ScreenPoint): CoordinateTargetEvidence | undefined {
  const direct = document.elementFromPoint(point.x, point.y);
  const element = direct?.closest(
    'a[href],button,input,select,textarea,[contenteditable="true"],[role="button"],[role="link"],[role="combobox"]',
  );
  if (!(element instanceof HTMLElement)) return undefined;

  const normalized = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim() ?? "";
  const roleOf = (candidate: Element): string | undefined => {
    const explicit = normalized(candidate.getAttribute("role"));
    if (explicit !== "") return explicit;
    if (candidate instanceof HTMLAnchorElement) return "link";
    if (candidate instanceof HTMLButtonElement) return "button";
    if (candidate instanceof HTMLSelectElement) return "combobox";
    if (candidate instanceof HTMLTextAreaElement) return "textbox";
    if (candidate instanceof HTMLInputElement) {
      if (["button", "submit", "reset"].includes(candidate.type)) return "button";
      if (candidate.type === "checkbox") return "checkbox";
      if (candidate.type === "radio") return "radio";
      return "textbox";
    }
    return undefined;
  };
  const labelOf = (candidate: Element): string => {
    const aria = normalized(candidate.getAttribute("aria-label"));
    if (aria !== "") return aria;
    const labelledBy = normalized(candidate.getAttribute("aria-labelledby"));
    if (labelledBy !== "") {
      const labelled = labelledBy
        .split(/\s+/)
        .map((id) => normalized(document.getElementById(id)?.textContent))
        .filter(Boolean)
        .join(" ");
      if (labelled !== "") return labelled;
    }
    if (
      candidate instanceof HTMLInputElement ||
      candidate instanceof HTMLSelectElement ||
      candidate instanceof HTMLTextAreaElement
    ) {
      const associated = Array.from(candidate.labels ?? [])
        .map((label) => normalized(label.childNodes[0]?.textContent ?? label.textContent))
        .find(Boolean);
      if (associated !== undefined) return associated;
      const placeholder = normalized(candidate.getAttribute("placeholder"));
      if (placeholder !== "") return placeholder;
      if (
        candidate instanceof HTMLInputElement &&
        ["button", "submit", "reset"].includes(candidate.type)
      ) {
        return normalized(candidate.value);
      }
    }
    return normalized(candidate.textContent);
  };

  const role = roleOf(element);
  const label = labelOf(element);
  const candidates = Array.from(
    document.querySelectorAll(
      'a[href],button,input,select,textarea,[contenteditable="true"],[role="button"],[role="link"],[role="combobox"]',
    ),
  ).filter((candidate) => roleOf(candidate) === role && labelOf(candidate) === label);
  const occurrence = candidates.indexOf(element) + 1;

  const root = globalThis as typeof globalThis & {
    __autoDemoCoordinateIdentities?: { next: number; values: WeakMap<Element, string> };
  };
  root.__autoDemoCoordinateIdentities ??= { next: 1, values: new WeakMap() };
  let identityKey = root.__autoDemoCoordinateIdentities.values.get(element);
  if (identityKey === undefined) {
    identityKey = `coordinate-element-${root.__autoDemoCoordinateIdentities.next++}`;
    root.__autoDemoCoordinateIdentities.values.set(element, identityKey);
  }

  const target: DiscoveryInteractiveTarget = {
    id: identityKey,
    label,
    ...(role === undefined ? {} : { role }),
    ...(occurrence < 1 ? {} : { occurrence }),
    disabled:
      "disabled" in element && typeof element.disabled === "boolean" ? element.disabled : false,
  };
  let formBefore: DiscoveryFormState | undefined;
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    formBefore = {
      required: element.required,
      hasValue: element.value.length > 0,
      validity: element.checkValidity() ? "valid" : "invalid",
      ...(element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)
        ? { checked: element.checked }
        : {}),
      ...(element instanceof HTMLSelectElement
        ? {
            selectedOption: normalized(element.selectedOptions[0]?.textContent),
            options: Array.from(element.options).map((option) => ({
              label: normalized(option.textContent),
              disabled: option.disabled,
              selected: option.selected,
            })),
          }
        : {}),
    };
    target.form = formBefore;
  }

  const item = element.closest("li") ?? element.closest("article");
  const container = item?.parentElement?.closest('ol,ul,[role="list"],[role="feed"]');
  let structure: DiscoveryTargetStructure | undefined;
  if (item !== null && item !== undefined && container instanceof HTMLElement) {
    const allItems = Array.from(container.querySelectorAll(":scope > li, :scope > article"));
    const promoted = (candidate: Element) =>
      /(sponsored|promoted|advertisement)/i.test(normalized(candidate.textContent));
    const organicItems = allItems.filter((candidate) => !promoted(candidate));
    const position = organicItems.findIndex((candidate) => candidate === item) + 1;
    const containerLabel = labelOf(container);
    const sameContainers = Array.from(
      document.querySelectorAll('ol,ul,[role="list"],[role="feed"]'),
    ).filter((candidate) => labelOf(candidate) === containerLabel);
    if (position > 0) {
      structure = {
        container: {
          role: container.getAttribute("role") === "feed" ? "feed" : "list",
          ...(containerLabel === "" ? {} : { label: containerLabel }),
          occurrence: sameContainers.indexOf(container) + 1,
        },
        item: {
          role: item.tagName === "ARTICLE" ? "article" : "listitem",
          position,
          promotion: "exclude-marked-promoted",
        },
      };
      target.structure = structure;
    }
  }

  const input = element instanceof HTMLInputElement ? element : undefined;
  const risk: DiscoveryTargetRuntimeRisk = {
    credential:
      input !== undefined &&
      (input.type === "password" ||
        /\b(password|passcode|otp|token|secret)\b/i.test(`${input.name} ${input.autocomplete}`)),
    sensitivePayment:
      input !== undefined &&
      /\b(card|cc-|cvc|cvv|payment)\b/i.test(`${input.name} ${input.autocomplete}`),
    upload: input?.type === "file",
  };
  return {
    identityKey,
    target,
    risk,
    ...(formBefore === undefined ? {} : { formBefore }),
    ...(structure === undefined ? {} : { structure }),
  };
}

function paintGrid(png: PNG): void {
  for (let x = 100; x < png.width; x += 100) {
    for (let y = 0; y < png.height; y += 1) setPixel(png, x, y, 70, 130, 180, 120);
  }
  for (let y = 100; y < png.height; y += 100) {
    for (let x = 0; x < png.width; x += 1) setPixel(png, x, y, 70, 130, 180, 120);
  }
}

function paintCursor(png: PNG, point: ScreenPoint): void {
  for (let offset = -8; offset <= 8; offset += 1) {
    setPixel(png, Math.round(point.x + offset), Math.round(point.y), 255, 255, 255, 255);
    setPixel(png, Math.round(point.x), Math.round(point.y + offset), 255, 255, 255, 255);
  }
  for (let offset = -6; offset <= 6; offset += 1) {
    setPixel(png, Math.round(point.x + offset), Math.round(point.y), 20, 90, 220, 255);
    setPixel(png, Math.round(point.x), Math.round(point.y + offset), 20, 90, 220, 255);
  }
}

function setPixel(
  png: PNG,
  x: number,
  y: number,
  red: number,
  green: number,
  blue: number,
  alpha: number,
): void {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const index = (png.width * y + x) * 4;
  png.data[index] = red;
  png.data[index + 1] = green;
  png.data[index + 2] = blue;
  png.data[index + 3] = alpha;
}

function playwrightKey(key: string): string {
  const names: Record<string, string> = {
    ENTER: "Enter",
    ESCAPE: "Escape",
    TAB: "Tab",
    ARROWDOWN: "ArrowDown",
    ARROWUP: "ArrowUp",
    PAGEUP: "PageUp",
    PAGEDOWN: "PageDown",
    HOME: "Home",
    END: "End",
    SPACE: "Space",
    BACKSPACE: "Backspace",
    DELETE: "Delete",
  };
  return names[key] ?? key;
}
