# WES-189 Codex YOLO-Discovery Workflow And Approval Handoff Design

Date: 2026-07-17  
Issue: WES-189, “Add Codex YOLO-discovery workflow and approval handoff”

## Goal

Extend the repository-owned Codex skill so a user can provide a natural-language browser-demo goal and explicitly opt into autonomous discovery. Codex uses Auto Demo's structured observation and action contracts to explore, backtrack, compile, and repair a deterministic walkthrough while stopping at hard policy boundaries. A successful replay is presented for explicit approval and then follows the existing approved execute and project-handoff path.

## Scope

This issue owns the Codex host workflow and its documented approval handoff:

- trigger from a natural-language goal plus target URL;
- safe-by-default or explicitly disposable discovery scope;
- policy-enforced structured observation, action, backtracking, and evidence capture;
- selected-path completion, deterministic compilation, replay, and bounded repair;
- transcript-safe plan presentation and explicit approval;
- the existing deterministic execute and project-handoff commands;
- repository-owned Codex examples, behavior checks, and Claude-parity guidance.

This issue does not add a discovery CLI, embed a model in `@auto-demo/agent`, change the project or discovery schemas, retire legacy deterministic intake, implement a Claude production wrapper, bypass approval, or add final-flow acceptance coverage owned by WES-190 and WES-191.

## Existing Boundaries

The completed Agentic Flow Discovery work already supplies the required product primitives:

- `createPolicyEnforcedPlaywrightDiscoveryRehearsalController()` for bounded observations and one policy-authorized action at a time;
- `DiscoverySessionV1` for transcript-safe evidence, selected paths, and child-session lineage;
- `compileDiscoverySessionToWalkthroughPlan()` for deterministic draft plans;
- `replayAndRepairDiscoveryPlan()` plus `createPlaywrightDiscoveryReplayBrowserFactory()` for fresh-context replay and at most two direct-child repairs;
- `reviewWalkthroughPlan()` and the existing `agent review`, `agent approve`, `agent execute`, and `agent handoff` commands for the established lifecycle.

WES-189 composes these boundaries through a Codex skill. It does not duplicate them in a new command or orchestrator.

## Approaches Considered

### Extend The Codex Skill Over Existing Library Contracts (Selected)

Teach the repository-owned Codex skill the full host workflow and add a realistic transcript fixture. Codex remains the decision provider while Auto Demo remains the authority for browser evidence, safety policy, deterministic artifacts, and final execution.

This is the smallest functional extension of the accepted Codex-wrapper architecture. It preserves the model-agnostic library boundary, gives future Codex sessions explicit operational guardrails, and leaves WES-191 one documented path to audit.

### Add A Stateful Discovery CLI

A long-lived JSON protocol could retain a browser and accept agent actions, but it would introduce lifecycle, persistence, interruption, and compatibility behavior that is not required for the current repository-owned wrapper. It would also create another public intake path immediately before WES-191 reconciles those paths.

### Add A Model-Callback Orchestration API

A library coordinator could call a host-provided decision callback, but the existing rehearsal and replay repair providers already define the necessary seams. Another coordinator would duplicate lifecycle decisions and encourage model-specific coupling inside the package.

## Codex Workflow

### 1. Intake And Authority

Codex requires a target URL and a natural-language goal. It identifies whether runtime demo inputs are needed without requesting secrets.

Safe exact-origin rehearsal is the default. Codex may enter disposable mode only after the user explicitly identifies a disposable environment and allowed origins for this discovery run. The acknowledgement is fresh and run-specific; previous disposable use, a repository fixture, or the word “YOLO” alone does not grant mutation authority.

Credential entry, payment data, uploads, unsafe schemes, undeclared origins, downloads, and WebSockets remain prohibited in both modes. A hard boundary stops discovery and is reported with the stable sanitized policy result. Codex does not repair around it or ask for a broader generic bypass.

### 2. Structured Discovery

Codex owns an isolated Playwright page and creates the policy-enforced rehearsal controller. It starts a `DiscoverySessionV1` with the target, bounded goal, and Codex host identity.

For each turn, Codex reads only the returned bounded observation and diagnostics, chooses one structured action, declares expected navigation or visible-state evidence, and calls `perform()`. It does not use selectors, raw DOM, arbitrary page evaluation, or a parallel browser-control path to perform discovery actions.

The returned session is the source of truth. Failed and abandoned exploration remains evidence but is excluded from the selected path. Codex may use explicit `back`, `refresh`, retry, and alternative-target actions when the evidence supports them. It must not claim a result based only on its intention; successful attempts require matching recorded effects.

Type actions use named runtime bindings resolved in memory after authorization. Values must be non-secret demo data, must not be pasted into conversation or command arguments, and must never be serialized into the session or plan.

When the goal has one continuous successful path, Codex calls `stop({ outcome: "complete", ... })` with only that path's attempt IDs. If the browser becomes unavailable, policy enforcement fails, the goal cannot be reached safely, or the user stops the run, Codex preserves the sanitized session and reports the fixed blocker instead of fabricating completion.

### 3. Compilation, Replay, And Repair

Codex compiles the completed session through `compileDiscoverySessionToWalkthroughPlan()`. The draft remains unapproved.

Codex passes the canonical session/plan pair to `replayAndRepairDiscoveryPlan()` with a fresh policy-enforced Playwright replay factory and the required runtime-only demo inputs. It never edits a compiled plan directly.

For a repairable replay failure, Codex uses the bounded failure evidence to create one completed direct-child discovery session, recompiles it, and returns that session through the repair-provider boundary. Repair is limited to two child sessions and three total fresh replay attempts. Codex may decline repair when evidence is insufficient. Policy denials, invalid artifacts, sensitive inputs, setup failures, and exhausted budgets stop the workflow.

