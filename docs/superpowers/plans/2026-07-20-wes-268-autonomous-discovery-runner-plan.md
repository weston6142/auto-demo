# WES-268 Autonomous Discovery Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repository-owned, durable, two-phase runner that takes autonomous browser discovery through replay-validated review and, only after explicit approval, through fresh recording and project handoff.

**Architecture:** `@auto-demo/agent` gains an atomic filesystem store and an orchestration module. The orchestrator composes existing launch, rehearsal, compilation, replay/repair, review, approval-verification, recording, and handoff boundaries while a host supplies only bounded decisions and final integration adapters. Discovery and completion remain separate public calls so the review/approval pause cannot be bypassed.

**Tech Stack:** TypeScript, Node.js filesystem promises, Playwright-backed existing agent APIs, Vitest, npm workspaces, ESLint, Prettier.

---

### Task 1: Atomic Runner Artifact Store

**Files:**

- Create: `packages/agent/src/autonomousDiscoveryStore.ts`
- Create: `packages/agent/src/autonomousDiscoveryStore.test.ts`
- Modify: `packages/agent/package.json`

- [x] **Step 1: Write failing store tests**

Add public-behavior tests that create temporary directories and assert:

```ts
const store = createFileAutonomousDiscoveryStore(join(root, "run-1"));
await expect(store.initialize(RUN)).resolves.toEqual({ ok: true });
await expect(store.writeSession("root", SESSION)).resolves.toEqual({
  ok: true,
  path: "sessions/root.json",
});
expect(JSON.parse(await readFile(join(root, "run-1/sessions/root.json"), "utf8"))).toEqual(SESSION);
```

Also assert that a non-empty workflow directory returns `workflow_directory_not_empty`, unsafe repair ordinals cannot escape `sessions/`, `loadCheckpoint()` rejects malformed or missing metadata with fixed errors, and persisted artifacts never include supplied runtime bindings because no store method accepts them.

- [x] **Step 2: Run the focused test and verify RED**

Run: `rtk npm --workspace @auto-demo/agent test -- --run src/autonomousDiscoveryStore.test.ts`  
Expected: FAIL because `autonomousDiscoveryStore.js` and its exports do not exist.

- [x] **Step 3: Implement the typed store and atomic writes**

Define:

```ts
export type AutonomousDiscoveryRunPhase =
  | "discovering"
  | "replaying"
  | "review-required"
  | "recording"
  | "completed"
  | "abandoned"
  | "failed";

export type AutonomousDiscoveryRunCheckpoint = {
  schemaVersion: 1;
  runId: string;
  phase: AutonomousDiscoveryRunPhase;
  policy: DiscoveryPolicy;
  target: { url: string; goal: string };
  launchProfile: BrowserLaunchProfileV1;
  artifacts: Partial<Record<AutonomousDiscoveryArtifactKind, string>>;
};

export function createFileAutonomousDiscoveryStore(directory: string): AutonomousDiscoveryStore;
```

Use `mkdir`, `readdir`, `readFile`, `writeFile`, and `rename`. Write each JSON artifact to `<name>.tmp-<safe nonce>` in the same directory, then rename it over the stable path. Store methods own the fixed artifact names and return only safe relative paths. Validate checkpoints on read with explicit key/type checks, `validateDiscoveryPolicy()`, `validateBrowserLaunchProfile()`, safe IDs, and safe relative artifact paths.

Add `src/autonomousDiscoveryStore.test.ts` to the agent package's `test` and `test:unit` Vitest file lists so repository gates cannot omit it.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `rtk npm --workspace @auto-demo/agent test -- --run src/autonomousDiscoveryStore.test.ts`  
Expected: PASS with the store success, collision, malformed-checkpoint, and safe-path cases.

- [x] **Step 5: Refactor without changing behavior**

Keep path resolution, atomic JSON writing, and checkpoint decoding as separate private functions. Re-run the focused test and `rtk npm --workspace @auto-demo/agent run typecheck`.

- [x] **Step 6: Commit the store slice**

```bash
rtk git add packages/agent/src/autonomousDiscoveryStore.ts packages/agent/src/autonomousDiscoveryStore.test.ts packages/agent/package.json
rtk git commit -m "feat(agent): add autonomous discovery artifact store"
```

### Task 2: Durable Root Discovery To Review

**Files:**

- Create: `packages/agent/src/autonomousDiscoveryRunner.ts`
- Create: `packages/agent/src/autonomousDiscoveryRunner.test.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/package.json`

- [x] **Step 1: Write the failing review-checkpoint test**

Build fakes around published behavior: the launcher exposes a fresh handle, the controller returns a valid initial session and one successful action, the decision provider returns `act` then `complete`, replay returns a promoted validated plan, and review returns no blockers. Assert:

