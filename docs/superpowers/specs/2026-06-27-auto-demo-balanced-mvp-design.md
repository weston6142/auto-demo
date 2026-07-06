# Auto Demo Balanced MVP Design

Date: 2026-06-27

## Summary

Auto Demo is an open-source, agent-first demo recorder and editor. Its primary workflow lets Codex, Claude, or another agent operate a browser or desktop app while Auto Demo captures the walkthrough, records interaction metadata, and generates polished demo variants without requiring the user to open an editor.

The editor is still part of the balanced MVP, but it is a finishing surface rather than the required path. Every capture produces a reusable Auto Demo project, not only a rendered MP4, so users can reopen the source project, inspect the captured timeline, regenerate variants, manually tune edits, and export again.

## Reference Products

The product borrows the polished output expectations of Screen Studio: automatic zooms, cursor/click emphasis, clean framing, captions, and fast export presets. It also takes open-source and browser-native lessons from tools such as Cap and Screenity: local ownership, project portability, share/export workflows, captions, annotation/editing controls, and approachable contribution structure.

Auto Demo should not start as a general-purpose video editor. The differentiator is automated demo production from an agent-driven walkthrough.

## Product Goals

- Let an agent capture a full product demo from a CLI, skill, or MCP-facing workflow.
- Generate polished edit variants automatically from the captured walkthrough.
- Allow users to export one or all variants without opening the editor.
- Preserve a reusable project format that can be reopened and edited later.
- Provide a local browser editor for manual finishing when auto variants are not enough.
- Initialize the work as a public open-source repository with a contribution-friendly structure.

## Non-Goals For The MVP

- Full replacement for professional nonlinear editors.
- Cloud hosting, account management, teams, billing, or collaboration.
- Native desktop app packaging.
- Advanced timeline compositing beyond what is needed for polished product demos.
- Perfect cross-platform capture support on day one if a narrower platform path is needed to prove the loop.

## Primary Workflows

### 1. Agent Capture To Auto Variants

1. User or agent starts a capture command.
2. Agent controls the target app or browser and performs the demo walkthrough.
3. Auto Demo records screen media and interaction metadata.
4. Capture ends and writes an Auto Demo project folder.
5. Auto polish generates one or more edit variants.
6. CLI outputs generated files and a manifest of variants.
7. User can keep the preferred variant, export all variants, or open the project in the editor.

This is the primary MVP path.

### 2. Project Reopen And Manual Finish

1. User runs a local editor command against an Auto Demo project.
2. Auto Demo serves a browser editor.
3. User reviews the timeline, variants, captions, zooms, trims, cursor effects, and theme.
4. User saves edits back to the project format.
5. User exports selected variants or a custom edited render.

This is the secondary MVP path.

### 3. Headless Variant Regeneration

1. User or agent runs a generation command against an existing project.
2. Auto Demo reads raw capture, metadata, transcript, and prior edit decisions.
3. Auto Demo creates new variants using selected presets or instructions.
4. User receives updated preview/render files without opening the editor.

This keeps agent workflows first-class after initial capture.

## Auto Demo Project Format

Each capture creates a portable project directory. The MVP starts with an `autodemo.project.json` manifest at the project root plus subdirectories for raw media, metadata, variants, previews, and exports. A packaged single-file project format can come later after the directory schema stabilizes.

Required contents:

- Raw screen recording.
- Capture manifest with tool versions, platform, viewport, duration, and source paths.
- Interaction timeline: cursor moves, clicks, typed text, navigation events, waits, and agent step markers.
- Transcript or caption source when available.
- Edit decision list containing trims, zooms, pans, cursor effects, captions, overlays, and theme choices.
- Variant definitions, including preset name, generation parameters, and output files.
- Export manifest with rendered artifact paths, format, dimensions, duration, and creation time.

The project format is the contract between capture runtime, auto polish, browser editor, and agent integrations. MP4 export is an output, not the source of truth.

## Milestones

### 1. Public Repo And Project Foundation

Initialize the repository publicly with license, README, package layout, development scripts, contribution guidance, and a clear architecture skeleton.

