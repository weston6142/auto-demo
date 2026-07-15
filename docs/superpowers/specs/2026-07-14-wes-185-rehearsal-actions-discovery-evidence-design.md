# WES-185 Rehearsal Actions And Discovery Evidence Design

## Context

WES-183 added the versioned `DiscoverySessionV1` artifact and immutable lifecycle operations for bounded observations, attempted actions, selected successful paths, and terminal sessions. WES-184 added stateful Playwright observation extraction with bounded visible state, stable opaque target IDs, target-liveness checks, sanitized diagnostics, and optional screenshot references.

The remaining gap is orchestration. A host agent can inspect a rehearsal page but cannot yet ask Auto Demo to execute an action and atomically record the resulting WES-183 attempt and page evidence. WES-185 supplies that controller without launching a browser, implementing safety policy, compiling a walkthrough plan, or starting final media capture.

## Goal

Add a stateful rehearsal controller to `@auto-demo/agent` that operates an existing host-owned browser page. It must let a host start a discovery session, perform authorized browser actions, record each attempted action and resulting bounded evidence, retry explicitly, preserve abandoned exploration outside the selected successful path, and stop through an explicit completed or abandoned terminal outcome.

## User Experience Across The Milestone

The WES-185 portion of the eventual host flow is:

1. The host creates an isolated rehearsal browser and supplies its existing Playwright `Page`.
2. The host creates a controller with a required action authorizer and runtime input resolver.
3. `start()` creates the WES-183 session and records the initial page observation.
4. The host chooses actions from bounded observations and calls atomic `perform()` operations.
5. The controller authorizes, executes or blocks, observes, evaluates declared expectations, and records one finalized attempt.
6. Failed or stale-target actions remain evidence. The host may explicitly retry with `retryOfAttemptId`.
7. The host may backtrack and explore another branch. All attempts remain recorded, while the eventual selected path references only one continuous successful route.
8. The host explicitly completes with selected attempt IDs or abandons with a safe reason.
9. The host retains ownership of the browser page and decides when to close it.

WES-187 later compiles a completed selected path into `WalkthroughPlan`. WES-185 never starts final capture.

## Scope And Linear Boundaries

WES-185 owns:

- a generic stateful `DiscoveryRehearsalController`;
- a Playwright controller factory for an existing host-owned `Page`;
- an explicit `start()`, atomic `perform()`, explicit `stop()`, and snapshot API;
- a session-scoped rehearsal driver that observes and acts through one opaque-target registry;
- a required action-authorization interface and blocked-attempt recording;
- a required runtime input-binding resolver for non-secret demo values;
- deterministic action execution and expectation matching;
- explicit stale-target and action retry evidence;
- recoverable attempt failures and terminal browser-loss behavior;
- single-operation concurrency protection;
- stable structured controller results, diagnostics, and errors;
- behavior-focused fake-driver and Playwright-backed tests;
- agent-package and repository documentation.

WES-185 does not:

- launch, close, or otherwise own a browser, context, or page;
- ship a permissive default authorizer;
- implement WES-186 safe-default or disposable-environment policy;
- accept or persist credentials, secrets, customer data, cookies, headers, storage state, DOM, selectors, or network bodies;
- compile `DiscoverySessionV1` into `WalkthroughPlan`;
- replay or repair compiled plans;
- add a CLI command or agent-host prompt;
- persist session JSON or define an artifact bundle;
- start viewport media recording or final capture;
- import a capture into a project, open the editor, or render an export.

Downstream ownership remains:

- WES-186 supplies the concrete safe-default and explicitly disposable-origin policy.
- WES-187 compiles selected discovery evidence into an unapproved `WalkthroughPlan`.
- WES-188 performs deterministic replay and bounded repair.
- WES-189 exposes the Codex discovery and approval workflow.

## Chosen Approach

Use a composed rehearsal driver behind a generic stateful controller.

The driver exposes observation, target liveness, and low-level browser action execution over one session-scoped target registry. The controller separately owns orchestration, WES-183 session transitions, authorization, runtime input resolution, expectation matching, and public results.

This keeps WES-184 observation output unchanged while allowing WES-185 to resolve opaque target IDs safely. It also makes the controller testable through a fake driver instead of private Playwright mechanics.

Rejected approaches were:

