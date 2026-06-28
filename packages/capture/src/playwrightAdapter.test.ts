import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPlaywrightBrowserCaptureAdapterForDriver } from "./playwrightAdapter.js";
import type {
  PlaywrightBrowser,
  PlaywrightBrowserContext,
  PlaywrightDriver,
  PlaywrightPage,
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

  constructor(private readonly fakeVideo: PlaywrightVideo | null) {}

  async goto(url: string): Promise<void> {
    this.gotos.push(url);
  }

  video(): PlaywrightVideo | null {
    return this.fakeVideo;
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
