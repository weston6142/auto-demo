# WES-158 Timeline Preview And Finishing Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an approximate local browser editor preview and schema-backed finishing controls for loaded MVP variants.

**Architecture:** Keep the server read-only and expand the public editor project summary so the browser shell receives complete `ProjectVariant` data plus media path context. Implement draft editing in the static shell as local browser state only, with reset and edited JSON output preparing WES-159 persistence without writing files.

**Tech Stack:** TypeScript, Node HTTP server, Vitest, npm workspaces, `@auto-demo/project` schema types.

---

### Task 1: Expand Editor Variant Summary

**Files:**

- Modify: `packages/editor/src/index.ts`
- Test: `packages/editor/src/index.test.ts`

- [ ] **Step 1: Write the failing summary test**

Add an assertion to `loadEditorProject` that the returned variant includes
source, viewport, cursor, clicks, captions, callouts, full style, and export
intent. Run:

```bash
npm --workspace @auto-demo/editor test -- src/index.test.ts
```

Expected: fail because the summary currently omits these fields.

- [ ] **Step 2: Implement the public summary**

Update `EditorProjectVariantSummary` and `loadEditorProject()` to return the full
schema-backed variant decisions while preserving existing project/source fields.

- [ ] **Step 3: Verify the focused test passes**

Run:

```bash
npm --workspace @auto-demo/editor test -- src/index.test.ts
```

Expected: pass.

### Task 2: Serve The Preview And Controls Shell

**Files:**

- Modify: `packages/editor/src/index.ts`
- Test: `packages/editor/src/index.test.ts`

- [ ] **Step 1: Write the failing shell test**

Extend the `startEditorServer` shell test to assert the served HTML contains
operator-visible controls for trim, viewport, captions, callouts, cursor,
clicks, style, reset, and edited variant JSON, and does not contain named preset
picker text.

- [ ] **Step 2: Implement the shell**

Replace the variant-list-only HTML with a compact editor surface:

- project and source summary;
- variant selector;
- approximate media preview;
- trim, viewport, caption, callout, cursor, click, and style controls;
- read-only export intent;
- reset button;
- edited variant JSON panel.

The browser JavaScript should edit local draft state only and clamp values to the
same broad ranges as the project schema.

- [ ] **Step 3: Verify the focused test passes**

Run:

```bash
npm --workspace @auto-demo/editor test -- src/index.test.ts
```

Expected: pass.

### Task 3: Update Docs And Project Map

**Files:**

- Modify: `README.md`
- Modify: `packages/editor/README.md`
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Document WES-158 behavior**

Update README/editor README language from planned controls to current approximate
preview and local draft controls, making clear persistence remains WES-159.

- [ ] **Step 2: Update the project map**

Add the WES-158 spec and plan paths, mark WES-158 active/in progress while the
branch is open, and note the selected scope and deferrals.

- [ ] **Step 3: Verify Markdown formatting**

Run:

```bash
npm run format:check -- README.md packages/editor/README.md docs/linear/auto-demo-project-structure.md docs/superpowers/specs/2026-07-05-wes-158-timeline-preview-finishing-controls-design.md docs/superpowers/plans/2026-07-05-wes-158-timeline-preview-finishing-controls.md
```

Expected: Prettier reports all matched files use Prettier style.

### Task 4: Final Local Validation And Commit

**Files:**

- All scoped WES-158 files

- [ ] **Step 1: Run repository validation**

Run:

```bash
npm run validate
```

Expected: build, typecheck, lint, tests, and format check pass.

- [ ] **Step 2: Review diff hygiene**

Run:

```bash
git status --short
git diff --check
```

Expected: only WES-158 implementation, docs, spec, plan, and project map changes
are present; whitespace check exits `0`.

- [ ] **Step 3: Commit scoped changes**

Run:

```bash
git add packages/editor/src/index.ts packages/editor/src/index.test.ts README.md packages/editor/README.md docs/linear/auto-demo-project-structure.md docs/superpowers/specs/2026-07-05-wes-158-timeline-preview-finishing-controls-design.md docs/superpowers/plans/2026-07-05-wes-158-timeline-preview-finishing-controls.md
git commit -m "feat: add editor preview controls"
```

Expected: commit succeeds on branch `fm/wes-158`.

## Self-Review

- Spec coverage: tasks cover full variant data, approximate preview, required
  controls, reset/local draft behavior, docs, and validation.
- Placeholder scan: no placeholder implementation steps remain.
- Type consistency: all field names match the current `ProjectVariant` schema.
