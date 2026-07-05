# WES-159 Save Browser Edits Design

Date: 2026-07-05

## Linear Issue

- Issue: WES-159, "Save browser edits as project variants for export handoff"
- Project: Auto Demo Balanced MVP
- Milestone: Browser Editor

## Context

WES-157 added the local browser editor server and project loading. WES-158 added
schema-backed draft editing in the browser, but the edited JSON remains local
state only. WES-153 and WES-156 already established the durable project variant
contract: saved variants live in `variants/<variant-id>.json`, the project
manifest remains the authoritative index, and saved projects must reload and
validate after each write.

WES-159 should turn the browser draft into durable project data while keeping
the scope local and file-based. Export rendering, agent workflows, hosted sync,
and multi-project sessions remain later work.

## Selected Approach

Add an editor-owned `POST /api/variants` endpoint that accepts one complete
`ProjectVariant` draft plus a save mode:

- `update`: replace an existing variant with the same id.
- `copy`: save a named copy with a supplied new id and display name.

The server validates the draft through `@auto-demo/project`, writes through a
project-owned persistence API, reloads the project, and returns a concise JSON
summary. The browser shell gains save controls for update and named-copy flows,
then refreshes from `/api/project` after a successful save so the saved variant
is discoverable immediately.

## Alternatives Considered

### Option A: Editor Save Endpoint Using Project Persistence

This is the selected approach. The editor owns HTTP request/response behavior,
while project layout, schema validation, and atomic file writes remain in
`@auto-demo/project`. It matches WES-153 and keeps export handoff data in the
approved project format.

### Option B: Browser Writes Manifest JSON Directly

The browser could send a full manifest or patch and let the editor write files.
That would duplicate project validation rules in the editor and make it easier
to corrupt existing variants on malformed input.

### Option C: Save Only To Browser Storage

Local storage would preserve drafts across refreshes, but it would not satisfy
the export handoff requirement because downstream tools only read project files.

## Behavior Requirements

- `@auto-demo/project` exposes a persistence helper that can upsert one
  schema-valid `ProjectVariant`, writing `variants/<id>.json`, updating
  `autodemo.project.json`, and revalidating the project.
- Existing generated-save behavior from `savePolishVariant()` keeps append-only
  semantics for duplicate ids. Browser update/copy behavior uses the new
  upsert helper instead of weakening `savePolishVariant()`.
- `POST /api/variants` accepts JSON only. Malformed JSON, missing mode,
  invalid mode, invalid variant shape, duplicate copy id, missing update target,
  and invalid copy id/display name return `400` or `422` with stable
  non-secret error messages.
- Save failures never echo raw manifest JSON, raw event lines, source query
  strings beyond existing sanitized project summaries, local secret-bearing
  paths, or typed event values.
- On success, the endpoint returns:

```json
{
  "ok": true,
  "mode": "update",
  "variantId": "baseline-polish",
  "variantPath": "variants/baseline-polish.json",
  "validation": { "ok": true },
  "message": "Saved baseline-polish."
}
```

- Updating an existing variant overwrites that variant file and manifest entry
  only after candidate validation passes.
- Saving a named copy derives the target file from the new slug id, applies the
  supplied display name, rejects duplicate ids, and leaves the original variant
  unchanged.
- After a successful save, `GET /api/project` returns the saved variant data and
  the browser UI refreshes to the saved variant id.
- Existing whitelisted project-file serving remains read-only and unchanged.

## Browser UI

The current WES-158 editor shell keeps local draft behavior. WES-159 adds a
compact save section near the draft controls:

- a primary save command for updating the selected variant;
- a named-copy command with fields for copy id and display name;
- a success/failure message area with project validation errors;
- no export, render, cloud, or agent command controls.

The UI should not introduce a large frontend framework. The current static
HTML/script approach remains sufficient for the MVP slice and keeps tests
focused on public HTTP behavior plus visible shell controls.

## Testing Strategy

Tests stay behavior-first:

- Project persistence tests cover replacing a saved variant, preserving other
  variants, rejecting missing update targets, rejecting duplicate copy ids, and
  reloading the saved project.
- Editor server tests cover `POST /api/variants` success for update and copy,
  JSON validation failures, duplicate copy rejection, and immediate
  discoverability through `GET /api/project`.
- Shell tests assert visible save controls and exercise the served script's
  public save flow through a fake `fetch` boundary.
- Focused tests run before broader package validation.

Tests should assert saved files, public JSON responses, and reload behavior,
not private helper names or internal write order.

## Deferrals

- MP4 rendering and export bundle generation.
- Agent/MCP handoff commands.
- Hosted editor, multi-user sync, or browser file picker.
- Autosave and draft recovery across browser reloads.
- Preset/theme expansion beyond current schema fields.

## Spec Self-Review

- Placeholder scan: no TBD or TODO markers remain.
- Consistency: persistence remains project-owned; editor owns HTTP and browser
  behavior.
- Scope: the work is one Browser Editor persistence slice and does not include
  export rendering or agent workflows.
- Ambiguity: update versus named-copy behavior, validation failures, response
  shape, and deferrals are explicit.
