# WES-188 Deterministic Replay And Repair Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replay a compiled discovery plan in fresh policy-enforced browser contexts, return bounded provenance-linked failure evidence, accept at most two host-owned child-session repairs, and promote only a blocker-free final plan to validated and reviewable state.

**Architecture:** Add a generic replay-and-repair coordinator in `@auto-demo/agent` that validates canonical WES-187 plan/session pairs, executes deterministic plan steps through a small browser boundary, and recompiles only completed linear child discovery sessions returned by an injected repair provider. Add a Playwright implementation that owns a fresh Chromium context per attempt and reuses WES-186 policy primitives. Extend walkthrough validation with a discriminated discovery-replay mode while keeping approval, capture, CLI, and model reasoning outside this issue.

**Tech Stack:** TypeScript, Node.js crypto and URL APIs, Vitest, Playwright 1.61, npm workspaces, ESLint, Prettier.

---

## Execution Preconditions

- Do not begin product edits until the user selects an execution approach.
- Use a dedicated worktree unless the user explicitly authorizes inline execution.
- Preserve the unstaged WES-188 design, this plan, and project-map edits; do not stage or commit them without authorization.
- Use `rtk` for shell commands and behavior-oriented tests for public results and effects.
- Follow TDD for every behavior task: failing public test, observed RED, minimal implementation, observed GREEN.
- Keep WES-189 host workflow/CLI, WES-191 intake cleanup, WES-190 end-to-end recording acceptance, approval, capture, and project handoff out of scope.
- Commit steps apply to the recommended isolated-worktree flow. Skip only if the selected execution mode explicitly forbids commits.

## File Map

- Create `packages/agent/src/discoveryReplay.ts`: public replay types, artifact/input/policy preflight, deterministic attempt execution, bounded evidence, repair orchestration, lineage checks, compilation, and successful promotion.
- Create `packages/agent/src/discoveryReplay.test.ts`: behavior-first core tests with fake browser factories and repair providers.
- Create `packages/agent/src/playwrightDiscoveryReplay.ts`: fresh Chromium/context lifecycle, bootstrap request protection, policy guard integration, exact accessible matching, runtime-only input actions, assertions, settling, and safe cleanup.
- Create `packages/agent/src/playwrightDiscoveryReplay.test.ts`: deterministic local Playwright fixtures for isolation, ambiguity, runtime inputs, assertions, policy denial, and cleanup.
- Modify `packages/agent/src/walkthroughValidation.ts` and tests: make validation mode a strict dry-run/discovery-replay union and preserve/sanitize replay summaries.
- Modify `packages/agent/src/walkthroughReview.ts` and tests: render replay verification and approval eligibility without leaking repair evidence.
- Modify `packages/agent/src/walkthroughRefinement.ts` and tests: ensure ordinary refinement clears replay validation and cannot retain evidence-backed replay status.
- Modify `packages/agent/src/index.ts`: export the coordinator, browser factory, limits, and public types.
- Modify `packages/agent/package.json`: include both new test files in the agent test command.
- Modify `packages/agent/README.md`, `README.md`, and `packages/agent/src/wrapper-docs.test.ts`: document discovery → compile → replay/repair → review/approval boundaries.
- Modify `docs/linear/auto-demo-project-structure.md`: record approved design, implementation evidence, completion-gate result, and next-task pointer.

### Task 1: Add A Discriminated Discovery-Replay Validation Contract

**Files:**

- Modify: `packages/agent/src/walkthroughValidation.ts`
- Modify: `packages/agent/src/walkthroughValidation.test.ts`
- Modify: `packages/agent/src/walkthroughReview.ts`
- Modify: `packages/agent/src/walkthroughReview.test.ts`

- [ ] **Step 1: Write failing validation-shape tests**

Add tests that accept a strict replay summary and reject missing or stray replay data:

```ts
it("requires replay metadata only for discovery replay validation", () => {
  const discovery = discoveredPlan();
  discovery.state = "validated";
  discovery.validation = {
    status: "ready",
    validatedAt: "2026-07-16T12:00:00.000Z",
    mode: "discovery-replay",
    checks: [],
    blockers: [],
    replay: {
      replayId: "replay-1",
      attempts: 2,
      sourceSessionId: "session-repair-1",
      selectedPathFingerprint: `sha256:${"a".repeat(64)}`,
    },
  };
  expect(isWalkthroughPlan(discovery)).toBe(true);

  const missing = structuredClone(discovery);
  delete (missing.validation as { replay?: unknown }).replay;
  expect(isWalkthroughPlan(missing)).toBe(false);

  const dryRun = structuredClone(discovery);
  dryRun.validation = { ...dryRun.validation, mode: "dry-run" };
  expect(isWalkthroughPlan(dryRun)).toBe(false);
});
```

