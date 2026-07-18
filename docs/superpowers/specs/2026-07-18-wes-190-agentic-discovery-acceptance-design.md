# WES-190 Agentic Discovery Acceptance Design

## Goal

Prove, with behavior-first local acceptance coverage, that agentic discovery can resolve semantic and positional intent, recover from changed browser targets, cross page boundaries safely, record an explicitly approved deterministic walkthrough, and hand the completed capture into a loadable Auto Demo project with a saved `baseline-polish` variant.

## Context

WES-183 through WES-191 established the bounded discovery session, Playwright observation, policy-enforced rehearsal, evidence-backed compilation, fresh-context replay and repair, explicit approval, deterministic capture, and capture-to-project handoff contracts. Those contracts are covered independently, but the repository does not yet prove that they compose into the user-visible Agentic Flow Discovery outcome.

WES-190 is an acceptance slice, not a new orchestration product. The host remains responsible for interpreting a goal and choosing structured actions from bounded observations. The repository continues to expose library APIs rather than a discovery CLI or embedded model.

## Considered Approaches

### 1. One monolithic end-to-end test

Drive every required behavior through one browser journey and assert only the final project. This is realistic but makes failures difficult to localize, repeats expensive capture work for every edge case, and encourages an oversized fixture.

### 2. Independent scenario tests only

Cover semantic choice, duplicates, navigation, repair, policy, capture, and handoff in separate existing package suites. This is fast and diagnostic, but it does not prove that one discovery-created artifact can cross every lifecycle boundary into a project.

### 3. Layered scenarios plus one composed journey (selected)

Use deterministic local browser fixtures for focused behavioral scenarios, then run one representative repaired discovery plan through replay, review, approval, real capture, and project handoff. This gives precise regression signals and direct evidence that the public contracts compose without adding production orchestration.

## Architecture And Boundaries

### Deterministic local fixture

A test-only local HTTP fixture owns a small story workflow and a mutation workflow. It exposes stable routes, semantic HTML, request counters, and a controlled version switch used to simulate a stale target between discovery and replay. It binds only to `127.0.0.1` on an operating-system-assigned port and is closed after every test.

The story surface includes duplicate accessible link or button names so the bounded observation must preserve occurrence order. Its first story navigates to an expected detail route and exposes a visible outcome. The mutation surface performs a local non-idempotent request only after the test supplies an explicit disposable policy for the exact fixture origin.

### Host-shaped acceptance driver

Test code acts as the deterministic host. It reads public `DiscoveryObservation` values, selects targets by accessible label, role, and occurrence, and submits public structured actions and expectations to `createPolicyEnforcedPlaywrightDiscoveryRehearsalController()`. It does not reach into DOM selectors, target registries, controller state, or private Playwright adapters.

Semantic intent is expressed as choosing the story link by accessible meaning. Positional intent is expressed as choosing occurrence one among duplicate controls. Ambiguity is preserved in the observation and resolved explicitly by occurrence rather than by an implementation-specific selector.

### Replay and repair

The completed root session is compiled with `compileDiscoverySessionToWalkthroughPlan()`. Before the first replay, the fixture changes the selected control's accessible name while preserving the intended user outcome. The fresh replay must fail with sanitized `target_not_found` evidence. The repair provider performs a new bounded rehearsal, returns one completed direct-child session with the changed selected path, and permits a second fresh replay.

The repaired replay must produce a validated, reviewable, unapproved plan. Repair remains bounded by the existing replay coordinator; the test does not edit plan JSON or bypass a policy boundary.

### Approval, capture, and handoff

The acceptance journey reviews and explicitly approves only the replay-validated plan. It persists the full approved artifact, invokes the supported `autodemo agent execute --plan ... --out ... --json` path, persists successful execution JSON, and invokes `autodemo agent handoff` into a fresh project directory.

Assertions cover observable results:

- final execution is completed and emits non-empty media plus a completed capture manifest;
- runtime-only values, discarded target text, query data, and failure details do not leak into public artifacts;
- `loadProject()` accepts the handoff directory;
- the project contains a saved `baseline-polish` variant file;
- the handoff preserves editor and export next-step contracts;
- approval remains mandatory and discovery or disposable authority never substitutes for final approval.

### Focused contract scenarios

The composed journey is supplemented by focused tests for:

