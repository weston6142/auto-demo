# WES-163 Render Saved Variants To MP4 Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first local export path that renders a saved Auto Demo variant to an MP4 artifact plus adjacent render metadata.

**Architecture:** `@auto-demo/render` owns project loading, variant selection, preset resolution, output paths, runner invocation, and render summary writing. The default runner shells out to `ffmpeg`, while tests use an injected runner to verify behavior without depending on private process mechanics. `@auto-demo/cli` wires `autodemo export --project ... --json` to the render API.

**Tech Stack:** TypeScript, Node `fs/promises`, Node `child_process`, npm workspaces, Vitest, existing `@auto-demo/project` types and validation.

---

## File Structure

- Modify `packages/render/src/index.ts`: add preset constants, render API, summary writing, structured errors, and default ffmpeg runner.
- Create `packages/render/src/index.test.ts`: behavior-first render package tests.
- Modify `packages/render/package.json`: include the new render API test in the package test command.
- Modify `packages/cli/src/index.ts`: import `renderSavedVariant`, add render dependency injection, parse `autodemo export`, and route async export commands.
- Modify `packages/cli/src/index.test.ts`: replace the planned export test with JSON export behavior tests.
- Modify `packages/cli/package.json`: build and depend on `@auto-demo/render`.
- Modify `packages/render/README.md` and `README.md`: update from decision-only wording to implemented local export behavior.
- Modify `docs/linear/auto-demo-project-structure.md`: add WES-163 spec/plan links and implementation notes.

### Task 1: Render Package RED Tests

**Files:**

- Create: `packages/render/src/index.test.ts`
- Modify: `packages/render/package.json`

- [ ] **Step 1: Add failing render behavior tests**

Create `packages/render/src/index.test.ts` with tests that build real project directories, call `renderSavedVariant()`, and assert public behavior:

```ts
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MVP_EXPORT_PRESET,
  MVP_EXPORT_PRESET_KEY,
  renderSavedVariant,
  type RenderRunner,
} from "./index.js";

async function createProject(
  options: { variantId?: string; aspectRatio?: "16:9" | "4:3" | "9:16" } = {},
) {
  const projectDir = join(tmpdir(), `auto-demo-render-${randomUUID()}`);
  const variantId = options.variantId ?? "baseline-polish";
  const variant = {
    id: variantId,
    displayName: "Baseline Polish",
    source: { mediaPath: "raw/capture.webm", eventsPath: "metadata/events.jsonl" },
    timeline: { startMs: 0, endMs: 6000 },
    viewport: { mode: "contain", focus: { x: 0.5, y: 0.5 }, zoom: 1 },
    cursor: { visible: true, emphasis: "spotlight" },
    clicks: { emphasis: "ring" },
    captions: [],
    callouts: [],
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
      aspectRatio: options.aspectRatio ?? "16:9",
    },
  };
  await mkdir(join(projectDir, "raw"), { recursive: true });
  await mkdir(join(projectDir, "metadata"), { recursive: true });
  await mkdir(join(projectDir, "variants"), { recursive: true });
  await mkdir(join(projectDir, "exports"), { recursive: true });
  await writeFile(join(projectDir, "raw", "capture.webm"), "video");
  await writeFile(join(projectDir, "metadata", "events.jsonl"), "{}\n");
  await writeFile(join(projectDir, "metadata", "capture.manifest.json"), "{}\n");
  await writeFile(
    join(projectDir, "variants", `${variantId}.json`),
    `${JSON.stringify(variant, null, 2)}\n`,
  );
  await writeFile(
    join(projectDir, "autodemo.project.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        name: "Checkout flow demo",
        createdAt: "2026-07-06T00:00:00.000Z",
        updatedAt: "2026-07-06T00:00:00.000Z",
        sourceCapture: {
          kind: "browser",
          status: "completed",
          source: { kind: "browser", url: "https://example.com/checkout" },
          viewport: { width: 1280, height: 720 },
          timing: {
            startedAt: "2026-07-06T00:00:00.000Z",
            endedAt: "2026-07-06T00:00:06.000Z",
            durationMs: 6000,
          },
          adapter: { kind: "browser", backend: "playwright" },
          tools: { capturePackage: "0.0.0", playwright: "1.61.1" },
          manifestPath: "metadata/capture.manifest.json",
        },
        media: {
          primary: { kind: "viewport", path: "raw/capture.webm", contentType: "video/webm" },
        },
        metadata: {
          events: { path: "metadata/events.jsonl", contentType: "application/x-ndjson" },
        },
        variants: [variant],
        previews: [],
        exports: [],
      },
      null,
      2,
    )}\n`,
  );
  return projectDir;
}