Add review coverage expecting `Fresh-context replay: passed after 2 attempts` and no serialized repair history.

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/walkthroughValidation.test.ts src/walkthroughReview.test.ts
```

Expected: FAIL because validation mode is fixed to `dry-run` and review has no replay summary.

- [ ] **Step 3: Implement the exact discriminated union**

Replace the current validation object type with:

```ts
type WalkthroughPlanValidationBase = {
  status: WalkthroughPlanValidationStatus;
  validatedAt: string;
  checks: WalkthroughPlanValidationCheck[];
  blockers: WalkthroughPlanValidationBlocker[];
};

export type WalkthroughPlanReplayValidation = WalkthroughPlanValidationBase & {
  mode: "discovery-replay";
  replay: {
    replayId: string;
    attempts: 1 | 2 | 3;
    sourceSessionId: string;
    selectedPathFingerprint: string;
  };
};

export type WalkthroughPlanValidation =
  | (WalkthroughPlanValidationBase & { mode: "dry-run" })
  | WalkthroughPlanReplayValidation;
```

Update `isWalkthroughPlanValidation()` to use exact key allowlists, safe IDs, a 1–3 integer attempt count, and a lowercase SHA-256 fingerprint. Update sanitization to preserve replay metadata only when `mode === "discovery-replay"`.

- [ ] **Step 4: Render the compact replay summary**

Change `WalkthroughPlanReview.validation` to retain the mode and optional replay summary. Append this fixed line only for replay validation:

```ts
if (validation.mode === "discovery-replay") {
  lines.push(`Fresh-context replay: passed after ${validation.replay.attempts} attempt(s).`);
}
```

Do not add failure histories, browser observations, policy data, or runtime values to review output.

- [ ] **Step 5: Run focused tests and verify GREEN**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/walkthroughValidation.test.ts src/walkthroughReview.test.ts
```

Expected: PASS for new replay artifacts and all legacy dry-run artifacts.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/walkthroughValidation.ts packages/agent/src/walkthroughValidation.test.ts packages/agent/src/walkthroughReview.ts packages/agent/src/walkthroughReview.test.ts
git commit -m "feat: add discovery replay validation contract"
```

### Task 2: Define Replay Types And Fail-Closed Preflight

**Files:**

- Create: `packages/agent/src/discoveryReplay.ts`
- Create: `packages/agent/src/discoveryReplay.test.ts`
- Modify: `packages/agent/src/index.ts`

- [ ] **Step 1: Write failing preflight tests**

Create a fake browser factory that counts `create()` calls. Make `compiledFixture()` return `{ sourceSession, plan }` from `discovery-session-completed.json`, then cover invalid artifacts, tampering, inputs, policy, and immutability:

```ts
it("rejects a plan that does not canonically match its source session", async () => {
  const { sourceSession, plan } = await compiledFixture();
  plan.steps[0].public.summary = "Tampered step";

  const result = await replayAndRepairDiscoveryPlan(
    { plan, sourceSession },
    {},
    dependencies(),
  );

  expect(result).toEqual({
    ok: false,
    phase: "preflight",
    attempts: [],
    errors: [{
      code: "plan_source_mismatch",
      message: "Discovery replay plan does not match its compiled source session.",
    }],
  });
  expect(factoryCreates).toBe(0);
});
```

Also assert missing/invalid/secret-like/unexpected binding errors, non-draft or approved plans, invalid `maxRepairs`, undeclared navigation origins, default exact-origin safe policy, and unchanged inputs.

- [ ] **Step 2: Run the new test and verify RED**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/discoveryReplay.test.ts
```

Expected: FAIL because `discoveryReplay.ts` and its exports do not exist.

- [ ] **Step 3: Add exact public constants and boundary types**

Create these limits and discriminated boundaries in `discoveryReplay.ts`:

```ts
export const DISCOVERY_REPLAY_LIMITS = {
  maxRepairs: 2,
  maxAttempts: 3,
  candidates: 5,
  serializedBytes: 256_000,
} as const;

export type DiscoveryReplayMatch = {
  id: string;
  label: string;
  role?: string;
  occurrence?: number;
};

export type DiscoveryReplayBrowser = {
  open(url: string): Promise<void>;
  findMatches(target: WalkthroughPlanTargetHint): Promise<DiscoveryReplayMatch[]>;
  navigate(url: string): Promise<void>;
  click(match: DiscoveryReplayMatch): Promise<void>;
  type(match: DiscoveryReplayMatch, value: string): Promise<void>;
  wait(durationMs: number): Promise<void>;
  waitForSettled(): Promise<void>;
  assertVisible(assertion: Extract<WalkthroughPlanAssertion, { kind: "visible-state" }>): Promise<void>;
  assertNavigation(assertion: Extract<WalkthroughPlanAssertion, { kind: "navigation" }>): Promise<void>;
  inspectPage(): Promise<{ url: string }>;
  close(): Promise<void>;
};

export type DiscoveryReplayBrowserFactory = {
  create(input: { policy: DiscoveryPolicy; attempt: number }): Promise<DiscoveryReplayBrowser>;
};
```

