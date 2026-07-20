# WES-267 Target Ranking And Structural Positional Intent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` task-by-task. The active `$linear-deliver-next-task` invocation overrides the normal execution handoff: the main agent executes these checkboxes inline in the current checkout without a worktree or implementation subagents.

**Goal:** Keep relevant viewport, form, and custom controls observable under the 100-target bound and preserve “first eligible item in this results region” intent across fresh replay, repair, approval, and recording.

**Architecture:** Extend discovery observations with bounded ranking facts and sanitized structural context. Compile optional structural context into the existing accessible target hint; when present it becomes authoritative for runtime resolution while the old label remains descriptive. Replay and capture independently resolve the same portable contract, and repair rejects any change that weakens positional intent.

**Tech Stack:** TypeScript 7, Node.js ESM, Vitest, Playwright, npm workspaces.

---

### Task 1: Publish and validate the structural target contract

**Files:**

- Modify: `packages/agent/src/discoveryContract.ts`
- Modify: `packages/agent/src/discoveryObservation.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/src/discoveryValidation.ts`
- Test: `packages/agent/src/discoveryValidation.test.ts`
- Test: `packages/agent/src/walkthroughValidation.test.ts`

- [x] **Step 1: Write failing discovery-session validation tests**

Add public-behavior cases that load an observation target with this bounded shape and expect validation success:

```ts
structure: {
  container: { role: "list", label: "Vehicle results", occurrence: 1 },
  item: {
    role: "listitem",
    position: 1,
    promotion: "exclude-marked-promoted",
  },
}
```

Clone that artifact and separately assert rejection for an unknown key, empty container label, unsupported roles, zero/negative/fractional/greater-than-100 positions, an item without a repeated-item container, and a secret-like label. Assert that error JSON never echoes the unsafe value.

- [x] **Step 2: Run the discovery validation tests and confirm RED**

Run: `rtk npm exec vitest -- run packages/agent/src/discoveryValidation.test.ts`

Expected: FAIL because structural target fields are not part of the discovery schema.

- [x] **Step 3: Add the bounded discovery structural types and validation**

Add these shared public types in `discoveryContract.ts` and reference them from `DiscoveryInteractiveTarget`:

```ts
export type DiscoveryStructuralContainer = {
  role: "form" | "region" | "main" | "list" | "feed";
  label?: string;
  occurrence?: number;
};

export type DiscoveryStructuralItem = {
  role: "listitem" | "article";
  position: number;
  promotion?: "exclude-marked-promoted";
};

export type DiscoveryTargetStructure = {
  container: DiscoveryStructuralContainer;
  item?: DiscoveryStructuralItem;
};
```

Add optional `structure` to `DiscoveryInteractiveTarget` and to the raw observation target. Update discovery validation to require exact keys, sanitized bounded strings, allowed roles, an optional positive occurrence, and an item position from 1 through `DISCOVERY_LIMITS.interactiveTargetsPerObservation`. Require `list` or `feed` when `item` is present.

- [x] **Step 4: Write failing walkthrough-target validation tests**

Add one discovered plan with the same `structure` nested under `targetHint` and expect it to validate. Add mutations for unknown keys, invalid role/position, `occurrence` on the item, and an item under a `form` container; expect `invalid_plan` without echoing attacker-controlled strings.

- [x] **Step 5: Run walkthrough validation and confirm RED**

Run: `rtk npm exec vitest -- run packages/agent/src/walkthroughValidation.test.ts`

Expected: FAIL because `WalkthroughPlanTargetHint` and its exact-key validator do not accept structure.

- [x] **Step 6: Extend the walkthrough target hint without changing legacy plans**

Add optional `structure?: DiscoveryTargetStructure` to `WalkthroughPlanTargetHint`. Update `isWalkthroughPlanTargetHint`, step sanitization, review candidate sanitization, and assertion equality paths to validate and clone the exact bounded shape. Keep `kind`, `label`, `role`, and `occurrence` unchanged so an accessible-only plan serializes and fingerprints exactly as before.

- [x] **Step 7: Run focused contract tests and confirm GREEN**

Run: `rtk npm exec vitest -- run packages/agent/src/discoveryValidation.test.ts packages/agent/src/walkthroughValidation.test.ts packages/agent/src/walkthroughReview.test.ts packages/agent/src/walkthroughApproval.test.ts`

Expected: PASS.

- [x] **Step 8: Commit the contract**

