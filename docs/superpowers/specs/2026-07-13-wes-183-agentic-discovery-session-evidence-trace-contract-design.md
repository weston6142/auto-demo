# WES-183 Agentic Discovery Session And Evidence Trace Contract Design

## Context

Auto Demo currently turns deterministic script text into a `WalkthroughPlan`, validates that plan in a rehearsal browser, supports structured review and refinement, fingerprints explicit approval, executes the approved plan under capture, and hands the resulting bundle into a loadable project. The current intake path cannot let a host agent inspect an unfamiliar page, explore possible actions, backtrack, and preserve evidence for the successful route.

WES-183 is the contract foundation for the Agentic Flow Discovery milestone. It defines a durable, model-agnostic artifact and immutable lifecycle operations. It does not yet observe or control a browser.

## Goal

Add a versioned discovery-session contract to `@auto-demo/agent` that lets any host record bounded and sanitized page observations, attempted browser actions, outcomes, expectations, confidence, provenance, abandoned exploration, and one selected successful path. A completed session must be portable JSON that WES-187 can later compile into the existing `WalkthroughPlan` lifecycle.

## User Experience Across The Milestone

The eventual user flow is:

1. The user supplies a starting URL and a natural-language demo goal.
2. The user chooses normal safe rehearsal or explicitly authorizes mutation-capable discovery for named disposable origins.
3. A host agent explores in a rehearsal browser, observing, acting, retrying, and backtracking while Auto Demo records sanitized evidence.
4. The host selects the successful evidence-backed route. Abandoned attempts remain available for debugging but do not enter the proposed walkthrough.
5. Auto Demo compiles and deterministically replays the route, returning structured repair evidence if replay fails.
6. The user reviews and explicitly approves the final deterministic walkthrough.
7. Final capture executes only the approved deterministic plan. Disposable or YOLO discovery authority never carries into recording.
8. The existing capture-to-project, editor, and export handoff continues unchanged.

WES-183 implements only the durable artifact and lifecycle foundation behind steps 3 and 4.

## Scope And Linear Boundaries

WES-183 owns:

- JSON-safe version 1 types for sessions, observations, attempts, actions, outcomes, expectations, confidence, provenance, artifact references, and selected paths;
- strict runtime validation and allowlisted sanitization;
- immutable lifecycle operations that never mutate caller-owned values;
- bounded evidence retention;
- selected-path integrity and terminal-state rules;
- stable structured contract errors;
- repository fixtures and behavior-oriented contract tests.

WES-183 does not:

- launch or control Playwright;
- extract observations from a live page;
- enforce browser or network safety policy;
- compile a `WalkthroughPlan`;
- replay or repair a compiled plan;
- add a CLI command;
- read or write session files;
- invoke an LLM or store prompts, reasoning, conversation transcripts, cookies, headers, storage state, raw DOM, or network payloads.

The downstream ownership remains:

- WES-184 produces structured page observations that satisfy this contract.
- WES-185 drives the rehearsal browser and records attempts through these operations.
- WES-186 authorizes or blocks discovery actions according to safe and disposable-environment policy.
- WES-187 compiles a completed selected trace into `WalkthroughPlan`.
- WES-188 replays compiled plans and coordinates bounded repair.
- WES-189 exposes the Codex-facing discovery and approval workflow.

## Chosen Approach

Use one versioned portable JSON session containing bounded append-only observation and attempt records. Each attempt is cohesive: it references its preceding observation, action, expectations, outcome, observed effects, and optional resulting observation. The selected successful path contains ordered attempt IDs rather than copied attempt objects.

This attempt-centric approach is simpler to validate and compile than a flat event-sourced log, while retaining more provenance than checkpoint snapshots or a final-path-only artifact.

## Discovery Session Model

`DiscoverySessionV1` contains:

- `schemaVersion: 1`;
- a caller-supplied stable session ID;
- `status`: `active`, `completed`, `failed`, or `abandoned`;
- a browser target with a sanitized starting HTTP(S) URL;
- a bounded sanitized user goal;
- required host name and version plus an optional model label;
- optional `parentSessionId` for retry or repair lineage;
- explicit ISO timestamps supplied to lifecycle operations;
- ordered observations and attempts;
- an optional selected path;
- terminal information for completed, failed, or abandoned sessions.

