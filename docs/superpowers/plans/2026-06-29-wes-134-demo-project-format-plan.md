# WES-134 Demo Project Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first portable Auto Demo project format slice in `@auto-demo/project`, including schema version 1, project validation/load/save, and import from WES-147 capture bundles.

**Architecture:** `@auto-demo/project` owns the final project directory schema and behavior-oriented APIs. It depends on `@auto-demo/capture` only to validate and read temporary capture bundles during import, then copies artifacts into normalized project-owned paths and writes `autodemo.project.json` with portable relative references.

**Tech Stack:** TypeScript, Node.js `fs/promises` and `path`, Vitest, npm workspaces, existing `@auto-demo/capture` manifest APIs.

---

## File Structure

- Modify `packages/project/package.json`: add the workspace dependency on `@auto-demo/capture` and keep existing scripts.
- Replace `packages/project/src/index.ts`: export public project constants, types, validation, load, save, and import APIs.
- Replace `packages/project/src/index.test.ts`: cover black-box behavior for import, validation, load, and save.
- Modify `README.md` only if CLI or user-facing project behavior changes in the implementation branch.
- Modify `docs/linear/auto-demo-project-structure.md` after implementation to record completion evidence and next-task scope.

Keep `packages/project/src/index.ts` as one file for this first small slice. Split later only when project-format behavior grows beyond validation/import/load/save.

## Public API Target

The implementation should expose these names from `@auto-demo/project`:

```ts
export const PROJECT_MANIFEST_FILENAME = "autodemo.project.json";
export const SUPPORTED_PROJECT_SCHEMA_VERSION = 1;

export type ProjectManifest = {
  schemaVersion: 1;
  name: string;
  createdAt: string;
  updatedAt: string;
  sourceCapture: ProjectSourceCapture;
  media: {
    primary: {
      kind: "viewport";
      path: string;
      contentType: "video/webm";
    };
  };
  metadata: {
    events: {
      path: string;
      contentType: "application/x-ndjson";
    };
  };
  variants: [];
  previews: [];
  exports: [];
};

export type ProjectSourceCapture = {
  kind: "browser";
  status: "completed" | "failed" | "interrupted";
  source: {
    kind: "browser";
    url: string;
  };
  viewport: {
    width: number;
    height: number;
  };
  timing: {
    startedAt: string;
    endedAt: string;
    durationMs: number;
  };
  adapter: {
    kind: "browser";
    backend: "playwright";
  };
  tools: {
    capturePackage: string;
    playwright: string;
  };
  manifestPath: "metadata/capture.manifest.json";
};

export type ProjectValidationError = {
  code:
    | "missing_project_manifest"
    | "invalid_project_json"
    | "unsupported_project_version"
    | "invalid_project_manifest"
    | "unsafe_project_path"
    | "missing_project_file";
  message: string;
};

export type ProjectValidationResult =
  | {
      ok: true;
      projectDir: string;
      manifestPath: string;
      manifest: ProjectManifest;
    }
  | {
      ok: false;
      projectDir: string;
      manifestPath: string;
      errors: ProjectValidationError[];
    };

export type LoadedProject = {
  projectDir: string;
  manifestPath: string;
  manifest: ProjectManifest;
};

export type CreateProjectFromCaptureBundleInput = {
  captureBundlePath: string;
  projectDir: string;
  name: string;
  now?: () => Date;
};

export async function createProjectFromCaptureBundle(
  input: CreateProjectFromCaptureBundleInput,
): Promise<ProjectValidationResult>;

export async function validateProject(
  projectDirOrManifest: string,
): Promise<ProjectValidationResult>;

export async function loadProject(projectDirOrManifest: string): Promise<ProjectValidationResult>;

export async function saveProject(project: LoadedProject): Promise<ProjectValidationResult>;
```

## Task 1: Project Schema Validation

**Files:**

- Modify: `packages/project/src/index.test.ts`
- Modify: `packages/project/src/index.ts`

- [ ] **Step 1: Write failing validation tests**

Replace `packages/project/src/index.test.ts` with this first test group:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { PROJECT_MANIFEST_FILENAME, validateProjectManifest } from "./index.js";