- duplicate semantic controls with explicit first-occurrence selection;
- cross-page navigation and visible-state expectations;
- stale discovery target evidence followed by direct-child repair;
- safe-policy rejection of a mutating action;
- the same mutation succeeding only with a fresh exact-origin disposable acknowledgement;
- failed final execution preserving a sanitized failed capture bundle;
- handoff output retaining editor and export instructions.

Existing package tests remain the source of exhaustive edge coverage for redaction, failure bundles, editor behavior, and export rendering. WES-190 adds acceptance assertions at their public handoff seams rather than duplicating private mechanics.

## File Boundaries

- `packages/cli/src/agenticDiscoveryAcceptanceFixture.ts` contains only the deterministic local HTTP fixture and its public test controls.
- `packages/cli/src/agenticDiscoveryAcceptance.test.ts` contains the host-shaped scenario helpers and acceptance assertions over public package and CLI APIs.
- `packages/cli/package.json` includes the new acceptance file in the CLI test suite.
- `packages/agent/src/discoveryReplay.test.ts` regression-covers runtime-generated discovery provenance identifiers during replay promotion.
- `packages/agent/src/walkthroughValidation.ts` preserves already-validated structural identifiers while continuing to sanitize user- and page-derived text.
- `packages/agent/README.md`, `packages/cli/README.md`, and the root `README.md` describe the verified local acceptance path and its scope without advertising a discovery CLI.
- `docs/linear/auto-demo-project-structure.md` records design, implementation, verification, merge, and next-task evidence.

Production files change only if a RED acceptance test demonstrates that a documented public contract cannot satisfy the issue. Any such change must be minimal, separately regression-tested, and reflected in this design and the implementation plan before completion.

The stale-target journey exposed that generic text sanitization treated UUID-shaped runtime provenance identifiers as secret-like content during replay promotion. The selected correction uses identifier-aware sanitization for structural plan, provenance, validation, question, and warning identifiers. Invalid identifiers still collapse to the fixed `redacted-id` value, while valid generated identifiers survive without weakening page-content, URL, runtime-value, or diagnostic redaction.

## Error And Cleanup Behavior

- Fixture startup failures fail the test without selecting a fallback public site.
- Every browser context, fixture server, capture directory, and editor/export resource opened by a test is closed or scoped to a temporary directory.
- Replay failures are asserted through stable error codes and bounded evidence, never raw exception text or page content.
- A stale target is repairable; policy violations remain hard boundaries and are not repaired around.
- A failed final execution must leave a failed capture manifest and any flushed media artifacts available for diagnosis.
- Handoff must reject incomplete execution evidence and must never overwrite a non-empty project directory; existing focused tests continue to own exhaustive variants of those failures.

## Testing Strategy

Implementation follows RED-GREEN-REFACTOR. The acceptance tests use real public APIs and Playwright against the local fixture; mocks are avoided. Assertions target session outcomes, selected paths, replay attempts, approval state, capture artifacts, project loading, saved variants, and stable public errors rather than call counts or private adapters.

Verification runs:

1. the new WES-190 acceptance file while each behavior is developed;
2. the complete `@auto-demo/agent` and `@auto-demo/cli` suites;
3. editor, project, polish, capture, and render suites that own retained downstream contracts;
4. `npm run validate` for repository build, typecheck, lint, every workspace test, and formatting;
5. `git diff --check` and an independent read-only code review against this spec and the implementation plan.

## Scope

In scope: deterministic local browser fixtures, behavior-first acceptance coverage, one real composed recording and handoff journey, minimal documentation, and project/Linear synchronization.

Out of scope: a discovery CLI, an embedded model, hosted fixtures, public-site CI, new policy modes, broader mutation authority, approval bypass, schema changes, editor UI changes, export codec changes, or production orchestration that duplicates the repository-owned Codex host workflow.

## Approved Assumptions

- The repository-owned Codex workflow is the host layer; WES-190 verifies its composed public contracts without embedding model inference into tests.
- Deterministic local fixtures are authoritative CI evidence. A public read-only flow is optional smoke and not a merge gate.
- Exact-origin disposable acknowledgement applies only to the bounded discovery or replay run that receives it; final capture still requires a separately approved deterministic artifact.
- Existing exhaustive redaction, failure, editor, and export suites remain valuable. WES-190 adds cross-contract acceptance evidence rather than reimplementing all of them in one test.
- The unrelated `.gitignore` modification belongs to the user and remains unstaged and unchanged.