```ts
const result = await runAutonomousDiscoveryToReview(INPUT, dependencies);
expect(result).toMatchObject({ ok: true, phase: "review_required", replayAttempts: 1 });
expect(dependencies.store.events.map((event) => event.kind)).toEqual([
  "checkpoint",
  "session",
  "session",
  "session",
  "plan",
  "checkpoint",
  "replay",
  "plan",
  "review",
  "checkpoint",
]);
expect(dependencies.record).not.toHaveBeenCalled();
expect(dependencies.handoff).not.toHaveBeenCalled();
expect(browser.closed).toBe(true);
```

Assert that the second decision is not requested until the action session write resolves. Assert invalid policy/profile/run/target inputs return `invalid_runner_input` before launcher use.

- [x] **Step 2: Run the focused test and verify RED**

Run: `rtk npm --workspace @auto-demo/agent test -- --run src/autonomousDiscoveryRunner.test.ts`  
Expected: FAIL because the runner API does not exist.

- [x] **Step 3: Implement decision and result contracts**

Add:

```ts
export type AutonomousDiscoveryDecision =
  | { kind: "act"; input: DiscoveryRehearsalActionInput }
  | { kind: "complete"; attemptIds: string[]; source: "host-agent" | "user-directed" }
  | { kind: "abandon"; reason: { code: string; summary: string } };

export type AutonomousDiscoveryDecisionProvider = {
  decide(input: {
    session: DiscoverySessionV1;
    observation: DiscoveryObservation;
    diagnostics: DiscoveryRehearsalDiagnostic[];
    repair?: { number: 1 | 2; failure: DiscoveryReplayFailureEvidence };
  }): Promise<AutonomousDiscoveryDecision>;
};
```

Define explicit runner inputs/results and dependency interfaces. Keep the test seam in dependencies but export a default dependency builder that uses the established Playwright launcher, policy controller, compiler, replay factory, and review function.

Add `src/autonomousDiscoveryRunner.test.ts` to the agent package's `test` and `test:unit` Vitest file lists.

- [x] **Step 4: Implement the root loop and durable ordering**

Validate inputs before `store.initialize()`. Launch one fresh browser handle, create the policy controller, call `start()` with the resolved launch profile, persist the returned session, and then request one decision at a time. For `act`, call `perform()` once and persist its returned session before continuing. For `complete` or `abandon`, call `stop()` and persist the terminal session before any compilation or return. Dispose the controller and close the launch handle in `finally`.

On completion, persist the compiled draft, move the checkpoint to `replaying`, call replay, persist replay evidence, persist the replay-validated plan and review, then move to `review-required`. Return only cloned, bounded public values.

- [x] **Step 5: Run focused tests and verify GREEN**

Run: `rtk npm --workspace @auto-demo/agent test -- --run src/autonomousDiscoveryRunner.test.ts`  
Expected: PASS for validation, durable ordering, review stop, and cleanup behavior.

- [x] **Step 6: Add abandonment and persistence-failure tests**

Assert an `abandon` decision writes the abandoned session and checkpoint without compile/replay. Make the second session write reject and assert the runner closes resources, returns `artifact_persistence_failed`, performs no later action, and never asks for another decision.

- [x] **Step 7: Implement fixed failure mapping and verify GREEN**

Map caught failures to stable `phase`, `code`, and `message` values without exception text. Preserve the latest successfully written checkpoint. Run the focused runner tests and agent typecheck.

- [x] **Step 8: Export the discovery API and commit**

Export the store and runner functions/types from `packages/agent/src/index.ts`, run `rtk npm --workspace @auto-demo/agent run build`, then commit:

```bash
rtk git add packages/agent/src/autonomousDiscoveryRunner.ts packages/agent/src/autonomousDiscoveryRunner.test.ts packages/agent/src/autonomousDiscoveryStore.ts packages/agent/src/index.ts packages/agent/package.json
rtk git commit -m "feat(agent): run durable autonomous discovery to review"
```

### Task 3: Runner-Owned Bounded Repair

**Files:**

- Modify: `packages/agent/src/autonomousDiscoveryRunner.ts`
- Modify: `packages/agent/src/autonomousDiscoveryRunner.test.ts`

- [x] **Step 1: Write a failing repair behavior test**

Make the first replay attempt fail with repairable target evidence. Assert the runner launches a second fresh discovery handle, starts a child with `parentSessionId` equal to the current source session, gives the decision provider `{ number: 1, failure }`, persists `sessions/repair-1.json`, and returns the completed child to replay. Assert the promoted result reaches `review_required` after two replay attempts.

- [x] **Step 2: Run the repair test and verify RED**

Run: `rtk npm --workspace @auto-demo/agent test -- --run src/autonomousDiscoveryRunner.test.ts -t "runs a bounded repair in a fresh child session"`  
Expected: FAIL because runner replay has no repair provider.

