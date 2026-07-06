# WES-162 MCP MVP Decision Design

Date: 2026-07-06

## Linear Issue

- Issue: WES-162, "Open question: decide whether MCP is required for MVP"
- Project: Auto Demo Balanced MVP
- Milestone: Agent Integrations

## Context

The Agent Integrations milestone now has a stable noninteractive path:

- WES-160 added `autodemo agent run --project <project-dir-or-manifest> --json`
  for selecting or generating a saved variant and returning a machine-readable
  handoff summary.
- WES-169 selected one production Codex wrapper as the MVP host target and
  documented Claude parity as follow-up scope.
- WES-161 shipped the repository-owned Codex skill wrapper, happy-path and
  invalid-project transcript fixtures, and Claude parity documentation.

The original balanced MVP design says to add MCP after command and project
contracts stabilize, unless early integration requires long-running tool state.
At this point, the command and wrapper path is sufficient for the first
executable MVP demo, while MP4 export and local packaging still remain in later
milestones.

## Selected Decision

MCP is deferred from the MVP Agent Integrations milestone.

The MVP should close Agent Integrations with the existing CLI-backed JSON
workflow and Codex wrapper artifacts. MCP should become follow-up work after the
export and packaging path can prove which agent-host capabilities need a server
transport instead of shelling out to stable commands.

## Rationale

The current MVP agent path already gives Codex a deterministic way to validate a
project, select or generate a saved variant, optionally start the local editor
handoff, and report non-secret artifacts. Adding MCP now would not unlock a
missing product behavior for the first demo. It would add transport lifecycle,
tool schema, host registration, capability discovery, process management, and
possibly authentication concerns before the export milestone defines the final
artifact boundary.

Deferring MCP keeps the MVP focused on the executable loop that already exists:
project in, variant handoff out, with export work next. The decision does not
cancel MCP. It records the evidence needed to justify MCP later and the minimum
capabilities a future MCP issue must cover if the CLI/skill workflow proves
insufficient.

## Future MCP Inclusion Criteria

Create MCP implementation work only when at least one of these is true:

- Agent hosts need persistent project/session discovery across multiple tool
  calls instead of a single command invocation.
- The editor handoff needs a long-running server lifecycle that agents must
  inspect, stop, or resume through structured tools.
- Export packaging produces multiple artifacts that agents need to inspect
  incrementally without parsing command output or project files.
- Host integration tests show that the CLI plus Codex skill wrapper causes
  repeated orchestration mistakes that a typed tool surface would prevent.
- A target host requires MCP to expose local capabilities that cannot be
  expressed reliably as shell commands.

## Minimum Future MCP Capability Set

If MCP is added later, the first implementation should stay thin and wrap the
same package and CLI contracts instead of replacing them:

- Project discovery and validation for a project directory or
  `autodemo.project.json` path.
- Agent workflow run for selecting an existing saved variant or generating and
  saving the baseline variant.
- Local editor launch handoff with URL, lifecycle marker, and explicit stop or
  status behavior if the server is owned by the MCP process.
- Artifact inspection for project manifest, selected variant, warnings, and
  later export bundle paths.
- Stable non-secret error responses matching the existing CLI error taxonomy.

MCP should not introduce a new project schema, new variant-selection rules, new
polish behavior, hosted services, or final export behavior.

## Alternatives Considered

### Option A: Defer MCP Until After CLI, Codex Wrapper, And Export Evidence

This is selected. It keeps Agent Integrations small enough to close and lets the
next milestone prove the final export artifact boundary before committing to a
server transport.

### Option B: Add A Minimal MCP Server Now

This would provide a typed tool surface early, but it would mostly wrap
`autodemo agent run` before there is evidence that agents need it. It would also
create maintenance and validation work while export and packaging are still
incomplete.

### Option C: Make MCP Required For MVP Completion

This is too broad for the first MVP demo. Requiring MCP would make Agent
Integrations depend on process lifecycle and host transport decisions that do
not yet change the user-visible demo output.

## Required Updates

- Add a WES-162 decision note to the root README near Agent Workflow.
- Add an MCP decision note to `packages/agent/README.md`.
- Update the project map with WES-162 spec/plan links, selection evidence, and
  the current decision.
- Add behavior-oriented documentation tests that verify public docs record the
  deferral decision, the later inclusion criteria, and the minimum future MCP
  capability categories.
- Add a concise Linear completion comment for WES-162 and WES-138 when
  completion evidence exists. Move WES-162 to Done after validation. Move
  WES-138 to Done only after WES-160, WES-161, WES-162, and WES-169 are all
  Done and the map reflects that Agent Integrations is complete.

## Testing Strategy

This is a decision task, so tests should treat documentation as public behavior.
They should verify that the user-facing docs preserve:

- MCP deferred from MVP;
- CLI plus Codex wrapper as the current MVP path;
- future MCP inclusion criteria;
- minimum future MCP capabilities;
- out-of-scope boundaries such as new schema, hosted services, and final export
  behavior.

The tests should not assert exact prose, heading order, or private formatting.
Run the focused agent documentation tests first, then `npm run validate`.

## Deferrals

- MCP server implementation.
- MCP package or tool schema.
- Host registration, auth, or marketplace packaging.
- Claude production wrapper implementation.
- Final MP4 export and export-bundle validation, owned by Export And Packaging.

## Spec Self-Review

- Placeholder scan: no TBD or TODO markers remain.
- Consistency: the decision matches the balanced MVP design, WES-160 command
  contract, WES-169 host decision, and WES-161 wrapper artifacts.
- Scope: this is one decision and documentation task; it does not implement MCP
  or export behavior.
- Ambiguity: the decision, rationale, future triggers, minimum MCP capabilities,
  tests, Linear updates, and deferrals are explicit.