### 2. Capture Runtime

Implement the CLI capture path that records screen media and structured interaction metadata while an agent performs a walkthrough.

### 3. Demo Project Format

Define and implement the portable Auto Demo project schema, manifest files, validation, loading, and saving.

### 4. Auto Polish Engine

Convert raw capture metadata into polished edit decisions: zooms, pans, cursor emphasis, click highlights, trims, pacing, captions, backgrounds, frames, and export presets.

### 5. Headless Variant Generation

Generate multiple polished variants from a capture or project without opening the editor. Support saving one selected variant or all variants.

### 6. Browser Editor

Serve a local browser editor for project review and finishing: timeline, zoom/crop tuning, trim controls, captions, cursor/click styling, theme controls, variant preview, and save/export.

### 7. Agent Integrations

Expose the core workflow to agents. Start with a CLI and one production Codex skill wrapper, with Claude wrapper parity documented as follow-up scope. WES-162 later deferred MCP from the MVP; reopen it only after export and packaging evidence or a host requirement shows the CLI plus Codex wrapper path is insufficient.

### 8. Export And Packaging

Export rendered demos in practical formats, with MP4 first. Package the CLI/editor so contributors and users can install and run the balanced MVP predictably.

## Architecture

The MVP should use separable modules with explicit contracts:

- `capture`: starts/stops recording and emits raw media plus event metadata.
- `project`: owns schema, validation, path layout, load/save, and migration.
- `polish`: creates edit decisions from capture metadata and instructions.
- `variants`: creates and stores named variant definitions and rendered outputs.
- `render`: turns project plus edit decisions into MP4 or other output formats.
- `editor`: local web server and browser UI for manual finishing.
- `agent`: CLI and skill wrapper around capture and generation commands, with
  future MCP transport deferred until the MVP workflow proves it needs a typed
  server surface.

The CLI should call these modules rather than embedding workflow logic directly. The editor should read and write the same project format used by headless generation.

## Data Flow

```text
agent walkthrough
  -> capture runtime
  -> raw media + interaction metadata
  -> Auto Demo project
  -> auto polish engine
  -> variant definitions
  -> headless render/export
  -> optional browser editor
  -> saved project edits
  -> final exports
```

## CLI Surface

Initial command shape can be refined during planning, but the MVP needs these capabilities:

- `autodemo init` to prepare a project or repo context.
- `autodemo capture` to record a walkthrough.
- `autodemo generate` to create variants from a capture or existing project.
- `autodemo export` to render selected or all variants.
- `autodemo open` to launch the local editor for a project.
- `autodemo validate` to check project integrity.

The CLI must support non-interactive operation so agents can use it reliably.

## Error Handling

- Capture failures should preserve partial media and metadata when possible.
- Project writes should be atomic enough to avoid corrupting the source project.
- Variant generation should report failed variants independently so one bad preset does not discard all outputs.
- Renderer errors should include the variant name, source project path, and non-secret diagnostic details.
- Editor save conflicts should be detected through project revision or manifest timestamps.

## Testing Strategy

Tests should focus on behavior and user-facing outputs rather than internal implementation details:

- Project schema validation and migration behavior.
- Capture manifest creation from representative event streams.
- Auto polish output for known walkthrough metadata.
- Headless variant generation creates expected project entries and export files.
- CLI commands work in non-interactive mode.
- Editor load/save preserves project data and edit decisions.

Visual/render verification should use small deterministic fixtures where possible.

## Open Decisions

- Whether the first capture runtime targets macOS only or supports multiple platforms immediately.
- Whether the initial browser capture path should use Playwright/CDP, OS-level screen capture, or both.
- WES-162 answered the MCP question by deferring it from the MVP until export,
  packaging, or host-integration evidence shows a need beyond stable CLI and
  Codex wrapper handoff.
- Exact project file extension and folder layout.
- Initial rendering engine choice.

## Success Criteria

The balanced MVP is successful when an agent can capture a walkthrough, generate multiple polished variants headlessly, export files without opening the editor, and later reopen the same project in a local browser editor for manual finishing.