describe("renderSavedVariant", () => {
  it("renders the selected saved variant and writes a non-secret summary", async () => {
    const projectDir = await createProject();
    const calls: unknown[] = [];
    const runner: RenderRunner = async (request) => {
      calls.push(request);
      await writeFile(request.outputPath, "mp4");
      return { ok: true, command: "fake-renderer", exitCode: 0 };
    };

    const result = await renderSavedVariant(
      {
        projectPath: projectDir,
        variantId: "baseline-polish",
        now: () => new Date("2026-07-06T01:00:00.000Z"),
      },
      { runner },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.outputPath).toBe(join(projectDir, "exports", "baseline-polish.mp4"));
    expect(result.summaryPath).toBe(join(projectDir, "exports", "baseline-polish.render.json"));
    expect(result.preset.key).toBe(MVP_EXPORT_PRESET_KEY);
    expect(result.preset.settings.dimensions).toEqual({ width: 1280, height: 720 });
    expect(calls).toHaveLength(1);

    const summary = JSON.parse(await readFile(result.summaryPath, "utf8")) as {
      ok: boolean;
      variantId: string;
      preset: { key: string };
      outputPath: string;
      renderer: { command: string; exitCode: number };
    };
    expect(summary).toMatchObject({
      ok: true,
      variantId: "baseline-polish",
      preset: { key: "mp4-demo" },
      outputPath: "exports/baseline-polish.mp4",
      renderer: { command: "fake-renderer", exitCode: 0 },
    });
  });

  it("returns structured failures for missing variants without invoking the runner", async () => {
    const projectDir = await createProject();
    let called = false;
    const result = await renderSavedVariant(
      { projectPath: projectDir, variantId: "missing" },
      {
        runner: async () => {
          called = true;
          return { ok: true, command: "fake", exitCode: 0 };
        },
      },
    );

    expect(result).toMatchObject({
      ok: false,
      errors: [{ code: "missing_variant" }],
    });
    expect(called).toBe(false);
  });

  it("writes a failure summary when the renderer fails", async () => {
    const projectDir = await createProject();
    const result = await renderSavedVariant(
      { projectPath: projectDir, variantId: "baseline-polish" },
      { runner: async () => ({ ok: false, command: "fake-renderer", exitCode: 77 }) },
    );

    expect(result).toMatchObject({
      ok: false,
      summaryPath: join(projectDir, "exports", "baseline-polish.render.json"),
      errors: [{ code: "renderer_failure" }],
    });
    const summary = JSON.parse(
      await readFile(join(projectDir, "exports", "baseline-polish.render.json"), "utf8"),
    ) as {
      ok: boolean;
      renderer: { command: string; exitCode: number };
    };
    expect(summary).toMatchObject({
      ok: false,
      renderer: { command: "fake-renderer", exitCode: 77 },
    });
  });

  it("maps supported aspect ratios to preset dimensions", async () => {
    expect(MVP_EXPORT_PRESET.dimensionsByAspectRatio).toEqual({
      "16:9": { width: 1280, height: 720 },
      "4:3": { width: 1024, height: 768 },
      "9:16": { width: 720, height: 1280 },
    });
  });
});
```

- [ ] **Step 2: Add the new test to the render package script**

Change `packages/render/package.json`:

```json
"test": "vitest run src/index.test.ts src/render-docs.test.ts"
```

- [ ] **Step 3: Run focused RED check**

Run:

```bash
rtk npm --workspace @auto-demo/render test -- src/index.test.ts
```

Expected: FAIL because `renderSavedVariant`, `MVP_EXPORT_PRESET`, `MVP_EXPORT_PRESET_KEY`, and `RenderRunner` are not implemented yet.

### Task 2: Implement Render API

**Files:**

- Modify: `packages/render/src/index.ts`

- [ ] **Step 1: Implement minimal render API and runner contract**

Replace the render stub with exported preset constants, result types, `renderSavedVariant()`, summary writing, and a default ffmpeg runner. Keep helper functions private except types needed by tests and the CLI.

- [ ] **Step 2: Run focused GREEN check**

Run:

```bash
rtk npm --workspace @auto-demo/render test -- src/index.test.ts
```

Expected: PASS for render API behavior.

- [ ] **Step 3: Run render typecheck/build**

Run:

```bash
rtk npm --workspace @auto-demo/render run typecheck
rtk npm --workspace @auto-demo/render run build
```

Expected: both exit 0.

### Task 3: CLI Export RED Tests

**Files:**

- Modify: `packages/cli/src/index.test.ts`
- Modify: `packages/cli/package.json`

- [ ] **Step 1: Add CLI dependency injection shape**

Update the test import expectations so `runCliAsync(["export", ...])` can use an injected render function or runner and returns JSON.

- [ ] **Step 2: Replace the old planned export assertion**

Change the old `runCli(["export"])` expectation to:

```ts
expect(runCli(["export"])).toEqual({
  exitCode: 1,
  stdout: "",
  stderr: "autodemo export requires async execution.\n",
});
```

- [ ] **Step 3: Add JSON export tests**

Add tests that verify:

- `autodemo export --project <project> --json` returns `exitCode: 0` and JSON success from the render dependency.
- `autodemo export --project <project>` returns a stderr message requiring `--json`.
- `autodemo export --json` returns structured `invalid_export_request` JSON.
- `autodemo export --project <project> --preset gif-demo --json` returns structured `unsupported_preset` JSON.

- [ ] **Step 4: Run focused RED check**

Run:

```bash
rtk npm --workspace @auto-demo/cli test -- src/index.test.ts
```

Expected: FAIL because CLI export parsing/routing and the render dependency are not implemented.

### Task 4: Implement CLI Export Wiring

**Files:**

- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/package.json`

