# WES-158 Timeline Preview And Finishing Controls Design

Date: 2026-07-05

## Linear Issue

- Issue: WES-158, "Timeline preview and finishing controls for MVP variants"
- Project: Auto Demo Balanced MVP
- Milestone: Browser Editor

## Context

WES-157 created a local review-only editor that loads a valid Auto Demo project
and lists saved variants. WES-170 resolved the product decision for this issue:
the MVP browser editor should provide approximate review fidelity, not exact
exported-media parity, and all controls must edit existing `ProjectVariant`
schema fields only.

The first implementation should stay local to `@auto-demo/editor`. WES-159 will
persist edited variants later, so WES-158 needs a predictable in-browser draft
editing surface with reset behavior and a public JSON summary that downstream
save work can reuse.

## Selected Approach

Build one static editor shell backed by the existing `GET /api/project` summary.
The server will expose full schema-backed variant decisions in
`EditorProjectVariantSummary`, and the browser shell will keep edits in local
state only. Selecting a variant shows:

- the source media path and timing context;
- an approximate preview band with trim start/end, viewport focus, captions,
  callouts, cursor/click emphasis, and style values;
- controls for every WES-170-required schema field;
- a reset command that restores the selected variant to the loaded project
  value;
- an edited-variant JSON panel that contains only `ProjectVariant` fields.

The editor must not add a named preset picker, final render controls, export
parity claims, browser auto-launch, or persistence. It may show export intent as
read-only context because WES-158 does not implement export behavior.

## Alternatives Considered

### Option A: Browser-Only Draft Editing

The current server remains read-only, and the browser shell performs local draft
edits against the loaded variant JSON. This is the selected approach because it
delivers review and finishing ergonomics without inventing the persistence API
that WES-159 owns.

### Option B: Add A Save Endpoint Now

The editor could accept edits through a server endpoint and rewrite project
files. This would collapse WES-158 and WES-159, increasing risk around file
validation and variant identity before the save handoff is designed.

### Option C: Build A Renderer-Quality Preview

The browser shell could attempt to match final MP4 output. That conflicts with
WES-170: exact export parity is deferred until export presets and rendering are
owned by the Export And Packaging milestone.

## Behavior Requirements

- `loadEditorProject()` returns each variant with the full schema-backed fields
  needed for preview and controls: source, timeline, viewport, cursor, clicks,
  captions, callouts, style, and export intent.
- `GET /` serves an editor shell that includes visible control labels for trim,
  viewport, captions, callouts, cursor, clicks, and style.
- The shell renders a media preview using the project primary media path. The
  preview is approximate and must not claim final export parity.
- Trim controls clamp `timeline.startMs` and `timeline.endMs` inside source
  duration and keep `startMs < endMs`.
- Viewport controls edit `mode`, normalized focus `x`/`y`, and `zoom` in the
  schema range `1..4`.
- Caption and callout controls support add, edit, remove, and reset in local
  state. Generated ids must be lowercase slugs.
- Cursor and click controls edit the existing enum values only.
- Style controls edit background, background color, frame, padding, and corner
  radius within project validation ranges.
- The edited JSON panel contains a complete `ProjectVariant` object and no
  fields outside the schema.
- Empty or invalid projects keep the WES-157 behavior.

## Testing Strategy

Tests should stay behavior-first:

- `loadEditorProject()` includes full variant decisions in its public summary.
- The served editor shell contains the expected user-facing controls and does
  not expose a named preset picker.
- The project API response gives the browser enough media and variant data to
  prepare a schema-backed edited variant.

DOM event-level tests are not required for this slice because the editor shell
is static HTML served by Node. Behavior will be verified through public server
responses and visible shell text rather than private helper functions.

## Deferrals

- Saving edited variants to disk.
- Final MP4 rendering and exact export parity.
- Named preset or theme picker UI.
- Browser auto-launch.
- Hosted deployment.
- Multi-variant comparison, transitions, audio, and advanced compositing.

## Spec Self-Review

- Placeholder scan: no unfinished markers remain.
- Consistency: the design follows WES-170 and uses only current
  `ProjectVariant` schema fields.
- Scope: the work is one Browser Editor slice and leaves persistence to
  WES-159.
- Ambiguity: validation ranges, visible controls, reset behavior, and deferrals
  are explicit.