- extending `DiscoveryObservationExtractor` with action methods, which would mix the completed WES-184 observation boundary with browser mutation;
- a single Playwright-only controller containing policy, target lookup, actions, observation, and session recording, which would be tightly coupled and difficult to test behaviorally.

## Architecture

The design has five focused units.

### Discovery Rehearsal Controller

`DiscoveryRehearsalController` is the public stateful facade. It owns the current immutable `DiscoverySessionV1`, validates lifecycle transitions, admits only one operation at a time, and returns updated session snapshots after successful state changes.

It does not expose the target registry, browser handles, resolved input values, or mutable session internals.

### Discovery Rehearsal Driver

`DiscoveryRehearsalDriver` is the narrow browser boundary used by the generic controller. It provides:

- bounded observation compatible with `recordDiscoveryObservation()`;
- `hasLiveTarget(targetId)`;
- execution of navigate, click, type, wait, inspect, back, and refresh actions;
- fixed sanitized runtime outcomes;
- browser availability classification.

The Playwright driver shares the document-scoped registry used for WES-184 observation extraction. A target ID received in an observation is resolved only through that registry. Navigation or document replacement invalidates prior-document target IDs.

The existing WES-184 public observation factories and observation shape remain compatible. Internal extraction and target-registry code may be refactored for sharing, but WES-184 behavior must not change.

### Discovery Action Authorizer

`DiscoveryActionAuthorizer` is required. It receives only:

- the sanitized proposed action;
- the current bounded observation;
- allowlisted session metadata;
- safe target metadata for click or type actions.

It returns either a structured block decision with a fixed safe reason or an allow decision with an opaque runtime permit. A blocked decision is recorded as a finalized `blocked` attempt and never reaches the driver.

The permit is passed to the paired driver for the action lifetime but is never interpreted by the controller, persisted in the session, or included in public results. This seam allows WES-186 to coordinate pre-action decisions and scoped runtime protections without putting disposable-environment authority into `DiscoverySessionV1`.

WES-185 ships no allow-by-default authorizer. Tests and explicit host integrations provide their own authorizer until WES-186 supplies the product policy.

### Discovery Input Resolver

`DiscoveryInputResolver` is required for controller construction and is called only for an allowed `type` action. The persisted action contains only its `inputBinding` and `demo-data` classification.

The resolver returns the runtime value immediately before driver execution. The controller passes that value directly to the driver and never copies it into a session, result, diagnostic, error, log field, or authorization request. Missing bindings and resolver failures produce fixed safe failures without echoing keys or values beyond an already validated safe binding identifier.

### Deterministic Dependencies

The controller uses injectable clock and opaque-ID generation dependencies for operation timestamps and child records such as observations and attempts. The caller still supplies the stable top-level session ID. Production defaults may use the system clock and UUID-backed safe IDs. Tests inject deterministic values.

## Public API

The initial factories are:

```ts
createDiscoveryRehearsalController(dependencies);
createPlaywrightDiscoveryRehearsalController(page, options);
```

The generic factory accepts a rehearsal driver, required authorizer, required input resolver, and optional deterministic clock and ID dependencies. The Playwright factory accepts an existing `Page` and constructs the shared-registry driver. Neither factory launches or closes browser resources.

The returned controller exposes:

```ts
interface DiscoveryRehearsalController {
  start(input: DiscoveryRehearsalStartInput): Promise<DiscoveryRehearsalResult>;
  perform(input: DiscoveryRehearsalActionInput): Promise<DiscoveryRehearsalResult>;
  stop(input: DiscoveryRehearsalStopInput): Promise<DiscoveryRehearsalResult>;
  getSession(): DiscoverySessionV1 | undefined;
}
```

`getSession()` returns the current immutable snapshot or `undefined` before a successful start. Callers cannot replace the controller's current state.

### Start Input

`DiscoveryRehearsalStartInput` contains the caller-supplied WES-183 session ID, starting URL, goal, host provenance, and optional parent-session ID. The controller clock supplies `createdAt`, and its ID generator supplies observation and attempt IDs. No field has competing caller-supplied and dependency-generated forms.

`start()`:

1. rejects repeated or concurrent starts;
2. creates a candidate active WES-183 session;
3. obtains one bounded initial observation;
4. records that observation through `recordDiscoveryObservation()`;
5. installs the resulting session as controller state;
6. returns the session and initial observation.

