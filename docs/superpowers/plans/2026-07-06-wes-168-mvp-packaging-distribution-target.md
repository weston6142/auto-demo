# WES-168 MVP Packaging And Distribution Target Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the MVP packaging target as a clean local checkout run path so WES-164 and WES-165 can implement and validate one explicit install/run contract without guessing.

**Architecture:** This is a docs-and-decision slice. `packages/cli` owns the package-local packaging contract, the root README owns the repo-wide install/run story, and a behavior-oriented Vitest suite protects the public contract. The Linear project map records the selected target and points the next implementation task at WES-164.

**Tech Stack:** Markdown docs, Vitest, npm workspaces, TypeScript, Linear CLI.

---

## File Structure

- Create `packages/cli/src/packaging-docs.test.ts`: behavior-oriented docs test for the packaging target.
- Create `packages/cli/README.md`: package-local packaging contract and repo-root invocation expectations.
- Modify `packages/cli/package.json`: include the docs test in the CLI package test script.
- Modify `README.md`: document the local-only packaging target, supported environment, setup commands, and repo-root run contract.
- Modify `docs/linear/auto-demo-project-structure.md`: add WES-168 spec/plan links, selection notes, and next-task pointer to WES-164.
- Create `docs/superpowers/specs/2026-07-06-wes-168-mvp-packaging-distribution-target-design.md`: design spec already written before this plan.
- Create `docs/superpowers/plans/2026-07-06-wes-168-mvp-packaging-distribution-target.md`: this plan.

### Task 1: Add The Failing Packaging Docs Test

**Files:**

- Create: `packages/cli/src/packaging-docs.test.ts`
- Modify: `packages/cli/package.json`

- [ ] **Step 1: Add the packaging docs test**

Create `packages/cli/src/packaging-docs.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const cliRoot =
  basename(process.cwd()) === "cli" ? process.cwd() : join(process.cwd(), "packages", "cli");
const repoRoot = basename(process.cwd()) === "cli" ? dirname(dirname(cliRoot)) : process.cwd();

async function readDoc(relativePath: string): Promise<string> {
  try {
    return await readFile(join(cliRoot, relativePath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function readRootDoc(relativePath: string): Promise<string> {
  return await readFile(join(repoRoot, relativePath), "utf8");
}

function normalizeWhitespace(markdown: string): string {
  return markdown.replace(/\s+/g, " ");
}

describe("CLI packaging decision documentation", () => {
  it("documents the MVP local-only packaging target and setup contract", async () => {
    const cliReadme = normalizeWhitespace(await readDoc("README.md"));
    const rootReadme = normalizeWhitespace(await readRootDoc("README.md"));
    const combined = `${cliReadme} ${rootReadme}`;

    for (const required of [
      "clean local checkout run path",
      "macOS",
      "Node 22",
      "npm 10",
      "npm install",
      "npm run build",
      "npm run setup:browser",
      "ffmpeg",
      "npm run autodemo --",
    ]) {
      expect(combined).toContain(required);
    }

    for (const deferred of [
      "registry publication",
      "Homebrew",
      "standalone distribution artifact",
    ]) {
      expect(combined).toContain(deferred);
    }
  });
});
```

- [ ] **Step 2: Add the test file to the CLI package script**

Update `packages/cli/package.json`:

```json
{
  "scripts": {
    "test": "vitest run src/index.test.ts src/defaultBackend.test.ts src/packaging-docs.test.ts"
  }
}
```

- [ ] **Step 3: Run the focused RED check**

Run:

```bash
rtk npm --workspace @auto-demo/cli test -- src/packaging-docs.test.ts
```

Expected: FAIL because the package-local README does not exist yet and the public docs do not yet state the selected local-only packaging target.

### Task 2: Document The Selected Packaging Target

**Files:**

- Create: `packages/cli/README.md`
- Modify: `README.md`

- [ ] **Step 1: Create the CLI package README**

Create `packages/cli/README.md`:

````md
# @auto-demo/cli

Provides the `autodemo` command and the repo-local command surface for capture,
generation, editor handoff, agent workflow orchestration, validation, and
export.

## MVP Packaging Target

WES-168 selected one MVP packaging target: a clean local checkout run path.
The MVP does not require registry publication, Homebrew, native installers, or
other standalone distribution artifacts.

Supported environment:

- macOS
- Node 22.x
- npm 10
- Playwright Chromium installed through `npm run setup:browser`
- `ffmpeg` available on `PATH`

Expected repo-root setup flow:

```bash
npm install
npm run build
npm run setup:browser
```
````

WES-164 should provide one repo-root wrapper contract for the existing CLI
subcommands. The intended operator-facing form is:

```bash
npm run autodemo -- <subcommand...>
```

