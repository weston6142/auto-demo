# WES-152 Baseline Polish Decisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic `@auto-demo/polish` API that reads a loaded Auto Demo project's event metadata and generates one schema-valid baseline polish variant.

**Architecture:** Keep project validation and persistence in `@auto-demo/project`; implement generation in `@auto-demo/polish`. The polish package will accept a `LoadedProject`, read the project-owned JSONL event file, apply conservative deterministic heuristics for timeline, focus, cursor, and click decisions, and return structured warnings without saving anything.

**Tech Stack:** TypeScript, Node.js `fs/promises`, Node.js `path`, Vitest, npm workspaces, existing `@auto-demo/project` schema types.

---

## File Structure

- Modify `packages/polish/package.json`: add workspace dependency on `@auto-demo/project` and add a `test` script.
- Create `packages/polish/src/index.test.ts`: behavior-first tests for simple click flow, idle-heavy capture, missing click coordinates, incomplete/malformed metadata, deterministic output, and schema validation.
- Modify `packages/polish/src/index.ts`: export warning/result/option types and implement `generateBaselinePolishVariant(project, options)`.
- Modify `packages/polish/README.md`: document the baseline generator behavior and deferrals.
- Modify `README.md`: update status/package text for baseline generation.
- Modify `docs/linear/auto-demo-project-structure.md`: record WES-152 implementation evidence and next-task pointer after validation.
- Create `docs/superpowers/specs/2026-07-02-wes-152-baseline-polish-decisions-design.md`: design spec.
- Create `docs/superpowers/plans/2026-07-02-wes-152-baseline-polish-decisions.md`: this plan.

## Task 1: Add Failing Polish Generator Tests

**Files:**

- Modify: `packages/polish/package.json`
- Create: `packages/polish/src/index.test.ts`

- [ ] **Step 1: Add test script and dependency**

Update `packages/polish/package.json` to:

```json
{
  "name": "@auto-demo/polish",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run src/index.test.ts"
  },
  "dependencies": {
    "@auto-demo/project": "0.0.0"
  }
}
```

- [ ] **Step 2: Create failing behavior tests**

Create `packages/polish/src/index.test.ts`:

```ts
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  validateProjectManifest,
  type LoadedProject,
  type ProjectManifest,
} from "@auto-demo/project";
import { generateBaselinePolishVariant } from "./index.js";

const baseManifest: ProjectManifest = {
  schemaVersion: 1,
  name: "Checkout flow demo",
  createdAt: "2026-07-02T12:00:00.000Z",
  updatedAt: "2026-07-02T12:00:00.000Z",
  sourceCapture: {
    kind: "browser",
    status: "completed",
    source: { kind: "browser", url: "https://example.com/checkout" },
    viewport: { width: 1280, height: 720 },
    timing: {
      startedAt: "2026-07-02T12:00:00.000Z",
      endedAt: "2026-07-02T12:00:06.000Z",
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
  variants: [],
  previews: [],
  exports: [],
};

async function writeLoadedProject(
  events: Array<Record<string, unknown> | string>,
  manifest: ProjectManifest = baseManifest,
): Promise<LoadedProject> {
  const projectDir = await mkdtemp(join(tmpdir(), "auto-demo-polish-"));
  await mkdir(join(projectDir, "metadata"), { recursive: true });
  await mkdir(join(projectDir, "raw"), { recursive: true });
  await writeFile(join(projectDir, "raw", "capture.webm"), "video-bytes");
  await writeFile(join(projectDir, "metadata", "capture.manifest.json"), "{}\n");
  await writeFile(
    join(projectDir, "metadata", "events.jsonl"),
    events.map((event) => (typeof event === "string" ? event : JSON.stringify(event))).join("\n") +
      "\n",
  );

  return {
    projectDir,
    manifestPath: join(projectDir, "autodemo.project.json"),
    manifest,
  };
}

describe("generateBaselinePolishVariant", () => {
  it("generates a schema-valid focused baseline from a simple click flow", async () => {
    const project = await writeLoadedProject([
      { id: "event-1", sequence: 1, type: "capture_started", timestampMs: 0 },
      {
        id: "event-2",
        sequence: 2,
        type: "click",
        timestampMs: 2000,
        viewport: { width: 1280, height: 720 },
        data: { x: 960, y: 360 },
      },
      { id: "event-3", sequence: 3, type: "press", timestampMs: 3600 },
      { id: "event-4", sequence: 4, type: "capture_stopped", timestampMs: 6000 },
    ]);

    const result = await generateBaselinePolishVariant(project);

    expect(result).toEqual({
      variant: {
        id: "baseline-polish",
        displayName: "Baseline Polish",
        source: { mediaPath: "raw/capture.webm", eventsPath: "metadata/events.jsonl" },
        timeline: { startMs: 1500, endMs: 4350 },
        viewport: { mode: "contain", focus: { x: 0.75, y: 0.5 }, zoom: 1.35 },
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
        exportIntent: { format: "mp4", quality: "demo", aspectRatio: "16:9" },
      },
      warnings: [],
    });
    expect(validateProjectManifest({ ...project.manifest, variants: [result.variant] })).toEqual({
      ok: true,
      manifest: { ...project.manifest, variants: [result.variant] },
    });
  });

  it("preserves duration and warns when no action events are present", async () => {
    const project = await writeLoadedProject([
      { id: "event-1", sequence: 1, type: "capture_started", timestampMs: 0 },
      { id: "event-2", sequence: 2, type: "capture_stopped", timestampMs: 6000 },
    ]);

    const result = await generateBaselinePolishVariant(project, {
      id: "quiet-flow",
      displayName: "Quiet Flow",
    });

    expect(result.variant.id).toBe("quiet-flow");
    expect(result.variant.displayName).toBe("Quiet Flow");
    expect(result.variant.timeline).toEqual({ startMs: 0, endMs: 6000 });
    expect(result.variant.viewport).toEqual({
      mode: "contain",
      focus: { x: 0.5, y: 0.5 },
      zoom: 1,
    });
    expect(result.variant.cursor).toEqual({ visible: true, emphasis: "none" });
    expect(result.variant.clicks).toEqual({ emphasis: "none" });
    expect(result.warnings).toEqual([
      {
        code: "missing_action_events",
        message: "No interaction events were available for baseline polish decisions.",
      },
    ]);
  });

  it("uses safe framing and warns when click coordinates are missing", async () => {
    const project = await writeLoadedProject([
      { id: "event-1", sequence: 1, type: "click", timestampMs: 1200, data: { button: 0 } },
      { id: "event-2", sequence: 2, type: "fill", timestampMs: 1800 },
    ]);

    const result = await generateBaselinePolishVariant(project);

    expect(result.variant.timeline).toEqual({ startMs: 700, endMs: 2550 });
    expect(result.variant.viewport).toEqual({
      mode: "contain",
      focus: { x: 0.5, y: 0.5 },
      zoom: 1.15,
    });
    expect(result.variant.clicks).toEqual({ emphasis: "ring" });
    expect(result.warnings).toEqual([
      {
        code: "missing_click_coordinates",
        message: "Click events did not include usable viewport coordinates.",
      },
    ]);
  });

  it("generates from incomplete and malformed metadata with structured warnings", async () => {
    const manifest: ProjectManifest = {
      ...baseManifest,
      sourceCapture: { ...baseManifest.sourceCapture, status: "failed" },
    };
    const project = await writeLoadedProject(
      [
        "{not-json",
        { id: "event-2", sequence: 2, type: "navigation", timestampMs: 500 },
        { id: "event-3", sequence: 3, type: "click", timestampMs: 7000 },
      ],
      manifest,
    );

    const result = await generateBaselinePolishVariant(project);

    expect(result.variant.timeline).toEqual({ startMs: 0, endMs: 1250 });
    expect(result.variant.viewport).toEqual({
      mode: "contain",
      focus: { x: 0.5, y: 0.5 },
      zoom: 1.15,
    });
    expect(result.warnings).toEqual([
      {
        code: "malformed_event_line",
        message: "One or more capture event lines could not be parsed.",
      },
      {
        code: "missing_click_coordinates",
        message: "Click events did not include usable viewport coordinates.",
      },
      {
        code: "incomplete_capture_status",
        message: "Source capture did not complete; baseline polish used available metadata.",
      },
    ]);
  });

  it("returns identical results for identical inputs", async () => {
    const events = [
      {
        id: "event-1",
        sequence: 1,
        type: "click",
        timestampMs: 2000,
        viewport: { width: 1280, height: 720 },
        data: { x: 320, y: 180 },
      },
    ];
    const first = await writeLoadedProject(events);
    const second = await writeLoadedProject(events);

    await expect(generateBaselinePolishVariant(first)).resolves.toEqual(
      await generateBaselinePolishVariant(second),
    );
  });
});
```

