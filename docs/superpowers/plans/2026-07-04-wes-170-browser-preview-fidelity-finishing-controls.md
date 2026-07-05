# WES-170 Browser Preview Fidelity And Finishing Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the WES-170 browser preview fidelity and MVP finishing-control decision, update downstream WES-158 scope, and validate the repo remains healthy.

**Architecture:** This is a product-decision and documentation issue, not a product-source implementation. The durable decision lives in a Superpowers spec, the local project map carries next-task orientation, and Linear WES-158 receives the executable acceptance criteria for implementation.

**Tech Stack:** Markdown docs, Linear CLI, npm workspace validation.

---

### Task 1: Persist The Decision Spec

**Files:**

- Create: `docs/superpowers/specs/2026-07-04-wes-170-browser-preview-fidelity-finishing-controls-design.md`

- [ ] **Step 1: Write the decision spec**

Create the spec with:

```markdown
# WES-170 Browser Preview Fidelity And Finishing Controls Design

Date: 2026-07-04

## Decision

WES-158 should target an approximate review UI, not exact exported-media parity.
The browser preview must be good enough for an operator to inspect timing,
framing intent, text overlays, and emphasis decisions before saving, but it is
not responsible for matching final rendered MP4 pixels.
```

The full spec must also name the schema-backed controls for `timeline`,
`viewport`, `captions`, `callouts`, `cursor`, `clicks`, and direct `style`
fields, plus the explicit deferral of named preset/theme picker UI.

- [ ] **Step 2: Verify the spec has no unfinished markers**

Run:

```bash
rg -n "FIXME|REPLACE_ME|DRAFT_ONLY" docs/superpowers/specs/2026-07-04-wes-170-browser-preview-fidelity-finishing-controls-design.md
```

Expected: no matches and exit code `1`.

### Task 2: Update Local Orientation Docs

**Files:**

- Modify: `README.md`
- Modify: `packages/editor/README.md`
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Update `README.md` Browser Editor status**

Change the editor paragraph so it says WES-170 chose approximate browser review
fidelity for WES-158, with schema-backed finishing controls and no MVP named
preset picker.

- [ ] **Step 2: Update `packages/editor/README.md` planned follow-up text**

Replace the generic follow-up sentence with a concrete WES-170 note:

```markdown
WES-170 chose approximate browser review fidelity for WES-158. The next editor
slice should add schema-backed trim, viewport, caption/callout, cursor/click,
and direct style controls while deferring exact export parity, named preset
pickers, export rendering, browser auto-launch, and hosted deployment.
```

- [ ] **Step 3: Update the project map**

In `docs/linear/auto-demo-project-structure.md`:

- add the WES-170 design spec to Local Context;
- mark WES-170 as In Progress while implementation is active;
- update the next-task selection rule so WES-170 is the current active task;
- add an investigation note summarizing the decision and WES-158 readiness.

- [ ] **Step 4: Run Markdown formatting check**

Run:

```bash
npm run format:check -- docs/superpowers/specs/2026-07-04-wes-170-browser-preview-fidelity-finishing-controls-design.md docs/superpowers/plans/2026-07-04-wes-170-browser-preview-fidelity-finishing-controls.md README.md packages/editor/README.md docs/linear/auto-demo-project-structure.md
```

Expected: Prettier reports all matched files use Prettier style.

### Task 3: Update Linear Scope

**Files:**

- Linear issue WES-158
- Linear issue WES-170

- [ ] **Step 1: Update WES-158 description**

Use the Linear CLI to update WES-158 acceptance criteria with the WES-170
decision:

```bash
/opt/homebrew/bin/linear issue update WES-158 --description-file /tmp/wes-158-description.md
```

The description must state approximate review fidelity is acceptable, exact
exported-media parity is deferred, controls must write only schema-backed
`ProjectVariant` fields, named preset/theme picker UI is hidden for MVP, and
WES-159 owns persistence of edited variants.

- [ ] **Step 2: Add a WES-158 readiness note**

Run:

```bash
/opt/homebrew/bin/linear issue comment add WES-158 -b "Readiness note: WES-170 selected approximate browser review fidelity for WES-158. Implement schema-backed trim, viewport, caption/callout, cursor/click, and direct style controls only; hide named preset/theme picker UI for MVP; defer exact export parity to Export And Packaging. No secret values included."
```

- [ ] **Step 3: Add WES-170 completion evidence after validation**

After local validation and no-mistakes pass, add concise evidence to WES-170 and
move it to Done.

### Task 4: Validate And Commit

**Files:**

- All changed docs

- [ ] **Step 1: Run repository validation**

Run:

```bash
npm run validate
```

Expected: build, typecheck, lint, tests, and format check pass.

- [ ] **Step 2: Review changed files**

Run:

```bash
git status --short
git diff --check
git diff -- README.md packages/editor/README.md docs/linear/auto-demo-project-structure.md docs/superpowers/specs/2026-07-04-wes-170-browser-preview-fidelity-finishing-controls-design.md docs/superpowers/plans/2026-07-04-wes-170-browser-preview-fidelity-finishing-controls.md
```

Expected: only WES-170 docs, plan, and map changes are present; `git diff
--check` exits `0`.

- [ ] **Step 3: Commit scoped changes**

Run:

```bash
git add README.md packages/editor/README.md docs/linear/auto-demo-project-structure.md docs/superpowers/specs/2026-07-04-wes-170-browser-preview-fidelity-finishing-controls-design.md docs/superpowers/plans/2026-07-04-wes-170-browser-preview-fidelity-finishing-controls.md
git commit -m "docs: decide browser editor MVP controls"
```

Expected: commit succeeds on branch `fm/wes-170`.

## Self-Review

- Spec coverage: the plan persists the WES-170 decision, updates local docs and
  WES-158 scope, validates the repo, and commits only scoped files.
- Unfinished-marker scan: no draft implementation steps remain.
- Type consistency: all field names match the current `ProjectVariant` schema in
  `@auto-demo/project`.
