# WES-162 MCP MVP Decision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record that MCP is deferred from the MVP Agent Integrations milestone, document when it should be reopened, and synchronize WES-138/WES-162 tracker evidence.

**Architecture:** This is a decision and documentation slice. Public docs state the decision and future MCP triggers, Vitest verifies the public docs keep the decision contract visible, and the Linear project map records selection and completion evidence.

**Tech Stack:** TypeScript, Vitest, npm workspaces, Markdown docs, Linear CLI.

---

## File Structure

- Modify `packages/agent/src/wrapper-docs.test.ts`: add behavior-oriented checks that read public docs and verify the MCP decision contract is visible without asserting exact prose.
- Modify `README.md`: add a short Agent Workflow note that MCP is deferred from MVP in favor of the CLI plus Codex wrapper path, with reopen triggers.
- Modify `packages/agent/README.md`: add the package-local MCP decision details and minimum future MCP capabilities.
- Modify `docs/linear/auto-demo-project-structure.md`: add WES-162 spec/plan links, current selection evidence, and the decision note.
- Create `docs/superpowers/specs/2026-07-06-wes-162-mcp-mvp-decision-design.md`: design spec already written before this plan.
- Create `docs/superpowers/plans/2026-07-06-wes-162-mcp-mvp-decision.md`: this plan.

### Task 1: Add Failing Documentation Behavior Test

**Files:**

- Modify: `packages/agent/src/wrapper-docs.test.ts`

- [ ] **Step 1: Add a helper for root docs**

Add `dirname` to the path import and add a helper that resolves the repo root from the agent workspace:

```ts
import { basename, dirname, join } from "node:path";

const repoRoot = basename(process.cwd()) === "agent" ? dirname(dirname(agentRoot)) : process.cwd();

async function readRootDoc(relativePath: string): Promise<string> {
  return await readFile(join(repoRoot, relativePath), "utf8");
}
```

- [ ] **Step 2: Write the failing test**

Append this test inside the existing `describe("agent wrapper documentation", () => { ... })` block:

```ts
it("documents the MVP MCP decision and future trigger criteria", async () => {
  const rootReadme = await readRootDoc("README.md");
  const agentReadme = await readAgentDoc("README.md");
  const combined = `${rootReadme}\n${agentReadme}`;

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
    expect(agentReadme).toContain(futureCapability);
  }

  expect(combined).toContain("does not introduce a new project schema");
  expect(combined).toContain("hosted services");
  expect(combined).toContain("final MP4 export");
});
```

- [ ] **Step 3: Run the focused test to verify RED**

Run:

```bash
rtk npm --workspace @auto-demo/agent test -- src/wrapper-docs.test.ts
```

Expected: FAIL because the README files do not yet contain the WES-162 MCP decision phrases.

### Task 2: Document The MCP Decision

**Files:**

- Modify: `README.md`
- Modify: `packages/agent/README.md`

- [ ] **Step 1: Update root README Agent Workflow section**

Add this paragraph near the existing Agent Workflow documentation in `README.md`:

```md
MCP is deferred from the MVP. The current accepted agent path is the CLI plus Codex wrapper: `autodemo agent run --project <project> --json` produces the non-secret JSON handoff that agents consume. Reopen MCP work after export and packaging evidence shows a need for persistent project/session discovery, editor handoff lifecycle control, artifact inspection across multiple outputs, repeated orchestration mistakes that typed tools would prevent, or a target host requires MCP instead of shell commands.
```

- [ ] **Step 2: Update package agent README**

Add this section after the current wrapper artifact list:

```md
## MCP Decision

MCP is deferred from the MVP. The accepted MVP integration path is the CLI plus Codex wrapper, using `autodemo agent run --project <project-dir-or-manifest> --json` as the stable noninteractive handoff. This keeps Agent Integrations focused on the executable workflow while Export And Packaging defines the final artifact boundary.

Future MCP work should be opened when the workflow needs persistent project/session discovery, editor handoff lifecycle status or stop controls, artifact inspection across generated outputs, host integration evidence shows repeated CLI orchestration mistakes, or a host requires MCP instead of shell commands.

The minimum future MCP capability set is project discovery and validation, an agent workflow run tool for selecting or generating a saved variant, local editor launch handoff with explicit lifecycle behavior, artifact inspection for project/variant/export paths, and stable non-secret error responses. MCP does not introduce a new project schema, new variant-selection rules, hosted services, or final MP4 export behavior.
```

- [ ] **Step 3: Run the focused test to verify GREEN**

Run:

```bash
rtk npm --workspace @auto-demo/agent test -- src/wrapper-docs.test.ts
```

Expected: PASS for wrapper docs tests.

### Task 3: Sync The Project Map

