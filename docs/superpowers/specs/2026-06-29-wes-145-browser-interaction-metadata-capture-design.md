# WES-145 Browser Interaction Metadata Capture Design

Date: 2026-06-29

## Linear Issue

- Issue: WES-145, "Browser interaction metadata capture"
- Project: Auto Demo Balanced MVP
- Milestone: Capture Runtime
- Parent: WES-135, "Milestone 2: Capture runtime tracker"

## Summary

WES-145 adds structured browser interaction metadata capture alongside the existing Playwright viewport media recording. The CLI lifecycle remains unchanged: `packages/cli` parses `autodemo capture`, starts the browser capture adapter, runs an optional child command, and stops the session with `completed`, `failed`, or `interrupted`.

The new work belongs primarily in `packages/capture`. The Playwright adapter should create `metadata/events.jsonl`, attach browser and Playwright observers when the page is created, append ordered metadata events during capture, and return the metadata artifact path in the successful capture output.

WES-145 writes the metadata event file but does not write the durable `capture.manifest.json`. WES-147 later added manifest writing and final bundle schema hardening.

## Goals

- Create `metadata/events.jsonl` for each successful started browser capture.
- Append ordered, timestamped JSONL events during capture.
- Capture useful browser metadata for later polish decisions: navigation, URL changes, viewport, clicks, keyboard/input activity, console messages, and page errors.
- Redact raw typed values by default while retaining useful coarse metadata such as value length and value kind.
- Return the metadata artifact path from `CaptureOutput`.
- Preserve the existing CLI-owned lifecycle and Playwright media recording behavior.
- Keep Playwright-specific mechanics out of CLI-facing public APIs.

## Non-Goals

- Durable `capture.manifest.json` writing; WES-147 owns that follow-up.
- A public agent SDK or browser-control wrapper API.
- Full agent integration for step markers; later Agent Integrations work owns that.
- Raw mousemove streams.
- Screenshots per event.
- Network tracing.
- Full DOM snapshots.
- Recording raw typed secrets or form values.
- Broad failure recovery hardening beyond setup/stop behavior needed for metadata; WES-146 owns broader validation and failure hardening.

## Recommended Approach

Use passive page-level instrumentation as the implemented metadata source, with a reserved `agent_step` event shape in the event model. This gives useful metadata immediately without requiring agents or child commands to call Auto Demo wrappers.

The adapter should use two sources:

- Playwright-side observers for navigation, console, page errors, and lifecycle signals.
- Browser-side injected listeners for clicks, key presses, input/fill activity, and viewport resize observations.

The implementation should write JSONL incrementally so partial captures remain inspectable after interruption or child-command failure.

## Public Contract Changes

`CaptureOutput` should gain a metadata artifact:

```ts
export type CaptureMetadataArtifact = {
  kind: "events";
  path: string;
  contentType: "application/x-ndjson";
};

export type CaptureOutput = {
  outputDir: string;
  manifestPath: string;
  media: CaptureMediaArtifact;
  metadata: CaptureMetadataArtifact;
  timing: CaptureTiming;
};
```

Successful `session.stop()` results should include the metadata artifact path. Failure results keep the current public error shape with `outputDir` and `manifestPath`.

No Playwright concrete types should appear in CLI-facing APIs.

## File And Module Shape

Keep `packages/capture/src/index.ts` as the public export surface. Add focused internal modules so `playwrightAdapter.ts` does not absorb event modeling, writing, redaction, and browser instrumentation.

Recommended units:

- `capturePaths.ts`: add `metadataDir` and `eventsPath` alongside existing output/media paths.
- `captureEvents.ts`: define event types, event creation helpers, redaction policy, and typed-value classification.
- `jsonlEventWriter.ts`: append one JSON event per line, maintain sequence ordering, and flush/close safely.
- `playwrightMetadataRecorder.ts`: attach Playwright observers and browser-side listeners, normalize event payloads, and write events through the JSONL writer.
- `playwrightDriver.ts`: extend the existing internal driver seam only as needed for events, init scripts, exposed bindings, console/page-error observers, and page evaluation.