const validManifest = {
  schemaVersion: 1,
  name: "Checkout flow demo",
  createdAt: "2026-06-29T12:00:00.000Z",
  updatedAt: "2026-06-29T12:00:00.000Z",
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
    primary: { kind: "viewport", path: "raw/capture.webm", contentType: "video/webm" },
  },
  metadata: {
    events: { path: "metadata/events.jsonl", contentType: "application/x-ndjson" },
  },
  variants: [],
  previews: [],
  exports: [],
};

describe("validateProjectManifest", () => {
  it("accepts the supported portable project manifest shape", () => {
    const result = validateProjectManifest(validManifest);

    expect(result).toEqual({ ok: true, manifest: validManifest });
  });

  it("rejects unsupported schema versions with a structured error", () => {
    const result = validateProjectManifest({ ...validManifest, schemaVersion: 99 });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "unsupported_project_version",
          message: "Unsupported Auto Demo project schema version: 99",
        },
      ],
    });
  });

  it("rejects missing explicit forward-compatible sections", () => {
    const { variants: _variants, ...withoutVariants } = validManifest;

    const result = validateProjectManifest(withoutVariants);

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "invalid_project_manifest",
          message:
            "Auto Demo project manifest must include variants, previews, and exports arrays.",
        },
      ],
    });
  });

  it("rejects unsafe project artifact paths", () => {
    const result = validateProjectManifest({
      ...validManifest,
      media: {
        primary: {
          kind: "viewport",
          path: "../capture.webm",
          contentType: "video/webm",
        },
      },
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "unsafe_project_path",
          message: "Project media.primary.path must be a relative path inside the project.",
        },
      ],
    });
  });
});

export async function createFixtureProject(manifest = validManifest) {
  const projectDir = await mkdtemp(join(tmpdir(), "auto-demo-project-"));
  await mkdir(join(projectDir, "raw"), { recursive: true });
  await mkdir(join(projectDir, "metadata"), { recursive: true });
  await mkdir(join(projectDir, "variants"), { recursive: true });
  await mkdir(join(projectDir, "previews"), { recursive: true });
  await mkdir(join(projectDir, "exports"), { recursive: true });
  await writeFile(join(projectDir, "raw", "capture.webm"), "video");
  await writeFile(join(projectDir, "metadata", "events.jsonl"), "{}\n");
  await writeFile(join(projectDir, "metadata", "capture.manifest.json"), "{}\n");
  await writeFile(
    join(projectDir, PROJECT_MANIFEST_FILENAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return projectDir;
}
```

- [ ] **Step 2: Run validation tests and confirm failure**

Run:

```bash
npm --workspace @auto-demo/project test -- src/index.test.ts
```

Expected: FAIL because `validateProjectManifest()` still accepts only the old minimal
manifest shape and does not return `errors`.

- [ ] **Step 3: Implement the schema validator**

Replace `packages/project/src/index.ts` with a validator that matches the target API:

```ts
import { isAbsolute, win32 } from "node:path";

export const PROJECT_MANIFEST_FILENAME = "autodemo.project.json";
export const SUPPORTED_PROJECT_SCHEMA_VERSION = 1;

export type ProjectSourceCapture = {
  kind: "browser";
  status: "completed" | "failed" | "interrupted";
  source: { kind: "browser"; url: string };
  viewport: { width: number; height: number };
  timing: { startedAt: string; endedAt: string; durationMs: number };
  adapter: { kind: "browser"; backend: "playwright" };
  tools: { capturePackage: string; playwright: string };
  manifestPath: "metadata/capture.manifest.json";
};

export type ProjectManifest = {
  schemaVersion: 1;
  name: string;
  createdAt: string;
  updatedAt: string;
  sourceCapture: ProjectSourceCapture;
  media: { primary: { kind: "viewport"; path: string; contentType: "video/webm" } };
  metadata: { events: { path: string; contentType: "application/x-ndjson" } };
  variants: [];
  previews: [];
  exports: [];
};

export type ProjectValidationError = {
  code:
    | "missing_project_manifest"
    | "invalid_project_json"
    | "unsupported_project_version"
    | "invalid_project_manifest"
    | "unsafe_project_path"
    | "missing_project_file";
  message: string;
};

export type ProjectManifestValidationResult =
  { ok: true; manifest: ProjectManifest } | { ok: false; errors: ProjectValidationError[] };

export function validateProjectManifest(input: unknown): ProjectManifestValidationResult {
  const errors: ProjectValidationError[] = [];
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [
        {
          code: "invalid_project_manifest",
          message: "Auto Demo project manifest must be a JSON object.",
        },
      ],
    };
  }

  if (input.schemaVersion !== SUPPORTED_PROJECT_SCHEMA_VERSION) {
    errors.push({
      code: "unsupported_project_version",
      message: `Unsupported Auto Demo project schema version: ${String(input.schemaVersion)}`,
    });
  }

  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest must include a non-empty name.",
    });
  }

  if (!isIsoDateString(input.createdAt)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest must include an ISO createdAt timestamp.",
    });
  }

  if (!isIsoDateString(input.updatedAt)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest must include an ISO updatedAt timestamp.",
    });
  }

  validateSourceCapture(input.sourceCapture, errors);
  validateMedia(input.media, errors);
  validateMetadata(input.metadata, errors);

  if (
    !Array.isArray(input.variants) ||
    !Array.isArray(input.previews) ||
    !Array.isArray(input.exports)
  ) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest must include variants, previews, and exports arrays.",
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, manifest: input as ProjectManifest };
}

