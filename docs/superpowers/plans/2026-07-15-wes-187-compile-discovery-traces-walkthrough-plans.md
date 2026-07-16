# WES-187 Compile Discovery Traces Into Walkthrough Plans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile a validated completed `DiscoverySessionV1` selected path into a deterministic draft, validate-first, unapproved `WalkthroughPlan` with executable actions, structured assertions, bounded provenance, and transcript-safe errors.

**Architecture:** Add a pure compiler module in `@auto-demo/agent` that consumes only the sanitized artifact returned by `validateDiscoverySession()`. Extend the existing walkthrough contract with a discovery source variant, structured assertions, and bounded step provenance, then carry those fields through validation, review, refinement, approval fingerprints, and final execution. Keep fresh-context replay and repair in WES-188 and preserve legacy deterministic artifacts.

**Tech Stack:** TypeScript, Node.js crypto, Vitest, Playwright 1.61, npm workspaces, ESLint, Prettier.

---

## Execution Preconditions

- Do not begin product edits until the user selects an execution approach.
- Use a dedicated worktree unless the user explicitly authorizes inline execution.
- Preserve the unstaged design spec and project-map edits; do not stage or commit them without authorization.
- Use `rtk` for shell commands and behavior-oriented tests for public results and effects.
- Keep WES-188 replay/repair, WES-189 host workflow, WES-191 cleanup, discovery CLI work, approval, and final capture orchestration out of scope.
- Commit steps apply to the recommended isolated-worktree flow. Skip only those steps if the user selects an execution mode that forbids commits.

## File Map

- Create `packages/agent/src/discoveryPlanCompiler.ts`: validate untrusted discovery input, compile selected actions/expectations, generate stable identities, and return safe errors.
- Create `packages/agent/src/discoveryPlanCompiler.test.ts`: compiler behavior, normalization, determinism, failure, immutability, and transcript-safety coverage.
- Modify `packages/agent/src/index.ts`: public source, assertion, provenance, and compiler types/exports.
- Modify `packages/agent/src/walkthroughValidation.ts` and tests: validate, sanitize, preserve, and validate the new plan fields.
- Modify `packages/agent/src/walkthroughApproval.ts` and tests: fingerprint assertions and provenance.
- Modify `packages/agent/src/walkthroughReview.ts` and tests: identify discovery plans and render safe summaries.
- Modify `packages/agent/src/walkthroughRefinement.ts` and tests: preserve provenance for candidate selection and clear it for replacement.
- Modify `packages/agent/src/walkthroughExecution.ts` and tests: execute navigation assertions and reuse runtime bindings.
- Modify `packages/capture/src/index.ts`, `playwrightExecutionController.ts`, and tests: expose and implement URL assertions.
- Modify `packages/capture/src/playwrightMetadataRecorder.test.ts` and `packages/cli/src/agentExecuteCommand.test.ts`: keep controller fixtures structurally current.
- Modify `packages/agent/package.json`, `packages/agent/README.md`, `README.md`, wrapper docs tests, and the Linear project map.

### Task 1: Extend The Walkthrough Artifact Contract

**Files:**

- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/src/walkthroughValidation.ts`
- Modify: `packages/agent/src/walkthroughValidation.test.ts`

- [ ] **Step 1: Write failing contract tests**

Add tests proving discovery source, structured assertions, and provenance are accepted only in consistent shapes:

```ts
it("accepts bounded discovery source, assertion, and provenance", () => {
  const discovered = plan("Verify Results.");
  discovered.source = {
    parser: "discovery-v1",
    script: "Verify Results.",
    discovery: {
      schemaVersion: 1,
      sessionId: "session-1",
      selectedPathFingerprint: `sha256:${"a".repeat(64)}`,
    },
  };
  discovered.steps[0] = {
    ...discovered.steps[0],
    assertion: { kind: "visible-state", condition: "Results", role: "heading" },
    targetHint: { kind: "accessible", label: "Results", role: "heading" },
    provenance: {
      kind: "discovery",
      sessionId: "session-1",
      attemptId: "attempt-1",
      expectationId: "expectation-1",
      expectationOrigin: "declared-before-action",
    },
  };
  expect(isWalkthroughPlan(discovered)).toBe(true);

  const invalid = structuredClone(discovered);
  invalid.steps[0].action = "click";
  expect(isWalkthroughPlan(invalid)).toBe(false);
});
```

Add a navigation assertion test with no target hint and rejection tests for malformed fingerprints, provenance IDs, and assertion/action mismatches.

- [ ] **Step 2: Run the test and verify RED**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/walkthroughValidation.test.ts
```

