# WES-147 Capture Bundle Writer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write and validate the temporary Capture Runtime bundle manifest for WES-147.

**Architecture:** `@auto-demo/capture` owns the capture bundle manifest schema, writer, reader, and validator. The Playwright adapter writes the manifest after media and metadata artifacts are flushed, while `@auto-demo/cli` exposes a thin `autodemo validate <bundle-dir-or-manifest>` wrapper around the package API.

**Tech Stack:** TypeScript, Node `fs/promises`, Vitest, npm workspaces.

---

## File Structure

- Create `packages/capture/src/captureManifest.ts`: manifest types, writer, reader, validator, relative artifact path handling.
- Create `packages/capture/src/captureManifest.test.ts`: behavior tests for manifest writing and validation.
- Modify `packages/capture/src/index.ts`: export manifest APIs and add optional child command result to stop metadata.
- Modify `packages/capture/src/playwrightAdapter.ts`: write manifest after artifact flush.
- Modify `packages/capture/src/playwrightAdapter.test.ts`: verify stopped fake capture produces readable manifest.
- Modify `packages/capture/package.json`: include `captureManifest.test.ts` in focused package tests.
- Modify `packages/cli/src/index.ts`: implement `autodemo validate <bundle-dir-or-manifest>`.
- Modify `packages/cli/src/index.test.ts`: behavior tests for valid and invalid bundle validation.
- Modify `docs/linear/auto-demo-project-structure.md`: link WES-147 design and document temporary bundle status.

### Task 1: Capture Manifest API

**Files:**

- Create: `packages/capture/src/captureManifest.ts`
- Create: `packages/capture/src/captureManifest.test.ts`
- Modify: `packages/capture/src/index.ts`
- Modify: `packages/capture/package.json`

- [ ] **Step 1: Write failing manifest API tests**

Add tests that create a temp bundle with `media/viewport.webm` and `metadata/events.jsonl`, call `writeCaptureManifest()`, assert the JSON uses relative artifact paths and includes source, viewport, timing, status, tools, and child command result, then call `validateCaptureBundle()` and assert it succeeds.

Add a second test that writes malformed JSON or omits an artifact and asserts `validateCaptureBundle()` returns `ok: false` with a human-readable error.

- [ ] **Step 2: Run package tests to verify red**

Run: `rtk npm --workspace @auto-demo/capture test -- --run src/captureManifest.test.ts`

Expected: FAIL because `captureManifest.ts` and exports do not exist.

- [ ] **Step 3: Implement manifest API**

Implement `CaptureManifest`, `CaptureBundleValidationResult`, `writeCaptureManifest()`, `readCaptureManifest()`, and `validateCaptureBundle()` in `captureManifest.ts`.

Implementation rules:

- `schemaVersion` is `1`.
- Manifest artifact paths are relative to the bundle root and use forward slashes.
- Validation accepts either a bundle directory or direct manifest path.
- Validation checks required object fields, allowed status values, parseable ISO timing strings, nonnegative `durationMs`, and referenced `artifacts.media` and `artifacts.events` files.
- Expected invalid bundle conditions return `{ ok: false, errors }` rather than throwing.

- [ ] **Step 4: Export and wire package test script**

Export manifest APIs from `packages/capture/src/index.ts` and add `src/captureManifest.test.ts` to the capture package `test` script.

- [ ] **Step 5: Run package tests to verify green**

Run: `rtk npm --workspace @auto-demo/capture test -- --run src/captureManifest.test.ts`

Expected: PASS.

### Task 2: Adapter Manifest Writing

**Files:**

- Modify: `packages/capture/src/index.ts`
- Modify: `packages/capture/src/playwrightAdapter.ts`
- Modify: `packages/capture/src/playwrightAdapter.test.ts`

- [ ] **Step 1: Write failing adapter behavior test**

Extend the fake Playwright stop test to read `${outputDir}/capture.manifest.json` after `session.stop("completed")` and assert it contains status `completed`, source URL, adapter backend `playwright`, viewport, timing, tool versions, and relative artifact paths.

- [ ] **Step 2: Run adapter test to verify red**

Run: `rtk npm --workspace @auto-demo/capture test -- --run src/playwrightAdapter.test.ts`

Expected: FAIL because the manifest is not written.

- [ ] **Step 3: Add manifest writing to Playwright stop**

Store capture options in `PlaywrightCaptureSession` state. After metadata close, context close, browser close, video path retrieval, and media move, call `writeCaptureManifest()` with the output, source, viewport, status reason, adapter metadata, tool versions, and child command. Return the same public `CaptureOutput` shape.

- [ ] **Step 4: Run adapter test to verify green**

Run: `rtk npm --workspace @auto-demo/capture test -- --run src/playwrightAdapter.test.ts`

Expected: PASS.

### Task 3: CLI Capture Bundle Validation

**Files:**

- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/index.test.ts`

- [ ] **Step 1: Write failing CLI validation tests**

Add tests for:

- `runCliAsync(["validate"])` returns exit code `1` and usage text.
- A valid temp bundle returns exit code `0` and `Capture bundle valid: <manifest path>`.
- An invalid bundle returns exit code `1` and includes validation errors.

- [ ] **Step 2: Run CLI tests to verify red**

Run: `rtk npm --workspace @auto-demo/cli test -- --run src/index.test.ts`

Expected: FAIL because `autodemo validate` still reports unimplemented.

- [ ] **Step 3: Implement CLI validation**

Import `validateCaptureBundle()` from `@auto-demo/capture`. Route `validate` through `runCliAsync()` so it can await filesystem checks. Keep `runCli()` returning the existing async-required error for `validate` if needed, matching the current capture pattern.

- [ ] **Step 4: Run CLI tests to verify green**

Run: `rtk npm --workspace @auto-demo/cli test -- --run src/index.test.ts`

Expected: PASS.

### Task 4: Documentation And Validation

**Files:**

- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Update project map**

Add the WES-147 design spec to local context, update the next-task pointer from WES-145 to WES-147/WES-146 as appropriate, record the temporary bundle manifest format, and note that Demo Project Format remains a later milestone.

- [ ] **Step 2: Run focused tests**

Run:

```bash
rtk npm --workspace @auto-demo/capture test
rtk npm --workspace @auto-demo/cli test
```

Expected: PASS.

- [ ] **Step 3: Run repo validation suite**

Run: `rtk npm run validate`

Expected: PASS.

- [ ] **Step 4: Review intended diff**

Run:

```bash
rtk git status --short
rtk git diff -- docs/superpowers/specs/2026-06-29-wes-147-capture-bundle-writer-design.md docs/superpowers/plans/2026-06-29-wes-147-capture-bundle-writer.md packages/capture packages/cli docs/linear/auto-demo-project-structure.md
```

Expected: Diff contains only WES-147 implementation, tests, design/plan, and docs.
