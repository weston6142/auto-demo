# WES-152 Baseline Polish Decisions Design

Date: 2026-07-02

## Linear Issue

- Issue: WES-152, "Generate baseline polish decisions from capture events"
- Project: Auto Demo Balanced MVP
- Milestone: Auto Polish Engine

## Context

Capture Runtime writes browser interaction metadata to `metadata/events.jsonl`.
Demo Project Format imports that file into a portable Auto Demo project, and
WES-151 extended schema version 1 so `autodemo.project.json` can validate MVP
`ProjectVariant` decisions. The `@auto-demo/polish` package is currently only a
package-role placeholder.

WES-152 is the first executable polish engine slice. It should generate one
deterministic baseline variant from a loaded project and its capture events. It
must not persist the variant, render previews, export media, generate style
batches, or add CLI/editor behavior.

## Goals

- Expose an async public API in `@auto-demo/polish` named
  `generateBaselinePolishVariant(project, options)`.
- Read the loaded project manifest and the project-owned events JSONL file.
- Produce a schema-valid `ProjectVariant` that references the existing project
  media and events paths.
- Use interaction metadata to identify action moments, idle gaps, click targets,
  cursor emphasis, click highlighting, and safe viewport focus.
- Preserve source duration unless leading or trailing idle time is clearly
  removable.
- Return structured warnings for incomplete or malformed metadata while still
  producing a usable baseline when the project has valid duration and paths.
- Keep output deterministic for identical project and event inputs.

## Non-Goals

- Saving generated variants into project files; WES-153 owns persistence.
- Generating multiple named variants or style presets.
- Rendering previews or final exports.
- Browser editor controls or manual edit behavior.
- LLM-based narration, captions, or rewrite choices.
- Changing WES-151 project schema fields.

## Approach Options

### Option A: Deterministic Heuristic Generator In `@auto-demo/polish`

The polish package reads WES-145 events and emits one conservative
`ProjectVariant`. Rules are explicit and testable: trim only clear idle gaps,
focus on bounded click coordinates when present, fall back to center framing when
metadata is incomplete, and return warnings instead of failing partial captures.

This is the selected approach because it satisfies WES-152 without creating
renderer/editor coupling or a premature preset system.

### Option B: Schema-Only Builder Around `ProjectVariant`

This would expose a helper that fills default variant fields without reading
events. It would be small, but it would not satisfy the acceptance criteria to
use interaction metadata for action moments, idle gaps, click targets, and
warnings.

### Option C: Style-Preset Engine Now

This would introduce multiple styles and generation parameters in the first
polish slice. It overlaps with Headless Variant Generation and the WES-166
style-preset decision, so it is too broad for WES-152.

## Public API

`@auto-demo/polish` will export:

```ts
type GenerateBaselinePolishOptions = {
  id?: string;
  displayName?: string;
};

type PolishWarningCode =
  | "events_file_unreadable"
  | "events_file_empty"
  | "malformed_event_line"
  | "missing_action_events"
  | "missing_click_coordinates"
  | "incomplete_capture_status";

type PolishWarning = {
  code: PolishWarningCode;
  message: string;
};

type BaselinePolishResult = {
  variant: ProjectVariant;
  warnings: PolishWarning[];
};

async function generateBaselinePolishVariant(
  project: LoadedProject,
  options?: GenerateBaselinePolishOptions,
): Promise<BaselinePolishResult>;
```

The function accepts a `LoadedProject` from `@auto-demo/project` so callers use a
project that has already passed schema and file validation. It reads
`join(project.projectDir, project.manifest.metadata.events.path)` as JSONL and
parses only the public WES-145 event fields needed by the generator.

## Generation Rules

The baseline generator creates deterministic output:

- `id`: `options.id` or `baseline-polish`.
- `displayName`: `options.displayName` or `Baseline Polish`.
- `source`: manifest primary media and events paths.
- `timeline`: the source duration by default.
- `timeline.startMs`: if the first meaningful action starts after 1000 ms, trim
  to `max(0, firstActionMs - 500)`.
