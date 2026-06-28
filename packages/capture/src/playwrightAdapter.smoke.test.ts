import { createServer } from "node:http";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPlaywrightBrowserCaptureAdapter } from "./index.js";

let closeServer: (() => Promise<void>) | undefined;

beforeEach(() => {
  closeServer = undefined;
});

afterEach(async () => {
  await closeServer?.();
});

describe("createPlaywrightBrowserCaptureAdapter smoke", () => {
  it("records a non-empty viewport video", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`
        <!doctype html>
        <html>
          <head><title>Auto Demo Smoke</title></head>
          <body>
            <main style="font-family: sans-serif">
              <h1>Auto Demo Smoke</h1>
              <button>Record me</button>
            </main>
          </body>
        </html>
      `);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    closeServer = async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
            return;
          }
          reject(error);
        });
      });
    };

    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const outputDir = await mkdtemp(join(tmpdir(), "auto-demo-playwright-smoke-"));
    const adapter = createPlaywrightBrowserCaptureAdapter();
    const start = await adapter.start({
      source: { kind: "browser", url: `http://127.0.0.1:${address.port}` },
      outputDir,
      viewport: { width: 640, height: 360 },
      startedAt: "2026-06-28T12:00:00.000Z",
    });

    expect(start.ok).toBe(true);
    if (!start.ok) {
      throw new Error(start.message);
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 500);
    });

    const stop = await start.session.stop("completed");

    expect(stop.ok).toBe(true);
    if (!stop.ok) {
      throw new Error(stop.message);
    }

    const mediaStat = await stat(stop.output.media.path);
    expect(mediaStat.size).toBeGreaterThan(0);
    expect(stop.output.media.contentType).toBe("video/webm");
    expect(stop.output.timing.durationMs).toBeGreaterThanOrEqual(0);
  }, 30_000);
});
