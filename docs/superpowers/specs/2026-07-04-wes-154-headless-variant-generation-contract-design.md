# WES-154 Headless Variant Generation Contract Design

Date: 2026-07-04

## Linear Issue

- Issue: WES-154, "Headless variant generation CLI and API contract"
- Project: Auto Demo Balanced MVP
- Milestone: Headless Variant Generation

## Context

WES-151 defined the MVP `ProjectVariant` schema. WES-152 added
`generateBaselinePolishVariant(project, options)` in `@auto-demo/polish`.
WES-153 added `savePolishVariant(project, variant)` in `@auto-demo/project`.
WES-154 starts the Headless Variant Generation milestone by exposing a stable
headless command and programmatic API that agents can call without the browser
editor.

The existing CLI reserves `autodemo generate` but still reports it as
unimplemented. The first contract should use existing project loading and polish
generation behavior rather than parsing project files inside the CLI.

## Goals

- Implement a first headless generation command:
  `autodemo generate --project <project-dir-or-manifest> --dry-run --json`.
- Expose a package API that loads a valid project and returns a structured
  summary for the generated baseline variant.
- Use `loadProject()` from `@auto-demo/project` and
  `generateBaselinePolishVariant()` from `@auto-demo/polish`.
- Return machine-readable JSON with project references, generated variant id and
  display name, style key, dry-run mode, save status, validation errors, and
  non-secret polish warnings.
- Accept only the MVP-supported style key `baseline` and count `1`.
- Fail unsupported save/output modes, style keys, counts, and missing project
  input with structured JSON errors when `--json` is requested.
- Keep tests behavior-focused around CLI output and public API results.

## Non-Goals

- Saving generated variants from the CLI. WES-156 owns selected/all save modes
  and run summary persistence.
- Generating multiple named variants or real style preset batches. WES-155 and
  WES-166 own that scope.
- Rendering previews or MP4 exports.
- Browser editor behavior.
- Direct capture-bundle input. The first command requires a validated Auto Demo
  project.
- Human-readable non-JSON output beyond a clear error requiring `--json`.

## Approach Options

### Option A: Dry-Run Baseline Contract In `@auto-demo/polish` And CLI

Add a small public API in `@auto-demo/polish` that loads a project path, validates
supported generation options, generates one baseline variant, and returns a
summary without saving. The CLI delegates to that API and prints JSON.

This is the selected approach because it satisfies WES-154 while preserving the
milestone split: WES-155 can expand generation to multiple deterministic named
variants, and WES-156 can add selected/all save modes using `savePolishVariant()`.

### Option B: CLI-Only Implementation

The CLI could call `loadProject()` and `generateBaselinePolishVariant()` directly
without a new API. This would make the command work but would not provide the
programmatic contract requested by WES-154.

### Option C: Implement Save And Batch Modes Now

The CLI could support `--save`, `--count`, and multiple style keys immediately.
That would blur WES-154 with WES-155 and WES-156 and force a style-preset product
decision before WES-166 is resolved.

## Public API

`@auto-demo/polish` will export:

```ts
type HeadlessVariantGenerationOptions = {
  projectPath: string;
  dryRun: true;
  json: true;
  count?: number;
  style?: "baseline";
};

type HeadlessVariantSaveStatus = {
  mode: "dry-run";
  saved: false;
};

type HeadlessVariantSummary = {
  id: string;
  displayName: string;
  style: "baseline";
  source: {
    projectPath: string;
    manifestPath: string;
    mediaPath: string;
    eventsPath: string;
  };
  save: HeadlessVariantSaveStatus;
  warnings: PolishWarning[];
};

type HeadlessVariantGenerationResult =
  | {
      ok: true;
      project: {
        projectDir: string;
        manifestPath: string;
        name: string;
      };
      requested: {
        count: 1;
        style: "baseline";
        dryRun: true;
      };
      variants: HeadlessVariantSummary[];
      errors: [];
    }
  | {
      ok: false;
      project: {
        projectPath: string;
      };
      requested: {
        count: number;
        style: string;
        dryRun: boolean;
      };
      variants: [];
      errors: HeadlessVariantGenerationError[];
    };

async function generateHeadlessVariants(
  options: HeadlessVariantGenerationOptions,
): Promise<HeadlessVariantGenerationResult>;
```

Validation errors are structured and non-secret:

- `missing_project_path`
- `unsupported_output_mode`
- `unsupported_save_mode`
- `unsupported_variant_count`
- `unsupported_style`
- `invalid_project`

`invalid_project` wraps project validation failures by code and message without
echoing raw manifest content, local file contents, URLs with credentials, or
typed event values.

## CLI Contract

Supported command:

```bash
autodemo generate --project <project-dir-or-manifest> --dry-run --json
```

Optional flags:

```bash
--count 1
--style baseline
```

The command prints exactly one JSON object to stdout and exits `0` when
generation succeeds. Stderr is empty.

Unsupported or invalid input prints the same result shape with `ok: false` to
stdout when `--json` is present and exits `1`. Non-JSON invocations exit `1`
with stderr explaining that WES-154 only supports `--json` output.

`--save`, `--mode save`, counts other than `1`, and style keys other than
`baseline` are rejected as unsupported contract inputs rather than silently
ignored.

## JSON Shape

Successful dry-run output:

```json
{
  "ok": true,
  "project": {
    "projectDir": "/project",
    "manifestPath": "/project/autodemo.project.json",
    "name": "Demo"
  },
  "requested": {
    "count": 1,
    "style": "baseline",
    "dryRun": true
  },
  "variants": [
    {
      "id": "baseline-polish",
      "displayName": "Baseline Polish",
      "style": "baseline",
      "source": {
        "projectPath": "/project",
        "manifestPath": "/project/autodemo.project.json",
        "mediaPath": "raw/capture.webm",
        "eventsPath": "metadata/events.jsonl"
      },
      "save": {
        "mode": "dry-run",
        "saved": false
      },
      "warnings": []
    }
  ],
  "errors": []
}
```

The first API does not include the full variant payload in the CLI summary. It
returns identifiers and source references that are stable enough for agents to
decide what to do next while keeping the command output compact. Downstream
WES-155/WES-156 can add batch/run-summary files that include full payloads when
needed.

## Testing

Behavior-first tests will cover:

- API success against a valid loaded project fixture returns one baseline dry-run
  summary with no saved files added to the project.
- CLI success prints JSON with the generated id, project references, dry-run save
  status, and empty stderr.
- Missing `--project` returns a structured `missing_project_path` JSON error.
- Invalid project input returns `invalid_project` with project validation error
  codes.
- Unsupported style, count, and save mode return structured JSON errors.
- Non-JSON invocation returns a clear stderr message rather than mixed output.

Tests will assert public outputs, filesystem effects, and result shapes. They
will not assert private helper names or internal parsing steps.

## Documentation

Update the root README and `packages/polish/README.md` to document the first
headless generation contract, its dry-run limitation, and the explicit deferrals
to WES-155/WES-156.

Update the Linear project map after completion with WES-154 evidence and the
next-task pointer to WES-155 unless completion-gate evidence indicates a safer
alternative.

## Spec Self-Review

- Placeholder scan: no TBD or TODO placeholders remain.
- Consistency: the API lives in `@auto-demo/polish`, project loading remains in
  `@auto-demo/project`, and CLI routing delegates rather than duplicating
  project parsing.
- Scope: this is a single dry-run baseline contract; save modes, batches,
  style-preset decisions, rendering, and editor behavior are explicitly
  deferred to later issues.
- Ambiguity: supported flags, unsupported flags, JSON shape, error codes, and
  testing boundaries are concrete enough for implementation.