IDs and timestamps are explicit inputs rather than hidden time or randomness dependencies. This keeps every lifecycle operation deterministic and straightforward to test. IDs must use the repository's safe identifier rules, and timestamps must be valid normalized ISO strings.

The session's host provenance is public metadata, not an execution transcript. It includes:

- host name;
- host version;
- optional model label;
- sanitized user goal;
- optional parent session ID;
- schema version and timestamps.

Prompts, chain-of-thought, tool transcripts, opaque host state, and user identity are excluded.

## Observation Model

An observation is a bounded sanitized page-state envelope that WES-184 will later populate. It contains:

- stable observation ID, sequence, and timestamp;
- sanitized current URL and title;
- viewport width and height;
- bounded visible-state summaries;
- bounded interactive-target descriptions with opaque target IDs, accessible label, optional role and occurrence, disabled state, and optional action-risk classification;
- navigation state containing `canGoBack` for later back actions;
- optional session-relative artifact references.

Observation target IDs are opaque handles within one session. They do not expose Playwright locators or raw DOM selectors. WES-184 may regenerate targets after navigation; attempts preserve which observation supplied the chosen target.

Artifact references contain only allowlisted metadata:

- stable reference ID;
- kind, initially `screenshot` or `viewport`;
- safe session-relative path;
- media type `image/png` or `image/jpeg`;
- optional SHA-256 digest.

The session never embeds base64 image data. Artifact production, storage, and bundling belong to WES-184 and later integration work.

## Attempt Model

An attempt contains:

- stable attempt ID and sequence;
- `pending`, `succeeded`, `failed`, or `blocked` status;
- preceding observation ID;
- exactly one browser action;
- expectations declared before the action;
- expectations derived from the resulting observation, if any;
- structured observed effects;
- optional resulting observation ID;
- start and finish timestamps;
- confidence level and structured confidence bases;
- optional bounded public confidence note;
- optional `retryOfAttemptId`;
- bounded public outcome code and summary.

Supported version 1 actions are:

- `navigate` with a sanitized HTTP(S) destination;
- `click` with an opaque target ID from the preceding observation;
- `type` with a target ID, runtime-only `inputBinding`, and `demo-data` classification;
- `wait` with a duration from 0 through 30,000 milliseconds;
- `inspect`;
- `back`;
- `refresh`.

Retry is represented through `retryOfAttemptId`, not as a browser action. Stopping is a session lifecycle transition, not an attempt action.

Type actions never accept or persist an entered value. The host or controller supplies the binding value only while operating the browser. This matches final execution's existing runtime-binding model and prevents discovery artifacts from becoming a credential or customer-data store.

## Expectations And Observed Evidence

An attempt may contain navigation and visible-state expectations.

A navigation expectation specifies:

- a sanitized expected URL;
- match mode `exact-url` or `same-origin-path`;
- origin `declared-before-action` or `derived-from-observation`.

`exact-url` compares the complete normalized sanitized URL. `same-origin-path` compares scheme, host, effective port, and pathname while ignoring query and fragment.

A visible-state expectation specifies:

- an opaque visible target ID or bounded sanitized public condition;
- optional accessible role;
- origin `declared-before-action` or `derived-from-observation`.

Observed effects remain separate from expectations. Each observed effect:

- references an expectation ID;
- reports `matched` or `not-matched`;
- references the resulting observation that supports the claim;
- contains only a bounded sanitized public summary.

Derived expectations are permitted because discovery often learns the meaningful outcome after acting. Their explicit origin prevents after-the-fact evidence from being misrepresented as a prediction. WES-188 later verifies either kind in a fresh browser; WES-183 validates only structural correspondence between expectations and recorded observations.

A selected attempt cannot be successful if any expectation is unmatched. Selected navigation attempts require matched navigation evidence. A completed selected path must contain at least one matched visible-state expectation so compilation cannot produce a click sequence with no demonstrated user-visible outcome.

## Confidence

Confidence uses an ordinal value instead of a probability:

- `high`;
- `medium`;
- `low`.

Every confidence value includes one or more structured bases from an allowlist initially containing:

- `exact-accessible-target`;
- `expected-navigation-observed`;
- `expected-visible-state-observed`;
- `positional-intent`;
- `host-inference`.

An optional public note may explain uncertainty. Numeric values are excluded because scores from different hosts and models are not reliably comparable.

## Selected Path

