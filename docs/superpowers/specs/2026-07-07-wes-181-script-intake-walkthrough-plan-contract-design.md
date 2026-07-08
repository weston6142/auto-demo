# WES-181 Script Intake And Walkthrough Plan Contract Design

## Context

WES-181 starts the post-MVP script-to-recorded-demo workflow. The balanced MVP can capture browser sessions, import captures into projects, generate and save baseline variants, open the local editor, and export MP4 artifacts. The missing layer is a stable intermediate plan that turns a user-provided browser walkthrough script into structured data that later validation, review/approval, execution, and project handoff can consume without reparsing raw prose.

## Goal

Add the first script intake contract for browser walkthrough plans. The contract accepts a target URL plus natural-language script text, preserves the original user intent, emits deterministic JSON-safe plan data, and represents both resolved browser steps and unresolved questions.

## Approach

Use a small contract-first implementation in `@auto-demo/agent`, exposed through a new CLI subcommand:

```bash
npm run autodemo -- agent plan --url <target-url> --script <script-text> --mode validate-first --json
```

The public API is `createWalkthroughPlan(input)`. It returns either a successful `WalkthroughPlanResult` or stable structured errors. The initial normalizer is deliberately conservative:

- URL-like steps become `navigate`.
- `click ...` steps become `click`.
- `type/enter/fill ...` steps become `type`.
- `wait ...` steps become `wait`.
- `see/verify/assert/check ...` steps become `assert`.
- unclear steps become `question` items with `resolution: "unresolved"`.

This avoids pretending Auto Demo has a full LLM planner or browser validator. Later WES-178 validation can resolve questions against real page state, and WES-177 can present the plan for user approval.

## Alternatives Considered

1. **Recommended: deterministic contract and conservative normalizer.** This is small, testable, and gives downstream issues a stable shape now.
2. **Schema-only docs and fixtures.** This would satisfy part of the issue but would not give later work executable behavior or CLI output to build on.
3. **LLM-quality natural-language planning.** This is out of scope for the repo-local MVP because it would introduce model/provider decisions and nondeterministic tests before validation/execution infrastructure exists.

## Data Model

`WalkthroughPlan` contains:

- `id`: deterministic hash-derived plan id for the same target URL, script, and mode.
- `target`: browser target URL.
- `mode`: `validate-first` or `best-guess`.
- `state`: `needs-clarification` when any unresolved questions exist, otherwise `draft`.
- `source`: original script text and non-secret parsing metadata.
- `steps`: ordered plan steps. Supported actions are `navigate`, `click`, `type`, `wait`, `assert`, and `question`.
- `questions`: unresolved, user-answerable questions keyed by step id.
- `approvals`: starts as `{ required: true, approved: false }`.
- `execution`: starts as `{ status: "not-started" }`.
- `warnings`: non-secret notes such as best-guess mode or unsupported credentials automation.

Typed values are not echoed in the normalized `summary`; type steps keep the raw step text only in the original source script and use `[redacted]` in public action details. The first contract does not automate credentials, arbitrary OS apps, destructive production actions, validation execution, approval, recording execution, or project handoff.

## CLI Behavior

`autodemo agent plan` requires `--url`, `--script`, and `--json`. `--mode` defaults to `validate-first` and accepts only `validate-first` or `best-guess`.

Successful output:

```json
{
  "ok": true,
  "plan": {
    "id": "plan-...",
    "state": "draft",
    "mode": "validate-first"
  }
}
```

Expected failures return `ok: false` with stable error codes such as `missing_target_url`, `invalid_target_url`, `missing_script`, `unsupported_plan_mode`, `unsupported_agent_output`, and `unknown_agent_argument`.

## Testing

Use behavior-first tests:

- API test: a simple click-through script produces a draft plan with navigate/click/assert steps, no questions, explicit approval requirement, and transcript-safe output.
- API test: an ambiguous script produces `needs-clarification`, an unresolved question, and does not collapse uncertainty into a fake executable action.
- API test: type steps redact public typed value details.
- CLI test: `autodemo agent plan --url ... --script ... --json` prints parseable JSON.
- Docs/fixture test: include one simple click-through fixture and one ambiguous fixture under `packages/agent/fixtures/`.

## Spec Self-Review

- Placeholder scan: no TBD/TODO placeholders remain.
- Consistency check: the API, CLI, data model, and tests all describe the same conservative contract.
- Scope check: this is one implementation slice; validation, approval, execution, capture import, and project handoff remain downstream issues.
- Ambiguity check: the parser is intentionally heuristic and conservative, with unresolved questions as the explicit fallback.
