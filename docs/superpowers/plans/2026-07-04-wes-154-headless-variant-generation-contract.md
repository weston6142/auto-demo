# WES-154 Headless Variant Generation Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first stable headless variant generation contract through a dry-run JSON CLI command and a public `@auto-demo/polish` API.

**Architecture:** Keep project file validation in `@auto-demo/project`, baseline generation in `@auto-demo/polish`, and CLI argument routing in `@auto-demo/cli`. The new polish API loads a project path, validates narrow WES-154 options, generates one baseline variant, and returns a compact machine-readable summary without saving files.

**Tech Stack:** TypeScript, npm workspaces, Vitest, Node `fs/promises`, existing `@auto-demo/project` and `@auto-demo/polish` packages.

---

## File Structure

- Modify `packages/polish/src/index.ts`: add headless generation option/result/error types and `generateHeadlessVariants()`.
- Modify `packages/polish/src/index.test.ts`: add behavior tests for API dry-run success, validation errors, unsupported options, and no project mutation.
- Modify `packages/polish/README.md`: document the API and WES-154 limitations.
- Modify `packages/cli/package.json`: add workspace dependencies on `@auto-demo/project` and `@auto-demo/polish`.
- Modify `packages/cli/src/index.ts`: route `autodemo generate`, parse supported flags, call `generateHeadlessVariants()`, and print JSON.
- Modify `packages/cli/src/index.test.ts`: replace the unimplemented `generate` assertion with behavior tests for JSON success and unsupported input.
- Modify `README.md`: document the first `autodemo generate` contract.
- Modify `docs/linear/auto-demo-project-structure.md`: sync WES-154 state and completion evidence after implementation.
- Add `docs/superpowers/specs/2026-07-04-wes-154-headless-variant-generation-contract-design.md`.
- Add `docs/superpowers/plans/2026-07-04-wes-154-headless-variant-generation-contract.md`.

---

### Task 1: Polish API Contract

**Files:**

- Modify: `packages/polish/src/index.test.ts`
- Modify: `packages/polish/src/index.ts`

- [ ] **Step 1: Write failing API tests**

Add tests that create valid project fixtures using the existing helper patterns, call `generateHeadlessVariants()`, and assert public result behavior:

```ts
it("returns a dry-run baseline summary without saving files", async () => {
  const project = await createLoadedProjectFixture("headless-api-success");

  const result = await generateHeadlessVariants({
    projectPath: project.projectDir,
    dryRun: true,
    json: true,
  });

  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error("expected generation to succeed");
  }
  expect(result.requested).toEqual({ count: 1, style: "baseline", dryRun: true });
  expect(result.project.name).toBe(project.manifest.name);
  expect(result.variants).toEqual([
    expect.objectContaining({
      id: "baseline-polish",
      displayName: "Baseline Polish",
      style: "baseline",
      source: expect.objectContaining({
        projectPath: project.projectDir,
        manifestPath: project.manifestPath,
        mediaPath: "raw/capture.webm",
        eventsPath: "metadata/events.jsonl",
      }),
      save: { mode: "dry-run", saved: false },
    }),
  ]);
  await expect(
    stat(join(project.projectDir, "variants", "baseline-polish.json")),
  ).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("returns structured errors for unsupported headless options", async () => {
  const project = await createLoadedProjectFixture("headless-api-unsupported");

  await expect(
    generateHeadlessVariants({
      projectPath: project.projectDir,
      dryRun: true,
      json: true,
      count: 2,
    }),
  ).resolves.toMatchObject({
    ok: false,
    errors: [{ code: "unsupported_variant_count" }],
  });
});
```

- [ ] **Step 2: Run API tests and verify red**

Run: `npm --workspace @auto-demo/polish test -- src/index.test.ts`

Expected: FAIL because `generateHeadlessVariants` is not exported.

- [ ] **Step 3: Implement minimal API**

Add exported types and `generateHeadlessVariants()` to `packages/polish/src/index.ts`. It should:

- default `count` to `1` and `style` to `"baseline"`;
- return `missing_project_path`, `unsupported_variant_count`, `unsupported_style`, `unsupported_save_mode`, or `unsupported_output_mode` before loading when options are unsupported;
- call `loadProject(projectPath)`;
- convert project validation failures to one `invalid_project` error per project error;
- call `generateBaselinePolishVariant()` and return one compact summary.

