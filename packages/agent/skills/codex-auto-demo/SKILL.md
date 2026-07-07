---
name: codex-auto-demo
description: Use when Codex needs to run the Auto Demo agent workflow for a validated project, select or generate a saved variant, open the local editor handoff, or prepare a local MP4 export handoff.
---

# Auto Demo Codex Workflow

Use this skill when working in an Auto Demo repository or project directory and
the task is to prepare a demo variant through the agent-facing workflow.

## Prerequisites

- Confirm the operator has an Auto Demo project directory or direct
  `autodemo.project.json` path.
- If the task starts from a browser recording instead of a project, create or
  import the project through the existing Auto Demo capture and project commands
  before using this wrapper.
- Run commands from a checkout where the `autodemo` CLI is available. In a
  clean local checkout, use `npm run autodemo -- <subcommand...>`. If wrapper
  diagnosis is needed, the workspace-scoped fallback is
  `npm --workspace @auto-demo/cli run autodemo -- <subcommand...>`.
- Treat `autodemo agent run --project <project-dir-or-manifest> --json` as the
  source of truth. Do not inspect or rewrite Auto Demo project internals to
  duplicate selection, generation, validation, or editor behavior.

## Primary Command

```bash
autodemo agent run --project <project-dir-or-manifest> --json
```

The command validates the project, selects a saved variant, and prints one JSON
handoff summary for agent logs. Parse the JSON result and report the selected
variant id, variant path, project manifest path, warnings, and next-step hints.

## Variant Selection

When the user names a saved variant, pass it through directly:

```bash
autodemo agent run --project <project-dir-or-manifest> --json --variant <variant-id>
```

If no variant is named, let the workflow select the first saved variant. Do not
read `autodemo.project.json` to implement your own selection rules.

## Baseline Generation

When the project has no saved variant, or the user asks for a fresh baseline
agent handoff, generate through the WES-160 workflow contract:

```bash
autodemo agent run --project <project-dir-or-manifest> --json --generate baseline --save baseline-polish
```

Use `--save all` when the user wants every generated MVP variant saved:

```bash
autodemo agent run --project <project-dir-or-manifest> --json --generate baseline --save all
```

You may add `--source-variant <variant-id>` only with `--generate baseline`.
The MVP agent contract is baseline-only. Do not request custom generated ids,
theme presets, non-JSON output, or dry-run output through this wrapper.

## Browser Editor Handoff

When the user wants to review or adjust the saved variant in the local browser
editor, add `--open-editor`:

```bash
autodemo agent run --project <project-dir-or-manifest> --json --open-editor
```

The JSON summary includes `editor.url` and
`editor.lifecycle: "long-lived-local-server"`. Keep that process alive while
the operator uses the editor. `--host`, `--port`, and `--no-browser` may be
passed through when needed:

```bash
autodemo agent run --project <project-dir-or-manifest> --json --open-editor --host 127.0.0.1 --port 0 --no-browser
```

## Failure Handling

Expected failures exit non-zero and still print JSON when `--json` is present.
Read `errors[].code` and `errors[].message`, then report the stable error code
and non-secret message. Common codes include `missing_project_path`,
`unsupported_agent_command`, `unsupported_agent_output`,
`unknown_agent_argument`, `invalid_project`, `missing_variant`,
`variant_not_found`, `unsupported_generation`, `generation_failed`, and
`editor_unavailable`.

Do not paste secrets, raw event metadata, typed values, credentials, or full
manifest contents into task reports. Use the command output's stable fields.

## Export Boundary

The current wrapper stops after a saved variant and optional editor handoff.
If JSON `nextSteps` includes `export-variant`, run the export command only when
the user asks for an MP4 artifact:

```bash
autodemo export --project <project-dir-or-manifest> --json [--variant <variant-id>] [--preset mp4-demo]
```

Report the returned output path and render summary path. Demo-ready export
bundles remain outside this wrapper.

## Out Of Scope

- Claude production wrapper implementation.
- MCP transport or server behavior, deferred from the MVP by WES-162.
- Hosted editor or cloud handoff services.
- Marketplace distribution or local skill installation automation.
- Demo-ready export bundle validation.
