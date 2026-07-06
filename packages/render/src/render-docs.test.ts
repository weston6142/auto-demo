import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
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

function normalizeWhitespace(markdown: string): string {
  return markdown.replace(/\s+/g, " ");
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
});
