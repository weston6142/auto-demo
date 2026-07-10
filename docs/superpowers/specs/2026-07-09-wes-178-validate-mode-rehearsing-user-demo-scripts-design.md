# WES-178 Validate Mode For Rehearsing User Demo Scripts Design

## Context

WES-181 added the first walkthrough plan intake contract. `createWalkthroughPlan()` turns a target URL plus natural-language browser demo script into deterministic JSON with resolved browser-oriented steps, unresolved questions, plan mode, approval metadata, and transcript-safe redaction for typed values. It does not inspect a live browser page.

WES-178 adds the next layer: validate mode. Validate mode rehearses an existing walkthrough plan against browser page state before any final recording, project creation, approval workflow, or execution handoff. Its job is to discover whether the current plan is ready for review or where it is ambiguous, impossible, or unsafe.

## Goal

Add a non-interactive dry-run validator for user demo scripts that:

- consumes a `WalkthroughPlan` or creates one from `--url` and `--script`;
- rehearses resolved plan steps against a browser target without producing a capture bundle or Auto Demo project;
- annotates the plan with structured validation checks and blockers;
- returns all blockers that can be discovered safely;
- preserves typed-value and secret hygiene in all public output;
- hands structured questions and candidate matches to WES-177 for user-facing review and refinement.

## Non-Goals

WES-178 does not:

- ask the user questions interactively;
- update a plan from user answers;
- approve a plan;
- execute a final recording;
- create or import an Auto Demo project;
- introduce LLM planning;
- automate credentials or arbitrary OS apps;
- guarantee selector persistence for WES-179 execution beyond transcript-safe candidate summaries.

## Recommended Approach

Add validation annotations to the existing plan shape instead of returning a detached report. The public API should live in `@auto-demo/agent`, near `createWalkthroughPlan()`, because validation is part of the agent planning workflow.

The core API should be shaped like:

```ts
validateWalkthroughPlan(
  plan: WalkthroughPlan,
  options?: WalkthroughPlanValidationOptions,
  dependencies?: WalkthroughPlanValidationDependencies,
): Promise<WalkthroughPlanValidationResult>
```

The result should return the original plan plus a `validation` section. Keeping validation attached to the plan gives WES-177 one artifact to review and refine, and matches WES-178's acceptance criterion that validation output updates or annotates the walkthrough plan.

## CLI Behavior

Primary CLI form:

```bash
npm run autodemo -- agent validate --plan <plan-json-file> --json
```

Convenience form:

```bash
npm run autodemo -- agent validate --url <target-url> --script <script-text> [--mode validate-first|best-guess] --json
```

The `--plan` form is the durable handoff surface for WES-177 and WES-179. The `--url` and `--script` form should call `createWalkthroughPlan()` first and then validate the resulting plan. Both forms require `--json` for the first slice.

Expected failures should return stable JSON errors rather than prose-only stderr. Examples include invalid plan JSON, missing plan file, invalid plan shape, unsupported mode, browser setup failure, and unknown arguments.

## Validation Data Model

The validated plan should add a section like:

```ts
type WalkthroughPlanValidation = {
  status: "ready" | "blocked";
  validatedAt: string;
  mode: "dry-run";
  checks: WalkthroughPlanValidationCheck[];
  blockers: WalkthroughPlanValidationBlocker[];
};
```

Each check records a step-level result:

```ts
type WalkthroughPlanValidationCheck = {
  id: string;
  stepId: string;
  action: WalkthroughPlanStepAction;
  status: "passed" | "blocked" | "skipped";
  reason?: WalkthroughPlanValidationReason;
  summary: string;
};
```

Each blocker is user-actionable and transcript-safe:

```ts
type WalkthroughPlanValidationBlocker = {
  id: string;
  stepId: string;
  reason: WalkthroughPlanValidationReason;
  question: string;
  candidates?: WalkthroughPlanValidationCandidate[];
};
```

Candidate matches should be concise and non-secret:

```ts
type WalkthroughPlanValidationCandidate = {
  id: string;
  label: string;
  role?: string;
};
```

Initial blocker reasons:

- `unresolved_plan_question`
- `missing_element`
- `multiple_matching_elements`
- `unexpected_navigation`
- `navigation_failed`
- `auth_wall_detected`
- `timing_failure`
- `unsafe_dependent_step`
- `unsafe_action`
- `unsupported_step_action`

## Browser Runner Boundary

Validation should use a small browser-runner dependency rather than the existing capture adapter. The capture adapter is optimized for media recording, metadata writing, manifests, and bundle lifecycle. Validate mode needs page inspection, target matching, dry-run action attempts, and candidate collection without creating capture artifacts.

The runner boundary should expose only the operations validation needs, such as:

- open a browser page at the plan target URL;
- inspect visible text, roles, labels, placeholders, and URL/title state;
- click a single matched element;
- type into a single matched field with value redaction in public output;
- wait for page idle or a bounded timeout;
- close the browser cleanly.

