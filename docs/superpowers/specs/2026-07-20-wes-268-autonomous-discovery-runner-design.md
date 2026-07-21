# WES-268 Repository-Owned Autonomous Discovery Runner Design

Date: 2026-07-20  
Issue: WES-268, “Provide a repository-owned autonomous discovery runner”

## Goal

Provide one supported `@auto-demo/agent` orchestration boundary that owns the complete discovery lifecycle around an agent-supplied decision provider. The runner launches fresh browser contexts, applies an explicit risk tier, persists every accepted state transition, compiles and freshly replays the selected path, performs at most two evidence-backed repairs, and stops with a sanitized review that still requires explicit approval. A separate post-approval entry point re-establishes the same tier in a fresh recording phase, executes the approved plan, and hands the capture into a new project without opening the editor or exporting.

## Scope

WES-268 owns:

- a public two-phase autonomous runner API in `@auto-demo/agent`;
- one required, validated discovery policy and one bounded browser launch-profile plan per run;
- a model-agnostic decision-provider contract that can choose one structured action, complete a selected path, or abandon;
- runner-owned root and repair browser lifecycles using fresh isolated contexts;
- durable write-before-continue persistence after session start, every attempted action, terminal session transitions, compilation, replay, review, approval intake, recording, and handoff;
- automatic compilation, fresh replay, and the existing maximum of two direct-child repairs;
- a transcript-safe `review_required` result that cannot record or hand off;
- a post-approval entry point that verifies the persisted run, risk tier, approved plan, and replay lineage before invoking recording and handoff dependencies;
- a default atomic filesystem artifact store plus public in-memory/testing seams;
- package and Codex-wrapper documentation that replaces ad hoc lifecycle scripts with the runner.

WES-268 does not embed a model, choose the user's risk tier, infer approval, add an interactive discovery CLI, weaken policy rules, change the discovery or walkthrough schemas, open the editor, export video, or perform the live Cars.com acceptance owned by WES-273.

## Existing Boundaries

The runner composes rather than replaces the established contracts:

- `createPlaywrightDiscoveryBrowserLauncher()` resolves a bounded discovery-only launch-profile fallback and returns one fresh page.
- `createPolicyEnforcedPlaywrightDiscoveryRehearsalController()` performs exactly one authorized action and returns bounded observations and a new immutable session value.
- `compileDiscoverySessionToWalkthroughPlan()` creates the draft plan.
- `replayAndRepairDiscoveryPlan()` and `createPlaywrightDiscoveryReplayBrowserFactory()` enforce fresh replay, fixed launch-profile parity, hard policy boundaries, and at most two repairs.
- `reviewWalkthroughPlan()` produces the transcript-safe approval view.
- `approveWalkthroughPlan()`, `executeWalkthroughPlan()`, and the existing project handoff path remain the approval, recording, and import authorities.

## Approaches Considered

### Public Two-Phase Orchestration API With Pluggable Decisions (Selected)

Add a repository-owned coordinator with a narrow decision-provider interface and an atomic artifact-store interface. The coordinator owns all lifecycle order and browser resources; a host supplies only bounded decisions, runtime input resolution, and the already-established recording/handoff adapters.

This directly removes the error-prone lifecycle logic from one-off scripts while keeping Auto Demo model-agnostic. It also makes the mandatory review boundary explicit in the type system: discovery returns `review_required`; recording is a separate call requiring a freshly supplied approved plan.

### Stateful JSON-Lines CLI

A long-running CLI could emit observations and accept actions on standard input. It would remove scripts for shell-driven hosts, but it would add a new transport protocol, process-resume semantics, interactive parsing, and compatibility surface while still needing a host to make decisions. That transport can be layered over the public runner later without duplicating lifecycle logic.

### Extend The Codex Skill Again

More instructions and a checked-in sample script would be smaller, but lifecycle correctness would still depend on every host reproducing persistence, cleanup, replay, repair, and approval sequencing. That is the failure mode WES-268 exists to remove.

## Public API

The discovery phase exposes `runAutonomousDiscoveryToReview(input, dependencies)`.