function validateSourceCapture(value: unknown, errors: ProjectValidationError[]): void {
  if (!isRecord(value)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest must include sourceCapture.",
    });
    return;
  }

  if (
    value.kind !== "browser" ||
    !["completed", "failed", "interrupted"].includes(stringValue(value.status)) ||
    !isRecord(value.source) ||
    value.source.kind !== "browser" ||
    !isNonEmptyString(value.source.url) ||
    !isRecord(value.viewport) ||
    !isPositiveNumber(value.viewport.width) ||
    !isPositiveNumber(value.viewport.height) ||
    !isRecord(value.timing) ||
    !isIsoDateString(value.timing.startedAt) ||
    !isIsoDateString(value.timing.endedAt) ||
    typeof value.timing.durationMs !== "number" ||
    value.timing.durationMs < 0 ||
    !isRecord(value.adapter) ||
    value.adapter.kind !== "browser" ||
    value.adapter.backend !== "playwright" ||
    !isRecord(value.tools) ||
    !isNonEmptyString(value.tools.capturePackage) ||
    !isNonEmptyString(value.tools.playwright) ||
    value.manifestPath !== "metadata/capture.manifest.json"
  ) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest sourceCapture is invalid.",
    });
  }
}

function validateMedia(value: unknown, errors: ProjectValidationError[]): void {
  if (
    !isRecord(value) ||
    !isRecord(value.primary) ||
    value.primary.kind !== "viewport" ||
    value.primary.contentType !== "video/webm" ||
    !isPortablePath(value.primary.path)
  ) {
    errors.push({
      code:
        isRecord(value) && isRecord(value.primary) && !isPortablePath(value.primary.path)
          ? "unsafe_project_path"
          : "invalid_project_manifest",
      message:
        isRecord(value) && isRecord(value.primary) && !isPortablePath(value.primary.path)
          ? "Project media.primary.path must be a relative path inside the project."
          : "Auto Demo project manifest media.primary is invalid.",
    });
  }
}

