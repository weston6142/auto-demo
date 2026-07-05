# WES-159 Save Browser Edits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save browser-edited variant drafts back into Auto Demo project files so downstream export work can consume them.

**Architecture:** Keep durable project mutation inside `@auto-demo/project` and expose it through an editor-owned `POST /api/variants` endpoint. The browser keeps local draft editing, posts update/copy saves, then refreshes from `/api/project`.

**Tech Stack:** TypeScript, Node HTTP server, npm workspaces, Vitest behavior tests.

---

### Task 1: Add behavior tests and project persistence helper for upserting a saved variant.

**Files:**

- Modify: `packages/project/src/index.test.ts`
- Modify: `packages/project/src/index.ts`

- [ ] Add behavior tests covering replace/update, named copy, duplicate copy rejection, missing update target rejection, and saved project reload.
- [ ] Run `npm --workspace @auto-demo/project test` and confirm the new tests fail because the upsert API is missing.
- [ ] Add a project-owned `upsertSavedVariant()` helper with `update` and `copy` modes. It validates candidate manifests before writing `variants/<id>.json`, updates `updatedAt`, preserves unrelated variants, and returns structured validation errors for expected invalid save requests.
- [ ] Run `npm --workspace @auto-demo/project test` and confirm the project package passes.

### Task 2: Add editor HTTP test and `POST /api/variants` behavior.

**Files:**

- Modify: `packages/editor/src/index.test.ts`
- Modify: `packages/editor/src/index.ts`

- [ ] Add HTTP behavior tests for update save, copy save, invalid JSON/content type/mode, duplicate copy id, missing update target, and immediate `/api/project` discoverability.
- [ ] Run `npm --workspace @auto-demo/editor test` and confirm the new tests fail because the endpoint is missing.
- [ ] Implement `POST /api/variants` to parse JSON, validate mode-specific payload fields, call `upsertSavedVariant()`, reload the project through `loadEditorProject()`, and return concise non-secret JSON responses.
- [ ] Run `npm --workspace @auto-demo/editor test` and confirm the editor package passes.

### Task 3: Wire browser save controls to call the endpoint and refresh from `/api/project`.

**Files:**

- Modify: `packages/editor/src/index.test.ts`
- Modify: `packages/editor/src/index.ts`

- [ ] Add shell/script behavior tests asserting visible save controls and exercising update/copy save through the served script's public `fetch` boundary.
- [ ] Run `npm --workspace @auto-demo/editor test` and confirm the new UI save-flow tests fail.
- [ ] Add compact update and named-copy controls, status messaging, `saveVariant()` browser logic, and post-save refresh that selects the saved variant id from `/api/project`.
- [ ] Run `npm --workspace @auto-demo/editor test` and confirm the editor package passes.

### Task 4: Update docs/project map and run validation.

**Files:**

- Modify: `docs/linear/auto-demo-project-structure.md`
- Create: `docs/superpowers/specs/2026-07-05-wes-159-save-browser-edits-design.md`
- Create: `docs/superpowers/plans/2026-07-05-wes-159-save-browser-edits.md`

- [ ] Add WES-159 spec/plan links and an implementation note to the project map.
- [ ] Run focused tests: `npm --workspace @auto-demo/project test` and `npm --workspace @auto-demo/editor test`.
- [ ] Run full validation: `npm run validate`.
- [ ] Commit only scoped WES-159 files.
