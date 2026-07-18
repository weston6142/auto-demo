# WES-189 Codex YOLO-Discovery Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: Use `superpowers:test-driven-development` and `superpowers:writing-skills`. Under `linear-deliver-next-task`, the main agent executes these checkboxes inline without a worktree or implementation subagents.

**Goal:** Publish a repository-owned Codex workflow that discovers a natural-language browser-demo goal, performs bounded replay/repair, requires explicit approval, and reuses deterministic execute/project handoff.

**Architecture:** Codex remains the host decision provider and composes existing public `@auto-demo/agent` rehearsal, policy, compilation, replay, review, approval, execution, and handoff contracts through the existing skill. Add one realistic transcript fixture and behavior-focused documentation tests; do not add a discovery CLI or model-coupled API.

**Tech Stack:** Markdown Agent Skill, TypeScript, Vitest, npm workspaces.

---

## File Structure

- Modify `packages/agent/src/wrapper-docs.test.ts`: assert user-facing discovery and safety behavior.
- Modify `packages/agent/skills/codex-auto-demo/SKILL.md`: publish the concise host workflow.
- Create `packages/agent/fixtures/codex-yolo-discovery-approval.md`: demonstrate discovery through handoff.
- Modify `packages/agent/claude-wrapper-parity.md`: document future host parity.
- Modify `packages/agent/README.md` and `README.md`: publish the completed workflow.
- Modify `docs/linear/auto-demo-project-structure.md`: record lifecycle and verification evidence.

### Task 1: RED — Specify The Codex Discovery Contract

**Files:**
- Modify: `packages/agent/src/wrapper-docs.test.ts`
- Test: `packages/agent/src/wrapper-docs.test.ts`

- [ ] **Step 1: Add the failing skill and transcript test**

Add inside `describe("agent wrapper documentation", ...)`:

```ts
it("publishes policy-bounded Codex YOLO discovery through explicit approval", async () => {
  const skill = await readAgentDoc("skills/codex-auto-demo/SKILL.md");
  const discovery = section(skill, "## Goal-Driven YOLO Discovery");
  const transcript = await readAgentDoc("fixtures/codex-yolo-discovery-approval.md");
  const combined = normalizeWhitespace(`${discovery} ${transcript}`);

  for (const required of [
    "natural-language goal",
    "createPolicyEnforcedPlaywrightDiscoveryRehearsalController",
    "safe exact-origin",
    "environment-is-disposable",
    "structured action",
    "compileDiscoverySessionToWalkthroughPlan",
    "replayAndRepairDiscoveryPlan",
    "at most two",
    "hard policy boundary",
    "explicit approval",
    "agent execute",
    "agent handoff",
    "never carries into final capture",
  ]) expect(combined).toContain(required);

  expect(discovery).not.toContain("--allow-best-guess-bypass");
  expect(discovery).not.toContain("autodemo agent discover");
  expect(jsonBlock(transcript, "Replay asks Codex for a bounded repair")).toMatchObject({
    ok: false,
    phase: "replay",
    attempts: [{ status: "failed", failure: { repairability: "repairable" } }],
  });
  expect(jsonBlock(transcript, "Codex presents the replay-validated plan")).toMatchObject({
    ok: true,
    plan: {
      state: "validated",
      validation: { mode: "discovery-replay", status: "ready" },
      approvals: { required: true, approved: false },
    },
  });
  expect(jsonBlock(transcript, "Approval command returns")).toMatchObject({
    ok: true,
    plan: { state: "approved", approvals: { approved: true, basis: "validated" } },
  });
  expect(jsonBlock(transcript, "Handoff command returns")).toMatchObject({
    ok: true,
    project: { manifestPath: "projects/profile-demo/autodemo.project.json" },
    variant: { id: "baseline-polish" },
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
rtk npx vitest run packages/agent/src/wrapper-docs.test.ts
```

Expected: FAIL because the fixture and `## Goal-Driven YOLO Discovery` section do not exist.

- [ ] **Step 3: Record the baseline failure**

Add a project-map note that the pre-change skill interpreted YOLO as legacy best-guess, skipped structured rehearsal/replay, and proposed `--allow-best-guess-bypass`. Do not change the next-task pointer.

- [ ] **Step 4: Commit the RED test and lifecycle docs**

```bash
rtk git add packages/agent/src/wrapper-docs.test.ts docs/linear/auto-demo-project-structure.md docs/superpowers/specs/2026-07-17-wes-189-codex-yolo-discovery-workflow-design.md docs/superpowers/plans/2026-07-17-wes-189-codex-yolo-discovery-workflow.md
rtk git commit -m "test: specify Codex YOLO discovery workflow"
```

Expected: `.gitignore` remains unstaged.

### Task 2: GREEN — Teach Codex The Structured Lifecycle

**Files:**
- Modify: `packages/agent/skills/codex-auto-demo/SKILL.md`
- Create: `packages/agent/fixtures/codex-yolo-discovery-approval.md`
- Test: `packages/agent/src/wrapper-docs.test.ts`

- [ ] **Step 1: Expand the trigger description**

Use this trigger-only frontmatter value:

