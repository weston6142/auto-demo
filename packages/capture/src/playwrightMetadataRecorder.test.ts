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

describe("createPlaywrightMetadataRecorder", () => {
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

    await page.binding?.({
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
    });

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

    const browserWrite = page.binding?.({
      type: "click",
      pageUrl: "https://example.com",
      pageTitle: "Example",
      viewport: { width: 1280, height: 720 },
      data: { x: 10, y: 20 },
    });
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

    await page.binding?.({
      type: "fill",
      pageUrl: "https://example.com/editor",
      pageTitle: "Editor",
      viewport: { width: 1280, height: 720 },
      data: {
        target: { tagName: "DIV", role: "textbox", text: "secret draft" },
        inputMethod: "insertText",
      },
    });

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

  it("records console and page error summaries", async () => {
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
      text: "Something useful happened",
      location: { url: "https://example.com/app.js", lineNumber: 10, columnNumber: 2 },
    });
    page.pageErrorHandler?.({
      name: "Error",
      message: "Render failed",
      stack: "Error: Render failed\n    at render (app.js:10:2)",
    });
    await recorder.close();

    expect(writer.events).toEqual([
      expect.objectContaining({
        sequence: 1,
        type: "console",
        data: {
          level: "warning",
          text: "Something useful happened",
          location: { url: "https://example.com/app.js", lineNumber: 10, columnNumber: 2 },
        },
      }),
      expect.objectContaining({
        sequence: 2,
        type: "page_error",
        data: {
          name: "Error",
          message: "Render failed",
          stackSummary: "Error: Render failed",
        },
      }),
    ]);
  });
});
