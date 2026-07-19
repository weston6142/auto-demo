# WES-271 Semantic Form Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` and execute these checkboxes inline. The active `linear-deliver-next-task` workflow owns commits, review, publication, and merge without a worktree or implementation subagents.

**Goal:** Add deterministic native select support and require reproducible observable effects for state-changing discovery actions across discovery, replay, and final recording.

**Architecture:** Extend the existing discovery and walkthrough discriminated unions with one `select` action and one bounded `control-state` assertion. The Playwright observation adapter exposes sanitized public form metadata; the rehearsal layer derives meaningful effects from before/after observations; compiler, replay, execution, and capture adapters reproduce and verify those public effects without retaining raw values.

**Tech Stack:** TypeScript, Playwright, Vitest, npm workspaces, ESLint, Prettier

---

## File Structure

- `packages/agent/src/discoveryContract.ts`: durable discovery form metadata, select action, and control-state expectation types.
- `packages/agent/src/discoveryObservation.ts`: raw bounded form metadata emitted by browser adapters.
- `packages/agent/src/playwrightDiscoveryPage.ts`: native form inspection and select execution using only visible public labels.
- `packages/agent/src/discoveryObservationTransform.ts`: sanitization and bounded public contract projection.
- `packages/agent/src/discoveryRehearsal.ts`: meaningful before/after effect derivation and no-op rejection.
- `packages/agent/src/discoveryValidation.ts`: validation of the extended discovery contract.
- `packages/agent/src/discoveryPlanCompiler.ts`: compilation of select steps and control-state assertions.
- `packages/agent/src/index.ts`: walkthrough select and control-state public types/exports.
- `packages/agent/src/walkthroughValidation.ts`: plan validation and safety classification for select steps.
- `packages/agent/src/discoveryReplay.ts`: select and control-state replay orchestration.
- `packages/agent/src/playwrightDiscoveryReplay.ts`: real Playwright select and form-state assertion behavior.
- `packages/agent/src/walkthroughExecution.ts`: approved execution of select and control-state assertions.
- `packages/capture/src/index.ts`: controllable capture browser select and control-state APIs.
- `packages/capture/src/playwrightExecutionController.ts`: final recording implementation using accessible targets.
- `packages/capture/src/playwrightMetadataRecorder.ts`: bounded semantic select metadata without option values.
- Adjacent `*.test.ts` files: public behavior and browser-level regression coverage.
- `packages/agent/README.md`, `packages/capture/README.md`, and `packages/agent/skills/codex-auto-demo/SKILL.md`: operator-facing contract updates.

### Task 1: Observe Bounded Public Native Form State

**Files:**

- Modify: `packages/agent/src/discoveryContract.ts`
- Modify: `packages/agent/src/discoveryObservation.ts`
- Modify: `packages/agent/src/discoveryObservationTransform.ts`
- Modify: `packages/agent/src/playwrightDiscoveryPage.ts`
- Test: `packages/agent/src/playwrightDiscoveryObservation.test.ts`
- Test: `packages/agent/src/discoveryObservation.test.ts`

- [ ] **Step 1: Write a failing browser observation test**

Add a fixture containing required condition/make/model/distance selects, a checked radio, an empty conditional ZIP input, disabled and selected options, and secret-bearing `value` attributes. Assert only observable output:

```ts
expect(targets).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      label: "Condition",
      role: "combobox",
      form: {
        required: true,
        hasValue: true,
        validity: "valid",
        selectedOption: "New",
        checked: undefined,
        options: [
          { label: "Any", disabled: false, selected: false },
          { label: "New", disabled: false, selected: true },
        ],
      },
    }),
    expect.objectContaining({ label: "Nationwide", form: { checked: true } }),
    expect.objectContaining({ label: "ZIP", form: { hasValue: false } }),
  ]),
);
expect(JSON.stringify(result)).not.toContain("option-secret-value");
expect(JSON.stringify(result)).not.toContain("typed-zip-value");
```

- [ ] **Step 2: Run the observation tests and verify RED**

Run: `npm --workspace @auto-demo/agent exec vitest run src/playwrightDiscoveryObservation.test.ts src/discoveryObservation.test.ts`

Expected: FAIL because `DiscoveryInteractiveTarget` does not expose `form` metadata.

- [ ] **Step 3: Add the minimal bounded form metadata contracts and extraction**

Add public types shaped as:

```ts
export type DiscoveryFormOption = {
  label: string;
  disabled: boolean;
  selected: boolean;
};

export type DiscoveryFormState = {
  required: boolean;
  hasValue: boolean;
  validity: "valid" | "invalid" | "unknown";
  checked?: boolean;
  selectedOption?: string;
  options?: DiscoveryFormOption[];
};
```