```bash
git add packages/agent/src/discoveryContract.ts packages/agent/src/discoveryObservation.ts packages/agent/src/index.ts packages/agent/src/discoveryValidation.ts packages/agent/src/discoveryValidation.test.ts packages/agent/src/walkthroughValidation.ts packages/agent/src/walkthroughValidation.test.ts packages/agent/src/walkthroughReview.ts packages/agent/src/walkthroughReview.test.ts packages/agent/src/walkthroughApproval.test.ts
git commit -m "WES-267: add structural target contract"
```

### Task 2: Rank bounded browser observations without starving custom controls

**Files:**

- Modify: `packages/agent/src/playwrightDiscoveryPage.ts`
- Modify: `packages/agent/src/discoveryObservationTransform.ts`
- Test: `packages/agent/src/playwrightDiscoveryObservation.test.ts`
- Test: `packages/agent/src/discoveryObservation.test.ts`

- [x] **Step 1: Write failing viewport/form and fallback-reserve tests**

Create black-box Playwright fixtures with:

- 120 off-screen semantic links followed by a viewport-intersecting labelled form containing `Condition` and `Distance` controls;
- 120 semantic controls plus 25 visible custom `tabindex=0` or pointer controls; and
- stable document order inside each ranking class.

Assert that the public observation still has at most 100 targets, contains the form controls, contains at least 20 ranked fallback targets when at least 20 are available, fills remaining capacity from the strongest candidates of either tier, and reports the correct omitted and fallback counts. Repeat the observation and assert the same public ordering.

- [x] **Step 2: Run the browser-observation tests and confirm RED**

Run: `rtk npm exec vitest -- run packages/agent/src/playwrightDiscoveryObservation.test.ts packages/agent/src/discoveryObservation.test.ts`

Expected: FAIL because collection uses layout visibility, first-100-per-tier retention, and semantic-first truncation.

- [x] **Step 3: Add bounded ranking facts to raw targets**

In `collectBrowserSnapshot`, derive:

```ts
ranking: {
  inViewport: rect.bottom > 0 && rect.right > 0 &&
    rect.top < innerHeight && rect.left < innerWidth,
  formLocal: nearestFormOrLabelledLandmark !== undefined,
}
```

Inspect no more than 32 composed ancestors per candidate. Keep the best 100 raw semantic and best 100 raw fallback candidates with a deterministic comparison of `inViewport && formLocal`, `inViewport`, `formLocal`, semantic confidence, then document order. Increment omitted counts for every eligible candidate not retained, including candidates displaced from a bounded top set.

- [x] **Step 4: Reserve bounded fallback capacity in the transform**

Sort sanitized candidates with the same ranking comparison. Select up to the best 20 fallback candidates first, fill the remaining slots from the best unselected candidates across both tiers, and finally order the chosen set by the common ranking comparison. Do not persist the internal `ranking` field into `DiscoveryInteractiveTarget`.

- [x] **Step 5: Run observation tests and confirm GREEN**

Run: `rtk npm exec vitest -- run packages/agent/src/playwrightDiscoveryObservation.test.ts packages/agent/src/discoveryObservation.test.ts`

Expected: PASS with deterministic ordering, the 100-target bound, and accurate diagnostics.

- [x] **Step 6: Commit ranking behavior**

```bash
git add packages/agent/src/playwrightDiscoveryPage.ts packages/agent/src/discoveryObservationTransform.ts packages/agent/src/playwrightDiscoveryObservation.test.ts packages/agent/src/discoveryObservation.test.ts
git commit -m "WES-267: rank bounded discovery targets"
```

### Task 3: Extract sanitized list context and compile positional intent

**Files:**

- Modify: `packages/agent/src/playwrightDiscoveryPage.ts`
- Modify: `packages/agent/src/discoveryObservationTransform.ts`
- Modify: `packages/agent/src/discoveryPlanCompiler.ts`
- Modify: `packages/agent/src/walkthroughApproval.ts`
- Test: `packages/agent/src/playwrightDiscoveryObservation.test.ts`
- Test: `packages/agent/src/discoveryPlanCompiler.test.ts`
- Test: `packages/agent/src/walkthroughApproval.test.ts`

- [x] **Step 1: Write failing structural-observation tests**

Build a fixture with a labelled `Vehicle results` list containing one explicitly `Sponsored` item and two ordinary list items whose links have changing vehicle names. Assert that the first ordinary link exposes:

```ts
structure: {
  container: { role: "list", label: "Vehicle results", occurrence: 1 },
  item: {
    role: "listitem",
    position: 1,
    promotion: "exclude-marked-promoted",
  },
}
```