```yaml
description: Use when Codex needs to prepare or record an Auto Demo project, discover a browser walkthrough from a natural-language goal, run the agent workflow, review or approve a plan, select or generate a saved variant, open the editor, or prepare an MP4 export.
```

- [ ] **Step 2: Add `## Goal-Driven YOLO Discovery` before legacy plan intake**

The section must require this sequence:

1. Start safe exact-origin unless the user freshly identifies an `environment-is-disposable` scope and exact allowed origins.
2. Own an isolated Playwright page and call `createPolicyEnforcedPlaywrightDiscoveryRehearsalController(...)`.
3. Read bounded observations and choose one structured action plus expectations per `perform()`; forbid selectors, raw DOM, arbitrary evaluation, and a parallel browser path.
4. Preserve failed exploration, use explicit back/refresh/retry, and complete only one continuous selected path with runtime bindings resolved in memory.
5. Compile with `compileDiscoverySessionToWalkthroughPlan()` and replay with `replayAndRepairDiscoveryPlan()` in fresh browsers; accept at most two completed direct-child repairs.
6. Stop at every hard policy boundary. Only a replay-validated blocker-free plan reaches transcript-safe review.
7. State that the initial YOLO request is not approval and discovery never uses `--allow-best-guess-bypass`.
8. After separate explicit approval, reuse `agent approve`, `agent execute`, and `agent handoff`; discovery/disposable authority never carries into final capture.
9. Preserve separate local session, replay, plan, input, and execution artifacts without pasting raw/sensitive contents into conversation.

State that no `autodemo agent discover` command exists and link `fixtures/codex-yolo-discovery-approval.md`.

- [ ] **Step 3: Add the transcript fixture**

Create `packages/agent/fixtures/codex-yolo-discovery-approval.md` with synthetic relative paths and these parseable markers:

- `Replay asks Codex for a bounded repair`: one sanitized repairable target failure.
- `Codex presents the replay-validated plan`: validated, unapproved discovery-replay summary and ordered public steps.
- a separate user message explicitly approving that displayed plan.
- `Approval command returns`: approved validated-plan summary.
- existing execute and handoff commands using separate local artifacts.
- `Handoff command returns`: completed `projects/profile-demo/autodemo.project.json` and `baseline-polish`.

The narrative must show a failed exploration branch, explicit backtracking, one direct-child repair, safe exact-origin mode, and the final authority reset. Do not include runtime values, secrets, selectors, raw DOM, screenshots, or request data.

- [ ] **Step 4: Verify GREEN**

```bash
rtk npx vitest run packages/agent/src/wrapper-docs.test.ts
```

Expected: PASS.

- [ ] **Step 5: Validate the skill folder**

```bash
rtk python /Users/weston.bushyeager/.codex/skills/.system/skill-creator/scripts/quick_validate.py packages/agent/skills/codex-auto-demo
```

Expected: valid skill frontmatter and folder naming.

- [ ] **Step 6: Commit GREEN**

```bash
rtk git add packages/agent/skills/codex-auto-demo/SKILL.md packages/agent/fixtures/codex-yolo-discovery-approval.md
rtk git commit -m "docs: add Codex YOLO discovery workflow"
```

### Task 3: RED/GREEN — Publish Repository And Claude Guidance

**Files:**
- Modify: `packages/agent/src/wrapper-docs.test.ts`
- Modify: `packages/agent/claude-wrapper-parity.md`
- Modify: `packages/agent/README.md`
- Modify: `README.md`

- [ ] **Step 1: Add the failing public-docs test**

```ts
it("documents Codex discovery ownership and future Claude host parity", async () => {
  const combined = normalizeWhitespace([
    await readRootDoc("README.md"),
    await readAgentDoc("README.md"),
    await readAgentDoc("claude-wrapper-parity.md"),
  ].join("\n"));

  for (const required of [
    "Codex-hosted YOLO discovery",
    "natural-language goal",
    "safe exact-origin",
    "fresh disposable-environment acknowledgement",
    "structured observation and action",
    "bounded replay and repair",
    "explicit approval",
    "existing deterministic execute and handoff path",
    "Claude production wrapper remains follow-up scope",
  ]) expect(combined).toContain(required);

  expect(combined).toContain("does not expose a discovery CLI");
  expect(combined).not.toContain("autodemo agent discover");
});
```

- [ ] **Step 2: Verify RED**

```bash
rtk npx vitest run packages/agent/src/wrapper-docs.test.ts
```

Expected: FAIL because docs still describe WES-189 as future ownership.

- [ ] **Step 3: Publish the docs**

- Add `## Codex-Hosted YOLO Discovery` to `packages/agent/README.md` covering the skill path, public APIs, safety, repair, approval, final authority reset, and no-discovery-CLI boundary.
- Update root `README.md` Status and the agent package bullet to advertise the completed workflow without adding a CLI command.
- Add `## Goal-Driven Discovery Parity` to `packages/agent/claude-wrapper-parity.md`, require equivalent future host behavior, and state that the Claude production wrapper remains follow-up scope.

- [ ] **Step 4: Verify GREEN and commit**