The logical `autodemo` subcommand surface stays the same:

- `capture`
- `generate`
- `open`
- `agent run`
- `export`
- `validate`

## Deferrals

Registry publication, Homebrew formulas, native app packaging, bundled
standalone tarballs, hosted deployment, and managed updates remain out of scope
for the balanced MVP.

````

- [ ] **Step 2: Update the root README**

Update `README.md` so it includes:

```md
## MVP Packaging Target

WES-168 selects a clean local checkout run path as the packaging target for the
balanced MVP. The supported environment is macOS with Node 22.x, npm 10,
Playwright Chromium installed through `npm run setup:browser`, and `ffmpeg`
available on `PATH`.

The required setup path is `npm install`, `npm run build`, and
`npm run setup:browser`.

WES-164 owns adding and documenting one repo-root command wrapper for the
existing CLI surface. The intended MVP invocation contract is:

`npm run autodemo -- <subcommand...>`

Registry publication, Homebrew, native installers, and other standalone
distribution artifacts are deferred from the MVP.
````

Also update the status/CLI sections so they mention that packaging is local-only
for MVP and WES-164 still owns the repo-root wrapper implementation.

- [ ] **Step 3: Run the focused GREEN check**

Run:

```bash
rtk npm --workspace @auto-demo/cli test -- src/packaging-docs.test.ts
```

Expected: PASS because the public docs now preserve the packaging target.

### Task 3: Sync The Linear Project Map

**Files:**

- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Add WES-168 local context links**

Add:

```md
- WES-168 MVP packaging and distribution target design spec: `docs/superpowers/specs/2026-07-06-wes-168-mvp-packaging-distribution-target-design.md`
- WES-168 MVP packaging and distribution target implementation plan: `docs/superpowers/plans/2026-07-06-wes-168-mvp-packaging-distribution-target.md`
```

- [ ] **Step 2: Update the next-task pointer**

Replace the current selection rule note with:

```md
Prefer the earliest milestone with incomplete issues. Within that milestone, prefer started issues, then unblocked design/spec issues, then implementation issues whose dependencies are satisfied. Current next product task after WES-168 completion: WES-164, because the packaging target decision narrows the clean-checkout command surface and validation path before WES-165.
```

- [ ] **Step 3: Add investigation notes**

Record that WES-168 was moved to In Progress, the repo-root `npm exec autodemo`
path currently falls through to the public registry, the workspace-scoped
command works, and the selected MVP target is a clean local checkout run path
instead of a published or standalone distribution artifact.

### Task 4: Validate And Prepare The Commit

**Files:**

- Modify: `README.md`
- Create: `packages/cli/README.md`
- Create: `packages/cli/src/packaging-docs.test.ts`
- Modify: `packages/cli/package.json`
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Run focused CLI package checks**

Run:

```bash
rtk npm --workspace @auto-demo/cli test -- src/packaging-docs.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full repo validation**

Run:

```bash
rtk npm run validate
```

Expected: PASS.

- [ ] **Step 3: Review the scoped diff**

Run:

```bash
rtk git diff -- README.md packages/cli/README.md packages/cli/src/packaging-docs.test.ts packages/cli/package.json docs/linear/auto-demo-project-structure.md docs/superpowers/specs/2026-07-06-wes-168-mvp-packaging-distribution-target-design.md docs/superpowers/plans/2026-07-06-wes-168-mvp-packaging-distribution-target.md
```

Expected: only WES-168 docs, tests, and planning changes are present.

- [ ] **Step 4: Commit the selected issue scope**

Run:

```bash
git add README.md packages/cli/README.md packages/cli/src/packaging-docs.test.ts packages/cli/package.json docs/linear/auto-demo-project-structure.md docs/superpowers/specs/2026-07-06-wes-168-mvp-packaging-distribution-target-design.md docs/superpowers/plans/2026-07-06-wes-168-mvp-packaging-distribution-target.md
git commit -m "docs: decide WES-168 packaging target"
```

- [ ] **Step 5: Record readiness for firstmate**

Append:

```bash
echo "done: WES-168 implementation ready" >> '/Users/weston.bushyeager/code/personal/firstmate/state/auto-demo-next-ship-d4.status'
```

Expected: firstmate wakes for the post-commit validation phase.

## Self-Review

**1. Spec coverage:** The plan covers the selected target, public documentation, a behavior-oriented guardrail, project-map sync, focused validation, and commit scope.

**2. Placeholder scan:** No TODO/TBD markers remain. Commands, file paths, and expected changes are explicit.

**3. Type consistency:** The plan uses one stable topic name (`WES-168 MVP packaging and distribution target`) and one stable repo-root invocation form (`npm run autodemo -- <subcommand...>`).