function validateMetadata(value: unknown, errors: ProjectValidationError[]): void {
  if (
    !isRecord(value) ||
    !isRecord(value.events) ||
    value.events.contentType !== "application/x-ndjson" ||
    !isPortablePath(value.events.path)
  ) {
    errors.push({
      code:
        isRecord(value) && isRecord(value.events) && !isPortablePath(value.events.path)
          ? "unsafe_project_path"
          : "invalid_project_manifest",
      message:
        isRecord(value) && isRecord(value.events) && !isPortablePath(value.events.path)
          ? "Project metadata.events.path must be a relative path inside the project."
          : "Auto Demo project manifest metadata.events is invalid.",
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isPortablePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !isAbsolute(value) &&
    !win32.isAbsolute(value) &&
    !value.split(/[\\/]/).includes("..")
  );
}
```

- [ ] **Step 4: Run validation tests and confirm pass**

Run:

```bash
npm --workspace @auto-demo/project test -- src/index.test.ts
```

Expected: PASS for the schema validation group.

- [ ] **Step 5: Commit**

```bash
git add packages/project/src/index.ts packages/project/src/index.test.ts
git commit -m "feat: define project manifest validation"
```

## Task 2: Project File Validation, Load, And Save

**Files:**

- Modify: `packages/project/src/index.test.ts`
- Modify: `packages/project/src/index.ts`

- [ ] **Step 1: Add failing load/save tests**

Append this group to `packages/project/src/index.test.ts`:

```ts
import { readFile, rm } from "node:fs/promises";
import { validateProject, loadProject, saveProject, type LoadedProject } from "./index.js";

describe("project load/save validation", () => {
  it("loads a valid project from a directory", async () => {
    const projectDir = await createFixtureProject();

    const result = await loadProject(projectDir);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.projectDir).toBe(projectDir);
      expect(result.manifest.name).toBe("Checkout flow demo");
      expect(result.manifest.media.primary.path).toBe("raw/capture.webm");
    }
  });

  it("reports missing referenced files without leaking path contents outside the project", async () => {
    const projectDir = await createFixtureProject();
    await rm(join(projectDir, "raw", "capture.webm"));

    const result = await validateProject(projectDir);

    expect(result).toEqual({
      ok: false,
      projectDir,
      manifestPath: join(projectDir, PROJECT_MANIFEST_FILENAME),
      errors: [
        {
          code: "missing_project_file",
          message: "Missing project media file: raw/capture.webm",
        },
      ],
    });
  });

  it("saves formatted manifest JSON without changing artifact files", async () => {
    const projectDir = await createFixtureProject();
    const loaded = await loadProject(projectDir);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const beforeArtifact = await readFile(join(projectDir, "metadata", "events.jsonl"), "utf8");
    const project: LoadedProject = {
      ...loaded,
      manifest: { ...loaded.manifest, name: "Updated checkout demo" },
    };

    const saved = await saveProject(project);

    expect(saved.ok).toBe(true);
    expect(await readFile(join(projectDir, "metadata", "events.jsonl"), "utf8")).toBe(
      beforeArtifact,
    );
    expect(await readFile(join(projectDir, PROJECT_MANIFEST_FILENAME), "utf8")).toContain(
      '"name": "Updated checkout demo"',
    );
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
npm --workspace @auto-demo/project test -- src/index.test.ts
```

Expected: FAIL because `validateProject()`, `loadProject()`, `saveProject()`, and `LoadedProject`
are not exported.

- [ ] **Step 3: Implement load, save, and file validation**

Extend `packages/project/src/index.ts` with these imports and exports:

```ts
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
```

Add these types and functions below `ProjectManifestValidationResult`:

```ts
export type ProjectValidationResult =
  | { ok: true; projectDir: string; manifestPath: string; manifest: ProjectManifest }
  | { ok: false; projectDir: string; manifestPath: string; errors: ProjectValidationError[] };

export type LoadedProject = {
  projectDir: string;
  manifestPath: string;
  manifest: ProjectManifest;
};

export async function validateProject(
  projectDirOrManifest: string,
): Promise<ProjectValidationResult> {
  const { projectDir, manifestPath } = resolveProjectPaths(projectDirOrManifest);
  let parsed: unknown;

  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      projectDir,
      manifestPath,
      errors: [
        {
          code: error instanceof SyntaxError ? "invalid_project_json" : "missing_project_manifest",
          message:
            error instanceof SyntaxError
              ? "Auto Demo project manifest JSON is not parseable."
              : "Auto Demo project manifest cannot be read.",
        },
      ],
    };
  }

  const manifestResult = validateProjectManifest(parsed);
  if (!manifestResult.ok) {
    return { ok: false, projectDir, manifestPath, errors: manifestResult.errors };
  }

  const fileErrors: ProjectValidationError[] = [];
  await validateReferencedFile(
    projectDir,
    manifestResult.manifest.media.primary.path,
    "media",
    fileErrors,
  );
  await validateReferencedFile(
    projectDir,
    manifestResult.manifest.metadata.events.path,
    "metadata",
    fileErrors,
  );
  await validateReferencedFile(
    projectDir,
    manifestResult.manifest.sourceCapture.manifestPath,
    "capture manifest",
    fileErrors,
  );

  if (fileErrors.length > 0) {
    return { ok: false, projectDir, manifestPath, errors: fileErrors };
  }

  return { ok: true, projectDir, manifestPath, manifest: manifestResult.manifest };
}

export async function loadProject(projectDirOrManifest: string): Promise<ProjectValidationResult> {
  return await validateProject(projectDirOrManifest);
}

export async function saveProject(project: LoadedProject): Promise<ProjectValidationResult> {
  const manifestResult = validateProjectManifest(project.manifest);
  if (!manifestResult.ok) {
    return {
      ok: false,
      projectDir: project.projectDir,
      manifestPath: project.manifestPath,
      errors: manifestResult.errors,
    };
  }

  await mkdir(dirname(project.manifestPath), { recursive: true });
  const tempPath = `${project.manifestPath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(project.manifest, null, 2)}\n`);
  await rename(tempPath, project.manifestPath);
  return await validateProject(project.manifestPath);
}

function resolveProjectPaths(projectDirOrManifest: string): {
  projectDir: string;
  manifestPath: string;
} {
  const manifestPath =
    basename(projectDirOrManifest) === PROJECT_MANIFEST_FILENAME
      ? resolve(projectDirOrManifest)
      : resolve(projectDirOrManifest, PROJECT_MANIFEST_FILENAME);
  return { projectDir: dirname(manifestPath), manifestPath };
}

async function validateReferencedFile(
  projectDir: string,
  relativePath: string,
  label: "media" | "metadata" | "capture manifest",
  errors: ProjectValidationError[],
): Promise<void> {
  const target = resolve(projectDir, relativePath);
  const root = resolve(projectDir);
  if (target !== root && !target.startsWith(`${root}/`)) {
    errors.push({
      code: "unsafe_project_path",
      message: `Project ${label} path must stay inside the project.`,
    });
    return;
  }

  try {
    const file = await stat(join(projectDir, relativePath));
    if (!file.isFile()) {
      errors.push({
        code: "missing_project_file",
        message: `Missing project ${label} file: ${relativePath}`,
      });
    }
  } catch {
    errors.push({
      code: "missing_project_file",
      message: `Missing project ${label} file: ${relativePath}`,
    });
  }
}
```

- [ ] **Step 4: Run tests and confirm pass**

Run:

```bash
npm --workspace @auto-demo/project test -- src/index.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/project/src/index.ts packages/project/src/index.test.ts
git commit -m "feat: load and save project manifests"
```

## Task 3: Import From WES-147 Capture Bundle

**Files:**

- Modify: `packages/project/package.json`
- Modify: `packages/project/src/index.test.ts`
- Modify: `packages/project/src/index.ts`

- [ ] **Step 1: Add workspace dependency**

Modify `packages/project/package.json`:

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
    "@auto-demo/capture": "file:../capture"
  }
}
```

- [ ] **Step 2: Install to refresh workspace lockfile**

Run:

```bash
npm install
```

Expected: PASS and `package-lock.json` records `@auto-demo/project` depending on
`@auto-demo/capture`.

- [ ] **Step 3: Add failing import test**

Append this test group to `packages/project/src/index.test.ts`:

```ts
import { writeCaptureManifest } from "@auto-demo/capture";
import { createProjectFromCaptureBundle } from "./index.js";

async function createCaptureBundle() {
  const captureDir = await mkdtemp(join(tmpdir(), "auto-demo-capture-"));
  await mkdir(join(captureDir, "media"), { recursive: true });
  await mkdir(join(captureDir, "metadata"), { recursive: true });
  await writeFile(join(captureDir, "media", "viewport.webm"), "video");
  await writeFile(join(captureDir, "metadata", "events.jsonl"), "{}\n");
  await writeCaptureManifest({
    outputDir: captureDir,
    status: "completed",
    source: { kind: "browser", url: "https://example.com/checkout?token=secret" },
    adapter: { kind: "browser", backend: "playwright" },
    tools: { capturePackage: "0.0.0", playwright: "1.61.1" },
    viewport: { width: 1280, height: 720 },
    timing: {
      startedAt: "2026-06-29T12:00:00.000Z",
      endedAt: "2026-06-29T12:00:02.500Z",
      durationMs: 2500,
    },
    artifacts: {
      media: join(captureDir, "media", "viewport.webm"),
      events: join(captureDir, "metadata", "events.jsonl"),
    },
    childCommand: null,
    error: null,
  });
  return captureDir;
}

describe("createProjectFromCaptureBundle", () => {
  it("imports a capture bundle into normalized project-owned paths", async () => {
    const captureDir = await createCaptureBundle();
    const projectDir = await mkdtemp(join(tmpdir(), "auto-demo-imported-project-"));

    const result = await createProjectFromCaptureBundle({
      captureBundlePath: captureDir,
      projectDir,
      name: "Imported checkout demo",
      now: () => new Date("2026-06-29T13:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.manifest).toMatchObject({
      schemaVersion: 1,
      name: "Imported checkout demo",
      createdAt: "2026-06-29T13:00:00.000Z",
      updatedAt: "2026-06-29T13:00:00.000Z",
      media: {
        primary: { path: "raw/capture.webm" },
      },
      metadata: {
        events: { path: "metadata/events.jsonl" },
      },
      variants: [],
      previews: [],
      exports: [],
    });
    expect(result.manifest.sourceCapture.manifestPath).toBe("metadata/capture.manifest.json");
    expect(result.manifest.sourceCapture.source.url).toBe("https://example.com/checkout");
    await expect(readFile(join(projectDir, "raw", "capture.webm"), "utf8")).resolves.toBe("video");
    await expect(readFile(join(projectDir, "metadata", "events.jsonl"), "utf8")).resolves.toBe(
      "{}\n",
    );
    await expect(
      readFile(join(projectDir, "metadata", "capture.manifest.json"), "utf8"),
    ).resolves.toContain('"schemaVersion": 1');
  });
});
```

- [ ] **Step 4: Run tests and confirm failure**

Run:

```bash
npm --workspace @auto-demo/project test -- src/index.test.ts
```

Expected: FAIL because `createProjectFromCaptureBundle()` is not implemented.

- [ ] **Step 5: Implement import behavior**

Add imports to `packages/project/src/index.ts`:

```ts
import { copyFile } from "node:fs/promises";
import { validateCaptureBundle } from "@auto-demo/capture";
```

Add these types and function:

```ts
export type CreateProjectFromCaptureBundleInput = {
  captureBundlePath: string;
  projectDir: string;
  name: string;
  now?: () => Date;
};

export async function createProjectFromCaptureBundle(
  input: CreateProjectFromCaptureBundleInput,
): Promise<ProjectValidationResult> {
  const capture = await validateCaptureBundle(input.captureBundlePath);
  const projectDir = resolve(input.projectDir);
  const manifestPath = join(projectDir, PROJECT_MANIFEST_FILENAME);

  if (!capture.ok) {
    return {
      ok: false,
      projectDir,
      manifestPath,
      errors: capture.errors.map((message) => ({
        code: "invalid_project_manifest",
        message,
      })),
    };
  }

  if (input.name.trim().length === 0) {
    return {
      ok: false,
      projectDir,
      manifestPath,
      errors: [
        {
          code: "invalid_project_manifest",
          message: "Auto Demo project manifest must include a non-empty name.",
        },
      ],
    };
  }

  await Promise.all([
    mkdir(join(projectDir, "raw"), { recursive: true }),
    mkdir(join(projectDir, "metadata"), { recursive: true }),
    mkdir(join(projectDir, "variants"), { recursive: true }),
    mkdir(join(projectDir, "previews"), { recursive: true }),
    mkdir(join(projectDir, "exports"), { recursive: true }),
  ]);

  const captureDir = dirname(capture.manifestPath);
  await copyFile(
    join(captureDir, capture.manifest.artifacts.media),
    join(projectDir, "raw", "capture.webm"),
  );
  await copyFile(
    join(captureDir, capture.manifest.artifacts.events),
    join(projectDir, "metadata", "events.jsonl"),
  );
  await copyFile(capture.manifestPath, join(projectDir, "metadata", "capture.manifest.json"));

  const clock = input.now === undefined ? () => new Date() : input.now;
  const timestamp = clock().toISOString();
  const manifest: ProjectManifest = {
    schemaVersion: SUPPORTED_PROJECT_SCHEMA_VERSION,
    name: input.name,
    createdAt: timestamp,
    updatedAt: timestamp,
    sourceCapture: {
      kind: "browser",
      status: capture.manifest.status,
      source: capture.manifest.source,
      viewport: capture.manifest.viewport,
      timing: {
        startedAt: capture.manifest.startedAt,
        endedAt: capture.manifest.endedAt,
        durationMs: capture.manifest.durationMs,
      },
      adapter: capture.manifest.adapter,
      tools: capture.manifest.tools,
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

  return await saveProject({ projectDir, manifestPath, manifest });
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm --workspace @auto-demo/project test -- src/index.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run package build/typecheck**

Run:

```bash
npm --workspace @auto-demo/project run typecheck
npm --workspace @auto-demo/project run build
```

Expected: both PASS.

- [ ] **Step 8: Commit**

```bash
git add package-lock.json packages/project/package.json packages/project/src/index.ts packages/project/src/index.test.ts
git commit -m "feat: import capture bundles into projects"
```

## Task 4: Validation Hardening And Documentation

**Files:**

- Modify: `packages/project/src/index.test.ts`
- Modify: `packages/project/src/index.ts`
- Modify: `README.md`
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Add behavior tests for secret-safe diagnostics and direct manifest paths**

Append this group to `packages/project/src/index.test.ts`:

```ts
describe("project validation diagnostics", () => {
  it("validates from a direct manifest path", async () => {
    const projectDir = await createFixtureProject();

    const result = await validateProject(join(projectDir, PROJECT_MANIFEST_FILENAME));

    expect(result.ok).toBe(true);
  });

  it("does not include URL query secrets in validation error messages", async () => {
    const projectDir = await createFixtureProject({
      ...validManifest,
      media: {
        primary: {
          kind: "viewport",
          path: "/tmp/capture.webm?token=secret",
          contentType: "video/webm",
        },
      },
    });

    const result = await validateProject(projectDir);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.message).join("\n")).not.toContain("secret");
      expect(result.errors.map((error) => error.message).join("\n")).not.toContain("token=");
    }
  });
});
```

- [ ] **Step 2: Run tests and confirm behavior**

Run:

```bash
npm --workspace @auto-demo/project test -- src/index.test.ts
```

Expected: PASS. If diagnostics include user-provided unsafe path strings, adjust messages to
use stable field names such as `Project media.primary.path must be a relative path inside the project.`

- [ ] **Step 3: Update README if source behavior changed**

If WES-134 implementation adds project import APIs but no CLI behavior, update only the package
description bullet:

```md
- `@auto-demo/project`: portable Auto Demo project schema, normalized capture import, path conventions, validation, and load/save APIs.
```

Leave the CLI section unchanged unless a separate issue adds project CLI commands.

- [ ] **Step 4: Update project map completion note**

Add a concise WES-134 completion note to `docs/linear/auto-demo-project-structure.md` after implementation:

```md
- WES-134 implementation: `@auto-demo/project` owns project schema version 1 in `autodemo.project.json`, imports WES-147 capture bundles into normalized `raw/` and `metadata/` project paths, exposes behavior-oriented create/load/save/validate APIs, and leaves variants/previews/exports as explicit empty manifest sections for later milestones.
```

Also update the current next-task pointer to WES-133 if WES-134 is complete and Linear confirms the Demo Project Format milestone is done.

- [ ] **Step 5: Run full validation**

Run:

```bash
npm run validate
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/linear/auto-demo-project-structure.md packages/project/src/index.ts packages/project/src/index.test.ts
git commit -m "docs: record project format implementation"
```

## Task 5: Completion Gate

**Files:**

- Read: `docs/linear/auto-demo-project-structure.md`
- Read: `docs/superpowers/specs/2026-06-29-wes-134-demo-project-format-design.md`
- Read: `docs/superpowers/plans/2026-06-29-wes-134-demo-project-format-plan.md`

- [ ] **Step 1: Run focused project tests**

Run:

```bash
npm --workspace @auto-demo/project test
```

Expected: PASS.

- [ ] **Step 2: Run full validation**

Run:

```bash
npm run validate
```

Expected: PASS.

- [ ] **Step 3: Run Linear sync completion gate**

Use `linear-sync-gate` in `completion-gate` mode for WES-134 with this evidence:

```text
Implemented @auto-demo/project schema version 1, createProjectFromCaptureBundle(), validateProject(), loadProject(), and saveProject(); normalized imported capture artifacts to raw/capture.webm, metadata/events.jsonl, and metadata/capture.manifest.json; variants/previews/exports are explicit empty manifest sections. Verification: npm --workspace @auto-demo/project test and npm run validate passed.
```

Expected: WES-134 can be commented with completion evidence and moved to Done. If the gate finds that WES-134 should be decomposed further, update the project map and ask before changing Linear issue structure.

- [ ] **Step 4: Commit sync updates**

```bash
git add docs/linear/auto-demo-project-structure.md
git commit -m "docs: mark WES-134 project format complete"
```

- [ ] **Step 5: Handoff to branch finishing**

Run the repository's standard no-mistakes flow and merge only after review, validation, and CI are green.
