# WES-274 Screenshot Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give autonomous discovery bounded, focus-preserving visual feedback in every decision cycle without serializing image bytes or pretending page screenshots include native browser UI.

**Architecture:** Extend the existing screenshot artifact sink through the autonomous store, then load the current screenshot into a runtime-only decision-provider field. Playwright page screenshots cover page-rendered content; expanded native UI returns a bounded `visual_state_unavailable` result. The main agent executes this plan inline because `linear-deliver-next-task` overrides the generic execution handoff and forbids implementation subagents.

**Tech Stack:** TypeScript, Node.js filesystem/crypto, Playwright, Vitest, ESLint, Prettier

---

### Task 1: Lock the public visual feedback contract

**Files:**

- Modify: `packages/agent/src/autonomousDiscoveryRunner.test.ts`
- Modify: `packages/agent/src/autonomousDiscoveryRunner.ts`
- Modify: `packages/agent/src/index.ts`

- [x] **Step 1: Write the failing provider-boundary test**

Add a test decision provider that receives the same sanitized observation twice but returns different actions based only on the supplied PNG bytes. Assert the captured decision inputs expose this union and no textual/base64 image field:

```ts
type AutonomousDiscoveryVisualFeedback =
  | {
      status: "available";
      artifact: DiscoveryArtifactReference;
      bytes: Uint8Array;
    }
  | {
      status: "unavailable";
      code: "visual_state_unavailable";
      reason:
        "artifact_missing" | "artifact_invalid" | "native_ui_not_representable" | "capture_failed";
    };
```

- [x] **Step 2: Run RED**

Run:

```bash
rtk npm test --workspace @auto-demo/agent -- autonomousDiscoveryRunner.test.ts
```

Expected: FAIL because `decide()` has no `visual` input and the runner does not load image bytes.

- [x] **Step 3: Add the minimal exported runtime-only type**

Add `AutonomousDiscoveryVisualFeedback` and the `visual` property to `AutonomousDiscoveryDecisionProvider.decide()`. Export the type from `packages/agent/src/index.ts`. Do not add it to any durable session, checkpoint, plan, review, execution, or handoff type.

- [x] **Step 4: Keep the focused test compiling**

Run the same test. Expected: it still fails only because storage/loading and per-decision wiring do not exist.

### Task 2: Persist and safely load visual artifacts

**Files:**

- Modify: `packages/agent/src/autonomousDiscoveryStore.test.ts`
- Modify: `packages/agent/src/autonomousDiscoveryStore.ts`
- Modify: `packages/agent/src/discoveryContract.ts`

- [x] **Step 1: Write failing store behavior tests**

Cover atomic PNG write/load, missing artifacts, unsafe paths, wrong media types, hash mismatch, and oversize data. Assert JSON artifacts contain only the existing metadata reference and never the PNG byte sequence.

Use a dedicated bound:

```ts
visualArtifactBytes: 8 * 1024 * 1024,
```

Add the store contract:

```ts
writeVisualArtifact(input: {
  id: string;
  bytes: Uint8Array;
  mediaType: "image/png";
  sha256: string;
}): Promise<AutonomousDiscoveryStoreWriteResult>;

loadVisualArtifact(
  artifact: DiscoveryArtifactReference,
): Promise<{ ok: true; bytes: Uint8Array } | AutonomousDiscoveryStoreError>;
```

- [x] **Step 2: Run RED**

Run:

```bash
rtk npm test --workspace @auto-demo/agent -- autonomousDiscoveryStore.test.ts
```

Expected: FAIL because the visual store operations and byte bound do not exist.

- [x] **Step 3: Implement the minimal file-store operations**

Write images atomically below `visuals/<validated-id>.png`. On load, require a screenshot reference, `image/png`, a safe relative `visuals/` path, bounded bytes, and matching SHA-256 when present. Map every filesystem/validation failure to the existing bounded store error shape without raw paths or exception text.

