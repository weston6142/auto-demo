import { randomBytes } from "node:crypto";
import { redactCapturedValue, type CaptureEventFactory } from "./captureEvents.js";
import type { JsonlEventWriter } from "./jsonlEventWriter.js";
import type {
  BrowserBindingPayload,
  PlaywrightConsoleMessage,
  PlaywrightPage,
  PlaywrightPageError,
  PlaywrightPageSnapshot,
} from "./playwrightDriver.js";

const BINDING_NAME = "__autoDemoCaptureEvent";
const NON_PRINTABLE_KEYS = new Set([
  "Alt",
  "AltGraph",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "Backspace",
  "CapsLock",
  "Clear",
  "ContextMenu",
  "Control",
  "Delete",
  "End",
  "Enter",
  "Escape",
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
  "F8",
  "F9",
  "F10",
  "F11",
  "F12",
  "Home",
  "Insert",
  "Meta",
  "NumLock",
  "PageDown",
  "PageUp",
  "Pause",
  "PrintScreen",
  "ScrollLock",
  "Shift",
  "Tab",
  "Unidentified",
]);

export type PlaywrightMetadataRecorder = {
  writeCaptureStarted(data: Record<string, unknown>): Promise<void>;
  writeCaptureStopped(data: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
};

export async function createPlaywrightMetadataRecorder(options: {
  page: PlaywrightPage;
  writer: JsonlEventWriter;
  eventFactory: CaptureEventFactory;
}): Promise<PlaywrightMetadataRecorder> {
  const recorder = new DefaultPlaywrightMetadataRecorder(
    options.page,
    options.writer,
    options.eventFactory,
  );
  await recorder.attach();
  return recorder;
}

class DefaultPlaywrightMetadataRecorder implements PlaywrightMetadataRecorder {
  private readonly pendingWrites = new Set<Promise<void>>();
  private readonly browserBindingToken = randomBytes(32).toString("base64url");
  private writeChain: Promise<void> = Promise.resolve();
  private closing = false;

  constructor(
    private readonly page: PlaywrightPage,
    private readonly writer: JsonlEventWriter,
    private readonly eventFactory: CaptureEventFactory,
  ) {}

  async attach(): Promise<void> {
    await this.page.exposeBinding(BINDING_NAME, async (payload) => {
      const browserPayload = parseBrowserBindingPayload(payload, this.browserBindingToken);
      if (browserPayload === undefined) {
        return;
      }

      const timestampMs = this.eventFactory.reserveTimestamp();
      await this.enqueue(() => this.writeBrowserPayload(browserPayload, timestampMs));
    });
    await this.page.addInitScript(
      browserInstrumentationScript(BINDING_NAME, this.browserBindingToken),
    );
    this.page.onConsole((message) => {
      const timestampMs = this.eventFactory.reserveTimestamp();
      this.enqueue(() => this.writeConsole(message, timestampMs));
    });
    this.page.onNavigation(() => {
      const timestampMs = this.eventFactory.reserveTimestamp();
      this.enqueue(() => this.writeNavigation("framenavigated", timestampMs));
    });
    this.page.onPageError((error) => {
      const timestampMs = this.eventFactory.reserveTimestamp();
      this.enqueue(() => this.writePageError(error, timestampMs));
    });
  }

  async writeCaptureStarted(data: Record<string, unknown>): Promise<void> {
    const timestampMs = this.eventFactory.reserveTimestamp();
    await this.enqueue(async () => {
      const snapshot = sanitizeSnapshot(await this.page.snapshotMetadata());
      await this.writer.write(
        this.eventFactory.create(
          "capture_started",
          {
            ...snapshot,
            data: sanitizeCaptureData(data),
          },
          { timestampMs },
        ),
      );
    });
  }

  async writeCaptureStopped(data: Record<string, unknown>): Promise<void> {
    if (this.closing) {
      return;
    }

    this.closing = true;
    const timestampMs = this.eventFactory.reserveTimestamp();
    await this.enqueue(
      async () => {
        const snapshot = sanitizeSnapshot(await this.page.snapshotMetadata());
        await this.writer.write(
          this.eventFactory.create(
            "capture_stopped",
            {
              ...snapshot,
              data,
            },
            { timestampMs },
          ),
        );
      },
      { allowWhileClosing: true },
    );
  }

  async close(): Promise<void> {
    this.closing = true;
    await Promise.all(this.pendingWrites);
    await this.writer.close();
  }

  private enqueue(
    task: () => Promise<void>,
    options: { allowWhileClosing?: boolean } = {},
  ): Promise<void> {
    if (this.closing && options.allowWhileClosing !== true) {
      return Promise.resolve();
    }

    const write = this.writeChain.then(task);
    this.writeChain = write.catch(() => undefined);
    this.pendingWrites.add(write);
    write.then(
      () => {
        this.pendingWrites.delete(write);
      },
      () => {
        this.pendingWrites.delete(write);
      },
    );
    return write;
  }

  private async writeBrowserPayload(
    payload: BrowserBindingPayload,
    timestampMs: number,
  ): Promise<void> {
    await this.writer.write(
      this.eventFactory.create(
        payload.type,
        {
          pageUrl: sanitizeUrlField(payload.pageUrl),
          pageTitle: payload.pageTitle,
          viewport: payload.viewport,
          data: normalizeBrowserPayloadData(payload),
        },
        { timestampMs },
      ),
    );
  }

  private async writeConsole(
    message: PlaywrightConsoleMessage,
    timestampMs: number,
  ): Promise<void> {
    const snapshot = sanitizeSnapshot(await this.page.snapshotMetadata());
    await this.writer.write(
      this.eventFactory.create(
        "console",
        {
          ...snapshot,
          data: {
            level: message.type,
            textRedacted: true,
            textLength: message.text.length,
            location: sanitizeConsoleLocation(message.location),
          },
        },
        { timestampMs },
      ),
    );
  }

  private async writeNavigation(phase: string, timestampMs: number): Promise<void> {
    const snapshot = sanitizeSnapshot(await this.page.snapshotMetadata());
    await this.writer.write(
      this.eventFactory.create(
        "navigation",
        {
          ...snapshot,
          data: { phase },
        },
        { timestampMs },
      ),
    );
  }

  private async writePageError(error: PlaywrightPageError, timestampMs: number): Promise<void> {
    const snapshot = sanitizeSnapshot(await this.page.snapshotMetadata());
    await this.writer.write(
      this.eventFactory.create(
        "page_error",
        {
          ...snapshot,
          data: {
            name: error.name,
            messageRedacted: true,
            messageLength: error.message.length,
            stackRedacted: error.stack !== undefined || undefined,
          },
        },
        { timestampMs },
      ),
    );
  }
}

function parseBrowserBindingPayload(
  payload: unknown,
  expectedToken: string,
): BrowserBindingPayload | undefined {
  if (!isRecord(payload) || payload.captureToken !== expectedToken) {
    return undefined;
  }

  if (
    payload.type !== "click" &&
    payload.type !== "fill" &&
    payload.type !== "press" &&
    payload.type !== "viewport" &&
    payload.type !== "navigation"
  ) {
    return undefined;
  }

  const data = parseBrowserPayloadData(payload.type, payload.data);
  if (payload.data !== undefined && data === undefined) {
    return undefined;
  }

  return {
    type: payload.type,
    pageUrl: stringValue(payload.pageUrl),
    pageTitle: stringValue(payload.pageTitle),
    viewport: parseViewport(payload.viewport),
    data,
  };
}

function parseBrowserPayloadData(
  type: BrowserBindingPayload["type"],
  data: unknown,
): Record<string, unknown> | undefined {
  if (data === undefined) {
    return undefined;
  }

  if (!isRecord(data)) {
    return undefined;
  }

  if (type === "click") {
    return omitUndefined({
      x: numberValue(data.x),
      y: numberValue(data.y),
      button: numberValue(data.button),
      modifiers: parseModifiers(data.modifiers),
      target: parseTargetHint(data.target),
    });
  }

  if (type === "fill") {
    return omitUndefined({
      target: parseTargetHint(data.target),
      value: stringValue(data.value),
      inputType: stringValue(data.inputType),
      inputMethod: stringValue(data.inputMethod),
    });
  }

  if (type === "press") {
    return omitUndefined({
      key: stringValue(data.key),
      keyKind: data.keyKind === "printable" ? data.keyKind : undefined,
      modifiers: parseModifiers(data.modifiers),
      target: parseTargetHint(data.target),
    });
  }

  if (type === "viewport") {
    return omitUndefined({
      width: numberValue(data.width),
      height: numberValue(data.height),
    });
  }

  return omitUndefined({
    phase: stringValue(data.phase),
  });
}

function parseModifiers(value: unknown): Record<string, boolean> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return omitUndefined({
    alt: booleanValue(value.alt),
    ctrl: booleanValue(value.ctrl),
    meta: booleanValue(value.meta),
    shift: booleanValue(value.shift),
  }) as Record<string, boolean>;
}

