import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
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

function extractCurrentInvocation(markdown: string): string {
  const match = markdown.match(
    /current clean-checkout invocation contract is:\s*```bash\s*(?<command>[^`]+?)\s*```/i,
  );

  expect(match?.groups?.command).toBeDefined();
  return match?.groups?.command.trim() ?? "";
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
      "npm --workspace @auto-demo/cli run autodemo --",
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
      "npm --workspace @auto-demo/cli run autodemo --",
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

  it(
    "documents a current clean-checkout CLI invocation that reaches the built CLI",
    async () => {
      const rootReadme = await readRootDoc("README.md");
      const documentedInvocation = extractCurrentInvocation(rootReadme);
      const helpInvocation = documentedInvocation.replace("<subcommand...>", "--help");
      const [command, ...args] = helpInvocation.split(/\s+/);
      const build = spawnSync("npm", ["--workspace", "@auto-demo/cli", "run", "build"], {
        cwd: repoRoot,
        encoding: "utf8",
      });

      expect(build.status, build.stderr).toBe(0);

      const result = spawnSync(command, args, {
        cwd: repoRoot,
        encoding: "utf8",
      });

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("autodemo");
      expect(result.stdout).toContain("capture");
      expect(result.stdout).toContain("export");
    },
    20_000,
  );
});