- [x] **Step 4: Run GREEN and refactor**

Run the focused store test. Expected: PASS. Extract only validation shared by write/load; do not generalize to other binary media.

### Task 3: Report honest Playwright capture coverage

**Files:**

- Modify: `packages/agent/src/discoveryObservation.test.ts`
- Modify: `packages/agent/src/discoveryObservation.ts`
- Modify: `packages/agent/src/discoveryObservationTransform.ts`
- Modify: `packages/agent/src/playwrightDiscoveryObservation.test.ts`
- Modify: `packages/agent/src/playwrightDiscoveryPage.ts`

- [x] **Step 1: Write failing extractor and browser tests**

Add a deterministic page-rendered occluding-control fixture. Open it, focus an inner control, capture, and assert the open state and `document.activeElement` are unchanged while PNG bytes are stored.

Add an expanded native-select fixture and assert observation succeeds without a screenshot artifact and returns exactly one diagnostic:

```ts
{
  code: "visual_state_unavailable",
  message: "Visual state is unavailable because native browser UI cannot be represented.",
  count: 1,
}
```

- [x] **Step 2: Run RED**

Run:

```bash
rtk npm test --workspace @auto-demo/agent -- discoveryObservation.test.ts playwrightDiscoveryObservation.test.ts
```

Expected: FAIL because capture returns raw bytes and cannot distinguish incomplete native UI.

- [x] **Step 3: Implement the focus-neutral visual-state preflight**

Add an optional preflight beside `captureViewportPng()`:

```ts
type DiscoveryVisualStateResult =
  | { status: "available" }
  | {
      status: "unavailable";
      reason: "native_ui_not_representable" | "capture_failed";
    };
```

The extractor calls the preflight before screenshot capture. The Playwright implementation checks public expanded-native-control state without focusing or clicking. If present, return unavailable. Otherwise the extractor calls `page.screenshot({ type: "png" })`; thrown errors retain the existing bounded screenshot failure path and never include exception text.

- [x] **Step 4: Map the bounded diagnostic and run GREEN**

Add `visual_state_unavailable` to the diagnostic union/message map. Preserve `screenshot_unavailable` only for artifact-sink persistence failures. Run the focused tests and expect PASS.

### Task 4: Wire visual feedback into every autonomous decision

**Files:**

- Modify: `packages/agent/src/autonomousDiscoveryRunner.test.ts`
- Modify: `packages/agent/src/autonomousDiscoveryRunner.ts`
- Modify: `packages/agent/src/playwrightDiscoveryRehearsal.ts`
- Modify: `packages/agent/src/playwrightPolicyDiscoveryRehearsal.ts`

- [x] **Step 1: Write failing lifecycle tests**

Assert the provider gets `visual.status === "available"` for the initial decision and after a successful action. Add recoverable failed-action and no-effect fixtures with fresh observations and assert the next decision sees their images before choosing repair/abandonment. Add unavailable fixtures for no artifact, invalid artifact, and native UI.

- [x] **Step 2: Run RED**

Run:

```bash
rtk npm test --workspace @auto-demo/agent -- autonomousDiscoveryRunner.test.ts playwrightPolicyDiscoveryRehearsal.test.ts
```

Expected: FAIL because the Playwright controller has no store-backed sink and the runner terminates or decides without visual loading.

- [x] **Step 3: Add the store-backed artifact sink**

When the Playwright runner creates its controller, pass a sink whose `write()` calls `store.writeVisualArtifact()` and returns only the safe relative path. Do not expose the store directory or accept caller-supplied paths.

- [x] **Step 4: Resolve visual feedback immediately before decisions**

Select the current observation's screenshot reference, call `loadVisualArtifact()`, and build `AutonomousDiscoveryVisualFeedback`. If no trustworthy image exists, return a bounded unavailable reason. Pass it to `decide()` without storing it in session/checkpoint events.

