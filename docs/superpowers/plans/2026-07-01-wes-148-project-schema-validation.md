# WES-148 Project Schema Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the schema version 1 `autodemo.project.json` manifest contract and strict manifest-only validation in `@auto-demo/project`.

**Architecture:** `packages/project/src/index.ts` remains the package entrypoint for this first schema slice. It exports manifest constants, public types, and a pure synchronous `validateProjectManifest(input)` function. The validator accumulates stable non-secret errors and does not perform filesystem, capture-bundle, project-directory, or CLI work.

**Tech Stack:** TypeScript, Vitest, npm workspaces, existing `@auto-demo/project` package.

---

## File Structure

- Modify: `packages/project/src/index.test.ts`
  - Owns black-box behavior tests for the public validator.
  - No filesystem fixtures in WES-148.
- Modify: `packages/project/src/index.ts`
  - Owns manifest constants, exported types, and pure manifest validation helpers.
  - Keep this as one file for WES-148; split later when WES-149/WES-150 add import/load/save behavior.
- Do not modify: `packages/project/package.json`
  - WES-148 does not need dependencies.
- Do not modify: CLI, capture package, or README.
  - No user-facing CLI behavior changes in this issue.

## Task 1: Replace Minimal Tests With Full Manifest Contract Tests

**Files:**

- Modify: `packages/project/src/index.test.ts`

- [ ] **Step 1: Replace `packages/project/src/index.test.ts` with failing black-box tests**

Use this full file content:

```ts
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
    const { variants: _variants, ...withoutVariants } = validManifest;

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
```

- [ ] **Step 2: Run tests and confirm the expected failure**

Run:

```bash
rtk npm --workspace @auto-demo/project test -- src/index.test.ts
```

Expected: FAIL. The current implementation does not export the full `ProjectManifest` type shape and still returns `{ code, message }` instead of `{ errors }` for invalid manifests.

- [ ] **Step 3: Commit the failing tests**

```bash
rtk git add packages/project/src/index.test.ts
rtk git commit -m "test: define project manifest schema validation"
```

## Task 2: Implement Strict Manifest Validation

**Files:**

- Modify: `packages/project/src/index.ts`
- Test: `packages/project/src/index.test.ts`

- [ ] **Step 1: Replace `packages/project/src/index.ts` with the schema v1 validator**

Use this full file content:

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

export type ProjectValidationErrorCode =
  "unsupported_project_version" | "invalid_project_manifest" | "unsafe_project_path";

export type ProjectValidationError = {
  code: ProjectValidationErrorCode;
  message: string;
};

export type ProjectManifestValidationResult =
  { ok: true; manifest: ProjectManifest } | { ok: false; errors: ProjectValidationError[] };

export type ProjectValidationResult = ProjectManifestValidationResult;

type JsonRecord = Record<string, unknown>;

const TOP_LEVEL_KEYS = [
  "schemaVersion",
  "name",
  "createdAt",
  "updatedAt",
  "sourceCapture",
  "media",
  "metadata",
  "variants",
  "previews",
  "exports",
] as const;

const SOURCE_CAPTURE_KEYS = [
  "kind",
  "status",
  "source",
  "viewport",
  "timing",
  "adapter",
  "tools",
  "manifestPath",
] as const;

const SOURCE_KEYS = ["kind", "url"] as const;
const VIEWPORT_KEYS = ["width", "height"] as const;
const TIMING_KEYS = ["startedAt", "endedAt", "durationMs"] as const;
const ADAPTER_KEYS = ["kind", "backend"] as const;
const TOOLS_KEYS = ["capturePackage", "playwright"] as const;
const MEDIA_KEYS = ["primary"] as const;
const MEDIA_PRIMARY_KEYS = ["kind", "path", "contentType"] as const;
const METADATA_KEYS = ["events"] as const;
const METADATA_EVENTS_KEYS = ["path", "contentType"] as const;

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

  reportUnknownFields(input, TOP_LEVEL_KEYS, errors);
  validateSchemaVersion(input.schemaVersion, errors);
  validateNonEmptyString(
    input.name,
    "Auto Demo project manifest must include a non-empty name.",
    errors,
  );
  validateManifestTimestamps(input, errors);
  validateForwardCompatibleArrays(input, errors);
  validateSourceCapture(input.sourceCapture, errors);
  validateMedia(input.media, errors);
  validateMetadata(input.metadata, errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, manifest: input as ProjectManifest };
}