Assert the second ordinary item has position 2, the promoted item has no exclusion rule, repeated labelled containers receive bounded occurrences, and no returned JSON contains selector text, hidden content, raw attributes, secret-like labels, or form values.

- [x] **Step 2: Run structural observation tests and confirm RED**

Run: `rtk npm exec vitest -- run packages/agent/src/playwrightDiscoveryObservation.test.ts`

Expected: FAIL because snapshots have no structural context.

- [x] **Step 3: Extract bounded public container and item context**

Recognize container roles from explicit accessible roles or native `form`, `main`, `ul`, and `ol`; recognize repeated items from `li`, `article`, `role=listitem`, and `role=article`. Use existing accessible-label logic for a bounded container label and compute container occurrence among equivalent visible containers. Within a list/feed, compute item position among visible items after excluding only items with an explicit normalized marker matching `sponsored`, `promoted`, `ad`, or `advertisement`. Persist the promotion exclusion only for a target inside an item without such a marker.

- [x] **Step 4: Write failing compiler and fingerprint tests**

Record a click attempt against the first ordinary listing and compile it. Assert the target hint contains the structural constraint and keeps the vehicle label only as descriptive text. Change only the structure and assert both selected-path and approval fingerprints change. Compile an accessible-only fixture and assert its previous expected fingerprint remains unchanged.

- [x] **Step 5: Run compiler and approval tests and confirm RED**

Run: `rtk npm exec vitest -- run packages/agent/src/discoveryPlanCompiler.test.ts packages/agent/src/walkthroughApproval.test.ts`

Expected: FAIL because `accessibleTarget()` drops structural context.

- [x] **Step 6: Compile and fingerprint structural context**

Have `accessibleTarget()` sanitize and clone `target.structure`. Because selected-path and approval hashes already include target hints, verify the new field participates without adding parallel fingerprint state. Preserve the exact object shape for legacy targets with no structure.

- [x] **Step 7: Run observation, compiler, and approval tests and confirm GREEN**

Run: `rtk npm exec vitest -- run packages/agent/src/playwrightDiscoveryObservation.test.ts packages/agent/src/discoveryPlanCompiler.test.ts packages/agent/src/walkthroughApproval.test.ts`

Expected: PASS.

- [x] **Step 8: Commit structural compilation**

```bash
git add packages/agent/src/playwrightDiscoveryPage.ts packages/agent/src/discoveryObservationTransform.ts packages/agent/src/playwrightDiscoveryObservation.test.ts packages/agent/src/discoveryPlanCompiler.ts packages/agent/src/discoveryPlanCompiler.test.ts packages/agent/src/walkthroughApproval.ts packages/agent/src/walkthroughApproval.test.ts
git commit -m "WES-267: compile structural positional intent"
```

### Task 4: Resolve structural targets in fresh replay and preserve them through repair

**Files:**

- Modify: `packages/agent/src/playwrightDiscoveryReplay.ts`
- Modify: `packages/agent/src/discoveryReplay.ts`
- Modify: `packages/agent/src/playwrightValidationRunner.ts`
- Test: `packages/agent/src/playwrightDiscoveryReplay.test.ts`
- Test: `packages/agent/src/discoveryReplay.test.ts`
- Test: `packages/agent/src/playwrightValidationRunner.test.ts`

- [x] **Step 1: Write failing fresh-replay tests**

Use a plan whose descriptive label names `2026 Kia Sorento A` but whose structure selects position 1 in `Vehicle results` after excluding marked promotions. Serve a fresh fixture with a new sponsored card inserted first and renamed ordinary listings. Assert replay clicks the renamed first ordinary listing. Add cases for a missing container, missing eligible position, and multiple matching links in the selected item; assert bounded `target_not_found` or `ambiguous_target` evidence and no label-only fallback.

- [x] **Step 2: Run replay tests and confirm RED**

Run: `rtk npm exec vitest -- run packages/agent/src/playwrightDiscoveryReplay.test.ts`

Expected: FAIL because `findMatches()` uses the stale exact accessible label globally.

- [x] **Step 3: Add authoritative structural resolution**

When `target.structure` exists, locate the visible container by accessible role, optional exact public label, and optional occurrence. Enumerate visible item roles in DOM order, filter items with explicit promotion markers when requested, select the one-based position, then find visible descendants by `target.role`. Return sanitized match metadata using the descriptive target label. Do not call the legacy global-label resolver from this branch.

- [x] **Step 4: Cover dry-run validation parity**

Add the same renamed-listing fixture to `playwrightValidationRunner.test.ts`. Extend its matching path to honor structural constraints so manual validation and discovery replay do not disagree about the selected item.