Add the remaining public contracts without arbitrary public strings:

```ts
export type ReplayAndRepairDiscoveryPlanInput = {
  plan: unknown;
  sourceSession: unknown;
  inputBindings?: Record<string, unknown>;
  policy?: DiscoveryPolicy;
};

export type ReplayAndRepairDiscoveryPlanOptions = {
  maxRepairs?: 0 | 1 | 2;
  now?: () => Date;
  replayIdGenerator?: () => string;
};

export type DiscoveryReplayFailureCode =
  | "target_not_found"
  | "ambiguous_target"
  | "navigation_mismatch"
  | "visible_state_mismatch"
  | "navigation_failed"
  | "action_failed"
  | "timing_failure"
  | "policy_blocked"
  | "replay_setup_failed";

export type DiscoveryReplayFailureEvidence = {
  schemaVersion: 1;
  code: DiscoveryReplayFailureCode;
  repairability: "repairable" | "hard-boundary";
  step?: {
    id: string;
    order: number;
    action: WalkthroughPlanStepAction;
    summary: string;
    provenance?: WalkthroughPlanStepProvenance;
  };
  expected?: WalkthroughPlanAssertion | WalkthroughPlanTargetHint;
  observed: { url?: string; candidates?: DiscoveryReplayMatch[] };
  recommendation:
    | "rediscover-target"
    | "rediscover-route"
    | "refresh-expectation"
    | "retry-after-stability"
    | "request-policy-boundary";
};

export type DiscoveryReplayAttempt = {
  attempt: 1 | 2 | 3;
  replayId: string;
  planId: string;
  sourceSessionId: string;
  selectedPathFingerprint: string;
  status: "passed" | "failed";
  checks: WalkthroughPlanValidationCheck[];
  failure?: DiscoveryReplayFailureEvidence;
};

export type DiscoveryReplayStopReason = "manual_review_required" | "repair_declined";

export type DiscoveryPlanRepairProvider = {
  repair(input: {
    repairNumber: 1 | 2;
    parentSession: DiscoverySessionV1;
    failedPlan: WalkthroughPlan;
    failure: DiscoveryReplayFailureEvidence;
  }): Promise<
    | { decision: "repaired"; session: unknown }
    | { decision: "stop"; reason: DiscoveryReplayStopReason }
  >;
};

export type DiscoveryReplayDependencies = {
  browserFactory: DiscoveryReplayBrowserFactory;
  repair?: DiscoveryPlanRepairProvider;
};

export type DiscoveryReplayError = {
  code:
    | "invalid_source_session"
    | "invalid_replay_plan"
    | "invalid_replay_state"
    | "plan_source_mismatch"
    | "invalid_replay_options"
    | "missing_input_binding"
    | "unexpected_input_binding"
    | "invalid_input_binding"
    | "invalid_replay_policy"
    | "replay_navigation_out_of_scope"
    | "repair_provider_failed"
    | "repair_not_available"
    | "repair_limit_reached"
    | "repair_declined"
    | "invalid_repair_session"
    | "repair_lineage_mismatch"
    | "repair_goal_mismatch"
    | "repair_target_out_of_scope"
    | "unchanged_repair_path"
    | "invalid_promoted_plan"
    | "replay_result_limit_exceeded";
  message: string;
  bindingKey?: string;
};

export type DiscoveryReplayResult =
  | {
      ok: true;
      plan: ValidatedWalkthroughPlan;
      sourceSession: DiscoverySessionV1;
      attempts: DiscoveryReplayAttempt[];
      review: WalkthroughPlanReview;
    }
  | {
      ok: false;
      phase: "preflight" | "replay" | "repair";
      plan?: WalkthroughPlan;
      sourceSession?: DiscoverySessionV1;
      attempts: DiscoveryReplayAttempt[];
      errors: DiscoveryReplayError[];
    };
```

Make `options` default to `{}` in the public function signature.

- [ ] **Step 4: Implement preflight without opening a browser**