function validateSchemaVersion(value: unknown, errors: ProjectValidationError[]): void {
  if (value !== SUPPORTED_PROJECT_SCHEMA_VERSION) {
    errors.push({
      code: "unsupported_project_version",
      message: "Unsupported Auto Demo project schema version.",
    });
  }
}

function validateManifestTimestamps(input: JsonRecord, errors: ProjectValidationError[]): void {
  if (!isIsoTimestamp(input.createdAt) || !isIsoTimestamp(input.updatedAt)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest timestamps are invalid.",
    });
  }
}

function validateForwardCompatibleArrays(
  input: JsonRecord,
  errors: ProjectValidationError[],
): void {
  if (
    !isEmptyArray(input.variants) ||
    !isEmptyArray(input.previews) ||
    !isEmptyArray(input.exports)
  ) {
    errors.push({
      code: "invalid_project_manifest",
      message:
        "Auto Demo project manifest must include empty variants, previews, and exports arrays.",
    });
  }
}

function validateSourceCapture(value: unknown, errors: ProjectValidationError[]): void {
  if (!isRecord(value)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest sourceCapture is invalid.",
    });
    return;
  }

  reportUnknownFields(value, SOURCE_CAPTURE_KEYS, errors);

  if (value.kind !== "browser" || !isCaptureStatus(value.status)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest sourceCapture is invalid.",
    });
  }

  validateSource(value.source, errors);
  validateViewport(value.viewport, errors);
  validateTiming(value.timing, errors);
  validateAdapter(value.adapter, errors);
  validateTools(value.tools, errors);

  if (value.manifestPath !== "metadata/capture.manifest.json") {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest sourceCapture manifest path is invalid.",
    });
  }
}

function validateSource(value: unknown, errors: ProjectValidationError[]): void {
  if (!isRecord(value)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest sourceCapture is invalid.",
    });
    return;
  }

  reportUnknownFields(value, SOURCE_KEYS, errors);

  if (value.kind !== "browser" || typeof value.url !== "string" || !isSafeSourceUrl(value.url)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest sourceCapture is invalid.",
    });
  }
}

function validateViewport(value: unknown, errors: ProjectValidationError[]): void {
  if (!isRecord(value)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest sourceCapture viewport is invalid.",
    });
    return;
  }

  reportUnknownFields(value, VIEWPORT_KEYS, errors);

  if (!isPositiveInteger(value.width) || !isPositiveInteger(value.height)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest sourceCapture viewport is invalid.",
    });
  }
}

function validateTiming(value: unknown, errors: ProjectValidationError[]): void {
  if (!isRecord(value)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest sourceCapture timing is invalid.",
    });
    return;
  }

  reportUnknownFields(value, TIMING_KEYS, errors);

  if (
    !isIsoTimestamp(value.startedAt) ||
    !isIsoTimestamp(value.endedAt) ||
    typeof value.durationMs !== "number" ||
    !Number.isFinite(value.durationMs) ||
    value.durationMs < 0
  ) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest sourceCapture timing is invalid.",
    });
  }
}

function validateAdapter(value: unknown, errors: ProjectValidationError[]): void {
  if (!isRecord(value)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest sourceCapture adapter is invalid.",
    });
    return;
  }

  reportUnknownFields(value, ADAPTER_KEYS, errors);

  if (value.kind !== "browser" || value.backend !== "playwright") {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest sourceCapture adapter is invalid.",
    });
  }
}

function validateTools(value: unknown, errors: ProjectValidationError[]): void {
  if (!isRecord(value)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest sourceCapture tools are invalid.",
    });
    return;
  }

  reportUnknownFields(value, TOOLS_KEYS, errors);

  if (!isNonEmptyString(value.capturePackage) || !isNonEmptyString(value.playwright)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest sourceCapture tools are invalid.",
    });
  }
}

function validateMedia(value: unknown, errors: ProjectValidationError[]): void {
  if (!isRecord(value)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest media.primary is invalid.",
    });
    return;
  }

  reportUnknownFields(value, MEDIA_KEYS, errors);

  if (!isRecord(value.primary)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest media.primary is invalid.",
    });
    return;
  }

  reportUnknownFields(value.primary, MEDIA_PRIMARY_KEYS, errors);

  const pathIsSafe = isSafeProjectPath(value.primary.path);

  if (!pathIsSafe) {
    errors.push({
      code: "unsafe_project_path",
      message: "Project media.primary.path must be a relative path inside the project.",
    });
  }

  if (
    value.primary.kind !== "viewport" ||
    (pathIsSafe && value.primary.path !== "raw/capture.webm") ||
    value.primary.contentType !== "video/webm"
  ) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest media.primary is invalid.",
    });
  }
}

