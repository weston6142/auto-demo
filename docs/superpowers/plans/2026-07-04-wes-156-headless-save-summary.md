# WES-156 Headless Save Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add selected/all save modes to headless variant generation and return JSON summaries of saved, skipped, and validated project state.

**Architecture:** Keep project persistence in `@auto-demo/project` through `savePolishVariant()`, and keep headless orchestration in `@auto-demo/polish`. The CLI only parses `--save <variant-id|all>` and prints the API result as JSON.

**Tech Stack:** TypeScript, npm workspaces, Node `fs/promises`, Vitest, existing `@auto-demo/project`, `@auto-demo/polish`, and `@auto-demo/cli` packages.

---

## File Structure

- Modify `packages/polish/src/index.test.ts`: behavior-first API tests for selected save, save-all, invalid selection, duplicate ids, and dry-run summary.
- Modify `packages/polish/src/index.ts`: add save-mode option/result types, validate save requests, call `savePolishVariant()`, and build saved/skipped/validation summaries.
- Modify `packages/cli/src/index.test.ts`: behavior-first CLI tests for `--save baseline-polish`, `--save all`, dry-run/save conflict, and missing save value.
- Modify `packages/cli/src/index.ts`: parse `--save <variant-id|all>`, pass `selectedVariantId`, and preserve structured JSON errors.
- Modify `README.md`, `packages/polish/README.md`, and `packages/project/README.md`: replace WES-155 save-mode deferrals with the new WES-156 contract.
- Modify `docs/linear/auto-demo-project-structure.md`: record WES-156 spec/plan and sync notes.

## Task 1: Polish API Save Behavior

- [x] **Step 1: Write failing API tests**

Add tests in `packages/polish/src/index.test.ts` under `describe("generateHeadlessVariants", () => { ... })`:

```ts
it("saves a selected generated variant and reports reload validation", async () => {
  const project = await writeLoadedProject([
    {
      id: "event-1",
      sequence: 1,
      type: "click",
      timestampMs: 2000,
      viewport: { width: 1280, height: 720 },
      data: { x: 960, y: 360 },
    },
  ]);
  const { variant } = await generateBaselinePolishVariant(project);
  await savePolishVariant(project, {
    ...variant,
    id: "source-baseline",
    displayName: "Source Baseline",
  });

  const result = await generateHeadlessVariants({
    projectPath: project.projectDir,
    json: true,
    styles: ["baseline"],
    sourceVariantId: "source-baseline",
    save: true,
    selectedVariantId: "baseline-polish",
  });

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected selected save to succeed");
  expect(result.summary).toEqual({
    mode: "selected",
    saved: [{ id: "baseline-polish", path: "variants/baseline-polish.json" }],
    skipped: [],
    validation: { ok: true, manifestPath: project.manifestPath },
    nextSteps: ["open-editor", "export-variant"],
  });
  expect(result.variants[0].save).toEqual({
    mode: "selected",
    saved: true,
    path: "variants/baseline-polish.json",
  });
  await expect(loadProject(project.projectDir)).resolves.toMatchObject({
    ok: true,
    manifest: {
      variants: expect.arrayContaining([expect.objectContaining({ id: "baseline-polish" })]),
    },
  });
});

it("saves all generated variants and reports saved paths", async () => {
  const project = await writeLoadedProject([
    { id: "event-1", sequence: 1, type: "press", timestampMs: 1000 },
  ]);
  const { variant } = await generateBaselinePolishVariant(project);
  await savePolishVariant(project, {
    ...variant,
    id: "source-baseline",
    displayName: "Source Baseline",
  });

  const result = await generateHeadlessVariants({
    projectPath: project.projectDir,
    json: true,
    styles: ["baseline"],
    sourceVariantId: "source-baseline",
    save: true,
    mode: "all",
  });

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected save all to succeed");
  expect(result.summary.mode).toBe("all");
  expect(result.summary.saved).toEqual([
    { id: "baseline-polish", path: "variants/baseline-polish.json" },
  ]);
  expect(result.summary.skipped).toEqual([]);
});

it("rejects an invalid selected generated variant without writing", async () => {
  const project = await writeLoadedProject([
    { id: "event-1", sequence: 1, type: "press", timestampMs: 1000 },
  ]);
  const { variant } = await generateBaselinePolishVariant(project);
  await savePolishVariant(project, {
    ...variant,
    id: "source-baseline",
    displayName: "Source Baseline",
  });

  const result = await generateHeadlessVariants({
    projectPath: project.projectDir,
    json: true,
    styles: ["baseline"],
    sourceVariantId: "source-baseline",
    save: true,
    selectedVariantId: "missing",
  });

  expect(result.ok).toBe(false);
  expect(result.errors).toContainEqual({
    code: "invalid_selected_variant",
    message: expect.any(String),
  });
  await expect(
    stat(join(project.projectDir, "variants", "baseline-polish.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});
```

- [x] **Step 2: Run failing API tests**

Run: `npm --workspace @auto-demo/polish test -- src/index.test.ts`

Expected before implementation: failing test output for missing `selectedVariantId`, `summary`, and save-mode behavior.

- [x] **Step 3: Implement polish save modes**

In `packages/polish/src/index.ts`:

- import `savePolishVariant` from `@auto-demo/project`;
- add `selectedVariantId?: string` to `HeadlessVariantGenerationOptions`;
- extend error codes with `invalid_selected_variant`, `duplicate_variant_id`, and `unsafe_variant_path`;
- change save status and success result types to include saved/skipped summary;
- normalize `save + selectedVariantId` to selected mode and `mode: "all"` to all mode;
- reject `dryRun && save`, `save && mode` except `mode === "all"`, and selected ids not found in generated summaries;
- before saving, reject generated ids that already exist in `loadedProject.manifest.variants`;
- call `savePolishVariant()` for selected variants and build saved paths as `variants/<id>.json`;
- return final validation from the last successful `savePolishVariant()` result.

- [x] **Step 4: Run API tests**

Run: `npm --workspace @auto-demo/polish test -- src/index.test.ts`

Expected after implementation: pass all polish tests.

## Task 2: CLI Save Flags

- [x] **Step 1: Write failing CLI tests**

Add tests in `packages/cli/src/index.test.ts` under `describe("runCliAsync generate", () => { ... })`:

```ts
it("prints selected save summary as JSON", async () => {
  const projectDir = await createValidProject();

  const result = await runCliAsync([
    "generate",
    "--project",
    projectDir,
    "--json",
    "--save",
    "baseline-polish",
  ]);
  const output = JSON.parse(result.stdout) as {
    ok: boolean;
    summary: {
      mode: string;
      saved: Array<{ id: string; path: string }>;
      validation: { ok: boolean };
    };
  };

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(output.ok).toBe(true);
  expect(output.summary).toMatchObject({
    mode: "selected",
    saved: [{ id: "baseline-polish", path: "variants/baseline-polish.json" }],
    validation: { ok: true },
  });
});

it("prints save-all summary as JSON", async () => {
  const projectDir = await createValidProject();

  const result = await runCliAsync([
    "generate",
    "--project",
    projectDir,
    "--json",
    "--save",
    "all",
  ]);
  const output = JSON.parse(result.stdout) as {
    ok: boolean;
    summary: { mode: string; saved: Array<{ id: string }> };
  };

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(output.ok).toBe(true);
  expect(output.summary.mode).toBe("all");
  expect(output.summary.saved).toEqual([
    { id: "baseline-polish", path: "variants/baseline-polish.json" },
  ]);
});

it("returns a structured JSON error when dry-run is combined with save", async () => {
  const projectDir = await createValidProject();

  const result = await runCliAsync([
    "generate",
    "--project",
    projectDir,
    "--dry-run",
    "--json",
    "--save",
    "baseline-polish",
  ]);
  const output = JSON.parse(result.stdout) as { ok: boolean; errors: Array<{ code: string }> };

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe("");
  expect(output.ok).toBe(false);
  expect(output.errors).toContainEqual({
    code: "unsupported_save_mode",
    message: expect.any(String),
  });
});
```

- [x] **Step 2: Run failing CLI tests**

Run: `npm --workspace @auto-demo/cli test -- src/index.test.ts`

Expected before implementation: failing test output for missing `--save` value parsing and save-mode behavior.

- [x] **Step 3: Implement CLI parsing**

In `packages/cli/src/index.ts`:

- add `selectedVariantId?: string` to `ParsedGenerateCommand`;
- parse `--save <value>`, where `all` sets `mode = "all"` and other values set `selectedVariantId = value`;
- return `unknown_generate_argument` when `--save` has no value;
- pass `selectedVariantId` to `generateHeadlessVariants()`;
- include `selectedVariantId` only in API options, not in parse-failure result unless an error message needs it.

- [x] **Step 4: Run CLI tests**

Run: `npm --workspace @auto-demo/cli test -- src/index.test.ts`

Expected after implementation: pass all CLI tests.

## Task 3: Documentation And Validation

- [x] **Step 1: Update docs**

Update `README.md`, `packages/polish/README.md`, and `packages/project/README.md` so they describe:

- `autodemo generate --project <project> --json --save baseline-polish`;
- `autodemo generate --project <project> --json --save all`;
- JSON summary fields for saved paths, skipped variants, validation, and next steps;
- raw capture artifacts remain immutable because persistence uses `savePolishVariant()`;
- rendering, export packaging, browser preview, and additional presets remain deferred.

- [x] **Step 2: Run focused package checks**

Run:

```sh
npm --workspace @auto-demo/polish test -- src/index.test.ts
npm --workspace @auto-demo/cli test -- src/index.test.ts
npm --workspace @auto-demo/polish run typecheck
npm --workspace @auto-demo/cli run typecheck
npm --workspace @auto-demo/polish run build
npm --workspace @auto-demo/cli run build
```

Expected after implementation: all pass.

- [x] **Step 3: Run full validation**

Run: `npm run validate`

Expected after implementation: all workspace tests, typechecks, and builds pass.

- [x] **Step 4: Update project map**

Update `docs/linear/auto-demo-project-structure.md` with:

- WES-156 moved to In Progress during pre-task sync;
- spec path `docs/superpowers/specs/2026-07-04-wes-156-headless-save-summary-design.md`;
- plan path `docs/superpowers/plans/2026-07-04-wes-156-headless-save-summary.md`;
- implementation summary after validation.

## Self-Review

- Spec coverage: selected save, save all, invalid selection, duplicate ids, reload validation, JSON summary, and deferrals all have implementation or test steps.
- Placeholder scan: no TODO/TBD placeholders or vague "add tests" steps remain.
- Type consistency: option names are `selectedVariantId`, `save`, and `mode`; summary fields are `saved`, `skipped`, `validation`, and `nextSteps`; saved variant paths use `variants/<id>.json`.
