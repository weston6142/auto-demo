import {
  chromium,
  type Browser,
  type BrowserContext,
  type ConsoleMessage,
  type Frame,
  type Page,
  type Video,
} from "playwright";
import type { BrowserLaunchProfileV1 } from "@auto-demo/browser-profile";
import type { BrowserCaptureController, CaptureViewport } from "./index.js";
import { createPlaywrightExecutionController } from "./playwrightExecutionController.js";

export type PlaywrightDriver = {
  launchChromium(profile: BrowserLaunchProfileV1): Promise<PlaywrightBrowser>;
};

export type PlaywrightBrowser = {
  newContext(options: PlaywrightContextOptions): Promise<PlaywrightBrowserContext>;
  close(): Promise<void>;
};

export type PlaywrightContextOptions = {
  viewport: CaptureViewport;
  recordVideo: {
    dir: string;
    size: CaptureViewport;
  };
};

export type PlaywrightBrowserContext = {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
};

export type BrowserBindingPayload = {
  type: "click" | "fill" | "press" | "viewport" | "navigation";
  pageUrl?: string;
  pageTitle?: string;
  viewport?: CaptureViewport;
  data?: Record<string, unknown>;
};

export type BrowserBindingCallback = (payload: unknown) => Promise<void> | void;

export type PlaywrightConsoleMessage = {
  type: string;
  text: string;
  location?: {
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
};

export type PlaywrightPageError = {
  name?: string;
  message: string;
  stack?: string;
};

export type PlaywrightPageSnapshot = {
  pageUrl?: string;
  pageTitle?: string;
  viewport?: CaptureViewport;
};

export type PlaywrightPage = {
  goto(url: string): Promise<void>;
  video(): PlaywrightVideo | null;
  exposeBinding(name: string, callback: BrowserBindingCallback): Promise<void>;
  addInitScript(script: string): Promise<void>;
  onConsole(callback: (message: PlaywrightConsoleMessage) => void): void;
  onNavigation(callback: (phase: string) => void): void;
  onPageError(callback: (error: PlaywrightPageError) => void): void;
  snapshotMetadata(): Promise<PlaywrightPageSnapshot>;
  challengeSummary?(): Promise<{ title: string; visibleText: string }>;
  executionController(): BrowserCaptureController;
};

export type PlaywrightVideo = {
  path(): Promise<string>;
};

export function createDefaultPlaywrightDriver(): PlaywrightDriver {
  return {
    async launchChromium(profile) {
      const browser = await chromium.launch({
        headless: profile.headless,
        ...(profile.channel === "bundled" ? {} : { channel: profile.channel }),
      });
      return wrapBrowser(browser);
    },
  };
}

function wrapBrowser(browser: Browser): PlaywrightBrowser {
  return {
    async newContext(options) {
      const context = await browser.newContext(options);
      return wrapContext(context);
    },
    async close() {
      await browser.close();
    },
  };
}

function wrapContext(context: BrowserContext): PlaywrightBrowserContext {
  return {
    async newPage() {
      const page = await context.newPage();
      return wrapPage(page);
    },
    async close() {
      await context.close();
    },
  };
}

function wrapPage(page: Page): PlaywrightPage {
  return {
    async goto(url) {
      await page.goto(url);
    },
    video() {
      const video = page.video();
      return video === null ? null : wrapVideo(video);
    },
    async exposeBinding(name, callback) {
      await page.exposeBinding(name, async (_source, payload) => {
        await callback(payload);
      });
    },
    async addInitScript(script) {
      await page.addInitScript(script);
    },
    onConsole(callback) {
      page.on("console", (message: ConsoleMessage) => {
        callback({
          type: message.type(),
          text: message.text(),
          location: message.location(),
        });
      });
    },
    onNavigation(callback) {
      page.on("domcontentloaded", () => {
        callback("domcontentloaded");
      });
      page.on("framenavigated", (frame: Frame) => {
        if (frame === page.mainFrame()) {
          callback("framenavigated");
        }
      });
      page.on("load", () => {
        callback("load");
      });
    },
    onPageError(callback) {
      page.on("pageerror", (error) => {
        callback({
          name: error.name,
          message: error.message,
          stack: error.stack,
        });
      });
    },
    async snapshotMetadata() {
      const viewport = page.viewportSize() ?? undefined;
      return {
        pageUrl: page.url(),
        pageTitle: await page.title().catch(() => undefined),
        viewport:
          viewport === undefined ? undefined : { width: viewport.width, height: viewport.height },
      };
    },
    async challengeSummary() {
      return {
        title: await page.title().catch(() => ""),
        visibleText: await page
          .locator("body")
          .innerText({ timeout: 1_000 })
          .then((text) => text.slice(0, 8192))
          .catch(() => ""),
      };
    },
    executionController() {
      return createPlaywrightExecutionController(page);
    },
  };
}

function wrapVideo(video: Video): PlaywrightVideo {
  return {
    async path() {
      return await video.path();
    },
  };
}
