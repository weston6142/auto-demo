import { rename } from "node:fs/promises";
import type {
  BrowserCaptureAdapter,
  BrowserCaptureOptions,
  CaptureOutput,
  CaptureStartResult,
  CaptureStopReason,
  CaptureStopResult,
} from "./index.js";
import { createCaptureEventFactory } from "./captureEvents.js";
import { buildCapturePaths, ensureCaptureDirectories, type CapturePaths } from "./capturePaths.js";
import { createJsonlEventWriter, type JsonlEventWriter } from "./jsonlEventWriter.js";
import {
  createPlaywrightMetadataRecorder,
  type PlaywrightMetadataRecorder,
} from "./playwrightMetadataRecorder.js";
import {
  createDefaultPlaywrightDriver,
  type PlaywrightBrowser,
  type PlaywrightBrowserContext,
  type PlaywrightDriver,
  type PlaywrightPage,
} from "./playwrightDriver.js";

type PlaywrightAdapterDependencies = {
  now: () => Date;
  createEventWriter?: (eventsPath: string) => Promise<JsonlEventWriter>;
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
  let metadataRecorder: PlaywrightMetadataRecorder | undefined;
  let metadataWriter: JsonlEventWriter | undefined;
  const createEventWriter = dependencies.createEventWriter ?? createJsonlEventWriter;

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
    const captureStartedAt = dependencies.now();
    const eventFactory = createCaptureEventFactory({
      captureStartedAt,
      now: dependencies.now,
    });
    metadataWriter = await createEventWriter(paths.eventsPath);
    metadataRecorder = await createPlaywrightMetadataRecorder({
      page,
      writer: metadataWriter,
      eventFactory,
    });
    metadataWriter = undefined;
    await metadataRecorder.writeCaptureStarted({
      sourceUrl: options.source.url,
      viewport: options.viewport,
      childCommand: options.childCommand,
    });
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
        startedAt: captureStartedAt,
        now: dependencies.now,
        metadataRecorder,
      }),
    };
  } catch {
    await closeMetadataQuietly(metadataRecorder);
    await closeQuietly(metadataWriter);
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
  private stopPromise: Promise<CaptureStopResult> | undefined;

  constructor(
    private readonly state: {
      browser: PlaywrightBrowser;
      context: PlaywrightBrowserContext;
      page: PlaywrightPage;
      paths: CapturePaths;
      startedAt: Date;
      now: () => Date;
      metadataRecorder: PlaywrightMetadataRecorder;
    },
  ) {
    this.outputDir = state.paths.outputDir;
    this.manifestPath = state.paths.manifestPath;
  }

  async stop(reason: CaptureStopReason): Promise<CaptureStopResult> {
    if (this.stopPromise !== undefined) {
      return await this.stopPromise;
    }

    this.stopPromise = this.stopOnce(reason);
    return await this.stopPromise;
  }

  private async stopOnce(reason: CaptureStopReason): Promise<CaptureStopResult> {
    const video = this.state.page.video();
    try {
      const endedAt = this.state.now();
      await this.state.metadataRecorder.writeCaptureStopped({
        reason,
        durationMs: endedAt.getTime() - this.state.startedAt.getTime(),
      });
      await this.state.metadataRecorder.close();
      await this.state.context.close();
      await this.state.browser.close();
      if (video === null) {
        return this.stopFailed();
      }

      const generatedPath = await video.path();
      const mediaPath = await moveViewportVideo(generatedPath, this.state.paths.viewportMediaPath);
      const output: CaptureOutput = {
        outputDir: this.state.paths.outputDir,
        manifestPath: this.state.paths.manifestPath,
        media: {
          kind: "viewport",
          path: mediaPath,
          contentType: "video/webm",
        },
        metadata: {
          kind: "events",
          path: this.state.paths.eventsPath,
          contentType: "application/x-ndjson",
        },
        timing: {
          startedAt: this.state.startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          durationMs: endedAt.getTime() - this.state.startedAt.getTime(),
        },
      };
      return { ok: true, output };
    } catch {
      await closeMetadataQuietly(this.state.metadataRecorder);
      await closeQuietly(this.state.context);
      await closeQuietly(this.state.browser);
      return this.stopFailed();
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

async function closeMetadataQuietly(
  recorder: PlaywrightMetadataRecorder | undefined,
): Promise<void> {
  try {
    await recorder?.close();
  } catch {
    // Preserve the original setup or stop failure.
  }
}
