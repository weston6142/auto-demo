# WES-151 Polish Decision Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `@auto-demo/project` validate MVP polish variant definitions in schema version 1 project manifests.

**Architecture:** Keep the project manifest as the source of truth. Extend `ProjectManifest.variants` from empty-only to validated `ProjectVariant[]`, add focused validation helpers inside `packages/project/src/index.ts`, and leave `previews` and `exports` empty until later milestones own rendered artifacts.

**Tech Stack:** TypeScript, Node.js filesystem APIs already used by `@auto-demo/project`, Vitest, npm workspaces, Prettier, ESLint.

---

## File Structure

- Modify `packages/project/src/index.test.ts`: add representative valid variant fixtures and behavior tests for valid variants, duplicate/invalid ids, unsafe/mismatched source paths, timeline bounds, caption/callout bounds, style/export literals, and save/load round-trip.
- Modify `packages/project/src/index.ts`: export `ProjectVariant` and nested decision types, update `ProjectManifest.variants`, replace the empty-only variant check with variant validation, keep `previews` and `exports` empty-only, and validate no preview/export files are required.
- Modify `README.md`: note that the project package validates polish variant definitions while generation/rendering remain planned.
- Modify `docs/linear/auto-demo-project-structure.md`: record WES-151 investigation/implementation evidence and next-task pointer.
- Create `docs/superpowers/specs/2026-07-02-wes-151-polish-decision-schema-design.md`: design spec.
- Create `docs/superpowers/plans/2026-07-02-wes-151-polish-decision-schema.md`: this plan.

## Task 1: Add Failing Variant Validation Tests

**Files:**

- Modify: `packages/project/src/index.test.ts`

- [ ] **Step 1: Extend imports**

Add `type ProjectVariant` to the existing import list:

```ts
import {
  PROJECT_MANIFEST_FILENAME,
  SUPPORTED_PROJECT_SCHEMA_VERSION,
  createProjectFromCaptureBundle,
  loadProject,
  saveProject,
  validateProject,
  validateProjectManifest,
  type ProjectManifest,
  type ProjectVariant,
} from "./index.js";
```

- [ ] **Step 2: Add a representative variant fixture**

After `validManifest`, add:

```ts
const validVariant: ProjectVariant = {
  id: "checkout-focused",
  displayName: "Checkout Focused",
  source: {
    mediaPath: "raw/capture.webm",
    eventsPath: "metadata/events.jsonl",
  },
  timeline: {
    startMs: 0,
    endMs: 2500,
  },
  viewport: {
    mode: "contain",
    focus: { x: 0.5, y: 0.5 },
    zoom: 1.25,
  },
  cursor: {
    visible: true,
    emphasis: "spotlight",
  },
  clicks: {
    emphasis: "ring",
  },
  captions: [
    {
      id: "intro",
      text: "Open the checkout flow",
      startMs: 250,
      endMs: 1200,
    },
  ],
  callouts: [
    {
      id: "pay-button",
      text: "Complete payment",
      startMs: 1400,
      endMs: 2200,
      anchor: { x: 0.72, y: 0.64 },
    },
  ],
  style: {
    background: "solid",
    backgroundColor: "#0f172a",
    frame: "browser",
    padding: 48,
    cornerRadius: 16,
  },
  exportIntent: {
    format: "mp4",
    quality: "demo",
    aspectRatio: "16:9",
  },
};
```

- [ ] **Step 3: Add acceptance tests**

Append these tests to `describe("validateProjectManifest", ...)`:

```ts
it("accepts a manifest with a valid MVP polish variant", () => {
  const manifest: ProjectManifest = {
    ...validManifest,
    variants: [validVariant],
  };

  expect(validateProjectManifest(manifest)).toEqual({ ok: true, manifest });
});

it("rejects duplicate and invalid variant ids", () => {
  const result = validateProjectManifest({
    ...validManifest,
    variants: [
      validVariant,
      { ...validVariant, id: "checkout-focused" },
      { ...validVariant, id: "Checkout Focused" },
    ],
  });

  expect(result).toEqual({
    ok: false,
    errors: [
      {
        code: "invalid_project_manifest",
        message: "Auto Demo project variant ids must be unique lowercase slugs.",
      },
      {
        code: "invalid_project_manifest",
        message: "Auto Demo project variant ids must be unique lowercase slugs.",
      },
    ],
  });
});

it("rejects unsafe or mismatched variant source paths", () => {
  const result = validateProjectManifest({
    ...validManifest,
    variants: [
      {
        ...validVariant,
        source: {
          mediaPath: "../capture.webm",
          eventsPath: "metadata/other.jsonl",
        },
      },
    ],
  });

  expect(result).toEqual({
    ok: false,
    errors: [
      {
        code: "unsafe_project_path",
        message: "Project variant source paths must be relative paths inside the project.",
      },
      {
        code: "invalid_project_manifest",
        message:
          "Auto Demo project variant source paths must reference the primary media and events.",
      },
    ],
  });
});

it("rejects impossible variant timeline and decision ranges", () => {
  const result = validateProjectManifest({
    ...validManifest,
    variants: [
      {
        ...validVariant,
        timeline: { startMs: 500, endMs: 3000 },
        captions: [{ id: "late", text: "Too late", startMs: 100, endMs: 700 }],
        callouts: [
          { id: "after", text: "After", startMs: 2400, endMs: 2600, anchor: { x: 0.5, y: 0.5 } },
        ],
      },
    ],
  });

  expect(result).toEqual({
    ok: false,
    errors: [
      {
        code: "invalid_project_manifest",
        message: "Auto Demo project variant timeline must fit inside the source capture duration.",
      },
      {
        code: "invalid_project_manifest",
        message: "Auto Demo project variant caption ranges must fit inside the variant timeline.",
      },
      {
        code: "invalid_project_manifest",
        message: "Auto Demo project variant callout ranges must fit inside the variant timeline.",
      },
    ],
  });
});

it("rejects invalid variant style and export decisions", () => {
  const result = validateProjectManifest({
    ...validManifest,
    variants: [
      {
        ...validVariant,
        viewport: { mode: "freeform", focus: { x: 1.2, y: 0.5 }, zoom: 0.5 },
        cursor: { visible: true, emphasis: "sparkle" },
        clicks: { emphasis: "flash" },
        style: {
          background: "image",
          backgroundColor: "blue",
          frame: "phone",
          padding: -1,
          cornerRadius: 2.5,
        },
        exportIntent: { format: "gif", quality: "draft", aspectRatio: "1:1" },
      },
    ],
  });

  expect(result).toEqual({
    ok: false,
    errors: [
      {
        code: "invalid_project_manifest",
        message: "Auto Demo project variant viewport decision is invalid.",
      },
      {
        code: "invalid_project_manifest",
        message: "Auto Demo project variant cursor decision is invalid.",
      },
      {
        code: "invalid_project_manifest",
        message: "Auto Demo project variant click decision is invalid.",
      },
      {
        code: "invalid_project_manifest",
        message: "Auto Demo project variant style decision is invalid.",
      },
      {
        code: "invalid_project_manifest",
        message: "Auto Demo project variant export intent is invalid.",
      },
    ],
  });
});
```

- [ ] **Step 4: Run focused tests to verify RED**

Run:

```bash
npm --workspace @auto-demo/project test -- src/index.test.ts
```

Expected: FAIL because `ProjectVariant` is not exported and non-empty variants are rejected.

## Task 2: Implement Variant Types And Validator

**Files:**

- Modify: `packages/project/src/index.ts`

- [ ] **Step 1: Add public variant types**

Add exported types near `ProjectSourceCapture`:

```ts
export type ProjectVariant = {
  id: string;
  displayName: string;
  source: ProjectVariantSource;
  timeline: ProjectVariantTimeline;
  viewport: ProjectVariantViewportDecision;
  cursor: ProjectVariantCursorDecision;
  clicks: ProjectVariantClickDecision;
  captions: ProjectVariantCaption[];
  callouts: ProjectVariantCallout[];
  style: ProjectVariantStyle;
  exportIntent: ProjectVariantExportIntent;
};
```

