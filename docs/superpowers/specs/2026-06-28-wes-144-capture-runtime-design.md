# WES-144 Capture Runtime Design

Date: 2026-06-28

## Linear Issue

- Issue: WES-144, "Capture runtime design/spec"
- Project: Auto Demo Balanced MVP
- Milestone: Capture Runtime
- Parent: WES-135, "Milestone 2: Capture runtime tracker"

## Summary

WES-144 defines the first capture-runtime contract before implementation begins. The initial runtime is browser-first and CLI-owned: `autodemo capture` launches the browser context, starts media and metadata capture, runs an optional child walkthrough command, stops capture when that command exits, and writes a temporary capture bundle.

This spec intentionally does not define the final Auto Demo project schema. The capture bundle is a milestone-local handoff format for WES-143 through WES-146. Demo Project Format will later formalize how capture bundles become full Auto Demo projects.

## Goals

- Define the first `autodemo capture` CLI lifecycle.
- Define capture adapter boundaries between `packages/cli` and `packages/capture`.
- Define the temporary capture bundle layout.
- Define the initial semantic-plus-spatial interaction event model.
- Define start, stop, timestamps, artifact paths, and partial-artifact behavior.
- Identify the first implementation issue after design approval.

## Non-Goals

- Native macOS, Windows, or Linux screen/window capture.
- Attaching to an already-running browser.
- Chrome extension packaging.
- Final `autodemo.project.json` schema.
- Auto polish decisions.
- Variant rendering or export.
- Browser editor UI.
- Full MCP or agent skill integration.

## Recommended Approach

Use CLI-owned child-command capture as the primary flow:

```bash
autodemo capture --url <url> --out <capture-dir> -- <walkthrough command>
```

The CLI owns the browser session from start to finish. It launches a Playwright-controlled browser context, starts viewport recording and event metadata collection, runs the child walkthrough command, and stops capture when the child exits.

This is the most deterministic first slice for agents and tests. It avoids the complexity of browser discovery, remote debugging setup, page selection, and cleanup that comes with attaching to an existing browser.

Manual capture remains a basic fallback:

```bash
autodemo capture --url <url> --out <capture-dir>
```

In that mode, capture runs until interrupted with Ctrl-C. WES-144 does not define a separate stop API, daemon mode, UI stop button, or MCP long-running tool contract.

## CLI Contract

Initial command shape:

```bash
autodemo capture --url <url> --out <capture-dir> [--viewport <width>x<height>] [--] [walkthrough command...]
```

Required arguments:

- `--url`: initial URL opened in the browser context.
- `--out`: capture bundle output directory.

Optional arguments:

- `--viewport`: deterministic viewport size. If omitted, use a documented default such as `1280x720`.
- Child command after `--`: command run while capture is active.

CLI responsibilities:

- Parse and validate command arguments.
- Create output-directory intent and reject unsafe ambiguous paths.
- Start the capture adapter before running the child command.
- Run the child command with inherited or clearly documented stdio behavior.
- Stop capture after the child command exits.
- Map capture and child-command results to predictable process exit codes.
- Handle Ctrl-C by attempting graceful capture stop.

Capture package responsibilities:

- Own browser adapter session creation.
- Launch and close the browser context.
- Start and stop viewport media capture.
- Write interaction metadata events.
- Write the capture manifest and artifact paths.
- Preserve partial artifacts when practical.

## Capture Adapter Boundary

`packages/capture` should expose a browser adapter interface that hides Playwright-specific mechanics from the CLI.

Conceptual types:

```ts
type BrowserCaptureOptions = {
  source: { kind: "browser"; url: string };
  outputDir: string;
  viewport: { width: number; height: number };
  startedAt: string;
  childCommand?: {
    command: string;
    args: string[];
  };
};

type CaptureSession = {
  readonly outputDir: string;
  readonly manifestPath: string;
  stop(reason: "completed" | "failed" | "interrupted"): Promise<CaptureStopResult>;
};

type CaptureAdapter = {
  readonly kind: "browser";
  start(options: BrowserCaptureOptions): Promise<CaptureStartResult>;
};
```

The implementation can refine names and exact result shapes, but the boundary should preserve the separation: CLI manages process lifecycle, capture manages browser/media/metadata/artifacts.

## Lifecycle

Primary child-command lifecycle:

1. CLI validates `--url`, `--out`, viewport, and child command.
2. CLI asks `packages/capture` to start a browser capture session.
3. Browser adapter launches a Playwright browser context with deterministic viewport settings.
4. Capture starts media recording and metadata collection before the walkthrough begins.
5. CLI runs the child walkthrough command while capture remains active.
6. When the child exits, CLI asks capture to stop with `completed` or `failed`.
7. Capture flushes media, metadata, and manifest.
8. CLI exits with the child status if capture succeeded, or nonzero if capture failed.

Manual fallback lifecycle:

1. CLI starts capture the same way.
2. CLI waits until interrupted.
3. On Ctrl-C, CLI asks capture to stop with `interrupted`.
4. Capture writes a partial bundle when possible.
5. CLI exits nonzero and reports the interrupted bundle path.

## Temporary Capture Bundle

WES-144 defines a temporary capture bundle:

```text
capture-dir/
  capture.manifest.json
  media/
    viewport.webm
  metadata/
    events.jsonl
```

