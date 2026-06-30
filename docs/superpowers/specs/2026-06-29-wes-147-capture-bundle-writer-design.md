# WES-147 Capture Bundle Writer Design

Date: 2026-06-29

## Linear Issue

- Issue: WES-147, "Capture bundle writer and manifest"
- Project: Auto Demo Balanced MVP
- Milestone: Capture Runtime
- Parent: WES-135, "Milestone 2: Capture runtime tracker"

## Context

WES-142 made Playwright viewport media recording the default capture backend. WES-145 added browser interaction metadata capture to `metadata/events.jsonl`. Before WES-147, the capture runtime already created the bundle directories and returned media, metadata, and timing paths from `CaptureOutput`, but `capture.manifest.json` was only a future handoff path.

WES-147 fills that gap. It writes the temporary Capture Runtime bundle manifest and exposes a lightweight validation check. WES-146 later hardened started-capture failures so failed/interrupted stops write stable non-secret diagnostics when artifacts exist, and stop failures best-effort preserve a diagnostic manifest. This remains capture-runtime input for the WES-134 Demo Project Format work, not the final Auto Demo project schema.

## Goals

- Write `capture.manifest.json` for completed, failed, and interrupted capture sessions that stop cleanly.
- Keep artifact paths relative to the bundle root so bundles are portable.
- Include schema version, status, capture source, target URL, viewport, adapter/tool versions, timing, artifact paths, redacted child command metadata, and optional non-secret error details.
- Provide a package API that validates a manifest and expected artifact files.
- Add a CLI validation path that uses the package API.
- Document the temporary bundle shape in the Linear project map.

## Non-Goals

- Define `autodemo.project.json` or any final Demo Project Format schema.
- Add screenshots, network logs, DOM snapshots, or extra artifact types.
- Harden every failure path; WES-146 owns broader failure handling and validation tests.
- Persist secrets, raw typed values, cookies, local storage, request bodies, or environment dumps.

## Approaches Considered

### Recommended: package-owned manifest writer plus CLI validator

`@auto-demo/capture` owns manifest construction, writing, reading, and validation. The Playwright adapter calls the writer after media and metadata are flushed. `@auto-demo/cli` exposes `autodemo validate <bundle-dir-or-manifest>` as a thin wrapper around the package validator.

This keeps the capture package responsible for its own bundle format and avoids duplicating schema knowledge in the CLI. It also gives future package consumers a lightweight API without requiring shell execution.

### Alternative: CLI-owned manifest writer

The CLI could build the manifest from `CaptureOutput` after `session.stop()`. That keeps the adapter smaller, but it makes the CLI responsible for backend details like artifact relativization, adapter metadata, and validation rules. Future non-CLI capture users would not get a complete bundle by default.

### Alternative: only return manifest data in memory

The adapter could return manifest JSON and let callers decide whether to write it. That is flexible, but it does not satisfy the acceptance criterion that a completed capture produces a readable manifest and expected artifact files. It also weakens partial-bundle preservation.

## Design

### Bundle Layout

The temporary capture bundle remains:

```text
capture-dir/
  capture.manifest.json
  media/
    viewport.webm
  metadata/
    events.jsonl
```

`capture.manifest.json` stores portable relative artifact paths:

```json
{
  "schemaVersion": 1,
  "status": "completed",
  "source": {
    "kind": "browser",
    "url": "https://example.com"
  },
  "adapter": {
    "kind": "browser",
    "backend": "playwright"
  },
  "tools": {
    "capturePackage": "0.0.0",
    "playwright": "1.61.1"
  },
  "viewport": {
    "width": 1280,
    "height": 720
  },
  "startedAt": "2026-06-29T12:00:00.000Z",
  "endedAt": "2026-06-29T12:00:02.500Z",
  "durationMs": 2500,
  "artifacts": {
    "media": "media/viewport.webm",
    "events": "metadata/events.jsonl"
  },
  "childCommand": {
    "command": "npm",
    "argCount": 1,
    "argsRedacted": true,
    "exitCode": null
  },
  "error": null
}
```

For `failed` and `interrupted` stops that flush cleanly, `status` records the stop reason and `error` uses stable codes such as `capture_failed` or `capture_interrupted`. When stopping a started capture fails after media and metadata exist, the runtime best-effort writes a `failed` manifest with `capture_stop_failed` diagnostics before returning the stop failure. `childCommand.exitCode` is nullable because the current Playwright adapter writes the manifest from capture options and stop reason, while the CLI process exit code is reported separately. `error` is either `null` or a small object with a code and message when the package API caller can provide non-secret error details. Error content must not include raw environment values, cookies, local storage, request bodies, or typed values, and manifest writing strips URL query/fragment secrets from diagnostic messages.

### Package API

Add `packages/capture/src/captureManifest.ts` with:

- `CaptureManifest` and related public types.
- `writeCaptureManifest(input)` to create the manifest, write formatted JSON, and return the manifest.
- `readCaptureManifest(pathOrBundleDir)` to read `capture.manifest.json` from either a manifest path or bundle directory.
- `validateCaptureBundle(pathOrBundleDir)` to verify the manifest shape and the referenced media/events files.

Validation returns a structured result instead of throwing for expected invalid bundles:

```ts
type CaptureBundleValidationResult =
  | { ok: true; manifest: CaptureManifest; manifestPath: string }
  | { ok: false; manifestPath: string; errors: string[] };
```

### Adapter Integration

`PlaywrightCaptureSession.stop()` already has the source URL, viewport, child command, started/ended timing, media artifact, metadata artifact, and stop reason. It will call `writeCaptureManifest()` after media is moved and before returning `CaptureOutput`.

`CaptureOutput` should continue returning caller-facing local artifact paths for immediate process use. The manifest should store relative paths so bundles can move across machines or directories.

WES-147 should also extend `BrowserCaptureOptions` with optional tool/package metadata only if current package versions cannot be read cleanly. The default writer should derive version strings from local package metadata or explicit package-local constants so tests do not depend on runtime package-manager behavior.

### CLI Validation

`autodemo validate <bundle-dir-or-manifest>` should:

- Exit `0` and print `Capture bundle valid: <manifest path>` for valid bundles.
- Exit `1` and print validation errors for invalid bundles.
- Require a path argument with a clear usage error.

The command remains capture-bundle validation for now. It is not final project validation.

## Testing

Use behavior-oriented tests:

- A package test writes a manifest with relative artifact paths and validates existing media/events files.
- A package test returns useful validation errors for missing files or malformed manifest JSON.
- A Playwright adapter unit test stops a fake capture and verifies a readable manifest exists with status, source, viewport, timing, artifacts, and tool versions.
- A CLI test validates a temporary bundle through `autodemo validate` and reports missing path or invalid bundle errors.

Do not assert private Playwright mechanics. Tests should verify files and public API outputs.

## Documentation

Update `docs/linear/auto-demo-project-structure.md` to add the WES-147 design spec, describe the temporary capture bundle, update the next-task pointer, and record verification evidence after implementation.

## Acceptance Criteria Mapping

- Completed capture produces a readable manifest and expected artifact files: adapter stop writes manifest after media/events flush and tests read it back.
- Manifest can be validated by package API or CLI: `validateCaptureBundle()` and `autodemo validate` cover this.
- Paths are portable: manifest artifact paths are relative to the bundle root.
- Bundle format is documented as temporary input: this spec and the project map state that Demo Project Format owns the final schema.
