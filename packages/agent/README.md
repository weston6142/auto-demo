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
expected artifacts, and failure handling once implemented. MCP transport, final
media export, and interactive/non-JSON workflow output remain follow-up work.

## Wrapper Artifacts

- Codex skill wrapper: `skills/codex-auto-demo/SKILL.md`
- Happy-path Codex transcript: `fixtures/codex-happy-path.md`
- Invalid-project Codex transcript: `fixtures/codex-invalid-project.md`
- Claude parity requirements: `claude-wrapper-parity.md`
