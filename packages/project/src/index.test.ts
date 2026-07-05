import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PROJECT_MANIFEST_FILENAME,
  SUPPORTED_PROJECT_SCHEMA_VERSION,
  createProjectFromCaptureBundle,
  loadProject,
  savePolishVariant,
  saveProject,
  upsertSavedVariant,
  validateProject,
  validateProjectManifest,
  type ProjectManifest,
  type ProjectVariant,
} from "./index.js";

const validManifest: ProjectManifest = {
  schemaVersion: 1,
  name: "Checkout flow demo",
  createdAt: "2026-06-29T12:00:00.000Z",
  updatedAt: "2026-06-29T12:00:01.000Z",
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
};

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

describe("project manifest constants", () => {
  it("exports the schema v1 manifest filename and supported version", () => {
    expect(PROJECT_MANIFEST_FILENAME).toBe("autodemo.project.json");
    expect(SUPPORTED_PROJECT_SCHEMA_VERSION).toBe(1);
  });
});

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

  it("sanitizes secret-bearing source URLs without mutating the capture bundle", async () => {
    const rootDir = await makeTempDir("auto-demo-project-url-");
    const captureDir = join(rootDir, "capture");
    const projectDir = join(rootDir, "project");
    await writeCaptureBundle(captureDir, {
      url: "https://user:pass@example.com/checkout?token=secret#payment",
    });
    const originalCaptureManifest = await readFile(
      join(captureDir, "capture.manifest.json"),
      "utf8",
    );

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
});

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

  it("returns a structured missing manifest error when a project path parent is a file", async () => {
    const rootDir = await makeTempDir("auto-demo-project-file-parent-");
    const projectDir = join(rootDir, "project");
    await writeFile(projectDir, "not a directory");

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

  it("reports a missing required project file when a parent path is a file", async () => {
    const project = await importValidProject("auto-demo-project-missing-file-parent-");
    await rm(join(project.projectDir, "metadata"), { recursive: true });
    await writeFile(join(project.projectDir, "metadata"), "not a directory");

    await expect(validateProject(project.projectDir)).resolves.toEqual({
      ok: false,
      projectDir: project.projectDir,
      manifestPath: project.manifestPath,
      errors: [
        {
          code: "missing_project_file",
          message: "Auto Demo project file referenced by metadata.events.path is missing.",
        },
        {
          code: "missing_project_file",
          message: "Auto Demo project file referenced by sourceCapture.manifestPath is missing.",
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

  it("reports missing variant files when saveProject writes a manifest with variants directly", async () => {
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
      ok: false,
      projectDir: project.projectDir,
      manifestPath: project.manifestPath,
      errors: [
        {
          code: "missing_project_file",
          message: "Auto Demo project file referenced by variants.checkout-focused is missing.",
        },
      ],
    });
    expect(await readFile(project.manifestPath, "utf8")).toBe(
      `${JSON.stringify(manifestWithVariant, null, 2)}\n`,
    );
  });

  it("saves a polish variant file, updates the manifest, reloads, and preserves capture artifacts", async () => {
    const project = await importValidProject("auto-demo-project-polish-save-");
    const beforeMedia = await readFile(join(project.projectDir, "raw", "capture.webm"), "utf8");
    const beforeEvents = await readFile(
      join(project.projectDir, "metadata", "events.jsonl"),
      "utf8",
    );

    const saved = await savePolishVariant(
      {
        projectDir: project.projectDir,
        manifestPath: project.manifestPath,
        manifest: project.manifest,
      },
      validVariant,
      { now: new Date("2026-07-03T12:00:00.000Z") },
    );
    const expectedManifest: ProjectManifest = {
      ...project.manifest,
      variants: [validVariant],
      updatedAt: "2026-07-03T12:00:00.000Z",
    };

    expect(saved).toEqual({
      ok: true,
      projectDir: project.projectDir,
      manifestPath: project.manifestPath,
      manifest: expectedManifest,
    });
    await expect(loadProject(project.projectDir)).resolves.toEqual(saved);
    expect(
      await readFile(join(project.projectDir, "variants", "checkout-focused.json"), "utf8"),
    ).toBe(`${JSON.stringify(validVariant, null, 2)}\n`);
    expect(await readFile(join(project.projectDir, "raw", "capture.webm"), "utf8")).toBe(
      beforeMedia,
    );
    expect(await readFile(join(project.projectDir, "metadata", "events.jsonl"), "utf8")).toBe(
      beforeEvents,
    );
  });

  it("rejects duplicate polish variant ids without overwriting existing files", async () => {
    const project = await importValidProject("auto-demo-project-polish-duplicate-");
    const firstSave = await savePolishVariant(
      {
        projectDir: project.projectDir,
        manifestPath: project.manifestPath,
        manifest: project.manifest,
      },
      validVariant,
      { now: new Date("2026-07-03T12:00:00.000Z") },
    );
    if (!firstSave.ok) {
      throw new Error("Expected first variant save to succeed");
    }
    const variantPath = join(project.projectDir, "variants", "checkout-focused.json");
    const beforeVariantFile = await readFile(variantPath, "utf8");
    const beforeManifestFile = await readFile(project.manifestPath, "utf8");

    await expect(
      savePolishVariant(firstSave, { ...validVariant, displayName: "Duplicate" }),
    ).resolves.toEqual({
      ok: false,
      projectDir: project.projectDir,
      manifestPath: project.manifestPath,
      errors: [
        {
          code: "invalid_project_manifest",
          message: "Auto Demo project variant ids must be unique lowercase slugs.",
        },
      ],
    });

    expect(await readFile(variantPath, "utf8")).toBe(beforeVariantFile);
    expect(await readFile(project.manifestPath, "utf8")).toBe(beforeManifestFile);
  });

  it("rejects invalid polish variant data before writing a variant file", async () => {
    const project = await importValidProject("auto-demo-project-polish-invalid-");
    const unsafeVariant: ProjectVariant = {
      ...validVariant,
      id: "unsafe-source",
      source: {
        mediaPath: "../capture.webm",
        eventsPath: "metadata/events.jsonl",
      },
    };

    await expect(
      savePolishVariant(
        {
          projectDir: project.projectDir,
          manifestPath: project.manifestPath,
          manifest: project.manifest,
        },
        unsafeVariant,
      ),
    ).resolves.toEqual({
      ok: false,
      projectDir: project.projectDir,
      manifestPath: project.manifestPath,
      errors: [
        {
          code: "unsafe_project_path",
          message: "Project variant source paths must be relative paths inside the project.",
        },
      ],
    });
    await expect(
      stat(join(project.projectDir, "variants", "unsafe-source.json")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("replaces an existing saved variant and preserves unrelated variants", async () => {
    const project = await importValidProject("auto-demo-project-upsert-update-");
    const first = await savePolishVariant(project, validVariant, {
      now: new Date("2026-07-03T12:00:00.000Z"),
    });
    if (!first.ok) {
      throw new Error("Expected first variant save to succeed");
    }
    const otherVariant: ProjectVariant = {
      ...validVariant,
      id: "checkout-wide",
      displayName: "Checkout Wide",
      viewport: { ...validVariant.viewport, zoom: 1 },
    };
    const withOther = await savePolishVariant(first, otherVariant, {
      now: new Date("2026-07-03T12:05:00.000Z"),
    });
    if (!withOther.ok) {
      throw new Error("Expected second variant save to succeed");
    }
    const replacement: ProjectVariant = {
      ...validVariant,
      displayName: "Checkout Tight",
      timeline: { startMs: 200, endMs: 2300 },
    };

    const saved = await upsertSavedVariant(
      withOther,
      { mode: "update", variant: replacement },
      { now: new Date("2026-07-05T15:00:00.000Z") },
    );

    expect(saved).toEqual({
      ok: true,
      projectDir: project.projectDir,
      manifestPath: project.manifestPath,
      manifest: {
        ...withOther.manifest,
        variants: [replacement, otherVariant],
        updatedAt: "2026-07-05T15:00:00.000Z",
      },
    });
    await expect(loadProject(project.projectDir)).resolves.toEqual(saved);
    expect(
      JSON.parse(
        await readFile(join(project.projectDir, "variants", "checkout-focused.json"), "utf8"),
      ),
    ).toEqual(replacement);
    expect(
      JSON.parse(
        await readFile(join(project.projectDir, "variants", "checkout-wide.json"), "utf8"),
      ),
    ).toEqual(otherVariant);
  });

  it("leaves the previous saved variant reloadable when an update cannot save the manifest", async () => {
    const project = await importValidProject("auto-demo-project-upsert-update-failure-");
    const first = await savePolishVariant(project, validVariant, {
      now: new Date("2026-07-03T12:00:00.000Z"),
    });
    if (!first.ok) {
      throw new Error("Expected first variant save to succeed");
    }
    const variantPath = join(project.projectDir, "variants", "checkout-focused.json");
    const beforeVariant = await readFile(variantPath, "utf8");
    const beforeManifest = await readFile(project.manifestPath, "utf8");
    const replacement: ProjectVariant = {
      ...validVariant,
      displayName: "Checkout Tight",
      timeline: { startMs: 200, endMs: 2300 },
    };

    await mkdir(`${project.manifestPath}.tmp`);
    await expect(
      upsertSavedVariant(
        first,
        { mode: "update", variant: replacement },
        { now: new Date("2026-07-05T15:00:00.000Z") },
      ),
    ).rejects.toMatchObject({ code: "EISDIR" });
    await rm(`${project.manifestPath}.tmp`, { recursive: true });

    expect(await readFile(project.manifestPath, "utf8")).toBe(beforeManifest);
    expect(await readFile(variantPath, "utf8")).toBe(beforeVariant);
    await expect(loadProject(project.projectDir)).resolves.toEqual(first);
  });

  it("saves a named copy without changing the source variant", async () => {
    const project = await importValidProject("auto-demo-project-upsert-copy-");
    const first = await savePolishVariant(project, validVariant, {
      now: new Date("2026-07-03T12:00:00.000Z"),
    });
    if (!first.ok) {
      throw new Error("Expected first variant save to succeed");
    }

    const saved = await upsertSavedVariant(
      first,
      {
        mode: "copy",
        variant: validVariant,
        copyId: "checkout-copy",
        displayName: "Checkout Copy",
      },
      { now: new Date("2026-07-05T15:05:00.000Z") },
    );

    const expectedCopy: ProjectVariant = {
      ...validVariant,
      id: "checkout-copy",
      displayName: "Checkout Copy",
    };
    expect(saved).toEqual({
      ok: true,
      projectDir: project.projectDir,
      manifestPath: project.manifestPath,
      manifest: {
        ...first.manifest,
        variants: [validVariant, expectedCopy],
        updatedAt: "2026-07-05T15:05:00.000Z",
      },
    });
    expect(
      JSON.parse(
        await readFile(join(project.projectDir, "variants", "checkout-focused.json"), "utf8"),
      ),
    ).toEqual(validVariant);
    expect(
      JSON.parse(
        await readFile(join(project.projectDir, "variants", "checkout-copy.json"), "utf8"),
      ),
    ).toEqual(expectedCopy);
    await expect(loadProject(project.projectDir)).resolves.toEqual(saved);
  });

  it("rejects missing update targets without changing saved files", async () => {
    const project = await importValidProject("auto-demo-project-upsert-missing-update-");
    const beforeManifest = await readFile(project.manifestPath, "utf8");

    await expect(
      upsertSavedVariant(project, { mode: "update", variant: validVariant }),
    ).resolves.toEqual({
      ok: false,
      projectDir: project.projectDir,
      manifestPath: project.manifestPath,
      errors: [
        {
          code: "invalid_project_manifest",
          message: "Saved Auto Demo project variant cannot update a missing variant.",
        },
      ],
    });
    expect(await readFile(project.manifestPath, "utf8")).toBe(beforeManifest);
  });

  it("rejects duplicate copy ids without changing saved files", async () => {
    const project = await importValidProject("auto-demo-project-upsert-duplicate-copy-");
    const first = await savePolishVariant(project, validVariant, {
      now: new Date("2026-07-03T12:00:00.000Z"),
    });
    if (!first.ok) {
      throw new Error("Expected first variant save to succeed");
    }
    const beforeManifest = await readFile(project.manifestPath, "utf8");
    const beforeVariant = await readFile(
      join(project.projectDir, "variants", "checkout-focused.json"),
      "utf8",
    );

    await expect(
      upsertSavedVariant(first, {
        mode: "copy",
        variant: validVariant,
        copyId: "checkout-focused",
        displayName: "Duplicate",
      }),
    ).resolves.toEqual({
      ok: false,
      projectDir: project.projectDir,
      manifestPath: project.manifestPath,
      errors: [
        {
          code: "invalid_project_manifest",
          message: "Saved Auto Demo project variant copy id already exists.",
        },
      ],
    });
    expect(await readFile(project.manifestPath, "utf8")).toBe(beforeManifest);
    expect(
      await readFile(join(project.projectDir, "variants", "checkout-focused.json"), "utf8"),
    ).toBe(beforeVariant);
  });

  it("reports a missing saved polish variant file during project validation", async () => {
    const project = await importValidProject("auto-demo-project-polish-missing-file-");
    const saved = await savePolishVariant(
      {
        projectDir: project.projectDir,
        manifestPath: project.manifestPath,
        manifest: project.manifest,
      },
      validVariant,
    );
    if (!saved.ok) {
      throw new Error("Expected variant save to succeed");
    }
    await rm(join(project.projectDir, "variants", "checkout-focused.json"));

    await expect(validateProject(project.projectDir)).resolves.toEqual({
      ok: false,
      projectDir: project.projectDir,
      manifestPath: project.manifestPath,
      errors: [
        {
          code: "missing_project_file",
          message: "Auto Demo project file referenced by variants.checkout-focused is missing.",
        },
      ],
    });
  });

  it("reports invalid saved polish variant JSON during project validation", async () => {
    const project = await importValidProject("auto-demo-project-polish-invalid-json-");
    const saved = await savePolishVariant(
      {
        projectDir: project.projectDir,
        manifestPath: project.manifestPath,
        manifest: project.manifest,
      },
      validVariant,
    );
    if (!saved.ok) {
      throw new Error("Expected variant save to succeed");
    }
    await writeFile(join(project.projectDir, "variants", "checkout-focused.json"), "{not-json");

    await expect(validateProject(project.projectDir)).resolves.toEqual({
      ok: false,
      projectDir: project.projectDir,
      manifestPath: project.manifestPath,
      errors: [
        {
          code: "invalid_project_manifest",
          message: "Saved Auto Demo project variant file is invalid.",
        },
      ],
    });
  });

  it("reports mismatched saved polish variant JSON during project validation", async () => {
    const project = await importValidProject("auto-demo-project-polish-mismatch-");
    const saved = await savePolishVariant(
      {
        projectDir: project.projectDir,
        manifestPath: project.manifestPath,
        manifest: project.manifest,
      },
      validVariant,
    );
    if (!saved.ok) {
      throw new Error("Expected variant save to succeed");
    }
    await writeFile(
      join(project.projectDir, "variants", "checkout-focused.json"),
      `${JSON.stringify({ ...validVariant, displayName: "Changed Outside Manifest" }, null, 2)}\n`,
    );

    await expect(validateProject(project.projectDir)).resolves.toEqual({
      ok: false,
      projectDir: project.projectDir,
      manifestPath: project.manifestPath,
      errors: [
        {
          code: "invalid_project_manifest",
          message: "Saved Auto Demo project variant file does not match the project manifest.",
        },
      ],
    });
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

describe("validateProjectManifest", () => {
  it("accepts the supported portable project manifest shape", () => {
    const result = validateProjectManifest(validManifest);

    expect(result).toEqual({ ok: true, manifest: validManifest });
  });

  it("accepts a manifest with a valid MVP polish variant", () => {
    const manifest: ProjectManifest = {
      ...validManifest,
      variants: [validVariant],
    };

    expect(validateProjectManifest(manifest)).toEqual({ ok: true, manifest });
  });

  it("rejects unsupported schema versions with a structured error", () => {
    const result = validateProjectManifest({ ...validManifest, schemaVersion: 99 });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "unsupported_project_version",
          message: "Unsupported Auto Demo project schema version.",
        },
      ],
    });
  });

  it("rejects missing explicit forward-compatible sections", () => {
    const withoutVariants: Record<string, unknown> = { ...validManifest };
    delete withoutVariants.variants;

    const result = validateProjectManifest(withoutVariants);

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "invalid_project_manifest",
          message:
            "Auto Demo project manifest must include empty variants, previews, and exports arrays.",
        },
      ],
    });
  });

  it("rejects non-empty preview and export sections in schema v1", () => {
    const result = validateProjectManifest({
      ...validManifest,
      exports: [{ id: "future-export" }],
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "invalid_project_manifest",
          message: "Auto Demo project manifest must include empty previews and exports arrays.",
        },
      ],
    });
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
            {
              id: "after",
              text: "After",
              startMs: 2400,
              endMs: 2600,
              anchor: { x: 0.5, y: 0.5 },
            },
          ],
        },
      ],
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "invalid_project_manifest",
          message:
            "Auto Demo project variant timeline must fit inside the source capture duration.",
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

  it.each([
    "../capture.webm",
    "/tmp/capture.webm",
    "C:/capture.webm",
    "raw\\capture.webm",
    "raw/capture.webm:token=secret",
    "",
  ])("rejects unsafe media artifact path %s", (path) => {
    const result = validateProjectManifest({
      ...validManifest,
      media: {
        primary: {
          kind: "viewport",
          path,
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

  it("rejects unsafe metadata artifact paths", () => {
    const result = validateProjectManifest({
      ...validManifest,
      metadata: {
        events: {
          path: "../events.jsonl",
          contentType: "application/x-ndjson",
        },
      },
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "unsafe_project_path",
          message: "Project metadata.events.path must be a relative path inside the project.",
        },
      ],
    });
  });

  it("rejects unknown top-level fields without echoing their names", () => {
    const result = validateProjectManifest({
      ...validManifest,
      token: "secret",
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "invalid_project_manifest",
          message: "Auto Demo project manifest contains unknown fields.",
        },
      ],
    });
  });

  it("rejects unknown nested fields without echoing their names", () => {
    const result = validateProjectManifest({
      ...validManifest,
      sourceCapture: {
        ...validManifest.sourceCapture,
        source: {
          ...validManifest.sourceCapture.source,
          token: "secret",
        },
      },
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "invalid_project_manifest",
          message: "Auto Demo project manifest contains unknown fields.",
        },
      ],
    });
  });

  it.each([
    "https://example.com/checkout?token=secret",
    "https://example.com/checkout#step",
    "https://user:pass@example.com/checkout",
    "data:text/html,secret",
    "file:///tmp/demo.html",
  ])("rejects source URL %s", (url) => {
    const result = validateProjectManifest({
      ...validManifest,
      sourceCapture: {
        ...validManifest.sourceCapture,
        source: { kind: "browser", url },
      },
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "invalid_project_manifest",
          message: "Auto Demo project manifest sourceCapture is invalid.",
        },
      ],
    });
  });

  it("rejects invalid timestamps and numeric fields", () => {
    const result = validateProjectManifest({
      ...validManifest,
      createdAt: "not-a-date",
      sourceCapture: {
        ...validManifest.sourceCapture,
        viewport: { width: 0, height: 720 },
        timing: {
          startedAt: "not-a-date",
          endedAt: "2026-06-29T12:00:02.500Z",
          durationMs: 2500,
        },
      },
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "invalid_project_manifest",
          message: "Auto Demo project manifest timestamps are invalid.",
        },
        {
          code: "invalid_project_manifest",
          message: "Auto Demo project manifest sourceCapture viewport is invalid.",
        },
        {
          code: "invalid_project_manifest",
          message: "Auto Demo project manifest sourceCapture timing is invalid.",
        },
      ],
    });
  });

  it.each([-1, 0])("rejects source capture duration %s", (durationMs) => {
    const result = validateProjectManifest({
      ...validManifest,
      sourceCapture: {
        ...validManifest.sourceCapture,
        timing: {
          ...validManifest.sourceCapture.timing,
          durationMs,
        },
      },
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "invalid_project_manifest",
          message: "Auto Demo project manifest sourceCapture timing is invalid.",
        },
      ],
    });
  });

  it("rejects fractional duration values", () => {
    const result = validateProjectManifest({
      ...validManifest,
      sourceCapture: {
        ...validManifest.sourceCapture,
        timing: {
          ...validManifest.sourceCapture.timing,
          durationMs: 0.5,
        },
      },
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "invalid_project_manifest",
          message: "Auto Demo project manifest sourceCapture timing is invalid.",
        },
      ],
    });
  });

  it("rejects timestamp strings that are not UTC ISO-8601 date-times", () => {
    const result = validateProjectManifest({
      ...validManifest,
      createdAt: "1",
      sourceCapture: {
        ...validManifest.sourceCapture,
        timing: {
          ...validManifest.sourceCapture.timing,
          endedAt: "2026-06-29 12:00:02",
        },
      },
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "invalid_project_manifest",
          message: "Auto Demo project manifest timestamps are invalid.",
        },
        {
          code: "invalid_project_manifest",
          message: "Auto Demo project manifest sourceCapture timing is invalid.",
        },
      ],
    });
  });

  it("rejects wrong literal values and content types", () => {
    const result = validateProjectManifest({
      ...validManifest,
      sourceCapture: {
        ...validManifest.sourceCapture,
        adapter: { kind: "browser", backend: "other" },
      },
      media: {
        primary: {
          kind: "viewport",
          path: "raw/capture.webm",
          contentType: "video/mp4",
        },
      },
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "invalid_project_manifest",
          message: "Auto Demo project manifest sourceCapture adapter is invalid.",
        },
        {
          code: "invalid_project_manifest",
          message: "Auto Demo project manifest media.primary is invalid.",
        },
      ],
    });
  });

  it("returns multiple independent errors in one result", () => {
    const result = validateProjectManifest({
      ...validManifest,
      name: "",
      updatedAt: "not-a-date",
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
          code: "invalid_project_manifest",
          message: "Auto Demo project manifest must include a non-empty name.",
        },
        {
          code: "invalid_project_manifest",
          message: "Auto Demo project manifest timestamps are invalid.",
        },
        {
          code: "unsafe_project_path",
          message: "Project media.primary.path must be a relative path inside the project.",
        },
      ],
    });
  });
});
