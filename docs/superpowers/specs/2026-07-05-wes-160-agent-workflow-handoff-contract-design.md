# WES-160 Agent Workflow Handoff Contract Design

Date: 2026-07-05

## Linear Issue

- Issue: WES-160, "Agent-facing workflow CLI and handoff contract"
- Project: Auto Demo Balanced MVP
- Milestone: Agent Integrations

## Context

The earlier milestones already provide the reusable pieces agents need:

- `@auto-demo/project` validates and loads project manifests and persisted
  `variants/<id>.json` files.
- `@auto-demo/polish` generates baseline-only headless variant summaries and
  can save one selected variant or all generated variants.
- `autodemo generate --project <project> --json --save <id|all>` exposes that
  headless generation contract.
- `autodemo open --project <project> [--host <host>] [--port <port>]` starts
  the local browser editor.
- Browser-edited variants are saved back to project files through WES-159.

WES-160 should not redefine project, variant, editor, or export structures. Its
job is to give coding agents one stable noninteractive workflow surface that can
select or generate a saved variant, optionally prepare an editor handoff, and
emit a concise machine-readable summary for agent logs and later export work.

## Selected Approach

Add an `@auto-demo/agent` workflow API and expose it through a new CLI command:

```text
autodemo agent run --project <project-dir-or-manifest> --json
autodemo agent run --project <project-dir-or-manifest> --variant <variant-id> --json
autodemo agent run --project <project-dir-or-manifest> --generate baseline --source-variant <variant-id> --save <baseline-polish|all> --json
autodemo agent run --project <project-dir-or-manifest> --open-editor --json [--host 127.0.0.1] [--port 0] [--no-browser]
```

The agent package owns the workflow contract and calls existing package APIs:
`loadProject()` for project and variant validation, `generateHeadlessVariants()`
for optional baseline generation/save, and an injected editor starter for
optional editor handoff. The CLI owns argument parsing and JSON printing only.

The successful JSON shape is stable and intentionally compact:

```json
{
  "ok": true,
  "project": {
    "projectPath": "projects/checkout",
    "manifestPath": "projects/checkout/autodemo.project.json",
    "name": "Checkout flow demo"
  },
  "variant": {
    "id": "baseline-polish",
    "path": "variants/baseline-polish.json",
    "source": "selected"
  },
  "artifacts": [
    { "kind": "project-manifest", "path": "projects/checkout/autodemo.project.json" },
    { "kind": "variant", "path": "variants/baseline-polish.json" }
  ],
  "warnings": [],
  "nextSteps": ["open-editor", "export-variant"]
}
```

If `--open-editor` is supplied, the summary also includes:

```json
{
  "editor": {
    "opened": true,
    "lifecycle": "long-lived-local-server",
    "url": "http://127.0.0.1:4321/"
  }
}
```

This editor handoff matches `autodemo open`: after JSON is printed, the local
editor server remains alive until the process is stopped so the returned URL
stays usable.

Failures return `ok: false`, the selected project path if known, and stable
non-secret error objects. The command exits `1` for expected workflow failures.

## Alternatives Considered

### Option A: Agent Package Plus `autodemo agent run`

This is the selected approach. It creates a real package contract for WES-161's
Codex skill wrapper and host-neutral parity documentation while keeping the CLI
command small and testable. The workflow summary can be consumed by Codex,
Claude, and future wrappers without parsing human-oriented command output.

### Option B: Extend `autodemo generate`

`generate` already owns headless variant generation and save summaries, but
folding editor handoff and selected existing variants into it would blur its
responsibility. Agents need an orchestration layer across generate, project
validation, editor handoff, and later export.

### Option C: Documentation-Only Contract

Documentation alone would satisfy part of the issue, but WES-161 would still
need to infer behavior from lower-level commands and duplicate parsing. A small
implemented contract is the better integration boundary.

## Behavior Requirements

- `@auto-demo/agent` exports a `runAgentWorkflow(options, dependencies?)`
  function and JSON-ready result types.
- The workflow requires a project path. It accepts either a project directory or
  direct `autodemo.project.json` path through `loadProject()`.
- With no generation flags, the workflow selects `--variant <id>` when supplied;
  otherwise it selects the first manifest variant. Missing variants return a
  structured `missing_variant` or `variant_not_found` error.
