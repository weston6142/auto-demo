import { rename } from "node:fs/promises";
import type {
  BrowserCaptureAdapter,
  BrowserCaptureOptions,
  CaptureOutput,
  CaptureStartResult,
  CaptureStopReason,
  CaptureStopResult,
} from "./index.js";
import { buildCapturePaths, ensureCaptureDirectories, type CapturePaths } from "./capturePaths.js";
import {
  createDefaultPlaywrightDriver,
  type PlaywrightBrowser,
  type PlaywrightBrowserContext,
  type PlaywrightDriver,
  type PlaywrightPage,
} from "./playwrightDriver.js";

type PlaywrightAdapterDependencies = {
  now: () => Date;
};

export function createPlaywrightBrowserCaptureAdapter(): BrowserCaptureAdapter {
  return createPlaywrightBrowserCaptureAdapterForDriver(createDefaultPlaywrightDriver(), {
    now: () => new Date(),
  });
}

export function createPlaywrightBrowserCaptureAdapterForDriver(
  driver: PlaywrightDriver,
  dependencies: PlaywrightAdapterDependencies,
): BrowserCaptureAdapter {
  return {
    kind: "browser",
    async start(options) {
      return await startPlaywrightCapture(driver, dependencies, options);
    },
  };
}

async function startPlaywrightCapture(
  driver: PlaywrightDriver,
  dependencies: PlaywrightAdapterDependencies,
  options: BrowserCaptureOptions,
): Promise<CaptureStartResult> {
  const paths = buildCapturePaths(options.outputDir);
  let browser: PlaywrightBrowser | undefined;
  let context: PlaywrightBrowserContext | undefined;

  try {
    await ensureCaptureDirectories(paths);
    browser = await driver.launchChromium();
    context = await browser.newContext({
      viewport: options.viewport,
      recordVideo: {
        dir: paths.mediaDir,
        size: options.viewport,
      },
    });
    const page = await context.newPage();
    await page.goto(options.source.url);

    return {
      ok: true,
      outputDir: paths.outputDir,
      manifestPath: paths.manifestPath,
      session: new PlaywrightCaptureSession({
        browser,
        context,
        page,
        paths,
        startedAt: dependencies.now(),
        now: dependencies.now,
      }),
    };
  } catch {
    await closeQuietly(context);
    await closeQuietly(browser);

    return {
      ok: false,
      code: "capture_setup_failed",
      message: "Browser capture setup failed.",
      outputDir: paths.outputDir,
      manifestPath: paths.manifestPath,
    };
  }
}

class PlaywrightCaptureSession {
  public readonly outputDir: string;
  public readonly manifestPath: string;
  private stopResult: CaptureStopResult | undefined;

  constructor(
    private readonly state: {
      browser: PlaywrightBrowser;
      context: PlaywrightBrowserContext;
      page: PlaywrightPage;
      paths: CapturePaths;
      startedAt: Date;
      now: () => Date;
    },
  ) {
    this.outputDir = state.paths.outputDir;
    this.manifestPath = state.paths.manifestPath;
  }

  async stop(_reason: CaptureStopReason): Promise<CaptureStopResult> {
    if (this.stopResult !== undefined) {
      return this.stopResult;
    }

    const video = this.state.page.video();
    try {
      await this.state.context.close();
      await this.state.browser.close();
      if (video === null) {
        this.stopResult = this.stopFailed();
        return this.stopResult;
      }

      const generatedPath = await video.path();
      const mediaPath = await moveViewportVideo(generatedPath, this.state.paths.viewportMediaPath);
      const endedAt = this.state.now();
      const output: CaptureOutput = {
        outputDir: this.state.paths.outputDir,
        manifestPath: this.state.paths.manifestPath,
        media: {
          kind: "viewport",
          path: mediaPath,
          contentType: "video/webm",
        },
        timing: {
          startedAt: this.state.startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          durationMs: endedAt.getTime() - this.state.startedAt.getTime(),
        },
      };
      this.stopResult = { ok: true, output };
      return this.stopResult;
    } catch {
      await closeQuietly(this.state.browser);
      this.stopResult = this.stopFailed();
      return this.stopResult;
    }
  }

  private stopFailed(): CaptureStopResult {
    return {
      ok: false,
      code: "capture_stop_failed",
      message: "Browser capture stop failed.",
      outputDir: this.state.paths.outputDir,
      manifestPath: this.state.paths.manifestPath,
    };
  }
}

async function moveViewportVideo(
  generatedPath: string,
  viewportMediaPath: string,
): Promise<string> {
  if (generatedPath === viewportMediaPath) {
    return generatedPath;
  }

  try {
    await rename(generatedPath, viewportMediaPath);
    return viewportMediaPath;
  } catch {
    return generatedPath;
  }
}

async function closeQuietly(resource: { close(): Promise<void> } | undefined): Promise<void> {
  try {
    await resource?.close();
  } catch {
    // Preserve the original setup or stop failure.
  }
}