Expected: FAIL because the public types and validators do not support the fields.

- [ ] **Step 3: Add exact public types in `index.ts`**

```ts
export type WalkthroughPlanSource =
  | { parser: "deterministic-v1"; script: string }
  | {
      parser: "discovery-v1";
      script: string;
      discovery: { schemaVersion: 1; sessionId: string; selectedPathFingerprint: string };
    };

export type WalkthroughPlanAssertion =
  | { kind: "navigation"; url: string; match: "exact-url" | "same-origin-path" }
  | { kind: "visible-state"; condition: string; role?: string; occurrence?: number };

export type WalkthroughPlanStepProvenance = {
  kind: "discovery";
  sessionId: string;
  attemptId: string;
  expectationId?: string;
  expectationOrigin?: DiscoveryExpectationOrigin;
  normalizedFrom?: "inspect" | "back" | "refresh";
};
```

Add `assertion?: WalkthroughPlanAssertion` and `provenance?: WalkthroughPlanStepProvenance` to `WalkthroughPlanStep`, and replace the inline source type with `WalkthroughPlanSource`.

- [ ] **Step 4: Validate and sanitize the new fields**

Implement strict source/assertion/provenance guards with exact allowlists. Require `sha256:` plus 64 lowercase hex characters; require navigation assertions to have safe HTTP(S) URLs and no target hint; require visible assertions to have bounded conditions, optional positive occurrences, and a target hint whose label/role/occurrence equals the assertion; forbid assertion payloads on non-assert steps.

Update `sanitizePlan()` so it preserves the source discriminator and allowlisted discovery metadata instead of forcing `deterministic-v1`. Copy sanitized assertion and provenance fields. Legacy deterministic assertion steps without `assertion` remain valid.

- [ ] **Step 5: Run focused tests and verify GREEN**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/walkthroughValidation.test.ts
```

Expected: PASS, including legacy artifacts.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/index.ts packages/agent/src/walkthroughValidation.ts packages/agent/src/walkthroughValidation.test.ts
git commit -m "feat: extend walkthrough plan evidence contract"
```

### Task 2: Compile Selected Discovery Actions

**Files:**

- Create: `packages/agent/src/discoveryPlanCompiler.ts`
- Create: `packages/agent/src/discoveryPlanCompiler.test.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/package.json`

- [ ] **Step 1: Write failing public compiler tests**

Load the completed and abandoned-attempt fixtures and add a test builder for navigate/click/type/wait routes:

```ts
it("compiles only the selected path into a draft unapproved plan", async () => {
  const session = await readFixture("discovery-session-with-abandoned-attempts.json");
  const original = structuredClone(session);
  const result = compileDiscoverySessionToWalkthroughPlan(session);

  expect(result).toMatchObject({
    ok: true,
    plan: {
      mode: "validate-first",
      state: "draft",
      source: { parser: "discovery-v1" },
      questions: [],
      approvals: { required: true, approved: false },
      execution: { status: "not-started" },
    },
  });
  expect(result.ok && result.plan.validation).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain("abandoned-attempt");
  expect(session).toEqual(original);
});
```

Assert opaque target IDs become accessible hints, type steps contain binding names but no values, and the first selected before-observation supplies the plan target.

- [ ] **Step 2: Run the compiler test and verify RED**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/discoveryPlanCompiler.test.ts
```

Expected: FAIL because the compiler does not exist.

- [ ] **Step 3: Define the compiler result API**

Create the exact fixed error union and non-throwing public boundary:

```ts
export type DiscoveryPlanCompilationErrorCode =
  | "invalid_discovery_session"
  | "incomplete_discovery_session"
  | "missing_selected_path"
  | "missing_compilation_reference"
  | "unsupported_compilation_action"
  | "unsafe_compilation_content"
  | "invalid_compiled_plan";

