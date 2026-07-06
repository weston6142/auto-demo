# WES-161 Codex Skill Wrapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the MVP Codex skill wrapper artifacts for `autodemo agent run` and document future Claude wrapper parity.

**Architecture:** Keep workflow behavior in `@auto-demo/agent` and the CLI. Add repository-owned wrapper documentation under `packages/agent/`, plus behavior-oriented tests that validate the public wrapper artifacts.

**Tech Stack:** Markdown, Node.js `fs/promises`, Vitest, npm workspaces.

---

### Task 1: Validate Wrapper Artifact Requirements

**Files:**

- Create: `packages/agent/src/wrapper-docs.test.ts`
- Modify: `packages/agent/package.json`

- [ ] **Step 1: Write the failing artifact test**

Create `packages/agent/src/wrapper-docs.test.ts`:

````ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const agentRoot = join(process.cwd(), "packages", "agent");

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
````

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm --workspace @auto-demo/agent test -- src/wrapper-docs.test.ts`

Expected: FAIL because `packages/agent/src/wrapper-docs.test.ts` is not included by the test script or because the referenced wrapper files do not exist.

- [ ] **Step 3: Include the new test in the package script**

Modify `packages/agent/package.json`:

```json
{
  "scripts": {
    "test": "vitest run src/index.test.ts src/wrapper-docs.test.ts"
  }
}
```

- [ ] **Step 4: Run the focused test and verify it fails for missing docs**

Run: `npm --workspace @auto-demo/agent test -- src/wrapper-docs.test.ts`

Expected: FAIL with missing `packages/agent/skills/codex-auto-demo/SKILL.md`.

### Task 2: Add Codex Wrapper Artifacts

**Files:**

- Create: `packages/agent/skills/codex-auto-demo/SKILL.md`
- Create: `packages/agent/fixtures/codex-happy-path.md`
- Create: `packages/agent/fixtures/codex-invalid-project.md`
- Create: `packages/agent/claude-wrapper-parity.md`
- Modify: `packages/agent/README.md`

- [ ] **Step 1: Add the Codex skill instructions**

Create `packages/agent/skills/codex-auto-demo/SKILL.md` with sections for when to use the skill, prerequisites, command sequence, variant selection, baseline generation, editor handoff, failure handling, export boundaries, and deferrals. The primary command must be:

```bash
autodemo agent run --project <project-dir-or-manifest> --json
```

- [ ] **Step 2: Add the happy-path transcript fixture**

Create `packages/agent/fixtures/codex-happy-path.md` with a transcript that runs:

```bash
autodemo agent run --project projects/checkout --json --variant baseline-polish
```

The JSON output block must include `ok: true`, `project.manifestPath`, `variant.id`, `variant.path`, and `nextSteps`.

- [ ] **Step 3: Add the invalid-project transcript fixture**

Create `packages/agent/fixtures/codex-invalid-project.md` with a transcript that runs:

```bash
autodemo agent run --project projects/missing --json
```

The JSON output block must include `ok: false` and an `invalid_project` error.

- [ ] **Step 4: Add Claude parity documentation**

Create `packages/agent/claude-wrapper-parity.md` with these headings:

```markdown
## Invocation Instructions

## Required Inputs

## Command Sequence

## Expected Artifacts

## Failure Handling

## Out Of Scope
```

The out-of-scope section must name Claude production wrapper implementation, MCP transport, hosted services, marketplace distribution, and final export implementation.

- [ ] **Step 5: Link wrapper artifacts from the agent README**

Add a `Wrapper Artifacts` section to `packages/agent/README.md` linking the Codex skill, both fixtures, and the Claude parity document.

- [ ] **Step 6: Run focused tests and verify they pass**

Run: `npm --workspace @auto-demo/agent test -- src/wrapper-docs.test.ts`

Expected: PASS.

### Task 3: Validate And Sync

**Files:**

- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Run package checks**

Run:

```bash
npm --workspace @auto-demo/agent test
npm --workspace @auto-demo/agent run typecheck
npm --workspace @auto-demo/agent run build
```

Expected: all PASS.

- [ ] **Step 2: Run full validation**

Run: `npm run validate`

Expected: PASS.

- [ ] **Step 3: Update the project map**

Add WES-161 spec and plan links, implementation evidence, and the next-task pointer to `docs/linear/auto-demo-project-structure.md`.

- [ ] **Step 4: Commit scoped files**

Run:

```bash
git add packages/agent/src/wrapper-docs.test.ts packages/agent/package.json packages/agent/skills/codex-auto-demo/SKILL.md packages/agent/fixtures/codex-happy-path.md packages/agent/fixtures/codex-invalid-project.md packages/agent/claude-wrapper-parity.md packages/agent/README.md docs/superpowers/specs/2026-07-06-wes-161-codex-skill-wrapper-design.md docs/superpowers/plans/2026-07-06-wes-161-codex-skill-wrapper.md docs/linear/auto-demo-project-structure.md
git commit -m "docs: add Codex agent workflow wrapper"
```

Expected: commit succeeds with only WES-161 files staged.

## Plan Self-Review

- Spec coverage: tasks cover Codex instructions, examples, Claude parity, tests,
  README links, validation, map sync, and scoped commit.
- Placeholder scan: no TBD or TODO markers remain.
- Type consistency: test file names, paths, command names, and artifact paths
  match across tasks.