- [x] **Step 3: Implement child-session repair through the same loop**

Create the replay dependency with:

```ts
repair: {
  async repair({ repairNumber, parentSession, failure }) {
    return await runDiscoverySession({
      kind: "repair",
      ordinal: repairNumber,
      parentSession,
      failure,
      launchProfile: checkpoint.launchProfile,
    });
  },
}
```

The child uses the exact policy, goal, target, and selected launch profile, with no fallback or inherited browser state. Return only a valid completed direct child. Let `replayAndRepairDiscoveryPlan()` remain the authority for the two-repair limit and structural/lineage checks.

- [x] **Step 4: Add hard-boundary tests**

Assert `policy_blocked`, `anti_bot_challenge`, invalid artifacts, and setup failures never call the repair decision path. Assert an abandoned repair returns `repair_declined` and persists its abandoned child session.

- [x] **Step 5: Run focused tests and commit**

Run the complete runner test file and agent typecheck, then commit:

```bash
rtk git add packages/agent/src/autonomousDiscoveryRunner.ts packages/agent/src/autonomousDiscoveryRunner.test.ts
rtk git commit -m "feat(agent): own bounded discovery repair lifecycle"
```

### Task 4: Explicitly Approved Recording And Handoff

**Files:**

- Modify: `packages/agent/src/autonomousDiscoveryRunner.ts`
- Modify: `packages/agent/src/autonomousDiscoveryRunner.test.ts`
- Modify: `packages/agent/src/index.ts`

- [x] **Step 1: Write failing approval-rejection tests**

Seed a `review-required` checkpoint and replay-validated plan in the fake store. Assert `completeApprovedAutonomousDiscovery()` rejects an unapproved plan, stale approval, changed discovery source fingerprint, changed launch profile, changed target, and a `completed` checkpoint before calling `record`.

- [x] **Step 2: Run approval tests and verify RED**

Run: `rtk npm --workspace @auto-demo/agent test -- --run src/autonomousDiscoveryRunner.test.ts -t "approved completion"`  
Expected: FAIL because the completion API does not exist.

- [x] **Step 3: Implement checkpoint and approval verification**

Load the checkpoint, replay-validated plan, and review artifact. Require phase `review-required`. Use `verifyWalkthroughPlanApproval()` and compare the approved plan's target, discovery session ID, selected-path fingerprint, and launch profile with the persisted plan. Persist `plan.approved.json`, then advance to `recording` before invoking external recording.

- [x] **Step 4: Write the failing successful-completion test**

Approve the persisted plan with the existing approval API. Assert:

```ts
expect(record).toHaveBeenCalledWith({
  plan: approvedPlan,
  policy: INPUT.policy,
  launchProfile: approvedPlan.launchProfile,
  outputDir: "/capture",
  inputBindings: { "demo-zip": "10001" },
});
expect(store.events).toContainEqual({ kind: "execution", value: execution });
expect(handoff).toHaveBeenCalledWith({
  execution,
  projectDirectory: "/project",
  projectName: "Cars Kia Sorento",
});
expect(result).toMatchObject({ ok: true, phase: "completed" });
```

Inspect every persisted JSON value and assert it does not contain `10001` or the `inputBindings` key. Assert no editor/export dependency exists.

- [x] **Step 5: Implement completion sequencing and failure preservation**

Require a freshly supplied policy matching the persisted non-authorizing tier/scope selection and pass it with the exact profile to `record`; persist a bounded successful execution summary before `handoff`; persist a bounded handoff summary before setting phase `completed`. A recording failure leaves phase `recording` with no handoff artifact. A handoff failure retains the execution artifact and returns phase `handoff` without claiming completion.

- [x] **Step 6: Run focused tests, typecheck, and commit**

Run the runner tests, agent typecheck, and agent build, then commit:

```bash
rtk git add packages/agent/src/autonomousDiscoveryRunner.ts packages/agent/src/autonomousDiscoveryRunner.test.ts packages/agent/src/index.ts
rtk git commit -m "feat(agent): complete approved discovery recording"
```

### Task 5: Supported Workflow Documentation And Project Tracking

**Files:**

- Modify: `packages/agent/README.md`
- Modify: `packages/agent/skills/codex-auto-demo/SKILL.md`
- Modify: `packages/agent/src/wrapper-docs.test.ts`
- Modify: `docs/linear/auto-demo-project-structure.md`
- Modify: `docs/superpowers/specs/2026-07-20-wes-268-autonomous-discovery-runner-design.md`
- Modify: `docs/superpowers/plans/2026-07-20-wes-268-autonomous-discovery-runner-plan.md`

- [x] **Step 1: Write failing wrapper documentation assertions**

