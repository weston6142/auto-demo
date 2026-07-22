import { PNG } from "pngjs";
import type { Page } from "playwright";
import type { MacOsCaptureHelperClient } from "./macOsCaptureHelperClient.js";
import type { BrowserWindowCapture } from "./playwrightCoordinateDiscoveryPage.js";

export type MacOsBrowserWindowCaptureOptions = {
  platform?: NodeJS.Platform;
  client?: MacOsCaptureHelperClient;
};

export async function createMacOsBrowserWindowCapture(
  page: Page,
  options: MacOsBrowserWindowCaptureOptions = {},
): Promise<BrowserWindowCapture | undefined> {
  if ((options.platform ?? process.platform) !== "darwin") return undefined;
  if (options.client === undefined) return undefined;
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
  return {
    async capture() {
      const bytes = await options.client!.capture(geometry.region);
      if (bytes === undefined) return undefined;
      try {
        return normalizePng(bytes, geometry.viewport);
      } catch {
        return undefined;
      }
    },
    async close() {
      await options.client!.close();
    },
  };
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
