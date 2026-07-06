# WES-167 Export Preset And Validation Fixture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the MVP export preset and canonical validation fixture decision so WES-163 and WES-165 can proceed without guessing render settings or sample expectations.

**Architecture:** This is a decision and documentation slice. Public docs state the selected `mp4-demo` preset, fixture, expected artifacts, fallback behavior, and deferrals; a Vitest documentation test verifies those public markers; the Linear project map records the corrected next-task selection.

**Tech Stack:** TypeScript, Vitest, npm workspaces, Markdown docs, Linear CLI.

---

## File Structure

- Create `packages/render/src/render-docs.test.ts`: behavior-oriented docs test for the public export preset decision.
- Modify `packages/render/package.json`: include the docs test in the render package test script.
- Modify `packages/render/README.md`: document `mp4-demo`, fixture identity, expected artifacts, fallback behavior, and deferrals.
- Modify `README.md`: update the product docs from "rendering planned" to "export preset selected; renderer implementation next."
- Modify `docs/linear/auto-demo-project-structure.md`: add WES-167 spec/plan links, correct WES-163/WES-167 state and next-task notes, and keep WES-163 as the next implementation task after WES-167.
- Create `docs/superpowers/specs/2026-07-06-wes-167-export-preset-validation-fixture-design.md`: design spec already written before this plan.
- Create `docs/superpowers/plans/2026-07-06-wes-167-export-preset-validation-fixture.md`: this plan.

### Task 1: Add Failing Documentation Behavior Test

**Files:**

- Create: `packages/render/src/render-docs.test.ts`
- Modify: `packages/render/package.json`

- [ ] **Step 1: Add render docs test file**

Create `packages/render/src/render-docs.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const renderRoot =
  basename(process.cwd()) === "render" ? process.cwd() : join(process.cwd(), "packages", "render");
const repoRoot =
  basename(process.cwd()) === "render" ? dirname(dirname(renderRoot)) : process.cwd();

async function readRenderDoc(relativePath: string): Promise<string> {
  return await readFile(join(renderRoot, relativePath), "utf8");
}

async function readRootDoc(relativePath: string): Promise<string> {
  return await readFile(join(repoRoot, relativePath), "utf8");
}

function normalizeWhitespace(markdown: string): string {
  return markdown.replace(/\s+/g, " ");
}

describe("render export decision documentation", () => {
  it("documents the MVP export preset and canonical validation fixture", async () => {
    const renderReadme = normalizeWhitespace(await readRenderDoc("README.md"));
    const rootReadme = normalizeWhitespace(await readRootDoc("README.md"));
    const combined = `${renderReadme} ${rootReadme}`;

    for (const required of [
      "mp4-demo",
      "MP4 container",
      "H.264",
      "yuv420p",
      "30 frames per second",
      "1280x720",
      "1024x768",
      "720x1280",
      "fixtures/export/basic-saved-variant",
      "baseline-polish",
      "exports/baseline-polish.mp4",
      "exports/baseline-polish.render.json",
    ]) {
      expect(combined).toContain(required);
    }

    for (const fallback of [
      "invalid project",
      "missing variant",
      "missing media",
      "unsupported preset",
      "renderer failure",
    ]) {
      expect(combined).toContain(fallback);
    }

    for (const deferral of [
      "Non-MP4 formats",
      "hosted rendering",
      "distinct high-fidelity production presets",
    ]) {
      expect(combined).toContain(deferral);
    }
  });
});
```

- [ ] **Step 2: Add the package test script**

Update `packages/render/package.json`:

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run src/render-docs.test.ts"
  }
}
```

- [ ] **Step 3: Run focused RED check**

Run:

```bash
rtk npm --workspace @auto-demo/render test -- src/render-docs.test.ts
```

Expected: FAIL because the public docs do not yet contain the selected preset and fixture decision.

### Task 2: Document The Export Preset Decision

**Files:**

- Modify: `packages/render/README.md`
- Modify: `README.md`

- [ ] **Step 1: Replace the render package README stub**

Replace `packages/render/README.md` with:

```md
# @auto-demo/render

Orchestrates rendering saved Auto Demo project variants into export artifacts.
WES-167 selected the MVP export preset and canonical validation fixture; WES-163
implements the renderer and CLI export path.

## MVP Export Preset

The first supported preset key is `mp4-demo`.

`mp4-demo` renders an MP4 container with H.264 video, `yuv420p` pixel format, 30
frames per second, and no audio track for the MVP fixture. Output dimensions are
derived from the saved variant's `exportIntent.aspectRatio`:

- `16:9`: `1280x720`
- `4:3`: `1024x768`
- `9:16`: `720x1280`

The `demo` quality target favors predictable local rendering over high bitrate.
The schema's `high` quality intent remains valid project data, but WES-163 may
map it to the same MVP settings until rendered output evidence justifies
distinct high-fidelity production presets.

## Canonical Validation Fixture

The canonical fixture for WES-163 and WES-165 is
`fixtures/export/basic-saved-variant`. It represents a completed browser capture
for "Checkout flow demo" at `https://example.com/checkout`, 1280x720 source
viewport media, one saved `baseline-polish` variant, and
`exportIntent: { format: "mp4", quality: "demo", aspectRatio: "16:9" }`.

Expected exported artifacts for that fixture are:

- `exports/baseline-polish.mp4`
- `exports/baseline-polish.render.json`

The render summary records the source project manifest path, source variant
identifier, preset key, render settings, output path, started and ended
timestamps, duration when available, and non-secret renderer diagnostics on
failure.

## Failure Contract

Export work should fail with structured, non-secret errors for invalid project
input, missing variant selection, missing media or metadata, unsupported preset
keys, unsupported non-MP4 variant export intent, and renderer failure. Renderer
diagnostics may include command name, exit code, preset key, variant id, and
project-relative output paths, but must not echo secret-bearing URLs, raw event
payloads, typed values, or arbitrary renderer output.

## Deferrals

Non-MP4 formats, hosted rendering, batch rendering infrastructure, package
distribution, curated marketing samples, and distinct high-fidelity production
presets are deferred until after the first local MP4 export path is validated.
```

- [ ] **Step 2: Update root README status and package sections**

In `README.md`, update the status paragraph so it states WES-167 selected the
`mp4-demo` preset while implementation remains WES-163 follow-up:

```md
`autodemo agent run` provides the first noninteractive agent handoff summary for selecting or generating saved variants and optionally starting the editor. The MVP export preset is selected as `mp4-demo`: MP4 container, H.264 video, `yuv420p`, 30 frames per second, 1280x720 for 16:9 saved variants, and a repo-owned `fixtures/export/basic-saved-variant` validation fixture. Renderer implementation and the `autodemo export` command remain planned WES-163 work.
```

Update the render package bullet:

```md
- `@auto-demo/render`: export and render orchestration boundary with the WES-167 `mp4-demo` preset and canonical fixture contract documented for WES-163 implementation.
```

Add a short Export Preset section near the CLI/export discussion:

```md
## Export Preset Decision

The MVP export preset key is `mp4-demo`. It targets MP4 container, H.264 video,
`yuv420p`, 30 frames per second, and dimensions derived from
`variant.exportIntent.aspectRatio`: `1280x720` for `16:9`, `1024x768` for `4:3`,
and `720x1280` for `9:16`. The canonical validation fixture is
`fixtures/export/basic-saved-variant`, with expected artifacts
`exports/baseline-polish.mp4` and `exports/baseline-polish.render.json` for the
saved `baseline-polish` variant.

Exporter failures should report structured non-secret causes for invalid
project input, missing variant selection, missing media or metadata, unsupported
preset keys, unsupported non-MP4 export intent, and renderer failure. Non-MP4
formats, hosted rendering, and distinct high-fidelity production presets remain
deferred.
```

- [ ] **Step 3: Run focused GREEN check**

Run:

```bash
rtk npm --workspace @auto-demo/render test -- src/render-docs.test.ts
```

Expected: PASS for render docs tests.

### Task 3: Sync The Project Map

**Files:**

- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Add WES-167 local context links**

Add after WES-162 links:

```md
- WES-167 export preset and validation fixture design spec: `docs/superpowers/specs/2026-07-06-wes-167-export-preset-validation-fixture-design.md`
- WES-167 export preset and validation fixture implementation plan: `docs/superpowers/plans/2026-07-06-wes-167-export-preset-validation-fixture.md`
```

- [ ] **Step 2: Update selection rule**

Replace the current WES-163 pointer with:

```md
Prefer the earliest milestone with incomplete issues. Within that milestone, prefer started issues, then unblocked design/spec issues, then implementation issues whose dependencies are satisfied. Current next product task after WES-167 completion: WES-163, because WES-167 removes the export preset and validation fixture ambiguity that blocked MP4 rendering.
```

- [ ] **Step 3: Correct issue states in Export And Packaging**

Set WES-167 to `In Progress` and WES-163 to `Backlog` while this issue is active:

```md
- WES-163: Render saved variants to MP4 artifacts - Backlog - https://linear.app/weston-bushyeager/issue/WES-163/render-saved-variants-to-mp4-artifacts
- WES-167: Open question: choose MVP export preset and validation fixture - In Progress - https://linear.app/weston-bushyeager/issue/WES-167/open-question-choose-mvp-export-preset-and-validation-fixture
```

- [ ] **Step 4: Add investigation note**

Append under `## Investigation Notes`:

```md
- 2026-07-06 WES-167 pre-task sync: the local next-task pointer to WES-163 was stale because live Linear shows WES-167 blocks WES-163 and WES-165. WES-163 was returned to Backlog, WES-167 was moved to In Progress on branch `fm/wes-167-export-preset-decision`, and the selected decision is the `mp4-demo` preset plus `fixtures/export/basic-saved-variant` canonical validation fixture.
```

- [ ] **Step 5: Run lightweight map/doc checks**

Run:

```bash
rtk rg -n "WES-167 export preset|mp4-demo|fixtures/export/basic-saved-variant|Current next product task after WES-167 completion" docs/linear/auto-demo-project-structure.md README.md packages/render/README.md
```

Expected: all decision markers are present.

### Task 4: Validate And Commit

**Files:**

- All WES-167 spec, plan, docs, tests, and project-map files.

- [ ] **Step 1: Run package and full validation**

Run:

```bash
rtk npm --workspace @auto-demo/render test -- src/render-docs.test.ts
rtk npm run validate
```

Expected: both commands pass.

- [ ] **Step 2: Review scoped diff**

Run:

```bash
rtk git diff -- README.md packages/render/README.md packages/render/package.json packages/render/src/render-docs.test.ts docs/linear/auto-demo-project-structure.md docs/superpowers/specs/2026-07-06-wes-167-export-preset-validation-fixture-design.md docs/superpowers/plans/2026-07-06-wes-167-export-preset-validation-fixture.md
```

Expected: diff only contains the WES-167 export preset decision, tests, spec/plan, and project map sync.

- [ ] **Step 3: Commit scoped files**

Run:

```bash
rtk git add README.md packages/render/README.md packages/render/package.json packages/render/src/render-docs.test.ts docs/linear/auto-demo-project-structure.md docs/superpowers/specs/2026-07-06-wes-167-export-preset-validation-fixture-design.md docs/superpowers/plans/2026-07-06-wes-167-export-preset-validation-fixture.md
rtk git commit -m "docs: choose WES-167 export preset"
```

Expected: commit succeeds with only WES-167 files staged.

### Task 5: no-mistakes And Completion Sync

**Files:**

- No direct source edits unless no-mistakes produces committed fixes.

- [ ] **Step 1: Run no-mistakes**

Run:

```bash
rtk no-mistakes axi run --intent "WES-167: choose the MVP export preset and canonical validation fixture for Auto Demo Export And Packaging. Record one stable mp4-demo preset with MP4/H.264/yuv420p/30fps settings, aspect-ratio dimensions, the fixtures/export/basic-saved-variant canonical fixture, expected MP4 and render-summary artifacts, structured fallback behavior, and explicit deferrals for non-MP4, hosted rendering, package distribution, curated marketing samples, and distinct high-fidelity presets. This is a decision/docs task validated with behavior-oriented documentation tests rather than implementation-detail prose checks."
```

Expected: no-mistakes reaches `checks-passed` or `passed`. If it parks at a gate, respond through `no-mistakes axi respond` rather than hand-editing around it.

- [ ] **Step 2: Run completion sync**

Use Linear CLI to add completion evidence to WES-167, move WES-167 to Done,
add readiness notes to WES-163 and WES-165, and update the project map with
no-mistakes/CI evidence. WES-139 remains open because WES-163, WES-164, WES-165,
and WES-168 are still incomplete.

- [ ] **Step 3: Classify completion-sync diff**

If only `docs/linear/auto-demo-project-structure.md` changed, commit the
docs-only sync, run `rtk git diff --check`, push/update the PR, wait for current
GitHub CI, and merge. If behavior-affecting files changed, commit and rerun
no-mistakes before merge.

## Plan Self-Review

- Spec coverage: the plan records the preset, codec/container, dimensions,
  fixture, expected artifacts, fallback behavior, deferrals, tests, and
  Linear/project-map sync.
- Placeholder scan: no TBD, TODO, or vague implementation steps remain.
- Type consistency: the new test uses existing Vitest/readFile patterns and
  checks public decision markers rather than exact heading order or private
  formatting.
