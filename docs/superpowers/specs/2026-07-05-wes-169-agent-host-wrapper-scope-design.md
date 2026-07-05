# WES-169 Agent Host Wrapper Scope Design

Date: 2026-07-05

## Linear Issue

- Issue: WES-169, "Open question: choose MVP agent host wrapper scope"
- Project: Auto Demo Balanced MVP
- Milestone: Agent Integrations

## Context

WES-160 added the stable agent-facing workflow contract:

```text
autodemo agent run --project <project-dir-or-manifest> --json
autodemo agent run --project <project-dir-or-manifest> --json --variant <variant-id>
autodemo agent run --project <project-dir-or-manifest> --json --generate baseline --source-variant <variant-id> --save <baseline-polish|all>
autodemo agent run --project <project-dir-or-manifest> --json --open-editor [--host 127.0.0.1] [--port 0] [--no-browser]
```

WES-161 started from a Codex-and-Claude wrapper scope. The MVP needs a host
target decision before implementation so wrapper work does not block on parity
that is not required for the first demo.

## Selected Decision

The MVP host target is one production Codex wrapper plus documented Claude
follow-up scope.

WES-161 should implement and verify a Codex skill wrapper as the acceptance
critical host integration for the first MVP demo. Claude remains launch
documentation and follow-up work: WES-161 should document the same workflow
contract in host-neutral terms and record what a Claude wrapper must match, but
the first MVP demo should not require a fully implemented Claude wrapper before
Agent Integrations can advance.

## Rationale

This keeps the MVP aligned with the current operating environment. The workflow
is already CLI-backed and JSON-first, and Codex can consume a local skill wrapper
without adding a second host's packaging conventions to the critical path.
Requiring both production wrappers now would increase the acceptance surface
without proving additional Auto Demo product behavior. Deferring Claude as an
explicit follow-up avoids losing the parity requirement while allowing WES-161
to validate the agent workflow end to end.

## Wrapper Parity Requirements

Any host wrapper included in the MVP must document and exercise:

- Invocation instructions for the host and the `autodemo agent run` command.
- Required inputs: project directory or manifest path, optional saved variant,
  optional baseline generation source variant, save target, and editor handoff
  flags.
- Command sequence for selecting an existing saved variant, generating and
  saving the baseline variant, and opening the local editor handoff.
- Expected artifacts: project manifest path, selected variant id, variant JSON
  path, warnings, next-step hints, and optional editor URL.
- Failure handling for missing projects, invalid projects, missing variants,
  unsupported generation requests, and editor handoff failures.
- Explicit boundaries for export rendering, MCP transport, hosted services, and
  host marketplace packaging.

## WES-161 Scope Update

WES-161 should become:

- Implement a Codex skill wrapper for the WES-160 `autodemo agent run` contract.
- Include one happy-path Codex transcript or fixture and one failure-mode
  example for invalid or missing project artifacts.
- Add host-neutral launch documentation that describes Claude wrapper parity
  requirements and records Claude implementation as follow-up work.
- Avoid duplicating Auto Demo schema or business logic in wrapper instructions.
- Keep MCP transport owned by WES-162 and final MP4 export owned by Export And
  Packaging issues.

## Alternatives Considered

### Option A: Codex Production Wrapper Plus Claude Follow-Up

This is selected. It gives the MVP one verified host integration and keeps
Claude requirements explicit without making two wrapper formats block the first
demo.

### Option B: Both Codex And Claude Production Wrappers

This provides strongest host parity but makes WES-161 acceptance depend on two
host packaging surfaces before the product has validated one full agent path.
It is better after the Codex wrapper and export milestone prove the workflow.

### Option C: Documentation-Only Wrappers For Both Hosts

This is too weak for the Agent Integrations milestone. The MVP needs at least
one production wrapper that an agent can follow autonomously.

## Testing And Validation

This is a decision task, so validation is document and tracker oriented:

- The WES-169 spec records the MVP host target.
- The repo map records WES-169 selection and decision evidence.
- WES-161 acceptance criteria are updated in Linear so implementation scope is
  explicit before coding starts.
- README surfaces the host target near the agent workflow docs.
- Lightweight verification searches for the chosen host target and the WES-161
  scope update in repo files.

## Deferrals

- Claude production wrapper implementation.
- MCP transport and any MCP host requirements.
- Final MP4 rendering and export bundle generation.
- Marketplace or hosted distribution for any host wrapper.

## Spec Self-Review

- Placeholder scan: no TBD or TODO markers remain.
- Consistency: Codex is the only production MVP wrapper; Claude is documented as
  follow-up and parity guidance.
- Scope: this issue decides host coverage and updates WES-161; it does not
  implement wrapper files.
- Ambiguity: the host target, parity expectations, WES-161 scope, validation,
  and deferrals are explicit.
