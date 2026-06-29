import { describe, expect, it } from "vitest";
import { createCaptureEventFactory, type CaptureEvent } from "./captureEvents.js";
import { createPlaywrightMetadataRecorder } from "./playwrightMetadataRecorder.js";
import type {
  BrowserBindingCallback,
  PlaywrightConsoleMessage,
  PlaywrightPage,
  PlaywrightPageError,
} from "./playwrightDriver.js";

class MemoryWriter {
  public readonly events: CaptureEvent[] = [];
  public closed = false;

  async write(event: CaptureEvent): Promise<void> {
    this.events.push(event);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class DeferredWriter extends MemoryWriter {
  private markWriteStarted: (() => void) | undefined;
  private releaseWrite: (() => void) | undefined;
  public readonly writeStarted = new Promise<void>((resolve) => {
    this.markWriteStarted = resolve;
  });
  private writeReleased = false;

  async write(event: CaptureEvent): Promise<void> {
    this.markWriteStarted?.();
    await new Promise<void>((resolve) => {
      this.releaseWrite = () => {
        this.writeReleased = true;
        resolve();
      };
    });
    await super.write(event);
  }

  release(): void {
    this.releaseWrite?.();
  }

  get released(): boolean {
    return this.writeReleased;
  }
}

class FakePage implements PlaywrightPage {
  public readonly gotos: string[] = [];
  public readonly initScripts: string[] = [];
  public binding: BrowserBindingCallback | undefined;
  public consoleHandler: ((message: PlaywrightConsoleMessage) => void) | undefined;
  public navigationHandler: (() => void) | undefined;
  public pageErrorHandler: ((error: PlaywrightPageError) => void) | undefined;
  public currentUrl = "https://example.com";
  public currentTitle = "Example";
  public viewport = { width: 1280, height: 720 };

  async goto(url: string): Promise<void> {
    this.gotos.push(url);
    this.currentUrl = url;
  }

  video(): null {
    return null;
  }

  async exposeBinding(_name: string, callback: BrowserBindingCallback): Promise<void> {
    this.binding = callback;
  }

  async addInitScript(script: string): Promise<void> {
    this.initScripts.push(script);
  }

  onConsole(callback: (message: PlaywrightConsoleMessage) => void): void {
    this.consoleHandler = callback;
  }

  onNavigation(callback: () => void): void {
    this.navigationHandler = callback;
  }

  onPageError(callback: (error: PlaywrightPageError) => void): void {
    this.pageErrorHandler = callback;
  }

  async snapshotMetadata() {
    return {
      pageUrl: this.currentUrl,
      pageTitle: this.currentTitle,
      viewport: this.viewport,
    };
  }
}

class DeferredSnapshotPage extends FakePage {
  private markFirstSnapshotStarted: (() => void) | undefined;
  private releaseFirstSnapshot: (() => void) | undefined;
  public readonly firstSnapshotStarted = new Promise<void>((resolve) => {
    this.markFirstSnapshotStarted = resolve;
  });
  private snapshotCount = 0;

  override async snapshotMetadata() {
    this.snapshotCount += 1;
    if (this.snapshotCount === 1) {
      this.markFirstSnapshotStarted?.();
      await new Promise<void>((resolve) => {
        this.releaseFirstSnapshot = resolve;
      });
    }

    return super.snapshotMetadata();
  }

  releaseSnapshot(): void {
    this.releaseFirstSnapshot?.();
  }
}

function trustedBrowserPayload(
  page: FakePage,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const script = page.initScripts[0] ?? "";
  const tokenLiteral = script.match(/const captureToken = ("(?:\\.|[^"\\])*");/)?.[1];
  if (tokenLiteral === undefined) {
    throw new Error("capture token not found in browser instrumentation");
  }

  return {
    ...payload,
    captureToken: JSON.parse(tokenLiteral) as string,
  };
}

describe("createPlaywrightMetadataRecorder", () => {
  it("removes query strings and hashes from stored URL fields", async () => {
    const page = new FakePage();
    page.currentUrl = "https://example.com/start?token=secret#session";
    const writer = new MemoryWriter();
    const recorder = await createPlaywrightMetadataRecorder({
      page,
      writer,
      eventFactory: createCaptureEventFactory({
        captureStartedAt: new Date("2026-06-29T12:00:00.000Z"),
        now: () => new Date("2026-06-29T12:00:01.000Z"),
      }),
    });

    await recorder.writeCaptureStarted({
      sourceUrl: "https://example.com/source?code=oauth#access_token",
    });
    await page.binding?.(
      trustedBrowserPayload(page, {
        type: "click",
        pageUrl: "https://example.com/click?token=secret#session",
        pageTitle: "Example",
        viewport: { width: 1280, height: 720 },
        data: { x: 10, y: 20 },
      }),
    );
    page.currentUrl = "https://example.com/dashboard?magic=link#token";
    page.navigationHandler?.();
    await recorder.close();

    expect(writer.events).toEqual([
      expect.objectContaining({
        type: "capture_started",
        pageUrl: "https://example.com/start",
        data: { sourceUrl: "https://example.com/source" },
      }),
      expect.objectContaining({
        type: "click",
        pageUrl: "https://example.com/click",
      }),
      expect.objectContaining({
        type: "navigation",
        pageUrl: "https://example.com/dashboard",
      }),
    ]);
    expect(JSON.stringify(writer.events)).not.toContain("secret");
    expect(JSON.stringify(writer.events)).not.toContain("oauth");
    expect(JSON.stringify(writer.events)).not.toContain("magic");
  });

  it("records browser-side interaction events with redacted fill values", async () => {
    const page = new FakePage();
    const writer = new MemoryWriter();
    const recorder = await createPlaywrightMetadataRecorder({
      page,
      writer,
      eventFactory: createCaptureEventFactory({
        captureStartedAt: new Date("2026-06-29T12:00:00.000Z"),
        now: () => new Date("2026-06-29T12:00:01.000Z"),
      }),
    });

    expect(page.initScripts).toHaveLength(1);
    expect(page.binding).toBeDefined();

    await page.binding?.(
      trustedBrowserPayload(page, {
        type: "fill",
        pageUrl: "https://example.com/settings",
        pageTitle: "Settings",
        viewport: { width: 1280, height: 720 },
        data: {
          target: { tagName: "INPUT", inputType: "email", label: "Email" },
          value: "person@example.com",
          inputType: "email",
          inputMethod: "keyboard",
        },
      }),
    );

    await recorder.close();

    expect(writer.events).toEqual([
      expect.objectContaining({
        sequence: 1,
        type: "fill",
        timestampMs: 1000,
        pageUrl: "https://example.com/settings",
        pageTitle: "Settings",
        viewport: { width: 1280, height: 720 },
        data: {
          target: { tagName: "INPUT", inputType: "email", label: "Email" },
          inputMethod: "keyboard",
          redacted: true,
          valueKind: "email_like",
          valueLength: 18,
        },
      }),
    ]);
    expect(writer.closed).toBe(true);
  });

  it("waits for in-flight browser-side events before closing", async () => {
    const page = new FakePage();
    const writer = new DeferredWriter();
    const recorder = await createPlaywrightMetadataRecorder({
      page,
      writer,
      eventFactory: createCaptureEventFactory({
        captureStartedAt: new Date("2026-06-29T12:00:00.000Z"),
        now: () => new Date("2026-06-29T12:00:01.000Z"),
      }),
    });

    const browserWrite = page.binding?.(
      trustedBrowserPayload(page, {
        type: "click",
        pageUrl: "https://example.com",
        pageTitle: "Example",
        viewport: { width: 1280, height: 720 },
        data: { x: 10, y: 20 },
      }),
    );
    expect(browserWrite).toBeDefined();
    await writer.writeStarted;

    const closeState = { closed: false };
    const close = recorder.close().then(() => {
      closeState.closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(closeState.closed).toBe(false);
    expect(writer.closed).toBe(false);
    expect(writer.released).toBe(false);

    writer.release();
    await browserWrite;
    await close;

    expect(writer.events).toEqual([
      expect.objectContaining({
        type: "click",
        pageUrl: "https://example.com",
      }),
    ]);
    expect(writer.closed).toBe(true);
  });

  it("removes target text from fill events", async () => {
    const page = new FakePage();
    const writer = new MemoryWriter();
    const recorder = await createPlaywrightMetadataRecorder({
      page,
      writer,
      eventFactory: createCaptureEventFactory({
        captureStartedAt: new Date("2026-06-29T12:00:00.000Z"),
        now: () => new Date("2026-06-29T12:00:01.000Z"),
      }),
    });

    await page.binding?.(
      trustedBrowserPayload(page, {
        type: "fill",
        pageUrl: "https://example.com/editor",
        pageTitle: "Editor",
        viewport: { width: 1280, height: 720 },
        data: {
          target: { tagName: "DIV", role: "textbox", text: "secret draft" },
          inputMethod: "insertText",
        },
      }),
    );

    await recorder.close();

    expect(writer.events[0]).toEqual(
      expect.objectContaining({
        type: "fill",
        data: {
          target: { tagName: "DIV", role: "textbox" },
          inputMethod: "insertText",
          redacted: true,
          valueKind: "unknown",
          valueLength: 0,
        },
      }),
    );
  });

  it("redacts printable press keys and target text from editable targets", async () => {
    const page = new FakePage();
    const writer = new MemoryWriter();
    const recorder = await createPlaywrightMetadataRecorder({
      page,
      writer,
      eventFactory: createCaptureEventFactory({
        captureStartedAt: new Date("2026-06-29T12:00:00.000Z"),
        now: () => new Date("2026-06-29T12:00:01.000Z"),
      }),
    });

    await page.binding?.(
      trustedBrowserPayload(page, {
        type: "press",
        pageUrl: "https://example.com/login",
        pageTitle: "Login",
        viewport: { width: 1280, height: 720 },
        data: {
          key: "s",
          modifiers: { alt: false, ctrl: false, meta: false, shift: false },
          target: {
            tagName: "INPUT",
            inputType: "password",
            label: "Password",
            text: "secret",
          },
        },
      }),
    );
    await page.binding?.(
      trustedBrowserPayload(page, {
        type: "press",
        pageUrl: "https://example.com/login",
        pageTitle: "Login",
        viewport: { width: 1280, height: 720 },
        data: {
          key: "Backspace",
          modifiers: { alt: false, ctrl: false, meta: false, shift: false },
          target: {
            tagName: "INPUT",
            inputType: "password",
            label: "Password",
            text: "secret",
          },
        },
      }),
    );

    await recorder.close();

    expect(writer.events).toEqual([
      expect.objectContaining({
        type: "press",
        data: {
          key: "[redacted]",
          keyKind: "printable",
          modifiers: { alt: false, ctrl: false, meta: false, shift: false },
          target: { tagName: "INPUT", inputType: "password", label: "Password" },
        },
      }),
      expect.objectContaining({
        type: "press",
        data: {
          key: "Backspace",
          modifiers: { alt: false, ctrl: false, meta: false, shift: false },
          target: { tagName: "INPUT", inputType: "password", label: "Password" },
        },
      }),
    ]);
  });

  it("redacts multi-code-unit printable press keys from editable targets", async () => {
    const page = new FakePage();
    const writer = new MemoryWriter();
    const recorder = await createPlaywrightMetadataRecorder({
      page,
      writer,
      eventFactory: createCaptureEventFactory({
        captureStartedAt: new Date("2026-06-29T12:00:00.000Z"),
        now: () => new Date("2026-06-29T12:00:01.000Z"),
      }),
    });

    await page.binding?.(
      trustedBrowserPayload(page, {
        type: "press",
        pageUrl: "https://example.com/message",
        pageTitle: "Message",
        viewport: { width: 1280, height: 720 },
        data: {
          key: "🔐",
          modifiers: { alt: false, ctrl: false, meta: false, shift: false },
          target: {
            tagName: "DIV",
            role: "textbox",
            editable: true,
            text: "🔐",
          },
        },
      }),
    );

    await recorder.close();

    expect(writer.events).toEqual([
      expect.objectContaining({
        type: "press",
        data: {
          key: "[redacted]",
          keyKind: "printable",
          modifiers: { alt: false, ctrl: false, meta: false, shift: false },
          target: { tagName: "DIV", role: "textbox", editable: true },
        },
      }),
    ]);
  });

  it("records page navigation snapshots", async () => {
    const page = new FakePage();
    const writer = new MemoryWriter();
    const recorder = await createPlaywrightMetadataRecorder({
      page,
      writer,
      eventFactory: createCaptureEventFactory({
        captureStartedAt: new Date("2026-06-29T12:00:00.000Z"),
        now: () => new Date("2026-06-29T12:00:01.000Z"),
      }),
    });

    page.currentUrl = "https://example.com/dashboard";
    page.currentTitle = "Dashboard";
    page.navigationHandler?.();
    await recorder.close();

    expect(writer.events).toEqual([
      expect.objectContaining({
        sequence: 1,
        type: "navigation",
        pageUrl: "https://example.com/dashboard",
        pageTitle: "Dashboard",
        viewport: { width: 1280, height: 720 },
        data: { phase: "framenavigated" },
      }),
    ]);
  });

  it("preserves observer event order when snapshots resolve later", async () => {
    const page = new DeferredSnapshotPage();
    const writer = new MemoryWriter();
    const recorder = await createPlaywrightMetadataRecorder({
      page,
      writer,
      eventFactory: createCaptureEventFactory({
        captureStartedAt: new Date("2026-06-29T12:00:00.000Z"),
        now: () => new Date("2026-06-29T12:00:00.250Z"),
      }),
    });

    page.consoleHandler?.({
      type: "warning",
      text: "first",
    });
    await page.firstSnapshotStarted;
    const clickWrite = page.binding?.(
      trustedBrowserPayload(page, {
        type: "click",
        pageUrl: "https://example.com",
        pageTitle: "Example",
        viewport: { width: 1280, height: 720 },
        data: { x: 10, y: 20 },
      }),
    );
    page.releaseSnapshot();
    await clickWrite;
    await recorder.close();

    expect(writer.events.map((event) => event.type)).toEqual(["console", "click"]);
    expect(writer.events.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it("uses observer-time timestamps when queued writes drain later", async () => {
    const page = new DeferredSnapshotPage();
    const writer = new MemoryWriter();
    let now = new Date("2026-06-29T12:00:00.250Z");
    const recorder = await createPlaywrightMetadataRecorder({
      page,
      writer,
      eventFactory: createCaptureEventFactory({
        captureStartedAt: new Date("2026-06-29T12:00:00.000Z"),
        now: () => now,
      }),
    });

    page.consoleHandler?.({
      type: "warning",
      text: "first",
    });
    await page.firstSnapshotStarted;
    now = new Date("2026-06-29T12:00:03.000Z");
    page.releaseSnapshot();
    await recorder.close();

    expect(writer.events).toEqual([
      expect.objectContaining({
        type: "console",
        timestampMs: 250,
      }),
    ]);
  });

  it("keeps capture stopped as the final metadata event", async () => {
    const page = new DeferredSnapshotPage();
    const writer = new MemoryWriter();
    const recorder = await createPlaywrightMetadataRecorder({
      page,
      writer,
      eventFactory: createCaptureEventFactory({
        captureStartedAt: new Date("2026-06-29T12:00:00.000Z"),
        now: () => new Date("2026-06-29T12:00:01.000Z"),
      }),
    });

    const stop = recorder.writeCaptureStopped({ reason: "completed" });
    await page.firstSnapshotStarted;
    const lateClick = page.binding?.(
      trustedBrowserPayload(page, {
        type: "click",
        pageUrl: "https://example.com",
        pageTitle: "Example",
        viewport: { width: 1280, height: 720 },
        data: { x: 10, y: 20 },
      }),
    );
    page.releaseSnapshot();
    await Promise.all([stop, lateClick]);
    await recorder.close();

    expect(writer.events.map((event) => event.type)).toEqual(["capture_stopped"]);
  });

  it("ignores browser events received after close starts", async () => {
    const page = new DeferredSnapshotPage();
    const writer = new MemoryWriter();
    const recorder = await createPlaywrightMetadataRecorder({
      page,
      writer,
      eventFactory: createCaptureEventFactory({
        captureStartedAt: new Date("2026-06-29T12:00:00.000Z"),
        now: () => new Date("2026-06-29T12:00:00.250Z"),
      }),
    });

    page.consoleHandler?.({
      type: "warning",
      text: "in flight",
    });
    await page.firstSnapshotStarted;
    const close = recorder.close();

    await page.binding?.(
      trustedBrowserPayload(page, {
        type: "click",
        pageUrl: "https://example.com",
        pageTitle: "Example",
        viewport: { width: 1280, height: 720 },
        data: { x: 10, y: 20 },
      }),
    );
    page.releaseSnapshot();
    await close;

    expect(writer.events.map((event) => event.type)).toEqual(["console"]);
  });

  it("records console and page error metadata without raw text", async () => {
    const page = new FakePage();
    const writer = new MemoryWriter();
    const recorder = await createPlaywrightMetadataRecorder({
      page,
      writer,
      eventFactory: createCaptureEventFactory({
        captureStartedAt: new Date("2026-06-29T12:00:00.000Z"),
        now: () => new Date("2026-06-29T12:00:00.250Z"),
      }),
    });

    page.consoleHandler?.({
      type: "warning",
      text: "token=secret-cookie-value",
      location: {
        url: "https://example.com/app.js?token=secret-cookie-value",
        lineNumber: 10,
        columnNumber: 2,
      },
    });
    page.pageErrorHandler?.({
      name: "Error",
      message: "Render failed with token=secret-cookie-value",
      stack: "Error: Render failed with token=secret-cookie-value\n    at render (app.js:10:2)",
    });
    await recorder.close();

    expect(writer.events).toEqual([
      expect.objectContaining({
        sequence: 1,
        type: "console",
        data: {
          level: "warning",
          textRedacted: true,
          textLength: 25,
          location: { url: "https://example.com/app.js", lineNumber: 10, columnNumber: 2 },
        },
      }),
      expect.objectContaining({
        sequence: 2,
        type: "page_error",
        data: {
          name: "Error",
          messageRedacted: true,
          messageLength: 44,
          stackRedacted: true,
        },
      }),
    ]);
    expect(JSON.stringify(writer.events)).not.toContain("secret-cookie-value");
  });

  it("ignores browser binding payloads without the recorder token", async () => {
    const page = new FakePage();
    const writer = new MemoryWriter();
    const recorder = await createPlaywrightMetadataRecorder({
      page,
      writer,
      eventFactory: createCaptureEventFactory({
        captureStartedAt: new Date("2026-06-29T12:00:00.000Z"),
        now: () => new Date("2026-06-29T12:00:01.000Z"),
      }),
    });

    await page.binding?.({
      type: "click",
      pageUrl: "https://example.com",
      pageTitle: "Example",
      viewport: { width: 1280, height: 720 },
      data: { text: "secret injected by page script" },
    });
    await page.binding?.({
      type: "click",
      captureToken: "wrong-token",
      pageUrl: "https://example.com",
      pageTitle: "Example",
      viewport: { width: 1280, height: 720 },
      data: { text: "secret injected by page script" },
    } as never);
    await recorder.close();

    expect(writer.events).toEqual([]);
  });

  it("keeps only known browser payload data fields", async () => {
    const page = new FakePage();
    const writer = new MemoryWriter();
    const recorder = await createPlaywrightMetadataRecorder({
      page,
      writer,
      eventFactory: createCaptureEventFactory({
        captureStartedAt: new Date("2026-06-29T12:00:00.000Z"),
        now: () => new Date("2026-06-29T12:00:01.000Z"),
      }),
    });

    await page.binding?.(
      trustedBrowserPayload(page, {
        type: "click",
        pageUrl: "https://example.com/dashboard?token=secret",
        pageTitle: "Dashboard",
        viewport: { width: 1280, height: 720 },
        data: {
          x: 10,
          y: 20,
          button: 0,
          text: "secret injected by page script",
          target: {
            tagName: "BUTTON",
            label: "Save",
            text: "Save",
            secret: "raw secret",
          },
        },
      }),
    );
    await recorder.close();

    expect(writer.events).toEqual([
      expect.objectContaining({
        type: "click",
        pageUrl: "https://example.com/dashboard",
        data: {
          x: 10,
          y: 20,
          button: 0,
          target: {
            tagName: "BUTTON",
            label: "Save",
            text: "Save",
          },
        },
      }),
    ]);
    expect(JSON.stringify(writer.events)).not.toContain("secret");
  });
});
