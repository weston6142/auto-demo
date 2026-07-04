# WES-153 Persist Generated Polish Variant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project-owned persistence for generated polish variants so a generated baseline can be saved, reloaded, validated, and consumed by downstream workflows.

**Architecture:** Keep variant generation in `@auto-demo/polish` and add persistence to `@auto-demo/project`, where project layout and validation already live. The new `savePolishVariant()` API writes `variants/<id>.json`, appends the variant to `autodemo.project.json`, revalidates the project, and extends load/validate to check saved variant files.

**Tech Stack:** TypeScript, Node.js `fs/promises`, Node.js `path`, Vitest, npm workspaces, existing `@auto-demo/project` and `@auto-demo/polish` APIs.

---

## File Structure

- Modify `packages/project/src/index.test.ts`: add behavior-first persistence and validation tests.
- Modify `packages/polish/src/index.test.ts`: add generation-to-persistence round-trip coverage without making `@auto-demo/project` depend on `@auto-demo/polish`.
- Modify `packages/project/src/index.ts`: export save options/result types, implement `savePolishVariant()`, and validate derived variant files.
- Modify `packages/project/README.md`: document saved variant files and API.
- Modify `packages/polish/README.md`: document generation-to-persistence handoff.
- Modify `README.md`: update package/status text for persisted variants.
- Modify `docs/linear/auto-demo-project-structure.md`: record WES-153 investigation and completion evidence.
- Add `docs/superpowers/specs/2026-07-03-wes-153-persist-generated-polish-variant-design.md`.
- Add `docs/superpowers/plans/2026-07-03-wes-153-persist-generated-polish-variant.md`.

## Task 1: Add Failing Save And Round-Trip Tests

**Files:**

- Modify: `packages/project/src/index.test.ts`

- [ ] **Step 1: Import the new API**

Add `savePolishVariant` to the existing `@auto-demo/project` imports.

- [ ] **Step 2: Write the round-trip behavior test**

Add a test that imports a valid capture bundle, saves `validVariant`, checks `variants/checkout-focused.json`, reloads the project, and confirms raw media and event metadata bytes are unchanged.

- [ ] **Step 3: Verify RED**

Run:

```bash
npm --workspace @auto-demo/project test -- src/index.test.ts
```

Expected: fail because `savePolishVariant` is not exported.

## Task 2: Implement Minimal Variant Save

**Files:**

- Modify: `packages/project/src/index.ts`

- [ ] **Step 1: Add public types**

Export `SavePolishVariantOptions` with optional `now?: Date` and `SavePolishVariantResult = ProjectValidationResult`.

- [ ] **Step 2: Implement `savePolishVariant()`**

Validate the manifest with the appended variant before writing, create `variants/`, atomically write `variants/<variant.id>.json`, then call `saveProject()` with the updated manifest.

- [ ] **Step 3: Verify GREEN**

Run:

```bash
npm --workspace @auto-demo/project test -- src/index.test.ts
```

Expected: the new round-trip test passes; existing tests stay green.

## Task 3: Add Validation Tests For Saved Variant Files

**Files:**

- Modify: `packages/project/src/index.test.ts`

- [ ] **Step 1: Add duplicate-id no-overwrite test**

Save one variant, attempt to save another with the same id, assert an `invalid_project_manifest` duplicate-id error, and assert the original manifest and variant file contents remain unchanged.

- [ ] **Step 2: Add invalid variant no-write test**

Pass a variant with an unsafe source path, assert `unsafe_project_path`, and assert no `variants/<id>.json` file appears.

- [ ] **Step 3: Add missing variant file validation test**

Save a variant, remove `variants/<id>.json`, and assert `validateProject()` returns `missing_project_file`.

- [ ] **Step 4: Add invalid/mismatched variant file tests**

Save a variant, overwrite its file with invalid JSON and then mismatched JSON, and assert `validateProject()` returns `invalid_project_manifest`.

- [ ] **Step 5: Verify RED**

Run:

```bash
npm --workspace @auto-demo/project test -- src/index.test.ts
```

Expected: saved-variant file validation tests fail because `validateProject()` does not inspect variant files yet.

## Task 4: Validate Saved Variant Files

**Files:**

- Modify: `packages/project/src/index.ts`

- [ ] **Step 1: Include variant files in project file validation**

Extend `validateReferencedProjectFiles()` to require `variants/<id>.json` for every manifest variant.

- [ ] **Step 2: Parse and compare variant files**

Read each variant file, parse JSON, validate it as the only variant in a candidate manifest, and require the parsed object to equal the manifest variant. Return `invalid_project_manifest` for malformed or mismatched content without echoing raw JSON or paths.

- [ ] **Step 3: Verify GREEN**

Run:

```bash
npm --workspace @auto-demo/project test -- src/index.test.ts
```

Expected: all project tests pass.

## Task 5: Documentation And Full Validation

**Files:**

- Modify: `packages/polish/src/index.test.ts`
- Modify: `packages/project/README.md`
- Modify: `packages/polish/README.md`
- Modify: `README.md`
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Add polish handoff test**

In `packages/polish/src/index.test.ts`, save the generated baseline variant with `savePolishVariant()`, reload it with `loadProject()`, and assert the saved manifest contains the generated variant.

- [ ] **Step 2: Document saved variant contract**

Update docs to describe `savePolishVariant()`, `variants/<id>.json`, manifest indexing, reload validation, raw artifact immutability, and downstream handoff.

- [ ] **Step 3: Run focused checks**

Run:

```bash
npm --workspace @auto-demo/project test -- src/index.test.ts
npm --workspace @auto-demo/polish test -- src/index.test.ts
npm --workspace @auto-demo/project run typecheck
npm --workspace @auto-demo/project run build
```

Expected: all pass.

- [ ] **Step 4: Run package validation**

Run:

```bash
npm run validate
```

Expected: full repository validation passes.

## Plan Self-Review

- Spec coverage: tasks cover API, file write contract, load/validate checks, duplicate and unsafe failures, raw artifact preservation, WES-149 to WES-152 to WES-153 round trip, docs, and project-map updates.
- Placeholder scan: no TBD, TODO, or unspecified "add tests" steps remain.
- Type consistency: the plan uses `LoadedProject`, `ProjectVariant`, `ProjectValidationResult`, `saveProject()`, `validateProject()`, `savePolishVariant()`, and `generateBaselinePolishVariant()` names already present or introduced here. The round-trip generator test lives in `@auto-demo/polish` to avoid a package dependency cycle.
