import { describe, expect, it } from "vitest";
import {
  PROJECT_MANIFEST_FILENAME,
  SUPPORTED_PROJECT_SCHEMA_VERSION,
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

describe("project manifest constants", () => {
  it("exports the schema v1 manifest filename and supported version", () => {
    expect(PROJECT_MANIFEST_FILENAME).toBe("autodemo.project.json");
    expect(SUPPORTED_PROJECT_SCHEMA_VERSION).toBe(1);
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
