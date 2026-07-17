# WES-188: Deterministic Replay Verification And Agent Repair Loop

## Context

The Agentic Flow Discovery milestone now has four durable boundaries that WES-188 can compose:

- WES-183 records bounded, sanitized discovery sessions with explicit terminal child-session lineage.
- WES-186 enforces safe or explicitly disposable browser policy without persisting runtime authority.
- WES-187 compiles one completed session's selected successful path into a deterministic, draft, unapproved `WalkthroughPlan` with accessible target hints, structured assertions, and step provenance.
- The existing walkthrough lifecycle validates, reviews, approves, executes, captures, and hands off deterministic plans.

Compilation proves that selected discovery evidence is internally consistent. It does not prove that the resulting plan works in a fresh browser. Targets may have moved, an occurrence may now be ambiguous, a navigation expectation may be stale, or the selected route may depend on transient state. WES-188 adds that missing fresh-context gate and a bounded seam through which a host agent can rediscover a broken segment.

## Goals

- Replay a WES-187 discovery plan from its declared target in a brand-new isolated browser context.
- Use deterministic accessible-target matching and execute the plan's structured navigation and visible-state assertions.
- Resolve runtime input bindings in memory so input-dependent flows are verified with their real demo values.
- Return bounded, transcript-safe failure evidence linked to the failed step's discovery provenance.
- Let a host agent repair by returning a completed child `DiscoverySessionV1`; validate its lineage and recompile it through WES-187 before replaying again.
- Bound the workflow to the initial replay plus at most two repairs.
- Promote only a blocker-free replay result into the existing `validated` review and approval lifecycle.
- Keep every successful result unapproved and uncaptured.

## Non-Goals

- Embedding a model or implementing host-agent reasoning inside `@auto-demo/agent`.
- Adding a Codex or Claude workflow, CLI command, conversational approval UX, or final recording handoff; WES-189 owns the host workflow.
- Automatically editing a `WalkthroughPlan` from a target candidate or arbitrary model output.
- Reusing discovery-time disposable authority without a new explicit replay policy.
- Approving a plan, bypassing validation, starting media capture, or creating an Auto Demo project.
- Retiring deterministic script intake or its validation paths; WES-191 owns that cleanup.
- Adding end-to-end recording acceptance coverage; WES-190 owns milestone acceptance.

## Chosen Approach

Add a replay-and-repair coordinator to `@auto-demo/agent`. The coordinator owns validation, retry bounds, fresh browser creation, repair evidence, lineage checks, recompilation, and final lifecycle promotion. Browser mechanics and host reasoning remain injected boundaries.

The coordinator executes one compiled plan in a fresh replay browser. On a repairable failure, it closes that browser, returns sanitized evidence to a host-provided repair callback, validates the callback's completed child discovery session, recompiles the child through `compileDiscoverySessionToWalkthroughPlan()`, and starts the next replay in another fresh browser. It stops after success, a hard boundary, a host stop decision, or two repairs.

This is preferred over two alternatives:

1. **Loop around `validateWalkthroughPlan()` and `refineWalkthroughPlan()`.** This would reuse more surface area, but current validation deliberately types a synthetic redacted value, collects blockers without lineage, and permits direct target-candidate refinements. It cannot faithfully verify input-dependent discovered flows or prove that repairs came from new browser evidence.
2. **Teach the discovery rehearsal controller to consume compiled plans.** This would mix exploratory discovery with deterministic verification and reintroduce page-scoped opaque target IDs where WES-187 intentionally emitted portable accessible hints. It would also make a successful replay look like another discovery session rather than validation of the plan artifact.

## Public API And Ownership

The coordinator belongs in a focused `@auto-demo/agent` module beside the compiler and walkthrough lifecycle:

```ts
type ReplayAndRepairDiscoveryPlanInput = {
  plan: unknown;
  sourceSession: unknown;
  inputBindings?: Record<string, unknown>;
  policy?: DiscoveryPolicy;
};

type ReplayAndRepairDiscoveryPlanOptions = {
  maxRepairs?: 0 | 1 | 2;
  now?: () => Date;
  replayIdGenerator?: () => string;
};

async function replayAndRepairDiscoveryPlan(
  input: ReplayAndRepairDiscoveryPlanInput,
  options: ReplayAndRepairDiscoveryPlanOptions,
  dependencies: DiscoveryReplayDependencies,
): Promise<DiscoveryReplayResult>;
```