If creation or initial observation fails, the controller remains unstarted.

### Action Input

`DiscoveryRehearsalActionInput` contains:

- one existing WES-183 `DiscoveryAction`;
- zero or more declared expectations;
- confidence level and structured confidence bases;
- optional bounded public confidence note;
- optional `retryOfAttemptId` referencing an earlier finalized attempt.

The controller generates the attempt ID, sequence, before-observation reference, and operation timestamps. The input cannot supply a typed value, target locator, selector, DOM handle, authorization decision, or arbitrary driver options.

### Stop Input

`DiscoveryRehearsalStopInput` is an explicit union:

```ts
type DiscoveryRehearsalStopInput =
  | {
      outcome: "complete";
      attemptIds: string[];
      source: "host-agent" | "user-directed";
    }
  | {
      outcome: "abandon";
      reason: { code: string; summary: string };
    };
```

Completion selects the supplied path through `selectDiscoveryPath()` and immediately freezes it through `completeDiscoverySession()`. If selection or completion validation fails, the active session remains unchanged. Abandonment uses `abandonDiscoverySession()` and preserves all recorded evidence.

There is no inferred outcome, paused state, or generic stop that leaves the controller active. Unrecoverable browser loss uses the existing failed-session transition internally rather than pretending that the host abandoned the work.

## Controller Lifecycle

The controller states are:

- `unstarted` before successful `start()`;
- `active` while the current WES-183 session is active;
- `terminal` after completed, abandoned, or failed session state.

`perform()` is valid only while active. `stop()` is valid only while active. State-changing calls after a terminal outcome return `terminal_discovery_session` without touching the browser or session.

The controller uses a single in-flight-operation guard. A concurrent `start()`, `perform()`, or `stop()` returns `controller_busy` immediately; calls are not silently queued because delayed browser actions would make host intent and observed page state ambiguous.

## Atomic Action Data Flow

One `perform()` operation follows this sequence:

1. Confirm that the controller is active and not busy.
2. Validate the action input without modifying state.
3. Use the most recent recorded observation as the before observation.
4. Ask the required authorizer for an allow or block decision. No runtime input is resolved.
5. Build and begin the WES-183 attempt with explicit generated ID and timestamp.
6. For a block decision, finish the attempt as `blocked` with a fixed safe outcome and return. The page is not touched.
7. For an allowed click or type, check target liveness immediately before execution.
8. For an allowed type, resolve its `inputBinding` and hold the returned value only for the driver call.
9. Execute the action once through the driver with the opaque authorization permit.
10. When the page remains inspectable, obtain and record one fresh bounded observation.
11. Evaluate declared expectations deterministically against the resulting observation.
12. Finalize the attempt as `succeeded` only when the browser action and every declared expectation succeeded. Otherwise finalize it as `failed`.
13. Install and return the updated immutable session plus safe runtime diagnostics.

The controller never silently repeats an action. It never remaps an invalid target by label, role, occurrence, selector, or semantic similarity.

## Action Semantics

### Navigate

The destination must already satisfy WES-183 HTTP(S) URL validation. The driver navigates once and observes the resulting main document. A selected successful navigate attempt must contain a matched navigation expectation, as required by WES-183.

### Click

The target ID must occur in the current observation and remain live immediately before execution. A stale target is recorded as a failed attempt without clicking a replacement.

### Type

The target ID must occur in the current observation and remain live. Authorization happens before input resolution. The driver receives the runtime value and must not return it in its outcome. The value is not retained after the driver call.

### Wait

The existing WES-183 duration bound remains authoritative. The driver waits once, then the controller records the resulting observation.

### Inspect

Inspect performs no page mutation. It records a new observation and evaluates declared expectations. This lets a host establish evidence for an outcome learned during a preceding exploratory action without retroactively editing that attempt.

### Back

Back is authorized like every other action. The driver rejects it when the current bounded observation does not report a known safe back destination. After a successful back action, the controller records a fresh observation.

### Refresh

Refresh reloads the current main document once and records a fresh observation. Prior-document target IDs become stale when the registry reports document replacement.

## Expectations And Evidence

The controller evaluates declared expectations only. It does not invent semantic expectations or modify a finalized attempt after returning it.

Navigation expectations reuse WES-183 matching:

- `exact-url` compares the normalized sanitized URL;
- `same-origin-path` compares scheme, host, effective port, and pathname while ignoring query and fragment.