- [x] **Step 5: Write failing repair-preservation tests**

Create repair sessions that: (a) keep the same ordered structural constraints while changing descriptive labels, (b) remove structure, (c) change item position, (d) remove promotion exclusion, and (e) change container identity. Assert only (a) is accepted; the rest return:

```ts
{
  ok: false,
  code: "repair_structural_intent_mismatch",
  message: "Discovery replay repair changed structural positional intent."
}
```

- [x] **Step 6: Run repair tests and confirm RED**

Run: `rtk npm exec vitest -- run packages/agent/src/discoveryReplay.test.ts`

Expected: FAIL because repair currently accepts any changed selected path that preserves lineage, goal, profile, and policy scope.

- [x] **Step 7: Enforce ordered structural-intent equality**

Extract structural constraints from action target hints in plan order. When the current plan has any structural constraints, require the compiled repair plan to contain an identical ordered structural-constraint list. Add `repair_structural_intent_mismatch` to the public repair error union and return the stable non-secret failure above before starting another replay attempt.

- [x] **Step 8: Run replay, repair, and validation-runner tests and confirm GREEN**

Run: `rtk npm exec vitest -- run packages/agent/src/playwrightDiscoveryReplay.test.ts packages/agent/src/discoveryReplay.test.ts packages/agent/src/playwrightValidationRunner.test.ts`

Expected: PASS.

- [x] **Step 9: Commit replay and repair behavior**

```bash
git add packages/agent/src/playwrightDiscoveryReplay.ts packages/agent/src/playwrightDiscoveryReplay.test.ts packages/agent/src/discoveryReplay.ts packages/agent/src/discoveryReplay.test.ts packages/agent/src/playwrightValidationRunner.ts packages/agent/src/playwrightValidationRunner.test.ts
git commit -m "WES-267: replay structural target intent"
```

### Task 5: Resolve the same positional intent during approved recording

**Files:**

- Modify: `packages/capture/src/index.ts`
- Modify: `packages/capture/src/playwrightExecutionController.ts`
- Modify: `packages/agent/src/walkthroughExecution.ts`
- Test: `packages/capture/src/playwrightExecutionController.test.ts`
- Test: `packages/agent/src/walkthroughExecution.test.ts`

- [x] **Step 1: Write failing capture-controller tests**

Give `BrowserExecutionTarget` the structural fixture from Task 4 and assert click, select, and control-state assertion resolution all target the first non-promoted item after names change. Add missing, ambiguous, and explicitly promoted-only fixtures and assert safe failure without global label fallback.

- [x] **Step 2: Run capture tests and confirm RED**

Run: `rtk npm exec vitest -- run packages/capture/src/playwrightExecutionController.test.ts`

Expected: FAIL because `BrowserExecutionTarget` and `requireOneVisibleTarget()` accept only label, role, and occurrence.

- [x] **Step 3: Extend the capture target and resolver**

Add the same bounded structural shape to `BrowserExecutionTarget`. In `requireOneVisibleTarget`, use the structural container/item algorithm before the existing label matcher whenever structure is present. Keep the existing quiet-window behavior and return `target_not_found` or `ambiguous_target` without falling back.

- [x] **Step 4: Verify approved execution passes the complete hint through**

Add a public `executeWalkthroughPlan` test whose approved plan contains structure and assert the fake capture controller receives that full target object for click/select/assert operations. Update only the plan-to-capture conversion needed to clone the optional structure.

- [x] **Step 5: Run recording-path tests and confirm GREEN**

Run: `rtk npm exec vitest -- run packages/capture/src/playwrightExecutionController.test.ts packages/agent/src/walkthroughExecution.test.ts`

Expected: PASS.

- [x] **Step 6: Commit recording parity**

```bash
git add packages/capture/src/index.ts packages/capture/src/playwrightExecutionController.ts packages/capture/src/playwrightExecutionController.test.ts packages/agent/src/walkthroughExecution.ts packages/agent/src/walkthroughExecution.test.ts
git commit -m "WES-267: record structural target intent"
```

### Task 6: Document, verify, review, publish, and synchronize WES-267

**Files:**

- Modify: `packages/agent/README.md`
- Modify: `packages/agent/skills/codex-auto-demo/SKILL.md`
- Modify: `docs/linear/auto-demo-project-structure.md`
- Modify: `docs/superpowers/plans/2026-07-19-wes-267-improve-target-ranking-structural-positional-intent.md`
- Test: `packages/agent/src/wrapper-docs.test.ts`

- [x] **Step 1: Write failing documentation contract tests**

