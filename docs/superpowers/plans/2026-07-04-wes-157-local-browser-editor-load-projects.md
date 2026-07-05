# WES-157 Local Browser Editor Project Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `autodemo open --project <project>` so an operator can start a local browser editor and inspect saved project variants.

**Architecture:** `@auto-demo/editor` owns project-loading summaries and a dependency-free local HTTP server. `@auto-demo/cli` parses the `open` command, starts the server through an injectable dependency, and prints the local URL. The UI is static HTML that calls `/api/project`; WES-157 does not add editing controls or preview rendering.

**Tech Stack:** TypeScript, Node `http`, Node filesystem/path utilities, `@auto-demo/project`, Vitest, npm workspaces.

---

### Task 1: Editor Project Loading API

**Files:**

- Modify: `packages/editor/package.json`
- Modify: `packages/editor/src/index.ts`
- Create: `packages/editor/src/index.test.ts`

- [ ] **Step 1: Write failing project-loading tests**

Add tests that create a real temporary Auto Demo project with one saved variant and assert:

```ts
const result = await loadEditorProject(projectDir);
expect(result.ok).toBe(true);
if (result.ok) {
  expect(result.project.name).toBe("Checkout flow demo");
  expect(result.project.variants).toEqual([
    expect.objectContaining({
      id: "baseline-polish",
      displayName: "Baseline Polish",
      timeline: { startMs: 1500, endMs: 2750 },
    }),
  ]);
}
```

Add a missing-project test:

```ts
const result = await loadEditorProject(join(tmpdir(), `missing-${randomUUID()}`));
expect(result.ok).toBe(false);
if (!result.ok) {
  expect(result.errors).toEqual([
    {
      code: "missing_project_manifest",
      message: "Auto Demo project manifest is missing.",
    },
  ]);
}
```

- [ ] **Step 2: Verify RED**

Run: `npm --workspace @auto-demo/editor test -- src/index.test.ts`

Expected: FAIL because the editor package has no `test` script and does not export `loadEditorProject()`.

- [ ] **Step 3: Implement minimal loading API**

Update `packages/editor/package.json` with:

```json
"scripts": {
  "build": "tsc -p tsconfig.json",
  "typecheck": "tsc -p tsconfig.json --noEmit",
  "test": "vitest run src/index.test.ts"
},
"dependencies": {
  "@auto-demo/project": "0.0.0"
}
```

In `packages/editor/src/index.ts`, import `loadProject` and expose `loadEditorProject(projectPath)`. On success, map `LoadedProject.manifest` to a small editor summary containing project paths, source status/url/duration/viewport, and variant cards. On failure, return the stable `errors` array from project validation.

- [ ] **Step 4: Verify GREEN**

Run: `npm --workspace @auto-demo/editor test -- src/index.test.ts`

Expected: PASS.

### Task 2: Editor HTTP Server

**Files:**

- Modify: `packages/editor/src/index.ts`
- Modify: `packages/editor/src/index.test.ts`

- [ ] **Step 1: Write failing server tests**

Add tests that start the server with a valid temp project, fetch `/`, and assert HTML contains `Auto Demo Editor`. Fetch `/api/project`, parse JSON, and assert the same project name and variant id. Fetch `/missing` and assert HTTP `404`.

- [ ] **Step 2: Verify RED**

Run: `npm --workspace @auto-demo/editor test -- src/index.test.ts`

Expected: FAIL because `startEditorServer()` is not exported.

- [ ] **Step 3: Implement minimal server**

Add `startEditorServer({ projectPath, host = "127.0.0.1", port = 0 })`. Use `node:http` to serve static HTML for `/`, JSON from `loadEditorProject()` for `/api/project`, and plain 404 for other paths. Return `{ url, close }`, where `close()` wraps `server.close()`.

- [ ] **Step 4: Verify GREEN**

Run: `npm --workspace @auto-demo/editor test -- src/index.test.ts`

Expected: PASS.

### Task 3: CLI Open Command

**Files:**

- Modify: `packages/cli/package.json`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/index.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Add tests:

```ts
const syncResult = runCli(["open"]);
expect(syncResult.stderr).toBe("autodemo open requires async execution.\n");
```

Add an async test with injected `startEditorServer` that returns `{ url: "http://127.0.0.1:4321/", close: async () => {} }`, then run:

```ts
const result = await runCliAsync(["open", "--project", projectDir, "--no-browser"], deps);
expect(result).toEqual({
  exitCode: 0,
  stdout: "Auto Demo editor: http://127.0.0.1:4321/\n",
  stderr: "",
});
```

Add argument failure tests for missing `--project`, unknown open argument, and invalid `--port`.

- [ ] **Step 2: Verify RED**

Run: `npm --workspace @auto-demo/cli test -- src/index.test.ts`

Expected: FAIL because `open` is still treated as a planned unimplemented command.

- [ ] **Step 3: Implement CLI open routing**

Add `@auto-demo/editor` as a CLI dependency. Import `startEditorServer`. Extend `CliDependencies` with an optional `startEditorServer`. Add `open` async routing in `runCliAsync()`, remove `open` from the planned command set, parse `--project`, `--host`, `--port`, and `--no-browser`, and print the returned URL.

- [ ] **Step 4: Verify GREEN**

Run: `npm --workspace @auto-demo/cli test -- src/index.test.ts`

Expected: PASS.

### Task 4: Documentation And Validation

**Files:**

- Modify: `README.md`
- Modify: `packages/editor/README.md`
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Document command behavior**

Document:

```bash
autodemo open --project <project-dir-or-manifest> [--host 127.0.0.1] [--port 0] [--no-browser]
```

Explain that WES-157 loads validated projects and lists saved variants; timeline controls, editing, preview rendering, and export remain planned.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npm --workspace @auto-demo/editor test -- src/index.test.ts
npm --workspace @auto-demo/cli test -- src/index.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run package checks**

Run:

```bash
npm --workspace @auto-demo/editor run typecheck
npm --workspace @auto-demo/editor run build
npm --workspace @auto-demo/cli run typecheck
npm --workspace @auto-demo/cli run build
```

Expected: PASS.

- [ ] **Step 4: Run repository validation**

Run: `npm run validate`

Expected: PASS.

- [ ] **Step 5: Commit scoped implementation**

Commit only WES-157 files:

```bash
git add README.md package-lock.json packages/editor package.json packages/cli docs/superpowers/specs/2026-07-04-wes-157-local-browser-editor-load-projects-design.md docs/superpowers/plans/2026-07-04-wes-157-local-browser-editor-load-projects.md docs/linear/auto-demo-project-structure.md
git commit -m "feat: serve local editor for project review"
```

### Self-Review

- Spec coverage: startup command, validation errors, variant listing, empty variant state, docs, and deferrals are covered.
- Placeholder scan: no plan steps rely on TBD behavior or unspecified tests.
- Type consistency: `loadEditorProject()`, `startEditorServer()`, `EditorServer`, and CLI dependency names are consistent across tasks.
