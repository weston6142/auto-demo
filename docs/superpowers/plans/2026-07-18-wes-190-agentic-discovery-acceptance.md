# WES-190 Agentic Discovery Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. WES-190's delivery authorization requires inline execution in the current checkout; do not create a worktree or dispatch implementation agents.

**Goal:** Add deterministic behavior-first acceptance evidence that a discovered browser flow can be repaired, replay-validated, explicitly approved, recorded, and handed off as a loadable project with `baseline-polish`.

**Architecture:** A test-only local HTTP fixture supplies semantic duplicates, cross-page navigation, a controlled stale-target transition, and an explicitly disposable mutation endpoint. CLI-package acceptance tests act as a deterministic host using only public `@auto-demo/agent`, CLI, and project APIs, with one composed real-Playwright capture/handoff journey plus focused policy coverage.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, Playwright, local Node HTTP server, npm workspaces.

---

### Task 1: Add the deterministic acceptance fixture through a failing semantic journey

**Files:**

- Create: `packages/cli/src/agenticDiscoveryAcceptance.test.ts`
- Create: `packages/cli/src/agenticDiscoveryAcceptanceFixture.ts`
- Modify: `packages/cli/package.json`

- [x] **Step 1: Register the missing acceptance test file**

Append `src/agenticDiscoveryAcceptance.test.ts` to the explicit Vitest file list in the CLI package `test` script. Create the test file with an import of `startAgenticDiscoveryAcceptanceFixture()` from the not-yet-created fixture module and one test named `selects the first semantic duplicate and records cross-page evidence`.

The test must launch Chromium, create a page, start the fixture, and call a helper that starts `createPolicyEnforcedPlaywrightDiscoveryRehearsalController()` with:

```ts
{
  chromiumNetworkInstrumentation: "exclusive",
  policy: { mode: "safe", allowedOrigins: [fixture.origin] },
  inputResolver: {
    async resolve() {
      return { ok: false as const, code: "input_binding_unavailable", summary: "No input expected." };
    },
  },
}
```

From the initial public observation, assert that two `Read story` link targets have occurrences `[1, 2]`, select the target with occurrence `1`, perform a click with exact navigation and visible-state expectations for `fixture.firstStoryUrl` and `First story`, complete the session with that successful attempt ID, and assert the selected path contains only that attempt.

- [x] **Step 2: Run the focused test and confirm RED**

Run:

```bash
rtk npm --workspace @auto-demo/cli exec -- vitest run src/agenticDiscoveryAcceptance.test.ts
```

Expected: FAIL because `agenticDiscoveryAcceptanceFixture.ts` does not exist.

- [x] **Step 3: Implement the smallest local fixture**

Create a focused fixture module exporting:

```ts
export type AgenticDiscoveryAcceptanceFixture = {
  origin: string;
  storiesUrl: string;
  firstStoryUrl: string;
  profileUrl: string;
  mutationCount(): number;
  useRepairedStoryTarget(): void;
  close(): Promise<void>;
};

export async function startAgenticDiscoveryAcceptanceFixture(): Promise<AgenticDiscoveryAcceptanceFixture>;
```

Use `createServer()` bound to port `0` on `127.0.0.1`. Serve:

- `/stories`: two links with the same accessible name `Read story`; the first points to `/stories/first`, the second to `/stories/second`;
- `/stories/first`: heading `First story`, with the selected action labelled `Continue story` before `useRepairedStoryTarget()` and `Open story` afterward;
- `/stories/second`: heading `Second story`;
- `/profile`: a `POST` form with button `Save profile` and visible `Profile saved` state after success;
- `/profile/save`: increments the in-memory mutation count on `POST`, returns `204`, and returns `405` otherwise.

All HTML must be static, semantic, and free of secrets. `close()` must await server shutdown.

- [x] **Step 4: Run the focused test and confirm GREEN**

Run the focused command from Step 2.

Expected: PASS with one behavioral test.

- [x] **Step 5: Refactor shared lifecycle cleanup**

Add `afterEach` cleanup that closes any controller, page/context/browser, and fixture created by the test. Re-run the focused test and keep it green.

### Task 2: Prove safe-versus-disposable mutation behavior

**Files:**

- Modify: `packages/cli/src/agenticDiscoveryAcceptance.test.ts`
- Modify: `packages/agent/src/discoveryReplay.test.ts`
- Modify: `packages/agent/src/walkthroughValidation.ts`