Production dependencies can wrap Playwright. Tests should use fakes for the core validation behavior.

## Matching Strategy

The first matching strategy should be deterministic and browser-state based, not AI-driven. For click, assert, and type targets, validation should rank:

1. exact visible text matches;
2. accessible role/name matches where available;
3. label, placeholder, or name-like matches for type targets.

Outcomes:

- zero matches creates `missing_element`;
- one match passes the check or performs the dry-run action;
- multiple matches creates `multiple_matching_elements` with sanitized candidates;
- navigation failures create `navigation_failed`;
- unexpected location changes create `unexpected_navigation`;
- auth-looking pages create `auth_wall_detected`;
- bounded waits that do not complete create `timing_failure`.
- destructive-looking actions and credential-like fields create `unsafe_action`
  without exercising the control;
- the production browser context blocks non-idempotent network requests and
  turns attempted POST, PUT, PATCH, or DELETE actions into `unsafe_action`;
- service workers are disabled and WebSocket connections are blocked so those
  channels cannot bypass the request safety boundary;
- explicit navigation URLs are rehearsed and verified, while navigation steps
  without an explicit URL create `unsupported_step_action`.

The design intentionally avoids making a best guess when multiple visible candidates exist. That decision belongs to WES-177's review and refinement workflow.

## Returning All Discovered Blockers

Validate mode should collect every blocker it can safely discover. It should not stop at the first failure unless the browser itself cannot be opened or recovered.

When a step is blocked, the validator should continue only where inspection is safe:

- Existing unresolved `question` steps from `createWalkthroughPlan()` become `unresolved_plan_question` blockers.
- If a click or type step is blocked, downstream actions that depend on that state-changing step should be marked `skipped` with `unsafe_dependent_step`.
- Later assertions or inspections may still be evaluated against the current page when doing so does not require pretending the blocked action succeeded.
- The validator must not perform destructive or credential-like actions to discover more blockers.

This gives the user a fuller list of obvious problems while keeping the rehearsal honest.

## Secret And Typed-Value Hygiene

Validation output must not echo typed values, credentials, tokens, raw event payloads, or full DOM snapshots.

Type steps may validate that a target field exists and can receive input, but public summaries and blockers should use redacted wording such as `typed value redacted`. Candidate labels should be short visible labels, roles, or field descriptors, not raw HTML.

URLs in public output should follow the existing project convention of avoiding query strings and fragments when they may contain secrets.

Validation must reject target URLs with credential-like parameters before
opening a browser. Serialized validated plans are built from allowlisted plan
fields so unknown properties cannot leak into the public artifact.

Secret sanitation applies to labeled credentials, JWT-like and high-entropy
tokens, candidate fields, query values, and both bare and parameterized URL
fragments. Unsafe requests attempted during initial load remain pending until
they are surfaced as `unsafe_action`.

Plan-file validation must also enforce cross-field invariants: non-empty script
and steps, unique safe identifiers, valid question-to-step references, and
consistent plan state. Behavioral URL comparison includes hash routes even
though fragments are removed from public output.

## Downstream Handoff

WES-177 should consume WES-178 validation blockers and candidates, present them in readable form, accept user answers, and update the structured plan. WES-178 should not implement that refinement loop.

WES-179 should execute only a validated and approved plan. WES-178's validation data should make that later gate explicit by setting `validation.status` to `ready` only when all resolved steps passed and no blockers remain.

## Testing

Use behavior-oriented tests.

API tests with fake browser-runner dependencies should cover:

- a straightforward plan validates as `ready`;
- multiple matching elements returns a blocker with candidates;
- a missing element returns a blocker;
- unresolved `question` steps are preserved as blockers;
- dependent unsafe actions are skipped after a blocked state-changing step;
- safe later inspections can still collect blockers;
- typed values are redacted from public validation output;
- browser setup or navigation failures return stable structured errors.

CLI tests should cover:

- `agent validate --plan <file> --json`;
- `agent validate --url <target-url> --script <script-text> --json`;
- invalid JSON plan file;
- missing plan file;
- invalid plan shape;
- missing `--json`;
- unknown arguments.

A small Playwright-backed fixture may be added if stable, but the core behavior should not depend on brittle real websites.

## Open Implementation Details

The implementation plan should decide:

- the exact serialized validated-plan type name;
- whether the plan file reader lives in `@auto-demo/agent` or only in the CLI;
- the first fake browser-runner interface shape;
- how much Playwright role/name matching is exposed in the runner without leaking Playwright-specific types into the public API.

These are implementation details, not product-scope questions.

## Spec Self-Review

- Placeholder scan: no TBD or TODO placeholders remain.
- Consistency check: the API, CLI, data model, matching behavior, and downstream handoff all describe non-interactive plan annotation.
- Scope check: this is one implementation slice; user question resolution, approval, execution, capture, and project handoff remain downstream.
- Ambiguity check: "return all blockers" is defined as all blockers safely discoverable without assuming blocked state-changing actions succeeded.