`input` contains a safe run ID, workflow directory, target URL, bounded goal, explicit `DiscoveryPolicy`, bounded browser launch-profile plan, host provenance, and optional named runtime bindings. The policy is required; generic “autonomous” wording never selects or changes a tier.

The decision provider receives only a cloned validated session, the latest bounded observation, diagnostics, and optional bounded replay-failure context. It returns exactly one of:

- `act`, containing one `DiscoveryRehearsalActionInput`;
- `complete`, containing the continuous successful attempt IDs and source;
- `abandon`, containing a bounded code and summary.

The runner returns `review_required` with a validated unapproved plan, sanitized review, replay-attempt count, and artifact paths; `abandoned` with the persisted terminal session and bounded reason; or `blocked`/`failed` with a fixed phase and sanitized errors.

The post-approval phase exposes `completeApprovedAutonomousDiscovery(input, dependencies)`. It requires the workflow directory, the explicitly approved plan returned by the existing approval API or CLI, a freshly supplied `DiscoveryPolicy`, local runtime bindings, capture directory, project directory, and project name. It loads the persisted review checkpoint and rejects a stale, unapproved, mismatched, or already-recorded plan. It verifies that the fresh policy has the reviewed tier and normalized scope, passes that fresh policy into the recording dependency as new phase authority, requires a new capture context using the exact resolved launch profile, persists a bounded execution summary, then invokes handoff and persists a bounded final summary. No discovery page, context, permit, acknowledgement object, cookies, storage, or runtime values cross the review boundary.

## Runner Components

### Orchestrator

`autonomousDiscoveryRunner.ts` owns phase transitions and resource cleanup. Its root-session helper launches through the profile launcher, builds the policy-enforced controller, starts the session with the resolved profile, and loops one decision at a time. It awaits durable persistence before requesting the next decision.

Completion compiles the terminal session, persists the draft, and enters fresh replay. Repair callbacks launch a new isolated discovery session with `parentSessionId`, the same goal, exact policy, and exact resolved profile. They use the same decision provider with bounded replay-failure context. Only completed direct children are returned. The existing replay limit remains authoritative.

Every acquired controller and browser handle is disposed in `finally`. Cleanup failure produces a sanitized failure and preserves the most recent durable artifact.

### Atomic Artifact Store

`autonomousDiscoveryStore.ts` defines a small store contract and a default filesystem implementation. The filesystem store creates one run directory only when it is missing or empty and writes JSON with a temporary sibling followed by rename. Stable file names are runner-owned:

- `run.json` for bounded lifecycle metadata, non-authorizing policy tier/scope selection, selected profile, and artifact references;
- `sessions/root.json` and `sessions/repair-<n>.json`;
- `plan.draft.json` and `plan.replay-validated.json`;
- `replay.json`;
- `review.json`;
- `plan.approved.json`;
- `execution.json`;
- `handoff.json`.

The store never persists runtime binding values, disposable acknowledgements, raw replay objects, or dependency return objects. Replay, review, execution, and handoff files contain exact-schema bounded summaries. It accepts only validated runner artifacts and returns safe relative artifact paths. Existing non-empty directories, unsafe run IDs, and path escape attempts fail closed.

### Recording And Handoff Seam

The agent package must not depend on the CLI or capture package. The completion API therefore takes a `record` dependency and a `handoff` dependency. Unlike an ad hoc host orchestrator, these callbacks do not choose lifecycle order. `record` receives the verified approved plan, freshly supplied policy matching the persisted tier/scope selection, capture directory, and runtime bindings; it must create a fresh isolated capture context. `handoff` receives only a successful execution result and the requested new project metadata.

This dependency direction avoids package cycles while making policy re-establishment observable and testable. The CLI can later expose the runner without changing the lifecycle contract.

## Persistence And Recovery

The runner writes the new session before returning its first observation. After each `perform()` result, including blocked or failed attempts, it writes the entire validated session before another decision is requested. Terminal completion or abandonment is persisted before compilation or return.

