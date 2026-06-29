import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCaptureEventFactory } from "./captureEvents.js";

describe("createJsonlEventWriter", () => {
  afterEach(() => {
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  });

  it("writes independently parseable JSON lines", async () => {
    const { createJsonlEventWriter } = await import("./jsonlEventWriter.js");
    const outputDir = await mkdtemp(join(tmpdir(), "auto-demo-events-writer-"));
    const eventsPath = join(outputDir, "events.jsonl");
    const writer = await createJsonlEventWriter(eventsPath);
    const factory = createCaptureEventFactory({
      captureStartedAt: new Date("2026-06-29T12:00:00.000Z"),
      now: () => new Date("2026-06-29T12:00:00.500Z"),
    });

    await writer.write(factory.create("capture_started", { pageUrl: "https://example.com" }));
    await writer.write(factory.create("capture_stopped", { data: { reason: "completed" } }));
    await writer.close();

    const lines = (await readFile(eventsPath, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ sequence: 1, type: "capture_started" }),
      expect.objectContaining({ sequence: 2, type: "capture_stopped" }),
    ]);
  });

  it("serializes concurrent writes in call order", async () => {
    let appendCount = 0;
    const appendedLines: string[] = [];
    let releaseFirstAppend: (() => void) | undefined;
    let markFirstAppendStarted: (() => void) | undefined;
    const firstAppendStarted = new Promise<void>((resolve) => {
      markFirstAppendStarted = resolve;
    });
    const appendFile = vi.fn((line: string) => {
      appendCount += 1;
      if (appendCount === 1) {
        markFirstAppendStarted?.();
        return new Promise<void>((release) => {
          releaseFirstAppend = () => {
            appendedLines.push(line);
            release();
          };
        });
      }

      appendedLines.push(line);
      return Promise.resolve();
    });

    vi.doMock("node:fs/promises", () => ({
      open: vi.fn(async () => ({
        appendFile,
        close: vi.fn(async () => undefined),
      })),
    }));

    const { createJsonlEventWriter } = await import("./jsonlEventWriter.js");
    const writer = await createJsonlEventWriter("events.jsonl");
    const factory = createCaptureEventFactory({
      captureStartedAt: new Date("2026-06-29T12:00:00.000Z"),
      now: () => new Date("2026-06-29T12:00:00.500Z"),
    });

    const firstWrite = writer.write(factory.create("capture_started"));
    await firstAppendStarted;
    const secondWrite = writer.write(factory.create("capture_stopped"));
    await Promise.resolve();
    releaseFirstAppend?.();
    await Promise.all([firstWrite, secondWrite]);
    await writer.close();

    expect(appendedLines.map((line) => JSON.parse(line).sequence)).toEqual([1, 2]);
  });
});
