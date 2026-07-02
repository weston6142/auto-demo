import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  validateProjectManifest,
  type LoadedProject,
  type ProjectManifest,
} from "@auto-demo/project";
import { generateBaselinePolishVariant } from "./index.js";

const baseManifest: ProjectManifest = {
  schemaVersion: 1,
  name: "Checkout flow demo",
  createdAt: "2026-07-02T12:00:00.000Z",
  updatedAt: "2026-07-02T12:00:00.000Z",
  sourceCapture: {
    kind: "browser",
    status: "completed",
    source: { kind: "browser", url: "https://example.com/checkout" },
    viewport: { width: 1280, height: 720 },
    timing: {
      startedAt: "2026-07-02T12:00:00.000Z",
      endedAt: "2026-07-02T12:00:06.000Z",
      durationMs: 6000,
    },
    adapter: { kind: "browser", backend: "playwright" },
    tools: { capturePackage: "0.0.0", playwright: "1.61.1" },
    manifestPath: "metadata/capture.manifest.json",
  },
  media: {
    primary: { kind: "viewport", path: "raw/capture.webm", contentType: "video/webm" },
  },
  metadata: {
    events: { path: "metadata/events.jsonl", contentType: "application/x-ndjson" },
  },
  variants: [],
  previews: [],
  exports: [],
};

async function writeLoadedProject(
  events: Array<Record<string, unknown> | string>,
  manifest: ProjectManifest = baseManifest,
): Promise<LoadedProject> {
  const projectDir = await mkdtemp(join(tmpdir(), "auto-demo-polish-"));
  await mkdir(join(projectDir, "metadata"), { recursive: true });
  await mkdir(join(projectDir, "raw"), { recursive: true });
  await writeFile(join(projectDir, "raw", "capture.webm"), "video-bytes");
  await writeFile(join(projectDir, "metadata", "capture.manifest.json"), "{}\n");
  await writeFile(
    join(projectDir, "metadata", "events.jsonl"),
    `${events
      .map((event) => (typeof event === "string" ? event : JSON.stringify(event)))
      .join("\n")}\n`,
  );

  return {
    projectDir,
    manifestPath: join(projectDir, "autodemo.project.json"),
    manifest,
  };
}

describe("generateBaselinePolishVariant", () => {
  it("generates a schema-valid focused baseline from a simple click flow", async () => {
    const project = await writeLoadedProject([
      { id: "event-1", sequence: 1, type: "capture_started", timestampMs: 0 },
      {
        id: "event-2",
        sequence: 2,
        type: "click",
        timestampMs: 2000,
        viewport: { width: 1280, height: 720 },
        data: { x: 960, y: 360 },
      },
      { id: "event-3", sequence: 3, type: "press", timestampMs: 3600 },
      { id: "event-4", sequence: 4, type: "capture_stopped", timestampMs: 6000 },
    ]);

    const result = await generateBaselinePolishVariant(project);

    expect(result).toEqual({
      variant: {
        id: "baseline-polish",
        displayName: "Baseline Polish",
        source: { mediaPath: "raw/capture.webm", eventsPath: "metadata/events.jsonl" },
        timeline: { startMs: 1500, endMs: 4350 },
        viewport: { mode: "contain", focus: { x: 0.75, y: 0.5 }, zoom: 1.35 },
        cursor: { visible: true, emphasis: "spotlight" },
        clicks: { emphasis: "ring" },
        captions: [],
        callouts: [],
        style: {
          background: "solid",
          backgroundColor: "#0f172a",
          frame: "browser",
          padding: 48,
          cornerRadius: 16,
        },
        exportIntent: { format: "mp4", quality: "demo", aspectRatio: "16:9" },
      },
      warnings: [],
    });
    expect(validateProjectManifest({ ...project.manifest, variants: [result.variant] })).toEqual({
      ok: true,
      manifest: { ...project.manifest, variants: [result.variant] },
    });
  });

  it("preserves duration and warns when no action events are present", async () => {
    const project = await writeLoadedProject([
      { id: "event-1", sequence: 1, type: "capture_started", timestampMs: 0 },
      { id: "event-2", sequence: 2, type: "capture_stopped", timestampMs: 6000 },
    ]);

    const result = await generateBaselinePolishVariant(project, {
      id: "quiet-flow",
      displayName: "Quiet Flow",
    });

    expect(result.variant.id).toBe("quiet-flow");
    expect(result.variant.displayName).toBe("Quiet Flow");
    expect(result.variant.timeline).toEqual({ startMs: 0, endMs: 6000 });
    expect(result.variant.viewport).toEqual({
      mode: "contain",
      focus: { x: 0.5, y: 0.5 },
      zoom: 1,
    });
    expect(result.variant.cursor).toEqual({ visible: true, emphasis: "none" });
    expect(result.variant.clicks).toEqual({ emphasis: "none" });
    expect(result.warnings).toEqual([
      {
        code: "missing_action_events",
        message: "No interaction events were available for baseline polish decisions.",
      },
    ]);
  });

  it("uses safe framing and warns when click coordinates are missing", async () => {
    const project = await writeLoadedProject([
      { id: "event-1", sequence: 1, type: "click", timestampMs: 1200, data: { button: 0 } },
      { id: "event-2", sequence: 2, type: "fill", timestampMs: 1800 },
    ]);

    const result = await generateBaselinePolishVariant(project);

    expect(result.variant.timeline).toEqual({ startMs: 700, endMs: 2550 });
    expect(result.variant.viewport).toEqual({
      mode: "contain",
      focus: { x: 0.5, y: 0.5 },
      zoom: 1.15,
    });
    expect(result.variant.clicks).toEqual({ emphasis: "ring" });
    expect(result.warnings).toEqual([
      {
        code: "missing_click_coordinates",
        message: "Click events did not include usable viewport coordinates.",
      },
    ]);
  });

  it("generates from incomplete and malformed metadata with structured warnings", async () => {
    const manifest: ProjectManifest = {
      ...baseManifest,
      sourceCapture: { ...baseManifest.sourceCapture, status: "failed" },
    };
    const project = await writeLoadedProject(
      [
        "{not-json",
        { id: "event-2", sequence: 2, type: "navigation", timestampMs: 500 },
        { id: "event-3", sequence: 3, type: "click", timestampMs: 7000 },
      ],
      manifest,
    );

    const result = await generateBaselinePolishVariant(project);

    expect(result.variant.timeline).toEqual({ startMs: 0, endMs: 1250 });
    expect(result.variant.viewport).toEqual({
      mode: "contain",
      focus: { x: 0.5, y: 0.5 },
      zoom: 1.15,
    });
    expect(result.warnings).toEqual([
      {
        code: "malformed_event_line",
        message: "One or more capture event lines could not be parsed.",
      },
      {
        code: "missing_click_coordinates",
        message: "Click events did not include usable viewport coordinates.",
      },
      {
        code: "incomplete_capture_status",
        message: "Source capture did not complete; baseline polish used available metadata.",
      },
    ]);
  });

  it("returns identical results for identical inputs", async () => {
    const events = [
      {
        id: "event-1",
        sequence: 1,
        type: "click",
        timestampMs: 2000,
        viewport: { width: 1280, height: 720 },
        data: { x: 320, y: 180 },
      },
    ];
    const first = await writeLoadedProject(events);
    const second = await writeLoadedProject(events);

    await expect(generateBaselinePolishVariant(first)).resolves.toEqual(
      await generateBaselinePolishVariant(second),
    );
  });
});
