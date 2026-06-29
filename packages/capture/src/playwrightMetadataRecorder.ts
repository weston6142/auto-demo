import { redactCapturedValue, type CaptureEventFactory } from "./captureEvents.js";
import type { JsonlEventWriter } from "./jsonlEventWriter.js";
import type {
  BrowserBindingPayload,
  PlaywrightConsoleMessage,
  PlaywrightPage,
  PlaywrightPageError,
} from "./playwrightDriver.js";

const BINDING_NAME = "__autoDemoCaptureEvent";

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

  constructor(
    private readonly page: PlaywrightPage,
    private readonly writer: JsonlEventWriter,
    private readonly eventFactory: CaptureEventFactory,
  ) {}

  async attach(): Promise<void> {
    await this.page.exposeBinding(BINDING_NAME, async (payload) => {
      await this.enqueue(this.writeBrowserPayload(payload));
    });
    await this.page.addInitScript(browserInstrumentationScript(BINDING_NAME));
    this.page.onConsole((message) => {
      this.enqueue(this.writeConsole(message));
    });
    this.page.onNavigation(() => {
      this.enqueue(this.writeNavigation("framenavigated"));
    });
    this.page.onPageError((error) => {
      this.enqueue(this.writePageError(error));
    });
  }

  async writeCaptureStarted(data: Record<string, unknown>): Promise<void> {
    const snapshot = await this.page.snapshotMetadata();
    await this.writer.write(
      this.eventFactory.create("capture_started", {
        ...snapshot,
        data,
      }),
    );
  }

  async writeCaptureStopped(data: Record<string, unknown>): Promise<void> {
    const snapshot = await this.page.snapshotMetadata();
    await this.writer.write(
      this.eventFactory.create("capture_stopped", {
        ...snapshot,
        data,
      }),
    );
  }

  async close(): Promise<void> {
    await Promise.all(this.pendingWrites);
    await this.writer.close();
  }

  private enqueue(write: Promise<void>): Promise<void> {
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

  private async writeBrowserPayload(payload: BrowserBindingPayload): Promise<void> {
    await this.writer.write(
      this.eventFactory.create(payload.type, {
        pageUrl: payload.pageUrl,
        pageTitle: payload.pageTitle,
        viewport: payload.viewport,
        data: normalizeBrowserPayloadData(payload),
      }),
    );
  }

  private async writeConsole(message: PlaywrightConsoleMessage): Promise<void> {
    const snapshot = await this.page.snapshotMetadata();
    await this.writer.write(
      this.eventFactory.create("console", {
        ...snapshot,
        data: {
          level: message.type,
          text: truncateText(message.text, 500),
          location: message.location,
        },
      }),
    );
  }

  private async writeNavigation(phase: string): Promise<void> {
    const snapshot = await this.page.snapshotMetadata();
    await this.writer.write(
      this.eventFactory.create("navigation", {
        ...snapshot,
        data: { phase },
      }),
    );
  }

  private async writePageError(error: PlaywrightPageError): Promise<void> {
    const snapshot = await this.page.snapshotMetadata();
    await this.writer.write(
      this.eventFactory.create("page_error", {
        ...snapshot,
        data: {
          name: error.name,
          message: truncateText(error.message, 500),
          stackSummary: error.stack?.split("\n")[0],
        },
      }),
    );
  }
}

function normalizeBrowserPayloadData(
  payload: BrowserBindingPayload,
): Record<string, unknown> | undefined {
  if (payload.type !== "fill") {
    return payload.data;
  }

  const value = typeof payload.data?.value === "string" ? payload.data.value : undefined;
  const inputType =
    typeof payload.data?.inputType === "string" ? payload.data.inputType : undefined;
  const rest = { ...(payload.data ?? {}) };
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

function sanitizeFillTarget(target: unknown): Record<string, unknown> | undefined {
  if (target === null || typeof target !== "object" || Array.isArray(target)) {
    return undefined;
  }

  const sanitized = { ...(target as Record<string, unknown>) };
  delete sanitized.text;
  return sanitized;
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function browserInstrumentationScript(bindingName: string): string {
  return `
(() => {
  const send = (payload) => {
    const binding = window["${bindingName}"];
    if (typeof binding === "function") {
      void binding(payload);
    }
  };
  const targetHint = (target) => {
    if (!(target instanceof Element)) return undefined;
    const text = (target.textContent || "").trim().slice(0, 120) || undefined;
    const label = target.getAttribute("aria-label") || undefined;
    const role = target.getAttribute("role") || undefined;
    const tagName = target.tagName;
    const inputType = target instanceof HTMLInputElement ? target.type : undefined;
    return { tagName, inputType, role, label, text };
  };
  const pageFields = () => ({
    pageUrl: window.location.href,
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
        key: event.key,
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
