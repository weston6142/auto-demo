# WES-266 Public-Browse and Phase-Scoped YOLO Policies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` task-by-task. Under `linear-deliver-next-task`, the main agent executes this plan inline in the current checkout; do not create a worktree or delegate implementation.

**Goal:** Implement first-class public-browse and unrestricted YOLO behavior across discovery policy validation, Playwright rehearsal, replay, and the repository-owned Codex workflow while preserving safe/disposable compatibility and mandatory review.

**Architecture:** Extend the existing discriminated policy union, add a pure classifier-driven network decision boundary, and make the existing Playwright guard optional only for YOLO. Rehearsal and replay continue using the same structured public APIs; public-browse routes through centralized action/network decisions, while YOLO skips Auto Demo enforcement without skipping evidence, replay assertions, review, or approval.

**Tech Stack:** TypeScript, Vitest, Playwright, npm workspaces, Markdown wrapper contract tests.

---

### Task 1: Publish all four policy modes and action boundaries

**Files:**

- Modify: `packages/agent/src/discoveryPolicy.test.ts`
- Modify: `packages/agent/src/discoveryPolicy.ts`
- Modify: `packages/agent/src/index.ts`

- [x] **Step 1: Write failing public policy tests**

Add public-browse and YOLO fixtures, then assert:

```ts
expect(
  validateDiscoveryPolicy(
    { mode: "public-browse", allowedOrigins: ["https://example.test"] },
    CURRENT_URL,
  ),
).toMatchObject({ ok: true, policy: { mode: "public-browse" } });
expect(validateDiscoveryPolicy({ mode: "yolo" }, CURRENT_URL)).toEqual({
  ok: true,
  policy: { mode: "yolo" },
});
```

Cover malformed mode-specific shapes, public search submits, destructive public actions, credentials, payment inputs, uploads, missing target risk, cross-origin navigation, and YOLO bypass. Assert only public decisions and outcome codes.

- [x] **Step 2: Run the policy test and verify RED**

Run `npm --workspace @auto-demo/agent test -- --run src/discoveryPolicy.test.ts`.

Expected: FAIL because public-browse and YOLO are not valid policy modes.

- [x] **Step 3: Implement the minimal four-mode contract**

Add:

```ts
export type PublicBrowseDiscoveryPolicy = {
  mode: "public-browse";
  allowedOrigins: string[];
};
export type YoloDiscoveryPolicy = { mode: "yolo" };
export type DiscoveryPolicy =
  | SafeDiscoveryPolicy
  | PublicBrowseDiscoveryPolicy
  | DisposableDiscoveryPolicy
  | YoloDiscoveryPolicy;
export type ValidatedDiscoveryPolicy = {
  readonly mode: "safe" | "public-browse" | "disposable" | "yolo";
  readonly allowedOrigins: ReadonlySet<string>;
};
```

Validate each mode's exact required fields. Authorize YOLO before Auto Demo origin/target checks. Public-browse retains target/risk requirements and credential/payment/upload blocks, permits non-destructive form submits, and blocks destructive action language. Export both new public types from `index.ts`.

- [x] **Step 4: Re-run the policy test and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [x] **Step 5: Commit Task 1**

Stage only Task 1 files and commit `feat(agent): add public-browse and yolo policy modes`.

### Task 2: Centralize classifier-driven network decisions

**Files:**

- Create: `packages/agent/src/discoveryNetworkPolicy.ts`
- Create: `packages/agent/src/discoveryNetworkPolicy.test.ts`
- Modify: `packages/agent/src/index.ts`

- [x] **Step 1: Write a failing sanitized decision-table test**

Test the new function using only classifications:

```ts
expect(
  decideDiscoveryNetworkRequest({
    policy: publicBrowsePolicy,
    classification: {
      requestClass: "xhr-fetch",
      methodCategory: "potential-side-effect",
      originRelation: "same-origin",
      scope: "subresource",
    },
    requestOrigin: "https://example.test",
    actionActive: false,
  }),
).toEqual({ decision: "allow" });
```

