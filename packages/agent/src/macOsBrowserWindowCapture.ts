import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import type { Page } from "playwright";
import type { BrowserWindowCapture } from "./playwrightCoordinateDiscoveryPage.js";

type CaptureRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MacOsBrowserWindowCaptureOptions = {
  platform?: NodeJS.Platform;
  captureRegion?: (region: CaptureRegion) => Promise<Uint8Array | undefined>;
};

export async function createMacOsBrowserWindowCapture(
  page: Page,
  options: MacOsBrowserWindowCaptureOptions = {},
): Promise<BrowserWindowCapture | undefined> {
  if ((options.platform ?? process.platform) !== "darwin") return undefined;
  const geometry = await page.evaluate(() => {
    const horizontalChrome = Math.max(0, outerWidth - innerWidth);
    const verticalChrome = Math.max(0, outerHeight - innerHeight);
    return {
      region: {
        x: Math.round(screenX + horizontalChrome / 2),
        y: Math.round(screenY + verticalChrome),
        width: innerWidth,
        height: innerHeight,
      },
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
  const captureRegion = options.captureRegion ?? captureMacOsRegion;
  return {
    async capture() {
      const bytes = await captureRegion(geometry.region);
      if (bytes === undefined) return undefined;
      try {
        return normalizePng(bytes, geometry.viewport);
      } catch {
        return undefined;
      }
    },
  };
}

async function captureMacOsRegion(region: CaptureRegion): Promise<Uint8Array | undefined> {
  const directory = await mkdtemp(join(tmpdir(), "autodemo-window-capture-"));
  const path = join(directory, "viewport.png");
  try {
    await runScreencapture(region, path);
    return await readFile(path);
  } catch {
    return undefined;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function runScreencapture(region: CaptureRegion, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "/usr/sbin/screencapture",
      ["-x", "-t", "png", "-R", `${region.x},${region.y},${region.width},${region.height}`, path],
      (error) => (error === null ? resolve() : reject(error)),
    );
  });
}

function normalizePng(bytes: Uint8Array, viewport: { width: number; height: number }): Uint8Array {
  const source = PNG.sync.read(Buffer.from(bytes));
  if (source.width === viewport.width && source.height === viewport.height) return bytes;
  const target = new PNG({ width: viewport.width, height: viewport.height });
  for (let y = 0; y < target.height; y += 1) {
    const sourceY = Math.min(source.height - 1, Math.floor((y * source.height) / target.height));
    for (let x = 0; x < target.width; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.floor((x * source.width) / target.width));
      const sourceOffset = (sourceY * source.width + sourceX) * 4;
      const targetOffset = (y * target.width + x) * 4;
      source.data.copy(target.data, targetOffset, sourceOffset, sourceOffset + 4);
    }
  }
  return PNG.sync.write(target);
}
