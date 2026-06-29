import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CaptureEvent } from "./captureEvents.js";
import type { JsonlEventWriter } from "./jsonlEventWriter.js";
import { createPlaywrightBrowserCaptureAdapterForDriver } from "./playwrightAdapter.js";
import type {
  BrowserBindingCallback,
  PlaywrightConsoleMessage,
  PlaywrightBrowser,
  PlaywrightBrowserContext,
  PlaywrightDriver,
  PlaywrightPage,
  PlaywrightPageError,
  PlaywrightVideo,
} from "./playwrightDriver.js";

class FakeVideo implements PlaywrightVideo {
  constructor(private readonly videoPath: string) {}

  async path(): Promise<string> {
    return this.videoPath;
  }
}

class FakePage implements PlaywrightPage {
  public readonly gotos: string[] = [];
  public readonly initScripts: string[] = [];
  public currentUrl = "https://example.com/demo";
  public currentTitle = "Demo";
  public viewport = { width: 1280, height: 720 };

  constructor(private readonly fakeVideo: PlaywrightVideo | null) {}

  async goto(url: string): Promise<void> {
    this.gotos.push(url);
    this.currentUrl = url;
  }

  video(): PlaywrightVideo | null {
    return this.fakeVideo;
  }

  async exposeBinding(_name: string, _callback: BrowserBindingCallback): Promise<void> {}

  async addInitScript(script: string): Promise<void> {
    this.initScripts.push(script);
  }

  onConsole(_callback: (message: PlaywrightConsoleMessage) => void): void {}

  onPageError(_callback: (error: PlaywrightPageError) => void): void {}

  async snapshotMetadata() {
    return {
      pageUrl: this.currentUrl,
      pageTitle: this.currentTitle,
      viewport: this.viewport,
    };
  }
}

class FakeContext implements PlaywrightBrowserContext {
  public closed = false;

  constructor(public readonly page: FakePage) {}

  async newPage(): Promise<PlaywrightPage> {
    return this.page;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeBrowser implements PlaywrightBrowser {
  public closed = false;
  public readonly newContextOptions: unknown[] = [];

  constructor(public readonly context: FakeContext) {}

  async newContext(options: unknown): Promise<PlaywrightBrowserContext> {
    this.newContextOptions.push(options);
    return this.context;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeDriver implements PlaywrightDriver {
  public readonly browser: FakeBrowser;

  constructor(videoPath: string) {
    this.browser = new FakeBrowser(new FakeContext(new FakePage(new FakeVideo(videoPath))));
  }

  async launchChromium(): Promise<PlaywrightBrowser> {
    return this.browser;
  }
}

describe("createPlaywrightBrowserCaptureAdapter", () => {
  it("launches bundled Chromium with viewport recording and navigates to the source URL", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "auto-demo-playwright-unit-"));
    const driver = new FakeDriver(join(outputDir, "media", "raw.webm"));
    const adapter = createPlaywrightBrowserCaptureAdapterForDriver(driver, {
      now: () => new Date("2026-06-28T12:00:00.000Z"),
    });

    const result = await adapter.start({
      source: { kind: "browser", url: "https://example.com/demo" },
      outputDir: `${outputDir}///`,
      viewport: { width: 1440, height: 900 },
      startedAt: "2026-06-28T11:59:59.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.outputDir).toBe(outputDir);
    expect(result.manifestPath).toBe(`${outputDir}/capture.manifest.json`);
    expect(driver.browser.newContextOptions).toEqual([
      {
        viewport: { width: 1440, height: 900 },
        recordVideo: {
          dir: `${outputDir}/media`,
          size: { width: 1440, height: 900 },
        },
      },
    ]);
    expect(driver.browser.context.page.gotos).toEqual(["https://example.com/demo"]);
    expect(result.session.outputDir).toBe(outputDir);
    expect(result.session.manifestPath).toBe(`${outputDir}/capture.manifest.json`);
  });

  it("returns media and timing when the session stops", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "auto-demo-playwright-stop-"));
    const driver = new FakeDriver(join(outputDir, "media", "raw.webm"));
    const adapter = createPlaywrightBrowserCaptureAdapterForDriver(driver, {
      now: (() => {
        const dates = [new Date("2026-06-28T12:00:00.000Z"), new Date("2026-06-28T12:00:02.500Z")];
        return () => dates.shift() ?? new Date("2026-06-28T12:00:02.500Z");
      })(),
    });

    const startResult = await adapter.start({
      source: { kind: "browser", url: "https://example.com/demo" },
      outputDir,
      viewport: { width: 1280, height: 720 },
      startedAt: "2026-06-28T11:59:59.000Z",
    });

    expect(startResult.ok).toBe(true);
    if (!startResult.ok) {
      return;
    }

    const stopResult = await startResult.session.stop("completed");

    expect(stopResult).toEqual({
      ok: true,
      output: {
        outputDir,
        manifestPath: `${outputDir}/capture.manifest.json`,
        media: {
          kind: "viewport",
          path: `${outputDir}/media/raw.webm`,
          contentType: "video/webm",
        },
        metadata: {
          kind: "events",
          path: `${outputDir}/metadata/events.jsonl`,
          contentType: "application/x-ndjson",
        },
        timing: {
          startedAt: "2026-06-28T12:00:00.000Z",
          endedAt: "2026-06-28T12:00:02.500Z",
          durationMs: 2500,
        },
      },
    });
    expect(driver.browser.context.closed).toBe(true);
    expect(driver.browser.closed).toBe(true);
  });

  it("returns metadata path and writes capture lifecycle events when the session stops", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "auto-demo-playwright-metadata-"));
    const driver = new FakeDriver(join(outputDir, "media", "raw.webm"));
    const adapter = createPlaywrightBrowserCaptureAdapterForDriver(driver, {
      now: (() => {
        const dates = [
          new Date("2026-06-29T12:00:00.000Z"),
          new Date("2026-06-29T12:00:00.000Z"),
          new Date("2026-06-29T12:00:02.500Z"),
          new Date("2026-06-29T12:00:02.500Z"),
        ];
        return () => dates.shift() ?? new Date("2026-06-29T12:00:02.500Z");
      })(),
    });