- [ ] **Step 3: Run focused tests to verify RED**

Run:

```bash
npm --workspace @auto-demo/polish test
```

Expected: FAIL because `generateBaselinePolishVariant` is not exported and the polish package does not yet have the implementation.

## Task 2: Implement Baseline Generator

**Files:**

- Modify: `packages/polish/src/index.ts`

- [ ] **Step 1: Replace placeholder implementation**

Replace `packages/polish/src/index.ts` with:

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LoadedProject, ProjectVariant } from "@auto-demo/project";

export type PolishPackageRole = "edit-decision-generation";

export const polishPackageRole: PolishPackageRole = "edit-decision-generation";

export type GenerateBaselinePolishOptions = {
  id?: string;
  displayName?: string;
};

export type PolishWarningCode =
  | "events_file_unreadable"
  | "events_file_empty"
  | "malformed_event_line"
  | "missing_action_events"
  | "missing_click_coordinates"
  | "incomplete_capture_status";

export type PolishWarning = {
  code: PolishWarningCode;
  message: string;
};

export type BaselinePolishResult = {
  variant: ProjectVariant;
  warnings: PolishWarning[];
};

type CaptureEventRecord = {
  type: string;
  timestampMs: number;
  viewport?: {
    width?: number;
    height?: number;
  };
  data?: Record<string, unknown>;
};

const ACTION_EVENT_TYPES = new Set(["click", "fill", "press", "navigation", "agent_step"]);

export async function generateBaselinePolishVariant(
  project: LoadedProject,
  options: GenerateBaselinePolishOptions = {},
): Promise<BaselinePolishResult> {
  const warnings: PolishWarning[] = [];
  const events = await readProjectEvents(project, warnings);
  const durationMs = project.manifest.sourceCapture.timing.durationMs;
  const actionEvents = events
    .filter((event) => ACTION_EVENT_TYPES.has(event.type))
    .filter((event) => event.timestampMs >= 0 && event.timestampMs <= durationMs)
    .sort((a, b) => a.timestampMs - b.timestampMs);
  const clickEvents = events.filter((event) => event.type === "click");
  const clickFocus = findClickFocus(clickEvents, project.manifest.sourceCapture.viewport);

  if (actionEvents.length === 0) {
    warnings.push({
      code: "missing_action_events",
      message: "No interaction events were available for baseline polish decisions.",
    });
  }

  if (clickEvents.length > 0 && clickFocus === null) {
    warnings.push({
      code: "missing_click_coordinates",
      message: "Click events did not include usable viewport coordinates.",
    });
  }

  if (project.manifest.sourceCapture.status !== "completed") {
    warnings.push({
      code: "incomplete_capture_status",
      message: "Source capture did not complete; baseline polish used available metadata.",
    });
  }

  const timeline = buildTimeline(actionEvents, durationMs);
  const hasActions = actionEvents.length > 0;
  const variant: ProjectVariant = {
    id: options.id ?? "baseline-polish",
    displayName: options.displayName ?? "Baseline Polish",
    source: {
      mediaPath: project.manifest.media.primary.path,
      eventsPath: project.manifest.metadata.events.path,
    },
    timeline,
    viewport: {
      mode: "contain",
      focus: clickFocus ?? { x: 0.5, y: 0.5 },
      zoom: clickFocus !== null ? 1.35 : hasActions ? 1.15 : 1,
    },
    cursor: {
      visible: true,
      emphasis: hasActions ? "spotlight" : "none",
    },
    clicks: {
      emphasis: clickEvents.length > 0 ? "ring" : "none",
    },
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
      aspectRatio: "16:9",
    },
  };

  return { variant, warnings: uniqueWarnings(warnings) };
}

