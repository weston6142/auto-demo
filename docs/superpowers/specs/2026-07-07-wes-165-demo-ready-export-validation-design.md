# WES-165 Demo-Ready Export Validation Design

Date: 2026-07-07

## Linear Issue

- Issue: WES-165, "Validate demo-ready export bundle and operator instructions"
- Project: Auto Demo Balanced MVP
- Milestone: Export And Packaging

## Context

WES-165 is the final non-tracker Export And Packaging issue. Its blockers are
complete:

- WES-167 selected the `mp4-demo` export preset and canonical
  `fixtures/export/basic-saved-variant` validation fixture.
- WES-163 implemented `@auto-demo/render` and `autodemo export --project
<project> --json`, writing `exports/<variant-id>.mp4` and
  `exports/<variant-id>.render.json`.
- WES-168 selected a clean local checkout run path instead of registry or
  standalone distribution work.
- WES-164 added the repo-root `npm run autodemo -- <subcommand...>` wrapper and
  setup documentation.

The current docs already name `fixtures/export/basic-saved-variant`, but the
fixture directory is not present in the repo. WES-165 should turn that named
validation path into an executable operator workflow without expanding into
marketing launch materials, hosted packaging, or new rendering fidelity.

## Goals

- Add the repo-owned canonical validation fixture at
  `fixtures/export/basic-saved-variant`.
- Provide a repeatable command that validates the clean-checkout export path by
  copying the fixture to a temporary working directory, running
  `npm run autodemo -- export --project <copy> --json`, and inspecting the
  expected MP4 plus render summary.
- Document concise operator instructions that name setup steps, validation
  command, expected files, expected JSON fields, and known MVP limitations.
- Add behavior-oriented tests that verify public docs and fixture shape without
  requiring real ffmpeg execution during default `npm run validate`.
- Record WES-165 completion evidence and, if complete, close the Export And
  Packaging tracker WES-139.

## Design Options

### Option A: Fixture Plus Explicit Demo Validation Script

Add the fixture and a root script such as `npm run validate:demo-ready` backed by
a small Node script. The script copies the fixture to a temp directory before
exporting so repository fixtures stay clean. It checks that the CLI JSON reports
success, the MP4 exists and is non-empty, the render summary exists, and
`ffprobe` can inspect the MP4.

Pros:

- Matches WES-165's "prove the MVP can produce a shareable demo artifact"
  acceptance criteria.
- Keeps default unit tests fast and deterministic.
- Gives operators a single command to rerun after clean setup.

Cons:

- Requires `ffmpeg` and `ffprobe` for the real validation command.
- Adds one small maintenance script.

### Option B: Documentation-Only Checklist

Document the command sequence without adding fixture files or a runnable smoke
script.

Pros:

- Very small change.
- Avoids adding generated media to the repository.

Cons:

- Leaves the named fixture path broken.
- Does not prove the final MVP export path from a clean checkout.
- Provides weak completion evidence for WES-165.

### Option C: Full End-To-End Capture Through Export

Run browser capture, import, generation/editor save, and export in one smoke
workflow.

Pros:

- Closest to a real user journey.

Cons:

- Reopens earlier milestone scope and depends on browser automation setup.
- Slower and more brittle than WES-165 needs.
- WES-165 already has an approved canonical saved-variant fixture from WES-167.

## Selected Design

Use Option A.

Create `fixtures/export/basic-saved-variant` as a complete, synthetic, non-secret
Auto Demo project:

```text
fixtures/export/basic-saved-variant/
  autodemo.project.json
  raw/capture.webm
  metadata/events.jsonl
  metadata/capture.manifest.json
  variants/baseline-polish.json
  exports/.gitkeep
```

The fixture represents "Checkout flow demo" at
`https://example.com/checkout`, with a completed 1280x720 browser capture and
one saved `baseline-polish` variant using `exportIntent: { format: "mp4",
quality: "demo", aspectRatio: "16:9" }`. `raw/capture.webm` is a tiny generated
synthetic media file, not a real product recording. The fixture must contain no
secret values.

Add `scripts/validate-demo-ready-export.mjs` and root script
`validate:demo-ready`. The script should:

1. Check that `ffmpeg` and `ffprobe` are available on `PATH`, failing with a
   clear operator message if they are missing.
2. Copy `fixtures/export/basic-saved-variant` to a temporary directory.
3. Run `npm run autodemo -- export --project <temp-project> --json` from the repo
   root.
4. Parse stdout as JSON and require `ok: true`, `variantId:
"baseline-polish"`, `preset.key: "mp4-demo"`, and paths ending in
   `exports/baseline-polish.mp4` and
   `exports/baseline-polish.render.json`.
5. Verify both files exist, the MP4 is non-empty, the summary JSON records the
   same preset and variant, and `ffprobe` can inspect the MP4 container.
6. Print a concise non-secret success summary with the temporary bundle path.

The script intentionally writes exports only in the temporary copy. It should not
modify the committed fixture during normal validation.

## Operator Documentation

Add a "Demo-Ready Export Validation" section to the root README and a matching
short section to `packages/render/README.md`. The docs should say:

- Setup from a clean local checkout is `npm install`, `npm run build`, `npm run
setup:browser`; `ffmpeg` and `ffprobe` must be on `PATH` for this validation.
- Run `npm run validate:demo-ready`.
- The script copies `fixtures/export/basic-saved-variant` before export.
- Expected bundle files are `exports/baseline-polish.mp4` and
  `exports/baseline-polish.render.json`.
- The bundle also includes source metadata, saved variant metadata, the render
  summary, and operator instructions in the docs.
- Known MVP limitations remain: synthetic fixture content, local-only checkout
  packaging, MP4-only export, no audio track, no rendered captions/callouts/cursor
  overlays, approximate browser preview rather than exact export parity, and no
  hosted or registry distribution.

## Testing Strategy

Default validation tests should be host-independent:

- Add a render package fixture/docs test that loads
  `fixtures/export/basic-saved-variant` through `@auto-demo/project` and verifies
  the public fixture shape: project name, source URL, saved `baseline-polish`
  variant, `mp4-demo` export intent, raw media path, metadata path, and empty
  committed `exports/` directory.
- Extend docs tests to require `npm run validate:demo-ready`, the clean setup
  steps, expected artifact paths, MP4 inspection, and known limitations.
- Add a script behavior test only if it can inject commands or avoid real ffmpeg;
  otherwise rely on manual/local smoke evidence from running
  `npm run validate:demo-ready` after implementation.

Implementation must follow TDD: write the fixture/docs behavior tests first,
watch them fail because the fixture and command are missing, then add the fixture,
script, and docs.

Run focused tests first, then `npm run validate`, then run
`npm run validate:demo-ready` locally where `ffmpeg` and `ffprobe` are
available.

## Explicit Deferrals

- Marketing sample creation and curated public launch assets.
- Hosted rendering or batch rendering infrastructure.
- Registry publication, Homebrew, native installers, or standalone artifacts.
- Non-MP4 exports.
- Audio tracks and high-fidelity rendered overlays.
- Changing the project schema, browser editor behavior, agent wrapper behavior,
  or capture runtime.

## Spec Self-Review

- Placeholder scan: no TBD, TODO, or incomplete markers remain.
- Consistency: the design follows WES-167's fixture decision, WES-163's export
  output contract, and WES-164's repo-root wrapper contract.
- Scope: the work is one validation fixture, one operator validation command,
  and documentation/tests. It does not reopen renderer or packaging scope.
- Ambiguity: the fixture path, command name, expected artifacts, verification
  checks, limitations, and deferrals are explicit.