`plan` and `sourceSession` are `unknown` because they are artifact boundaries. The API validates both, recompiles the source session, and requires the supplied plan's execution content to match that canonical compilation before opening a browser. An arbitrary plan cannot claim discovery provenance merely by using `source.parser: "discovery-v1"`.

`maxRepairs` defaults to `2` and cannot exceed `2`. This gives the host one initial attempt and two opportunities to repair while keeping cost, side effects, evidence, and latency bounded.

The package index exports the coordinator, result types, failure-evidence types, browser boundary, repair-provider boundary, and fixed limits. No CLI is added in this issue.

## Dependencies

```ts
type DiscoveryReplayDependencies = {
  browserFactory: DiscoveryReplayBrowserFactory;
  repair?: DiscoveryPlanRepairProvider;
};

type DiscoveryReplayBrowserFactory = {
  create(input: {
    policy: DiscoveryPolicy;
    attempt: number;
  }): Promise<DiscoveryReplayBrowser>;
};

type DiscoveryPlanRepairProvider = {
  repair(input: {
    repairNumber: 1 | 2;
    parentSession: DiscoverySessionV1;
    failedPlan: WalkthroughPlan;
    failure: DiscoveryReplayFailureEvidence;
  }): Promise<
    | { decision: "repaired"; session: unknown }
    | { decision: "stop"; reason: DiscoveryReplayStopReason }
  >;
};
```

The browser factory must return a new unopened replay browser for every attempt. The coordinator always closes it, including setup, execution, policy, timeout, and callback failures.

The repair provider is the only host-agent seam. It receives bounded sanitized evidence and the current sanitized discovery artifact, then either returns a completed child session or stops. It cannot return a replacement plan. The coordinator alone compiles repair evidence into executable plan content.

## Replay Browser Boundary

The generic browser boundary exposes only deterministic operations needed by compiled plans:

```ts
type DiscoveryReplayBrowser = {
  open(url: string): Promise<void>;
  findMatches(target: WalkthroughPlanTargetHint): Promise<DiscoveryReplayMatch[]>;
  navigate(url: string): Promise<void>;
  click(match: DiscoveryReplayMatch): Promise<void>;
  type(match: DiscoveryReplayMatch, value: string): Promise<void>;
  wait(durationMs: number): Promise<void>;
  waitForSettled(): Promise<void>;
  assertVisible(assertion: Extract<WalkthroughPlanAssertion, { kind: "visible-state" }>): Promise<void>;
  assertNavigation(assertion: Extract<WalkthroughPlanAssertion, { kind: "navigation" }>): Promise<void>;
  inspectPage(): Promise<{ url: string }>;
  close(): Promise<void>;
};
```

Production Playwright support launches bundled Chromium with a fresh context for each attempt. It reuses the current execution controller's exact accessible-role/name/occurrence semantics, the WES-186 network/origin enforcement primitives, service-worker blocking, WebSocket blocking, popup quarantine, bounded settling, and transcript-safe URL handling. It adds bounded accessible candidate collection for repair evidence rather than leaking locators, selectors, HTML, or DOM snapshots.

The production factory owns Chromium and context lifecycle. The coordinator owns attempt lifecycle. Tests use fake factories and browsers.

## Replay Policy

Replay never inherits policy or authority from a discovery artifact.

If `input.policy` is omitted, the coordinator constructs a safe policy containing only the exact origin of `plan.target.url`. A multi-origin route requires the caller to provide an explicit safe policy with every allowed origin. Mutation-capable replay requires a newly provided disposable policy with `acknowledgement: "environment-is-disposable"` and exact allowed origins.

The policy is validated before each browser attempt and installed through the WES-186 enforcement layer. A policy denial is a hard boundary:

- it is recorded as sanitized replay failure evidence;
- the repair callback is not invoked;
- the workflow returns blocked;
- no disposable permit or policy-guard state is serialized;
- no replay authority carries into review, approval, or final capture.

Credential entry, payment data, uploads, unsafe schemes, undeclared origins, downloads, and WebSockets remain prohibited in both safe and disposable replay.

## Preflight

Before creating a browser, the coordinator requires all of the following:

1. `sourceSession` validates as a completed `DiscoverySessionV1` with a selected path.
2. `plan` validates as a discovery-v1 `WalkthroughPlan` in `draft` state, with no approval and no execution.
3. Recompiling `sourceSession` produces the same canonical execution content, plan ID, source session ID, and selected-path fingerprint as `plan` after validation/approval/execution annotations are removed.
4. Every step is resolved and supported by replay.
5. Each runtime input binding has exactly one provided string value; repeated uses of the same binding remain valid; unexpected keys fail preflight.
6. Runtime values are bounded and not secret-like. Values never enter result objects, errors, logs, plan artifacts, repair evidence, or child-session requirements.
7. The replay policy is valid for the plan target and every explicit navigation origin.
8. `maxRepairs` is an integer from zero through two.

Preflight failures return fixed errors and do not invoke the browser or repair provider.

## Attempt Execution

Each attempt starts from a new browser and follows the compiled steps in order.

- `navigate` validates the URL, navigates, and waits for bounded settling.
- `click` deterministically resolves the accessible label, optional role, and optional occurrence. Zero matches fails with `target_not_found`; multiple matches without an occurrence fail with `ambiguous_target`; a specified occurrence must exist.
- `type` performs the same deterministic matching, resolves its already-validated runtime binding in memory, authorizes the action under replay policy, and types the actual demo value without persisting it.
- `wait` waits only the plan's bounded duration and then settles.
- visible-state assertions use their structured condition, role, and occurrence.
- navigation assertions compare sanitized URLs using their recorded `exact-url` or `same-origin-path` mode.
- question or unresolved steps fail closed during preflight and are never attempted.

After every state-changing operation, the runner finishes the policy guard and waits for deterministic page readiness before the next step. Replay uses no natural pacing, pre-roll, final hold, capture adapter, manifest, or media output.

An attempt stops at its first failed step. Continuing after a deterministic state transition failed would produce misleading evidence about downstream steps. The next attempt always begins from the target URL in a new context.

## Structured Failure Evidence

Every attempted replay produces one bounded record:

```ts
type DiscoveryReplayAttempt = {
  attempt: 1 | 2 | 3;
  replayId: string;
  planId: string;
  sourceSessionId: string;
  selectedPathFingerprint: string;
  status: "passed" | "failed";
  checks: WalkthroughPlanValidationCheck[];
  failure?: DiscoveryReplayFailureEvidence;
};

type DiscoveryReplayFailureEvidence = {
  schemaVersion: 1;
  code: DiscoveryReplayFailureCode;
  repairability: "repairable" | "hard-boundary";
  step?: {
    id: string;
    order: number;
    action: WalkthroughPlanStepAction;
    summary: string;
    provenance?: WalkthroughPlanStepProvenance;
  };
  expected?: WalkthroughPlanAssertion | WalkthroughPlanTargetHint;
  observed: {
    url?: string;
    candidates?: DiscoveryReplayMatch[];
  };
  recommendation:
    | "rediscover-target"
    | "rediscover-route"
    | "refresh-expectation"
    | "retry-after-stability"
    | "request-policy-boundary";
};
```

Failure codes cover target absence, target ambiguity, navigation mismatch, visible-state mismatch, navigation failure, action failure, timing failure, missing or invalid runtime input, policy denial, replay setup failure, and invalid repair output.

Step evidence is present for failures reached during plan execution and includes the failed step's WES-187 provenance when available, so the host can identify the original attempt and expectation. Browser setup and initial-policy failures have no step. Evidence may include the sanitized current URL and at most five accessible candidate summaries. It never includes runtime input values, raw page text, titles, HTML, selectors, screenshots, request bodies, caught exception messages, policy permits, or unrelated discovery attempts.

IDs and summaries pass existing discovery/walkthrough sanitizers. Fixed size limits apply to attempts, checks, candidates, strings, and serialized results.

## Repair Loop And Lineage

Only target, navigation, visible-state, ordinary action, and bounded-stability failures are repairable. Invalid artifacts, missing inputs, browser setup failures, policy denials, secret-like values, and invalid repair output are hard boundaries.

For a repairable failure:

1. Close the failed replay browser.
2. If no repair provider exists or the repair budget is exhausted, return the blocked result with accumulated attempt evidence.
3. Call the repair provider once with the current plan, its current source session, and the failure evidence.
4. If the provider stops, return blocked with its fixed sanitized stop reason.
5. Validate the returned artifact as a completed discovery session.
6. Require `child.parentSessionId === parentSession.id`, a new session ID, the same sanitized goal as the root session, and a start origin allowed by the current replay policy.
7. Compile the child through `compileDiscoverySessionToWalkthroughPlan()`.
8. Require a new selected-path fingerprint and a valid draft, unapproved plan.
9. Use the child and compiled plan as the parent pair for the next attempt.

Each subsequent repair must be a direct child of the immediately previous completed session, producing a linear chain of at most two children. Sibling repairs, skipped parents, cyclic IDs, an unchanged selected-path fingerprint, or a host-supplied plan are rejected.

The coordinator does not mutate the original plan or session. All returned artifacts are structured clones.

## Successful Promotion

A successful attempt has one passed check for every executable plan step, no blockers, and no policy violations. The coordinator then attaches replay validation to the final compiled plan:

```ts
type WalkthroughPlanValidationBase = {
  status: "ready" | "blocked";
  validatedAt: string;
  checks: WalkthroughPlanValidationCheck[];
  blockers: WalkthroughPlanValidationBlocker[];
};

type WalkthroughPlanValidation =
  | (WalkthroughPlanValidationBase & { mode: "dry-run" })
  | (WalkthroughPlanValidationBase & {
      mode: "discovery-replay";
      replay: {
        replayId: string;
        attempts: 1 | 2 | 3;
        sourceSessionId: string;
        selectedPathFingerprint: string;
      };
    });
```

The final plan becomes `state: "validated"`, retains `mode: "validate-first"`, clears any prior approval or execution state, and remains `approvals: { required: true, approved: false }`. Its compact replay summary and checks participate in the existing approval fingerprint.

The success result also returns the full bounded attempt history and `reviewWalkthroughPlan(finalPlan)`, making the plan immediately reviewable and eligible for explicit validated approval. Failed-attempt history stays in the coordinator result rather than the plan artifact; the final plan's discovery source already binds its execution content to the repaired child session.

No success path calls `approveWalkthroughPlan()`, `executeWalkthroughPlan()`, a capture adapter, or a handoff API.

## Result Shape

```ts
type DiscoveryReplayResult =
  | {
      ok: true;
      plan: ValidatedWalkthroughPlan;
      sourceSession: DiscoverySessionV1;
      attempts: DiscoveryReplayAttempt[];
      review: WalkthroughPlanReview;
    }
  | {
      ok: false;
      phase: "preflight" | "replay" | "repair";
      plan?: WalkthroughPlan;
      sourceSession?: DiscoverySessionV1;
      attempts: DiscoveryReplayAttempt[];
      errors: DiscoveryReplayError[];
    };
```

Expected invalid input and runtime failures return results rather than throwing. The public boundary catches unknown dependency exceptions and replaces them with fixed setup, replay, or repair errors. Programmer defects may still be asserted in internal development, but arbitrary exception messages never cross the public boundary.

## Compatibility

- Existing deterministic-v1 plans continue using `validateWalkthroughPlan()` unchanged.
- Existing dry-run validation artifacts remain valid; the validation-mode union adds `discovery-replay` without rewriting old artifacts.
- Review renders discovery replay as fresh-context verification and includes the compact replay count.
- Approval remains eligible only for blocker-free validated plans and fingerprints the final replay validation.
- Refinement still invalidates validation and approval. Direct manual refinement also breaks the canonical source-session/plan match, so it cannot claim evidence-backed replay validation; the host must express an automatic repair through a completed child discovery session and recompilation. The existing manual refinement path may still use ordinary dry-run validation.
- Final execution continues to require explicit approval and does not consume replay policy or repair history.
- The WES-187 compiler remains pure and unaware of browser replay.

## Security And Privacy

- Validate all artifact inputs and recompile rather than trusting claimed provenance.
- Use a new isolated browser for every attempt and close it before host repair.
- Default to a safe exact-origin policy and require fresh explicit disposable acknowledgement.
- Resolve runtime values only after preflight and policy checks; never serialize them.
- Keep credential, payment, upload, unsafe-origin, download, and WebSocket prohibitions as hard boundaries.
- Sanitize current URLs and candidate descriptors before returning evidence.
- Never persist selectors, locators, DOM, page text, screenshots, response bodies, or caught exception text.
- Never infer authority from a prior discovery or successful mutation.
- Keep approval mandatory and prohibit best-guess bypass for discovery plans.
- Bound attempts, repairs, candidates, strings, checks, timeouts, and serialized output.