    const startResult = await adapter.start({
      source: { kind: "browser", url: "https://example.com/demo" },
      outputDir,
      viewport: { width: 1280, height: 720 },
      startedAt: "2026-06-29T11:59:59.000Z",
      childCommand: { command: "npm", args: ["run", "walkthrough"] },
    });

    expect(startResult.ok).toBe(true);
    if (!startResult.ok) {
      return;
    }

    const stopResult = await startResult.session.stop("completed");

    expect(stopResult.ok).toBe(true);
    if (!stopResult.ok) {
      return;
    }

    expect(stopResult.output.metadata).toEqual({
      kind: "events",
      path: `${outputDir}/metadata/events.jsonl`,
      contentType: "application/x-ndjson",
    });

    const events = (await readFile(stopResult.output.metadata.path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events).toEqual([
      expect.objectContaining({
        sequence: 1,
        type: "capture_started",
        timestampMs: 0,
        data: {
          sourceUrl: "https://example.com/demo",
          viewport: { width: 1280, height: 720 },
          childCommand: { command: "npm", args: ["run", "walkthrough"] },
        },
      }),
      expect.objectContaining({
        sequence: 2,
        type: "capture_stopped",
        timestampMs: 2500,
        data: { reason: "completed", durationMs: 2500 },
      }),
    ]);
  });

  it("returns stop failure when metadata cannot be flushed", async () => {
    class FailingCloseWriter implements JsonlEventWriter {
      public readonly events: CaptureEvent[] = [];

      async write(event: CaptureEvent): Promise<void> {
        this.events.push(event);
      }

      async close(): Promise<void> {
        throw new Error("metadata close failed");
      }
    }

    const outputDir = await mkdtemp(join(tmpdir(), "auto-demo-playwright-metadata-stop-failure-"));
    const driver = new FakeDriver(join(outputDir, "media", "raw.webm"));
    const adapter = createPlaywrightBrowserCaptureAdapterForDriver(driver, {
      now: () => new Date("2026-06-29T12:00:00.000Z"),
      createEventWriter: async () => new FailingCloseWriter(),
    });

    const startResult = await adapter.start({
      source: { kind: "browser", url: "https://example.com/demo" },
      outputDir,
      viewport: { width: 1280, height: 720 },
      startedAt: "2026-06-29T12:00:00.000Z",
    });

    expect(startResult.ok).toBe(true);
    if (!startResult.ok) {
      return;
    }

    const stopResult = await startResult.session.stop("completed");

    expect(stopResult).toEqual({
      ok: false,
      code: "capture_stop_failed",
      message: "Browser capture stop failed.",
      outputDir,
      manifestPath: `${outputDir}/capture.manifest.json`,
    });
    expect(driver.browser.context.closed).toBe(true);
    expect(driver.browser.closed).toBe(true);
  });

  it("returns the same result when stop is called twice", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "auto-demo-playwright-double-stop-"));
    const driver = new FakeDriver(join(outputDir, "media", "raw.webm"));
    const adapter = createPlaywrightBrowserCaptureAdapterForDriver(driver, {
      now: () => new Date("2026-06-28T12:00:00.000Z"),
    });
    const startResult = await adapter.start({
      source: { kind: "browser", url: "https://example.com/demo" },
      outputDir,
      viewport: { width: 1280, height: 720 },
      startedAt: "2026-06-28T12:00:00.000Z",
    });

    expect(startResult.ok).toBe(true);
    if (!startResult.ok) {
      return;
    }

    const first = await startResult.session.stop("completed");
    const second = await startResult.session.stop("interrupted");

    expect(second).toEqual(first);
  });

  it("shares the same stop result when stop calls overlap", async () => {
    class SlowContext extends FakeContext {
      public closeCalls = 0;
      private resolveClose: (() => void) | undefined;
      public readonly closeStarted = new Promise<void>((resolve) => {
        this.resolveClose = resolve;
      });

      override async close(): Promise<void> {
        this.closeCalls += 1;
        await this.closeStarted;
      }

      finishClose(): void {
        this.closed = true;
        this.resolveClose?.();
      }
    }

    class SlowDriver implements PlaywrightDriver {
      public readonly context: SlowContext;
      public readonly browser: FakeBrowser;

      constructor(videoPath: string) {
        this.context = new SlowContext(new FakePage(new FakeVideo(videoPath)));
        this.browser = new FakeBrowser(this.context);
      }

      async launchChromium(): Promise<PlaywrightBrowser> {
        return this.browser;
      }
    }

    const outputDir = await mkdtemp(join(tmpdir(), "auto-demo-playwright-concurrent-stop-"));
    const driver = new SlowDriver(join(outputDir, "media", "raw.webm"));
    const adapter = createPlaywrightBrowserCaptureAdapterForDriver(driver, {
      now: () => new Date("2026-06-28T12:00:00.000Z"),
    });
    const startResult = await adapter.start({
      source: { kind: "browser", url: "https://example.com/demo" },
      outputDir,
      viewport: { width: 1280, height: 720 },
      startedAt: "2026-06-28T12:00:00.000Z",
    });

    expect(startResult.ok).toBe(true);
    if (!startResult.ok) {
      return;
    }

    const first = startResult.session.stop("completed");
    const second = startResult.session.stop("interrupted");
    await Promise.resolve();
    driver.context.finishClose();

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(secondResult).toEqual(firstResult);
    expect(driver.context.closeCalls).toBe(1);
  });

  it("returns a setup failure and closes partial resources when navigation fails", async () => {
    class FailingPage extends FakePage {
      override async goto(): Promise<void> {
        throw new Error("navigation failed");
      }
    }

    class FailingContext extends FakeContext {
      constructor() {
        super(new FailingPage(new FakeVideo("unused.webm")));
      }
    }

    class FailingBrowser extends FakeBrowser {
      constructor() {
        super(new FailingContext());
      }
    }

    class FailingDriver implements PlaywrightDriver {
      public readonly browser = new FailingBrowser();

      async launchChromium(): Promise<PlaywrightBrowser> {
        return this.browser;
      }
    }

    const driver = new FailingDriver();
    const outputDir = await mkdtemp(join(tmpdir(), "auto-demo-playwright-setup-failure-"));
    const adapter = createPlaywrightBrowserCaptureAdapterForDriver(driver, {
      now: () => new Date("2026-06-28T12:00:00.000Z"),
    });

    const result = await adapter.start({
      source: { kind: "browser", url: "https://example.com/demo" },
      outputDir,
      viewport: { width: 1280, height: 720 },
      startedAt: "2026-06-28T12:00:00.000Z",
    });

    expect(result).toEqual({
      ok: false,
      code: "capture_setup_failed",
      message: "Browser capture setup failed.",
      outputDir,
      manifestPath: `${outputDir}/capture.manifest.json`,
    });
    expect(driver.browser.context.closed).toBe(true);
    expect(driver.browser.closed).toBe(true);
  });
});