Only an `ok: true` replay result advances. Its plan is validated, reviewable, and still explicitly unapproved. Failed attempt history stays in the bounded replay result rather than being folded into final execution content.

### 4. Review And Explicit Approval

Codex persists the final validated plan artifact and obtains the existing transcript-safe review. It presents:

- the target and goal;
- the ordered public steps and assertions;
- runtime binding names but never values;
- replay attempt count;
- all warnings, assumptions, questions, and blockers.

Codex asks for explicit approval immediately before invoking `autodemo agent approve`. It does not infer approval from the original YOLO request, successful discovery, a prior plan approval, or silence. Discovery plans cannot use the best-guess bypass.

If the user requests a change, Codex returns to structured child-session repair or the existing refinement/revalidation path as appropriate, presents a fresh review, and asks again. Any change invalidates previous validation or approval as defined by the existing lifecycle.

### 5. Deterministic Recording And Handoff

After explicit approval, Codex persists the returned approved plan and invokes the established commands:

```text
npm run autodemo -- agent execute --plan <approved-plan> [--inputs <runtime-inputs>] --out <capture-directory> --json
npm run autodemo -- agent handoff --execution <execution-result> --project <project-directory> --name <project-name> --json
```

Final execution starts from the approved deterministic plan. It does not reuse the discovery page, policy permit, disposable acknowledgement, replay browser, or repair authority. Runtime demo inputs remain local and non-secret because the resulting video displays them.

Codex reports the completed capture/project paths and existing next steps. It does not open the editor or export unless separately requested.

## Artifact Ownership

The host keeps artifacts in a user-selected or temporary local workflow directory:

- completed root and repair `DiscoverySessionV1` artifacts;
- the bounded replay result for diagnosis;
- the final validated and approved plan artifacts;
- runtime inputs in a separate local file when required;
- the final execution result consumed by handoff.

The skill must distinguish persisted artifacts from conversational summaries. It never instructs Codex to paste raw sessions, plan JSON, runtime values, raw observations, DOM, selectors, screenshots, request data, or capture manifests into chat. Temporary artifacts should be removed only when Codex created them and the user no longer needs recovery evidence; user-owned paths are never overwritten implicitly.

## Error Handling

- Invalid target, goal, policy, session, or plan artifacts stop before browser actions.
- Policy blocks and sensitive-input failures are hard boundaries and never invoke repair.
- Ordinary missing, ambiguous, stale, navigation, assertion, action, or bounded-stability failures may enter the existing repair loop.
- Browser or policy-guard setup failures return stable sanitized errors; caught exception text is not repeated.
- Exhausted repairs preserve the latest valid session, plan, and bounded attempt history for human review.
- Approval is unavailable until replay succeeds without blockers.
- Execute and handoff failures follow their existing JSON error contracts and preserve recoverable capture/project artifacts.

## Skill And Documentation Changes

Update `packages/agent/skills/codex-auto-demo/SKILL.md` so its trigger covers goal-driven discovery and its body contains a concise authority-sensitive workflow. Keep detailed sample output in a fixture rather than inflating the frequently loaded skill.

Add one repository fixture that demonstrates:

- a natural-language goal entering safe YOLO discovery;
- structured observation/action/backtracking evidence;
- a repairable replay failure and one child-session repair;
- validated transcript-safe plan review;
- a distinct explicit-approval turn;
- approved execute and project handoff;
- no disposable authority or runtime values in final recording artifacts.

Update `packages/agent/claude-wrapper-parity.md` to identify equivalent future host responsibilities without claiming a Claude production implementation. Update package/root README text to make the Codex discovery workflow available while keeping the no-discovery-CLI boundary explicit.

## Testing Strategy

Tests assert published behavior and user-facing effects rather than Markdown line positions or internal helper structure.

- Establish a baseline by asking an independent agent to handle a YOLO-discovery request using the pre-WES-189 skill and record missing or unsafe workflow decisions.
- Extend `wrapper-docs.test.ts` to require the skill to trigger on natural-language/YOLO discovery and to require the public policy, structured-action, replay/repair, explicit-approval, authority-reset, and execute/handoff invariants.
- Parse the new transcript fixture's JSON blocks and validate its public discovery sessions, compiled/replayed plan summaries, review/approval boundary, and final handoff sequence where practical.
- Confirm the existing deterministic intake, review/refinement, execution, handoff, variant, editor, and export guidance remains present.
- Forward-test the updated skill with a fresh independent agent using the same user scenario and verify it now selects the structured, policy-bounded path without inventing a discovery CLI or bypassing approval.
- Run focused agent tests, agent typecheck/build, repository validation, skill frontmatter validation, and `git diff --check`.

## Acceptance Criteria

- The repository-owned Codex skill handles a target URL plus natural-language goal and explicit YOLO-discovery request.
- Safe rehearsal is the default; disposable mutations require fresh scoped acknowledgement; hard boundaries stop without repair.
- Codex uses Auto Demo's structured controller and evidence instead of selectors, raw DOM, or an alternate browser-action path.
- Backtracking and repair remain bounded and evidence-backed; only a successful fresh replay becomes reviewable.
- The user sees a transcript-safe ordered plan and must explicitly approve it after discovery.
- Final capture uses only the approved deterministic execute/handoff path and receives no discovery authority.
- Runtime values and sensitive/raw browser data remain out of conversation and durable plan/session artifacts.
- Claude parity remains documented follow-up scope.
- Behavior-focused tests and independent skill forward-testing cover the complete wrapper contract.
