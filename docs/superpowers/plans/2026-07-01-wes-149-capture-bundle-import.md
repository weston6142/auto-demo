# WES-149 Capture Bundle Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `createProjectFromCaptureBundle()` to `@auto-demo/project` so validated WES-147 capture bundles can be imported into the normalized schema v1 Auto Demo project layout.

**Architecture:** `@auto-demo/project` remains the final-project schema owner and depends on `@auto-demo/capture` only for temporary bundle validation. The importer validates the source bundle, copies supported artifacts into fixed project-owned paths, writes sanitized project-owned capture summary metadata, builds a WES-148 schema v1 manifest, validates it, and returns structured non-secret errors for expected invalid input. WES-150 remains responsible for project load/save and full project file validation APIs.

**Tech Stack:** TypeScript, Node.js `fs/promises`, Node.js `path`, npm workspaces, Vitest, existing `@auto-demo/capture` bundle validation APIs.

---

## File Structure

- Modify `packages/project/package.json`: add a workspace dependency on `@auto-demo/capture`.
- Modify `packages/project/src/index.ts`: add import result types, `createProjectFromCaptureBundle()`, filesystem helpers, capture URL sanitization, project manifest building, summary metadata writing, and temp-file-then-rename JSON writes.
- Modify `packages/project/src/index.test.ts`: add behavior-oriented filesystem fixture tests for successful imports, direct manifest input, URL sanitization, invalid input, target collision handling, and source bundle immutability.
- Modify `README.md` only if final import support is user-facing enough to update the package status. For WES-149, no CLI behavior changes, so README changes are likely unnecessary.
- Modify `docs/linear/auto-demo-project-structure.md` after implementation to record completion evidence and next-task pointer.

Do not split `packages/project/src/index.ts` during WES-149 unless the implementation becomes materially hard to follow. This repo has kept the first project-format slice in a single entrypoint so far.

## Task 1: Add Capture Dependency And Import Test Fixtures

**Files:**

- Modify: `packages/project/package.json`
- Modify: `packages/project/src/index.test.ts`

- [ ] **Step 1: Add the workspace dependency**

Edit `packages/project/package.json` so it includes:

```json
{
  "name": "@auto-demo/project",
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
    "@auto-demo/capture": "0.0.0"
  }
}
```

- [ ] **Step 2: Add test imports and fixture helpers**

At the top of `packages/project/src/index.test.ts`, extend the imports:

```ts
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PROJECT_MANIFEST_FILENAME,
  SUPPORTED_PROJECT_SCHEMA_VERSION,
  createProjectFromCaptureBundle,
  validateProjectManifest,
  type ProjectManifest,
} from "./index.js";
```

Add these helpers below `validManifest`:

```ts
async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function writeCaptureBundle(
  captureDir: string,
  overrides: {
    url?: string;
    childCommand?: unknown;
    error?: unknown;
  } = {},
): Promise<void> {
  await mkdir(join(captureDir, "media"), { recursive: true });
  await mkdir(join(captureDir, "metadata"), { recursive: true });
  await writeFile(join(captureDir, "media", "viewport.webm"), "video-bytes");
  await writeFile(join(captureDir, "metadata", "events.jsonl"), '{"type":"navigation"}\n');

  const manifest = {
    schemaVersion: 1,
    status: "completed",
    source: {
      kind: "browser",
      url: overrides.url ?? "https://example.com/checkout",
    },
    adapter: {
      kind: "browser",
      backend: "playwright",
    },
    tools: {
      capturePackage: "0.0.0",
      playwright: "1.61.1",
    },
    viewport: {
      width: 1280,
      height: 720,
    },
    startedAt: "2026-06-29T12:00:00.000Z",
    endedAt: "2026-06-29T12:00:02.500Z",
    durationMs: 2500,
    artifacts: {
      media: "media/viewport.webm",
      events: "metadata/events.jsonl",
    },
    childCommand:
      overrides.childCommand === undefined
        ? {
            command: "demo",
            argCount: 2,
            argsRedacted: true,
            exitCode: 0,
          }
        : overrides.childCommand,
    error:
      overrides.error === undefined
        ? {
            code: "capture_failed",
            message: "Failed at https://example.com/checkout?token=secret",
          }
        : overrides.error,
  };

  await writeFile(
    join(captureDir, "capture.manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}
```

