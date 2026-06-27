import { describe, expect, it } from "vitest";
import { validateProjectManifest } from "./index.js";

describe("validateProjectManifest", () => {
  it("accepts a minimal supported manifest", () => {
    const result = validateProjectManifest({
      schemaVersion: 1,
      name: "Checkout flow demo",
      createdAt: "2026-06-27T00:00:00.000Z",
    });

    expect(result.ok).toBe(true);
  });

  it("rejects unsupported schema versions", () => {
    const result = validateProjectManifest({
      schemaVersion: 99,
      name: "Checkout flow demo",
      createdAt: "2026-06-27T00:00:00.000Z",
    });

    expect(result).toEqual({
      ok: false,
      code: "unsupported_project_version",
      message: "Unsupported Auto Demo project schema version: 99",
    });
  });

  it("rejects structurally invalid manifests", () => {
    const result = validateProjectManifest({
      schemaVersion: 1,
      createdAt: "2026-06-27T00:00:00.000Z",
    });

    expect(result).toEqual({
      ok: false,
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest must include a non-empty name.",
    });
  });
});
