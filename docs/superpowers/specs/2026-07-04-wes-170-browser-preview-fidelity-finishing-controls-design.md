# WES-170 Browser Preview Fidelity And Finishing Controls Design

Date: 2026-07-04

## Linear Issue

- Issue: WES-170, "Open question: decide browser preview fidelity and MVP finishing controls"
- Project: Auto Demo Balanced MVP
- Milestone: Browser Editor

## Context

WES-157 created a review-only local browser editor that loads validated Auto Demo
projects and lists saved variants. WES-158 is the next Browser Editor
implementation issue, but it needs a product decision before adding preview and
finishing controls. Without that decision, WES-158 could either overbuild exact
export parity before the render/export milestone exists or underbuild the
schema-backed controls needed to finish a public demo.

The existing repo context gives the constraints:

- WES-151 owns schema-backed variant fields for `timeline`, `viewport`,
  `cursor`, `clicks`, `captions`, `callouts`, `style`, and `exportIntent`.
- WES-153 persists saved variants as `variants/<variant-id>.json` files and
  validates that manifest entries match saved variant files.
- WES-156 can save generated headless variants for editor review.
- WES-166 decided the MVP preset list is baseline-only and browser editor preset
  picking should be hidden until more approved presets exist.
- WES-167 has not yet chosen export presets or validation fixtures, so exact
  exported-media parity would add a new blocker to WES-158.

## Decision

WES-158 should target an approximate review UI, not exact exported-media parity.
The browser preview must be good enough for an operator to inspect timing,
framing intent, text overlays, and emphasis decisions before saving, but it is
not responsible for matching final rendered MP4 pixels.

WES-158 must expose schema-backed controls for:

- trim boundaries through `variant.timeline.startMs` and
  `variant.timeline.endMs`;
- viewport framing through `variant.viewport.mode`,
  `variant.viewport.focus.x`, `variant.viewport.focus.y`, and
  `variant.viewport.zoom`;
- captions and callouts through `variant.captions[]` and `variant.callouts[]`;
- cursor and click styling through `variant.cursor.visible`,
  `variant.cursor.emphasis`, and `variant.clicks.emphasis`;
- direct style fields through `variant.style.background`,
  `variant.style.backgroundColor`, `variant.style.frame`,
  `variant.style.padding`, and `variant.style.cornerRadius`.

WES-158 should display `variant.exportIntent` as read-only context unless the
implementation can edit the existing schema literals without introducing export
behavior. It must not add ad hoc fields outside `ProjectVariant`.

Preset or theme selection is not required for MVP. The editor may show direct
style controls for the currently loaded variant, but it must not expose a named
preset picker while the approved preset list contains only `baseline`.

## Approaches Considered

### Option A: Approximate Review UI With Schema-Backed Controls

The browser editor uses the project media and variant data to show a practical
review surface and edits only fields already validated by `@auto-demo/project`.
This lets WES-158 proceed without waiting for export rendering, while keeping
all saved changes reloadable and export-ready for later milestones.

This is the selected approach.

### Option B: Near-Final Visual Preview

The browser editor tries to make the preview visually close to the intended
export, including more faithful overlays, framing, cursor styling, and timing.
This may be useful after export rendering exists, but it risks designing browser
rendering behavior before WES-167 and WES-163 define the export contract.

### Option C: Exact Exported-Media Parity

The browser editor embeds or shares the final render pipeline so browser preview
and MP4 export match exactly. This is the strongest fidelity target, but it
turns WES-158 into an Export And Packaging issue and makes it depend on WES-167
and WES-163. That is too much for the Browser Editor MVP slice.

## WES-158 Acceptance Criteria Update

WES-158 should be updated to use this executable scope:

- Timeline preview shows the selected variant's source media with enough
  timeline context to review pacing and narrative flow. Approximate browser
  review fidelity is acceptable; exact exported-media parity is deferred.
- Trim controls edit `timeline.startMs` and `timeline.endMs` within the source
  capture duration.
- Viewport controls edit `viewport.mode`, `viewport.focus`, and `viewport.zoom`
  using the existing schema ranges.
- Caption and callout controls can add, edit, remove, and reset schema-backed
  timed text entries without writing fields outside `ProjectVariant`.
- Cursor and click controls edit `cursor.visible`, `cursor.emphasis`, and
  `clicks.emphasis`.
- Direct style controls may edit the current variant's schema-backed style
  fields, but named preset/theme pickers remain hidden for MVP.
- Control changes update local editor state predictably, can be reset before
  save, and prepare the edited variant for WES-159 persistence.
- Unsupported controls are hidden or clearly deferred.

## Deferrals

- Exact exported-media parity in the browser preview.
- Final MP4 rendering and export validation.
- Named preset or theme picker UI.
- Non-schema-backed editor fields.
- Multi-variant comparison, transition effects, audio, and advanced compositing.

## Testing And Validation

WES-170 itself is a product-decision/docs issue. Validation should confirm:

- the decision spec exists and has no unfinished-marker text;
- WES-158 in Linear reflects the updated acceptance criteria;
- the project map records WES-170 as the active decision and next WES-158
  readiness state;
- repository validation still passes after docs updates.

WES-158 implementation tests should be behavior-first. They should verify public
editor behavior and saved `ProjectVariant` output rather than private UI helper
mechanics.

## Spec Self-Review

- Unfinished-marker scan: no draft markers remain.
- Consistency: the decision follows WES-151 schema ownership, WES-157 editor
  scope, and WES-166 baseline-only preset guidance.
- Scope: this resolves product scope for WES-158 without implementing preview,
  editing, rendering, or export behavior.
- Ambiguity: preview fidelity, required controls, schema ownership, and explicit
  deferrals are concrete enough for WES-158 planning.