- [ ] **Step 3: Run the focused project tests to confirm the file still compiles before adding import assertions**

Run:

```bash
npm --workspace @auto-demo/project test -- src/index.test.ts
```

Expected: FAIL because `@auto-demo/capture` may not be installed in `package-lock.json` until `npm install` or `npm install --package-lock-only` updates the lock, or because `createProjectFromCaptureBundle` is not exported yet after Step 2. Either failure is acceptable at this point.

## Task 2: Write Failing Import Behavior Tests

**Files:**

- Modify: `packages/project/src/index.test.ts`

- [ ] **Step 1: Add a successful import test**

Append this test group to `packages/project/src/index.test.ts`:

```ts
describe("createProjectFromCaptureBundle", () => {
  it("imports a valid capture bundle into the normalized project layout", async () => {
    const rootDir = await makeTempDir("auto-demo-project-import-");
    const captureDir = join(rootDir, "capture");
    const projectDir = join(rootDir, "project");
    await writeCaptureBundle(captureDir);

    const result = await createProjectFromCaptureBundle({
      captureBundlePath: captureDir,
      projectDir,
      name: " Checkout flow demo ",
      now: () => new Date("2026-07-01T10:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected import to succeed");
    }

    expect(result.project.projectDir).toBe(projectDir);
    expect(result.project.manifestPath).toBe(join(projectDir, PROJECT_MANIFEST_FILENAME));
    expect(result.project.manifest).toEqual({
      schemaVersion: 1,
      name: "Checkout flow demo",
      createdAt: "2026-07-01T10:00:00.000Z",
      updatedAt: "2026-07-01T10:00:00.000Z",
      sourceCapture: {
        kind: "browser",
        status: "completed",
        source: { kind: "browser", url: "https://example.com/checkout" },
        viewport: { width: 1280, height: 720 },
        timing: {
          startedAt: "2026-06-29T12:00:00.000Z",
          endedAt: "2026-06-29T12:00:02.500Z",
          durationMs: 2500,
        },
        adapter: { kind: "browser", backend: "playwright" },
        tools: { capturePackage: "0.0.0", playwright: "1.61.1" },
        manifestPath: "metadata/capture.manifest.json",
      },
      media: {
        primary: {
          kind: "viewport",
          path: "raw/capture.webm",
          contentType: "video/webm",
        },
      },
      metadata: {
        events: {
          path: "metadata/events.jsonl",
          contentType: "application/x-ndjson",
        },
      },
      variants: [],
      previews: [],
      exports: [],
    });

    expect(await readFile(join(projectDir, "raw", "capture.webm"), "utf8")).toBe("video-bytes");
    expect(await readFile(join(projectDir, "metadata", "events.jsonl"), "utf8")).toBe(
      '{"type":"navigation"}\n',
    );

    const manifestJson = JSON.parse(
      await readFile(join(projectDir, PROJECT_MANIFEST_FILENAME), "utf8"),
    ) as unknown;
    expect(validateProjectManifest(manifestJson)).toEqual({
      ok: true,
      manifest: result.project.manifest,
    });

    await expect(stat(join(projectDir, "variants"))).resolves.toMatchObject({});
    await expect(stat(join(projectDir, "previews"))).resolves.toMatchObject({});
    await expect(stat(join(projectDir, "exports"))).resolves.toMatchObject({});
  });
});
```

- [ ] **Step 2: Add summary metadata and direct manifest path tests**

Inside the same `describe("createProjectFromCaptureBundle", ...)`, add:

```ts
it("rewrites capture summary metadata with project-owned artifact paths", async () => {
  const rootDir = await makeTempDir("auto-demo-project-summary-");
  const captureDir = join(rootDir, "capture");
  const projectDir = join(rootDir, "project");
  await writeCaptureBundle(captureDir);

  const result = await createProjectFromCaptureBundle({
    captureBundlePath: join(captureDir, "capture.manifest.json"),
    projectDir,
    name: "Checkout flow demo",
    now: () => new Date("2026-07-01T10:00:00.000Z"),
  });

  expect(result.ok).toBe(true);
  const summary = JSON.parse(
    await readFile(join(projectDir, "metadata", "capture.manifest.json"), "utf8"),
  ) as Record<string, unknown>;

  expect(summary).toEqual({
    schemaVersion: 1,
    status: "completed",
    source: { kind: "browser", url: "https://example.com/checkout" },
    adapter: { kind: "browser", backend: "playwright" },
    tools: { capturePackage: "0.0.0", playwright: "1.61.1" },
    viewport: { width: 1280, height: 720 },
    startedAt: "2026-06-29T12:00:00.000Z",
    endedAt: "2026-06-29T12:00:02.500Z",
    durationMs: 2500,
    artifacts: {
      media: "raw/capture.webm",
      events: "metadata/events.jsonl",
    },
  });
});
```

- [ ] **Step 3: Add sanitization and immutability tests**

Add:

```ts
it("sanitizes secret-bearing source URLs without mutating the capture bundle", async () => {
  const rootDir = await makeTempDir("auto-demo-project-url-");
  const captureDir = join(rootDir, "capture");
  const projectDir = join(rootDir, "project");
  await writeCaptureBundle(captureDir, {
    url: "https://user:pass@example.com/checkout?token=secret#payment",
  });
  const originalCaptureManifest = await readFile(join(captureDir, "capture.manifest.json"), "utf8");

  const result = await createProjectFromCaptureBundle({
    captureBundlePath: captureDir,
    projectDir,
    name: "Checkout flow demo",
    now: () => new Date("2026-07-01T10:00:00.000Z"),
  });

  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error("Expected import to succeed");
  }

  expect(result.project.manifest.sourceCapture.source.url).toBe("https://example.com/checkout");
  expect(await readFile(join(captureDir, "capture.manifest.json"), "utf8")).toBe(
    originalCaptureManifest,
  );
});
```

- [ ] **Step 4: Add invalid input tests**

Add:

```ts
it("returns a structured error for invalid capture bundles without creating a project", async () => {
  const rootDir = await makeTempDir("auto-demo-project-invalid-capture-");
  const captureDir = join(rootDir, "capture");
  const projectDir = join(rootDir, "project");
  await mkdir(captureDir, { recursive: true });
  await writeFile(join(captureDir, "capture.manifest.json"), "{not json");

  const result = await createProjectFromCaptureBundle({
    captureBundlePath: captureDir,
    projectDir,
    name: "Checkout flow demo",
  });

  expect(result).toEqual({
    ok: false,
    projectDir,
    manifestPath: join(projectDir, PROJECT_MANIFEST_FILENAME),
    errors: [
      {
        code: "invalid_capture_bundle",
        message: "Capture bundle cannot be imported.",
      },
    ],
  });
  await expect(readdir(projectDir)).rejects.toThrow();
});

it("rejects empty project names before creating files", async () => {
  const rootDir = await makeTempDir("auto-demo-project-empty-name-");
  const captureDir = join(rootDir, "capture");
  const projectDir = join(rootDir, "project");
  await writeCaptureBundle(captureDir);

  const result = await createProjectFromCaptureBundle({
    captureBundlePath: captureDir,
    projectDir,
    name: "   ",
  });

  expect(result).toEqual({
    ok: false,
    projectDir,
    manifestPath: join(projectDir, PROJECT_MANIFEST_FILENAME),
    errors: [
      {
        code: "invalid_project_input",
        message: "Project name must be a non-empty string.",
      },
    ],
  });
  await expect(readdir(projectDir)).rejects.toThrow();
});

it("rejects non-empty destination directories", async () => {
  const rootDir = await makeTempDir("auto-demo-project-non-empty-");
  const captureDir = join(rootDir, "capture");
  const projectDir = join(rootDir, "project");
  await writeCaptureBundle(captureDir);
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, "existing.txt"), "keep me");

  const result = await createProjectFromCaptureBundle({
    captureBundlePath: captureDir,
    projectDir,
    name: "Checkout flow demo",
  });

  expect(result).toEqual({
    ok: false,
    projectDir,
    manifestPath: join(projectDir, PROJECT_MANIFEST_FILENAME),
    errors: [
      {
        code: "project_directory_not_empty",
        message: "Project directory must be empty before import.",
      },
    ],
  });
  expect(await readFile(join(projectDir, "existing.txt"), "utf8")).toBe("keep me");
});
```