- [x] **Step 1: Write the policy acceptance test**

Add `requires exact-origin disposable authority for mutation`. First rehearse `/profile` with safe policy, select `Save profile` from the public observation, perform the click, and assert a blocked attempt with `destructive_action_blocked` plus `fixture.mutationCount() === 0`.

Start a fresh page and controller with:

```ts
policy: {
  mode: "disposable",
  acknowledgement: "environment-is-disposable",
  allowedOrigins: [fixture.origin],
}
```

Perform the same structured action with a visible-state expectation for `Profile saved`. Assert success, one mutation, a matched expectation, and absence of the acknowledgement string from the serialized session.

- [x] **Step 2: Run the focused test and observe its first result**

Run the focused command from Task 1. If it fails, confirm the failure is a public contract mismatch before changing any production code. If it passes, record that existing policy behavior already satisfies the new acceptance criterion; no production change is warranted.

- [x] **Step 3: Refactor only test duplication**

Extract test-local helpers for starting a controller, locating a public target by label/role/occurrence, and requiring a successful result. Do not expose test-only helpers from production packages. Re-run the focused acceptance file.

### Task 3: Prove stale-target repair and deterministic fresh replay

**Files:**

- Modify: `packages/cli/src/agenticDiscoveryAcceptance.test.ts`

- [x] **Step 1: Write the failing repaired-replay journey**

Add `repairs a stale semantic target in a direct child and passes fresh replay`. Build a completed root discovery session whose selected path navigates to the first story, clicks `Continue story`, and observes `Story ready`. Compile it and assert the plan is draft and unapproved.

Call `fixture.useRepairedStoryTarget()` before replay. Invoke `replayAndRepairDiscoveryPlan()` with `createPlaywrightDiscoveryReplayBrowserFactory()` and safe exact-origin policy. The repair provider must assert the first failure code is `target_not_found`, run a new policy-enforced rehearsal from the same start URL with `parentSessionId` equal to the root session ID, choose `Open story`, complete a changed selected path, and return that direct child.

Assert:

```ts
expect(result).toMatchObject({
  ok: true,
  attempts: [{ status: "failed" }, { status: "passed" }],
  sourceSession: { parentSessionId: rootSession.id },
  plan: {
    state: "validated",
    approvals: { required: true, approved: false },
    validation: { mode: "discovery-replay", replay: { attempts: 2 } },
  },
});
```

Also assert the serialized result excludes the retired target text from failure evidence and contains no fixture query or secret-like data.

- [x] **Step 2: Run the focused test and confirm RED or existing contract satisfaction**

Run the focused acceptance file. A failure must be traced to fixture/session construction or a public contract gap. Do not patch replay internals without a reproducible behavioral mismatch.

- [x] **Step 3: Add only the minimal missing behavior**

Prefer correcting the test's public session construction. If a documented public API gap is proven, add one focused regression in the owning `packages/agent/src/*test.ts` file, watch it fail, implement the smallest production fix, and update the design and this plan with the discovered change.

The acceptance RED proved a production-shaped gap: `sanitizeWalkthroughPlanArtifact()` redacted valid UUID-shaped provenance identifiers into an invalid bracketed token. The owning replay regression uses a runtime-generated attempt identifier, and the minimal fix applies identifier-aware sanitization to structural IDs while leaving text sanitization unchanged.

- [x] **Step 4: Confirm fresh replay and owning suites are GREEN**

Run:

```bash
rtk npm --workspace @auto-demo/cli exec -- vitest run src/agenticDiscoveryAcceptance.test.ts
rtk npm --workspace @auto-demo/agent test
```

Expected: acceptance replay passes after exactly one direct-child repair and the agent suite remains green.

### Task 4: Carry the repaired plan through approval, capture, and project handoff

**Files:**

- Modify: `packages/cli/src/agenticDiscoveryAcceptance.test.ts`

- [x] **Step 1: Extend the repaired journey with explicit approval**

Pass the validated repaired plan to `reviewWalkthroughPlan()` and assert approval eligibility. Call `approveWalkthroughPlan()` only after replay validation, assert the returned plan is approved with `basis: "validated"`, and write the full `{ ok: true, plan }` artifact to a temporary `approved-plan.json`.

Before approval, call `runCliAsync(["agent", "execute", ...])` with the validated but unapproved artifact and assert it fails without creating a successful capture. This proves discovery and disposable policy do not substitute for approval.

- [x] **Step 2: Execute the approved artifact under real capture**