Also add nested exported types for `ProjectVariantSource`, `ProjectVariantTimeline`,
`ProjectVariantViewportDecision`, `ProjectVariantCursorDecision`,
`ProjectVariantClickDecision`, `ProjectVariantCaption`, `ProjectVariantCallout`,
`ProjectVariantStyle`, and `ProjectVariantExportIntent` exactly matching the spec.

- [ ] **Step 2: Update manifest type**

Change:

```ts
variants: [];
```

to:

```ts
variants: ProjectVariant[];
```

- [ ] **Step 3: Add key lists and validation helpers**

Add const key arrays for each variant object level. Replace
`validateForwardCompatibleArrays(input, errors);` with:

```ts
validateVariants(input, errors);
validatePreviewAndExportPlaceholders(input, errors);
```

Implement helpers that accumulate the exact errors used by the tests:

- `validateVariants(input, errors)`
- `validateVariant(value, input, seenIds, errors)`
- `validateVariantSource(value, input, errors)`
- `validateVariantTimeline(value, captureDurationMs, errors)`
- `validateVariantViewport(value, errors)`
- `validateVariantCursor(value, errors)`
- `validateVariantClicks(value, errors)`
- `validateVariantTimedTextArray(value, kind, timeline, errors)`
- `validateVariantStyle(value, errors)`
- `validateVariantExportIntent(value, errors)`
- `isSlug(value)`
- `isIntegerInRange(value, min, max)`
- `isNormalizedNumber(value)`
- `isHexColor(value)`

- [ ] **Step 4: Keep import-created manifests unchanged**

Do not add variants during `createProjectFromCaptureBundle()`. New projects still start with `variants: []`.

- [ ] **Step 5: Run focused tests to verify GREEN**

Run:

```bash
npm --workspace @auto-demo/project test -- src/index.test.ts
```

Expected: PASS.

## Task 3: Add Save/Load Round-Trip Coverage

**Files:**

- Modify: `packages/project/src/index.test.ts`

- [ ] **Step 1: Add project filesystem behavior test**

Add a test in `describe("project filesystem APIs", ...)`:

```ts
it("saves and reloads a project manifest with variants without requiring preview or export files", async () => {
  const project = await importValidProject("auto-demo-project-variant-save-");
  const manifestWithVariant: ProjectManifest = {
    ...project.manifest,
    variants: [validVariant],
    updatedAt: "2026-07-01T11:00:00.000Z",
  };

  const saved = await saveProject({
    projectDir: project.projectDir,
    manifestPath: project.manifestPath,
    manifest: manifestWithVariant,
  });

  expect(saved).toEqual({
    ok: true,
    projectDir: project.projectDir,
    manifestPath: project.manifestPath,
    manifest: manifestWithVariant,
  });
  await expect(loadProject(project.projectDir)).resolves.toEqual(saved);
});
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
npm --workspace @auto-demo/project test -- src/index.test.ts
```

Expected: PASS.

## Task 4: Update Docs And Project Map

**Files:**

- Modify: `README.md`
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Update README**

In the Status section, say `@auto-demo/project` now validates MVP polish variant definitions. In the package list, update the project package description similarly.

- [ ] **Step 2: Update project map**

Set `Last updated` to `2026-07-02`. Add WES-151 spec/plan links to Local Context. In Auto Polish Engine, mark WES-151 `In Progress` during implementation and later `Done` after completion-gate. Add an investigation/implementation note that WES-151 extends schema v1 variants while leaving generation/rendering deferred.

- [ ] **Step 3: Run validation**

Run:

```bash
npm --workspace @auto-demo/project test -- src/index.test.ts
npm --workspace @auto-demo/project run typecheck
npm --workspace @auto-demo/project run build
npm run validate
```

Expected: all commands exit 0.

## Self-Review

- Spec coverage: the tasks cover manifest variant fields, source immutability through source path checks, timeline bounds, validation errors, docs, and save/load round-trip. Generation/rendering/editor work is deliberately absent per spec non-goals.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: `ProjectVariant` is the manifest array item type used by tests, validator, save/load, and docs.