- [ ] **Step 5: Run the focused test and verify it fails for the missing implementation**

Run:

```bash
npm --workspace @auto-demo/project test -- src/index.test.ts
```

Expected: FAIL because `createProjectFromCaptureBundle` is not exported or not implemented.

## Task 3: Implement Import API Types And Preflight Validation

**Files:**

- Modify: `packages/project/src/index.ts`

- [ ] **Step 1: Add imports and public types**

At the top of `packages/project/src/index.ts`, add:

```ts
import { copyFile, mkdir, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { validateCaptureBundle, type CaptureManifest } from "@auto-demo/capture";
```

After `ProjectValidationResult`, add:

```ts
export type ProjectImportErrorCode =
  | ProjectValidationErrorCode
  | "invalid_capture_bundle"
  | "invalid_project_input"
  | "project_directory_not_empty";

export type ProjectImportError = {
  code: ProjectImportErrorCode;
  message: string;
};

export type CreateProjectFromCaptureBundleInput = {
  captureBundlePath: string;
  projectDir: string;
  name: string;
  now?: () => Date;
};

export type ImportedProject = {
  projectDir: string;
  manifestPath: string;
  manifest: ProjectManifest;
};

export type ProjectImportResult =
  | {
      ok: true;
      project: ImportedProject;
    }
  | {
      ok: false;
      projectDir: string;
      manifestPath: string;
      errors: ProjectImportError[];
    };
```

- [ ] **Step 2: Add fixed path constants**

Near the existing key constants, add:

```ts
const PROJECT_MEDIA_PATH = "raw/capture.webm";
const PROJECT_EVENTS_PATH = "metadata/events.jsonl";
const PROJECT_CAPTURE_SUMMARY_PATH = "metadata/capture.manifest.json";
```

- [ ] **Step 3: Add project input preflight helpers**

Near the bottom of the file before existing primitive helpers, add:

```ts
async function validateProjectImportTarget(
  input: CreateProjectFromCaptureBundleInput,
  manifestPath: string,
): Promise<ProjectImportError[]> {
  const errors: ProjectImportError[] = [];

  if (input.name.trim().length === 0) {
    errors.push({
      code: "invalid_project_input",
      message: "Project name must be a non-empty string.",
    });
  }

  if (input.projectDir.trim().length === 0) {
    errors.push({
      code: "invalid_project_input",
      message: "Project directory must be a non-empty path.",
    });
  }

  if (errors.length > 0) {
    return errors;
  }

  try {
    const target = await stat(input.projectDir);
    if (!target.isDirectory()) {
      return [
        {
          code: "invalid_project_input",
          message: "Project directory path must reference a directory.",
        },
      ];
    }

    const entries = await readdir(input.projectDir);
    if (entries.length > 0) {
      return [
        {
          code: "project_directory_not_empty",
          message: "Project directory must be empty before import.",
        },
      ];
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  void manifestPath;
  return [];
}

function importFailure(
  projectDir: string,
  manifestPath: string,
  errors: ProjectImportError[],
): ProjectImportResult {
  return {
    ok: false,
    projectDir,
    manifestPath,
    errors,
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
```

- [ ] **Step 4: Add a skeleton `createProjectFromCaptureBundle()`**

Add this exported function after `validateProjectManifest()`:

```ts
export async function createProjectFromCaptureBundle(
  input: CreateProjectFromCaptureBundleInput,
): Promise<ProjectImportResult> {
  const projectDir = input.projectDir;
  const manifestPath = join(projectDir, PROJECT_MANIFEST_FILENAME);
  const inputErrors = await validateProjectImportTarget(input, manifestPath);

  if (inputErrors.length > 0) {
    return importFailure(projectDir, manifestPath, inputErrors);
  }

  const capture = await validateCaptureBundle(input.captureBundlePath);
  if (!capture.ok) {
    return importFailure(projectDir, manifestPath, [
      {
        code: "invalid_capture_bundle",
        message: "Capture bundle cannot be imported.",
      },
    ]);
  }

  return importFailure(projectDir, manifestPath, [
    {
      code: "invalid_project_input",
      message: "Project import is not implemented.",
    },
  ]);
}
```

- [ ] **Step 5: Run the focused tests**

Run:

```bash
npm --workspace @auto-demo/project test -- src/index.test.ts
```

Expected: invalid input tests may pass, successful import tests fail with `"Project import is not implemented."`.

## Task 4: Implement Manifest Mapping, Sanitization, And File Writes

**Files:**

- Modify: `packages/project/src/index.ts`

- [ ] **Step 1: Add manifest construction helpers**

Add:

```ts
function buildProjectManifest(input: {
  capture: CaptureManifest;
  name: string;
  now: Date;
}): ProjectManifest | ProjectImportError[] {
  const sourceUrl = sanitizeProjectSourceUrl(input.capture.source.url);
  if (sourceUrl === null) {
    return [
      {
        code: "invalid_capture_bundle",
        message: "Capture bundle source URL cannot be imported.",
      },
    ];
  }

  const timestamp = input.now.toISOString();

  return {
    schemaVersion: SUPPORTED_PROJECT_SCHEMA_VERSION,
    name: input.name.trim(),
    createdAt: timestamp,
    updatedAt: timestamp,
    sourceCapture: {
      kind: "browser",
      status: input.capture.status,
      source: {
        kind: "browser",
        url: sourceUrl,
      },
      viewport: input.capture.viewport,
      timing: {
        startedAt: input.capture.startedAt,
        endedAt: input.capture.endedAt,
        durationMs: input.capture.durationMs,
      },
      adapter: input.capture.adapter,
      tools: input.capture.tools,
      manifestPath: PROJECT_CAPTURE_SUMMARY_PATH,
    },
    media: {
      primary: {
        kind: "viewport",
        path: PROJECT_MEDIA_PATH,
        contentType: "video/webm",
      },
    },
    metadata: {
      events: {
        path: PROJECT_EVENTS_PATH,
        contentType: "application/x-ndjson",
      },
    },
    variants: [],
    previews: [],
    exports: [],
  };
}

function buildProjectCaptureSummary(capture: CaptureManifest, sourceUrl: string): unknown {
  return {
    schemaVersion: capture.schemaVersion,
    status: capture.status,
    source: {
      kind: capture.source.kind,
      url: sourceUrl,
    },
    adapter: capture.adapter,
    tools: capture.tools,
    viewport: capture.viewport,
    startedAt: capture.startedAt,
    endedAt: capture.endedAt,
    durationMs: capture.durationMs,
    artifacts: {
      media: PROJECT_MEDIA_PATH,
      events: PROJECT_EVENTS_PATH,
    },
  };
}

function sanitizeProjectSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return `${url.origin}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Add filesystem write helpers**

Add:

```ts
async function writeJsonFileAtomically(path: string, value: unknown): Promise<void> {
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tempPath, path);
}

async function createProjectDirectories(projectDir: string): Promise<void> {
  await mkdir(join(projectDir, "raw"), { recursive: true });
  await mkdir(join(projectDir, "metadata"), { recursive: true });
  await mkdir(join(projectDir, "variants"), { recursive: true });
  await mkdir(join(projectDir, "previews"), { recursive: true });
  await mkdir(join(projectDir, "exports"), { recursive: true });
}

async function copyCaptureArtifacts(input: {
  captureManifestPath: string;
  capture: CaptureManifest;
  projectDir: string;
}): Promise<void> {
  const captureDir = dirname(input.captureManifestPath);
  await copyFile(
    join(captureDir, input.capture.artifacts.media),
    join(input.projectDir, PROJECT_MEDIA_PATH),
  );
  await copyFile(
    join(captureDir, input.capture.artifacts.events),
    join(input.projectDir, PROJECT_EVENTS_PATH),
  );
}
```