- [x] **Step 5: Continue after recoverable observed failures**

When `perform()` returns a fresh observation and only recoverable action/no-effect diagnostics, persist the session and continue to the next decision. Preserve fail-closed termination for missing observations, browser loss, unsafe policy blocks, or hard controller errors.

- [x] **Step 6: Run GREEN and refactor**

Run the focused lifecycle tests. Expected: PASS with all four observation paths covered and no image bytes in recorded store events.

### Task 5: Document the public contract and inherited handoff

**Files:**

- Modify: `packages/agent/README.md`
- Modify: `packages/agent/skills/codex-auto-demo/SKILL.md`
- Modify: `packages/agent/src/wrapper-docs.test.ts`
- Modify: `docs/linear/auto-demo-project-structure.md`

- [x] **Step 1: Write failing documentation-contract assertions**

Require the README and skill to say that decisions receive image data through a runtime-only visual channel, native browser UI may return `visual_state_unavailable`, and image bytes never enter durable JSON or text prompts.

- [x] **Step 2: Run RED**

Run:

```bash
rtk npm test --workspace @auto-demo/agent -- wrapper-docs.test.ts
```

Expected: FAIL because the required visual decision guidance is absent.

- [x] **Step 3: Update docs and map**

Document the bounded API and security rules. Change the map date to 2026-07-21 and record WES-274 as In Progress based on the WES-273 visual-gap evidence but published independently from WES-273's paused commits. Keep WES-273 paused and WES-265 incomplete.

- [x] **Step 4: Run GREEN**

Run the focused docs test. Expected: PASS.

### Task 6: Verify, review, publish, merge, and synchronize

**Files:**

- Modify: `docs/superpowers/plans/2026-07-21-wes-274-screenshot-feedback-plan.md`
- Modify: `docs/linear/auto-demo-project-structure.md`

- [x] **Step 1: Run affected verification**

Run affected agent tests/typechecks, followed by issue-owned ESLint, Prettier, build, repository tests, and `git diff --check`. Verify the WES-274-only commit from a clean `develop` base. Use clean-checkout CI as final repository-wide authority if preserved `workflow/` artifacts remain the only local lint/format noise.

- [x] **Step 2: Request independent read-only review**

Give the reviewer WES-274, both WES-274 docs, the WES-273 handoff evidence, the full `origin/develop...HEAD` diff, and verification output. Fix every verified Critical/Important finding through RED-GREEN; verify and fix low-risk Minor findings.

- [x] **Step 3: Commit only issue-owned paths**

Stage explicit docs and package paths. Never stage `.gitignore` or `workflow/`. Publish WES-274 independently from WES-273's paused implementation history.

- [x] **Step 4: Publish the PR to `develop`**

Include Linear WES-274, design/plan paths, handoff explanation, exact verification, review result, and preserved unrelated paths. Monitor structured checks and review threads.

- [ ] **Step 5: Record stable pre-merge evidence and close plan omissions**

Update the map with exact-head CI and review evidence. Search this plan for unchecked implementation items; only merge/sync steps may remain.

- [ ] **Step 6: Squash merge and synchronize `develop`**

After required checks and actionable threads pass, squash merge. Verify `develop` tracks the base repository remote, fetch `origin/develop`, switch safely with unrelated changes preserved, and fast-forward only.

- [ ] **Step 7: Run the completion sync gate**

Add WES-274 completion evidence and move it to Done. Add a dependency-ready handoff to WES-273, advance the map pointer to WES-273, and keep WES-273 and WES-265 Backlog. If post-merge map drift requires a tracked correction, publish one scoped follow-up PR tied to WES-274.

- [ ] **Step 8: Confirm no unfinished WES-274 plan items**

Search:

```bash
rtk rg -n '^\s*[-*]\s+\[ \]' docs/superpowers/plans/2026-07-21-wes-274-screenshot-feedback-plan.md
```

Expected: no unfinished in-scope item remains.