Implement `prepareReplay()` with this sequence:

```ts
const validatedSession = validateDiscoverySession(input.sourceSession);
if (!validatedSession.ok || validatedSession.session.status !== "completed") {
  return preflightFailure("invalid_source_session", "Discovery replay requires a completed source session.");
}
if (!isWalkthroughPlan(input.plan) || input.plan.source.parser !== "discovery-v1") {
  return preflightFailure("invalid_replay_plan", "Discovery replay requires a valid discovery plan.");
}
if (input.plan.state !== "draft" || input.plan.approvals.approved || input.plan.execution.status !== "not-started") {
  return preflightFailure("invalid_replay_state", "Discovery replay requires a draft unapproved plan.");
}
const compiled = compileDiscoverySessionToWalkthroughPlan(validatedSession.session);
if (!compiled.ok || walkthroughPlanFingerprint(compiled.plan) !== walkthroughPlanFingerprint(input.plan)) {
  return preflightFailure("plan_source_mismatch", "Discovery replay plan does not match its compiled source session.");
}
```

Validate `maxRepairs` as `0 | 1 | 2`. Build a default `{ mode: "safe", allowedOrigins: [new URL(plan.target.url).origin] }` policy or validate the explicit policy. Require every navigation step/assertion origin in the validated policy. Collect unique input bindings, require exact string-valued keys, apply existing bounded text and secret-like checks, and keep values in a runtime-only `PreparedReplay` map.

Return only fixed errors. Never include input values, arbitrary URLs, plan summaries, session goal text, or caught exception messages.

- [ ] **Step 5: Export the public API**

Add an export block in `packages/agent/src/index.ts` for `replayAndRepairDiscoveryPlan`, `DISCOVERY_REPLAY_LIMITS`, and every public replay type. Do not export internal prepared values or sanitizer helpers.

- [ ] **Step 6: Run preflight tests and verify GREEN**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/discoveryReplay.test.ts
```

Expected: PASS and zero fake browser creations for every preflight failure.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/discoveryReplay.ts packages/agent/src/discoveryReplay.test.ts packages/agent/src/index.ts
git commit -m "feat: validate discovery replay requests"
```

### Task 3: Execute One Deterministic Replay And Produce Safe Evidence

**Files:**

- Modify: `packages/agent/src/discoveryReplay.ts`
- Modify: `packages/agent/src/discoveryReplay.test.ts`

- [ ] **Step 1: Write failing single-attempt behavior tests**

Use a fake browser with recorded public calls. Cover success, exact matching, missing/ambiguous occurrences, actual runtime input use, assertion failure, fail-fast behavior, cleanup, and evidence sanitation:

```ts
it("validates a blocker-free replay without approving or capturing", async () => {
  const fixture = await compiledFixtureWithTypeAndAssertions();
  const browser = successfulBrowser();
  const result = await replayAndRepairDiscoveryPlan(
    { ...fixture, inputBindings: { "demo-name": "Demo Person" } },
    { maxRepairs: 0, now: () => new Date("2026-07-16T12:00:00.000Z") },
    dependencies(browser),
  );

  expect(result).toMatchObject({
    ok: true,
    plan: {
      state: "validated",
      approvals: { required: true, approved: false },
      execution: { status: "not-started" },
      validation: { status: "ready", mode: "discovery-replay" },
    },
    attempts: [{ attempt: 1, status: "passed" }],
    review: { approval: { eligible: true, basis: "validated" } },
  });
  expect(browser.typedValues).toEqual(["Demo Person"]);
  expect(JSON.stringify(result)).not.toContain("Demo Person");
  expect(browser.closeCalls).toBe(1);
});
```