- `--generate baseline --save <baseline-polish|all>` delegates to
  `generateHeadlessVariants()` with JSON mode, baseline-only styles, and
  optional `--source-variant <variant-id>`. It then reloads the project and
  selects the saved variant. If `--save all` is used, the selected variant is the
  first saved variant reported by the generation summary.
- Arbitrary generated variant ids are outside the WES-160 agent MVP; use the
  polish generator directly for lower-level save behavior.
- Dry-run generation is not part of the agent workflow. Agents can continue to
  call `autodemo generate --dry-run --json` directly when they need planning
  output.
- The workflow never writes new project, variant, preview, export, or editor
  state except through `generateHeadlessVariants()` save mode.
- `--open-editor` starts the existing local editor after project/variant
  selection succeeds. It does not auto-open a browser. The editor URL is
  included in JSON output, and the server intentionally remains alive until the
  process is stopped. `--host` and `--port` override the editor bind address
  when editor handoff is requested; `--no-browser` is accepted for compatibility
  and does not change browser launch behavior.
- The summary includes selected project, selected variant id, produced artifact
  paths, warnings, and next-step hints suitable for noninteractive agent logs.
- Expected failures use deterministic error codes and do not echo raw manifest
  JSON, event lines, source query strings, typed values, secret-bearing local
  paths, or credentials.
- `autodemo agent run` requires `--json` for WES-160. Non-JSON output, export
  rendering, and provider-specific wrappers remain deferred.
- `autodemo --help` lists the `agent` command, and `autodemo agent run --help`
  documents required inputs, optional flags, exit codes, and deferrals.

## Error Codes

- `missing_project_path`: no project path was supplied.
- `unsupported_agent_command`: an unknown `autodemo agent` subcommand was used.
- `unsupported_agent_output`: `--json` was omitted.
- `unknown_agent_argument`: an unrecognized or malformed option was supplied.
- `invalid_project`: `loadProject()` rejected the project.
- `missing_variant`: no saved variant exists and generation was not requested.
- `variant_not_found`: the requested or generated variant was not found after
  loading the project.
- `unsupported_generation`: the generation request is outside the WES-160
  baseline-only contract.
- `generation_failed`: `generateHeadlessVariants()` returned a structured
  failure.
- `editor_unavailable`: editor startup failed after a valid project/variant was
  selected.

## Testing Strategy

Tests stay behavior-first:

- Agent package tests call `runAgentWorkflow()` against filesystem fixtures and
  assert JSON-ready summaries, selected variants, artifact paths, warnings,
  next-step hints, and structured errors.
- CLI tests call `runCliAsync()` and assert public exit codes, stdout JSON, and
  stderr behavior for `autodemo agent run`.
- Tests use dependency injection for generation and editor startup where needed,
  but assertions focus on visible workflow outputs instead of private call
  order.
- Focused `@auto-demo/agent` and `@auto-demo/cli` tests run before package
  typecheck/build and full `npm run validate`.

## Documentation

- `packages/agent/README.md` documents the workflow API, CLI examples, JSON
  summary fields, exit codes, and deferrals.
- Root `README.md` adds a short "Agent workflow" section that points agents to
  `autodemo agent run --project <project> --json`.
- The project map records WES-160 selection and completion evidence.

## Deferrals

- Final MP4 rendering and export bundle generation.
- Codex skill wrapper files and Claude parity documentation, owned by WES-161
  after the WES-169 host-scope decision.
- MCP transport or server behavior, owned by WES-162 after the MVP decision.
- Agent-driven capture orchestration beyond the existing `autodemo capture`
  command.
- Non-JSON or interactive agent workflow output.
- Hosted editor, browser auto-launch, or cloud handoff.

## Spec Self-Review

- Placeholder scan: no TBD or TODO markers remain.
- Consistency: `@auto-demo/agent` owns orchestration; project, polish, and editor
  packages keep their existing responsibilities.
- Scope: the work is one Agent Integrations contract slice and excludes export,
  skills, MCP, and hosted flows.
- Ambiguity: command names, required inputs, output shape, errors, tests, and
  deferrals are explicit.
