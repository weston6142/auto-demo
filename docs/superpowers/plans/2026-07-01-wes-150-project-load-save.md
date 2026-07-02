# WES-150 Project Load/Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project-directory validation, loading, and saving APIs to `@auto-demo/project`.

**Architecture:** Keep schema validation in `validateProjectManifest()` and layer filesystem behavior around it. `validateProject()` resolves directory-or-manifest input, reads JSON, surfaces parse/schema errors, checks required referenced files, and returns a loaded project on success. `loadProject()` delegates to validation; `saveProject()` validates the manifest, writes formatted JSON atomically, then revalidates the saved project.

**Tech Stack:** TypeScript, Node.js `fs/promises`, Node.js `path`, npm workspaces, Vitest, existing `@auto-demo/project` and `@auto-demo/capture` APIs.

---

## File Structure

- Modify `packages/project/src/index.test.ts`: add filesystem fixture tests for `validateProject()`, `loadProject()`, and `saveProject()`.
- Modify `packages/project/src/index.ts`: add public types, filesystem path resolution, JSON reading, required file checks, `validateProject()`, `loadProject()`, and `saveProject()`.
- Modify `docs/linear/auto-demo-project-structure.md`: record WES-150 evidence and next task after verification.
- Create `docs/superpowers/specs/2026-07-01-wes-150-project-load-save-design.md`: design spec.
- Create `docs/superpowers/plans/2026-07-01-wes-150-project-load-save.md`: this plan.

## Task 1: Add failing project load/save behavior tests

**Files:**

- Modify: `packages/project/src/index.test.ts`

- [ ] **Step 1: Extend test imports**

At the top of `packages/project/src/index.test.ts`, add `rm` to the `node:fs/promises`
import and import the new public APIs:

```ts
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import {
  PROJECT_MANIFEST_FILENAME,
  SUPPORTED_PROJECT_SCHEMA_VERSION,
  createProjectFromCaptureBundle,
  loadProject,
  saveProject,
  validateProject,
  validateProjectManifest,
  type ProjectManifest,
} from "./index.js";
```

- [ ] **Step 2: Add filesystem API tests**

Append this test group before `describe("validateProjectManifest", ...)`:

```ts
describe("project filesystem APIs", () => {
  async function importValidProject(prefix: string): Promise<{
    rootDir: string;
    projectDir: string;
    manifestPath: string;
    manifest: ProjectManifest;
  }> {
    const rootDir = await makeTempDir(prefix);
    const captureDir = join(rootDir, "capture");
    const projectDir = join(rootDir, "project");
    await writeCaptureBundle(captureDir);

    const imported = await createProjectFromCaptureBundle({
      captureBundlePath: captureDir,
      projectDir,
      name: "Checkout flow demo",
      now: () => new Date("2026-07-01T10:00:00.000Z"),
    });

    if (!imported.ok) {
      throw new Error("Expected fixture import to succeed");
    }

    return {
      rootDir,
      projectDir,
      manifestPath: imported.project.manifestPath,
      manifest: imported.project.manifest,
    };
  }

  it("validates and loads an imported project from a directory or manifest path", async () => {
    const project = await importValidProject("auto-demo-project-validate-");

    await expect(validateProject(project.projectDir)).resolves.toEqual({
      ok: true,
      projectDir: project.projectDir,
      manifestPath: project.manifestPath,
      manifest: project.manifest,
    });

    await expect(validateProject(project.manifestPath)).resolves.toEqual({
      ok: true,
      projectDir: project.projectDir,
      manifestPath: project.manifestPath,
      manifest: project.manifest,
    });

    await expect(loadProject(project.projectDir)).resolves.toEqual({
      ok: true,
      projectDir: project.projectDir,
      manifestPath: project.manifestPath,
      manifest: project.manifest,
    });
  });

  it("returns a structured error when the project manifest is missing", async () => {
    const rootDir = await makeTempDir("auto-demo-project-missing-manifest-");
    const projectDir = join(rootDir, "project");
    await mkdir(projectDir, { recursive: true });

    await expect(validateProject(projectDir)).resolves.toEqual({
      ok: false,
      projectDir,
      manifestPath: join(projectDir, PROJECT_MANIFEST_FILENAME),
      errors: [
        {
          code: "missing_project_manifest",
          message: "Auto Demo project manifest is missing.",
        },
      ],
    });
  });

  it("returns a structured error when project JSON is invalid", async () => {
    const rootDir = await makeTempDir("auto-demo-project-invalid-json-");
    const projectDir = join(rootDir, "project");
    const manifestPath = join(projectDir, PROJECT_MANIFEST_FILENAME);
    await mkdir(projectDir, { recursive: true });
    await writeFile(manifestPath, "{not json");

    await expect(validateProject(manifestPath)).resolves.toEqual({
      ok: false,
      projectDir,
      manifestPath,
      errors: [
        {
          code: "invalid_project_json",
          message: "Auto Demo project manifest JSON is invalid.",
        },
      ],
    });
  });

  it("surfaces manifest validation errors without losing structured codes", async () => {
    const rootDir = await makeTempDir("auto-demo-project-schema-error-");
    const projectDir = join(rootDir, "project");
    const manifestPath = join(projectDir, PROJECT_MANIFEST_FILENAME);
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      manifestPath,
      `${JSON.stringify({ ...validManifest, schemaVersion: 99 }, null, 2)}\n`,
    );

    await expect(validateProject(projectDir)).resolves.toEqual({
      ok: false,
      projectDir,
      manifestPath,
      errors: [
        {
          code: "unsupported_project_version",
          message: "Unsupported Auto Demo project schema version.",
        },
      ],
    });
  });

  it.each([
    ["media.primary.path", "raw/capture.webm"],
    ["metadata.events.path", "metadata/events.jsonl"],
    ["sourceCapture.manifestPath", "metadata/capture.manifest.json"],
  ])("reports missing required project file for %s", async (field, relativePath) => {
    const project = await importValidProject("auto-demo-project-missing-file-");
    await rm(join(project.projectDir, relativePath));

    await expect(validateProject(project.projectDir)).resolves.toEqual({
      ok: false,
      projectDir: project.projectDir,
      manifestPath: project.manifestPath,
      errors: [
        {
          code: "missing_project_file",
          message: `Auto Demo project file referenced by ${field} is missing.`,
        },
      ],
    });
  });

  it("saves formatted project JSON, revalidates, and preserves referenced files", async () => {
    const project = await importValidProject("auto-demo-project-save-");
    const updatedManifest: ProjectManifest = {
      ...project.manifest,
      name: "Renamed checkout demo",
      updatedAt: "2026-07-01T11:00:00.000Z",
    };

    const result = await saveProject({
      projectDir: project.projectDir,
      manifestPath: project.manifestPath,
      manifest: updatedManifest,
    });

    expect(result).toEqual({
      ok: true,
      projectDir: project.projectDir,
      manifestPath: project.manifestPath,
      manifest: updatedManifest,
    });
    expect(await readFile(project.manifestPath, "utf8")).toBe(
      `${JSON.stringify(updatedManifest, null, 2)}\n`,
    );
    expect(await readFile(join(project.projectDir, "raw", "capture.webm"), "utf8")).toBe(
      "video-bytes",
    );
  });

  it("does not overwrite the project manifest when save input is invalid", async () => {
    const project = await importValidProject("auto-demo-project-invalid-save-");
    const before = await readFile(project.manifestPath, "utf8");
    const invalidManifest = {
      ...project.manifest,
      media: {
        primary: {
          kind: "viewport",
          path: "../capture.webm",
          contentType: "video/webm",
        },
      },
    } as unknown as ProjectManifest;

    await expect(
      saveProject({
        projectDir: project.projectDir,
        manifestPath: project.manifestPath,
        manifest: invalidManifest,
      }),
    ).resolves.toEqual({
      ok: false,
      projectDir: project.projectDir,
      manifestPath: project.manifestPath,
      errors: [
        {
          code: "unsafe_project_path",
          message: "Project media.primary.path must be a relative path inside the project.",
        },
      ],
    });

    expect(await readFile(project.manifestPath, "utf8")).toBe(before);
  });
});
```

- [ ] **Step 3: Run focused tests and confirm RED**

Run:

```bash
npm --workspace @auto-demo/project test -- src/index.test.ts
```

Expected: fail at compile/import time because `loadProject`, `saveProject`, and
`validateProject` are not exported yet.

## Task 2: Add public result types and filesystem API implementation

**Files:**

- Modify: `packages/project/src/index.ts`

- [ ] **Step 1: Extend imports**

Update the `node:fs/promises` and `node:path` imports:

```ts
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
```

- [ ] **Step 2: Extend validation error codes and result types**

Replace the existing `ProjectValidationErrorCode` and `ProjectValidationResult` definitions with:

```ts
export type ProjectValidationErrorCode =
  | "unsupported_project_version"
  | "invalid_project_manifest"
  | "unsafe_project_path"
  | "missing_project_manifest"
  | "invalid_project_json"
  | "missing_project_file";

export type ProjectValidationError = {
  code: ProjectValidationErrorCode;
  message: string;
};

export type ProjectManifestValidationResult =
  { ok: true; manifest: ProjectManifest } | { ok: false; errors: ProjectValidationError[] };

export type LoadedProject = {
  projectDir: string;
  manifestPath: string;
  manifest: ProjectManifest;
};

export type ProjectValidationResult =
  | ({ ok: true } & LoadedProject)
  | {
      ok: false;
      projectDir: string;
      manifestPath: string;
      errors: ProjectValidationError[];
    };

export type SaveProjectInput = LoadedProject;
```

- [ ] **Step 3: Add API functions after `createProjectFromCaptureBundle()`**

Add:

```ts
export async function validateProject(
  projectDirOrManifest: string,
): Promise<ProjectValidationResult> {
  const projectPaths = resolveProjectPaths(projectDirOrManifest);
  let rawManifest: string;

  try {
    rawManifest = await readFile(projectPaths.manifestPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return projectFailure(projectPaths, [
        {
          code: "missing_project_manifest",
          message: "Auto Demo project manifest is missing.",
        },
      ]);
    }
    throw error;
  }

  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(rawManifest);
  } catch {
    return projectFailure(projectPaths, [
      {
        code: "invalid_project_json",
        message: "Auto Demo project manifest JSON is invalid.",
      },
    ]);
  }

  const manifestValidation = validateProjectManifest(parsedManifest);
  if (!manifestValidation.ok) {
    return projectFailure(projectPaths, manifestValidation.errors);
  }

  const fileErrors = await validateReferencedProjectFiles(
    projectPaths.projectDir,
    manifestValidation.manifest,
  );
  if (fileErrors.length > 0) {
    return projectFailure(projectPaths, fileErrors);
  }

  return {
    ok: true,
    projectDir: projectPaths.projectDir,
    manifestPath: projectPaths.manifestPath,
    manifest: manifestValidation.manifest,
  };
}

export async function loadProject(projectDirOrManifest: string): Promise<ProjectValidationResult> {
  return validateProject(projectDirOrManifest);
}

export async function saveProject(project: SaveProjectInput): Promise<ProjectValidationResult> {
  const manifestValidation = validateProjectManifest(project.manifest);
  if (!manifestValidation.ok) {
    return projectFailure(project, manifestValidation.errors);
  }

  await writeJsonFileAtomically(project.manifestPath, manifestValidation.manifest);
  return validateProject(project.manifestPath);
}
```

- [ ] **Step 4: Add helper functions near other filesystem helpers**

Add:

```ts
function resolveProjectPaths(projectDirOrManifest: string): {
  projectDir: string;
  manifestPath: string;
} {
  if (basename(projectDirOrManifest) === PROJECT_MANIFEST_FILENAME) {
    return {
      projectDir: dirname(projectDirOrManifest),
      manifestPath: projectDirOrManifest,
    };
  }

  return {
    projectDir: projectDirOrManifest,
    manifestPath: join(projectDirOrManifest, PROJECT_MANIFEST_FILENAME),
  };
}

function projectFailure(
  project: { projectDir: string; manifestPath: string },
  errors: ProjectValidationError[],
): ProjectValidationResult {
  return {
    ok: false,
    projectDir: project.projectDir,
    manifestPath: project.manifestPath,
    errors,
  };
}

async function validateReferencedProjectFiles(
  projectDir: string,
  manifest: ProjectManifest,
): Promise<ProjectValidationError[]> {
  const references: Array<{ field: string; path: string }> = [
    { field: "media.primary.path", path: manifest.media.primary.path },
    { field: "metadata.events.path", path: manifest.metadata.events.path },
    { field: "sourceCapture.manifestPath", path: manifest.sourceCapture.manifestPath },
  ];
  const errors: ProjectValidationError[] = [];

  for (const reference of references) {
    if (!(await isExistingFile(join(projectDir, reference.path)))) {
      errors.push({
        code: "missing_project_file",
        message: `Auto Demo project file referenced by ${reference.field} is missing.`,
      });
    }
  }

  return errors;
}

async function isExistingFile(path: string): Promise<boolean> {
  try {
    const file = await stat(path);
    return file.isFile();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
```

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run:

```bash
npm --workspace @auto-demo/project test -- src/index.test.ts
```

Expected: all project package tests pass.

## Task 3: Format, validate, and update project map

**Files:**

- Modify: `packages/project/src/index.ts`
- Modify: `packages/project/src/index.test.ts`
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Format changed files**

Run:

```bash
npm run format -- packages/project/src/index.ts packages/project/src/index.test.ts docs/superpowers/specs/2026-07-01-wes-150-project-load-save-design.md docs/superpowers/plans/2026-07-01-wes-150-project-load-save.md docs/linear/auto-demo-project-structure.md
```

Expected: Prettier completes and may rewrite Markdown or TypeScript formatting.

- [ ] **Step 2: Run focused checks**

Run:

```bash
npm --workspace @auto-demo/project test -- src/index.test.ts
npm --workspace @auto-demo/project run typecheck
npm --workspace @auto-demo/project run build
```

Expected: all commands pass.

- [ ] **Step 3: Run full validation**

Run:

```bash
npm run validate
```

Expected: pass.

- [ ] **Step 4: Update project map**

In `docs/linear/auto-demo-project-structure.md`, add the WES-150 spec link under Local
Context, record WES-150 behavior and verification under Investigation Notes and Completion
Evidence, and update the next-task pointer to WES-151 if WES-134 completion criteria are
now satisfied.

- [ ] **Step 5: Review diff**

Run:

```bash
git diff --stat
git diff -- packages/project/src/index.ts packages/project/src/index.test.ts docs/linear/auto-demo-project-structure.md
```

Expected: only WES-150 API/tests/docs changes plus spec/plan files are present.