For a missing target, assert `failure.step.provenance`, at most five sanitized candidates, no later calls, and one close. For browser setup failure, assert no `step` field.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/discoveryReplay.test.ts
```

Expected: FAIL because the coordinator does not execute replay steps or promote success.

- [ ] **Step 3: Add fixed browser errors and deterministic matching**

Define an exported error class with fixed codes:

```ts
export class DiscoveryReplayBrowserError extends Error {
  constructor(readonly code: DiscoveryReplayBrowserErrorCode) {
    super(code);
    this.name = "DiscoveryReplayBrowserError";
  }
}
```

Define `DiscoveryReplayBrowserErrorCode` as the `DiscoveryReplayFailureCode` union plus `"candidate_not_found"` and `"browser_closed"`; map the two internal lifecycle codes to fixed `action_failed` or setup results before returning public evidence.

Implement `requireReplayMatch()` so zero matches yields `target_not_found`, multiple matches without an occurrence yield `ambiguous_target`, and an occurrence selects exactly that one-based visible match. Sanitize and cap returned candidates before adding them to evidence.

- [ ] **Step 4: Implement fail-fast step execution**

Implement `runReplayAttempt()` as a single ordered loop. Use the real binding only in the browser call:

```ts
for (const step of plan.steps) {
  try {
    if (step.action === "navigate") await browser.navigate(step.navigationUrl!);
    if (step.action === "click") await browser.click(await requireReplayMatch(browser, step));
    if (step.action === "type") {
      await browser.type(await requireReplayMatch(browser, step), bindings[step.inputBinding!]!);
    }
    if (step.action === "wait") await browser.wait(step.waitDurationMs!);
    if (step.action === "assert" && step.assertion?.kind === "visible-state") {
      await browser.assertVisible(step.assertion);
    }
    if (step.action === "assert" && step.assertion?.kind === "navigation") {
      await browser.assertNavigation(step.assertion);
    }
    if (step.action !== "assert") await browser.waitForSettled();
    checks.push(passedReplayCheck(step));
  } catch (error) {
    return failedAttempt(plan, step, checks, browser, error);
  }
}
```

Reject question, unresolved, or structurally incomplete steps in preflight rather than relying on non-null assertions at runtime. Close the browser in one coordinator `finally` block.

- [ ] **Step 5: Promote success through existing lifecycle functions**

On success, sanitize/clone the plan, attach `mode: "discovery-replay"`, `status: "ready"`, compact replay metadata, passed checks, and no blockers. Set state to `validated`, reset approval/execution, validate the resulting artifact with `isWalkthroughPlan()`, and call `reviewWalkthroughPlan()`. Return fixed `invalid_promoted_plan` if either public boundary rejects it.

- [ ] **Step 6: Run the core tests and verify GREEN**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/discoveryReplay.test.ts src/walkthroughValidation.test.ts src/walkthroughReview.test.ts
```

Expected: PASS with fail-fast evidence, no serialized runtime values, and all browser instances closed.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/discoveryReplay.ts packages/agent/src/discoveryReplay.test.ts
git commit -m "feat: replay compiled discovery plans"
```

### Task 4: Add The Bounded Host Repair Loop

**Files:**

- Modify: `packages/agent/src/discoveryReplay.ts`
- Modify: `packages/agent/src/discoveryReplay.test.ts`

- [ ] **Step 1: Write failing repair and lineage tests**

Cover a second-attempt success, a third-attempt success, exhausted repairs, host stop, no provider, hard boundaries, and malformed lineage:

```ts
it("recompiles one completed child session before a fresh second replay", async () => {
  const root = await compiledFixture();
  const child = await completedChildFixture(root.sourceSession, "session-repair-1");
  const browsers = [missingTargetBrowser(), successfulBrowser()];
  const repair = vi.fn().mockResolvedValue({ decision: "repaired", session: child });

  const result = await replayAndRepairDiscoveryPlan(root, {}, {
    browserFactory: sequentialFactory(browsers),
    repair: { repair },
  });

  expect(result).toMatchObject({
    ok: true,
    sourceSession: { id: "session-repair-1", parentSessionId: root.sourceSession.id },
    attempts: [{ status: "failed" }, { status: "passed" }],
    plan: { validation: { replay: { attempts: 2 } } },
  });
  expect(repair).toHaveBeenCalledWith(expect.objectContaining({
    repairNumber: 1,
    parentSession: expect.objectContaining({ id: root.sourceSession.id }),
    failure: expect.objectContaining({ repairability: "repairable" }),
  }));
});
```

Reject active/failed children, wrong or skipped parents, repeated IDs, unchanged selected-path fingerprints, changed goals, out-of-policy targets, malformed sessions, and a fourth attempt. Assert repair is never called for policy, input, or setup hard boundaries.

- [ ] **Step 2: Run the repair tests and verify RED**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/discoveryReplay.test.ts
```

Expected: FAIL because only one attempt is supported.

- [ ] **Step 3: Implement repair classification and provider calls**

Use a fixed repairability table:

```ts
const REPAIRABLE_FAILURES = new Set<DiscoveryReplayFailureCode>([
  "target_not_found",
  "ambiguous_target",
  "navigation_mismatch",
  "visible_state_mismatch",
  "navigation_failed",
  "action_failed",
  "timing_failure",
]);
```

Never call the provider for invalid artifacts, missing/invalid inputs, setup failures, secret-like values, policy denials, or invalid repair output. Catch provider exceptions and return `repair_provider_failed` without exposing the exception.

- [ ] **Step 4: Validate a strict linear child and recompile it**