Collect state only from native `input`, `textarea`, and `select` elements. Read boolean/value-presence state in the page, but project only `hasValue`; project option text, never option `value`; cap options at `DISCOVERY_LIMITS.formOptionsPerTarget = 50`; run labels through the existing sanitizer before persistence.

- [ ] **Step 4: Run the focused observation tests and verify GREEN**

Run: `npm --workspace @auto-demo/agent exec vitest run src/playwrightDiscoveryObservation.test.ts src/discoveryObservation.test.ts`

Expected: PASS with no raw values in serialized results.

- [ ] **Step 5: Commit the observation contract**

```bash
git add packages/agent/src/discoveryContract.ts packages/agent/src/discoveryObservation.ts packages/agent/src/discoveryObservationTransform.ts packages/agent/src/playwrightDiscoveryPage.ts packages/agent/src/playwrightDiscoveryObservation.test.ts packages/agent/src/discoveryObservation.test.ts
git commit -m "WES-271: expose bounded public form state"
```

### Task 2: Perform Select Actions And Reject No-Effect Mutations

**Files:**

- Modify: `packages/agent/src/discoveryContract.ts`
- Modify: `packages/agent/src/playwrightDiscoveryPage.ts`
- Modify: `packages/agent/src/playwrightDiscoveryRehearsal.ts`
- Modify: `packages/agent/src/discoveryRehearsal.ts`
- Modify: `packages/agent/src/discoveryValidation.ts`
- Test: `packages/agent/src/playwrightDiscoveryRehearsal.test.ts`
- Test: `packages/agent/src/discoveryRehearsal.test.ts`
- Test: `packages/agent/src/discoveryValidation.test.ts`

- [ ] **Step 1: Write failing black-box rehearsal tests for semantic selection**

Build a local form fixture where selecting Condition=`New`, Make=`Kia`, Model=`Sorento`, and Distance=`Nationwide` updates dependent selects and conditionally reveals ZIP. Drive only `createPlaywrightDiscoveryRehearsalController()` and opaque observed target IDs:

```ts
const selected = await controller.perform({
  action: { kind: "select", targetId: conditionId, optionLabel: "New" },
  expectations: [],
  confidence: { level: "high", bases: ["exact-accessible-target"] },
});

expect(selected).toMatchObject({
  ok: true,
  attempt: {
    status: "succeeded",
    derivedExpectations: [expect.objectContaining({ kind: "control-state" })],
    outcome: { code: "action_completed" },
  },
});
```

Also assert a click whose handler changes nothing finishes failed with `action_no_observable_effect`, while a checkbox click and a type action succeed from changed public form state.

- [ ] **Step 2: Run rehearsal tests and verify RED**

Run: `npm --workspace @auto-demo/agent exec vitest run src/playwrightDiscoveryRehearsal.test.ts src/discoveryRehearsal.test.ts`

Expected: FAIL because `select`, derived control-state effects, and no-op rejection are absent.

- [ ] **Step 3: Add select execution and meaningful effect derivation**

Extend `DiscoveryAction` with:

```ts
| { kind: "select"; targetId: string; optionLabel: string }
```

Resolve the native select by the existing in-memory identity and use `selectOption({ label: optionLabel })` only after exactly one enabled bounded option matches. In `discoveryRehearsal.ts`, compare before/after navigation, newly visible states, and changed public form fields. Produce `derived-from-observation` expectations and matched effects. Finish click/type/select with `action_no_observable_effect` when there are no declared expectations and no derived effect.

- [ ] **Step 4: Write failing validation tests for select and control-state**

Assert that validation accepts sanitized bounded option labels and derived control-state expectations, while rejecting unknown keys, oversized labels, raw values, nonexistent target references, and invalid field combinations.

- [ ] **Step 5: Run validation tests and verify RED**

Run: `npm --workspace @auto-demo/agent exec vitest run src/discoveryValidation.test.ts src/discoverySession.test.ts`

Expected: FAIL because the contract validator does not recognize the new variants.

- [ ] **Step 6: Implement minimal discovery validation and verify GREEN**

Run: `npm --workspace @auto-demo/agent exec vitest run src/discoveryValidation.test.ts src/discoverySession.test.ts src/discoveryRehearsal.test.ts src/playwrightDiscoveryRehearsal.test.ts`

Expected: PASS for select, form effects, and existing behaviors.

- [ ] **Step 7: Commit rehearsal semantics**

