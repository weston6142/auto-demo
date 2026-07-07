# WES-164 Local Entrypoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add and document the repo-root `npm run autodemo -- <subcommand...>` clean-checkout wrapper for the existing Auto Demo CLI.

**Architecture:** Keep command behavior in `@auto-demo/cli`; the root package owns only the npm wrapper. Behavior tests exercise the documented public invocation and CLI help output instead of inspecting private script internals.

**Tech Stack:** npm workspaces, TypeScript, Vitest, Markdown docs.

---

## File Structure

- Modify `package.json`: add the root `autodemo` script that runs the built CLI.
- Modify `packages/cli/src/packaging-docs.test.ts`: update documentation expectations and add wrapper behavior coverage.
- Modify `README.md`, `packages/cli/README.md`, and `CONTRIBUTING.md`: make the repo-root wrapper the current contract and keep the workspace fallback as secondary.
- Modify `docs/linear/auto-demo-project-structure.md`: record WES-164 spec/plan and implementation notes.

### Task 1: Root Wrapper Behavior

**Files:**

- Test: `packages/cli/src/packaging-docs.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing wrapper behavior tests**

Add tests that extract the current invocation from `README.md`, run it with `--help`, and run export help through the root wrapper:

```typescript
it("documents the repo-root autodemo wrapper as the current clean-checkout invocation", async () => {
  const rootReadme = await readRootDoc("README.md");
  const documentedInvocation = extractCurrentInvocation(rootReadme);

  expect(documentedInvocation).toBe("npm run autodemo -- <subcommand...>");
});

it("routes export help through the documented repo-root wrapper", async () => {
  const result = spawnSync("npm", ["run", "autodemo", "--", "export", "--help"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("Usage: autodemo export");
  expect(result.stdout).toContain("--preset mp4-demo");
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
npm --workspace @auto-demo/cli test -- src/packaging-docs.test.ts
```

Expected: FAIL because the README still documents the workspace-scoped fallback as current and the root package lacks an `autodemo` script.

- [ ] **Step 3: Add the root wrapper script**

Change root `package.json` scripts to include:

```json
"autodemo": "node packages/cli/dist/index.js"
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
npm --workspace @auto-demo/cli test -- src/packaging-docs.test.ts
```

Expected: the wrapper help test can route to the built CLI after build, while the current-doc test still fails until documentation is updated.

### Task 2: Packaging Documentation

**Files:**

- Modify: `README.md`
- Modify: `packages/cli/README.md`
- Modify: `CONTRIBUTING.md`
- Test: `packages/cli/src/packaging-docs.test.ts`

- [ ] **Step 1: Update docs expectations first**

Update `packages/cli/src/packaging-docs.test.ts` so documentation checks require:

```typescript
("npm run autodemo --",
  "npm --workspace @auto-demo/cli run autodemo --",
  "current clean-checkout invocation contract");
```

and keep deferral checks for registry publication, Homebrew, and standalone distribution artifacts.

- [ ] **Step 2: Run the focused test and confirm it fails on docs**

Run:

```bash
npm --workspace @auto-demo/cli test -- src/packaging-docs.test.ts
```

Expected: FAIL until README and package docs describe the root wrapper as current.

- [ ] **Step 3: Update public docs**

Update `README.md`, `packages/cli/README.md`, and `CONTRIBUTING.md` so the supported clean-checkout path is:

```bash
npm install
npm run build
npm run setup:browser
npm run autodemo -- <subcommand...>
```

Keep the workspace-scoped command as a fallback for package-local diagnostics.

- [ ] **Step 4: Run the focused test**

Run:

```bash
npm --workspace @auto-demo/cli test -- src/packaging-docs.test.ts
```

Expected: PASS.

### Task 3: Validation And Project Map

**Files:**

- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Run package checks**

Run:

```bash
npm --workspace @auto-demo/cli test
npm run validate
```

Expected: both pass.

- [ ] **Step 2: Update the project map**

Add WES-164 spec and plan links in Local Context. Add an investigation/completion note stating that the root wrapper now runs the built CLI and WES-165 should validate the clean-checkout flow.

- [ ] **Step 3: Run lightweight doc verification**

Run:

```bash
git diff --check
npm --workspace @auto-demo/cli test -- src/packaging-docs.test.ts
```

Expected: both pass.

## Plan Self-Review

- Spec coverage: tasks cover the root wrapper, docs, behavior tests, validation, and project map updates.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: file paths, command names, and wrapper contract match the spec.