Implement `prepareRepair()` with these exact gates:

```ts
const validated = validateDiscoverySession(value);
if (!validated.ok || validated.session.status !== "completed") return invalidRepair();
if (validated.session.parentSessionId !== parent.id || validated.session.id === parent.id) {
  return invalidRepair("repair_lineage_mismatch");
}
if (validated.session.goal !== root.goal) return invalidRepair("repair_goal_mismatch");
if (!policyAllowsUrl(policy, validated.session.target.startUrl)) {
  return invalidRepair("repair_target_out_of_scope");
}
const compiled = compileDiscoverySessionToWalkthroughPlan(validated.session);
if (!compiled.ok || compiled.plan.source.parser !== "discovery-v1") return invalidRepair();
if (compiled.plan.source.discovery.selectedPathFingerprint === currentFingerprint) {
  return invalidRepair("unchanged_repair_path");
}
```

Carry the child/compiled pair into the next loop iteration. Retain only the bounded attempt records; never merge discovery sessions or mutate any input artifact.

- [ ] **Step 5: Enforce attempt and serialized-result limits**

Loop from attempt 1 through `maxRepairs + 1`, cap candidates at five, and check the final serialized result against `DISCOVERY_REPLAY_LIMITS.serializedBytes`. If the cap is exceeded, return the fixed `replay_result_limit_exceeded` error with no partial arbitrary content.

- [ ] **Step 6: Run repair tests and verify GREEN**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/discoveryReplay.test.ts
```

Expected: PASS for one/two repairs, every lineage rejection, hard-boundary behavior, and the three-attempt maximum.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/discoveryReplay.ts packages/agent/src/discoveryReplay.test.ts
git commit -m "feat: bound discovery plan repair loops"
```

### Task 5: Implement Fresh Policy-Enforced Playwright Replay

**Files:**

- Create: `packages/agent/src/playwrightDiscoveryReplay.ts`
- Create: `packages/agent/src/playwrightDiscoveryReplay.test.ts`
- Modify: `packages/agent/src/index.ts`

- [ ] **Step 1: Write failing local-browser behavior tests**

Use local route fixtures, not public websites. Cover two factory creations producing distinct contexts, exact role/name/occurrence matching, input-dependent visible state, exact and same-origin-path assertions, ambiguity, missing targets, safe mutation denial, newly acknowledged disposable mutation, out-of-origin redirects, WebSockets, downloads, popups, and cleanup.

```ts
it("types runtime demo input and verifies the resulting visible state", async () => {
  const factory = createPlaywrightDiscoveryReplayBrowserFactory();
  const browser = await factory.create({
    policy: { mode: "safe", allowedOrigins: [origin] },
    attempt: 1,
  });
  await browser.open(`${origin}/form`);
  const [field] = await browser.findMatches({ kind: "accessible", label: "Demo name", role: "textbox" });
  await browser.type(field!, "Demo Person");
  await browser.waitForSettled();
  await expect(browser.assertVisible({
    kind: "visible-state",
    condition: "Welcome Demo Person",
    role: "heading",
  })).resolves.toBeUndefined();
  await browser.close();
});
```

Assert public errors contain only fixed codes and never response bodies, DOM text outside bounded candidates, runtime values, or exception messages.

