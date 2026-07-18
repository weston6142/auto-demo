# Claude Wrapper Parity Requirements

WES-161 ships the production MVP Codex wrapper. A future Claude wrapper should
match the same workflow semantics so both hosts produce comparable handoff
artifacts without duplicating Auto Demo business logic.

## Invocation Instructions

The Claude wrapper should invoke the same WES-160 command as the Codex wrapper:

In a clean local checkout, the same logical command is reached with
`npm run autodemo -- agent run ...`. If wrapper diagnosis is needed, the
workspace-scoped fallback is
`npm --workspace @auto-demo/cli run autodemo -- agent run ...`.

```bash
autodemo agent run --project <project-dir-or-manifest> --json
```

It should pass through `--variant <variant-id>`, `--generate baseline --save
baseline-polish`, `--generate baseline --save all`, `--source-variant
<variant-id>`, and `--open-editor` only under the same conditions documented for
Codex.

## Required Inputs

- Auto Demo project directory or direct `autodemo.project.json` path.
- Optional saved variant id.
- Optional baseline generation request and source variant id.
- Optional local editor handoff request with host and port overrides.

The wrapper should not require schema details, raw capture metadata, direct
variant-file parsing, credentials, hosted services, or MCP transport.

## Command Sequence

1. Confirm the project path exists or report that the path is missing.
2. Run `autodemo agent run --project <project-dir-or-manifest> --json` with the
   selected options.
3. Parse the JSON response.
4. On success, report project manifest path, selected variant id, variant
   artifact path, warnings, and next-step hints.
5. When `--open-editor` is used, keep the command process alive while the
   operator uses the returned local editor URL.

## Expected Artifacts

- Project manifest path, usually `autodemo.project.json`.
- Selected variant artifact, usually `variants/<variant-id>.json`.
- Optional editor URL with `long-lived-local-server` lifecycle.
- Non-secret warnings and next-step hints.

The wrapper should treat `export-variant` as an export handoff hint. An MP4 file
exists only after a separate successful `autodemo export --project
<project-dir-or-manifest> --json [--variant <variant-id>]` run.

## Failure Handling

Expected failures should be reported from `errors[].code` and
`errors[].message`. The Claude wrapper should preserve the same stable codes as
Codex, including `missing_project_path`, `invalid_project`, `missing_variant`,
`variant_not_found`, `unsupported_agent_command`, `unsupported_agent_output`,
`unknown_agent_argument`, `unsupported_generation`, `generation_failed`, and
`editor_unavailable`.

The wrapper should avoid echoing raw manifests, event metadata, source query
strings, typed values, credentials, or secret-bearing local paths.

## Walkthrough Review Parity

A future Claude host must use evidence-backed discovery compilation as the only
new-plan intake. Plan-file dry-run validation accepts existing
`deterministic-v1` artifacts for migration compatibility and rejects discovery
plans, which require fresh-context replay. Review, refinement, approval, and
execution retain both supported artifact lifecycles. New plans must come from
evidence-backed discovery compilation.
Existing best-guess artifacts still require an explicit bypass approval, but
discovery plans never use the best-guess bypass.

A future Claude wrapper should use the same review, refinement, and approval
contract as Codex. It should invoke `autodemo agent review`, translate user
answers into structured refinement arrays for `autodemo agent refine`, present
the automatically revalidated plan again, and call `autodemo agent approve`
only after explicit user confirmation.

The wrapper must preserve all blockers, avoid direct plan JSON edits, and never
pass `--allow-best-guess-bypass` unless the user explicitly accepts bypassing
browser validation. It should persist the approved structured artifact for
WES-179 rather than treating conversation text as approval evidence.

## Goal-Driven Risk-Tiered Discovery Parity

A future Claude host should match Codex-hosted risk-tiered discovery when the
user provides a target URL and natural-language goal. It must resolve `safe`,
`public-browse`, `disposable`, or `yolo` before browser or network activity and
ask one focused question when the prompt is missing, conflicting, or ambiguous.
YOLO means the unrestricted Auto Demo tier; generic autonomous intent does not
select it. Host, platform, repository, and system instructions still apply.

Safe and freshly acknowledged exact-origin disposable discovery and replay are
currently implemented. Public-browse and YOLO must return
`risk_tier_not_supported` before browsing until their downstream policies land;
the host must not silently downgrade or approximate them. A supported tier uses
Auto Demo's structured observation and action interfaces rather than selectors,
raw DOM, or a parallel browser path. The host preserves failed exploration
outside the selected path, compiles the completed session, and runs bounded
replay and repair with at most two completed direct-child sessions.

Discovery, replay, and recording each use a fresh isolated context with the same
selected tier freshly established. No disposable authority, policy permit,
browser state, repair authority, or runtime value carries across phases. Only a
successful replay can reach transcript-safe review, and review and explicit
approval remain mandatory in every tier. After approval, the wrapper uses the
existing deterministic execute and handoff path only when the selected tier can
be freshly established for capture. Claude production wrapper remains follow-up
scope; this document defines parity but does not ship that host implementation,
a discovery CLI, or the downstream public-browse and YOLO policies.

## Walkthrough Execution Parity

A Claude wrapper should invoke
`autodemo agent execute --plan <approved-plan-json-file> --inputs <runtime-inputs-json-file> --out <capture-directory> --json`
only after approval verification. Runtime bindings must contain non-secret demo
data and must not be repeated in conversation output. The wrapper should report
the stable result, `natural-v1` pacing profile, and completed or failed capture
bundle without inspecting raw metadata. After successful execution it should
persist the result and invoke
`autodemo agent handoff --execution <execution-result-json-file> --project <new-project-directory> --name <project-name> --json`.
Handoff does not overwrite non-empty projects; generation failure preserves the
imported project so the wrapper can resume diagnosis without re-recording. The
wrapper reports the `baseline-polish` artifact and structured
`autodemo open --project` and `autodemo export --project` next steps without
starting either side effect automatically.

## Out Of Scope

- Claude production wrapper implementation.
- MCP transport.
- Hosted services.
- marketplace distribution.
- final export implementation inside the wrapper; use `autodemo export`
  separately for local MP4 rendering.
- demo-ready export bundle validation.
- Schema reimplementation or direct project mutation outside the WES-160
  command.