- [ ] **Step 4: Run API tests and verify green**

Run: `npm --workspace @auto-demo/polish test -- src/index.test.ts`

Expected: PASS.

---

### Task 2: CLI Generate Contract

**Files:**

- Modify: `packages/cli/package.json`
- Modify: `packages/cli/src/index.test.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Write failing CLI tests**

Add behavior tests for:

- `runCliAsync(["generate", "--project", project.projectDir, "--dry-run", "--json"])` exits `0`, prints parseable JSON with one baseline variant, and leaves stderr empty.
- `runCliAsync(["generate", "--dry-run", "--json"])` exits `1` and prints an `ok: false` JSON object with `missing_project_path`.
- `runCliAsync(["generate", "--project", project.projectDir, "--dry-run", "--json", "--style", "cinematic"])` exits `1` with `unsupported_style`.
- `runCliAsync(["generate", "--project", project.projectDir, "--dry-run"])` exits `1` with stderr `autodemo generate currently requires --json output.\n`.

- [ ] **Step 2: Run CLI tests and verify red**

Run: `npm --workspace @auto-demo/cli test -- src/index.test.ts`

Expected: FAIL because `generate` still routes to the planned-command error.

- [ ] **Step 3: Implement CLI routing**

In `packages/cli/src/index.ts`:

- import `generateHeadlessVariants`;
- remove `generate` from `plannedCommands`;
- route `generate` in `runCliAsync`;
- parse `--project`, `--dry-run`, `--json`, `--count`, `--style`, `--save`, and `--mode`;
- reject unknown options with structured JSON when `--json` is present;
- call `generateHeadlessVariants()` and serialize result with `JSON.stringify(result, null, 2) + "\n"`;
- return exit `0` for `ok: true`, otherwise exit `1`.

In `packages/cli/package.json`, add dependencies:

```json
"@auto-demo/polish": "0.0.0",
"@auto-demo/project": "0.0.0"
```

Keep prebuild/pretest behavior aligned with dependencies by building `@auto-demo/polish` before CLI compile/test.

- [ ] **Step 4: Run CLI tests and verify green**

Run: `npm --workspace @auto-demo/cli test -- src/index.test.ts`

Expected: PASS.

---

### Task 3: Documentation And Validation

**Files:**

- Modify: `README.md`
- Modify: `packages/polish/README.md`
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Update docs**

Document:

- `autodemo generate --project <project-dir-or-manifest> --dry-run --json`;
- only `--style baseline` and `--count 1` are supported in WES-154;
- the command emits JSON and does not save files yet;
- WES-155/WES-156 own named batches and save modes.

- [ ] **Step 2: Run focused package checks**

Run:

```bash
npm --workspace @auto-demo/polish test -- src/index.test.ts
npm --workspace @auto-demo/cli test -- src/index.test.ts
npm --workspace @auto-demo/polish run typecheck
npm --workspace @auto-demo/cli run typecheck
```

Expected: all pass.

- [ ] **Step 3: Run full validation**

Run: `npm run validate`

Expected: PASS.

- [ ] **Step 4: Commit scoped changes**

Run:

```bash
git add README.md packages/cli/package.json packages/cli/src/index.ts packages/cli/src/index.test.ts packages/polish/README.md packages/polish/src/index.ts packages/polish/src/index.test.ts docs/superpowers/specs/2026-07-04-wes-154-headless-variant-generation-contract-design.md docs/superpowers/plans/2026-07-04-wes-154-headless-variant-generation-contract.md docs/linear/auto-demo-project-structure.md
git commit -m "feat: add headless variant generation contract"
```

Expected: commit succeeds on `fm/wes-154`.

---

## Self-Review

- Spec coverage: the tasks cover the public API, CLI command, supported flags,
  structured JSON output, unsupported input, docs, and project map updates.
- Placeholder scan: no TBD, TODO, "implement later", or unspecified test steps
  remain.
- Type consistency: plan names `generateHeadlessVariants`,
  `HeadlessVariantGenerationResult`, `ProjectVariant`, `loadProject()`, and
  `generateBaselinePolishVariant()` consistently with existing package APIs.
