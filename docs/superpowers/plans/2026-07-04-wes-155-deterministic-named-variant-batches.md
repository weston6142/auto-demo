# WES-155 Deterministic Named Variant Batches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand headless generation from a single baseline dry-run summary into deterministic baseline-only named batch semantics backed by a persisted source variant.

**Architecture:** Keep project validation and variant persistence in `@auto-demo/project`, baseline generation and batch validation in `@auto-demo/polish`, and CLI argument routing in `@auto-demo/cli`. `generateHeadlessVariants()` normalizes style-list input, loads the project, verifies the source variant, and returns compact JSON-ready dry-run summaries without saving files.

**Tech Stack:** TypeScript, npm workspaces, Vitest, existing `@auto-demo/project`, `@auto-demo/polish`, and `@auto-demo/cli` packages.

---

## File Structure

- Modify `packages/polish/src/index.test.ts`: add behavior-first tests for baseline-only batch output, deterministic repeated calls, missing source variant, duplicate styles, unsupported styles, count/style mismatch, and conflicting style inputs.
- Modify `packages/polish/src/index.ts`: extend public option/result/error types; validate style list/source variant rules; build deterministic summary metadata from `MVP_STYLE_PRESETS`.
- Modify `packages/cli/src/index.test.ts`: make the generate fixture include a persisted baseline variant and add CLI tests for `--styles`, `--source-variant`, duplicate styles, and unsupported styles.
- Modify `packages/cli/src/index.ts`: parse `--styles` and `--source-variant`, pass them to `generateHeadlessVariants()`, and preserve JSON-mode structured errors.
- Modify `README.md` and `packages/polish/README.md`: document WES-155 baseline-only batch semantics and deferrals.
- Modify `docs/linear/auto-demo-project-structure.md`: add WES-155 spec/plan links and investigation notes.

---

### Task 1: Polish API Batch Behavior

**Files:**

- Modify: `packages/polish/src/index.test.ts`
- Modify: `packages/polish/src/index.ts`

- [ ] **Step 1: Write failing tests for batch success and determinism**

Add tests under `describe("generateHeadlessVariants", () => { ... })` that create a project, persist the generated baseline source variant, and assert batch metadata:

```ts
it("returns a deterministic baseline-only named batch from a persisted source variant", async () => {
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
  await savePolishVariant(project, variant, {
    now: new Date("2026-07-04T12:30:00.000Z"),
  });

  const first = await generateHeadlessVariants({
    projectPath: project.projectDir,
    dryRun: true,
    json: true,
    styles: ["baseline"],
    sourceVariantId: "baseline-polish",
  });
  const second = await generateHeadlessVariants({
    projectPath: project.projectDir,
    dryRun: true,
    json: true,
    styles: ["baseline"],
    sourceVariantId: "baseline-polish",
  });

  expect(first).toEqual(second);
  expect(first.ok).toBe(true);
  if (!first.ok) {
    throw new Error("expected generation to succeed");
  }
  expect(first.requested).toEqual({
    count: 1,
    styles: ["baseline"],
    dryRun: true,
    sourceVariantId: "baseline-polish",
  });
  expect(first.variants).toEqual([
    expect.objectContaining({
      id: "baseline-polish",
      displayName: "Baseline Polish",
      style: "baseline",
      source: expect.objectContaining({
        projectPath: project.projectDir,
        manifestPath: project.manifestPath,
        mediaPath: "raw/capture.webm",
        eventsPath: "metadata/events.jsonl",
        variantId: "baseline-polish",
      }),
      metadata: {
        presetKey: "baseline",
        presetDisplayName: "Baseline Polish",
        batchIndex: 0,
        batchSize: 1,
        sourceVariantId: "baseline-polish",
      },
      save: { mode: "dry-run", saved: false },
    }),
  ]);
  await expect(
    stat(join(project.projectDir, "variants", "baseline-polish-1.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace @auto-demo/polish test -- src/index.test.ts`

Expected: FAIL because `styles`, `sourceVariantId`, `requested.styles`, `source.variantId`, and `metadata` are not implemented.

- [ ] **Step 3: Implement minimal batch success behavior**

In `packages/polish/src/index.ts`:

- add `styles?: string[]` and `sourceVariantId?: string` to `HeadlessVariantGenerationOptions`;
- change successful `requested` to `{ count: 1; styles: ["baseline"]; dryRun: true; sourceVariantId: string }`;
- change failure `requested` to `{ count: number; styles: string[]; dryRun: boolean; sourceVariantId: string }`;
- add `variantId` to `HeadlessVariantSummary.source`;
- add `metadata` to `HeadlessVariantSummary`;
- resolve style keys from `options.styles ?? [options.style ?? "baseline"]`;
- default `sourceVariantId` to `"baseline-polish"`;
- load the project, find the source variant in `loadedProject.manifest.variants`, and return `missing_source_variant` if absent;
- populate summary metadata from `MVP_STYLE_PRESETS[0]`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace @auto-demo/polish test -- src/index.test.ts`

Expected: PASS for the new success test and existing tests after updating legacy expectations to the new public result shape.

- [ ] **Step 5: Write failing tests for structured validation errors**

Add tests for:

```ts
it("returns structured errors for invalid batch requests", async () => {
  const project = await writeLoadedProject([
    { id: "event-1", sequence: 1, type: "press", timestampMs: 1000 },
  ]);
  const { variant } = await generateBaselinePolishVariant(project);
  await savePolishVariant(project, variant);

  await expect(
    generateHeadlessVariants({
      projectPath: project.projectDir,
      dryRun: true,
      json: true,
      style: "baseline",
      styles: ["baseline"],
    }),
  ).resolves.toMatchObject({
    ok: false,
    errors: [{ code: "conflicting_style_options" }],
  });

  await expect(
    generateHeadlessVariants({
      projectPath: project.projectDir,
      dryRun: true,
      json: true,
      styles: ["baseline", "baseline"],
    }),
  ).resolves.toMatchObject({
    ok: false,
    errors: [{ code: "duplicate_style" }],
  });

  await expect(
    generateHeadlessVariants({
      projectPath: project.projectDir,
      dryRun: true,
      json: true,
      styles: ["cinematic"],
    }),
  ).resolves.toMatchObject({
    ok: false,
    errors: [{ code: "unsupported_style" }],
  });

  await expect(
    generateHeadlessVariants({
      projectPath: project.projectDir,
      dryRun: true,
      json: true,
      styles: ["baseline"],
      count: 2,
    }),
  ).resolves.toMatchObject({
    ok: false,
    errors: [{ code: "unsupported_variant_count" }],
  });
});