```bash
rtk npx vitest run packages/agent/src/wrapper-docs.test.ts
rtk git add packages/agent/src/wrapper-docs.test.ts packages/agent/README.md packages/agent/claude-wrapper-parity.md README.md
rtk git commit -m "docs: publish Codex discovery approval handoff"
```

Expected: focused tests pass and `.gitignore` remains unstaged.

### Task 4: REFACTOR — Forward-Test The Skill

**Files:**
- Modify if required: `packages/agent/skills/codex-auto-demo/SKILL.md`
- Modify if required: `packages/agent/fixtures/codex-yolo-discovery-approval.md`
- Modify if required: `packages/agent/src/wrapper-docs.test.ts`

- [ ] **Step 1: Run a fresh read-only agent scenario**

Give a fresh agent only the updated skill and this request:

```text
Use YOLO discovery to figure out how to create a demo of saving a profile on https://example.test, then show me the plan for approval and record it. Return the concrete workflow, commands/APIs, pause points, and preserved artifacts.
```

Expected: structured safe discovery, bounded repair, hard-boundary stop behavior, validated/unapproved review, explicit approval, existing execute/handoff, no best-guess bypass, and no final discovery authority.

- [ ] **Step 2: Close any loophole through RED/GREEN**

If the agent violates an expectation, add the smallest failing assertion to `wrapper-docs.test.ts`, verify RED, clarify the skill minimally, verify GREEN, and forward-test again. If no loophole appears, leave the skill unchanged and record that result.

- [ ] **Step 3: Commit only if refactoring changed artifacts**

```bash
rtk git add packages/agent/src/wrapper-docs.test.ts packages/agent/skills/codex-auto-demo/SKILL.md packages/agent/fixtures/codex-yolo-discovery-approval.md
rtk git commit -m "docs: harden Codex discovery guardrails"
```

Skip when no tracked file changed.

### Task 5: Verify And Record Evidence

**Files:**
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Run focused and full verification**

```bash
rtk npx vitest run packages/agent/src/wrapper-docs.test.ts
rtk npm --workspace @auto-demo/agent run typecheck
rtk npm --workspace @auto-demo/agent run build
rtk npm run validate
rtk git diff --check
```

Expected: every command exits 0; repository build, typechecks, ESLint, tests, and Prettier pass.

- [ ] **Step 2: Add exact local evidence to the project map**

Record branch/commit, changed public artifacts, baseline and forward-test results, focused test count, complete validation result, and preserved `.gitignore`. Keep WES-189 In Progress and the current pointer until merge.

- [ ] **Step 3: Commit the evidence**

```bash
rtk git add docs/linear/auto-demo-project-structure.md
rtk git commit -m "docs: record WES-189 verification evidence"
```

- [ ] **Step 4: Request independent read-only review**

Give the reviewer WES-189, the spec, this plan, `git diff develop...HEAD`, baseline/forward-test evidence, and verification output. The main agent owns every write and evaluates feedback with `superpowers:receiving-code-review`.

### Task 6: Publish, Merge, And Synchronize

- [ ] **Step 1: Address valid review findings through RED/GREEN**

Fix Critical and Important in-scope findings and low-risk verified Minor findings. Reject incorrect, stale, duplicate, or scope-expanding suggestions with technical evidence. Rerun affected checks.

- [ ] **Step 2: Update the map for merge readiness**

Record verification/review evidence and the deterministic post-merge pointer `WES-191`. Keep WES-189 In Progress until merge.

- [ ] **Step 3: Commit remaining issue-owned changes only**

```bash
rtk git add README.md packages/agent/README.md packages/agent/claude-wrapper-parity.md packages/agent/fixtures/codex-yolo-discovery-approval.md packages/agent/skills/codex-auto-demo/SKILL.md packages/agent/src/wrapper-docs.test.ts docs/linear/auto-demo-project-structure.md docs/superpowers/specs/2026-07-17-wes-189-codex-yolo-discovery-workflow-design.md docs/superpowers/plans/2026-07-17-wes-189-codex-yolo-discovery-workflow.md
rtk git commit -m "feat: complete Codex YOLO discovery workflow"
```

Skip if no issue-owned changes remain. Never stage `.gitignore`.

- [ ] **Step 4: Push and create a PR against `develop`**

Use `create-pr-and-merge`. Link WES-189, include spec/plan paths and exact verification. Diagnose failed checks with `gh-pr-failing-tests`; classify feedback with `gh-pr-review-triage`; fix verified findings through RED/GREEN.

- [ ] **Step 5: Squash merge after all gates pass**

Require passing checks, acceptance criteria, current map, and no actionable unresolved review threads.

- [ ] **Step 6: Synchronize local `develop` and complete Linear**

Verify the PR base remote, switch to `develop`, and run:

```bash
rtk git pull --ff-only origin develop
```

Confirm the squash commit locally. Run `linear-sync-gate` completion mode, comment exact evidence on WES-189, move it to Done, add supported readiness notes to WES-191/WES-182, and reconcile the pointer to WES-191. Publish any required post-merge tracked correction through a scoped follow-up PR.