Assert public docs explain the 100-target bound, viewport/form ranking, reserved fallback capacity, structural results-order intent, explicit promoted-marker exclusion, authoritative fresh replay/recording resolution, repair preservation, and the prohibition on raw DOM/selectors or label-only fallback.

- [x] **Step 2: Run documentation tests and confirm RED**

Run: `rtk npm exec vitest -- run packages/agent/src/wrapper-docs.test.ts`

Expected: FAIL because the WES-267 behavior is not documented.

- [x] **Step 3: Update operator documentation and implementation evidence**

Document how an agent selects a structurally contextualized target and that the public label is descriptive once structural intent exists. Add the plan link to the project map and append exact implementation/test evidence. Keep WES-267 In Progress and WES-268 as the deterministic post-merge pointer until integration succeeds. Do not start WES-268 or WES-273.

- [x] **Step 4: Run focused documentation and formatting checks**

Run: `rtk npm exec vitest -- run packages/agent/src/wrapper-docs.test.ts`

Run: `rtk npm exec prettier -- --check packages/agent packages/capture docs/superpowers/specs/2026-07-19-wes-267-improve-target-ranking-structural-positional-intent-design.md docs/superpowers/plans/2026-07-19-wes-267-improve-target-ranking-structural-positional-intent.md docs/linear/auto-demo-project-structure.md`

Run: `rtk git diff --check`

Expected: all commands PASS.

- [x] **Step 5: Run the complete relevant local quality suite once**

Run: `rtk npm run validate`

Expected in the issue-owned tree: build, every workspace typecheck, tests, ESLint, and Prettier pass. If the preserved user-owned `workflow/` artifacts remain the only diagnostics, record them separately and use exact-head clean-checkout CI as the repository-wide final authority.

- [x] **Step 6: Request and evaluate independent read-only review**

Review WES-267, the design, this plan, and the complete issue diff. Fix valid Critical and Important findings and low-risk verified Minor findings through RED-GREEN; reject incorrect, stale, or scope-expanding findings with evidence. Re-run affected checks after every material correction.

- [x] **Step 7: Commit stable documentation and evidence**

```bash
git add packages/agent/README.md packages/agent/skills/codex-auto-demo/SKILL.md packages/agent/src/wrapper-docs.test.ts docs/superpowers/specs/2026-07-19-wes-267-improve-target-ranking-structural-positional-intent-design.md docs/superpowers/plans/2026-07-19-wes-267-improve-target-ranking-structural-positional-intent.md docs/linear/auto-demo-project-structure.md
git commit -m "WES-267: document structural target behavior"
```

- [ ] **Step 8: Publish and verify the implementation PR**

Push `wes-267-improve-target-ranking-positional-intent`; open a PR to `develop` referencing WES-267, the spec and plan, preserved unrelated files, and exact verification. Monitor structured check state and review threads. Diagnose any failed check with `gh-pr-failing-tests`, triage feedback with `gh-pr-review-triage`, apply issue-scoped fixes through TDD, and push until required checks pass with no unresolved actionable findings.

- [ ] **Step 9: Record final pre-merge evidence and merge**

Update the project map with exact PR head, CI run, review disposition, and WES-268 as the deterministic post-merge pointer. Search this plan for unchecked in-scope implementation items. Commit and push the stable evidence update, wait for its exact-head checks, and squash merge only when all acceptance and review gates pass.

- [ ] **Step 10: Synchronize the integration branch and Linear**

Verify the PR base repository is `origin`, switch to `develop`, fetch `origin/develop`, and run `rtk git pull --ff-only origin develop`. Confirm the squash commit locally. Run `linear-sync-gate` in completion mode with PR, squash commit, checks, tests, review, spec, plan, and map evidence. Add the WES-267 completion comment, move it to Done, add the readiness handoff to WES-268, reconcile WES-265 and WES-273, and set WES-268 as next without starting it.

- [ ] **Step 11: Publish a completion-sync PR only if the final gate requires tracked corrections**

If completion synchronization changes the tracked map or plan after the feature merge, create a scoped `wes-267-completion-sync` branch and PR to `develop`, wait for required checks, squash merge it, and fast-forward local `develop` again. Never push directly to `develop`.

- [ ] **Step 12: Confirm no unfinished in-scope work remains**

Run: `rtk rg -n '^\s*[-*]\s+\[ \]' docs/superpowers/plans/2026-07-19-wes-267-improve-target-ranking-structural-positional-intent.md`

Expected: no unfinished in-scope items. Any intentionally transferred work must be explicitly recorded against WES-268 or WES-273 rather than silently checked.