export type DiscoveryPlanCompilationError = {
  code: DiscoveryPlanCompilationErrorCode;
  message: string;
  attemptId?: string;
  expectationId?: string;
};

export type CompileDiscoverySessionOptions = { mode?: "validate-first" };

export type CompileDiscoverySessionResult =
  { ok: true; plan: WalkthroughPlan } | { ok: false; errors: DiscoveryPlanCompilationError[] };

export function compileDiscoverySessionToWalkthroughPlan(
  value: unknown,
  options: CompileDiscoverySessionOptions = {},
): CompileDiscoverySessionResult {
  if (options.mode !== undefined && options.mode !== "validate-first")
    return failure("invalid_compiled_plan", "Discovery plans require validate-first mode.");
  const validated = validateDiscoverySession(value);
  if (!validated.ok)
    return failure(
      "invalid_discovery_session",
      "Discovery plan compilation requires a valid session.",
    );
  try {
    return compileValidatedSession(validated.session);
  } catch {
    return failure("invalid_compiled_plan", "Discovery plan compilation failed safely.");
  }
}
```

Export the function and all public compiler/types from `index.ts`; add the new test file to the package's explicit Vitest list.

- [ ] **Step 4: Implement preconditions and action mapping**

Require `status: "completed"`, a completed terminal, and a non-empty selected path. Resolve selected attempts and observations through maps and fail with fixed errors rather than non-null assertions.

Map actions exhaustively: navigate to its action URL; click/type to accessible hints from the before-observation; type copies only `inputBinding`; wait copies duration; back/refresh navigate to the after-observation URL and record `normalizedFrom`; inspect emits no action. Every action step records safe session/attempt provenance.

- [ ] **Step 5: Add canonical identities and validate the output**

Use a recursive key-sorting canonicalizer and SHA-256:

```ts
function sha256(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")}`;
}
```

Fingerprint only selected allowlisted evidence, explicitly excluding timestamps, screenshots, confidence notes, outcome summaries, and unselected records. Build `plan-<12 hex>` from target, mode, final ordered steps, assertions, and provenance. Assign `step-1`, `step-2`, and so on after expansion. Generate source text from fixed sanitized public templates. Call `isWalkthroughPlan()` before returning.

- [ ] **Step 6: Run compiler and contract tests**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/discoveryPlanCompiler.test.ts src/walkthroughValidation.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/discoveryPlanCompiler.ts packages/agent/src/discoveryPlanCompiler.test.ts packages/agent/src/index.ts packages/agent/package.json
git commit -m "feat: compile selected discovery actions"
```

### Task 3: Compile Expectations And Normalize Discovery-Only Actions

**Files:**

- Modify: `packages/agent/src/discoveryPlanCompiler.ts`
- Modify: `packages/agent/src/discoveryPlanCompiler.test.ts`

- [ ] **Step 1: Write failing expectation and normalization tests**

```ts
it("turns matched expectations into ordered structured assertions", () => {
  const result = compileDiscoverySessionToWalkthroughPlan(sessionWithExpectations());
  expect(result.ok && result.plan.steps).toMatchObject([
    { action: "click" },
    {
      action: "assert",
      assertion: {
        kind: "navigation",
        url: "https://example.com/results",
        match: "same-origin-path",
      },
      provenance: { expectationOrigin: "declared-before-action" },
    },
    {
      action: "assert",
      assertion: { kind: "visible-state", condition: "Results", role: "heading" },
      targetHint: { kind: "accessible", label: "Results", role: "heading" },
      provenance: { expectationOrigin: "derived-from-observation" },
    },
  ]);
});
```

Add a route containing inspect/back/refresh and expect assertion-only inspect plus navigate normalization and exactly one fixed `normalized_discovery_action` warning.

- [ ] **Step 2: Run the test and verify RED**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/discoveryPlanCompiler.test.ts
```

Expected: FAIL because expectations are not expanded.

- [ ] **Step 3: Implement expectation compilation**

For every selected attempt, combine declared then derived expectations in stored order. Require exactly one matched effect against the after-observation. Navigation expectations become navigation assertions. Visible target IDs resolve against after-observation visible states or interactive targets; public conditions become safe visible assertions directly. Add expectation ID/origin provenance and `normalizedFrom: "inspect"` where applicable. Never use observed-effect summaries as assertion content.

- [ ] **Step 4: Add failure, determinism, and privacy coverage**

Test active/failed/abandoned/completed-without-selection inputs, missing references, malformed future actions, repeated compilation equality, input immutability, and secret-like content in discarded evidence. Expected errors contain only fixed messages and safe IDs.

- [ ] **Step 5: Run the compiler suite and verify GREEN**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/discoveryPlanCompiler.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/discoveryPlanCompiler.ts packages/agent/src/discoveryPlanCompiler.test.ts
git commit -m "feat: compile discovery expectations"
```