async function readProjectEvents(
  project: LoadedProject,
  warnings: PolishWarning[],
): Promise<CaptureEventRecord[]> {
  const eventsPath = join(project.projectDir, project.manifest.metadata.events.path);
  let content: string;
  try {
    content = await readFile(eventsPath, "utf8");
  } catch {
    warnings.push({
      code: "events_file_unreadable",
      message: "Capture events file could not be read; baseline polish used safe defaults.",
    });
    return [];
  }

  if (content.trim().length === 0) {
    warnings.push({
      code: "events_file_empty",
      message: "Capture events file contained no events; baseline polish used safe defaults.",
    });
    return [];
  }

  const events: CaptureEventRecord[] = [];
  let malformed = false;
  for (const line of content.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as unknown;
      const event = parseEventRecord(parsed);
      if (event === null) {
        malformed = true;
      } else {
        events.push(event);
      }
    } catch {
      malformed = true;
    }
  }

  if (malformed) {
    warnings.push({
      code: "malformed_event_line",
      message: "One or more capture event lines could not be parsed.",
    });
  }

  if (events.length === 0) {
    warnings.push({
      code: "events_file_empty",
      message: "Capture events file contained no events; baseline polish used safe defaults.",
    });
  }

  return events;
}

function parseEventRecord(value: unknown): CaptureEventRecord | null {
  if (!isRecord(value) || typeof value.type !== "string" || !isInteger(value.timestampMs)) {
    return null;
  }

  const viewport = isRecord(value.viewport)
    ? {
        width: numberOrUndefined(value.viewport.width),
        height: numberOrUndefined(value.viewport.height),
      }
    : undefined;

  return {
    type: value.type,
    timestampMs: value.timestampMs,
    viewport,
    data: isRecord(value.data) ? value.data : undefined,
  };
}

function buildTimeline(
  actionEvents: CaptureEventRecord[],
  durationMs: number,
): ProjectVariant["timeline"] {
  if (actionEvents.length === 0) {
    return { startMs: 0, endMs: durationMs };
  }

  const firstActionMs = actionEvents[0]?.timestampMs ?? 0;
  const lastActionMs = actionEvents[actionEvents.length - 1]?.timestampMs ?? durationMs;
  const startMs = firstActionMs > 1000 ? Math.max(0, firstActionMs - 500) : 0;
  const endMs =
    durationMs - lastActionMs > 1000 ? Math.min(durationMs, lastActionMs + 750) : durationMs;

  return { startMs, endMs: Math.max(startMs + 1, endMs) };
}

function findClickFocus(
  clickEvents: CaptureEventRecord[],
  fallbackViewport: { width: number; height: number },
): { x: number; y: number } | null {
  for (const event of clickEvents) {
    const x = numberOrUndefined(event.data?.x);
    const y = numberOrUndefined(event.data?.y);
    const width = event.viewport?.width ?? fallbackViewport.width;
    const height = event.viewport?.height ?? fallbackViewport.height;

    if (
      x !== undefined &&
      y !== undefined &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      return {
        x: roundNormalized(clamp(x / width, 0, 1)),
        y: roundNormalized(clamp(y / height, 0, 1)),
      };
    }
  }

  return null;
}

