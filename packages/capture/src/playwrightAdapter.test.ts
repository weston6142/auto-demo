import { appendFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CaptureEvent } from "./captureEvents.js";
import type { BrowserCaptureController } from "./index.js";
import type { JsonlEventWriter } from "./jsonlEventWriter.js";
import { validateCaptureBundle } from "./captureManifest.js";
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
  public readonly controlledActions: string[] = [];

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

  onNavigation(_callback: (phase: string) => void): void {}

  onPageError(_callback: (error: PlaywrightPageError) => void): void {}

  async snapshotMetadata() {
    return {
      pageUrl: this.currentUrl,
      pageTitle: this.currentTitle,
      viewport: this.viewport,
    };
  }

  executionController(): BrowserCaptureController {
    return {
      navigate: async (url) => {
        this.controlledActions.push(`navigate:${url}`);
      },
      click: async (target) => {
        this.controlledActions.push(`click:${target.label}`);
      },
      type: async (target) => {
        this.controlledActions.push(`type:${target.label}`);
      },
      assertVisible: async (target) => {
        this.controlledActions.push(`assert:${target.label}`);
      },
      assertNavigation: async (expectation) => {
        this.controlledActions.push(`assert-navigation:${expectation.url}`);
      },
      waitForSettled: async () => {
        this.controlledActions.push("settled");
      },
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
    await result.session.browser.click({ label: "Get started" });
    expect(driver.browser.context.page.controlledActions).toEqual(["click:Get started"]);
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

    const manifest = JSON.parse(await readFile(`${outputDir}/capture.manifest.json`, "utf8"));
    expect(manifest).toEqual({
      schemaVersion: 1,
      status: "completed",
      source: { kind: "browser", url: "https://example.com/demo" },
      adapter: { kind: "browser", backend: "playwright" },
      tools: { capturePackage: "0.0.0", playwright: "1.61.1" },
      viewport: { width: 1280, height: 720 },
      startedAt: "2026-06-28T12:00:00.000Z",
      endedAt: "2026-06-28T12:00:02.500Z",
      durationMs: 2500,
      artifacts: {
        media: "media/raw.webm",
        events: "metadata/events.jsonl",
      },
      childCommand: null,
      error: null,
    });
  });

  it("returns metadata path and writes capture lifecycle events when the session stops", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "auto-demo-playwright-metadata-"));
    const driver = new FakeDriver(join(outputDir, "media", "raw.webm"));
    const adapter = createPlaywrightBrowserCaptureAdapterForDriver(driver, {
      now: (() => {
        const dates = [
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
      childCommand: { command: "npm", args: ["run", "walkthrough", "--token", "secret"] },
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
          childCommand: { command: "npm", argCount: 4, argsRedacted: true },
        },
      }),
      expect.objectContaining({
        sequence: 2,
        type: "capture_stopped",
        timestampMs: 2500,
        data: { reason: "completed", durationMs: 2500 },
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("--token");
    expect(JSON.stringify(events)).not.toContain("secret");
  });

  it("redacts source URL secrets and child command args from the manifest", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "auto-demo-playwright-manifest-redaction-"));
    const driver = new FakeDriver(join(outputDir, "media", "raw.webm"));
    const adapter = createPlaywrightBrowserCaptureAdapterForDriver(driver, {
      now: (() => {
        const dates = [new Date("2026-06-29T12:00:00.000Z"), new Date("2026-06-29T12:00:02.500Z")];
        return () => dates.shift() ?? new Date("2026-06-29T12:00:02.500Z");
      })(),
    });

    const startResult = await adapter.start({
      source: { kind: "browser", url: "https://example.com/callback?token=secret#session" },
      outputDir,
      viewport: { width: 1280, height: 720 },
      startedAt: "2026-06-29T11:59:59.000Z",
      childCommand: { command: "npm", args: ["run", "walkthrough", "--token", "secret"] },
    });

    expect(startResult.ok).toBe(true);
    if (!startResult.ok) {
      return;
    }

    const stopResult = await startResult.session.stop("completed");

    expect(stopResult.ok).toBe(true);
    const manifest = JSON.parse(await readFile(`${outputDir}/capture.manifest.json`, "utf8"));
    expect(manifest.source).toEqual({ kind: "browser", url: "https://example.com/callback" });
    expect(manifest.childCommand).toEqual({
      command: "npm",
      argCount: 4,
      argsRedacted: true,
      exitCode: null,
    });
    expect(JSON.stringify(manifest)).not.toContain("token=secret");
    expect(JSON.stringify(manifest)).not.toContain("--token");
  });

  it("writes stable diagnostics for failed and interrupted capture bundles", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "auto-demo-playwright-status-diagnostics-"));
    const driver = new FakeDriver(join(outputDir, "media", "raw.webm"));
    const adapter = createPlaywrightBrowserCaptureAdapterForDriver(driver, {
      now: (() => {
        const dates = [new Date("2026-06-29T12:00:00.000Z"), new Date("2026-06-29T12:00:02.500Z")];
        return () => dates.shift() ?? new Date("2026-06-29T12:00:02.500Z");
      })(),
    });

    const startResult = await adapter.start({
      source: { kind: "browser", url: "https://example.com/demo?token=secret" },
      outputDir,
      viewport: { width: 1280, height: 720 },
      startedAt: "2026-06-29T12:00:00.000Z",
      childCommand: { command: "npm", args: ["run", "demo", "--token", "secret"] },
    });

    expect(startResult.ok).toBe(true);
    if (!startResult.ok) {
      return;
    }

    const stopResult = await startResult.session.stop("failed");

    expect(stopResult.ok).toBe(true);
    const manifest = JSON.parse(await readFile(`${outputDir}/capture.manifest.json`, "utf8"));
    expect(manifest.status).toBe("failed");
    expect(manifest.error).toEqual({
      code: "capture_failed",
      message: "Capture stopped after a failure.",
    });
    expect(manifest.source.url).toBe("https://example.com/demo");
    expect(manifest.childCommand).toEqual({
      command: "npm",
      argCount: 4,
      argsRedacted: true,
      exitCode: null,
    });
    expect(JSON.stringify(manifest)).not.toContain("secret");
    expect(JSON.stringify(manifest)).not.toContain("--token");
  });

  it("leaves a valid interrupted bundle when artifacts are flushed", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "auto-demo-playwright-interrupted-"));
    await mkdir(join(outputDir, "media"), { recursive: true });
    await writeFile(join(outputDir, "media", "raw.webm"), "partial video");
    const driver = new FakeDriver(join(outputDir, "media", "raw.webm"));
    const adapter = createPlaywrightBrowserCaptureAdapterForDriver(driver, {
      now: (() => {
        const dates = [new Date("2026-06-29T12:00:00.000Z"), new Date("2026-06-29T12:00:02.500Z")];
        return () => dates.shift() ?? new Date("2026-06-29T12:00:02.500Z");
      })(),
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

    const stopResult = await startResult.session.stop("interrupted");

    expect(stopResult.ok).toBe(true);
    const validation = await validateCaptureBundle(outputDir);
    expect(validation.ok).toBe(true);
    if (!validation.ok) {
      return;
    }
    expect(validation.manifest.status).toBe("interrupted");
    expect(validation.manifest.error).toEqual({
      code: "capture_interrupted",
      message: "Capture was interrupted before normal completion.",
    });
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

  it("closes the metadata writer when recorder attachment fails", async () => {
    class FailingAttachPage extends FakePage {
      override async addInitScript(): Promise<void> {
        throw new Error("init script failed");
      }
    }

    class FailingAttachContext extends FakeContext {
      constructor() {
        super(new FailingAttachPage(new FakeVideo("unused.webm")));
      }
    }

    class FailingAttachBrowser extends FakeBrowser {
      constructor() {
        super(new FailingAttachContext());
      }
    }

    class FailingAttachDriver implements PlaywrightDriver {
      public readonly browser = new FailingAttachBrowser();

      async launchChromium(): Promise<PlaywrightBrowser> {
        return this.browser;
      }
    }

    class CloseTrackingWriter implements JsonlEventWriter {
      public closed = false;

      async write(): Promise<void> {}

      async close(): Promise<void> {
        this.closed = true;
      }
    }

    const writer = new CloseTrackingWriter();
    const driver = new FailingAttachDriver();
    const outputDir = await mkdtemp(join(tmpdir(), "auto-demo-playwright-recorder-failure-"));
    const adapter = createPlaywrightBrowserCaptureAdapterForDriver(driver, {
      now: () => new Date("2026-06-29T12:00:00.000Z"),
      createEventWriter: async () => writer,
    });

    const result = await adapter.start({
      source: { kind: "browser", url: "https://example.com/demo" },
      outputDir,
      viewport: { width: 1280, height: 720 },
      startedAt: "2026-06-29T12:00:00.000Z",
    });

    expect(result).toEqual({
      ok: false,
      code: "capture_setup_failed",
      message: "Browser capture setup failed.",
      outputDir,
      manifestPath: `${outputDir}/capture.manifest.json`,
    });
    expect(writer.closed).toBe(true);
    expect(driver.browser.context.closed).toBe(true);
    expect(driver.browser.closed).toBe(true);
  });

  it("preserves a diagnostic bundle when capture stop fails after artifacts exist", async () => {
    class FailingCloseFileWriter implements JsonlEventWriter {
      public constructor(private readonly eventsPath: string) {}

      async write(event: CaptureEvent): Promise<void> {
        await appendFile(this.eventsPath, `${JSON.stringify(event)}\n`, "utf8");
      }

      async close(): Promise<void> {
        throw new Error("metadata close failed with token=secret");
      }
    }

    const outputDir = await mkdtemp(join(tmpdir(), "auto-demo-playwright-diagnostic-stop-"));
    await mkdir(join(outputDir, "media"), { recursive: true });
    await writeFile(join(outputDir, "media", "raw.webm"), "partial video");
    const driver = new FakeDriver(join(outputDir, "media", "raw.webm"));
    const adapter = createPlaywrightBrowserCaptureAdapterForDriver(driver, {
      now: (() => {
        const dates = [new Date("2026-06-29T12:00:00.000Z"), new Date("2026-06-29T12:00:02.500Z")];
        return () => dates.shift() ?? new Date("2026-06-29T12:00:02.500Z");
      })(),
      createEventWriter: async (eventsPath) => new FailingCloseFileWriter(eventsPath),
    });

    const startResult = await adapter.start({
      source: { kind: "browser", url: "https://example.com/demo?token=secret" },
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

    const validation = await validateCaptureBundle(outputDir);
    expect(validation.ok).toBe(true);
    if (!validation.ok) {
      return;
    }
    expect(validation.manifest.status).toBe("failed");
    expect(validation.manifest.error).toEqual({
      code: "capture_stop_failed",
      message: "Browser capture stop failed.",
    });
    expect(JSON.stringify(validation.manifest)).not.toContain("token=secret");
  });

  it("uses the generated Playwright video path for stop failure diagnostics in reused output directories", async () => {
    class FailingCloseFileWriter implements JsonlEventWriter {
      public constructor(private readonly eventsPath: string) {}

      async write(event: CaptureEvent): Promise<void> {
        await appendFile(this.eventsPath, `${JSON.stringify(event)}\n`, "utf8");
      }

      async close(): Promise<void> {
        throw new Error("metadata close failed");
      }
    }

    const outputDir = await mkdtemp(join(tmpdir(), "auto-demo-playwright-generated-video-"));
    await mkdir(join(outputDir, "media"), { recursive: true });
    await writeFile(join(outputDir, "media", "viewport.webm"), "stale video");
    const generatedVideoPath = join(outputDir, "media", "playwright-generated.webm");
    await writeFile(generatedVideoPath, "partial video");
    const driver = new FakeDriver(generatedVideoPath);
    const adapter = createPlaywrightBrowserCaptureAdapterForDriver(driver, {
      now: (() => {
        const dates = [new Date("2026-06-29T12:00:00.000Z"), new Date("2026-06-29T12:00:02.500Z")];
        return () => dates.shift() ?? new Date("2026-06-29T12:00:02.500Z");
      })(),
      createEventWriter: async (eventsPath) => new FailingCloseFileWriter(eventsPath),
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

    expect(stopResult.ok).toBe(false);
    const validation = await validateCaptureBundle(outputDir);
    expect(validation.ok).toBe(true);
    if (!validation.ok) {
      return;
    }
    expect(validation.manifest.artifacts.media).toBe("media/playwright-generated.webm");
  });
});
