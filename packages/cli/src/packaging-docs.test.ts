import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const cliRoot =
  basename(process.cwd()) === "cli" ? process.cwd() : join(process.cwd(), "packages", "cli");
const repoRoot = basename(process.cwd()) === "cli" ? dirname(dirname(cliRoot)) : process.cwd();

async function readCliDoc(relativePath: string): Promise<string> {
  try {
    return await readFile(join(cliRoot, relativePath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

async function readRootDoc(relativePath: string): Promise<string> {
  return await readFile(join(repoRoot, relativePath), "utf8");
}

function normalizeWhitespace(markdown: string): string {
  return markdown.replace(/\s+/g, " ");
}

describe("CLI packaging decision documentation", () => {
  it("documents the MVP local-only packaging target and setup contract", async () => {
    const cliReadme = normalizeWhitespace(await readCliDoc("README.md"));
    const rootReadme = normalizeWhitespace(await readRootDoc("README.md"));
    const combined = `${cliReadme} ${rootReadme}`;

    for (const required of [
      "clean local checkout run path",
      "macOS",
      "Node 22",
      "npm 10",
      "npm install",
      "npm run build",
      "npm run setup:browser",
      "ffmpeg",
      "npm run autodemo --",
    ]) {
      expect(combined).toContain(required);
    }

    for (const deferred of [
      "registry publication",
      "Homebrew",
      "standalone distribution artifact",
    ]) {
      expect(combined).toContain(deferred);
    }
  });
});
