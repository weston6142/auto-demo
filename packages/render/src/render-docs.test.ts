import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { loadProject } from "@auto-demo/project";
import { describe, expect, it } from "vitest";

const renderRoot =
  basename(process.cwd()) === "render" ? process.cwd() : join(process.cwd(), "packages", "render");
const repoRoot =
  basename(process.cwd()) === "render" ? dirname(dirname(renderRoot)) : process.cwd();

async function readRenderDoc(relativePath: string): Promise<string> {
  return await readFile(join(renderRoot, relativePath), "utf8");
}

async function readRootDoc(relativePath: string): Promise<string> {
  return await readFile(join(repoRoot, relativePath), "utf8");
}

async function readFixtureProject() {
  return await loadProject(join(repoRoot, "fixtures", "export", "basic-saved-variant"));
}

function normalizeWhitespace(markdown: string): string {
  return markdown.replace(/`/g, "").replace(/\s+/g, " ");
}

describe("render export decision documentation", () => {
  it("documents the MVP export preset and canonical validation fixture", async () => {
    const renderReadme = normalizeWhitespace(await readRenderDoc("README.md"));
    const rootReadme = normalizeWhitespace(await readRootDoc("README.md"));
    const combined = `${renderReadme} ${rootReadme}`;

    for (const required of [
      "mp4-demo",
      "MP4 container",
      "H.264",
      "yuv420p",
      "30 frames per second",
      "1280x720",
      "1024x768",
      "720x1280",
      "fixtures/export/basic-saved-variant",
      "baseline-polish",
      "exports/baseline-polish.mp4",
      "exports/baseline-polish.render.json",
    ]) {
      expect(combined).toContain(required);
    }

    for (const fallback of [
      "invalid project",
      "missing variant",
      "missing media",
      "unsupported preset",
      "renderer failure",
    ]) {
      expect(combined).toContain(fallback);
    }

    for (const deferral of [
      "Non-MP4 formats",
      "hosted rendering",
      "distinct high-fidelity production presets",
    ]) {
      expect(combined).toContain(deferral);
    }
  });

  it("ships the canonical demo-ready saved-variant fixture", async () => {
    const loaded = await readFixtureProject();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      throw new Error(loaded.errors.map((error) => error.message).join("\n"));
    }

    expect(loaded.manifest.name).toBe("Checkout flow demo");
    expect(loaded.manifest.sourceCapture.source).toEqual({
      kind: "browser",
      url: "https://example.com/checkout",
    });
    expect(loaded.manifest.media.primary.path).toBe("raw/capture.webm");
    expect(loaded.manifest.metadata.events.path).toBe("metadata/events.jsonl");

    const variant = loaded.manifest.variants.find(
      (candidate) => candidate.id === "baseline-polish",
    );
    expect(variant).toBeDefined();
    expect(variant?.displayName).toBe("Baseline Polish");
    expect(variant?.source).toEqual({
      mediaPath: "raw/capture.webm",
      eventsPath: "metadata/events.jsonl",
    });
    expect(variant?.exportIntent).toEqual({
      format: "mp4",
      quality: "demo",
      aspectRatio: "16:9",
    });

    const media = await stat(join(loaded.projectDir, "raw", "capture.webm"));
    expect(media.size).toBeGreaterThan(0);
    expect(await readdir(join(loaded.projectDir, "exports"))).toEqual([".gitkeep"]);
  });

  it("documents the repeatable demo-ready export validation command", async () => {
    const renderReadme = normalizeWhitespace(await readRenderDoc("README.md"));
    const rootReadme = normalizeWhitespace(await readRootDoc("README.md"));
    const combined = `${renderReadme} ${rootReadme}`;

    for (const required of [
      "npm run validate:demo-ready",
      "npm install",
      "npm run build",
      "npm run setup:browser",
      "ffmpeg",
      "ffprobe",
      "copies fixtures/export/basic-saved-variant",
      "exports/baseline-polish.mp4",
      "exports/baseline-polish.render.json",
      "synthetic fixture",
      "MP4-only",
      "no audio track",
      "no rendered captions",
      "local-only checkout",
    ]) {
      expect(combined).toContain(required);
    }
  });
});