The bundle is a durable artifact for Capture Runtime work but not the final Auto Demo project format.

### `capture.manifest.json`

The manifest records the capture run and artifact paths:

```json
{
  "schemaVersion": 1,
  "status": "completed",
  "source": {
    "kind": "browser",
    "url": "http://localhost:3000"
  },
  "adapter": {
    "kind": "browser",
    "backend": "playwright"
  },
  "viewport": {
    "width": 1280,
    "height": 720
  },
  "startedAt": "2026-06-28T12:00:00.000Z",
  "endedAt": "2026-06-28T12:01:00.000Z",
  "durationMs": 60000,
  "artifacts": {
    "media": "media/viewport.webm",
    "events": "metadata/events.jsonl"
  },
  "childCommand": {
    "command": "npm",
    "args": ["run", "demo:walkthrough"],
    "exitCode": 0
  },
  "error": null
}
```

Allowed statuses:

- `completed`: capture and child command completed successfully.
- `failed`: capture started but the child command or capture runtime failed.
- `interrupted`: capture started and was interrupted before normal completion.

Errors must be non-secret. They may include command names, exit codes, artifact paths, and categorized messages. They must not include credentials, environment dumps, cookies, local storage contents, or request bodies.

### Media Artifact

The first media artifact is viewport recording:

```text
media/viewport.webm
```

Playwright video is an acceptable first backend. If the actual backend emits a different extension or media type, the manifest records the real path and backend details. The rest of the runtime should consume the manifest path rather than hard-code the extension.

### Metadata Artifact

Interaction metadata is line-delimited JSON:

```text
metadata/events.jsonl
```

JSONL allows events to be flushed incrementally and keeps partial captures inspectable after failures. Each line must be independently parseable JSON.

## Event Model

Each event uses a shared envelope:

```ts
type CaptureEvent = {
  id: string;
  type: CaptureEventType;
  timestampMs: number;
  sequence: number;
  pageUrl?: string;
  pageTitle?: string;
  viewport?: {
    width: number;
    height: number;
  };
  data?: Record<string, unknown>;
};
```

Initial event types:

- `capture_started`
- `capture_stopped`
- `agent_step`
- `navigation`
- `click`
- `fill`
- `press`
- `wait`
- `console`
- `page_error`

Interaction events should include semantic and spatial fields when available:

- `selector`
- `role`
- `label`
- `text`
- `x`
- `y`
- `button`
- `key`
- `modifiers`

The event stream should prioritize events that later polish can use for zooms, click emphasis, pacing, captions, and step boundaries. Raw mousemove streams, screenshots per event, network tracing, and full DOM snapshots are out of scope for WES-144.

## Timestamps And Ordering

- `startedAt` and `endedAt` in the manifest use ISO 8601 UTC timestamps.
- Event `timestampMs` is relative to capture start.
- Event `sequence` is a monotonic integer starting at 1.
- Consumers should use `sequence` to break ties when timestamps match.
- Media and event timing should share the same capture start reference.

## Failure Handling

Capture should preserve partial artifacts by default.

Failure rules:

- Child command fails: keep the bundle, set `status` to `failed`, record child exit code, and exit nonzero.
- Capture setup fails before recording starts: no bundle is required.
- Media recording fails after capture starts: keep metadata and manifest if possible, set `status` to `failed`, and exit nonzero.
- Metadata writing fails: stop capture, keep media if possible, set `status` to `failed`, and exit nonzero.
- Ctrl-C: attempt graceful stop, set `status` to `interrupted`, keep artifacts that flushed successfully, and exit nonzero.

Artifact cleanup should be conservative. Do not delete partial media or metadata once capture has started unless the user explicitly requests cleanup in a future command.

## Testing Strategy

Tests should verify observable behavior and artifacts, not internal Playwright implementation details.

Recommended tests:

- CLI validates missing `--url`, missing `--out`, invalid viewport, and malformed child-command usage with clear errors.
- CLI child-command lifecycle maps successful and failing child exits predictably.
- Capture manifest records status, timestamps, source URL, viewport, artifacts, child command, and errors.
- Event writer produces JSONL where every line is parseable.
- Failed and interrupted captures preserve inspectable partial bundles.
- Capture package exposes a browser adapter boundary without leaking Playwright-specific types into CLI-facing APIs.

## Deferred To Later Work

WES-143 should implement the first actionable slice after this design: browser capture adapter skeleton and CLI contract.

WES-142 should add Playwright viewport media recording.

WES-145 should add browser interaction metadata capture.

WES-147 should add capture bundle writer and manifest behavior.

WES-146 should harden failure handling and validation tests.

Milestone 3, Demo Project Format, should define the final project schema and conversion from capture bundle to full Auto Demo project.

## Acceptance Criteria Mapping

- Design/spec exists in the repo: this document.
- Spec identifies the first actionable implementation issue after approval: WES-143.
- Native OS/window capture, Chrome extension packaging, polish, rendering, and editor work are out of scope.
- Open questions are resolved or explicitly deferred.

## Success Criteria

WES-144 is complete when this design is reviewed and accepted, the Linear project map links to it, and WES-143 can begin with a clear CLI-owned browser capture lifecycle, adapter boundary, temporary bundle contract, event model, and failure behavior.