- [ ] **Step 3: Replace the skeleton import failure with the real implementation**

Replace the last `return importFailure(...)` block in `createProjectFromCaptureBundle()` with:

```ts
const manifest = buildProjectManifest({
  capture: capture.manifest,
  name: input.name,
  now: input.now?.() ?? new Date(),
});

if (Array.isArray(manifest)) {
  return importFailure(projectDir, manifestPath, manifest);
}

const manifestValidation = validateProjectManifest(manifest);
if (!manifestValidation.ok) {
  return importFailure(projectDir, manifestPath, manifestValidation.errors);
}

await createProjectDirectories(projectDir);
await copyCaptureArtifacts({
  captureManifestPath: capture.manifestPath,
  capture: capture.manifest,
  projectDir,
});

await writeJsonFileAtomically(
  join(projectDir, PROJECT_CAPTURE_SUMMARY_PATH),
  buildProjectCaptureSummary(capture.manifest, manifest.sourceCapture.source.url),
);
await writeJsonFileAtomically(manifestPath, manifestValidation.manifest);

return {
  ok: true,
  project: {
    projectDir,
    manifestPath,
    manifest: manifestValidation.manifest,
  },
};
```

- [ ] **Step 4: Run the focused tests**

Run:

```bash
npm --workspace @auto-demo/project test -- src/index.test.ts
```

Expected: PASS for WES-149 focused project tests.

## Task 5: Polish Types, Formatting, And Package Lock

**Files:**

- Modify: `packages/project/package.json`
- Modify: `package-lock.json`
- Modify: `packages/project/src/index.ts`
- Modify: `packages/project/src/index.test.ts`

- [ ] **Step 1: Update lockfile for the new workspace dependency**

Run:

```bash
npm install --package-lock-only
```

Expected: `package-lock.json` records `packages/project` depending on `@auto-demo/capture`.

- [ ] **Step 2: Run typecheck and fix any type-only issues**

Run:

```bash
npm --workspace @auto-demo/project run typecheck
```

Expected: PASS. If it fails, fix only type mismatches in `packages/project/src/index.ts` or `packages/project/src/index.test.ts`.

- [ ] **Step 3: Run formatter for touched files**

Run:

```bash
npm run format -- packages/project/src/index.ts packages/project/src/index.test.ts packages/project/package.json package-lock.json
```

Expected: files are formatted by Prettier.

- [ ] **Step 4: Re-run focused tests**

Run:

```bash
npm --workspace @auto-demo/project test -- src/index.test.ts
```

Expected: PASS.

## Task 6: Update Project Map Completion Notes

**Files:**

- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Add WES-149 implementation notes**

In `docs/linear/auto-demo-project-structure.md`, under `## Investigation Notes`, add a concise note:

```markdown
- 2026-07-01 WES-149 implementation: `@auto-demo/project` imports validated WES-147 capture bundles into the schema v1 project layout through `createProjectFromCaptureBundle()`. The importer copies viewport media and event metadata into normalized project-owned paths, rewrites `metadata/capture.manifest.json` as sanitized project summary metadata, writes `autodemo.project.json`, rejects invalid capture/project input with structured non-secret errors, and leaves WES-150 responsible for project load/save/file validation.
```

Under `## Completion Evidence`, add:

```markdown
- WES-149: Capture bundle import implemented in `@auto-demo/project` with normalized `raw/capture.webm`, `metadata/events.jsonl`, sanitized `metadata/capture.manifest.json`, schema v1 `autodemo.project.json`, direct manifest-path input, source URL sanitization, non-empty destination rejection, and behavior-oriented import tests.
```

- [ ] **Step 2: Keep WES-150 as the next Demo Project Format child**