- [ ] **Step 2: Run the Playwright test and verify RED**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/playwrightDiscoveryReplay.test.ts
```

Expected: FAIL because the Playwright replay factory does not exist.

- [ ] **Step 3: Protect initial navigation before installing the full guard**

Create Chromium with `serviceWorkers: "block"`. Before `page.goto()`, install temporary context route and WebSocket handlers that allow only GET/HEAD/OPTIONS to declared exact origins and block downloads/popups. Navigate to the target, then remove the bootstrap handlers and install `installPlaywrightDiscoveryPolicyGuard(page, validatedPolicy)`.

The initial bootstrap must reject credential-like URLs, unsafe schemes, undeclared redirect origins, non-idempotent requests, WebSockets, downloads, and popups with fixed `policy_blocked` or `navigation_failed` errors. Cleanup must remove partially installed handlers even when initial navigation fails.

- [ ] **Step 4: Implement accessible matching and runtime-only candidate storage**

Use the existing execution matching order: explicit role/name first; otherwise label, button role/name, then exact visible text. Store locators and runtime risk only in a private `Map<string, Candidate>`. Return bounded public matches:

```ts
type Candidate = DiscoveryReplayMatch & {
  locator: Locator;
  target: DiscoveryInteractiveTarget;
  risk: DiscoveryRuntimeTargetRisk;
};
```

Candidate IDs are attempt-local (`candidate-1`, etc.). In the same focused module, infer credential risk from password type and username/password/one-time-code autocomplete tokens, payment risk from the existing `cc-*` autocomplete allowlist, upload risk from file inputs, and potentially-mutating risk from submit controls inside forms. Keep these rules aligned with `playwrightDiscoveryPage.ts`, cover them through public policy outcomes, and never serialize the runtime risk.

- [ ] **Step 5: Authorize and guard every action**

For navigate/click/type, map the plan operation to a `DiscoveryAction`, call `authorizeDiscoveryPolicyAction()`, and throw the fixed policy code when blocked. For allowed actions, arm the WES-186 guard, execute exactly once, call `finishAction()`, and convert any violation to `DiscoveryReplayBrowserError("policy_blocked")`. Reject missing, stale, or disabled candidates. Reject secret-like type values before arming the guard.

Implement waits and assertions with the current bounded Playwright readiness and sanitized URL comparison behavior. `close()` disposes the guard, context, and browser idempotently; it retries guard cleanup only through the existing safe cleanup contract and never leaves an owned process running.

- [ ] **Step 6: Export the factory**

Export:

```ts
export function createPlaywrightDiscoveryReplayBrowserFactory(
  options: PlaywrightDiscoveryReplayOptions = {},
): DiscoveryReplayBrowserFactory;
```

Options contain only viewport, action timeout, and stability duration. Policy and attempt arrive through `factory.create()`.

- [ ] **Step 7: Run Playwright and policy regressions and verify GREEN**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/playwrightDiscoveryReplay.test.ts src/playwrightDiscoveryPolicyGuard.test.ts src/playwrightPolicyDiscoveryRehearsal.test.ts
```

Expected: PASS for fresh isolation, matching, runtime input, assertions, all policy boundaries, and cleanup.

- [ ] **Step 8: Commit**

```bash
git add packages/agent/src/playwrightDiscoveryReplay.ts packages/agent/src/playwrightDiscoveryReplay.test.ts packages/agent/src/index.ts
git commit -m "feat: replay discovery plans in fresh browsers"
```

### Task 6: Preserve Refinement, Approval, And Package Test Contracts

**Files:**

- Modify: `packages/agent/src/walkthroughRefinement.ts`
- Modify: `packages/agent/src/walkthroughRefinement.test.ts`
- Modify: `packages/agent/src/walkthroughApproval.test.ts`
- Modify: `packages/agent/package.json`

- [ ] **Step 1: Write failing lifecycle regressions**

Add tests proving:

```ts
it("clears discovery replay validation after manual refinement", async () => {
  const replayed = validatedDiscoveryReplayPlan();
  const result = await refineWalkthroughPlan(replayed, [candidateSelection()], {}, deps);
  expect(result.ok && result.plan).toMatchObject({
    state: "draft",
    approvals: { required: true, approved: false },
    execution: { status: "not-started" },
  });
  expect(result.ok && result.plan.validation).toBeUndefined();
});
```

Add approval fingerprint coverage: approving a replay-validated plan succeeds, then changing replay ID, attempt count, source session ID, selected-path fingerprint, or a replay check produces `stale_approval`.

- [ ] **Step 2: Run lifecycle tests and verify RED**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/walkthroughRefinement.test.ts src/walkthroughApproval.test.ts
```

Expected: at least the refinement regression FAILS because validate-first refinement currently immediately runs ordinary dry-run validation.

- [ ] **Step 3: Clear evidence-backed replay state on direct refinement**

After applying and sanitizing refinements, detect whether the input validation mode was `discovery-replay`. Clear validation, approval, and execution and return a draft review without automatically invoking ordinary validation. Existing deterministic and dry-run refinement behavior stays unchanged.

Do not rewrite discovery provenance or source metadata to make a manually edited plan appear canonically compiled. WES-188 automatic repairs remain child-session/recompile only.

- [ ] **Step 4: Confirm approval fingerprint coverage**

The existing `walkthroughPlanFingerprint()` includes `validation`; retain that behavior and add only the regression tests. Do not add a second replay fingerprint or approval bypass.

- [ ] **Step 5: Add new tests to the package command**

Append `src/discoveryReplay.test.ts` and `src/playwrightDiscoveryReplay.test.ts` to `packages/agent/package.json`'s `test` script, preserving every existing test file.

- [ ] **Step 6: Run the complete agent suite and verify GREEN**

```bash
rtk npm --workspace @auto-demo/agent test
rtk npm --workspace @auto-demo/agent run typecheck
```

Expected: every agent test and the agent typecheck PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/walkthroughRefinement.ts packages/agent/src/walkthroughRefinement.test.ts packages/agent/src/walkthroughApproval.test.ts packages/agent/package.json
git commit -m "feat: preserve replay lifecycle boundaries"
```