Require the README and Codex skill to name `runAutonomousDiscoveryToReview()` and `completeApprovedAutonomousDiscovery()`, state that normal use must not reproduce the lifecycle in ad hoc scripts, require an explicit tier before browser activity, require durable per-action persistence, and preserve the distinct review/approval turn before completion.

- [x] **Step 2: Run the docs test and verify RED**

Run: `rtk npm --workspace @auto-demo/agent test -- --run src/wrapper-docs.test.ts`  
Expected: FAIL because the runner guidance is absent.

- [x] **Step 3: Update public guidance**

Replace “there is no discovery runner/CLI” and direct manual composition instructions with the supported public runner flow. Keep explicit risk selection, fresh phase authority, raw-data/runtime-value prohibitions, and mandatory approval. State that the runner is an API rather than an interactive CLI and that it never opens the editor or exports.

- [x] **Step 4: Update durable project evidence**

Link the WES-268 plan in the project map and record implementation behavior, exact tests, review state, PR/CI state, and the deterministic WES-273 next pointer as evidence becomes available. Update design/plan self-review notes if implementation reveals a verified scope correction.

- [x] **Step 5: Run focused docs checks and commit**

Run the wrapper docs test, Prettier on issue-owned Markdown/TypeScript, and `rtk git diff --check`, then commit:

```bash
rtk git add packages/agent/README.md packages/agent/skills/codex-auto-demo/SKILL.md packages/agent/src/wrapper-docs.test.ts docs/linear/auto-demo-project-structure.md docs/superpowers/specs/2026-07-20-wes-268-autonomous-discovery-runner-design.md docs/superpowers/plans/2026-07-20-wes-268-autonomous-discovery-runner-plan.md
rtk git commit -m "docs: adopt the autonomous discovery runner"
```

### Task 6: Full Verification, Review, Publication, And Completion Sync

**Files:**

- Modify only issue-owned files required by verified findings or lifecycle evidence.

- [x] **Step 1: Run the complete local verification gate**

Run:

```bash
rtk npm test
rtk npm run build
rtk npm run typecheck
rtk npm run lint
rtk npm run format:check
rtk git diff --check
```

Expected: all issue-owned checks pass. If repository-wide lint/format reaches preserved `workflow/` diagnostics, record the exact pre-existing findings and run focused issue-owned lint/format checks.

- [x] **Step 2: Request independent read-only code review**

Review the Linear issue, design, plan, branch diff, public contracts, persistence ordering, cleanup, repair boundaries, approval proof, policy/profile parity, raw/runtime-value handling, tests, and documentation. Fix every verified Critical or Important issue through RED-GREEN-REFACTOR and re-run affected checks.

- [x] **Step 3: Record stable completion evidence in the project map**

Add exact test counts/commands, independent review result, and WES-273 as the deterministic post-merge pointer. Search this plan with:

```bash
rtk rg -n '^\s*[-*]\s+\[ \]' docs/superpowers/plans/2026-07-20-wes-268-autonomous-discovery-runner-plan.md
```

Only publication/completion steps whose prerequisites have not occurred may remain unchecked.

- [ ] **Step 4: Commit, push, create the PR, and monitor checks**

Stage only WES-268 paths, push `wes-268-autonomous-discovery-runner`, and create a PR targeting `develop` with the Linear issue, design/plan links, and exact verification. Triage review threads and failed checks before changing code; push scoped fixes and re-monitor exact-head status.

- [ ] **Step 5: Squash merge and synchronize**

After required checks and reviews pass, squash merge. Switch to `develop`, verify its upstream is the base repository, fetch `origin develop`, and run `rtk git pull --ff-only origin develop`. Confirm the squash commit is present locally while preserving `.gitignore` and `workflow/` unchanged.

- [ ] **Step 6: Run the completion sync gate**

Verify the merged PR, squash commit, CI, local verification, design, plan, and map. Add the Linear completion comment, move WES-268 to Done, add the dependency-ready handoff to WES-273, update WES-265 progress, and reconcile the map next pointer to WES-273. If a tracked map correction remains after merge, publish it through a scoped follow-up PR.

- [ ] **Step 7: Require no unfinished in-scope plan items**

Repeat the unchecked-item search. Every item must be checked or carry an explicit transferred/excluded disposition before reporting completion.

## Plan Self-Review

- Spec coverage: Tasks 1-5 cover the store, root orchestration, repair, explicit approval completion, public guidance, errors, and tests; Task 6 covers delivery and synchronization.
- Placeholder scan: no TBD, TODO, “similar to,” generic test instruction, or undefined implementation step remains.
- Type consistency: the plan consistently uses `runAutonomousDiscoveryToReview`, `completeApprovedAutonomousDiscovery`, `AutonomousDiscoveryDecisionProvider`, `AutonomousDiscoveryStore`, and the two-phase `review_required`/`completed` results.