### Task 4: Preserve Evidence Through Review, Refinement, And Approval

**Files:**

- Modify: `packages/agent/src/walkthroughApproval.ts`
- Modify: `packages/agent/src/walkthroughApproval.test.ts`
- Modify: `packages/agent/src/walkthroughReview.ts`
- Modify: `packages/agent/src/walkthroughReview.test.ts`
- Modify: `packages/agent/src/walkthroughRefinement.ts`
- Modify: `packages/agent/src/walkthroughRefinement.test.ts`

- [ ] **Step 1: Write failing approval fingerprint tests**

Approve a validated discovery plan, then separately mutate its assertion URL and provenance expectation ID:

```ts
for (const mutate of [
  (plan: WalkthroughPlan) => {
    const assertion = plan.steps[1].assertion;
    if (assertion?.kind === "navigation") assertion.url = "https://example.com/changed";
  },
  (plan: WalkthroughPlan) => {
    if (plan.steps[1].provenance) plan.steps[1].provenance.expectationId = "changed-id";
  },
]) {
  const changed = structuredClone(approved.plan);
  mutate(changed);
  expect(verifyWalkthroughPlanApproval(changed)).toMatchObject({
    ok: false,
    errors: [{ code: "stale_approval" }],
  });
}
```

- [ ] **Step 2: Run approval tests and verify RED**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/walkthroughApproval.test.ts
```

Expected: FAIL because the new fields are not fingerprinted.

- [ ] **Step 3: Fingerprint the new execution-relevant fields**

Add these keys to the canonical step projection:

```ts
assertion: step.assertion ?? null,
provenance: step.provenance ?? null,
```

Restrict the legacy fallback to plans without structured execution data, assertions, or provenance. Continue excluding `source.script`.

Also assert that `approveWalkthroughPlan()` rejects the draft discovery plan before replay validation, even though all compiled steps are resolved.

- [ ] **Step 4: Add safe review behavior**

Test and implement `source: WalkthroughPlan["source"]["parser"]` on `WalkthroughPlanReview`. Include `Source: discovery-v1` and public assertion summaries in the review, but never session IDs, evidence fingerprints, attempt IDs, expectation IDs, or source script.

```ts
expect(reviewWalkthroughPlan(discovered)).toMatchObject({
  ok: true,
  review: {
    source: "discovery-v1",
    approval: { eligible: false, reason: "Validate and resolve the plan before approval." },
  },
});
```

- [ ] **Step 5: Make refinement provenance behavior explicit**

Write tests proving candidate selection preserves existing provenance while `replace-step` removes old and caller-supplied provenance. Implement that rule in `applyRefinement()` before sanitization. Both paths continue clearing old validation, approval, and execution evidence.

- [ ] **Step 6: Run lifecycle integration tests**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/walkthroughApproval.test.ts src/walkthroughReview.test.ts src/walkthroughRefinement.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/walkthroughApproval.ts packages/agent/src/walkthroughApproval.test.ts packages/agent/src/walkthroughReview.ts packages/agent/src/walkthroughReview.test.ts packages/agent/src/walkthroughRefinement.ts packages/agent/src/walkthroughRefinement.test.ts
git commit -m "feat: preserve discovery plan evidence"
```

### Task 5: Validate And Execute Structured Assertions

**Files:**

- Modify: `packages/agent/src/walkthroughValidation.ts`
- Modify: `packages/agent/src/walkthroughValidation.test.ts`
- Modify: `packages/agent/src/walkthroughExecution.ts`
- Modify: `packages/agent/src/walkthroughExecution.test.ts`
- Modify: `packages/capture/src/index.ts`
- Modify: `packages/capture/src/playwrightExecutionController.ts`
- Modify: `packages/capture/src/playwrightExecutionController.test.ts`
- Modify: `packages/capture/src/playwrightMetadataRecorder.test.ts`
- Modify: `packages/cli/src/agentExecuteCommand.test.ts`