```bash
git add packages/agent/src/discoveryContract.ts packages/agent/src/playwrightDiscoveryPage.ts packages/agent/src/playwrightDiscoveryRehearsal.ts packages/agent/src/discoveryRehearsal.ts packages/agent/src/discoveryValidation.ts packages/agent/src/playwrightDiscoveryRehearsal.test.ts packages/agent/src/discoveryRehearsal.test.ts packages/agent/src/discoveryValidation.test.ts packages/agent/src/discoverySession.test.ts
git commit -m "WES-271: require observable form effects"
```

### Task 3: Compile And Validate Durable Select Steps

**Files:**

- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/src/discoveryPlanCompiler.ts`
- Modify: `packages/agent/src/walkthroughValidation.ts`
- Test: `packages/agent/src/discoveryPlanCompiler.test.ts`
- Test: `packages/agent/src/walkthroughValidation.test.ts`
- Test: `packages/agent/src/walkthroughApproval.test.ts`

- [ ] **Step 1: Write failing compiler tests**

Compile a completed discovery session containing semantic select attempts and derived control-state expectations. Assert a durable step:

```ts
expect(plan.steps).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      action: "select",
      targetHint: { kind: "accessible", label: "Condition", role: "combobox" },
      optionLabel: "New",
    }),
    expect.objectContaining({
      action: "assert",
      assertion: {
        kind: "control-state",
        target: { kind: "accessible", label: "Condition", role: "combobox" },
        selectedOption: "New",
      },
    }),
  ]),
);
```

- [ ] **Step 2: Run compiler tests and verify RED**

Run: `npm --workspace @auto-demo/agent exec vitest run src/discoveryPlanCompiler.test.ts`

Expected: FAIL with unsupported compilation action/assertion.

- [ ] **Step 3: Add walkthrough select and control-state public contracts**

Add `select` to `WalkthroughPlanStepAction`, optional `optionLabel` to select steps, and a `control-state` assertion with an accessible target and only asserted public fields. Compile target occurrence and public state exactly; include option labels and assertions in existing validation and fingerprint projections.

- [ ] **Step 4: Write failing plan validation and approval-freshness tests**

Assert valid select plans pass; missing/extra/secret-like option labels fail; select is classified as state-changing; and changing the option or expected control state invalidates an existing approval fingerprint.

- [ ] **Step 5: Run plan tests and verify RED**

Run: `npm --workspace @auto-demo/agent exec vitest run src/walkthroughValidation.test.ts src/walkthroughApproval.test.ts`

Expected: FAIL because select/control-state are not accepted or fingerprinted.

- [ ] **Step 6: Implement validation and verify GREEN**

Run: `npm --workspace @auto-demo/agent exec vitest run src/discoveryPlanCompiler.test.ts src/walkthroughValidation.test.ts src/walkthroughApproval.test.ts`

Expected: PASS with malformed artifacts rejected safely.

- [ ] **Step 7: Commit durable plan support**

```bash
git add packages/agent/src/index.ts packages/agent/src/discoveryPlanCompiler.ts packages/agent/src/walkthroughValidation.ts packages/agent/src/discoveryPlanCompiler.test.ts packages/agent/src/walkthroughValidation.test.ts packages/agent/src/walkthroughApproval.test.ts
git commit -m "WES-271: compile semantic select steps"
```

### Task 4: Reproduce Select And Control State In Fresh Replay

**Files:**

- Modify: `packages/agent/src/discoveryReplay.ts`
- Modify: `packages/agent/src/playwrightDiscoveryReplay.ts`
- Test: `packages/agent/src/discoveryReplay.test.ts`
- Test: `packages/agent/src/playwrightDiscoveryReplay.test.ts`

- [ ] **Step 1: Write failing replay orchestration tests**

Extend the public fake replay browser with `select()` and `assertControlState()` and assert the runner dispatches the option label before checking the derived state. Assert missing options and state mismatches produce sanitized `action_failed` or `visible_state_mismatch` evidence without native values.

- [ ] **Step 2: Run replay orchestration tests and verify RED**

Run: `npm --workspace @auto-demo/agent exec vitest run src/discoveryReplay.test.ts`

Expected: FAIL because the replay interface cannot execute select/control-state steps.

- [ ] **Step 3: Implement minimal replay dispatch**

Add `select(match, optionLabel)` and `assertControlState(assertion)` to `DiscoveryReplayBrowser`; dispatch them in step order; keep existing settle, policy, repair, and failure evidence paths.

- [ ] **Step 4: Write failing real Playwright replay tests**

Use the multi-select fixture to prove a fresh browser selects public labels, reveals conditional ZIP, and checks the asserted state. Add disabled/missing/ambiguous option cases and assert errors do not contain option values.

- [ ] **Step 5: Run Playwright replay tests and verify RED**

Run: `npm --workspace @auto-demo/agent exec vitest run src/playwrightDiscoveryReplay.test.ts`

Expected: FAIL because Playwright replay has no select or control-state implementation.

- [ ] **Step 6: Implement Playwright replay and verify GREEN**

Run: `npm --workspace @auto-demo/agent exec vitest run src/discoveryReplay.test.ts src/playwrightDiscoveryReplay.test.ts`

Expected: PASS while existing fresh-context, policy, repair, and launch-profile tests remain green.

- [ ] **Step 7: Commit replay support**

```bash
git add packages/agent/src/discoveryReplay.ts packages/agent/src/playwrightDiscoveryReplay.ts packages/agent/src/discoveryReplay.test.ts packages/agent/src/playwrightDiscoveryReplay.test.ts
git commit -m "WES-271: replay semantic form selections"
```

### Task 5: Execute And Record Approved Select Steps

**Files:**

- Modify: `packages/agent/src/walkthroughExecution.ts`
- Modify: `packages/capture/src/index.ts`
- Modify: `packages/capture/src/playwrightExecutionController.ts`
- Modify: `packages/capture/src/playwrightMetadataRecorder.ts`
- Test: `packages/agent/src/walkthroughExecution.test.ts`
- Test: `packages/capture/src/playwrightExecutionController.test.ts`
- Test: `packages/capture/src/playwrightMetadataRecorder.test.ts`

- [ ] **Step 1: Write failing approved-execution tests**

Assert `executeWalkthroughPlan()` calls `browser.select(target, "New")`, waits for settling, checks the subsequent control-state assertion, and records completed step outcomes. Assert missing option labels fail preflight as invalid plans.

- [ ] **Step 2: Run execution tests and verify RED**

Run: `npm --workspace @auto-demo/agent exec vitest run src/walkthroughExecution.test.ts`

Expected: FAIL because the execution browser lacks select/control-state methods.

- [ ] **Step 3: Implement minimal approved execution dispatch**

Extend the execution and capture controller interfaces with:

```ts
select(target: BrowserExecutionTarget, optionLabel: string): Promise<void>;
assertControlState(assertion: BrowserControlStateAssertion): Promise<void>;
```

Dispatch select using the plan's public option label and map controller failures through existing stable execution error categories.

- [ ] **Step 4: Write failing capture-controller and metadata tests**

Drive a real controllable Playwright page through the public controller, select an option, and assert the DOM effect and bounded semantic event. Assert neither option `value` nor unrelated form values appear in NDJSON.

- [ ] **Step 5: Run capture tests and verify RED**

Run: `npm --workspace @auto-demo/capture exec vitest run src/playwrightExecutionController.test.ts src/playwrightMetadataRecorder.test.ts`

Expected: FAIL because capture lacks native select execution and semantic metadata.

- [ ] **Step 6: Implement capture selection/state assertions and verify GREEN**

Use the existing accessible locator resolution, `selectOption({ label })`, and direct boolean/public-label state comparison. Extend event classification only enough to distinguish a native select change while preserving current redaction.

Run: `npm --workspace @auto-demo/capture exec vitest run src/playwrightExecutionController.test.ts src/playwrightMetadataRecorder.test.ts && npm --workspace @auto-demo/agent exec vitest run src/walkthroughExecution.test.ts`

Expected: PASS with no raw native values in output.

- [ ] **Step 7: Commit execution and recording support**

```bash
git add packages/agent/src/walkthroughExecution.ts packages/agent/src/walkthroughExecution.test.ts packages/capture/src/index.ts packages/capture/src/playwrightExecutionController.ts packages/capture/src/playwrightExecutionController.test.ts packages/capture/src/playwrightMetadataRecorder.ts packages/capture/src/playwrightMetadataRecorder.test.ts
git commit -m "WES-271: record semantic form selections"
```

### Task 6: Document, Integrate, And Verify The Full Behavior

**Files:**

- Modify: `packages/agent/README.md`
- Modify: `packages/capture/README.md`
- Modify: `packages/agent/skills/codex-auto-demo/SKILL.md`
- Modify: `packages/agent/src/wrapper-docs.test.ts`
- Modify: `packages/cli/src/agenticDiscoveryAcceptance.test.ts`
- Modify: `docs/linear/auto-demo-project-structure.md`
- Add: `docs/superpowers/specs/2026-07-19-wes-271-semantic-form-controls-design.md`
- Add: `docs/superpowers/plans/2026-07-19-wes-271-semantic-form-controls.md`

- [ ] **Step 1: Write a failing end-to-end acceptance test**

Extend the deterministic local acceptance surface with condition, make, model, distance, and conditional ZIP controls. Drive discovery, selected-path compilation, fresh replay, explicit approval, final capture, and project handoff using only public APIs. Assert the plan contains semantic select steps and derived assertions, final capture reaches the expected result, and artifacts contain no raw option values.

- [ ] **Step 2: Run acceptance and wrapper tests and verify RED**

Run: `npm --workspace @auto-demo/cli exec vitest run src/agenticDiscoveryAcceptance.test.ts && npm --workspace @auto-demo/agent exec vitest run src/wrapper-docs.test.ts`

Expected: FAIL until the new behavior and operator guidance are wired end to end.

- [ ] **Step 3: Update public documentation and complete integration wiring**

Document native select actions, bounded form metadata, the requirement for declared or meaningful observable effects, no-op rejection, and the continued prohibition on raw DOM/selectors/values. Tell agents to select options by returned public labels and to treat failed no-effect attempts as invalid path candidates.

- [ ] **Step 4: Run focused cross-package verification**

Run:

```bash
npm --workspace @auto-demo/agent test
npm --workspace @auto-demo/capture test
npm --workspace @auto-demo/cli test
npm run build
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 5: Run issue-owned lint, formatting, and whitespace checks**

