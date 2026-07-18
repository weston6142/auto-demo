---
name: codex-auto-demo
description: Use when Codex needs to prepare or record an Auto Demo project, discover a browser walkthrough from a natural-language goal, run the agent workflow, review or approve a plan, select or generate a saved variant, open the editor, or prepare an MP4 export.
---

# Auto Demo Codex Workflow

Use this skill when working in an Auto Demo repository or project directory and
the task is to discover, approve, record, edit, or export a browser demo through
the agent-facing workflow.

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
- Treat `autodemo agent plan --url <target-url> --script <script-text> --json`
  as the source of truth for script intake. Use the validate, review, refine, and
  approve commands for later plan lifecycle changes. Do not invent execution,
  capture, or project-handoff behavior in this wrapper.

## Primary Command

```bash
autodemo agent run --project <project-dir-or-manifest> --json
```

The command validates the project, selects a saved variant, and prints one JSON
handoff summary for agent logs. Parse the JSON result and report the selected
variant id, variant path, project manifest path, warnings, and next-step hints.

## Goal-Driven YOLO Discovery

When the user supplies a target URL plus a natural-language goal and opts into
YOLO or autonomous discovery, use the public `@auto-demo/agent` library
contracts directly. There is no discovery CLI, and YOLO discovery is not legacy
`best-guess` planning.

1. Start safe exact-origin discovery unless the user freshly identifies an
   `environment-is-disposable` scope and exact allowed origins. Credential,
   payment, upload, unsafe-origin, download, and WebSocket policy denials are a
   hard policy boundary: stop and report the sanitized result instead of
   repairing around it.
2. Own an isolated Playwright page and create
   `createPolicyEnforcedPlaywrightDiscoveryRehearsalController(...)`. Read only
   its bounded observations. Choose one structured action with declared
   expectations per `perform()` call. Do not use selectors, raw DOM, arbitrary
   page evaluation, or a parallel browser-action path.
3. Preserve failed exploration as evidence. Use explicit back, refresh, retry,
   or alternative-target actions when the evidence supports them, and complete
   only one continuous successful selected path. Resolve named runtime bindings
   in memory with non-secret demo data.
4. Compile with `compileDiscoverySessionToWalkthroughPlan()`, then call
   `replayAndRepairDiscoveryPlan()` in fresh isolated browsers. Supply only
   completed direct-child sessions for repair, at most two. Never edit a
   compiled plan or repair a hard policy boundary.
5. Present the returned transcript-safe review. Only an `ok: true`,
   replay-validated, blocker-free plan may reach explicit approval. The initial
   YOLO request is not approval, and a discovery plan cannot use the best-guess
   approval bypass.
6. After the user explicitly approves the displayed plan, use the existing
   `agent approve`, `agent execute`, and `agent handoff` commands below. A
   disposable acknowledgement, policy permit, discovery page, repair authority,
   or runtime value never carries into final capture.

Keep sessions, replay results, validated and approved plans, execution results,
and runtime inputs in separate local artifacts. Never paste raw observations,
DOM, selectors, screenshots, request data, manifest contents, or runtime values
into conversation. See `fixtures/codex-yolo-discovery-approval.md` for the full
host transcript.

## Walkthrough Plan Intake

When the user provides a target browser URL and natural-language demo script,
create a plan before validation or capture work:

```bash
autodemo agent plan --url <target-url> --script <script-text> [--mode validate-first|best-guess] --json
```

Parse the JSON result and report the plan id, state, resolved step actions,
unresolved questions, warnings, and approval/execution placeholders. Public type
step summaries redact typed values. `--mode` defaults to `validate-first`;
`best-guess` adds a review warning. This command does not validate page state,
approve plans, execute browser actions, record captures, automate credentials,
perform destructive production actions, or create Auto Demo projects.

## Walkthrough Review, Refinement, And Approval

For `validate-first`, follow this sequence:

```text
plan -> validate -> review -> conversational clarification -> refine -> review -> explicit confirmation -> approve
```

Validate and review an existing plan artifact:

```bash
autodemo agent validate --plan <plan-json-file> --json
autodemo agent review --plan <plan-json-file> --json
```

Explain the review conversationally, including every blocker, assumption,
warning, and ordered public step. Ask one focused clarification at a time. Do
not edit walkthrough plan JSON directly. Convert the user's answer into a
structured refinement array and invoke:

- Do not edit walkthrough plan JSON directly.

```bash
autodemo agent refine --plan <plan-json-file> --refinements <refinements-json-file> --json
```

`validate-first` refinement automatically revalidates. Present the returned
review again. Ask for explicit approval immediately before invoking:

```bash
autodemo agent approve --plan <plan-json-file> --json
```

Persist the returned approved plan artifact for WES-179. Any refinement clears
prior validation and approval. Do not claim approval based on conversation text
alone, omit blockers, invoke approval before confirmation, or edit approval
fields directly.

An unvalidated best-guess plan can be approved only after the user explicitly
accepts bypassing browser validation. In that case, and only in that case, pass
`--allow-best-guess-bypass`. Never add that flag silently.

## Approved Walkthrough Execution

After approval, execute the returned artifact without editing its JSON:

```bash
autodemo agent execute --plan <approved-plan-json-file> --inputs <runtime-inputs-json-file> --out <capture-directory> --json
```

Omit `--inputs` when the plan has no type steps. Runtime values must be
non-secret demo data because the browser video displays them. Never paste those
values into the conversation, command arguments, plan, diagnostics, metadata,
or task report. Execute mode verifies approval, has no unapproved shortcut,
uses strict target matching and `natural-v1` pacing, and preserves a failed
capture bundle after mid-script failure.

Write successful execute JSON to a file, then create the project:

```bash
autodemo agent handoff --execution <execution-result-json-file> --project <new-project-directory> --name <project-name> --json
```

The handoff accepts only completed execution evidence, verifies the capture
manifest, media, and metadata, imports a fresh project, and saves
`baseline-polish`. It does not overwrite a non-empty project directory. If
generation fails, preserve the imported project and resume investigation without
re-recording. Report the returned structured next steps for
`autodemo open --project <new-project-directory>` and
`autodemo export --project <new-project-directory> --variant baseline-polish --json`;
do not start the editor or export unless the user asks.

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
and non-secret message. Common workflow codes include `missing_project_path`,
`unsupported_agent_command`, `unsupported_agent_output`,
`unknown_agent_argument`, `invalid_project`, `missing_variant`,
`variant_not_found`, `unsupported_generation`, `generation_failed`, and
`editor_unavailable`. Common planning codes include `missing_target_url`,
`invalid_target_url`, `missing_script`, `unsupported_plan_mode`, and
`unknown_agent_argument`. Review workflow codes include `invalid_plan`,
`invalid_refinement`, `unknown_refinement_step`, `stale_validation_blocker`,
`unknown_validation_candidate`, `candidate_not_persistable`,
`unsupported_replacement_action`, `plan_not_approvable`,
`best_guess_bypass_required`, and `stale_approval`.

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
- Credentials automation, arbitrary OS apps, and destructive production actions
  for walkthrough plans.
