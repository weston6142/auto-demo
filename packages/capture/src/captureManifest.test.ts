import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateCaptureBundle, writeCaptureManifest } from "./captureManifest.js";

async function createBundleArtifacts(prefix: string): Promise<string> {
  const outputDir = join(tmpdir(), prefix);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(join(outputDir, "media"), { recursive: true });
  await mkdir(join(outputDir, "metadata"), { recursive: true });
  await writeFile(join(outputDir, "media", "viewport.webm"), "video");
  await writeFile(join(outputDir, "metadata", "events.jsonl"), "{}\n");
  return outputDir;
}

describe("capture manifest", () => {
  it("writes a readable portable manifest and validates the referenced artifacts", async () => {
    const outputDir = await createBundleArtifacts("auto-demo-manifest-valid");

    const manifest = await writeCaptureManifest({
      outputDir,
      status: "completed",
      source: { kind: "browser", url: "https://example.com/demo" },
      adapter: { kind: "browser", backend: "playwright" },
      tools: { capturePackage: "0.0.0", playwright: "1.61.1" },
      viewport: { width: 1280, height: 720 },
      timing: {
        startedAt: "2026-06-29T12:00:00.000Z",
        endedAt: "2026-06-29T12:00:02.500Z",
        durationMs: 2500,
      },
      artifacts: {
        media: join(outputDir, "media", "viewport.webm"),
        events: join(outputDir, "metadata", "events.jsonl"),
      },
      childCommand: { command: "npm", args: ["test"], exitCode: 0 },
      error: null,
    });

    expect(manifest).toEqual({
      schemaVersion: 1,
      status: "completed",
      source: { kind: "browser", url: "https://example.com/demo" },
      adapter: { kind: "browser", backend: "playwright" },
      tools: { capturePackage: "0.0.0", playwright: "1.61.1" },
      viewport: { width: 1280, height: 720 },
      startedAt: "2026-06-29T12:00:00.000Z",
      endedAt: "2026-06-29T12:00:02.500Z",
      durationMs: 2500,
      artifacts: {
        media: "media/viewport.webm",
        events: "metadata/events.jsonl",
      },
      childCommand: { command: "npm", argCount: 1, argsRedacted: true, exitCode: 0 },
      error: null,
    });

    const written = JSON.parse(await readFile(join(outputDir, "capture.manifest.json"), "utf8"));
    expect(written).toEqual(manifest);

    const validation = await validateCaptureBundle(outputDir);
    expect(validation).toEqual({
      ok: true,
      manifestPath: join(outputDir, "capture.manifest.json"),
      manifest,
    });
  });

  it("writes bundle-relative artifact paths when outputDir is relative", async () => {
    const outputDir = "auto-demo-manifest-relative";
    await rm(outputDir, { recursive: true, force: true });
    await mkdir(join(outputDir, "media"), { recursive: true });
    await mkdir(join(outputDir, "metadata"), { recursive: true });
    await writeFile(join(outputDir, "media", "viewport.webm"), "video");
    await writeFile(join(outputDir, "metadata", "events.jsonl"), "{}\n");

    const manifest = await writeCaptureManifest({
      outputDir,
      status: "completed",
      source: { kind: "browser", url: "https://example.com/demo" },
      adapter: { kind: "browser", backend: "playwright" },
      tools: { capturePackage: "0.0.0", playwright: "1.61.1" },
      viewport: { width: 1280, height: 720 },
      timing: {
        startedAt: "2026-06-29T12:00:00.000Z",
        endedAt: "2026-06-29T12:00:02.500Z",
        durationMs: 2500,
      },
      artifacts: {
        media: join(outputDir, "media", "viewport.webm"),
        events: join(outputDir, "metadata", "events.jsonl"),
      },
      childCommand: null,
      error: null,
    });

    expect(manifest.artifacts).toEqual({
      media: "media/viewport.webm",
      events: "metadata/events.jsonl",
    });

    const validation = await validateCaptureBundle(outputDir);
    expect(validation.ok).toBe(true);

    await rm(outputDir, { recursive: true, force: true });
  });

  it("returns readable validation errors for malformed manifests and missing artifacts", async () => {
    const malformedDir = await createBundleArtifacts("auto-demo-manifest-malformed");
    await writeFile(join(malformedDir, "capture.manifest.json"), "{bad json");

    const malformed = await validateCaptureBundle(malformedDir);

    expect(malformed.ok).toBe(false);
    if (malformed.ok) {
      return;
    }
    expect(malformed.errors.join("\n")).toContain("Manifest JSON is not parseable.");

    const missingArtifactDir = await createBundleArtifacts("auto-demo-manifest-missing");
    await writeCaptureManifest({
      outputDir: missingArtifactDir,
      status: "completed",
      source: { kind: "browser", url: "https://example.com/demo" },
      adapter: { kind: "browser", backend: "playwright" },
      tools: { capturePackage: "0.0.0", playwright: "1.61.1" },
      viewport: { width: 1280, height: 720 },
      timing: {
        startedAt: "2026-06-29T12:00:00.000Z",
        endedAt: "2026-06-29T12:00:02.500Z",
        durationMs: 2500,
      },
      artifacts: {
        media: join(missingArtifactDir, "media", "viewport.webm"),
        events: join(missingArtifactDir, "metadata", "events.jsonl"),
      },
      childCommand: null,
      error: null,
    });
    await rm(join(missingArtifactDir, "metadata", "events.jsonl"));

    const missingArtifact = await validateCaptureBundle(
      join(missingArtifactDir, "capture.manifest.json"),
    );

    expect(missingArtifact.ok).toBe(false);
    if (missingArtifact.ok) {
      return;
    }
    expect(missingArtifact.errors).toContain("Missing events artifact: metadata/events.jsonl");
  });

  it("rejects artifact paths that leave the capture bundle after normalization", async () => {
    const outputDir = await createBundleArtifacts("auto-demo-manifest-traversal");
    await writeFile(
      join(outputDir, "capture.manifest.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        status: "completed",
        source: { kind: "browser", url: "https://example.com/demo" },
        adapter: { kind: "browser", backend: "playwright" },
        tools: { capturePackage: "0.0.0", playwright: "1.61.1" },
        viewport: { width: 1280, height: 720 },
        startedAt: "2026-06-29T12:00:00.000Z",
        endedAt: "2026-06-29T12:00:02.500Z",
        durationMs: 2500,
        artifacts: {
          media: "media/../../outside.webm",
          events: "metadata/events.jsonl",
        },
        childCommand: null,
        error: null,
      })}\n`,
    );

    const validation = await validateCaptureBundle(outputDir);

    expect(validation.ok).toBe(false);
    if (validation.ok) {
      return;
    }
    expect(validation.errors).toContain(
      "Manifest artifacts must include relative media and events paths.",
    );
  });

  it("rejects artifact paths that point at directories", async () => {
    const outputDir = await createBundleArtifacts("auto-demo-manifest-directory-artifacts");
    await writeFile(
      join(outputDir, "capture.manifest.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        status: "completed",
        source: { kind: "browser", url: "https://example.com/demo" },
        adapter: { kind: "browser", backend: "playwright" },
        tools: { capturePackage: "0.0.0", playwright: "1.61.1" },
        viewport: { width: 1280, height: 720 },
        startedAt: "2026-06-29T12:00:00.000Z",
        endedAt: "2026-06-29T12:00:02.500Z",
        durationMs: 2500,
        artifacts: {
          media: "media",
          events: "metadata",
        },
        childCommand: null,
        error: null,
      })}\n`,
    );

    const validation = await validateCaptureBundle(outputDir);

    expect(validation.ok).toBe(false);
    if (validation.ok) {
      return;
    }
    expect(validation.errors).toEqual([
      "Invalid media artifact: media must reference a file.",
      "Invalid events artifact: metadata must reference a file.",
    ]);
  });

  it("rejects incomplete nested child command and error details", async () => {
    const outputDir = await createBundleArtifacts("auto-demo-manifest-nested-shape");
    await writeFile(
      join(outputDir, "capture.manifest.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        status: "failed",
        source: { kind: "browser", url: "https://example.com/demo" },
        adapter: { kind: "browser", backend: "playwright" },
        tools: { capturePackage: "0.0.0", playwright: "1.61.1" },
        viewport: { width: 1280, height: 720 },
        startedAt: "2026-06-29T12:00:00.000Z",
        endedAt: "2026-06-29T12:00:02.500Z",
        durationMs: 2500,
        artifacts: {
          media: "media/viewport.webm",
          events: "metadata/events.jsonl",
        },
        childCommand: {},
        error: {},
      })}\n`,
    );

    const validation = await validateCaptureBundle(outputDir);

    expect(validation.ok).toBe(false);
    if (validation.ok) {
      return;
    }
    expect(validation.errors).toContain(
      "Manifest childCommand must include argCount and exitCode when present.",
    );
    expect(validation.errors).toContain(
      "Manifest error must include code and message when present.",
    );
  });

  it("rejects manifests with omitted nullable fields", async () => {
    const outputDir = await createBundleArtifacts("auto-demo-manifest-missing-nullables");
    await writeFile(
      join(outputDir, "capture.manifest.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        status: "completed",
        source: { kind: "browser", url: "https://example.com/demo" },
        adapter: { kind: "browser", backend: "playwright" },
        tools: { capturePackage: "0.0.0", playwright: "1.61.1" },
        viewport: { width: 1280, height: 720 },
        startedAt: "2026-06-29T12:00:00.000Z",
        endedAt: "2026-06-29T12:00:02.500Z",
        durationMs: 2500,
        artifacts: {
          media: "media/viewport.webm",
          events: "metadata/events.jsonl",
        },
      })}\n`,
    );

    const validation = await validateCaptureBundle(outputDir);

    expect(validation.ok).toBe(false);
    if (validation.ok) {
      return;
    }
    expect(validation.errors).toContain(
      "Manifest childCommand must be explicit null or an object.",
    );
    expect(validation.errors).toContain("Manifest error must be explicit null or an object.");
  });

  it("rejects adapter backends other than playwright", async () => {
    const outputDir = await createBundleArtifacts("auto-demo-manifest-adapter-backend");
    await writeFile(
      join(outputDir, "capture.manifest.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        status: "completed",
        source: { kind: "browser", url: "https://example.com/demo" },
        adapter: { kind: "browser", backend: "other" },
        tools: { capturePackage: "0.0.0", playwright: "1.61.1" },
        viewport: { width: 1280, height: 720 },
        startedAt: "2026-06-29T12:00:00.000Z",
        endedAt: "2026-06-29T12:00:02.500Z",
        durationMs: 2500,
        artifacts: {
          media: "media/viewport.webm",
          events: "metadata/events.jsonl",
        },
        childCommand: null,
        error: null,
      })}\n`,
    );

    const validation = await validateCaptureBundle(outputDir);

    expect(validation.ok).toBe(false);
    if (validation.ok) {
      return;
    }
    expect(validation.errors).toContain("Manifest adapter must be browser playwright.");
  });

  it("sanitizes diagnostic messages before writing manifests", async () => {
    const outputDir = await createBundleArtifacts("auto-demo-manifest-error-redaction");

    const manifest = await writeCaptureManifest({
      outputDir,
      status: "failed",
      source: { kind: "browser", url: "https://example.com/demo?token=secret#hash" },
      adapter: { kind: "browser", backend: "playwright" },
      tools: { capturePackage: "0.0.0", playwright: "1.61.1" },
      viewport: { width: 1280, height: 720 },
      timing: {
        startedAt: "2026-06-29T12:00:00.000Z",
        endedAt: "2026-06-29T12:00:02.500Z",
        durationMs: 2500,
      },
      artifacts: {
        media: join(outputDir, "media", "viewport.webm"),
        events: join(outputDir, "metadata", "events.jsonl"),
      },
      childCommand: null,
      error: {
        code: "capture_setup_failed",
        message: "Failed to open https://example.com/demo?token=secret#hash",
      },
    });

    expect(manifest.source.url).toBe("https://example.com/demo");
    expect(manifest.error).toEqual({
      code: "capture_setup_failed",
      message: "Failed to open https://example.com/demo",
    });
    expect(JSON.stringify(manifest)).not.toContain("token=secret");
  });
});
