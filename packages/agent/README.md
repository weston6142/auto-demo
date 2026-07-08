# @auto-demo/agent

Provides agent-facing workflow helpers around the CLI and project contracts.

## Agent Workflow

`runAgentWorkflow()` is the WES-160 noninteractive handoff contract for coding
agents. It loads a validated Auto Demo project, selects an existing saved
variant or saves a generated baseline variant, and returns one JSON-ready summary
for agent logs and downstream export work.

```ts
import { runAgentWorkflow } from "@auto-demo/agent";

const result = await runAgentWorkflow({
  projectPath: "projects/checkout",
  json: true,
  variantId: "baseline-polish",
});
```

The CLI exposes the same contract:

In a clean local checkout, run these logical subcommands through
`npm run autodemo --`. If wrapper diagnosis is needed, the workspace-scoped
fallback is `npm --workspace @auto-demo/cli run autodemo --`.

```bash
autodemo agent run --project projects/checkout --json
autodemo agent run --project projects/checkout --json --variant baseline-polish
autodemo agent run --project projects/checkout --json --generate baseline --source-variant source-baseline --save all
autodemo agent run --project projects/checkout --json --open-editor [--host 127.0.0.1] [--port 0] [--no-browser]
```

For WES-160, generated agent saves are baseline-only and accept only
`--save baseline-polish` or `--save all`. Custom generated variant ids remain
outside the MVP agent contract. `--save` and `--source-variant` are valid only
with `--generate baseline`.

Successful results include:

- selected project path, manifest path, and project name;
- selected variant id, `variants/<id>.json` path, and whether it was selected or
  generated;
- artifact paths for the project manifest and variant file;
- stable non-secret warnings;
- next-step hints such as `open-editor` and `export-variant`;
- optional editor URL and `long-lived-local-server` lifecycle marker when
  `--open-editor` is used.

`--open-editor` starts the same local editor used by `autodemo open`, prints the
handoff URL in JSON, and intentionally keeps the editor server alive until the
process is stopped. `--host` and `--port` override the editor bind address when
`--open-editor` is used; `--port 0` keeps OS port assignment. `--no-browser` is
accepted for compatibility and does not auto-launch a browser.

Expected failures return `ok: false` with stable error codes such as
`missing_project_path`, `unsupported_agent_command`,
`unsupported_agent_output`, `unknown_agent_argument`, `invalid_project`,
`missing_variant`, `variant_not_found`, `unsupported_generation`,
`generation_failed`, and `editor_unavailable`. The CLI exits `0` after writing a
successful JSON handoff summary and `1` for expected validation, generation, or
handoff failures.

The WES-169 MVP host decision treats a Codex production wrapper as
acceptance-critical for the first demo. Claude wrapper parity remains documented
follow-up scope: it should match the same invocation inputs, command sequence,
expected artifacts, and failure handling once implemented. MCP transport,
interactive/non-JSON workflow output, and Claude production wrapper execution
remain follow-up work. Demo-ready export validation is covered by
`npm run validate:demo-ready`, and saved variants can be rendered separately
through `autodemo export`.

## Walkthrough Plan Intake

`createWalkthroughPlan()` is the WES-181 intake contract for user-described
browser demo scripts. It accepts a target URL, natural-language script text, and
a mode of `validate-first` or `best-guess`, then returns deterministic
JSON-ready plan data for later validation, review, execution, and project
handoff.

```ts
import { createWalkthroughPlan } from "@auto-demo/agent";

const result = createWalkthroughPlan({
  targetUrl: "https://example.com/signup",
  script: "Go to the signup page. Click Get started. Verify pricing appears.",
  mode: "validate-first",
});
```

The CLI exposes the same first contract:

```bash
autodemo agent plan --url https://example.com/signup --script "Click Get started" --mode validate-first --json
```

The deterministic parser recognizes simple browser-oriented steps such as
navigate, click, type, wait, and assert. Ambiguous instructions are preserved as
unresolved questions instead of being treated as executable actions. Public type
step summaries redact typed values, and expected failures use stable error codes
such as `missing_target_url`, `invalid_target_url`, `missing_script`,
`unsupported_plan_mode`, `unsupported_agent_output`, and
`unknown_agent_argument`.

WES-181 intentionally does not validate page state, approve plans, execute
browser actions, automate credentials, operate arbitrary OS apps, perform
destructive production actions, record captures, or create projects. Those
behaviors remain assigned to the downstream script workflow issues.

## Wrapper Artifacts

- Codex skill wrapper: `skills/codex-auto-demo/SKILL.md`
- Happy-path Codex transcript: `fixtures/codex-happy-path.md`
- Invalid-project Codex transcript: `fixtures/codex-invalid-project.md`
- Claude parity requirements: `claude-wrapper-parity.md`

## MCP Decision

MCP is deferred from the MVP. The accepted MVP integration path is the CLI plus
Codex wrapper, using
`autodemo agent run --project <project-dir-or-manifest> --json` as the stable
noninteractive handoff. This keeps Agent Integrations focused on the executable
workflow while Export And Packaging owns rendered artifacts and packaging.

Future MCP work should be opened when the workflow needs persistent
project/session discovery, editor handoff lifecycle status or stop controls,
artifact inspection across generated outputs, host integration evidence shows
repeated CLI orchestration mistakes, or a host requires MCP instead of shell
commands.

The minimum future MCP capability set is project discovery and validation, an
agent workflow run tool for selecting or generating a saved variant, local
editor launch handoff with explicit lifecycle behavior, artifact inspection for
project/variant/export paths, and stable non-secret error responses. MCP does
not introduce a new project schema, new variant-selection rules, hosted
services, or final MP4 export behavior; local MP4 export stays CLI-owned through
`autodemo export`.