## Testing Strategy

Tests should assert public behavior and user-facing effects, not private helper calls or implementation mechanics.

### Core replay behavior

- A compiled discovery plan replays in a fresh fake browser and becomes validated, reviewable, and unapproved.
- Every attempt receives a different browser instance and every browser closes exactly once on success and failure.
- Accessible label, role, and occurrence matching drives click, type, and visible assertions deterministically.
- Navigation assertions honor exact and same-origin-path matching.
- Actual runtime demo inputs drive dependent state while values remain absent from every serialized result.
- Repeated bindings resolve once and work in every referencing step; missing, invalid, secret-like, and unexpected bindings fail before browser creation.
- Replay fails fast at the first failed step and does not claim checks for dependent steps.
- Caller input objects remain unchanged.

### Repair behavior

- A missing target produces sanitized evidence with the originating attempt provenance and bounded candidates.
- One completed child session recompiles and succeeds on a second fresh replay.
- Two sequential children can reach the third and final replay.
- The default and hard repair limit prevent a fourth replay.
- Missing providers, explicit host stop, exhausted repairs, and hard boundaries return stable blocked results.
- Non-child, active, failed, cyclic, unchanged-path, wrong-goal, out-of-policy, or malformed repair sessions fail closed.
- A repair provider cannot inject a plan directly or preserve prior approval.

### Policy and privacy

- Omitted policy creates safe exact-origin replay.
- Explicit multi-origin safe policy works only for declared origins.
- Disposable replay requires a fresh acknowledgement and does not enter the plan or result.
- Policy denial never invokes repair.
- Credential, payment, upload, request, download, WebSocket, popup, and unsafe-navigation attempts remain blocked.
- Runtime values, secret-like strings, raw DOM, selectors, screenshots, query secrets, and exception messages never appear in plans, errors, attempt evidence, reviews, or JSON serialization.

### Lifecycle compatibility

- Deterministic-v1 dry-run validation remains unchanged.
- Existing dry-run validation artifacts still validate and review.
- Discovery replay validation is included in approval fingerprints.
- Any step, assertion, provenance, replay summary, or manual refinement change invalidates prior approval or replay validation.
- A successful replay is eligible for validated approval but is never automatically approved, executed, captured, or handed off.

Use fake replay browsers and repair providers for core coverage. Add focused Playwright fixture coverage for fresh-context isolation, target ambiguity, input-dependent state, navigation assertions, and policy enforcement. Run the agent package suite plus repository build, typecheck, lint, formatting, and workspace tests.

## Documentation

Update the agent package documentation to show the full boundary:

1. discover and complete a safe or explicitly disposable session;
2. compile its selected path into a draft unapproved plan;
3. replay in a fresh context;
4. repair through bounded child discovery sessions when needed;
5. review and explicitly approve the blocker-free validated plan;
6. execute final capture and project handoff through the existing commands.

The example must state that repair is host-owned, replay input values are runtime-only, each attempt uses a fresh browser, policy authority is newly established for replay, and neither replay nor repair can approve or capture.

## Downstream Contract

WES-189 receives one library operation that either returns a blocker-free validated plan plus review, or returns bounded failure evidence suitable for conversational reporting. Codex may implement the repair provider by observing and acting through Auto Demo's existing discovery interfaces, but it must pause at policy hard boundaries and request explicit approval after successful replay.

WES-191 may later simplify legacy intake without changing this replay contract. WES-190 can exercise the public host workflow against deterministic fixtures and prove final recording and project handoff.

## Spec Self-Review

- Placeholder scan: no TBD, TODO, or incomplete sections remain.
- Consistency check: the API, fresh-browser lifecycle, repair callback, lineage rules, policy boundaries, promotion behavior, and downstream handoff all describe the same coordinator-owned workflow.
- Scope check: this is one implementation slice in `@auto-demo/agent`; host workflow, approval conversation, capture, cleanup, and milestone acceptance remain downstream.
- Ambiguity check: retry bounds, repairable failures, lineage, runtime inputs, safe defaults, disposable replay, failed-step behavior, and approval boundaries are explicit.