Confirm the `Current Next-Task Selection Rule` line points to WES-150 after implementation. If it still says WES-149, change the final sentence to:

```markdown
Prefer the earliest milestone with incomplete issues. Within that milestone, prefer started issues, then unblocked design/spec issues, then implementation issues whose dependencies are satisfied. Current active local product task: WES-150.
```

Do not mark WES-134 Done in this task.

## Task 7: Verification, Commit, And No-Mistakes Handoff

**Files:**

- Review all changed files.

- [ ] **Step 1: Run focused package verification**

Run:

```bash
npm --workspace @auto-demo/project test -- src/index.test.ts
npm --workspace @auto-demo/project run typecheck
npm --workspace @auto-demo/project run build
```

Expected: all commands exit 0.

- [ ] **Step 2: Run repo-level verification**

Run:

```bash
npm run validate
```

Expected: build, typecheck, lint, tests, and format check all exit 0.

- [ ] **Step 3: Review the diff**

Run:

```bash
git diff -- packages/project/package.json package-lock.json packages/project/src/index.ts packages/project/src/index.test.ts docs/linear/auto-demo-project-structure.md docs/superpowers/specs/2026-07-01-wes-149-capture-bundle-import-design.md docs/superpowers/plans/2026-07-01-wes-149-capture-bundle-import.md
git status --short
```

Expected: diff contains only WES-149 implementation, WES-149 spec/plan docs, the earlier Linear sync map changes, and lockfile dependency updates.

- [ ] **Step 4: Stage only intended changes**

Run:

```bash
git add packages/project/package.json package-lock.json packages/project/src/index.ts packages/project/src/index.test.ts docs/linear/auto-demo-project-structure.md docs/superpowers/specs/2026-07-01-wes-149-capture-bundle-import-design.md docs/superpowers/plans/2026-07-01-wes-149-capture-bundle-import.md
git diff --cached --stat
```

Expected: only the listed WES-149 files are staged.

- [ ] **Step 5: Ensure the work is not committed directly on TARGET_BRANCH**

Run:

```bash
git branch --show-current
```

If the output equals `TARGET_BRANCH`, create and switch to a feature branch before committing:

```bash
git switch -c wes-149-capture-bundle-import
```

If the output is not `TARGET_BRANCH`, stay on the current branch.

- [ ] **Step 6: Commit**

Run:

```bash
git commit -m "feat: import capture bundles into projects"
```

Expected: commit succeeds with the staged WES-149 changes.

- [ ] **Step 7: Check no-mistakes health**

Run:

```bash
no-mistakes doctor
```

Expected: no-mistakes reports a healthy setup for the intended Codex agent.

- [ ] **Step 8: Push through no-mistakes with explicit base**

Run:

```bash
git push no-mistakes HEAD -o no-mistakes.base=TARGET_BRANCH
```

Replace `TARGET_BRANCH` with the user-provided branch name. Do not set or change the local branch upstream and do not edit no-mistakes repo metadata.

- [ ] **Step 9: Monitor no-mistakes with compact polling**

Run about once every 60 seconds:

```bash
no-mistakes axi status
```

Post an update only when the step changes, a finding appears, approval is needed, a PR is created, checks pass, or a stall is suspected. If a step fails or appears stalled, inspect only that step:

```bash
no-mistakes axi logs --step STEP --full
```

If the log tail does not change over roughly 5 minutes, report that no-mistakes may be stalled and ask how to proceed.

- [ ] **Step 10: Stop monitoring when checks pass**

Once no-mistakes reports `checks-passed` or says CI checks passed and it is only monitoring until merged or closed, post the PR link and stop monitoring. The PR is ready for human review or merge.

- [ ] **Step 11: Fast-forward local branch after pipeline mutation steps are done**

After no-mistakes applies commits and the pipeline is done or clearly past mutation steps, run:

```bash
CURRENT_BRANCH="$(git branch --show-current)"
git fetch origin "$CURRENT_BRANCH"
git merge --ff-only FETCH_HEAD
```

If the target branch is `develop` and the PR is merged, switch to `develop` and pull:

```bash
git switch develop
git pull
```
