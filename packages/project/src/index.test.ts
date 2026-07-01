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

  it("rejects non-empty forward-compatible sections in schema v1", () => {
    const result = validateProjectManifest({
      ...validManifest,
      exports: [{ id: "future-export" }],
    });

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
          durationMs: -1,
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
