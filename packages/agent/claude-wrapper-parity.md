# Claude Wrapper Parity Requirements

WES-161 ships the production MVP Codex wrapper. A future Claude wrapper should
match the same workflow semantics so both hosts produce comparable handoff
artifacts without duplicating Auto Demo business logic.

## Invocation Instructions

The Claude wrapper should invoke the same WES-160 command as the Codex wrapper:

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

The wrapper should treat `export-variant` as a future export handoff hint, not as
evidence that an MP4 file exists.

## Failure Handling

Expected failures should be reported from `errors[].code` and
`errors[].message`. The Claude wrapper should preserve the same stable codes as
Codex, including `missing_project_path`, `invalid_project`, `missing_variant`,
`variant_not_found`, `unsupported_generation`, `generation_failed`, and
`editor_unavailable`.

The wrapper should avoid echoing raw manifests, event metadata, source query
strings, typed values, credentials, or secret-bearing local paths.

## Out Of Scope

- Claude production wrapper implementation.
- MCP transport.
- Hosted services.
- marketplace distribution.
- final export implementation.
- Schema reimplementation or direct project mutation outside the WES-160
  command.
