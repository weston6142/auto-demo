# WES-161 Codex Skill Wrapper Design

Date: 2026-07-06

## Linear Issue

- Issue: WES-161, "Codex and Claude skill wrappers for the demo workflow"
- Project: Auto Demo Balanced MVP
- Milestone: Agent Integrations

## Context

WES-160 added the agent-facing workflow contract:

```bash
autodemo agent run --project <project-dir-or-manifest> --json
```

The contract validates an Auto Demo project, selects an existing saved variant or
saves a generated baseline variant, optionally starts the local browser editor,
and prints a non-secret JSON handoff summary. WES-169 narrowed MVP wrapper scope
to one production Codex wrapper, with Claude wrapper parity documented as
follow-up scope.

WES-161 should not add another orchestration layer or duplicate project schema
rules. It should provide agent-host instructions and examples that tell Codex how
to use the existing WES-160 command safely.

## Selected Approach

Create repository-owned wrapper artifacts under `packages/agent/`:

- `packages/agent/skills/codex-auto-demo/SKILL.md` is the MVP Codex skill wrapper.
- `packages/agent/fixtures/codex-happy-path.md` records a happy-path transcript.
- `packages/agent/fixtures/codex-invalid-project.md` records one failure-mode
  transcript for invalid or missing project artifacts.
- `packages/agent/claude-wrapper-parity.md` documents the minimum future Claude
  wrapper parity requirements.

The Codex skill instructions reference the WES-160 CLI directly, list project
prerequisites, define the variant-selection and generation paths, describe local
editor handoff, and stop at export handoff boundaries because MP4 export is not
implemented yet. The skill tells agents to parse JSON summaries and report
stable non-secret outputs instead of inspecting Auto Demo internals.

`@auto-demo/agent` tests will validate the published wrapper artifacts. These
tests treat the docs as public behavior: the required command, examples,
failure codes, handoff boundaries, and deferrals must remain present. They avoid
asserting prose formatting or private implementation details.

## Alternatives Considered

### Option A: Repository-Owned Codex Skill And Examples

This is the selected approach. It satisfies the MVP wrapper acceptance criteria
without depending on a user-local Codex skill installation path. It keeps the
wrapper reviewable in normal PRs and ready to copy or package later.

### Option B: Install A User-Local Codex Skill

Installing directly into a local Codex skills directory would make this machine
usable immediately, but it would not produce a durable project artifact or CI
coverage. Packaging and distribution remain follow-up work.

### Option C: Add More CLI Wrapper Commands

The WES-160 contract already exposes the workflow command. Adding another CLI
layer would duplicate behavior and increase maintenance risk. WES-161 is better
served by instructions, examples, and parity documentation.

## Behavior Requirements

- Codex instructions explain how to identify a project directory or
  `autodemo.project.json` path before running the workflow.
- Codex instructions use `autodemo agent run --project <project-dir-or-manifest>
--json` as the primary command.
- Codex instructions cover selecting an existing variant with `--variant`,
  generating and saving the baseline variant with `--generate baseline --save
<baseline-polish|all>`, and opening the local editor with `--open-editor`.
- Codex instructions require JSON output and stable error handling for expected
  failures.
- Codex instructions do not duplicate project schema, polish decision, editor,
  or export business logic.
- Examples include one successful Codex transcript or fixture and one invalid or
  missing project failure example.
- Claude parity documentation names invocation instructions, required inputs,
  command sequence, expected artifacts, and failure handling required for a
  future wrapper.
- Claude production wrapper implementation, MCP transport, hosted services,
  marketplace distribution, and final export implementation remain out of scope.

## Testing Strategy

Add a behavior-oriented `packages/agent/src/wrapper-docs.test.ts` suite that
loads the published wrapper artifacts and verifies:

- the Codex skill names the WES-160 command and the supported option paths;
- the Codex examples include parseable JSON success and failure output blocks;
- the failure example includes an expected stable error code;
- Claude parity docs include the required parity categories and follow-up
  deferrals.

Run the focused agent tests first, then the full validation command.

## Documentation

Update `packages/agent/README.md` with links to the Codex skill wrapper,
transcript fixtures, and Claude parity document. Update the root README only if
the user-facing CLI command list needs adjustment; the WES-160 root README
already documents `autodemo agent run`.

The project map should record WES-161 selection, implementation, completion
evidence, and the next Agent Integrations task pointer.

## Deferrals

- Installing the Codex skill into a local or published Codex marketplace.
- A production Claude wrapper file.
- MCP server or transport behavior.
- Hosted handoff services.
- Final MP4 export implementation and export-bundle validation.

## Spec Self-Review

- Placeholder scan: no TBD or TODO markers remain.
- Consistency: the design keeps business logic in WES-160 and makes WES-161 a
  wrapper-documentation artifact with validation tests.
- Scope: this is one Agent Integrations issue and does not implement Claude,
  MCP, hosting, packaging, or exports.
- Ambiguity: file paths, command contract, examples, tests, and deferrals are
  explicit.