function parseTargetHint(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return omitUndefined({
    tagName: stringValue(value.tagName),
    inputType: stringValue(value.inputType),
    role: stringValue(value.role),
    label: stringValue(value.label),
    text: stringValue(value.text),
    editable: booleanValue(value.editable),
  });
}

function parseViewport(value: unknown): BrowserBindingPayload["viewport"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const width = numberValue(value.width);
  const height = numberValue(value.height);
  return width === undefined || height === undefined ? undefined : { width, height };
}

function omitUndefined<T extends Record<string, unknown>>(record: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeBrowserPayloadData(
  payload: BrowserBindingPayload,
): Record<string, unknown> | undefined {
  if (payload.type === "fill") {
    return normalizeFillPayloadData(payload.data);
  }

  if (payload.type === "press") {
    return normalizePressPayloadData(payload.data);
  }

  return payload.data;
}

function normalizeFillPayloadData(
  data: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const value = typeof data?.value === "string" ? data.value : undefined;
  const inputType = typeof data?.inputType === "string" ? data.inputType : undefined;
  const rest = { ...(data ?? {}) };
  delete rest.value;
  delete rest.inputType;
  const target = sanitizeFillTarget(rest.target);
  if (target === undefined) {
    delete rest.target;
  } else {
    rest.target = target;
  }
  return {
    ...rest,
    ...redactCapturedValue({ value, inputType }),
  };
}

function normalizePressPayloadData(
  data: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (data === undefined) {
    return undefined;
  }

  const rest = { ...data };
  const target = sanitizeEditableTarget(rest.target);
  if (target === undefined) {
    delete rest.target;
  } else {
    rest.target = target;
  }

  if (isEditableTarget(target) && typeof rest.key === "string" && isPrintableKey(rest.key)) {
    rest.key = "[redacted]";
    rest.keyKind = "printable";
  }

  return rest;
}

function sanitizeFillTarget(target: unknown): Record<string, unknown> | undefined {
  if (target === null || typeof target !== "object" || Array.isArray(target)) {
    return undefined;
  }

  const sanitized = { ...(target as Record<string, unknown>) };
  delete sanitized.text;
  return sanitized;
}

function sanitizeEditableTarget(target: unknown): Record<string, unknown> | undefined {
  if (target === null || typeof target !== "object" || Array.isArray(target)) {
    return undefined;
  }

  const sanitized = { ...(target as Record<string, unknown>) };
  if (isEditableTarget(sanitized)) {
    delete sanitized.text;
  }
  return sanitized;
}

function isEditableTarget(target: unknown): boolean {
  if (target === null || typeof target !== "object" || Array.isArray(target)) {
    return false;
  }

  const record = target as Record<string, unknown>;
  return (
    record.editable === true ||
    record.tagName === "TEXTAREA" ||
    record.tagName === "SELECT" ||
    (record.tagName === "INPUT" && record.inputType !== "button" && record.inputType !== "submit")
  );
}

function isPrintableKey(key: string): boolean {
  return !NON_PRINTABLE_KEYS.has(key);
}

function sanitizeConsoleLocation(
  location: PlaywrightConsoleMessage["location"],
): PlaywrightConsoleMessage["location"] | undefined {
  if (location === undefined) {
    return undefined;
  }

  return {
    ...location,
    url: stripUrlSecrets(location.url),
  };
}

function sanitizeSnapshot(snapshot: PlaywrightPageSnapshot): PlaywrightPageSnapshot {
  return {
    ...snapshot,
    pageUrl: sanitizeUrlField(snapshot.pageUrl),
  };
}

function sanitizeCaptureData(data: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...data };
  if (typeof sanitized.sourceUrl === "string") {
    sanitized.sourceUrl = stripUrlSecrets(sanitized.sourceUrl);
  }
  return sanitized;
}

