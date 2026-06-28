# WES-142 Playwright Viewport Media Recording Design

Date: 2026-06-28

## Linear Issue

- Issue: WES-142, "Playwright viewport media recording"
- Project: Auto Demo Balanced MVP
- Milestone: Capture Runtime
- Parent: WES-135, "Milestone 2: Capture runtime tracker"

## Summary

WES-142 replaces the current unsupported browser capture backend with a real Playwright-backed browser capture adapter. The CLI lifecycle from WES-143 remains intact: `packages/cli` parses `autodemo capture`, starts a browser capture adapter, runs an optional child command, and stops the session with `completed`, `failed`, or `interrupted`.

The new work belongs primarily in `packages/capture`. It launches Playwright's bundled Chromium, records viewport video to the capture output directory, stops deterministically through the existing `CaptureSession` API, and returns the media path plus basic timing from `session.stop()`.

WES-142 does not write the durable capture manifest. WES-147 remains responsible for manifest writing and bundle schema hardening.

## Goals

- Add a concrete `createPlaywrightBrowserCaptureAdapter()` export from `@auto-demo/capture`.
- Make `autodemo capture` use the Playwright adapter by default.
- Launch Playwright's bundled Chromium for the requested URL and viewport.
- Record viewport media without OS screen-recording permissions.
- Return the media artifact path and basic capture timing from a successful stop.
- Preserve the existing CLI-owned capture lifecycle and behavior-oriented tests.

## Non-Goals

- Attaching to an already-running browser.
- Native macOS, Windows, or Linux screen/window capture.
- Browser chrome, desktop, system dialog, or native menu recording.
- Audio capture.
- Interaction metadata capture; WES-145 owns that.
- Durable `capture.manifest.json` writing; WES-147 owns that.
- Broad failure validation and recovery hardening; WES-146 owns that.
- Final Auto Demo project schema.

## Recommended Approach

Use Playwright's built-in context video recording behind the existing `BrowserCaptureAdapter` interface. The CLI should switch its default dependency from `createUnsupportedBrowserCaptureAdapter()` to `createPlaywrightBrowserCaptureAdapter()`, while tests and future integrations can continue injecting custom adapters.

The adapter should treat Playwright video as a backend implementation detail. Public capture APIs should describe Auto Demo artifacts, not Playwright objects.

## Public Contract Changes

`packages/capture` should keep the existing WES-143 types and add media/timing fields to successful stop results:

```ts
export type CaptureMediaArtifact = {
  kind: "viewport";
  path: string;
  contentType: "video/webm";
};

export type CaptureTiming = {
  startedAt: string;
  endedAt: string;
  durationMs: number;
};

export type CaptureOutput = {
  outputDir: string;
  manifestPath: string;
  media: CaptureMediaArtifact;
  timing: CaptureTiming;
};
```

`CaptureStopResult` should continue returning `{ ok: true, output: CaptureOutput }` on success. All successful capture sessions must report media and timing. `manifestPath` remains for compatibility with the current CLI output and WES-147 handoff, but WES-142 does not create that file.

`packages/capture` should export:

```ts
export function createPlaywrightBrowserCaptureAdapter(): BrowserCaptureAdapter;
```

No Playwright-specific types should appear in CLI-facing APIs.

## Capture Package Architecture

`packages/capture/src/index.ts` can remain the public export surface, but Playwright-specific code should live in focused internal modules so the file does not absorb browser launch, session state, path handling, and test seams in one place.

Recommended internal units:

- Playwright adapter factory: creates the browser adapter and maps setup failures to public capture errors.
- Playwright session: owns browser/context/page handles and implements `stop(reason)`.
- Path helpers: create `media/`, compute intended `media/viewport.webm`, and normalize relative output paths.
- Clock helper or injected clock: computes deterministic timing in tests.
- Internal Playwright driver seam: wraps the small subset of Playwright used by the adapter so unit tests can use fakes without asserting private Playwright mechanics.

The driver seam is internal only. It should not become a public extension API.

## Start Lifecycle

On `adapter.start(options)`:

1. Create `options.outputDir` and `options.outputDir/media`.
2. Launch Playwright's bundled Chromium.
3. Create a browser context with:
   - `viewport` from `options.viewport`;
   - video recording enabled with output under `options.outputDir/media`.
4. Create a page.
5. Navigate to `options.source.url`.
6. Capture the effective start timestamp and return a `CaptureSession`.

If setup fails before the session is usable, the adapter should close any partially created Playwright resources and return a non-secret capture error. It should not dump environment variables, cookies, local storage, or request bodies.

## Stop Lifecycle

On `session.stop(reason)`:

1. Ensure stop is only resolved once. A repeated stop should return the first result or a stable public error.
2. Resolve the page video handle before closing resources when required by Playwright.
3. Close the browser context so Playwright finalizes the video file.
4. Close the browser.
5. Resolve the generated video file path.
6. Prefer moving or copying the generated file to `media/viewport.webm` when it is practical and does not risk data loss.
7. Return `{ ok: true, output }` with media and timing.

Playwright may generate a backend-specific video filename. If renaming to `media/viewport.webm` fails after a valid video exists, the adapter should return the actual generated path rather than reporting a false path. Partial media should be preserved wherever Playwright flushed it.

The `reason` argument is not written to a manifest in WES-142. It is still accepted because the CLI lifecycle already passes it and later manifest work will need it.

## CLI Behavior

`packages/cli` should keep its current parsing, child-command, SIGINT, and stop-reason behavior. The default dependencies should switch to the Playwright adapter.

Expected user-facing behavior:

```bash
autodemo capture --url http://localhost:3000 --out demo-capture -- npm run demo:walkthrough
```

When capture and the child command succeed, the CLI exits with code `0` and prints the existing capture bundle line. The successful stop result contains the media path and timing for future consumers. WES-142 should not change CLI stdout beyond what is needed to keep existing tests coherent; the capture result is the required media/timing reporting surface.

When the child command fails, the CLI still calls `session.stop("failed")`, preserves the video if possible, exits with the child exit code, and prints the existing child-command failure diagnostic.

When interrupted, the CLI calls `session.stop("interrupted")`, preserves flushed video if possible, and exits nonzero.

## Error Handling

Add public capture error codes only where they describe observable failure categories. A small initial set is enough:

- `capture_not_implemented`: retained for the unsupported adapter.
- `capture_setup_failed`: Playwright could not launch, create a context/page, create output directories, or navigate before a session became usable.
- `capture_stop_failed`: Playwright failed while finalizing or closing a started capture.

Error messages must be concise and non-secret. They may include non-sensitive paths and failure categories. They must not include environment dumps, credentials, cookies, local storage, request bodies, or full browser traces.

Resource cleanup should be best effort. If setup or stop cleanup fails, the adapter should prefer preserving artifacts and returning a clear error over deleting partial output.

## Testing Strategy

Tests should verify observable behavior and artifacts, not Playwright internals.

Capture package unit tests:

- `createPlaywrightBrowserCaptureAdapter()` starts a fake Playwright driver with the requested URL, viewport, and media directory.
- A successful stop returns media path, content type, started/ended timestamps, and duration.
- Setup failure closes partially created resources and returns `capture_setup_failed`.
- Stop failure returns `capture_stop_failed` and does not claim a media path that was not resolved.
- Existing unsupported adapter behavior remains covered.

CLI tests:

- Existing parser and lifecycle tests should continue using injected fake adapters.
- The CLI default dependency should be covered by a narrow test that mocks the capture package's Playwright adapter factory and verifies the default path no longer constructs the unsupported adapter.

Integration or smoke test:

- Run a tiny local page.
- Execute `autodemo capture --url <local-url> --out <tmp-dir> -- <short command>`.
- Verify a non-empty viewport video file exists at the media path reported by the capture result.
- Keep this test in a dedicated smoke command outside the default fast unit-test command, because Playwright browser installation and launch cost should not slow every package test run.

## Dependencies

Add the `playwright` package as a dependency of `@auto-demo/capture`, because the capture package owns the browser backend and needs bundled Chromium available through the standard Playwright install path. The runtime dependency should not live in `@auto-demo/cli`.

## Acceptance Criteria Mapping

- A sample CLI capture creates a playable viewport recording file: satisfied by making Playwright the default CLI capture backend and adding a smoke test.
- Capture result reports media path and basic timing: satisfied by adding media and timing fields to successful `CaptureStopResult.output`.
- Avoids OS screen-recording permission requirements: satisfied by using Playwright context video recording with bundled Chromium.
- Tests use deterministic fixtures or mocks where practical and avoid private mechanics: satisfied by the internal driver seam plus one focused smoke test.

## Open Decisions Resolved

- Default backend: Playwright becomes the default `autodemo capture` backend in WES-142.
- Manifest: WES-142 does not write the durable manifest; WES-147 owns it.
- Browser target: WES-142 launches bundled Chromium only.
- Existing browser attach: deferred.
- Interaction metadata: deferred to WES-145.
- Failure hardening beyond basic setup/stop cleanup: deferred to WES-146.

## Success Criteria

WES-142 is complete when `autodemo capture --url <url> --out <dir> -- <command>` can produce a non-empty viewport video through the default CLI path, the capture stop result reports media path and timing, focused unit tests cover the adapter behavior through fakes, and a smoke test verifies a real Playwright capture path without requiring OS screen-recording permissions.
