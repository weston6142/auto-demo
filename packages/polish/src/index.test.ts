import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadProject,
  savePolishVariant,
  validateProjectManifest,
  type LoadedProject,
  type ProjectManifest,
} from "@auto-demo/project";
import {
  MVP_STYLE_PRESETS,
  generateBaselinePolishVariant,
  generateHeadlessVariants,
} from "./index.js";

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
    join(projectDir, "autodemo.project.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
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

describe("MVP style presets", () => {
  it("publishes baseline as the only approved MVP style preset", () => {
    expect(MVP_STYLE_PRESETS).toEqual([{ key: "baseline", displayName: "Baseline Polish" }]);
  });
});

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

  it("persists a generated baseline variant through the project API", async () => {
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
      { id: "event-3", sequence: 3, type: "capture_stopped", timestampMs: 6000 },
    ]);
    const { variant } = await generateBaselinePolishVariant(project);

    const saved = await savePolishVariant(project, variant, {
      now: new Date("2026-07-03T12:00:00.000Z"),
    });
    const expectedManifest: ProjectManifest = {
      ...project.manifest,
      updatedAt: "2026-07-03T12:00:00.000Z",
      variants: [variant],
    };

    expect(saved).toEqual({
      ok: true,
      projectDir: project.projectDir,
      manifestPath: project.manifestPath,
      manifest: expectedManifest,
    });
    await expect(loadProject(project.projectDir)).resolves.toEqual(saved);
    expect(
      await readFile(join(project.projectDir, "variants", "baseline-polish.json"), "utf8"),
    ).toBe(`${JSON.stringify(variant, null, 2)}\n`);
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

  it("ignores clicks outside the source capture duration", async () => {
    const project = await writeLoadedProject([
      {
        id: "event-1",
        sequence: 1,
        type: "click",
        timestampMs: 7000,
        viewport: { width: 1280, height: 720 },
        data: { x: 960, y: 360 },
      },
    ]);

    const result = await generateBaselinePolishVariant(project);

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

  it("falls back to schema-valid variant labels for invalid option overrides", async () => {
    const project = await writeLoadedProject([
      { id: "event-1", sequence: 1, type: "press", timestampMs: 1000 },
    ]);

    const result = await generateBaselinePolishVariant(project, {
      id: "Not A Slug",
      displayName: "",
    });

    expect(result.variant.id).toBe("baseline-polish");
    expect(result.variant.displayName).toBe("Baseline Polish");
    expect(validateProjectManifest({ ...project.manifest, variants: [result.variant] })).toEqual({
      ok: true,
      manifest: { ...project.manifest, variants: [result.variant] },
    });
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

describe("generateHeadlessVariants", () => {
  it("saves a selected generated variant and reports reload validation", async () => {
    const project = await writeLoadedProject([
      {
        id: "event-1",
        sequence: 1,
        type: "click",
        timestampMs: 2000,
        viewport: { width: 1280, height: 720 },
        data: { x: 960, y: 360 },
      },
    ]);
    const { variant } = await generateBaselinePolishVariant(project);
    await savePolishVariant(project, {
      ...variant,
      id: "source-baseline",
      displayName: "Source Baseline",
    });

    const result = await generateHeadlessVariants({
      projectPath: project.projectDir,
      json: true,
      styles: ["baseline"],
      sourceVariantId: "source-baseline",
      save: true,
      selectedVariantId: "baseline-polish",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected selected save to succeed");
    }
    expect(result.summary).toEqual({
      mode: "selected",
      saved: [{ id: "baseline-polish", path: "variants/baseline-polish.json" }],
      skipped: [],
      validation: { ok: true, manifestPath: project.manifestPath },
      nextSteps: ["open-editor", "export-variant"],
    });
    expect(result.variants[0]?.save).toEqual({
      mode: "selected",
      saved: true,
      path: "variants/baseline-polish.json",
    });
    await expect(loadProject(project.projectDir)).resolves.toMatchObject({
      ok: true,
      manifest: {
        variants: expect.arrayContaining([expect.objectContaining({ id: "baseline-polish" })]),
      },
    });
  });

  it("saves all generated variants and reports saved paths", async () => {
    const project = await writeLoadedProject([
      { id: "event-1", sequence: 1, type: "press", timestampMs: 1000 },
    ]);
    const { variant } = await generateBaselinePolishVariant(project);
    await savePolishVariant(project, {
      ...variant,
      id: "source-baseline",
      displayName: "Source Baseline",
    });

    const result = await generateHeadlessVariants({
      projectPath: project.projectDir,
      json: true,
      styles: ["baseline"],
      sourceVariantId: "source-baseline",
      save: true,
      mode: "all",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected save all to succeed");
    }
    expect(result.summary.mode).toBe("all");
    expect(result.summary.saved).toEqual([
      { id: "baseline-polish", path: "variants/baseline-polish.json" },
    ]);
    expect(result.summary.skipped).toEqual([]);
  });

  it("rejects an invalid selected generated variant without writing", async () => {
    const project = await writeLoadedProject([
      { id: "event-1", sequence: 1, type: "press", timestampMs: 1000 },
    ]);
    const { variant } = await generateBaselinePolishVariant(project);
    await savePolishVariant(project, {
      ...variant,
      id: "source-baseline",
      displayName: "Source Baseline",
    });

    const result = await generateHeadlessVariants({
      projectPath: project.projectDir,
      json: true,
      styles: ["baseline"],
      sourceVariantId: "source-baseline",
      save: true,
      selectedVariantId: "missing",
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({
      code: "invalid_selected_variant",
      message: expect.any(String),
    });
    await expect(
      stat(join(project.projectDir, "variants", "baseline-polish.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns a structured duplicate error when a generated variant already exists", async () => {
    const project = await writeLoadedProject([
      { id: "event-1", sequence: 1, type: "press", timestampMs: 1000 },
    ]);
    const { variant } = await generateBaselinePolishVariant(project);
    await savePolishVariant(project, variant);

    const result = await generateHeadlessVariants({
      projectPath: project.projectDir,
      json: true,
      save: true,
      selectedVariantId: "baseline-polish",
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({
      code: "duplicate_variant_id",
      message: expect.any(String),
    });
  });

  it("rejects explicit save requests without a selected or all target", async () => {
    const project = await writeLoadedProject([
      { id: "event-1", sequence: 1, type: "press", timestampMs: 1000 },
    ]);
    const { variant } = await generateBaselinePolishVariant(project);
    await savePolishVariant(project, {
      ...variant,
      id: "source-baseline",
      displayName: "Source Baseline",
    });

    const result = await generateHeadlessVariants({
      projectPath: project.projectDir,
      json: true,
      styles: ["baseline"],
      sourceVariantId: "source-baseline",
      save: true,
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({
      code: "unsupported_save_mode",
      message: expect.any(String),
    });
    await expect(
      stat(join(project.projectDir, "variants", "baseline-polish.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns a dry-run baseline summary without saving files", async () => {
    const project = await writeLoadedProject([
      {
        id: "event-1",
        sequence: 1,
        type: "click",
        timestampMs: 2000,
        viewport: { width: 1280, height: 720 },
        data: { x: 960, y: 360 },
      },
    ]);
    const { variant } = await generateBaselinePolishVariant(project);
    await savePolishVariant(project, variant, {
      now: new Date("2026-07-04T12:30:00.000Z"),
    });

    const result = await generateHeadlessVariants({
      projectPath: project.projectDir,
      dryRun: true,
      json: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected generation to succeed");
    }
    expect(result.project).toEqual({
      projectDir: project.projectDir,
      manifestPath: project.manifestPath,
      name: "Checkout flow demo",
    });
    expect(result.requested).toEqual({
      count: 1,
      styles: ["baseline"],
      dryRun: true,
      sourceVariantId: "baseline-polish",
    });
    expect(result.variants).toEqual([
      {
        id: "baseline-polish",
        displayName: "Baseline Polish",
        style: "baseline",
        source: {
          projectPath: project.projectDir,
          manifestPath: project.manifestPath,
          mediaPath: "raw/capture.webm",
          eventsPath: "metadata/events.jsonl",
          variantId: "baseline-polish",
        },
        metadata: {
          presetKey: "baseline",
          presetDisplayName: "Baseline Polish",
          batchIndex: 0,
          batchSize: 1,
          sourceVariantId: "baseline-polish",
        },
        save: { mode: "dry-run", saved: false },
        warnings: [],
      },
    ]);
    expect(result.errors).toEqual([]);
    await expect(
      stat(join(project.projectDir, "variants", "baseline-polish-1.json")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("returns identical named batch summaries for identical inputs", async () => {
    const project = await writeLoadedProject([
      {
        id: "event-1",
        sequence: 1,
        type: "click",
        timestampMs: 2000,
        viewport: { width: 1280, height: 720 },
        data: { x: 960, y: 360 },
      },
    ]);
    const { variant } = await generateBaselinePolishVariant(project);
    await savePolishVariant(project, variant, {
      now: new Date("2026-07-04T12:30:00.000Z"),
    });

    const options = {
      projectPath: project.projectDir,
      dryRun: true,
      json: true,
      styles: ["baseline"],
      sourceVariantId: "baseline-polish",
    };

    await expect(generateHeadlessVariants(options)).resolves.toEqual(
      await generateHeadlessVariants(options),
    );
  });

  it("returns structured errors for unsupported headless options", async () => {
    const project = await writeLoadedProject([
      { id: "event-1", sequence: 1, type: "press", timestampMs: 1000 },
    ]);
    const { variant } = await generateBaselinePolishVariant(project);
    await savePolishVariant(project, variant);

    await expect(
      generateHeadlessVariants({
        projectPath: project.projectDir,
        dryRun: true,
        json: true,
        count: 2,
      }),
    ).resolves.toMatchObject({
      ok: false,
      errors: [{ code: "unsupported_variant_count" }],
    });

    await expect(
      generateHeadlessVariants({
        projectPath: project.projectDir,
        dryRun: true,
        json: true,
        style: "cinematic",
      }),
    ).resolves.toMatchObject({
      ok: false,
      errors: [{ code: "unsupported_style" }],
    });
  });

  it("returns structured errors for invalid named batch requests", async () => {
    const project = await writeLoadedProject([
      { id: "event-1", sequence: 1, type: "press", timestampMs: 1000 },
    ]);
    const { variant } = await generateBaselinePolishVariant(project);
    await savePolishVariant(project, variant);

    await expect(
      generateHeadlessVariants({
        projectPath: project.projectDir,
        dryRun: true,
        json: true,
        style: "baseline",
        styles: ["baseline"],
      }),
    ).resolves.toMatchObject({
      ok: false,
      errors: [{ code: "conflicting_style_options" }],
    });

    await expect(
      generateHeadlessVariants({
        projectPath: project.projectDir,
        dryRun: true,
        json: true,
        styles: ["baseline", "baseline"],
      }),
    ).resolves.toMatchObject({
      ok: false,
    });
    const duplicateResult = await generateHeadlessVariants({
      projectPath: project.projectDir,
      dryRun: true,
      json: true,
      styles: ["baseline", "baseline"],
    });
    expect(duplicateResult.errors).toContainEqual({
      code: "duplicate_style",
      message: expect.any(String),
    });

    await expect(
      generateHeadlessVariants({
        projectPath: project.projectDir,
        dryRun: true,
        json: true,
        styles: ["baseline"],
        count: 2,
      }),
    ).resolves.toMatchObject({
      ok: false,
      errors: [{ code: "unsupported_variant_count" }],
    });
  });

  it("returns a structured error when the source variant is missing", async () => {
    const project = await writeLoadedProject([
      { id: "event-1", sequence: 1, type: "press", timestampMs: 1000 },
    ]);

    await expect(
      generateHeadlessVariants({
        projectPath: project.projectDir,
        dryRun: true,
        json: true,
        styles: ["baseline"],
        sourceVariantId: "baseline-polish",
      }),
    ).resolves.toMatchObject({
      ok: false,
      errors: [{ code: "missing_source_variant" }],
    });
  });

  it("returns project validation errors without throwing", async () => {
    const project = await writeLoadedProject([]);
    await writeFile(join(project.projectDir, "autodemo.project.json"), "{not-json");

    await expect(
      generateHeadlessVariants({
        projectPath: project.projectDir,
        dryRun: true,
        json: true,
      }),
    ).resolves.toMatchObject({
      ok: false,
      errors: [{ code: "invalid_project", projectErrorCode: "invalid_project_json" }],
    });
  });
});