- `timeline.endMs`: if the last meaningful action ends more than 1000 ms before
  source duration, trim to `min(durationMs, lastActionMs + 750)`.
- Meaningful actions are `click`, `fill`, `press`, `navigation`, and
  `agent_step` events with valid integer timestamps inside the source duration.
- `viewport.focus`: normalized coordinates from the first valid click
  coordinate and viewport dimensions, clamped to `[0, 1]`; otherwise center.
- `viewport.zoom`: `1.35` when a valid click focus exists, `1.15` when action
  events exist without click coordinates, otherwise `1`.
- `viewport.mode`: `contain`.
- `cursor`: visible with `spotlight` when actions exist, otherwise visible with
  `none`.
- `clicks`: `ring` when at least one click event exists, otherwise `none`.
- `captions` and `callouts`: empty arrays. Text generation is deferred.
- `style`: solid dark background, browser frame, 48 px padding, 16 px corner
  radius.
- `exportIntent`: MP4, demo quality, 16:9.

The result is validated by behavior tests against the WES-151 contract rather
than by asserting private helper behavior.

## Warning Behavior

Warnings are structured and non-secret. They do not echo raw event payloads,
URLs, typed values, local paths, or malformed line content.

- `events_file_unreadable`: events file cannot be read; produce a full-duration
  center-focused variant.
- `events_file_empty`: events file is empty or contains no parseable event
  objects; produce a full-duration center-focused variant.
- `malformed_event_line`: at least one JSONL line cannot be parsed or is not an
  event object; skip those lines and continue.
- `missing_action_events`: no meaningful action events are available.
- `missing_click_coordinates`: click events exist but none have usable numeric
  `data.x` and `data.y` with usable viewport dimensions.
- `incomplete_capture_status`: source capture status is `failed` or
  `interrupted`; generate from available metadata and keep the warning.

## Package Boundaries

`@auto-demo/polish` should depend on `@auto-demo/project` for `LoadedProject` and
`ProjectVariant` types. It may parse event objects locally rather than importing
private capture internals; the event JSONL contract is the cross-package
boundary. No new dependency should be added outside existing workspaces.

`@auto-demo/project` remains unchanged unless tests reveal a schema-contract
problem. WES-153 will decide how generated variants are appended and saved.

## Testing

Tests should be fixture-based and behavior-oriented:

- Simple click flow: trims clear leading/trailing idle, focuses on normalized
  click coordinates, enables cursor spotlight and click ring, and validates the
  variant with `validateProjectManifest()`.
- Idle-heavy capture: preserves duration when no action is present and returns
  `missing_action_events`.
- Missing element bounds or click coordinates: produces safe center framing,
  conservative zoom, click ring, and `missing_click_coordinates`.
- Diagnostic or incomplete capture metadata: still emits a variant with
  `incomplete_capture_status` and malformed-line warnings when applicable.
- Determinism: identical project and event inputs produce identical result
  objects.

Tests should not assert helper names, intermediate arrays, or parsing order
beyond user-visible output.

## Documentation

Update `packages/polish/README.md` and root `README.md` to reflect that
`@auto-demo/polish` can now generate a baseline variant while persistence is
handed to WES-153, and rendering, headless batches, and editor behavior remain
planned.

Update the Linear project map after completion with WES-152 evidence and set the
next task pointer to WES-153 unless completion-gate evidence shows a safer
alternative.

## Spec Self-Review

- Placeholder scan: no TBD/TODO placeholders remain.
- Consistency: the design uses `@auto-demo/polish` for generation and
  `@auto-demo/project` for the WES-151 variant contract, matching existing
  package boundaries.
- Scope: persistence is explicitly deferred to WES-153; rendering, presets, CLI,
  and editor behavior are also deferred, so the work fits one implementation
  cycle.
- Ambiguity: trimming, focus, zoom, warnings, defaults, and test behavior are
  concrete enough for behavior-first implementation.
