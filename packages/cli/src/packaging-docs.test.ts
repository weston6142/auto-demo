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

  it("documents a current clean-checkout CLI invocation that reaches the built CLI", async () => {
    const rootReadme = await readRootDoc("README.md");
    const documentedInvocation = extractCurrentInvocation(rootReadme);
    expect(documentedInvocation).toBe("npm run autodemo -- <subcommand...>");
    const helpInvocation = documentedInvocation.replace("<subcommand...>", "--help");
    const [command, ...args] = helpInvocation.split(/\s+/);

    const result = spawnSync(command, args, {
      cwd: repoRoot,
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("autodemo");
    expect(result.stdout).toContain("capture");
    expect(result.stdout).toContain("export");
  }, 20_000);

  it("routes export help through the repo-root autodemo wrapper", () => {
    const result = spawnSync("npm", ["run", "autodemo", "--", "export", "--help"], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Usage: autodemo export");
    expect(result.stdout).toContain("--preset mp4-demo");
  }, 20_000);

  it("links the complete screenshot-coordinate CLI lifecycle", async () => {
    const rootReadme = normalizeWhitespace(await readRootDoc("README.md"));
    const guide = normalizeWhitespace(
      await readRootDoc("docs/guides/screenshot-coordinate-discovery.md"),
    );

    expect(rootReadme).toContain("docs/guides/screenshot-coordinate-discovery.md");
    for (const command of ["start", "observe", "act", "status", "finish", "abandon"]) {
      expect(guide).toContain(`npm run autodemo -- discover ${command}`);
    }
    expect(guide).toContain("npm run autodemo -- setup capture-helper --json");
    expect(guide).toContain("~/applications/auto demo capture.app");
    expect(guide).toContain("capture_helper_permission_required");
    expect(guide).toContain("screen recording permission");
    expect(guide).toContain("browser is not opened");
  });
});