- [ ] **Step 1: Write failing validation tests for both assertion kinds**

Build a discovery plan with a navigation assertion and a visible assertion. Expect the matching plan to validate and an exact-URL mismatch to create an `unexpected_navigation` blocker without clicking or navigating.

```ts
expect(result).toMatchObject({
  ok: true,
  plan: { state: "validated", validation: { status: "ready" } },
});
```

- [ ] **Step 2: Run validation tests and verify RED**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/walkthroughValidation.test.ts
```

Expected: FAIL because navigation assertions fall through to element matching.

- [ ] **Step 3: Implement assertion validation**

Before `findMatches()` in `validateStep()`:

```ts
if (step.action === "assert" && step.assertion?.kind === "navigation") {
  const current = await browser.inspectPage();
  return matchesWalkthroughNavigationAssertion(step.assertion, current.url)
    ? { ok: true }
    : {
        ok: false,
        reason: "unexpected_navigation",
        question: `Why did ${safeSummary(step)} reach an unexpected destination?`,
      };
}
```

Implement exact sanitized URL and same-origin-path comparison in a pure helper. Visible assertions continue through accessible matching and do not mutate the page.

- [ ] **Step 4: Write failing execution tests**

Add `assertNavigation()` to the test browser action log. Create an approved plan with one URL assertion and two type steps referencing `demo-query`; supply the binding once. Expect one URL assertion and two type actions with the same value.

```ts
expect(actions).toContain("assert-navigation:https://example.com/results:same-origin-path");
expect(actions.filter((value) => value.includes("launch demo"))).toHaveLength(2);
```

- [ ] **Step 5: Extend agent and capture browser interfaces**

Add this method to `WalkthroughExecutionBrowser` and `BrowserCaptureController`:

```ts
assertNavigation(expectation: {
  url: string;
  match: "exact-url" | "same-origin-path";
}): Promise<void>;
```

Dispatch a navigation assertion before target resolution in `performStep()`. In preflight, validate each unique runtime binding once and permit multiple type steps to reference it; unexpected or non-string inputs remain errors.

- [ ] **Step 6: Implement Playwright URL assertions**

```ts
async assertNavigation(expectation) {
  if (!matchesNavigation(expectation, page.url())) {
    throw new PlaywrightExecutionControllerError("assertion_failed");
  }
},
```

The local matcher strips credentials, query, and fragment. `exact-url` compares the complete sanitized URL; `same-origin-path` compares protocol, hostname, effective port, and pathname. Add real-browser matching/mismatch tests and no-op methods to unrelated capture/CLI fixtures.

- [ ] **Step 7: Run focused cross-package tests**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/walkthroughValidation.test.ts src/walkthroughExecution.test.ts
rtk npm --workspace @auto-demo/capture exec vitest run src/playwrightExecutionController.test.ts src/playwrightMetadataRecorder.test.ts
rtk npm --workspace @auto-demo/cli exec vitest run src/agentExecuteCommand.test.ts
```

Expected: all suites PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/agent/src/walkthroughValidation.ts packages/agent/src/walkthroughValidation.test.ts packages/agent/src/walkthroughExecution.ts packages/agent/src/walkthroughExecution.test.ts packages/capture/src/index.ts packages/capture/src/playwrightExecutionController.ts packages/capture/src/playwrightExecutionController.test.ts packages/capture/src/playwrightMetadataRecorder.test.ts packages/cli/src/agentExecuteCommand.test.ts
git commit -m "feat: execute discovery plan assertions"
```

### Task 6: Document The Discovery-To-Plan Handoff

**Files:**

- Modify: `packages/agent/README.md`
- Modify: `README.md`
- Modify: `packages/agent/src/wrapper-docs.test.ts`

- [ ] **Step 1: Write a failing docs contract test**

```ts
expect(agentReadme).toContain("compileDiscoverySessionToWalkthroughPlan");
expect(agentReadme).toContain("draft and unapproved");
expect(agentReadme).toContain("does not carry disposable-environment authority");
expect(rootReadme).toContain("WES-188 owns fresh-context replay and repair");
```

- [ ] **Step 2: Run the test and verify RED**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/wrapper-docs.test.ts
```

