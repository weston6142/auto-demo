import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCaptureEventFactory } from "./captureEvents.js";
import { createJsonlEventWriter } from "./jsonlEventWriter.js";

describe("createJsonlEventWriter", () => {
  it("writes independently parseable JSON lines", async () => {
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
});