### Task 7: Document The Host-Owned Replay And Repair Handoff

**Files:**

- Modify: `packages/agent/README.md`
- Modify: `README.md`
- Modify: `packages/agent/src/wrapper-docs.test.ts`
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Write a failing documentation contract test**

Add exact boundary assertions:

```ts
expect(agentReadme).toContain("replayAndRepairDiscoveryPlan");
expect(agentReadme).toContain("fresh browser context");
expect(agentReadme).toContain("at most two repairs");
expect(agentReadme).toContain("completed child discovery session");
expect(agentReadme).toContain("does not approve or start capture");
expect(rootReadme).toContain("deterministic fresh-context replay");
```

- [ ] **Step 2: Run the docs test and verify RED**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/wrapper-docs.test.ts
```

Expected: FAIL because WES-188 is documented as downstream.

- [ ] **Step 3: Add the package example and boundary text**

Document a host repair provider without embedding a model:

```ts
const replayed = await replayAndRepairDiscoveryPlan(
  { plan: compiled.plan, sourceSession: completedSession, inputBindings },
  {},
  {
    browserFactory: createPlaywrightDiscoveryReplayBrowserFactory(),
    repair: {
      async repair({ parentSession, failure }) {
        return hostRepairDiscovery(parentSession, failure);
      },
    },
  },
);
```

Explain fresh browser ownership, safe exact-origin default, explicit replay policy, runtime-only inputs, provenance-linked evidence, two-repair maximum, strict child lineage, review eligibility, and no approval/capture. Label `hostRepairDiscovery()` as host application code, not an `@auto-demo/agent` export.

- [ ] **Step 4: Update root orientation and project map**

Update root workflow text from “WES-188 owns replay” to the implemented library boundary and identify WES-189 as the next host integration. Add implementation/verification evidence to the project map only when it exists; do not claim completion from design or plan artifacts.

- [ ] **Step 5: Run docs and focused replay tests**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/wrapper-docs.test.ts src/discoveryReplay.test.ts src/playwrightDiscoveryReplay.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/README.md README.md packages/agent/src/wrapper-docs.test.ts docs/linear/auto-demo-project-structure.md
git commit -m "docs: explain discovery replay and repair"
```

### Task 8: Review, Verify, And Run The Completion Gate

**Files:**

- Modify as findings require: WES-188 implementation and behavior tests only
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Request focused code review**

Use `superpowers:requesting-code-review`. Check canonical plan/session validation, browser freshness, initial-navigation protection, policy permit lifecycle, target ambiguity/occurrence semantics, runtime-value leakage, failure-evidence bounds, repairability classification, child lineage, retry off-by-one errors, cleanup on every exit, validation/approval fingerprinting, and implementation-detail tests. Add behavior-first regression tests for accepted findings.

- [ ] **Step 2: Run package verification**

```bash
rtk npm --workspace @auto-demo/agent test
rtk npm --workspace @auto-demo/agent run typecheck
rtk npm --workspace @auto-demo/agent run build
```

Expected: every command PASS.

- [ ] **Step 3: Run repository verification**

```bash
rtk npm run build
rtk npm run typecheck
rtk npm run lint
rtk npm test
rtk npm run format:check
rtk git diff --check
```

Expected: build, all workspace typechecks, ESLint, all tests, repository Prettier, and diff checks PASS. If a preserved unrelated failure appears, report its exact command and file without modifying unrelated work.

- [ ] **Step 4: Run `linear-sync-gate` in `completion-gate` mode**

Provide repository path `/Users/weston.bushyeager/code/personal/auto-demo`, project map `docs/linear/auto-demo-project-structure.md`, project `Auto Demo Balanced MVP`, active issue WES-188, implementation summary, exact review/test evidence, and nearby WES-182/WES-189/WES-191/WES-190 state. Apply only clear writes. Do not mark WES-188 Done from local-only evidence; require durable integration and passing CI or explicitly report the durability blocker.

- [ ] **Step 5: Record completion evidence and next-task scope**

Update the project map with implemented public behavior, verification counts, review findings, commit/PR/CI evidence, Linear writes, and the next-task pointer. WES-189 becomes dependency-ready only after WES-188 is durably integrated and Done.

- [ ] **Step 6: Commit the completion sync when authorized**

```bash
git add docs/linear/auto-demo-project-structure.md
git commit -m "docs: complete WES-188 project sync"
```

Expected: Linear, durable repository evidence, the project map, and the WES-189 pointer agree.