Invoke:

```ts
await runCliAsync([
  "agent",
  "execute",
  "--plan",
  approvedPlanPath,
  "--out",
  captureDir,
  "--viewport",
  "640x360",
  "--json",
]);
```

Assert exit `0`, executed/completed plan state, non-empty media, completed manifest, and sanitized output. Persist stdout as `execution.json`.

- [x] **Step 3: Hand off and load the project**

Invoke `autodemo agent handoff` through `runCliAsync()` with the execution artifact, a fresh project directory, and JSON output. Assert exit `0`, load the directory with `loadProject()`, confirm source capture status `completed`, confirm variant ID `baseline-polish`, and confirm `variants/baseline-polish.json` is non-empty.

Assert the handoff's `nextSteps` preserve both editor and export guidance. Do not start a long-lived editor or perform a second render in this composed test; the owning editor and render suites remain the exhaustive contract gates.

- [x] **Step 4: Preserve failed-capture acceptance evidence**

Add a focused execution using an approved copy whose final accessible target is intentionally absent. Assert exit `1`, stable `target_not_found`, failed manifest status, and non-empty flushed media without raw exception or secret-like output. This assertion is allowed to reuse the deterministic fixture and public CLI only.

- [x] **Step 5: Run acceptance and CLI suites**

Run:

```bash
rtk npm --workspace @auto-demo/cli exec -- vitest run src/agenticDiscoveryAcceptance.test.ts
rtk npm --workspace @auto-demo/cli test
```

Expected: all acceptance and CLI tests pass.

### Task 5: Document the verified contract and update lifecycle evidence

**Files:**

- Modify: `README.md`
- Modify: `packages/agent/README.md`
- Modify: `packages/cli/README.md`
- Modify: `docs/linear/auto-demo-project-structure.md`

- [x] **Step 1: Add concise acceptance documentation**

Document that deterministic local fixtures now verify semantic first-occurrence selection, duplicate resolution, cross-page evidence, stale-target direct-child repair, exact-origin disposable mutation, replay validation, explicit approval, real capture, and project handoff. State explicitly that this adds no discovery CLI or embedded model and that public-site smoke is optional.

- [x] **Step 2: Record local implementation evidence in the project map**

Add the design and plan paths to Local Context. Append a dated WES-190 implementation note listing the exact acceptance behaviors and verification commands. Keep WES-190 In Progress until PR checks and review pass; keep WES-182 open.

- [x] **Step 3: Run documentation and formatting checks**

Run:

```bash
rtk npm --workspace @auto-demo/agent test
rtk npm --workspace @auto-demo/cli test
rtk npm run format:check
rtk git diff --check
```

Expected: all commands exit `0`.

### Task 6: Verify, review, publish, and synchronize

**Files:**

- Modify only issue-owned files identified by review or verification.

- [x] **Step 1: Run fresh repository verification**

Run:

```bash
rtk npm run validate
rtk git diff --check
```

Expected: build, every workspace typecheck, ESLint, all workspace tests, repository formatting, and diff whitespace checks pass.

- [x] **Step 2: Request independent read-only review**

Review the diff from `origin/develop` through `HEAD` and the working tree against WES-190, the design, and this plan. Fix verified Critical and Important findings with focused RED-GREEN cycles; verify Minor findings and fix only when in scope and low risk.

- [x] **Step 3: Commit only WES-190 paths and publish the PR**

Stage explicit issue-owned paths, excluding `.gitignore`. Commit, push `wes-190-agentic-discovery-acceptance`, and open a PR to `develop` with the Linear issue, spec/plan links, and exact verification evidence.

- [x] **Step 4: Monitor checks and review threads**

Diagnose failures from logs before changes. Apply technically valid in-scope feedback, re-run affected checks, push, and wait until required checks pass and no actionable review thread remains.

- [x] **Step 5: Record completion evidence before squash merge**

Update the project map with the PR, exact final head, passing checks, tests, review outcome, and deterministic next-task pointer. Because WES-190 is the last child, the completion pointer is the WES-182 tracker completion rather than a second product issue. Include the map update in the PR and re-wait for checks.

- [x] **Step 6: Squash merge and run the completion sync gate**

Squash merge into `develop`, fast-forward local `develop` from the verified base remote, confirm the squash commit locally, add concise completion evidence to WES-190, move WES-190 to Done, reconcile WES-182 to Done only if every child and tracker criterion is verified, and update the final project pointer to no remaining task.