Cover safe read/block behavior; public-browse active exact-origin document POST, same-origin XHR/service-worker POST, known-origin beacon POST, cross-origin XHR, idle document POST, other class, unknown method, and unknown origin; disposable exact-origin POST; and all YOLO classifications. Assert no result can contain URL/body/header fields.

- [x] **Step 2: Run the decision test and verify RED**

Run `npm --workspace @auto-demo/agent test -- --run src/discoveryNetworkPolicy.test.ts`.

Expected: FAIL because `decideDiscoveryNetworkRequest()` is absent.

- [x] **Step 3: Implement the pure decision function**

Create:

```ts
export type DiscoveryNetworkDecision =
  { decision: "allow" } | { decision: "block"; code: "network_request_blocked" };
export function decideDiscoveryNetworkRequest(input: {
  policy: ValidatedDiscoveryPolicy;
  classification: DiscoveryNetworkClassification;
  requestOrigin?: string;
  actionActive: boolean;
}): DiscoveryNetworkDecision;
```

Implement the design table directly from the mode, classification, exact origin membership, and active-action flag. Do not accept raw request data. Export the function and type from `index.ts`.

- [x] **Step 4: Re-run the decision test and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [x] **Step 5: Commit Task 2**

Stage only Task 2 files and commit `feat(agent): decide classified discovery network traffic`.

### Task 3: Enforce public-browse in the Playwright guard

**Files:**

- Modify: `packages/agent/src/playwrightDiscoveryPolicyGuard.test.ts`
- Modify: `packages/agent/src/playwrightDiscoveryPolicyGuard.ts`

- [x] **Step 1: Write failing guard behavior tests**

With the existing fake page/CDP harness, prove public-browse allows active and idle same-origin XHR/fetch POST plus cross-origin beacon POST. Prove it blocks cross-origin XHR POST, idle top-level POST, unknown methods, WebSockets, downloads, and unsafe navigation. Assert bounded sanitized blocked classifications.

- [x] **Step 2: Run guard tests and verify RED**

Run `npm --workspace @auto-demo/agent test -- --run src/playwrightDiscoveryPolicyGuard.test.ts`.

Expected: FAIL because the guard still uses safe/disposable-only method logic.

- [x] **Step 3: Route requests through the pure decision**

Replace the inline non-read branch with:

```ts
const decision = decideDiscoveryNetworkRequest({
  policy,
  classification,
  requestOrigin,
  actionActive: activePermit !== undefined,
});
if (decision.decision === "block") {
  recordNetworkViolation(classification);
  await failRequest(event.requestId);
  return;
}
```

Keep recovery, settling, one-use permits, bounded diagnostics, and cleanup intact. YOLO callers will not install this guard.

- [x] **Step 4: Re-run guard and decision tests and verify GREEN**

Run `npm --workspace @auto-demo/agent test -- --run src/playwrightDiscoveryPolicyGuard.test.ts src/discoveryNetworkPolicy.test.ts`.

Expected: PASS.

- [x] **Step 5: Commit Task 3**

Stage Task 3 files and commit `feat(agent): enforce public-browse network boundaries`.

### Task 4: Support public-browse and YOLO rehearsal

**Files:**

- Modify: `packages/agent/src/playwrightPolicyDiscoveryRehearsal.test.ts`
- Modify: `packages/agent/src/playwrightPolicyDiscoveryRehearsal.ts`

- [x] **Step 1: Write failing rehearsal behavior tests**

Prove a public-browse search submit plus background POST completes without `network_request_blocked`. Prove YOLO lets an Auto Demo-only blocked target reach the existing driver and still produces structured session evidence. Verify stop/dispose remains deterministic and idempotent.

- [x] **Step 2: Run rehearsal tests and verify RED**

Run `npm --workspace @auto-demo/agent test -- --run src/playwrightPolicyDiscoveryRehearsal.test.ts`.

Expected: FAIL because setup always installs a guard and current hooks enforce safe/disposable boundaries.

- [x] **Step 3: Make guard enforcement optional only for YOLO**

