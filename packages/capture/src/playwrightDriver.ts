import { chromium, type Browser, type BrowserContext, type Page, type Video } from "playwright";
import type { CaptureViewport } from "./index.js";

export type PlaywrightDriver = {
  launchChromium(): Promise<PlaywrightBrowser>;
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

export type PlaywrightPage = {
  goto(url: string): Promise<void>;
  video(): PlaywrightVideo | null;
};

export type PlaywrightVideo = {
  path(): Promise<string>;
};

export function createDefaultPlaywrightDriver(): PlaywrightDriver {
  return {
    async launchChromium() {
      const browser = await chromium.launch();
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
  };
}

function wrapVideo(video: Video): PlaywrightVideo {
  return {
    async path() {
      return await video.path();
    },
  };
}
