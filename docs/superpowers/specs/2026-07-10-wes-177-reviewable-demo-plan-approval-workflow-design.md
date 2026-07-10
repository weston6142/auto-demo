# WES-177 Reviewable Demo Plan Approval Workflow Design

Date: 2026-07-10

## Overview

WES-177 adds the user review, refinement, and approval gate between walkthrough validation and recorded execution. The primary user experience is an agent conversation: the agent presents a concise plan, asks targeted questions, translates user answers into structured refinements, and requests explicit approval. Deterministic workflow services in `@auto-demo/agent` own plan lifecycle and safety rules so approval does not depend on trusting a conversation transcript.

The approved plan remains a structured artifact for WES-179. It contains portable approval evidence that WES-179 can verify before browser capture begins.

## Goals

- Present a walkthrough plan conversationally without requiring the user to read raw JSON.
- Preserve a structured, transcript-safe review model for Codex, Claude, and other agent hosts.
- Apply user answers as deterministic structured refinements.
- Automatically revalidate refined `validate-first` plans.
- Require explicit approval before normal execution.
- Record when approval occurred, its basis, and a fingerprint of the approved execution content.
- Let downstream execution reject approval that became stale after plan changes.
- Keep all plan, validation, refinement, and approval outputs free of credentials, typed secrets, raw DOM snapshots, and raw event payloads.

## Non-Goals

WES-177 does not:

- add an interactive terminal wizard;
- parse arbitrary conversational prose inside the core library;
- execute browser actions under capture;
- create capture bundles or Auto Demo projects;
- implement WES-179 execution or WES-180 project handoff;
- automate credential entry or destructive production actions;
- store a conversation transcript or require a cross-host user identity model;
- persist raw CSS selectors or ephemeral browser element handles.

## Selected Approach

Add a focused review workflow service to `@auto-demo/agent`. The service owns review construction, structured refinement, automatic revalidation, approval, and approval verification. Agent hosts own conversation: they explain the review, interpret user answers, ask for explicit confirmation, and persist returned plan artifacts.

This boundary provides consistent lifecycle and safety behavior across hosts without turning the library into a chat system. It also gives WES-179 a host-independent approval verification API.

## Architecture And Responsibilities

The public API should expose operations shaped like:

```ts
reviewWalkthroughPlan(plan): WalkthroughPlanReviewResult

refineWalkthroughPlan(
  plan,
  refinements,
  options,
  dependencies,
): Promise<WalkthroughPlanRefinementResult>

approveWalkthroughPlan(
  plan,
  options,
): WalkthroughPlanApprovalResult

verifyWalkthroughPlanApproval(
  plan,
): WalkthroughPlanApprovalVerificationResult
```

Responsibilities are split as follows:

### Core workflow service

- validates plan and refinement shapes;
- builds a concise transcript-safe review;
- applies complete refinement batches atomically;
- clears stale validation and approval;
- automatically invokes existing validation for `validate-first` plans;
- computes and records approval fingerprints;
- enforces normal and best-guess approval gates;
- verifies approval for downstream consumers.

### Agent host

- presents review content conversationally;
- interprets natural-language user answers;
- produces structured refinement requests;
- asks the user for explicit approval;
- invokes approval only after confirmation;
- persists returned JSON as the next plan artifact.

### CLI adapter

- reads plan and refinement artifacts;
- calls the workflow service;
- writes deterministic JSON to stdout;
- returns stable structured errors and exit codes;
- never silently modifies an input plan file.

### Downstream execution

WES-179 consumes the approved artifact and calls `verifyWalkthroughPlanApproval()` before starting capture. It must not infer approval from state or conversation text alone.

## Plan Lifecycle

Extend the top-level walkthrough lifecycle to:

```text
draft -> needs-clarification -> validated -> approved -> executed
```

The transitions are:

- Plan intake produces `draft` when all parsed steps are resolved.
- Intake produces `needs-clarification` when unresolved questions exist.
- Validation with blockers produces `needs-clarification` and `validation.status = "blocked"`.
- Validation with no blockers produces `validated` and `validation.status = "ready"`.
- Any accepted refinement clears validation and approval, then returns the plan to `needs-clarification` when unresolved steps or questions remain and otherwise to `draft`.
- Automatic revalidation of a `validate-first` plan moves it to `validated` or `needs-clarification`.
- Approval moves an eligible plan to `approved`.
- WES-179 will own the later transition to `executed`.

