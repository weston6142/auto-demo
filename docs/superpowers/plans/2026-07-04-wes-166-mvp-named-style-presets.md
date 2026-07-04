# WES-166 MVP Named Style Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve WES-166 by making `baseline` the only approved MVP style preset and documenting that themed presets are post-MVP.

**Architecture:** Keep the decision narrow and package-owned in `@auto-demo/polish`, where headless generation already validates style keys. Export a tiny preset contract that downstream WES-155 can consume without adding renderer/editor coupling, then update user-facing docs and the Linear project map.

**Tech Stack:** TypeScript, Vitest, npm workspaces, Markdown docs.

---

## File Structure

- Modify `packages/polish/src/index.ts`: export `MvpStylePresetKey`, `MvpStylePreset`, and `MVP_STYLE_PRESETS`; keep headless generation behavior baseline-only.
- Modify `packages/polish/src/index.test.ts`: add behavior-focused test for the public preset contract and keep existing baseline/unsupported-style tests.
- Modify `README.md`: document that MVP named style presets are baseline-only and themed presets are deferred.
- Modify `packages/polish/README.md`: document the exported preset list and downstream contract.
- Modify `docs/linear/auto-demo-project-structure.md`: add WES-166 spec/plan links and investigation/completion notes.

## Task 1: Export The MVP Preset Contract

**Files:**

- Modify: `packages/polish/src/index.ts`
- Test: `packages/polish/src/index.test.ts`

- [ ] **Step 1: Write the failing public-contract test**

Add `MVP_STYLE_PRESETS` to the import list in `packages/polish/src/index.test.ts`:

```ts
import {
  MVP_STYLE_PRESETS,
  generateBaselinePolishVariant,
  generateHeadlessVariants,
} from "./index.js";
```

Add this test before the `generateBaselinePolishVariant` describe block:

```ts
describe("MVP style presets", () => {
  it("publishes baseline as the only approved MVP style preset", () => {
    expect(MVP_STYLE_PRESETS).toEqual([{ key: "baseline", displayName: "Baseline Polish" }]);
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
npm --workspace @auto-demo/polish test -- src/index.test.ts
```

Expected: FAIL because `MVP_STYLE_PRESETS` is not exported.

- [ ] **Step 3: Add the exported preset contract**

In `packages/polish/src/index.ts`, add the public types and constant after `polishPackageRole`:

```ts
/** Approved style keys for MVP headless generation. */
export type MvpStylePresetKey = "baseline";

/** Stable style preset metadata shared by headless generation and downstream UI planning. */
export type MvpStylePreset = {
  key: MvpStylePresetKey;
  displayName: "Baseline Polish";
};

/** The MVP intentionally ships only the conservative baseline preset. */
export const MVP_STYLE_PRESETS = [
  { key: "baseline", displayName: "Baseline Polish" },
] as const satisfies readonly MvpStylePreset[];
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```bash
npm --workspace @auto-demo/polish test -- src/index.test.ts
```

Expected: PASS, including the new public-contract test.

## Task 2: Document The Decision

**Files:**

- Modify: `README.md`
- Modify: `packages/polish/README.md`
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Update the root README headless generation section**

In `README.md`, replace the final paragraph of the headless generation section with:

```md
The command loads a valid Auto Demo project, generates one deterministic `baseline` variant summary, and prints machine-readable JSON with the generated id, display name, project source references, dry-run save status, validation errors, and non-secret warnings. The approved MVP style preset list is baseline-only: stable key `baseline`, display name `Baseline Polish`. WES-154 and WES-166 intentionally support only `--count 1`, `--style baseline`, `--dry-run`, and `--json`. Additional themed presets, selected/all save modes, run summary files, rendering, and exports remain planned follow-up work.
```

- [ ] **Step 2: Update the polish package README**

In `packages/polish/README.md`, replace the paragraph beginning `The WES-154 contract intentionally supports` with:

```md
The WES-166 MVP preset decision is baseline-only. `MVP_STYLE_PRESETS` exports one approved preset with stable key `baseline` and display name `Baseline Polish`, giving WES-155 and browser-editor planning a shared source of truth without introducing themed visual behavior before rendering/editor validation exists. Unsupported style keys, counts other than `1`, save modes, non-JSON output, and invalid project input return structured non-secret errors.
```

- [ ] **Step 3: Update the Linear project map local context**

In `docs/linear/auto-demo-project-structure.md`, add these bullets after the WES-154 plan link:

```md
- WES-166 MVP named style presets design spec: `docs/superpowers/specs/2026-07-04-wes-166-mvp-named-style-presets-design.md`
- WES-166 MVP named style presets implementation plan: `docs/superpowers/plans/2026-07-04-wes-166-mvp-named-style-presets.md`
```

- [ ] **Step 4: Update the Linear project map next-task rule**

Replace the current next-task pointer sentence with:

```md
Prefer the earliest milestone with incomplete issues. Within that milestone, prefer started issues, then unblocked design/spec issues, then implementation issues whose dependencies are satisfied. Current next product task after WES-166 completion: WES-155, because the MVP named style preset decision unblocks deterministic named variant batch generation.
```

- [ ] **Step 5: Add the WES-166 investigation note**

Add this note at the end of `## Investigation Notes`:

```md
- 2026-07-04 WES-166 decision: the MVP named style preset list is baseline-only with stable key `baseline` and display name `Baseline Polish`. Themed presets and browser preset pickers are deferred until rendering/editor fidelity can validate meaningful visual differences. WES-155 is unblocked to generate deterministic batches using only the approved baseline preset and structured errors for unsupported style keys.
```

## Task 3: Validate And Commit

**Files:**

- Modified files from Tasks 1 and 2

- [ ] **Step 1: Run focused polish tests**

Run:

```bash
npm --workspace @auto-demo/polish test -- src/index.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run package typecheck and build**

Run:

```bash
npm --workspace @auto-demo/polish run typecheck
npm --workspace @auto-demo/polish run build
```

Expected: both commands PASS.

- [ ] **Step 3: Run full repository validation**

Run:

```bash
npm run validate
```

Expected: PASS.

- [ ] **Step 4: Review scoped diff**

Run:

```bash
git diff -- docs/superpowers/specs/2026-07-04-wes-166-mvp-named-style-presets-design.md docs/superpowers/plans/2026-07-04-wes-166-mvp-named-style-presets.md packages/polish/src/index.ts packages/polish/src/index.test.ts README.md packages/polish/README.md docs/linear/auto-demo-project-structure.md
```

Expected: diff only contains the WES-166 preset decision, exported contract, behavior test, and docs/map updates.

- [ ] **Step 5: Commit scoped files**

Run:

```bash
git add docs/superpowers/specs/2026-07-04-wes-166-mvp-named-style-presets-design.md docs/superpowers/plans/2026-07-04-wes-166-mvp-named-style-presets.md packages/polish/src/index.ts packages/polish/src/index.test.ts README.md packages/polish/README.md docs/linear/auto-demo-project-structure.md
git commit -m "feat: define MVP style preset contract"
```

Expected: commit succeeds with only WES-166 files staged.

## Self-Review

- Spec coverage: the plan implements the baseline-only decision, exposes the single stable key/display name, documents WES-155/WES-158 direction, and keeps themed presets deferred.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: `MvpStylePresetKey`, `MvpStylePreset`, and `MVP_STYLE_PRESETS` names match between implementation and test steps.