`run.json` records a monotonic public phase, the selected policy tier and normalized origin scope without authority-bearing acknowledgement, and safe artifact references. Discovery may resume only from a persisted active session whose run metadata matches the requested target, goal, policy selection, and launch profile. The initial implementation fails closed on active-run resume rather than trying to reconstruct a live browser; durable evidence remains available for a deliberate restart or abandonment. Completed review checkpoints are resumable only through the post-approval API with freshly supplied matching policy authority.

Write failure stops the runner immediately, closes browser resources, and never performs another browser action. A temporary file may remain after a process crash, but the last renamed artifact remains authoritative.

## Mandatory Review And Approval Boundary

The discovery call never accepts an approval flag and never invokes recording or handoff. Even after successful replay it persists an unapproved plan and returns `review_required` with `reviewWalkthroughPlan()` output.

The completion call requires an approved plan whose approval fingerprint is current and whose discovery source session ID, selected-path fingerprint, target, resolved launch profile, and persisted replay-validated plan match the checkpoint. Conversation text, the original request, YOLO selection, or a boolean option cannot substitute for approval evidence.

## Error Handling

- Invalid policy, launch profile, target, goal, run ID, or non-empty workflow directory fails before browser launch.
- Missing or invalid decisions fail and preserve the latest durable session.
- Policy blocks and anti-bot challenges are hard boundaries and do not enter repair.
- Repairable replay failures may create at most two direct-child sessions; exhausted repair returns bounded replay evidence.
- Persistence failure stops before any later action or phase.
- Abandon closes resources, persists an abandoned session, and does not compile.
- Review blockers return a blocked result and never create an approval checkpoint.
- Approval mismatch, stale approval, changed policy/profile, capture collision, recording failure, or handoff failure returns a stable phase-specific result while preserving prior artifacts.
- Caught exception text, raw browser data, selectors, request details, runtime values, cookies, and storage are never returned or persisted.

## Testing Strategy

Tests exercise public behavior with fakes at browser and recording boundaries rather than helper call order.

- A complete root path persists initial and per-action sessions, compiles, uses a fresh replay, writes review artifacts, and returns `review_required` without recording.
- An abandon decision persists the terminal session and closes the browser without compilation.
- A persistence failure prevents the next decision or browser action.
- A repairable replay failure launches one fresh direct-child session, persists it, and promotes only a successful bounded replay.
- Policy and anti-bot hard boundaries do not ask for repair.
- The default file store rejects unsafe/non-empty targets, writes parseable artifacts atomically, and never serializes runtime bindings.
- Completion rejects unapproved, stale, mismatched, and already-completed plans.
- Successful completion requires a freshly supplied policy matching the persisted tier/scope selection, passes it and the exact profile to a fresh recording dependency, persists execution before handoff, creates the project, and never opens or exports.
- Recording and handoff failures preserve the preceding durable checkpoint and expose only bounded errors.
- Package exports, README, Codex skill, and wrapper behavior checks direct normal discovery through the runner.

## Acceptance Criteria

- Normal host integrations use one repository-owned runner instead of reproducing lifecycle scripts.
- The user or host must provide exactly one supported risk tier before any browser activity.
- Browser launch, root and repair isolation, one-action turns, persistence, terminal session handling, compilation, fresh replay, bounded repair, and sanitized review are runner-owned.
- Every accepted session transition is durable before another decision or browser action.
- Successful discovery stops at a replay-validated, blocker-free, unapproved `review_required` result.
- Recording is impossible until a separate call supplies valid explicit approval evidence.
- Post-approval recording receives the exact tier and launch profile in a fresh phase, then completes capture and project handoff without opening the editor or exporting.
- Runtime values and raw/sensitive browser data remain outside durable runner artifacts and conversation-safe results.
- Behavior-focused tests cover success, abandonment, durability failure, repair, hard boundaries, approval rejection, recording, and handoff.

## Self-Review

- Placeholder scan: no TBD, TODO, deferred implementation placeholder, or unspecified error boundary remains.
- Consistency: the two-phase API, persistence contract, policy/profile parity, and mandatory approval boundary agree throughout.
- Scope: one model-agnostic orchestration slice; CLI transport and live Cars.com acceptance remain separate.
- Ambiguity: decision ownership, repair limits, durable-write ordering, resume behavior, approval proof, and recording/handoff responsibilities are explicit.