function uniqueWarnings(warnings: PolishWarning[]): PolishWarning[] {
  const seen = new Set<PolishWarningCode>();
  return warnings.filter((warning) => {
    if (seen.has(warning.code)) {
      return false;
    }
    seen.add(warning.code);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundNormalized(value: number): number {
  return Math.round(value * 1000) / 1000;
}
```

- [ ] **Step 2: Run focused polish tests to verify GREEN**

Run:

```bash
npm --workspace @auto-demo/polish test
```

Expected: PASS.

## Task 3: Verify Package Integration

**Files:**

- Potentially modify: `packages/polish/src/index.ts`
- Potentially modify: `packages/polish/package.json`

- [ ] **Step 1: Run polish typecheck**

Run:

```bash
npm --workspace @auto-demo/polish run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run polish build**

Run:

```bash
npm --workspace @auto-demo/polish run build
```

Expected: PASS.

- [ ] **Step 3: Run project tests to ensure variant contract compatibility**

Run:

```bash
npm --workspace @auto-demo/project test -- src/index.test.ts
```

Expected: PASS.

## Task 4: Document Behavior

**Files:**

- Modify: `packages/polish/README.md`
- Modify: `README.md`

- [ ] **Step 1: Update package README**

Replace `packages/polish/README.md` with:

```markdown
# @auto-demo/polish

Creates edit decisions from project metadata.

The package currently exposes `generateBaselinePolishVariant(project, options)`,
which reads a validated Auto Demo project's `metadata/events.jsonl` file and
returns one deterministic schema v1 project variant plus structured warnings.
The baseline generator uses conservative trim, focus, cursor, and click-emphasis
rules so downstream persistence, rendering, and editor work can consume a stable
first-pass variant.

Planned work still owns saving generated variants, named style batches, rendered
previews, exports, and editor controls.
```

- [ ] **Step 2: Update root README status**

Change the `## Status` paragraph to mention that `@auto-demo/polish` can
generate a deterministic baseline variant from project event metadata, while
persistence, render, and editor behavior remain planned.

- [ ] **Step 3: Update root README package list**

Change the `@auto-demo/polish` package bullet to:

```markdown
- `@auto-demo/polish`: deterministic baseline edit-decision generation from project event metadata.
```

## Task 5: Run Full Validation

**Files:**

- No new source edits expected unless validation reveals a defect.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm --workspace @auto-demo/polish test
npm --workspace @auto-demo/project test -- src/index.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run package checks**

Run:

```bash
npm --workspace @auto-demo/polish run typecheck
npm --workspace @auto-demo/polish run build
```

Expected: PASS.

- [ ] **Step 3: Run repository validation**

Run:

```bash
npm run validate
```

Expected: PASS.

## Task 6: Completion Sync Prep

**Files:**

- Modify: `docs/linear/auto-demo-project-structure.md`
- Modify: `/Users/weston.bushyeager/code/personal/firstmate/state/auto-demo-next-ship-k8.status`

- [ ] **Step 1: Update project map**

Add WES-152 spec and plan links to Local Context. Add an investigation note and
completion evidence entry after local validation passes. Update the next-task
pointer to WES-153 unless the completion-gate Linear sync finds a blocker.

- [ ] **Step 2: Update firstmate status**

Append selected issue, spec path, plan path, changed behavior, and local
verification evidence.

- [ ] **Step 3: Commit scoped files**

Run:

```bash
git status --short
git add packages/polish/package.json packages/polish/src/index.ts packages/polish/src/index.test.ts packages/polish/README.md README.md docs/superpowers/specs/2026-07-02-wes-152-baseline-polish-decisions-design.md docs/superpowers/plans/2026-07-02-wes-152-baseline-polish-decisions.md docs/linear/auto-demo-project-structure.md
git commit -m "feat: generate baseline polish decisions"
```

Expected: commit succeeds on `wes-152-baseline-polish-decisions`.

## Self-Review

- Spec coverage: the plan covers the public API, event JSONL reading, deterministic generation, warnings, behavior tests, docs, project map, and validation.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: plan uses `LoadedProject`, `ProjectVariant`, `generateBaselinePolishVariant`, and warning type names consistently across tests and implementation.