`validated` is an explicit top-level state rather than only a derived display label. `validation.status` remains the detailed rehearsal result and must agree with the top-level state. A plan cannot be `validated` when validation is absent or blocked.

## Approval Model

Expand the existing `approvals` object without introducing user identity requirements:

```ts
type WalkthroughPlanApproval = {
  required: true;
  approved: boolean;
  approvedAt?: string;
  planFingerprint?: string;
  basis?: "validated" | "best-guess-bypass";
};
```

Validated approval requires all of the following:

- top-level state is `validated`;
- `validation.status` is `ready`;
- validation has no blockers;
- the plan has no unresolved questions or unresolved steps.

A `best-guess` plan with ready validation uses the same validated approval path. A `best-guess` plan may be approved without validation only when the caller passes an explicit bypass option and every step is resolved. The approval records `basis = "best-guess-bypass"`. The bypass skips browser validation; it does not permit unresolved questions or steps. Merely using best-guess mode is not sufficient authorization to approve.

Approval records `approvedAt` using an injectable clock and stores a deterministic SHA-256 fingerprint. The fingerprint uses canonical JSON for these execution-relevant fields:

- target;
- mode;
- ordered steps, including durable target hints;
- unresolved questions;
- validation payload, or explicit absence of validation.

The fingerprint excludes top-level lifecycle state, approval fields, execution fields, and the original free-form source script. This allows the state transition from `validated` to `approved` without invalidating the fingerprint while ensuring execution instructions and their validation evidence cannot change unnoticed.

Any refinement clears `approved`, `approvedAt`, `planFingerprint`, and `basis` before revalidation. Approval verification recomputes the fingerprint and returns a structured stale-approval result if it differs.

The fingerprint is consistency evidence, not an identity signature or tamper-proof authorization mechanism. It detects a plan that changed after approval under the normal artifact workflow; it does not defend against a caller deliberately rewriting both plan content and approval metadata.

## Review Model

`reviewWalkthroughPlan()` returns a structured review with a deterministic transcript-safe summary. It should include:

- plan identifier, target, mode, and lifecycle state;
- ordered public step summaries;
- waits and assertions in their original order;
- warnings and assumptions;
- validation status and step checks;
- unresolved questions and validation blockers;
- candidate choices using sanitized labels, roles, and occurrence context;
- approval eligibility and a concise reason when approval is unavailable;
- a plain-text summary suitable for an agent to quote or paraphrase.

The review must not expose `sourceText` for typed values, URL query strings or fragments, raw browser state, raw selectors, credentials, tokens, or raw DOM content. Review generation is pure and never changes the plan.

## Structured Refinements

The first slice supports two refinement operations.

### Select candidate

```ts
type SelectCandidateRefinement = {
  kind: "select-candidate";
  stepId: string;
  blockerId: string;
  candidateId: string;
};
```

The referenced blocker and candidate must belong to the current validation payload and step. Selection materializes a durable accessible target hint on the step rather than retaining the ephemeral candidate identifier:

```ts
type WalkthroughPlanTargetHint = {
  kind: "accessible";
  label: string;
  role?: string;
  occurrence?: number;
};
```

Validation candidates may be extended with an optional sanitized target hint. Candidate selection is rejected when the candidate lacks enough information to create a durable hint. Raw CSS selectors and browser element handles are never persisted.

### Replace step

```ts
type ReplaceStepRefinement = {
  kind: "replace-step";
  stepId: string;
  replacement: WalkthroughPlanStepReplacement;
};
```

The replacement supplies a resolved `navigate`, `click`, `type`, `wait`, or `assert` action plus its transcript-safe public summary and any required accessible target hint. It preserves the original step identifier and order so validation references and conversational context remain stable. It removes a matching unresolved question when the replacement resolves that question.

Replacement cannot introduce credentials, raw typed secrets, destructive actions, unsafe URLs, duplicate identifiers, new unresolved references, or invalid step ordering.

## Refinement And Revalidation Flow

1. Validate the input plan.
2. Validate every refinement against the same input snapshot.
3. Reject multiple refinements that target the same step in one batch.
4. If any refinement is invalid or stale, reject the entire batch without returning a partially refined plan.
5. Apply all refinements to a copy of the plan.
6. Clear validation and approval fields, then set state to `needs-clarification` when unresolved work remains and otherwise to `draft`.
7. For `validate-first`, invoke the existing validation service with injected browser dependencies.
8. Return the revalidated plan and its new review.
9. For `best-guess`, return the refined unvalidated plan and review without mandatory browser validation.