Run:

```bash
npx eslint packages/agent/src packages/capture/src packages/cli/src/agenticDiscoveryAcceptance.test.ts
npx prettier --check packages/agent packages/capture packages/cli/src/agenticDiscoveryAcceptance.test.ts docs/superpowers/specs/2026-07-19-wes-271-semantic-form-controls-design.md docs/superpowers/plans/2026-07-19-wes-271-semantic-form-controls.md docs/linear/auto-demo-project-structure.md
git diff --check
```

Expected: all commands exit 0. Do not include or reformat the preserved `.gitignore` and `workflow/` changes.

- [ ] **Step 6: Run the complete repository verification gate**

Run: `npm run validate`

Expected in a clean checkout: build, every workspace typecheck, ESLint, all tests, and Prettier pass. If the preserved user-owned `workflow/` diagnostics remain the only repository-wide lint/format findings, record exact evidence and rely on clean-checkout CI for those unaffected files.

- [ ] **Step 7: Update completion evidence and commit docs/integration**

```bash
git add packages/agent/README.md packages/capture/README.md packages/agent/skills/codex-auto-demo/SKILL.md packages/agent/src/wrapper-docs.test.ts packages/cli/src/agenticDiscoveryAcceptance.test.ts docs/linear/auto-demo-project-structure.md docs/superpowers/specs/2026-07-19-wes-271-semantic-form-controls-design.md docs/superpowers/plans/2026-07-19-wes-271-semantic-form-controls.md
git commit -m "WES-271: document semantic form workflow"
```

