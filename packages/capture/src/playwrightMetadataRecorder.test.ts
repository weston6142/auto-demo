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

class FakePage implements PlaywrightPage {
  public readonly gotos: string[] = [];
  public readonly initScripts: string[] = [];
  public binding: BrowserBindingCallback | undefined;
  public consoleHandler: ((message: PlaywrightConsoleMessage) => void) | undefined;
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