A blocker discovered during browser rehearsal is a successful workflow result: the returned plan is `needs-clarification`. A browser setup or navigation failure is an operational error, but the result includes the fully refined unvalidated plan so the user answer is not lost and the agent can retry validation.

## CLI Contract

Add thin JSON-oriented command forms:

```bash
npm run autodemo -- agent review \
  --plan <plan-json-file> \
  --json

npm run autodemo -- agent refine \
  --plan <plan-json-file> \
  --refinements <refinements-json-file> \
  --json

npm run autodemo -- agent approve \
  --plan <plan-json-file> \
  [--allow-best-guess-bypass] \
  --json
```

The commands return JSON containing the resulting plan, review, or structured errors. They do not overwrite the input file. The agent host saves a successful returned plan as a new artifact or explicitly replaces its working artifact.

The CLI does not claim that approval reflects user intent merely because the command was invoked. The Codex wrapper and host-neutral agent documentation must require explicit conversational confirmation immediately before invoking `agent approve`.

## Error Handling

Expected workflow errors use stable non-secret codes. The initial set should cover:

- `invalid_plan`;
- `invalid_refinement`;
- `unknown_refinement_step`;
- `stale_validation_blocker`;
- `unknown_validation_candidate`;
- `candidate_not_persistable`;
- `unsupported_replacement_action`;
- `plan_not_approvable`;
- `best_guess_bypass_required`;
- `stale_approval`;
- existing validation browser setup and navigation errors.

Invalid refinement batches do not change the plan. Approval failures do not change the plan. Revalidation infrastructure failures return the refined unvalidated draft alongside the error, with approval unavailable.

Review and error messages must identify plan, step, blocker, or candidate identifiers where useful, but must not include secret input, raw DOM, raw event payloads, or unsanitized URLs.

## Testing Strategy

Tests should exercise public behavior and artifacts rather than internal call order or implementation details.

Required behavior coverage:

- review returns ordered readable content without exposing raw JSON or secrets;
- review explains why draft, blocked, or stale plans are not approvable;
- candidate selection produces a durable accessible target hint and revalidates successfully;
- candidates without persistable hints are rejected;
- replacing an unresolved step removes its question and preserves step identity and order;
- a mixed valid and invalid refinement batch is rejected atomically;
- accepted refinement clears prior validation and approval;
- validate-first refinement automatically revalidates;
- blockers return a successful `needs-clarification` result;
- browser setup or navigation failure preserves the refined draft and reports a structured error;
- draft and blocked validate-first plans cannot be approved;
- a ready validated plan records validated approval evidence;
- unvalidated best-guess approval requires explicit bypass intent;
- approval verification succeeds before changes and returns `stale_approval` after execution-relevant changes;
- typed values, credentials, tokens, URL query strings, URL fragments, and raw browser details remain absent from review, refinement, approval, and CLI output;
- CLI commands expose the documented JSON results and stable error codes.

Use injected clocks, validation runners, and deterministic fixtures. Core workflow tests should use fake browser dependencies; only focused adapter tests should exercise the Playwright boundary.

## Agent Host Contract

Repository-owned Codex instructions and host-neutral parity documentation should describe this loop:

1. Load and review the current plan artifact.
2. Explain the plan, assumptions, and blockers conversationally.
3. Ask one focused clarification at a time when blocked.
4. Translate the user's answer into structured refinements.
5. Invoke refinement and present the new validation result.
6. When eligible, ask for explicit approval.
7. Invoke approval only after confirmation.
8. Persist the approved artifact for WES-179.

The host may paraphrase the deterministic review, but it must not omit unresolved blockers, claim approval before confirmation, or silently use the best-guess bypass.

## Downstream Handoff

WES-179 receives one approved walkthrough plan artifact. Before opening a capture browser, it must:

- validate the plan schema;
- require top-level state `approved`;
- require approval evidence;
- recompute and verify the approval fingerprint;
- reject stale or missing approval;
- accept `best-guess-bypass` only as an explicit recorded basis.

Execution outcome fields and the transition to `executed` remain WES-179 scope. Importing the resulting capture into an Auto Demo project remains WES-180 scope.