Validate every policy before action. For YOLO, do not install the guard, skip Auto Demo secret-value and arm/finish hooks, but retain input binding resolution, bounded observations, attempts, session validation, and cleanup. For all enforced modes, retain the guard path. Handle optional-guard cleanup explicitly in both `stop()` and `dispose()`.

- [x] **Step 4: Re-run rehearsal, guard, and policy tests and verify GREEN**

Run `npm --workspace @auto-demo/agent test -- --run src/playwrightPolicyDiscoveryRehearsal.test.ts src/playwrightDiscoveryPolicyGuard.test.ts src/discoveryPolicy.test.ts`.

Expected: PASS.

- [x] **Step 5: Commit Task 4**

Stage Task 4 files and commit `feat(agent): support public-browse and yolo rehearsal`.

### Task 5: Apply the same tier freshly during replay

**Files:**

- Modify: `packages/agent/src/discoveryReplay.test.ts`
- Modify: `packages/agent/src/discoveryReplay.ts`
- Modify: `packages/agent/src/playwrightDiscoveryReplay.test.ts`
- Modify: `packages/agent/src/playwrightDiscoveryReplay.ts`

- [x] **Step 1: Write failing coordinator replay tests**

Prove public-browse and YOLO survive preflight and are passed independently to every fresh browser-factory attempt. Prove omitted policy remains safe, YOLO plan navigation is not rejected by an Auto Demo origin list, and public-browse still rejects undeclared top-level navigation.

- [x] **Step 2: Write failing Playwright replay tests**

Prove public-browse applies its network rules at bootstrap and action time. Prove YOLO installs no Auto Demo bootstrap route, WebSocket/download block, or policy guard, executes actions without policy-block errors, and still reports assertion mismatches. Prove factory calls use distinct browser/context instances.

- [x] **Step 3: Run replay tests and verify RED**

Run `npm --workspace @auto-demo/agent test -- --run src/discoveryReplay.test.ts src/playwrightDiscoveryReplay.test.ts`.

Expected: FAIL because replay assumes origin-scoped safe/disposable enforcement.

- [x] **Step 4: Implement tier-aware replay**

In `discoveryReplay.ts`, let validated YOLO pass navigation-scope preflight while retaining exact-origin checks for enforced modes. In `playwrightDiscoveryReplay.ts`, use `decideDiscoveryNetworkRequest()` for enforced bootstrap traffic and skip Auto Demo routing/guarding for YOLO. Retain fresh context creation, deterministic matching, runtime input validation, assertions, bounded repair, and closure for every tier.

- [x] **Step 5: Re-run replay tests and verify GREEN**

Run the Step 3 command. Expected: PASS.

- [x] **Step 6: Commit Task 5**

Stage Task 5 files and commit `feat(agent): replay with public-browse and yolo policies`.

### Task 6: Publish supported workflow and phase isolation

**Files:**

- Modify: `packages/agent/src/wrapper-docs.test.ts`
- Modify: `packages/agent/skills/codex-auto-demo/SKILL.md`
- Modify: `packages/agent/README.md`
- Modify: `README.md`

- [x] **Step 1: Replace unsupported-tier assertions with failing support assertions**

Require that docs no longer say either tier is unimplemented, describe classifier-based public-browse boundaries and Auto Demo-only YOLO bypass, retain mandatory review/approval, and include:

```text
select tier -> fresh discovery -> select same tier -> fresh replay
-> review -> explicit approval -> select same tier -> fresh recording
```

Assert permits, cookies, browser state, and discovery authority never cross phases.

- [x] **Step 2: Run wrapper tests and verify RED**

Run `npm --workspace @auto-demo/agent test -- --run src/wrapper-docs.test.ts`.

Expected: FAIL because current docs report public-browse and YOLO as unsupported.

- [x] **Step 3: Update the skill and public docs**

Remove `risk_tier_not_supported` guidance for these modes. Publish all four implemented behaviors, exact public-browse rules, YOLO's host/platform limits, mandatory review and approval, and fresh tier establishment for each isolated phase. Keep WES-272, WES-271, WES-267, WES-268, and WES-273 deferrals accurate.