The selected path stores an ordered list of attempt IDs, selection timestamp, and selection source `host-agent` or `user-directed`. It does not copy attempt or observation objects.

Selection is valid only when:

- every referenced attempt exists exactly once;
- every referenced attempt is finalized and succeeded;
- the IDs are in increasing attempt order;
- the resulting observation of each attempt is the preceding observation of the next attempt;
- each expectation has matched observed evidence;
- target references resolve against each attempt's preceding observation;
- navigation attempts contain matched navigation evidence.

Selection may be replaced while a session is active. Completing the session freezes the selected path and requires it to be non-empty with at least one matched visible-state expectation.

Abandoned, failed, and blocked attempts remain in the artifact but cannot enter the selected path.

## Lifecycle And Public API

The public API follows the package's existing discriminated-result style. Successful operations return `{ ok: true, session }`; expected failures return `{ ok: false, errors }`.

The first public operations are:

- `createDiscoverySession(input)`;
- `recordDiscoveryObservation(session, observation)`;
- `beginDiscoveryAttempt(session, attemptInput)`;
- `finishDiscoveryAttempt(session, attemptId, outcomeInput)`;
- `selectDiscoveryPath(session, selectionInput)`;
- `completeDiscoverySession(session, terminalInput)`;
- `failDiscoverySession(session, terminalInput)`;
- `abandonDiscoverySession(session, terminalInput)`;
- `createChildDiscoverySession(terminalSession, input)`;
- `validateDiscoverySession(value)`.

All state-changing inputs include their IDs and timestamps explicitly. Every operation constructs a new allowlisted value and leaves the input object unchanged.

`finishDiscoveryAttempt()` accepts the finalized status, optional resulting observation ID, derived expectations, observed effects, and bounded public outcome. Failed or blocked attempts may omit a resulting observation when the page is no longer safely inspectable.

An active session may have at most one pending attempt. The intended downstream controller flow is:

1. Record a bounded observation.
2. Let the host choose an action, expectations, and confidence.
3. Let the safety layer authorize or block the action.
4. Begin the attempt before browser execution.
5. Perform or block the action.
6. Record the resulting observation when the browser remains inspectable.
7. Finish the attempt with outcome and observed effects.
8. Repeat, select successful attempt IDs, and complete the session.

Beginning the attempt before execution makes interruption explicit. A pending attempt cannot enter the selected path or a completed session. The host must finish it or transition the session to failed or abandoned.

`completed`, `failed`, and `abandoned` are terminal. They reject further observations, attempts, or path selection. Repair or continuation creates a new active session through `createChildDiscoverySession()` and records the prior ID as `parentSessionId`.

A completed session contains `completedAt` terminal information and its frozen top-level selected path. Failed and abandoned terminal information contains its transition timestamp plus a safe reason code and bounded sanitized public summary. Terminal records cannot contain arbitrary host data.

## Fixed Version 1 Bounds

All hosts use the same fixed contract limits:

- 256 observations per session;
- 256 attempts per session;
- 128 attempt IDs in the selected path;
- 100 interactive targets per observation;
- 50 visible-state summaries per observation;
- 8 artifact references per observation;
- 128 characters per identifier, binding key, host name/version, model label, reason code, or outcome code;
- 2,000 characters per individual public string;
- 5 MiB maximum serialized session size.

The 5 MiB limit reserves the final 64 KiB for selected-path and terminal metadata. Evidence append operations refuse a candidate artifact above 5 MiB minus that reserve. Path selection and terminal transitions must remain within the full 5 MiB limit.

Crossing a limit returns `session_limit_exceeded`. Existing evidence is never truncated or evicted. The active session remains usable for path selection or a terminal transition.

Automatic summarization is excluded because it would introduce model-specific judgment into the contract layer and could break selected-path provenance.

## Sanitization And Security

Ingestion operations rebuild observations, attempts, and terminal records from allowlisted fields and reuse the existing walkthrough text and URL sanitization rules where applicable. Public text is bounded and secret-like values are redacted before entering the returned session.

The contract accepts only HTTP(S) browser URLs, rejects embedded credentials and credential-like target URLs, and never echoes rejected URL values. Artifact paths must be normalized POSIX-style session-relative paths with no absolute path, traversal segment, or URL scheme. Because WES-183 performs no filesystem access, later artifact consumers remain responsible for rejecting symlink escapes while resolving those paths.