it("returns a structured error when the source variant is missing", async () => {
  const project = await writeLoadedProject([
    { id: "event-1", sequence: 1, type: "press", timestampMs: 1000 },
  ]);

  await expect(
    generateHeadlessVariants({
      projectPath: project.projectDir,
      dryRun: true,
      json: true,
      styles: ["baseline"],
      sourceVariantId: "baseline-polish",
    }),
  ).resolves.toMatchObject({
    ok: false,
    errors: [{ code: "missing_source_variant" }],
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm --workspace @auto-demo/polish test -- src/index.test.ts`

Expected: FAIL until the new error codes are implemented.

- [ ] **Step 7: Implement validation errors**

Extend `HeadlessVariantGenerationErrorCode` with:

```ts
| "conflicting_style_options"
| "duplicate_style"
| "missing_source_variant"
```

Update option validation so:

- both `style` and `styles` returns `conflicting_style_options`;
- duplicate style keys returns `duplicate_style`;
- any style not in `MVP_STYLE_PRESETS` returns `unsupported_style`;
- `count` must equal the resolved styles length;
- missing source variant after project load returns `missing_source_variant`.

- [ ] **Step 8: Run polish tests**

Run: `npm --workspace @auto-demo/polish test -- src/index.test.ts`

Expected: PASS.

---

### Task 2: CLI Batch Flags

**Files:**

- Modify: `packages/cli/src/index.test.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Write failing CLI tests**

Update `createValidProject()` so `autodemo.project.json` includes one persisted `baseline-polish` variant and `variants/baseline-polish.json` exists.

Add tests:

```ts
it("prints a dry-run baseline batch summary as JSON", async () => {
  const projectDir = await createValidProject();

  const result = await runCliAsync([
    "generate",
    "--project",
    projectDir,
    "--dry-run",
    "--json",
    "--styles",
    "baseline",
    "--source-variant",
    "baseline-polish",
  ]);
  const output = JSON.parse(result.stdout) as {
    ok: boolean;
    requested: { styles: string[]; sourceVariantId: string };
    variants: Array<{ metadata: { presetKey: string; sourceVariantId: string } }>;
  };

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(output.ok).toBe(true);
  expect(output.requested).toMatchObject({
    styles: ["baseline"],
    sourceVariantId: "baseline-polish",
  });
  expect(output.variants).toEqual([
    expect.objectContaining({
      metadata: expect.objectContaining({
        presetKey: "baseline",
        sourceVariantId: "baseline-polish",
      }),
    }),
  ]);
});

it("returns structured JSON errors for duplicate generated styles", async () => {
  const projectDir = await createValidProject();

  const result = await runCliAsync([
    "generate",
    "--project",
    projectDir,
    "--dry-run",
    "--json",
    "--styles",
    "baseline,baseline",
  ]);
  const output = JSON.parse(result.stdout) as { ok: boolean; errors: Array<{ code: string }> };

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe("");
  expect(output.ok).toBe(false);
  expect(output.errors).toEqual([{ code: "duplicate_style", message: expect.any(String) }]);
});
```

- [ ] **Step 2: Run CLI tests to verify failure**

Run: `npm --workspace @auto-demo/cli test -- src/index.test.ts`

Expected: FAIL because `--styles`, `--source-variant`, and source variant fixture support are not wired.

- [ ] **Step 3: Implement CLI parsing**

In `packages/cli/src/index.ts`:

- add `styles?: string[]` and `sourceVariantId?: string` to `ParsedGenerateCommand`;
- parse `--styles <comma-separated-list>` into trimmed keys and pass it through;
- parse `--source-variant <variant-id>`;
- pass `styles` and `sourceVariantId` to `generateHeadlessVariants()`;
- update `generateParseFailure()` to include `styles` and `sourceVariantId` in the request shape.

- [ ] **Step 4: Run CLI tests**

Run: `npm --workspace @auto-demo/cli test -- src/index.test.ts`

Expected: PASS.

---

### Task 3: Documentation And Project Map

**Files:**

- Modify: `README.md`
- Modify: `packages/polish/README.md`
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Update README headless generation section**

Document:

- `--styles baseline`;
- `--source-variant baseline-polish`;
- baseline-only batch semantics;
- missing source variants and duplicate styles as structured errors;
- save modes, run summaries, rendering, and exports deferred to WES-156 and later work.

- [ ] **Step 2: Update polish README**

Document the API options:

```ts
const summary = await generateHeadlessVariants({
  projectPath: "projects/checkout-demo",
  dryRun: true,
  json: true,
  styles: ["baseline"],
  sourceVariantId: "baseline-polish",
});
```

Mention that the project must already contain the source variant in
`autodemo.project.json` and `variants/baseline-polish.json`.

- [ ] **Step 3: Update project map**

Add WES-155 spec/plan links under Local Context and an investigation note that
WES-155 is scoped to baseline-only deterministic batch semantics, with saving
still owned by WES-156.

- [ ] **Step 4: Run documentation format check**

Run: `npm run format:check`

Expected: PASS after formatting, or FAIL with actionable formatting output.

---

### Task 4: Verification And Commit

**Files:**

- All WES-155 files modified above.

- [ ] **Step 1: Run focused package tests**

Run:

```bash
npm --workspace @auto-demo/polish test -- src/index.test.ts
npm --workspace @auto-demo/cli test -- src/index.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run package typechecks/builds**

Run:

```bash
npm --workspace @auto-demo/polish run typecheck
npm --workspace @auto-demo/polish run build
npm --workspace @auto-demo/cli run typecheck
npm --workspace @auto-demo/cli run build
```

Expected: PASS.

- [ ] **Step 3: Run repository validation**

Run: `npm run validate`

Expected: PASS.

- [ ] **Step 4: Review scoped diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors and only WES-155 scoped files changed.

- [ ] **Step 5: Commit scoped files**

Run:

```bash
git add packages/polish/src/index.ts packages/polish/src/index.test.ts packages/polish/README.md packages/cli/src/index.ts packages/cli/src/index.test.ts README.md docs/superpowers/specs/2026-07-04-wes-155-deterministic-named-variant-batches-design.md docs/superpowers/plans/2026-07-04-wes-155-deterministic-named-variant-batches.md docs/linear/auto-demo-project-structure.md
git commit -m "feat: generate deterministic named variant batches"
```

Expected: commit succeeds on `fm/wes-155`.

---

## Self-Review

- Spec coverage: tasks cover persisted source variant loading, baseline-only style list resolution, deterministic batch metadata, structured errors, CLI flags, documentation, project map updates, and validation.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: option names are `styles` and `sourceVariantId`; summary metadata uses `presetKey`, `presetDisplayName`, `batchIndex`, `batchSize`, and `sourceVariantId`.
