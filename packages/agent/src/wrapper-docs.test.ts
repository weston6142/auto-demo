import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

const agentRoot =
  basename(process.cwd()) === "agent" ? process.cwd() : join(process.cwd(), "packages", "agent");

async function readAgentDoc(relativePath: string): Promise<string> {
  return await readFile(join(agentRoot, relativePath), "utf8");
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

    expect(skill).toContain("autodemo agent run --project <project-dir-or-manifest> --json");
    expect(skill).toContain("--variant <variant-id>");
    expect(skill).toContain("--generate baseline");
    expect(skill).toContain("--save baseline-polish");
    expect(skill).toContain("--save all");
    expect(skill).toContain("--open-editor");
    expect(skill).toContain("Do not inspect or rewrite Auto Demo project internals");
    expect(skill).toContain("MP4 export");
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
});
