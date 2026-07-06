import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const cliRoot =
  basename(process.cwd()) === "cli" ? process.cwd() : join(process.cwd(), "packages", "cli");
const repoRoot = basename(process.cwd()) === "cli" ? dirname(dirname(cliRoot)) : process.cwd();

async function readCliDoc(relativePath: string): Promise<string> {
  return await readFile(join(cliRoot, relativePath), "utf8");
}

async function readRootDoc(relativePath: string): Promise<string> {
  return await readFile(join(repoRoot, relativePath), "utf8");
}

function normalizeWhitespace(markdown: string): string {
  return markdown.toLowerCase().replace(/\s+/g, " ");
}

describe("CLI packaging decision documentation", () => {
  it("documents the root clean-checkout setup and current runnable command", async () => {
    const rootReadme = normalizeWhitespace(await readRootDoc("README.md"));

    for (const required of [
      "clean local checkout run path",
      "macos",
      "node 22",
      "npm 10",
      "npm install",
      "npm run build",
      "npm run setup:browser",
      "ffmpeg",
      "npm --workspace @auto-demo/cli exec autodemo --",
      "wes-164",
      "npm run autodemo --",
    ]) {
      expect(rootReadme).toContain(required);
    }

    for (const deferred of [
      "registry publication",
      "homebrew",
      "standalone distribution artifact",
    ]) {
      expect(rootReadme).toContain(deferred);
    }
  });

  it("documents the CLI package packaging contract directly", async () => {
    const cliReadme = normalizeWhitespace(await readCliDoc("README.md"));

    for (const required of [
      "clean local checkout run path",
      "macos",
      "node 22",
      "npm 10",
      "npm install",
      "npm run build",
      "npm run setup:browser",
      "ffmpeg",
      "npm --workspace @auto-demo/cli exec autodemo --",
      "wes-164",
      "npm run autodemo --",
    ]) {
      expect(cliReadme).toContain(required);
    }

    for (const deferred of [
      "registry publication",
      "homebrew",
      "standalone distribution artifact",
    ]) {
      expect(cliReadme).toContain(deferred);
    }
  });
});