The contract has no field for typed values, request headers, cookies, storage state, DOM, network bodies, model prompts, reasoning, or arbitrary extension data. Unknown object properties are rejected.

`validateDiscoverySession()` is non-mutating. It rejects unsafe, unknown, malformed, or unsupported-version content instead of silently rewriting a loaded artifact.

## Error Handling

Expected contract failures never throw. They return one or more stable errors with a code, safe message, and optional safe field path or record ID. Messages never echo rejected values.

Version 1 error codes include:

- `invalid_discovery_session`;
- `invalid_discovery_input`;
- `unsupported_discovery_schema`;
- `invalid_discovery_transition`;
- `terminal_discovery_session`;
- `session_limit_exceeded`;
- `duplicate_discovery_record`;
- `missing_discovery_reference`;
- `inconsistent_discovery_reference`;
- `pending_attempt_conflict`;
- `pending_attempt_required`;
- `invalid_selected_path`;
- `expectation_evidence_missing`;
- `unsafe_discovery_url`;
- `unsafe_discovery_content`;
- `invalid_discovery_artifact_reference`.

The validator accumulates independent structural errors where doing so remains safe. Lifecycle operations stop without returning a modified session when their preconditions fail.

## Testing Strategy

Tests treat the public API as a black box and assert returned artifacts and errors rather than helper calls or internal data structures.

Behavior coverage includes:

- creating an active session and round-tripping it through JSON;
- recording observations and completing successful, failed, and blocked attempts;
- rejecting concurrent pending attempts;
- selecting a continuous successful path;
- rejecting missing, duplicated, failed, reordered, or disconnected attempt IDs;
- rejecting selected attempts with missing or unmatched expectation evidence;
- requiring navigation evidence and at least one final visible-state expectation;
- completing, failing, abandoning, and creating child-session lineage;
- rejecting mutation after every terminal state;
- enforcing each fixed bound without evicting prior evidence;
- rejecting unknown schema versions and unknown fields;
- rejecting unsafe URLs, artifact paths, embedded typed values, and secret-like content without echoing them;
- proving every operation leaves its input object unchanged;
- proving explicit IDs and timestamps produce deterministic JSON-safe results.

Tests use plain fixtures and fake values. WES-183 has no Playwright, filesystem, or network tests.

Repository fixtures include:

- one completed discovery session containing a simple successful path for the WES-187 handoff;
- one completed session retaining abandoned exploration while selecting only the successful attempts;
- representative invalid artifacts for unsupported version, broken references, unsafe content, and exceeded bounds where fixture size remains practical.

Package typecheck, build, lint, focused tests, and the repository validation command remain the implementation verification baseline.

## Documentation

Update the package and root documentation with:

- the model-agnostic discovery artifact's purpose;
- lifecycle and terminal-state rules;
- the binding-only input and transcript-safety model;
- selected-path semantics;
- the boundaries between WES-183 and WES-184 through WES-189;
- a clear statement that no public discovery CLI or live browser workflow exists yet.

The project map should link this design and record WES-183's approved scope.

## Alternatives Considered

### In-memory session with final export

This is operationally simple but cannot naturally survive process interruption or move between host-agent calls. It would force WES-185 or WES-189 to invent checkpointing later.

### Append-only event-sourced session

This preserves the strongest audit trail, but every consumer must fold events to reconstruct state, sanitization mistakes become harder to repair, and it introduces replay complexity before WES-188 needs it.

### Full checkpoint snapshots

Self-contained snapshots are easy to inspect individually but duplicate page and session data, enlarge artifacts, and risk inconsistent copied state.

### Final successful path only

Discarding failed attempts produces the smallest artifact but loses evidence needed to understand ambiguity, debug host behavior, and support WES-188 repair.

## Success Criteria

WES-183 is complete when:

- `@auto-demo/agent` exposes the versioned contract and immutable lifecycle operations;
- valid sessions round-trip through JSON and invalid artifacts return stable non-secret errors;
- bounded observations and attempts preserve both abandoned exploration and one referenced successful path;
- completed sessions enforce continuous successful evidence with navigation and visible-state assertions;
- runtime-only type bindings and allowlisted sanitization prevent sensitive values from entering artifacts;
- repository fixtures demonstrate the future WES-187 handoff;
- behavior-oriented tests and repository validation pass;
- documentation clearly preserves all downstream Linear boundaries.
