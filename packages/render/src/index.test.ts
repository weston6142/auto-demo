import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MVP_EXPORT_PRESET,
  MVP_EXPORT_PRESET_KEY,
  renderSavedVariant,
  type RenderRunner,
} from "./index.js";

async function createProject(
  options: { variantId?: string; aspectRatio?: "16:9" | "4:3" | "9:16" } = {},
): Promise<string> {
  const projectDir = join(tmpdir(), `auto-demo-render-${randomUUID()}`);
  const variantId = options.variantId ?? "baseline-polish";
  const variant = {
    id: variantId,
    displayName: "Baseline Polish",
    source: { mediaPath: "raw/capture.webm", eventsPath: "metadata/events.jsonl" },
    timeline: { startMs: 0, endMs: 6000 },
    viewport: { mode: "contain", focus: { x: 0.5, y: 0.5 }, zoom: 1 },
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
    exportIntent: {
      format: "mp4",
      quality: "demo",
      aspectRatio: options.aspectRatio ?? "16:9",
    },
  };

  await mkdir(join(projectDir, "raw"), { recursive: true });
  await mkdir(join(projectDir, "metadata"), { recursive: true });
  await mkdir(join(projectDir, "variants"), { recursive: true });
  await mkdir(join(projectDir, "exports"), { recursive: true });
  await writeFile(join(projectDir, "raw", "capture.webm"), "video");
  await writeFile(join(projectDir, "metadata", "events.jsonl"), "{}\n");
  await writeFile(join(projectDir, "metadata", "capture.manifest.json"), "{}\n");
  await writeFile(
    join(projectDir, "variants", `${variantId}.json`),
    `${JSON.stringify(variant, null, 2)}\n`,
  );
  await writeFile(
    join(projectDir, "autodemo.project.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        name: "Checkout flow demo",
        createdAt: "2026-07-06T00:00:00.000Z",
        updatedAt: "2026-07-06T00:00:00.000Z",
        sourceCapture: {
          kind: "browser",
          status: "completed",
          source: { kind: "browser", url: "https://example.com/checkout" },
          viewport: { width: 1280, height: 720 },
          timing: {
            startedAt: "2026-07-06T00:00:00.000Z",
            endedAt: "2026-07-06T00:00:06.000Z",
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
        variants: [variant],
        previews: [],
        exports: [],
      },
      null,
      2,
    )}\n`,
  );

  return projectDir;
}

describe("renderSavedVariant", () => {
  it("renders the selected saved variant and writes a non-secret summary", async () => {
    const projectDir = await createProject();
    const calls: unknown[] = [];
    const runner: RenderRunner = async (request) => {
      calls.push(request);
      await writeFile(request.outputPath, "mp4");
      return { ok: true, command: "fake-renderer", exitCode: 0 };
    };

    const result = await renderSavedVariant(
      {
        projectPath: projectDir,
        variantId: "baseline-polish",
        now: () => new Date("2026-07-06T01:00:00.000Z"),
      },
      { runner },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected success");
    }
    expect(result.outputPath).toBe(join(projectDir, "exports", "baseline-polish.mp4"));
    expect(result.summaryPath).toBe(join(projectDir, "exports", "baseline-polish.render.json"));
    expect(result.preset.key).toBe(MVP_EXPORT_PRESET_KEY);
    expect(result.preset.settings.dimensions).toEqual({ width: 1280, height: 720 });
    expect(calls).toHaveLength(1);

    const summary = JSON.parse(await readFile(result.summaryPath, "utf8")) as {
      ok: boolean;
      variantId: string;
      preset: { key: string };
      outputPath: string;
      renderer: { command: string; exitCode: number };
    };
    expect(summary).toMatchObject({
      ok: true,
      variantId: "baseline-polish",
      preset: { key: "mp4-demo" },
      outputPath: "exports/baseline-polish.mp4",
      renderer: { command: "fake-renderer", exitCode: 0 },
    });
  });

  it("returns structured failures for missing variants without invoking the runner", async () => {
    const projectDir = await createProject();
    let called = false;
    const result = await renderSavedVariant(
      { projectPath: projectDir, variantId: "missing" },
      {
        runner: async () => {
          called = true;
          return { ok: true, command: "fake", exitCode: 0 };
        },
      },
    );

    expect(result).toMatchObject({
      ok: false,
      errors: [{ code: "missing_variant" }],
    });
    expect(called).toBe(false);
  });

  it("returns structured failures for missing variant metadata without invoking the runner", async () => {
    const projectDir = await createProject();
    await rm(join(projectDir, "metadata", "events.jsonl"));
    let called = false;

    const result = await renderSavedVariant(
      { projectPath: projectDir, variantId: "baseline-polish" },
      {
        runner: async () => {
          called = true;
          return { ok: true, command: "fake", exitCode: 0 };
        },
      },
    );

    expect(result).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_project" }],
    });
    expect(called).toBe(false);
  });

  it("writes a failure summary when the renderer fails", async () => {
    const projectDir = await createProject();
    const result = await renderSavedVariant(
      { projectPath: projectDir, variantId: "baseline-polish" },
      { runner: async () => ({ ok: false, command: "fake-renderer", exitCode: 77 }) },
    );

    expect(result).toMatchObject({
      ok: false,
      summaryPath: join(projectDir, "exports", "baseline-polish.render.json"),
      errors: [{ code: "renderer_failure" }],
    });
    const summary = JSON.parse(
      await readFile(join(projectDir, "exports", "baseline-polish.render.json"), "utf8"),
    ) as {
      ok: boolean;
      renderer: { command: string; exitCode: number };
    };
    expect(summary).toMatchObject({
      ok: false,
      renderer: { command: "fake-renderer", exitCode: 77 },
    });
  });

  it("maps supported aspect ratios to preset dimensions", () => {
    expect(MVP_EXPORT_PRESET.dimensionsByAspectRatio).toEqual({
      "16:9": { width: 1280, height: 720 },
      "4:3": { width: 1024, height: 768 },
      "9:16": { width: 720, height: 1280 },
    });
  });

  it("returns an invalid project error for malformed projects", async () => {
    const projectDir = join(tmpdir(), `auto-demo-render-invalid-${randomUUID()}`);
    await rm(projectDir, { recursive: true, force: true });

    const result = await renderSavedVariant({ projectPath: projectDir });

    expect(result).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_project" }],
    });
  });
});