The driver seam remains internal only. It is a test seam, not a public extension API.

## Event File

Interaction metadata is written to:

```text
metadata/events.jsonl
```

Each line must be independently parseable JSON. JSONL allows incremental flushing and keeps partial captures useful after failures.

## Event Envelope

Each event uses this shared envelope:

```ts
export type CaptureEvent = {
  id: string;
  sequence: number;
  type: CaptureEventType;
  timestampMs: number;
  pageUrl?: string;
  pageTitle?: string;
  viewport?: {
    width: number;
    height: number;
  };
  data?: Record<string, unknown>;
};
```

Rules:

- `id` is stable and unique within a capture.
- `sequence` is a monotonic integer starting at `1`.
- `timestampMs` is relative to the capture start time.
- Consumers use `sequence` to break ties when timestamps match.
- Event timestamps and media timing share the same capture start reference.

## Event Types

WES-145 implements:

- `capture_started`
- `capture_stopped`
- `navigation`
- `click`
- `fill`
- `press`
- `viewport`
- `console`
- `page_error`

WES-145 reserves but does not actively produce through a public API:

- `agent_step`

The reserved `agent_step` event should use the same envelope and carry step labels/details under `data`, but no public agent API should be introduced in this issue.

## Event Payload Guidance

Event payloads should favor polish-ready signals over raw browser internals.

`capture_started` data:

- source URL
- requested viewport
- child command summary when present, without environment values

`capture_stopped` data:

- stop reason: `completed`, `failed`, or `interrupted`
- duration

`navigation` data:

- URL
- title when available
- navigation or lifecycle phase when available

`viewport` data:

- width
- height
- device scale factor if available and non-sensitive

`click` data:

- x/y coordinates when available
- button
- modifier keys
- target hints such as tag name, role, label, text snippet, selector-like hint, and input type when available

`press` data:

- key name
- modifier keys
- target hints
- no raw field value

`fill` data:

- target hints
- `redacted: true`
- `valueKind`
- `valueLength` except for password values
- input method when practical, such as keyboard, paste, or script-observed input

`console` data:

- level
- text summary
- location when available

`page_error` data:

- message summary
- name/type when available
- location or stack summary only when it is concise and non-secret

## Redaction And Typed Values

Typed values are redacted by default. The metadata file must not store raw input values from text fields, textareas, contenteditable regions, password fields, or paste events.

Instead, `fill` events record coarse metadata:

```ts
type CapturedValueKind =
  "email_like" | "url_like" | "number_like" | "short_text" | "long_text" | "password" | "unknown";
```

Classification rules:

- Password fields always use `valueKind: "password"` and omit exact `valueLength`.
- Email-shaped values use `email_like`.
- URL-shaped values use `url_like`.
- Numeric-looking values use `number_like`.
- Other non-empty values are `short_text` or `long_text` based on length.
- Empty or unavailable values use `unknown`.

Console and page-error events should also avoid secret-heavy payloads. Do not record request bodies, cookies, local storage, headers, environment variables, or large serialized objects.

## Start Lifecycle

On `adapter.start(options)`:

1. Build output paths for `media/`, `metadata/`, `media/viewport.webm`, and `metadata/events.jsonl`.
2. Create the output, media, and metadata directories.
3. Open the JSONL writer.
4. Start Playwright browser/context/page setup as today.
5. Attach metadata recorder hooks before or immediately after the first page navigation.
6. Emit `capture_started` with timestamp `0`, source URL, viewport, and safe child-command summary when present.
7. Navigate to the requested URL.
8. Emit initial viewport and navigation/lifecycle events when available.
9. Return a `CaptureSession`.

If setup fails before the session is usable, close partially created resources and return `capture_setup_failed`. Best effort cleanup should not delete partial metadata that has already been written.

## Stop Lifecycle

On `session.stop(reason)`:

1. Resolve duplicate stop calls to the first stop result, matching the existing WES-142 behavior.
2. Emit `capture_stopped` with reason and final timing.
3. Flush and close the metadata writer.
4. Stop Playwright media capture as today.
5. Return `{ ok: true, output }` with media, metadata, and timing.

If metadata flush or close fails, return `capture_stop_failed` rather than claiming a fully successful capture. Any partial media or metadata already written should remain on disk.

If media stop fails after metadata has been written, preserve the metadata file and return the existing stop failure shape. Current WES-146 behavior also best-effort writes a failed diagnostic manifest when both media and metadata artifacts exist.

## CLI Behavior

`packages/cli` should keep its current parsing, child-command, SIGINT, and stop-reason behavior.

Expected user-facing behavior remains:

```bash
autodemo capture --url http://localhost:3000 --out demo-capture -- npm run demo:walkthrough
```

The CLI continues printing the capture bundle line using `manifestPath`. WES-145 should not change stdout beyond test updates required by the `CaptureOutput` shape. Current WES-146 behavior also prints the capture bundle path when a started capture cannot stop cleanly. The metadata path is returned through the capture result for future consumers and WES-147 manifest writing.

## Error Handling

Reuse existing public error codes unless a new observable category is clearly needed:

- `capture_setup_failed`: setup could not create metadata paths, open the writer, launch Playwright, attach instrumentation, create the page, or navigate before a usable session was returned.
- `capture_stop_failed`: capture could not finalize metadata or media after a session started.

Error messages must be concise and non-secret. They may include non-sensitive paths and failure categories. They must not include credentials, cookies, local storage, request bodies, headers, environment dumps, or full browser traces.

## Testing Strategy

Tests should verify observable behavior and artifacts, not private Playwright mechanics.

Capture package unit tests:

- `buildCapturePaths()` includes `metadataDir` and `eventsPath`.
- JSONL writer appends independently parseable lines.
- Event writer assigns monotonic sequence numbers and normalized timestamps.
- Redaction/classification omits raw typed values and classifies representative values.
- Playwright metadata recorder writes events from fake page/context events in order.
- Successful stop returns `metadata` in `CaptureOutput`.
- Setup failure closes partially created resources and returns `capture_setup_failed`.
- Stop-time metadata failure returns `capture_stop_failed`.
- Existing unsupported adapter behavior remains covered.

CLI tests:

- Existing fake successful stop results include metadata paths.
- Existing parser and lifecycle behavior remains unchanged.
- Default backend tests continue verifying the Playwright adapter is used.

Smoke test:

- Run a tiny local page.
- Execute `autodemo capture --url <local-url> --out <tmp-dir> -- <short command>`.
- Verify a non-empty viewport video exists.
- Verify `metadata/events.jsonl` exists, is non-empty, and every line parses as JSON.
- Keep exhaustive browser event coverage in unit tests; the smoke test only proves the real path produces artifacts.

## Dependencies And Ordering

WES-145 depends on WES-142 because it extends the Playwright browser capture adapter and successful capture output. WES-147 should consume the metadata path when writing the durable manifest. WES-146 should later harden validation and mixed-failure reporting.

## Acceptance Criteria Mapping

- A capture produces a metadata file with ordered, timestamped events: satisfied by incremental JSONL writer, sequence numbers, and normalized timestamps.
- Events include enough location and action detail to support later polish decisions: satisfied by click, fill, press, navigation, viewport, console, and page-error payloads.
- Sensitive typed values are handled according to the approved design: satisfied by default redaction and coarse value classification.
- Tests verify observable metadata shape from representative interactions: satisfied by fake-driven unit tests plus a narrow smoke artifact check.

## Success Criteria

WES-145 is complete when a Playwright browser capture writes `metadata/events.jsonl`, successful capture output reports the metadata artifact path, event lines are ordered and parseable, typed values are redacted with coarse classification, existing CLI lifecycle behavior is preserved, and focused tests verify the observable metadata behavior without asserting private Playwright internals.