Visible-state expectations use deterministic matching:

- a target-ID expectation matches only when that opaque ID is present in the resulting observation's visible states or interactive targets;
- a public-condition expectation matches only an exact normalized sanitized visible-state summary or interactive-target label.

There is no fuzzy, model-based, substring, selector, or raw-page match inside the controller. The host can perform a later `inspect` action with an expectation based on the newly known bounded observation.

Every declared expectation receives exactly one matched or unmatched observed effect referencing the resulting observation. An expectation mismatch makes the attempt failed. Runtime diagnostics remain outside the portable session.

## Explicit Retry And Backtracking

Retry is host-directed. A failed, blocked, or otherwise finalized attempt remains unchanged. After inspecting fresh evidence, the host may call `perform()` with `retryOfAttemptId` and a new action against a current live target.

The controller validates that the referenced attempt exists and is finalized. It does not require the new action to copy the prior target or action because navigation or document replacement may make that unsafe or impossible.

Backtracking does not delete evidence. Wrong-route actions and the back action remain in the session. WES-183 permits the selected path to begin at a later successful attempt, so completion may select a continuous successful sequence after the host has returned to a desired baseline. The selected path must still satisfy all WES-183 continuity, ordering, expectation, and visible-evidence rules.

## Result Shape

Public operations return a discriminated union shaped like:

```ts
type DiscoveryRehearsalResult =
  | {
      ok: true;
      session: DiscoverySessionV1;
      observation?: DiscoveryObservation;
      attempt?: DiscoveryAttempt;
      diagnostics: DiscoveryRehearsalDiagnostic[];
    }
  | {
      ok: false;
      session?: DiscoverySessionV1;
      errors: DiscoveryRehearsalError[];
    };
```

Successful blocked or failed attempts use `ok: true` because the controller correctly recorded the requested attempt and remains internally consistent. The returned attempt status and safe outcome describe what happened. `ok: false` is reserved for a rejected controller operation or an inability to preserve a valid state transition.

Expected failures never throw. Unexpected dependency exceptions are caught at the controller boundary and converted to fixed sanitized failures.

## Failure Handling

Failure handling follows three rules.

### Before Attempt Start

Invalid input, unstarted or terminal controller state, controller concurrency, or an authorizer failure leaves the session unchanged. A normal authorizer block is a decision, not an authorizer failure, and proceeds to a recorded blocked attempt.

### After Attempt Start

Missing input bindings, stale targets, recoverable driver failures, expectation mismatches, and recoverable observation failures finalize the attempt as failed when a valid WES-183 transition can still be constructed. No automatic retry occurs.

When the page remains inspectable, the controller records fresh evidence even after a browser action reports failure. When no safe resulting observation is available, failed or blocked attempts may omit the after-observation reference as allowed by WES-183.

### Unrecoverable Browser Loss

If the page is closed, replaced outside the driver contract, or otherwise permanently unavailable, the controller best-effort finalizes any pending attempt and transitions the session to `failed` with a fixed `browser_unavailable` reason. The controller then becomes terminal. It never closes or recreates the page.

If preserving both a finalized attempt and a valid terminal session is impossible, the controller returns the last valid session with a fixed lifecycle error rather than emitting malformed evidence.

## Stable Errors And Diagnostics

The controller reuses WES-183 and WES-184 errors where they precisely apply. Controller-specific error codes initially include:

- `discovery_controller_not_started`;
- `discovery_controller_already_started`;
- `discovery_controller_busy`;
- `discovery_authorization_failed`;
- `discovery_input_resolution_failed`;
- `discovery_target_stale`;
- `discovery_action_failed`;
- `discovery_expectation_unmatched`;
- `discovery_browser_unavailable`;
- `invalid_discovery_rehearsal_input`.

Diagnostics contain only fixed codes, fixed messages, and optional safe counts or record IDs. WES-184 extraction diagnostics may be forwarded unchanged. Diagnostics never contain page content, labels, URLs, selectors, runtime input values, permit contents, exception messages, or omitted text.

## Security And Transcript Safety

The controller rebuilds public inputs and results from allowlisted fields and relies on WES-183 validation before installing session state.

It never accepts or returns:

- raw DOM, selectors, CSS or XPath paths, element handles, or accessibility-tree dumps;
- form values, resolved type values, credentials, cookies, headers, storage state, or request bodies;
- browser exception text, policy internals, opaque permit contents, prompts, reasoning, or host transcripts;
- arbitrary extension objects in actions, outcomes, diagnostics, or errors.

The authorizer acts before runtime input resolution. A blocked type action therefore cannot retrieve its input value. The paired authorizer and driver may use an opaque runtime permit, but that permit never enters portable evidence or final recording authority.

Screenshot behavior remains WES-184's injected-sink responsibility. WES-185 does not automatically enable screenshot persistence.

## Testing Strategy

Tests treat the public controller as a black box. They assert returned sessions, browser-visible effects, terminal states, and secret absence rather than helper calls, registry internals, Playwright query strategies, or private ordering.

### Fake-Driver Behavior Tests

Behavior coverage includes:

- `start()` records exactly one valid initial observation;
- repeated, concurrent, pre-start, and post-terminal operations fail without state corruption;
- allowed navigate, click, type, wait, inspect, back, and refresh actions;
- blocked actions record `blocked` attempts without driver effects or input resolution;
- runtime values reach the fake driver but never the session, result, diagnostics, or errors;
- missing bindings and hostile resolver failures remain sanitized;
- stale targets fail once and explicit retries reference the prior attempt;
- no silent repetition or semantic target remapping;
- recoverable action failures with and without resulting observations;
- unrecoverable browser loss creates a failed terminal session;
- exact navigation, target-ID, and normalized public-condition expectation matching;
- expectation mismatch records a failed attempt;
- explicit completion freezes a continuous evidence-backed selected path;
- wrong-route and backtracking attempts remain outside the selected path;
- explicit abandonment preserves evidence;
- WES-183 observation, attempt, selected-path, serialized-byte, and terminal limits propagate without truncation;
- dependency exception strings and secret-like content never escape.

### Playwright-Backed Behavior Tests

Local deterministic HTML fixtures cover:

- real navigation and resulting URL evidence;
- click effects and visible-state evidence;
- non-secret runtime typing without returned or persisted values;
- wait and inspect behavior;
- known-history back navigation;
- refresh and target invalidation after document replacement;
- duplicate controls through distinct opaque IDs;
- stale-target failure after removal or recreation;
- a wrong branch, backtrack, successful branch, and final selected path excluding abandoned exploration;
- closed-page terminal failure;
- confirmation that no viewport media capture starts.

Repository verification includes:

- focused WES-185 tests;
- the full `@auto-demo/agent` test suite;
- agent package typecheck and build;
- repository build, typecheck, ESLint, and all workspace tests;
- formatting checks for every WES-185 file;
- `git diff --check`;
- full `npm run validate`, with any unrelated preserved failure reported precisely rather than described as a clean pass.

## Documentation

`packages/agent/README.md` will document:

- creating a Playwright controller for an existing page;
- supplying an explicit authorizer and input resolver;
- starting and observing before the first action;
- atomic action execution and returned evidence;
- blocked attempts versus controller errors;
- runtime-only type bindings;
- stale targets and explicit retry;
- explicit completion or abandonment;
- host ownership of browser closure;
- the absence of built-in WES-186 policy, plan compilation, CLI, persistence, and final capture.

The root README will receive a concise capability update and continue to state that the repository does not yet expose the complete agentic discovery CLI workflow.

## Success Criteria

WES-185 is complete when:

- a host can create a controller for an existing Playwright page and record an initial bounded observation through `start()`;
- every supported action is authorized before execution and recorded as one finalized WES-183 attempt;
- blocked actions never touch the page or resolve runtime inputs;
- type actions use runtime-only bindings whose values never enter portable or public artifacts;
- action results record fresh bounded evidence when the page remains inspectable;
- declared expectations are evaluated deterministically without fuzzy or model-owned matching;
- stale targets and failures are recorded once, with all retries explicit and linked;
- abandoned exploration remains in the session but outside a valid selected successful path;
- completion and abandonment are explicit terminal operations;
- unrecoverable browser loss creates a valid failed terminal session when possible;
- controller concurrency cannot create ambiguous page actions or multiple pending attempts;
- the controller never launches, closes, or captures media from the browser;
- public behavior tests and Playwright-backed tests pass without asserting private implementation mechanics;
- package and repository documentation accurately describe the boundary with WES-186 and downstream work.