- [ ] **Step 1: Add render dependency**

Add `@auto-demo/render` to `packages/cli/package.json` dependencies and include it in `prebuild`, `pretypecheck`, and `pretest` workspace builds.

- [ ] **Step 2: Add CLI dependency field and command routing**

Import `renderSavedVariant`, add an optional `renderSavedVariant` dependency function to `CliDependencies`, remove `export` from the planned command set, make synchronous `runCli(["export"])` report async execution, and route async `export` to a new `runExportCommand()`.

- [ ] **Step 3: Parse export options conservatively**

Support only `--project`, `--variant`, `--preset`, `--json`, and `--help`. Return structured JSON parse failures when `--json` is present, and stderr for non-JSON parse failures.

- [ ] **Step 4: Run focused GREEN check**

Run:

```bash
rtk npm --workspace @auto-demo/cli test -- src/index.test.ts
```

Expected: PASS for CLI export behavior and existing CLI behavior.

### Task 5: Documentation And Project Map

**Files:**

- Modify: `packages/render/README.md`
- Modify: `README.md`
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Update docs from planned to implemented**

State that WES-163 implements `renderSavedVariant()` and
`autodemo export --project <project> --json`, while retaining deferrals for
non-MP4, hosted rendering, overlays, audio, packaging, and WES-165 demo
validation.

- [ ] **Step 2: Update project map**

Add WES-163 spec and plan links, a pre-task sync note, and an implementation
note summarizing the render API, CLI command, summary artifact, and deferrals.

- [ ] **Step 3: Run docs tests**

Run:

```bash
rtk npm --workspace @auto-demo/render test -- src/render-docs.test.ts
```

Expected: PASS.

### Task 6: Final Local Validation

**Files:**

- No new files.

- [ ] **Step 1: Run focused package tests**

Run:

```bash
rtk npm --workspace @auto-demo/render test
rtk npm --workspace @auto-demo/cli test
```

Expected: both exit 0.

- [ ] **Step 2: Run package typecheck/build**

Run:

```bash
rtk npm --workspace @auto-demo/render run typecheck
rtk npm --workspace @auto-demo/render run build
rtk npm --workspace @auto-demo/cli run typecheck
rtk npm --workspace @auto-demo/cli run build
```

Expected: all exit 0.

- [ ] **Step 3: Run repository validation**

Run:

```bash
rtk npm run validate
```

Expected: exit 0.

## Self-Review

- Spec coverage: tasks cover render API, CLI export behavior, summary metadata,
  structured errors, default preset settings, docs, project map, and validation.
- Placeholder scan: no placeholder implementation steps remain; concrete files,
  commands, and expected outcomes are named.
- Type consistency: names align across tasks: `renderSavedVariant`,
  `MVP_EXPORT_PRESET_KEY`, `MVP_EXPORT_PRESET`, `RenderRunner`, and
  `autodemo export --project ... --json`.
