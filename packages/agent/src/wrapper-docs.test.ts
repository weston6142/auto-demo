import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const agentRoot =
  basename(process.cwd()) === "agent" ? process.cwd() : join(process.cwd(), "packages", "agent");
const repoRoot = basename(process.cwd()) === "agent" ? dirname(dirname(agentRoot)) : process.cwd();

async function readAgentDoc(relativePath: string): Promise<string> {
  return await readFile(join(agentRoot, relativePath), "utf8");
}

async function readRootDoc(relativePath: string): Promise<string> {
  return await readFile(join(repoRoot, relativePath), "utf8");
}

function normalizeWhitespace(markdown: string): string {
  return markdown.replace(/\s+/g, " ");
}

function jsonBlock(markdown: string, marker: string): unknown {
  const markerIndex = markdown.indexOf(marker);
  expect(markerIndex).toBeGreaterThanOrEqual(0);
  const blockStart = markdown.indexOf("```json", markerIndex);
  expect(blockStart).toBeGreaterThanOrEqual(0);
  const jsonStart = markdown.indexOf("\n", blockStart) + 1;
  const blockEnd = markdown.indexOf("```", jsonStart);
  expect(blockEnd).toBeGreaterThan(jsonStart);
  return JSON.parse(markdown.slice(jsonStart, blockEnd));
}

describe("agent wrapper documentation", () => {
  it("publishes Codex instructions for the WES-160 workflow contract", async () => {
    const skill = await readAgentDoc("skills/codex-auto-demo/SKILL.md");

    expect(skill).toContain("npm run autodemo -- <subcommand...>");
    expect(skill).toContain("npm --workspace @auto-demo/cli run autodemo -- <subcommand...>");
    expect(skill).toContain("autodemo agent run --project <project-dir-or-manifest> --json");
    expect(skill).toContain("--variant <variant-id>");
    expect(skill).toContain("--generate baseline");
    expect(skill).toContain("--save baseline-polish");
    expect(skill).toContain("--save all");
    expect(skill).toContain("--open-editor");
    expect(skill).toContain("Do not inspect or rewrite Auto Demo project internals");
    expect(skill).toContain("MP4 export");
  });

  it("documents the repo-root clean-checkout wrapper in agent-facing docs", async () => {
    const rootAgents = await readRootDoc("AGENTS.md");
    const agentReadme = await readAgentDoc("README.md");
    const skill = await readAgentDoc("skills/codex-auto-demo/SKILL.md");
    const parity = await readAgentDoc("claude-wrapper-parity.md");
    const combined = [rootAgents, agentReadme, skill, parity].join("\n");

    expect(combined).toContain("npm run autodemo -- <subcommand...>");
    expect(combined).toContain("npm --workspace @auto-demo/cli run autodemo -- <subcommand...>");
    expect(combined).not.toContain("before the WES-164 repo-root wrapper lands");
  });

  it("includes a happy-path Codex transcript with parseable JSON output", async () => {
    const transcript = await readAgentDoc("fixtures/codex-happy-path.md");
    const output = jsonBlock(transcript, "Codex reads the JSON handoff");

    expect(output).toMatchObject({
      ok: true,
      project: {
        manifestPath: "projects/checkout/autodemo.project.json",
      },
      variant: {
        id: "baseline-polish",
        path: "variants/baseline-polish.json",
      },
      nextSteps: ["open-editor", "export-variant"],
    });
  });

  it("includes an invalid-project failure example with a stable error code", async () => {
    const transcript = await readAgentDoc("fixtures/codex-invalid-project.md");
    const output = jsonBlock(transcript, "Codex reads the JSON failure");

    expect(output).toMatchObject({
      ok: false,
      errors: [
        {
          code: "invalid_project",
        },
      ],
    });
  });

  it("documents Claude wrapper parity requirements and follow-up deferrals", async () => {
    const parity = await readAgentDoc("claude-wrapper-parity.md");

    for (const required of [
      "Invocation Instructions",
      "Required Inputs",
      "Command Sequence",
      "Expected Artifacts",
      "Failure Handling",
      "Out Of Scope",
      "MCP transport",
      "marketplace distribution",
      "final export implementation",
    ]) {
      expect(parity).toContain(required);
    }
  });

  it("documents the MVP MCP decision and future trigger criteria", async () => {
    const rootReadme = await readRootDoc("README.md");
    const agentReadme = await readAgentDoc("README.md");
    const normalizedRootReadme = normalizeWhitespace(rootReadme);
    const normalizedAgentReadme = normalizeWhitespace(agentReadme);
    const combined = `${normalizedRootReadme} ${normalizedAgentReadme}`;

    expect(combined).toContain("MCP is deferred from the MVP");
    expect(combined).toContain("CLI plus Codex wrapper");

    for (const futureTrigger of [
      "persistent project/session discovery",
      "editor handoff lifecycle",
      "artifact inspection",
      "host requires MCP",
    ]) {
      expect(combined).toContain(futureTrigger);
    }

    for (const futureCapability of [
      "project discovery and validation",
      "agent workflow run",
      "local editor launch handoff",
      "stable non-secret error responses",
    ]) {
      expect(normalizedAgentReadme).toContain(futureCapability);
    }

    expect(combined).toContain("does not introduce a new project schema");
    expect(combined).toContain("hosted services");
    expect(combined).toContain("final MP4 export");
  });
});
