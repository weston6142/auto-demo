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
autodemo agent run --project projects/checkout --json --open-editor
```

Successful results include:

- selected project path, manifest path, and project name;
- selected variant id, `variants/<id>.json` path, and whether it was selected or
  generated;
- artifact paths for the project manifest and variant file;
- stable non-secret warnings;
- next-step hints such as `open-editor` and `export-variant`;
- optional editor URL when `--open-editor` is used.

Expected failures return `ok: false` with stable error codes such as
`missing_project_path`, `unsupported_agent_output`, `invalid_project`,
`missing_variant`, `variant_not_found`, `unsupported_generation`,
`generation_failed`, and `editor_unavailable`.

Codex and Claude skill wrappers, MCP transport, final media export, and
interactive/non-JSON workflow output remain follow-up work.