### Task 7: Review, Publish, And Synchronize

**Files:**

- Modify only issue-owned files identified by verified review or CI findings.

- [ ] **Step 1: Request an independent read-only review**

Give the reviewer WES-271, the design, this plan, `origin/develop`, and the complete diff. Require Critical/Important/Minor findings with file and line evidence and an explicit readiness verdict.

- [ ] **Step 2: Evaluate feedback and repair valid findings with RED-GREEN**

For each valid finding, add or identify a failing behavior test, verify RED, apply the smallest fix, and run the affected focused checks. Reject stale, incorrect, duplicate, or scope-expanding findings with code evidence.

- [ ] **Step 3: Publish the PR and monitor exact-head CI**

Push the issue branch, open a PR to `develop`, include WES-271 plus exact verification evidence, and monitor structured check status and review threads. Diagnose and repair any failing check before merge.

- [ ] **Step 4: Record stable completion evidence in the project map**

After exact-head CI and review pass, record the PR/check evidence and set the deterministic post-merge next pointer to WES-267. Keep WES-268 blocked by WES-267 and WES-273 blocked by WES-267 and WES-268.

- [ ] **Step 5: Squash merge and run the completion gate**

Squash merge only after required checks, acceptance criteria, and actionable review threads are clear. Fast-forward local `develop` from the verified base remote, run the completion sync audit, comment and move WES-271 to Done, and reconcile WES-267/WES-268/WES-273 plus the map. Publish any required tracked post-merge map correction through a scoped follow-up PR.