- [x] **Step 4: Run wrapper tests and formatting and verify GREEN**

Run:

```bash
npm --workspace @auto-demo/agent test -- --run src/wrapper-docs.test.ts
npx prettier --check packages/agent/skills/codex-auto-demo/SKILL.md packages/agent/README.md README.md
```

Expected: PASS.

- [x] **Step 5: Commit Task 6**

Stage Task 6 files and commit `docs(agent): publish supported risk-tier workflow`.

### Task 7: Verify, review, and prepare durable completion evidence

**Files:**

- Modify: `docs/linear/auto-demo-project-structure.md`
- Verify all files changed in Tasks 1-6

- [x] **Step 1: Run the full agent suite**

Run `npm --workspace @auto-demo/agent test`. Expected: all agent tests pass.

- [x] **Step 2: Run complete relevant repository checks**

Run:

```bash
npm run build
npm run typecheck
npm test
npx eslint packages/agent/src/discoveryPolicy.ts packages/agent/src/discoveryPolicy.test.ts packages/agent/src/discoveryNetworkPolicy.ts packages/agent/src/discoveryNetworkPolicy.test.ts packages/agent/src/playwrightDiscoveryPolicyGuard.ts packages/agent/src/playwrightDiscoveryPolicyGuard.test.ts packages/agent/src/playwrightPolicyDiscoveryRehearsal.ts packages/agent/src/playwrightPolicyDiscoveryRehearsal.test.ts packages/agent/src/discoveryReplay.ts packages/agent/src/discoveryReplay.test.ts packages/agent/src/playwrightDiscoveryReplay.ts packages/agent/src/playwrightDiscoveryReplay.test.ts packages/agent/src/wrapper-docs.test.ts
npx prettier --check docs/superpowers/specs/2026-07-18-wes-266-public-browse-yolo-policies-design.md docs/superpowers/plans/2026-07-18-wes-266-public-browse-yolo-policies.md packages/agent/src/discoveryPolicy.ts packages/agent/src/discoveryPolicy.test.ts packages/agent/src/discoveryNetworkPolicy.ts packages/agent/src/discoveryNetworkPolicy.test.ts packages/agent/src/playwrightDiscoveryPolicyGuard.ts packages/agent/src/playwrightDiscoveryPolicyGuard.test.ts packages/agent/src/playwrightPolicyDiscoveryRehearsal.ts packages/agent/src/playwrightPolicyDiscoveryRehearsal.test.ts packages/agent/src/discoveryReplay.ts packages/agent/src/discoveryReplay.test.ts packages/agent/src/playwrightDiscoveryReplay.ts packages/agent/src/playwrightDiscoveryReplay.test.ts packages/agent/src/wrapper-docs.test.ts packages/agent/skills/codex-auto-demo/SKILL.md packages/agent/README.md README.md
git diff --check
```

Expected: all commands pass. If repository-wide lint sees the preserved untracked Cars.com script, record the exact unrelated failure and require every issue-owned lint command plus clean-checkout CI to pass.

- [x] **Step 3: Request independent read-only review**

Review WES-266, the design, plan, and full issue diff. Classify findings as Critical/Important/Minor, verify them technically, fix valid in-scope findings with a failing test first, and re-run affected checks.

- [x] **Step 4: Update the project map with stable evidence**

Add design/plan links, mark WES-266 In Progress until durable merge, summarize implemented behavior and exact local verification, preserve unrelated dirty-file notes, and identify the deterministic post-merge pointer without starting it.

- [x] **Step 5: Commit issue documentation**

Stage only the spec, plan, and project map; commit `docs: record WES-266 policy delivery evidence`.

- [x] **Step 6: Complete the authorized PR and merge lifecycle**

Create a PR to `develop` with the Linear issue, design/plan links, and exact verification. Monitor structured checks and review threads, repair valid issue-scoped failures through TDD, update the map with stable final evidence before squash merge, synchronize local `develop`, run the completion gate, and stop without starting the next issue.
