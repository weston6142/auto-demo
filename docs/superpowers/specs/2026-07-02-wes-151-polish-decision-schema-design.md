# WES-151 Polish Decision Schema Design

Date: 2026-07-02

## Linear Issue

- Issue: WES-151, "Polish decision schema and variant data model"
- Project: Auto Demo Balanced MVP
- Milestone: Auto Polish Engine

## Context

Demo Project Format is complete. `@auto-demo/project` owns schema version 1,
imports capture bundles into the normalized project layout, validates required
files, loads projects, and saves manifests atomically. The current schema keeps
`variants`, `previews`, and `exports` present but empty.

WES-151 is the first Auto Polish Engine slice. It should define the project data
contract for generated polish variants without generating decisions, rendering
media, or persisting variants through a new workflow command.

## Goals

- Let `autodemo.project.json` represent MVP polish variants in `variants`.
- Keep raw capture media and metadata immutable; variants reference project-owned
  source artifacts by portable relative paths.
- Validate variant identifiers, source references, timeline ranges, viewport
  framing decisions, cursor/click emphasis, captions/text callouts,
  background/frame settings, and export intent metadata.
- Reject impossible time ranges and decision timestamps outside the source
  capture duration.
- Keep diagnostics structured and non-secret.
- Document which variant fields are owned by this MVP slice and which downstream
  milestones remain responsible for generation, preview, editing, and export.

## Non-Goals

- Generate polish decisions from capture events.
- Add a `@auto-demo/polish` generator implementation.
- Add CLI commands for creating or saving variants.
- Render preview media or exported MP4 files.
- Define non-empty `previews` or `exports` entries.
- Add browser editor UI for modifying variants.
- Introduce schema version 2 or migrations.

## Approved Approach

Extend schema version 1 in `@auto-demo/project` so `variants` may contain
validated MVP variant entries while `previews` and `exports` remain empty arrays.
This keeps the project manifest as the source of truth and gives WES-152 and
WES-153 a stable contract to generate and persist decisions later.

Two alternatives were considered:

- Create a separate `@auto-demo/polish` decision schema now. This would split the
  manifest contract across packages before persistence exists and force the
  project validator to trust external shape assumptions.
- Store variants in separate files under `variants/`. This is useful later when
  variant data grows, but WES-151 can stay smaller by validating manifest entries
  first and leaving file-backed variants to a later schema change.

## Manifest Shape

Schema version 1 keeps the existing top-level shape and changes `variants` from
empty-only to an array of `ProjectVariant` entries:

```json
{
  "variants": [
    {
      "id": "checkout-focused",
      "displayName": "Checkout Focused",
      "source": {
        "mediaPath": "raw/capture.webm",
        "eventsPath": "metadata/events.jsonl"
      },
      "timeline": {
        "startMs": 0,
        "endMs": 2500
      },
      "viewport": {
        "mode": "contain",
        "focus": { "x": 0.5, "y": 0.5 },
        "zoom": 1.25
      },
      "cursor": {
        "visible": true,
        "emphasis": "spotlight"
      },
      "clicks": {
        "emphasis": "ring"
      },
      "captions": [
        {
          "id": "intro",
          "text": "Open the checkout flow",
          "startMs": 250,
          "endMs": 1200
        }
      ],
      "callouts": [
        {
          "id": "pay-button",
          "text": "Complete payment",
          "startMs": 1400,
          "endMs": 2200,
          "anchor": { "x": 0.72, "y": 0.64 }
        }
      ],
      "style": {
        "background": "solid",
        "backgroundColor": "#0f172a",
        "frame": "browser",
        "padding": 48,
        "cornerRadius": 16
      },
      "exportIntent": {
        "format": "mp4",
        "quality": "demo",
        "aspectRatio": "16:9"
      }
    }
  ]
}
```

`previews` and `exports` remain empty in schema v1 until Browser Editor, Headless
Variant Generation, and Export And Packaging own those artifacts.

## MVP-Owned Fields

WES-151 owns validation for:

- `id`: lowercase URL-safe identifier, unique within the manifest.
- `displayName`: non-empty user-facing name.
- `source.mediaPath`: must equal the manifest primary media path.
- `source.eventsPath`: must equal the manifest events metadata path.
- `timeline.startMs` and `timeline.endMs`: integer millisecond range with
  `0 <= startMs < endMs <= sourceCapture.timing.durationMs`.
- `viewport.mode`: `contain` or `cover`.
- `viewport.focus`: normalized `x`/`y` coordinates between `0` and `1`.
- `viewport.zoom`: finite number from `1` through `4`.
- `cursor.visible`: boolean.
- `cursor.emphasis`: `none`, `spotlight`, or `hide-idle`.
- `clicks.emphasis`: `none`, `ring`, or `pulse`.
- `captions` and `callouts`: arrays with unique ids, non-empty text, and ranges
  within the variant timeline.
- `callouts.anchor`: normalized `x`/`y` coordinates.
- `style`: background, frame, padding, and corner radius decisions.
- `exportIntent`: desired downstream format, quality, and aspect ratio.

Downstream milestones own the semantics beyond validation:

- WES-152 decides how to generate these fields from capture events.
- WES-153 decides how generated variants are saved into project files/workflows.
- Headless Variant Generation decides preset batches and summaries.
- Browser Editor decides UI editing behavior and preview fidelity.
- Export And Packaging decides rendered artifacts and export manifests.

## Validation Behavior

`validateProjectManifest()` continues to accumulate structured errors. Expected
invalid variant input returns `invalid_project_manifest` or `unsafe_project_path`
without echoing user text, raw URLs, typed values, or arbitrary field names.

Validation rejects:

- duplicate variant ids;
- ids outside the lowercase slug format;
- source paths that do not match existing project media/event paths;
- absolute paths, Windows paths, traversal paths, colon-bearing paths, and empty
  paths;
- timeline ranges with negative, fractional, equal, reversed, or
  capture-duration-exceeding bounds;
- caption or callout ranges outside the containing variant timeline;
- invalid normalized coordinates;
- unsupported literals for viewport, cursor, click, style, and export decisions;
- non-empty `previews` or `exports`;
- unknown fields at any owned level.

`validateProject()` keeps checking required source capture files. It does not
require rendered preview or export files for variants because no downstream
milestone has created them yet.

## Testing

Tests stay behavior-oriented:

- A manifest with a representative MVP variant validates successfully.
- Duplicate/invalid ids produce structured validation errors.
- Unsafe or mismatched variant source paths are rejected.
- Invalid timeline ranges and out-of-bounds caption/callout ranges are rejected.
- Invalid style/export literals are rejected.
- A saved project with variants round-trips through `saveProject()` and
  `validateProject()` without requiring preview/export files. WES-153 later
  added the saved-variant file requirement for manifest variants.

Tests should not assert private helper names or parsing order.

## Documentation

Update `README.md` package/status text to note that `@auto-demo/project` can now
validate polish variant definitions while generation and rendering remain
planned. Update the Linear project map with WES-151 evidence and the next-task
pointer after completion.

## Spec Self-Review

- Placeholder scan: no TBD/TODO placeholders remain.
- Consistency: the design extends schema version 1 in `@auto-demo/project`, which
  matches WES-151 acceptance criteria and the existing project package boundary.
- Scope: generation, persistence workflows, previews, exports, and editor UI are
  explicitly deferred so this is one implementation cycle.
- Ambiguity: MVP-owned fields and downstream-owned fields are separated, and
  validation rules are concrete enough to implement with behavior-first tests.