function sanitizeUrlField(value: string | undefined): string | undefined {
  return value === undefined ? undefined : stripUrlSecrets(value);
}

function stripUrlSecrets(value: string): string {
  try {
    const url = new URL(value);
    if (url.origin === "null") {
      return value.split(/[?#]/, 1)[0] ?? value;
    }
    return `${url.origin}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return value.split(/[?#]/, 1)[0] ?? value;
  }
}

function browserInstrumentationScript(bindingName: string, captureToken: string): string {
  return `
(() => {
  const captureToken = ${JSON.stringify(captureToken)};
  const send = (payload) => {
    const binding = window["${bindingName}"];
    if (typeof binding === "function") {
      void binding({ ...payload, captureToken });
    }
  };
  const isEditableTarget = (target) => {
    if (!(target instanceof Element)) return false;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
    if (target instanceof HTMLInputElement) {
      return target.type !== "button" && target.type !== "submit";
    }
    return target.isContentEditable;
  };
  const nonPrintableKeys = new Set(${JSON.stringify([...NON_PRINTABLE_KEYS])});
  const isPrintableKey = (key) => !nonPrintableKeys.has(key);
  const stripUrlSecrets = (value) => {
    try {
      const url = new URL(value);
      if (url.origin === "null") {
        return String(value).split(/[?#]/, 1)[0] || value;
      }
      return url.origin + (url.pathname === "/" ? "" : url.pathname);
    } catch {
      return String(value).split(/[?#]/, 1)[0] || value;
    }
  };
  const targetHint = (target) => {
    if (!(target instanceof Element)) return undefined;
    const editable = isEditableTarget(target) || undefined;
    const text = editable ? undefined : (target.textContent || "").trim().slice(0, 120) || undefined;
    const label = target.getAttribute("aria-label") || undefined;
    const role = target.getAttribute("role") || undefined;
    const tagName = target.tagName;
    const inputType = target instanceof HTMLInputElement ? target.type : undefined;
    return { tagName, inputType, role, label, text, editable };
  };
  const pressKey = (event) => {
    if (isEditableTarget(event.target) && isPrintableKey(event.key)) {
      return "[redacted]";
    }
    return event.key;
  };
  const pageFields = () => ({
    pageUrl: stripUrlSecrets(window.location.href),
    pageTitle: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight }
  });
  const sendNavigation = (phase) => {
    send({ type: "navigation", ...pageFields(), data: { phase } });
  };
  const wrapHistoryMethod = (methodName) => {
    const original = window.history[methodName];
    window.history[methodName] = function(...args) {
      const result = original.apply(this, args);
      queueMicrotask(() => sendNavigation(methodName));
      return result;
    };
  };
  wrapHistoryMethod("pushState");
  wrapHistoryMethod("replaceState");
  window.addEventListener("popstate", () => sendNavigation("popstate"));
  window.addEventListener("hashchange", () => sendNavigation("hashchange"));
  document.addEventListener("click", (event) => {
    send({
      type: "click",
      ...pageFields(),
      data: {
        x: event.clientX,
        y: event.clientY,
        button: event.button,
        modifiers: { alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey },
        target: targetHint(event.target)
      }
    });
  }, true);
  document.addEventListener("keydown", (event) => {
    send({
      type: "press",
      ...pageFields(),
      data: {
        key: pressKey(event),
        keyKind: isEditableTarget(event.target) && isPrintableKey(event.key) ? "printable" : undefined,
        modifiers: { alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey },
        target: targetHint(event.target)
      }
    });
  }, true);
  document.addEventListener("input", (event) => {
    const target = event.target;
    const value = target && "value" in target ? String(target.value) : undefined;
    const inputType = target instanceof HTMLInputElement ? target.type : undefined;
    send({
      type: "fill",
      ...pageFields(),
      data: {
        target: targetHint(target),
        value,
        inputType,
        inputMethod: event.inputType || "input"
      }
    });
  }, true);
  window.addEventListener("resize", () => {
    send({ type: "viewport", ...pageFields(), data: { width: window.innerWidth, height: window.innerHeight } });
  });
})();
`;
}