function validateMetadata(value: unknown, errors: ProjectValidationError[]): void {
  if (!isRecord(value)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest metadata.events is invalid.",
    });
    return;
  }

  reportUnknownFields(value, METADATA_KEYS, errors);

  if (!isRecord(value.events)) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest metadata.events is invalid.",
    });
    return;
  }

  reportUnknownFields(value.events, METADATA_EVENTS_KEYS, errors);

  const pathIsSafe = isSafeProjectPath(value.events.path);

  if (!pathIsSafe) {
    errors.push({
      code: "unsafe_project_path",
      message: "Project metadata.events.path must be a relative path inside the project.",
    });
  }

  if (
    (pathIsSafe && value.events.path !== "metadata/events.jsonl") ||
    value.events.contentType !== "application/x-ndjson"
  ) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest metadata.events is invalid.",
    });
  }
}

function reportUnknownFields(
  value: JsonRecord,
  allowedKeys: readonly string[],
  errors: ProjectValidationError[],
): void {
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    errors.push({
      code: "invalid_project_manifest",
      message: "Auto Demo project manifest contains unknown fields.",
    });
  }
}

function validateNonEmptyString(
  value: unknown,
  message: string,
  errors: ProjectValidationError[],
): void {
  if (!isNonEmptyString(value)) {
    errors.push({
      code: "invalid_project_manifest",
      message,
    });
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

function isEmptyArray(value: unknown): value is [] {
  return Array.isArray(value) && value.length === 0;
}

function isCaptureStatus(value: unknown): value is ProjectSourceCapture["status"] {
  return value === "completed" || value === "failed" || value === "interrupted";
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isSafeSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function isSafeProjectPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }

  return (
    !value.startsWith("/") && !value.includes("..") && !value.includes("\\") && !value.includes(":")
  );
}
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
rtk npm --workspace @auto-demo/project test -- src/index.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run focused typecheck**

Run:

```bash
rtk npm --workspace @auto-demo/project run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit implementation**

```bash
rtk git add packages/project/src/index.ts
rtk git commit -m "feat: validate project manifest schema"
```

## Task 3: Verify Workspace And Record Completion Evidence Locally

**Files:**

- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Run package build and tests**

Run:

```bash
rtk npm --workspace @auto-demo/project run build
rtk npm --workspace @auto-demo/project test -- src/index.test.ts
```

Expected: both commands PASS.

- [ ] **Step 2: Run root validation if time allows**

Run:

```bash
rtk npm run validate
```

Expected: PASS. If this fails outside `@auto-demo/project`, capture the failing command and exact failure before changing unrelated code.

- [ ] **Step 3: Update the project map with WES-148 completion evidence**

Edit `docs/linear/auto-demo-project-structure.md` in two places.

In `Issues By Milestone`, change WES-148 from Backlog to Done only after implementation and verification pass:

```markdown
- WES-148: Project schema validation and public API - Done - https://linear.app/weston-bushyeager/issue/WES-148/project-schema-validation-and-public-api
```

In `Completion Evidence`, add:

```markdown
- WES-148: `@auto-demo/project` now exports schema version 1 project manifest types and validates full `autodemo.project.json` objects with accumulated structured errors. Validation covers required sections, literal values, timestamps, source capture URL safety, fixed artifact paths, empty forward-compatible arrays, and unknown fields without echoing secret-bearing input.
- WES-148 verification: `npm --workspace @auto-demo/project run build`, `npm --workspace @auto-demo/project test -- src/index.test.ts`, and `npm run validate` passed locally on 2026-07-01.
```

- [ ] **Step 4: Commit documentation evidence**

```bash
rtk git add docs/linear/auto-demo-project-structure.md
rtk git commit -m "docs: mark WES-148 schema validation complete"
```

- [ ] **Step 5: Run final status check**

Run:

```bash
rtk git status --short
```

Expected: only unrelated pre-existing files or intentionally uncommitted artifacts remain. If the design or plan docs are still uncommitted, leave them uncommitted unless the user explicitly asks to include them.

## Completion Gate Reminder

Before reporting WES-148 as done or writing to Linear, run `linear-sync-gate` in completion-gate mode for WES-148. Apply clear Linear completion evidence only after verification passes. Do not mark WES-134 done; it remains the Demo Project Format tracker until WES-148, WES-149, and WES-150 are complete.