**Files:**

- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Add WES-162 local context links**

Add these bullets after the WES-161 plan link:

```md
- WES-162 MCP MVP decision design spec: `docs/superpowers/specs/2026-07-06-wes-162-mcp-mvp-decision-design.md`
- WES-162 MCP MVP decision implementation plan: `docs/superpowers/plans/2026-07-06-wes-162-mcp-mvp-decision.md`
```

- [ ] **Step 2: Update next-task rule**

Replace the WES-162 pointer sentence with:

```md
Prefer the earliest milestone with incomplete issues. Within that milestone, prefer started issues, then unblocked design/spec issues, then implementation issues whose dependencies are satisfied. Current next product task after WES-162 completion: WES-163, because MCP is deferred from MVP and Export And Packaging is the next incomplete milestone.
```

- [ ] **Step 3: Add investigation note**

Append this note under `## Investigation Notes`:

```md
- 2026-07-06 WES-162 pre-task sync: Linear and local `develop` agree WES-162 is the only incomplete Agent Integrations child after WES-161. WES-162 was moved to In Progress on branch `fm/wes-162-mcp-mvp-decision`. The selected decision is to defer MCP from MVP because the CLI plus Codex wrapper path already supports the first executable agent workflow; future MCP work should wait for export/packaging evidence or a host requirement that cannot be satisfied by stable shell commands.
```

- [ ] **Step 4: Run lightweight map/doc checks**

Run:

```bash
rtk rg -n "WES-162 MCP MVP decision|MCP is deferred from the MVP|Current next product task after WES-162 completion" docs/linear/auto-demo-project-structure.md README.md packages/agent/README.md
```

Expected: all key decision markers are present.

### Task 4: Validate And Commit

**Files:**

- All files changed for WES-162.

- [ ] **Step 1: Run package and full validation**

Run:

```bash
rtk npm --workspace @auto-demo/agent test -- src/wrapper-docs.test.ts
rtk npm run validate
```

Expected: both commands pass.

- [ ] **Step 2: Review scoped diff**

Run:

```bash
rtk git diff -- README.md packages/agent/README.md packages/agent/src/wrapper-docs.test.ts docs/linear/auto-demo-project-structure.md docs/superpowers/specs/2026-07-06-wes-162-mcp-mvp-decision-design.md docs/superpowers/plans/2026-07-06-wes-162-mcp-mvp-decision.md
```

Expected: diff only contains the WES-162 MCP decision, tests, spec/plan, and project map sync.

- [ ] **Step 3: Commit scoped files**

Run:

```bash
rtk git add README.md packages/agent/README.md packages/agent/src/wrapper-docs.test.ts docs/linear/auto-demo-project-structure.md docs/superpowers/specs/2026-07-06-wes-162-mcp-mvp-decision-design.md docs/superpowers/plans/2026-07-06-wes-162-mcp-mvp-decision.md
rtk git commit -m "docs: record WES-162 MCP MVP decision"
```

Expected: commit succeeds with only WES-162 files staged.

### Task 5: no-mistakes And Completion Sync

**Files:**

- No direct source edits unless no-mistakes applies fixes.

- [ ] **Step 1: Run no-mistakes**

Run:

```bash
rtk no-mistakes axi run --intent "WES-162: decide whether MCP is required for the Auto Demo MVP Agent Integrations milestone. Record that MCP is deferred from MVP because the stable CLI plus Codex wrapper path is enough for the first executable agent workflow, document future MCP inclusion triggers and minimum capabilities, keep MCP implementation/export/hosted services out of scope, and validate the public docs with behavior-oriented documentation tests rather than private prose formatting checks."
```

Expected: no-mistakes reaches `checks-passed` or `passed`. If it parks at a gate, respond through `no-mistakes axi respond` rather than hand-editing around it.

- [ ] **Step 2: Run completion sync**

Use Linear CLI to add completion evidence to WES-162, move WES-162 to Done, reconcile WES-138 if all child issues are Done, and update the project map with no-mistakes/CI evidence.

- [ ] **Step 3: Classify completion-sync diff**

If only `docs/linear/auto-demo-project-structure.md` changed, commit the docs-only sync, run `rtk git diff --check`, push/update the PR, wait for current GitHub CI, and merge. If any behavior-affecting files changed, commit and rerun no-mistakes before merge.

## Plan Self-Review

- Spec coverage: the plan records the deferral decision, rationale, future MCP triggers, minimum capabilities, docs updates, tests, and Linear/project-map sync.
- Placeholder scan: no TBD, TODO, or vague implementation steps remain.
- Type consistency: the new test uses existing Vitest/readFile patterns and keeps assertions on public behavior markers rather than exact formatting.