Expected: FAIL because WES-187 is still future tense.

- [ ] **Step 3: Update package and root docs**

Add a package example:

```ts
const compiled = compileDiscoverySessionToWalkthroughPlan(completedSession);
if (!compiled.ok) throw new Error(compiled.errors[0].code);
// compiled.plan is deterministic, draft, validate-first, and unapproved.
```

Document selected-path-only behavior, accessible target resolution, runtime-only bindings, structured assertions, normalization, safe errors, and no disposable-authority carryover. State that no browser, capture, discovery CLI, replay, repair, validation, or approval starts here. Update the root README to identify WES-188 as the next boundary.

- [ ] **Step 4: Run docs and compiler tests**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/wrapper-docs.test.ts src/discoveryPlanCompiler.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/README.md README.md packages/agent/src/wrapper-docs.test.ts
git commit -m "docs: explain discovery plan compilation"
```

### Task 7: Review, Verify, And Run The Completion Gate

**Files:**

- Modify as findings require: WES-187 implementation/test files only
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Request focused code review**

Use `superpowers:requesting-code-review`. Check for compilation of unselected attempts, opaque target/selector leakage, input value resolution, sanitizer source downgrade, missing fingerprint fields, timestamp/key-order nondeterminism, approval bypass, disposable-authority carryover, normalization ordering, and implementation-detail tests. Add focused regression tests for accepted findings.

- [ ] **Step 2: Run package verification**

```bash
rtk npm --workspace @auto-demo/agent test
rtk npm --workspace @auto-demo/capture test
rtk npm --workspace @auto-demo/cli test
rtk npm --workspace @auto-demo/agent run typecheck
rtk npm --workspace @auto-demo/capture run typecheck
rtk npm --workspace @auto-demo/cli run typecheck
```

Expected: every command PASS.

- [ ] **Step 3: Run repository verification**

```bash
rtk npm run build
rtk npm run typecheck
rtk npm run lint
rtk npm test
rtk proxy npx prettier --check packages/agent/src/discoveryPlanCompiler.ts packages/agent/src/discoveryPlanCompiler.test.ts packages/agent/src/index.ts packages/agent/src/walkthroughValidation.ts packages/agent/src/walkthroughValidation.test.ts packages/agent/src/walkthroughApproval.ts packages/agent/src/walkthroughApproval.test.ts packages/agent/src/walkthroughReview.ts packages/agent/src/walkthroughReview.test.ts packages/agent/src/walkthroughRefinement.ts packages/agent/src/walkthroughRefinement.test.ts packages/agent/src/walkthroughExecution.ts packages/agent/src/walkthroughExecution.test.ts packages/capture/src/index.ts packages/capture/src/playwrightExecutionController.ts packages/capture/src/playwrightExecutionController.test.ts packages/capture/src/playwrightMetadataRecorder.test.ts packages/cli/src/agentExecuteCommand.test.ts packages/agent/package.json packages/agent/README.md README.md docs/linear/auto-demo-project-structure.md
rtk git diff --check
```

Expected: build, typechecks, ESLint, tests, targeted formatting, and diff checks PASS. Also run `rtk npm run validate`; if an unrelated preserved formatting issue remains, report it precisely without modifying unrelated files.

- [ ] **Step 4: Run `linear-sync-gate` in `completion-gate` mode**

Provide repository path, project map, project `Auto Demo Balanced MVP`, active issue WES-187, exact implementation/verification evidence, and nearby issues WES-182/WES-188/WES-189/WES-191/WES-190. Apply only clear writes. Do not mark WES-187 Done from local-only evidence; add WES-188 readiness only after durable integration.

- [ ] **Step 5: Record completion evidence**

Update the project map with implemented public behavior, tests, review results, commit/PR evidence, Linear writes, and the next-task pointer.

- [ ] **Step 6: Commit the completion sync when authorized**

```bash
git add docs/linear/auto-demo-project-structure.md
git commit -m "docs: complete WES-187 project sync"
```

Expected: WES-188 becomes next only when WES-187 is verified, durably integrated, and Done in Linear.
