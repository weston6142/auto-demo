# @auto-demo/agent

Provides agent-facing workflow helpers around the CLI and project contracts.

## Agent Workflow

`runAgentWorkflow()` is the WES-160 noninteractive handoff contract for coding
agents. It loads a validated Auto Demo project, selects an existing saved
variant or saves a generated baseline variant, and returns one JSON-ready summary
for agent logs and downstream export work.

```ts
import { runAgentWorkflow } from "@auto-demo/agent";

const result = await runAgentWorkflow({
  projectPath: "projects/checkout",
  json: true,
  variantId: "baseline-polish",
});
```

The CLI exposes the same contract:

In a clean local checkout, run these logical subcommands through
`npm run autodemo --`. If wrapper diagnosis is needed, the workspace-scoped
fallback is `npm --workspace @auto-demo/cli run autodemo --`.

```bash
autodemo agent run --project projects/checkout --json
autodemo agent run --project projects/checkout --json --variant baseline-polish
autodemo agent run --project projects/checkout --json --generate baseline --source-variant source-baseline --save all
autodemo agent run --project projects/checkout --json --open-editor [--host 127.0.0.1] [--port 0] [--no-browser]
```

For WES-160, generated agent saves are baseline-only and accept only
`--save baseline-polish` or `--save all`. Custom generated variant ids remain
outside the MVP agent contract. `--save` and `--source-variant` are valid only
with `--generate baseline`.

Successful results include:

- selected project path, manifest path, and project name;
- selected variant id, `variants/<id>.json` path, and whether it was selected or
  generated;
- artifact paths for the project manifest and variant file;
- stable non-secret warnings;
- next-step hints such as `open-editor` and `export-variant`;
- optional editor URL and `long-lived-local-server` lifecycle marker when
  `--open-editor` is used.

`--open-editor` starts the same local editor used by `autodemo open`, prints the
handoff URL in JSON, and intentionally keeps the editor server alive until the
process is stopped. `--host` and `--port` override the editor bind address when
`--open-editor` is used; `--port 0` keeps OS port assignment. `--no-browser` is
accepted for compatibility and does not auto-launch a browser.

Expected failures return `ok: false` with stable error codes such as
`missing_project_path`, `unsupported_agent_command`,
`unsupported_agent_output`, `unknown_agent_argument`, `invalid_project`,
`missing_variant`, `variant_not_found`, `unsupported_generation`,
`generation_failed`, and `editor_unavailable`. The CLI exits `0` after writing a
successful JSON handoff summary and `1` for expected validation, generation, or
handoff failures.

The WES-169 MVP host decision treats a Codex production wrapper as
acceptance-critical for the first demo. Claude wrapper parity remains documented
follow-up scope: it should match the same invocation inputs, command sequence,
expected artifacts, and failure handling once implemented. MCP transport,
interactive/non-JSON workflow output, and Claude production wrapper execution
remain follow-up work. Demo-ready export validation is covered by
`npm run validate:demo-ready`, and saved variants can be rendered separately
through `autodemo export`.

## Walkthrough Plan Intake

New plans must come from evidence-backed discovery compilation through
`compileDiscoverySessionToWalkthroughPlan()`, followed by fresh-context replay
and repair. Persist the resulting durable `WalkthroughPlan` artifact before
using the shared review, refinement, approval, execution, and handoff lifecycle.

Plan-file dry-run validation accepts existing `deterministic-v1` artifacts for
migration compatibility and rejects discovery plans, which require
fresh-context replay. Review, refinement, approval, and execution retain both
supported artifact lifecycles. Existing best-guess artifacts still require an
explicit bypass approval, but discovery plans never use the best-guess bypass.
No public API or CLI creates new deterministic or best-guess plans from
unobserved natural-language text.

## Walkthrough Validate Mode

Validate mode is the WES-178 legacy migration dry-run layer. It rehearses a
resolved `deterministic-v1` `WalkthroughPlan` against a browser target and
annotates the plan with `validation.status`, step checks, and transcript-safe
blockers. Discovery plans use fresh-context replay and are rejected here.

```bash
npm run autodemo -- agent validate --plan <plan-json-file> --json
```

Validation returns `ready` only when all resolved steps pass and no blockers
remain. It returns all blockers that can be discovered safely. Blocker reasons include
`multiple_matching_elements`, `missing_element`, `unresolved_plan_question`,
`navigation_failed`, `unexpected_navigation`, `auth_wall_detected`,
`timing_failure`, and `unsafe_action`. State-changing steps that depend on an
earlier blocked or unresolved action receive an `unsafe_dependent_step` check and
are skipped, while safe later assertions can still identify missing or ambiguous
elements. Destructive-looking controls, credential-like fields, and target URLs
with credential-like parameters are not exercised.

The Playwright runner uses a fresh isolated browser context, disables service
workers, blocks WebSocket connections, and blocks non-idempotent network
requests including attempts during initial page load. If a safe-looking control
attempts a POST, PUT, PATCH, or DELETE request, validation reports
`unsafe_action` instead of allowing the request to reach the server. Post-action
checks also wait for a bounded 500 ms DOM quiet window by default so delayed SPA
updates are included.

Type steps use the synthetic input `typed value redacted`, and validated output
does not echo the original typed value, URL query strings, URL fragments,
credentials, tokens, or raw DOM snapshots. WES-178 does not ask questions
interactively. WES-177 consumes blockers and candidates, presents them for
review, and updates the structured plan from user answers.

Secret sanitation covers labeled credentials, bearer values, API-key-like
values, JWT-like values, high-entropy tokens, query parameters, and bare or
parameterized URL fragments.

Explicit URL navigation steps are rehearsed and checked against the resulting
location. Navigation instructions without a URL remain blocked for WES-177 to
refine. Candidate labels include sanitized ordinal context when multiple visible
elements otherwise have the same label and role.

## Walkthrough Review And Approval

WES-177 adds deterministic workflow services for an agent-conversation review
gate:

- `reviewWalkthroughPlan()` returns ordered public steps, warnings, blockers,
  candidate choices, approval eligibility, and a transcript-safe summary.
- `refineWalkthroughPlan()` accepts structured candidate selections or resolved
  replacement steps, clears prior approval, and automatically revalidates
  `validate-first` plans.
- `approveWalkthroughPlan()` records explicit approval time, basis, and a
  canonical SHA-256 fingerprint of execution-relevant plan content.
- `verifyWalkthroughPlanApproval()` lets WES-179 reject stale approval before
  capture begins.

Approval fingerprints provide consistency evidence, not user identity or
tamper-proof authorization. Any plan refinement invalidates validation and
approval. Best-guess approval requires explicit bypass intent and still rejects
unresolved or unsafe steps.

The library does not parse conversation text. Codex, Claude, or another agent
host explains reviews and translates user answers into structured refinement
artifacts without editing plan JSON directly.

## Approved Walkthrough Execution

WES-179 executes the approved artifact on the same Playwright page being
recorded:

```bash
autodemo agent execute --plan <approved-plan-json-file> --inputs <runtime-inputs-json-file> --out <capture-directory> --json
```

`--inputs` is required only for type steps. Its values must be non-secret demo
data because they appear in the recorded browser pixels; they never appear in
the plan, metadata, diagnostics, or JSON result. Execute mode always verifies
the approval fingerprint, has no unapproved shortcut, resolves accessible
targets strictly, stops on the first failure, and uses deterministic
`natural-v1` pacing.

Success returns an immutable executed plan plus completed capture paths. Failure
keeps the returned plan approved, records sanitized step outcomes, and preserves
a failed capture bundle when recording started.

Persist successful execute JSON and complete the project handoff with:

```bash
autodemo agent handoff --execution <execution-result-json-file> --project <new-project-directory> --name <project-name> --json
```

Handoff accepts only completed execution evidence, verifies required capture
artifacts, imports into a fresh project, and saves `baseline-polish`. It does not
overwrite a non-empty project directory. A generation failure preserves the
imported project so an operator can resume diagnosis without recording again.
Success returns structured next steps for
`autodemo open --project <new-project-directory>` and
`autodemo export --project <new-project-directory> --variant baseline-polish --json`;
it does not start the editor or export automatically.

## Agentic Discovery Session Contract

`DiscoverySessionV1` is the portable, versioned, bounded JSON evidence contract for agentic
browser discovery. Hosts build it immutably with `createDiscoverySession()`,
`recordDiscoveryObservation()`, `beginDiscoveryAttempt()`, `finishDiscoveryAttempt()`,
`selectDiscoveryPath()`, and `completeDiscoverySession()`. Failed or intentionally stopped
work uses `failDiscoverySession()` or `abandonDiscoverySession()`; completed, failed, and
abandoned sessions are terminal, and continued work starts a child session.

```ts
import {
  createDiscoverySession,
  recordDiscoveryObservation,
  beginDiscoveryAttempt,
  finishDiscoveryAttempt,
  selectDiscoveryPath,
  completeDiscoverySession,
} from "@auto-demo/agent";

const created = createDiscoverySession({
  id: "checkout-discovery",
  target: { kind: "browser", startUrl: "https://example.com/checkout" },
  goal: "Show checkout",
  host: { name: "codex", version: "1.0.0" },
  createdAt: "2026-07-13T12:00:00.000Z",
});
// Record an observation, begin the attempt before acting, record its resulting
// observation, finish it with matched effects, select its ID, then complete.
```

Actions that type demo data retain runtime-only input bindings, never input values. Native select
targets expose bounded public option labels plus required, value-present, validity, selected-option,
and checked state without option values or other form values. Select actions persist only the public
option label. Browser observations keep a 100-target bound while ranking viewport and form context
ahead of weaker candidates and reserving capacity for up to 20 fallback targets. This ranking never
stores raw DOM, selectors, or form values.

Targets inside repeated results may expose bounded results-order structural intent: a public
container role and label, an optional repeated-container occurrence, and a one-based item position.
The position may exclude only items carrying an explicit Sponsored, Promoted, Ad, or Advertisement
marker. The accessible label remains descriptive, but the structure is authoritative during fresh
replay and final recording. Resolution does not fall back to the descriptive label when the
container, eligible position, or descendant is missing or ambiguous, and repair must preserve the
same ordered structural constraints.

A click, type, or select attempt without declared expectations must produce a bounded
navigation, newly visible target/state, or changed public control state; otherwise it finishes as
`action_no_observable_effect` and cannot enter the selected path. The
artifact keeps failed or abandoned exploration for diagnostics while the selected path
references only continuous, successful attempts with matched navigation and visible-state
evidence. The fixtures under `fixtures/discovery-session-*.json` demonstrate the handoff.

This package does not yet expose a discovery CLI. The observation extractor, rehearsal
controller, policy-enforced controller, and discovery compiler are library APIs; host workflow
and fresh-context repair remain downstream.

## Discovery Plan Compilation

`compileDiscoverySessionToWalkthroughPlan()` validates an untrusted completed
`DiscoverySessionV1`, reads only its selected continuous successful path, and returns a
deterministic `WalkthroughPlan` that is draft and unapproved.

```ts
import { compileDiscoverySessionToWalkthroughPlan } from "@auto-demo/agent";

const compiled = compileDiscoverySessionToWalkthroughPlan(completedSession);
if (!compiled.ok) throw new Error(compiled.errors[0]?.code ?? "compilation_failed");
// compiled.plan is validate-first, draft, unapproved, and ready for fresh replay.
```

Opaque discovery target IDs are resolved to bounded accessible labels, roles, and occurrences.
Type actions retain only runtime input binding names, and native select actions retain only public
option labels. Matched navigation, visible-state, and bounded control-state
expectations become structured assertion steps, while inspect, back, and refresh are normalized
into deterministic plan behavior with a fixed review warning. Failed, blocked, abandoned, and
unselected attempts stay in the discovery artifact and never enter the plan.

Compilation does not start a browser, replay, validation, approval, capture, or input resolution.
It does not carry disposable-environment authority into the plan, and its fixed errors never echo
page content, runtime values, URLs, or exception details. WES-188 owns fresh-context replay,
structured repair evidence, and promotion to a validated plan.

## Deterministic Discovery Replay And Repair

`replayAndRepairDiscoveryPlan()` verifies a compiled discovery plan in a fresh isolated browser
context. Use `createPlaywrightDiscoveryReplayBrowserFactory()` for the policy-enforced Playwright
adapter, and provide every declared type-step value through runtime-only input bindings. A passing
run promotes the plan to validated, reviewable and unapproved state with compact replay evidence.

Replay is fail-fast and bounded to the initial attempt plus at most two repair sessions. The host
owns repair discovery and returns a completed direct-child `DiscoverySessionV1`; each changed path
is recompiled and replayed from scratch. Declined repairs, invalid lineage, unchanged paths, and
the attempt limit return stable sanitized errors. Credential entry, unsafe origins, mutating
requests in safe mode, downloads, uploads, WebSockets, and other hard policy boundaries are never
repaired around.

Refining a replay-validated discovery plan clears its validation and approval and returns it to
draft for another replay. Approval fingerprints include replay evidence, so changing the replay
summary makes an approval stale. This package does not embed a model or expose a discovery CLI.

The CLI package's deterministic local acceptance fixture composes these public APIs through
semantic and positional target choice, cross-page evidence, one stale-target direct-child repair,
fresh replay, review, explicit approval, real capture, failed-bundle preservation, and project
handoff with `baseline-polish`. It also proves that a non-idempotent local mutation is blocked by
safe policy and allowed only by a fresh exact-origin disposable acknowledgement. Public-site smoke
is optional and is not a CI dependency.

## Codex-Hosted Risk-Tiered Discovery

### Autonomous discovery runner

Normal autonomous discovery uses `runAutonomousDiscoveryToReview()` with
`createPlaywrightAutonomousDiscoveryRunnerDependencies()` and a durable
`createFileAutonomousDiscoveryStore()`. A host supplies bounded one-action decisions and runtime-only
input resolution; it must not reproduce the lifecycle in an ad hoc script. The runner requires an
explicit risk tier before browser activity, owns fresh browser launch and repair contexts, and
persists every accepted session transition before requesting another decision. It compiles the
selected path, freshly replays it with at most two repairs, persists the sanitized review, and returns
`review_required` without approving, recording, or handing off.

After the operator gives explicit approval through the established approval API or CLI, call
`completeApprovedAutonomousDiscovery()` with that approved plan. This separate phase verifies the
persisted replay checkpoint and approval fingerprint, re-establishes the exact tier and launch profile
for fresh recording, persists completed execution before project handoff, and does not open the editor
or export. Runtime input values are passed only to the recording dependency and are never accepted by
the runner artifact store.

The runner is a public model-agnostic API, not an interactive discovery CLI. Hosts may layer a
transport over its decision-provider contract without taking ownership of browser cleanup,
persistence ordering, repair limits, or the review boundary.

The repository-owned `skills/codex-auto-demo/SKILL.md` uses the public runner for Codex-hosted
risk-tiered discovery from a target URL and natural-language goal. Codex resolves one
of `safe`, `public-browse`, `disposable`, or `yolo` before browser or network activity; generic
autonomous intent does not select a tier. An ambiguous prompt produces one focused selection
question. YOLO now means the unrestricted Auto Demo tier, while host, platform, repository, and
system instructions still apply.

Safe, public-browse, freshly acknowledged exact-origin disposable, and YOLO discovery and replay
are implemented. The selected tier is never silently downgraded or approximated. The package still
does not expose a discovery CLI.

WES-269 provides the classifier used by safe and public-browse policy decisions. Requests are
reduced to `document-navigation`, `xhr-fetch`, `beacon`,
`service-worker`, or `other`; a read, potential-side-effect, or other method category;
same-origin, cross-origin, or unknown origin relation; and top-level or subresource scope.
Policy-enforced rehearsal can return bounded classification aggregates, a blocked-request count,
and whether an expected visible effect was prevented. Diagnostics never include request URLs,
bodies, headers, credentials, or tokens, and replay still exposes only its existing hard-boundary
failure. Public-browse allows same-origin subresource XHR/fetch and service-worker side effects,
known-origin cross-origin beacon traffic, and active exact-origin public form navigation. It blocks
cross-origin XHR/fetch, unknown methods or request classes, and idle top-level side effects.

For a supported tier, Codex drives one policy-authorized action at a time through
`createPolicyEnforcedPlaywrightDiscoveryRehearsalController()`, keeps abandoned exploration out
of the selected path, compiles with `compileDiscoverySessionToWalkthroughPlan()`, and verifies the
result with bounded replay and repair through `replayAndRepairDiscoveryPlan()`.

Only a successful fresh replay produces a validated, reviewable, unapproved plan. Codex presents
the ordered transcript-safe review and asks for explicit approval in a separate conversational
turn. Discovery plans never use the best-guess bypass. Codex must select the same tier again for
fresh discovery, fresh replay, and fresh recording contexts. No policy authority or browser state
ever carries across phases, and review and explicit approval remain mandatory in every tier. See
`fixtures/codex-risk-tier-selection.md` for selection and support
behavior. The WES-189 transcript remains at `fixtures/codex-yolo-discovery-approval.md` as
historical bounded-discovery evidence.

### Browser launch profile parity

Discovery accepts one bounded browser launch profile plan with a primary and at most two fallback
attempts. Supported public fields are `schemaVersion`, Chromium `browser`, `channel` (`bundled`,
`chrome`, or `msedge`), `headless`, and a viewport from 1x1 through 4096x4096. Every failed attempt
uses and closes a fresh isolated browser and context. Discovery alone resolves fallback order; the
selected profile is persisted into `DiscoverySessionV1`, compiled into the walkthrough plan, and
covered by review and approval fingerprints.

Fresh replay and final capture use the same resolved profile unchanged. They do not retry another
profile or carry browser state forward. A recognized Cloudflare or generic human-verification page
returns the bounded `anti_bot_challenge` outcome, distinct from network or action policy failures.
Persistent contexts, executable paths, arbitrary launch arguments, cookies, storage state, and
authenticated browser state are outside the contract. Existing plans without a profile retain the
bundled headless Chromium 1280x720 default.

## Structured Browser Observation Snapshots

`createPlaywrightDiscoveryObservationExtractor()` inspects an existing Playwright page and
returns bounded, transcript-safe observations accepted by `recordDiscoveryObservation()`. The
caller owns the page and, when screenshots are wanted, provides an optional artifact sink that
persists the bytes and returns a safe relative path.

```ts
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createPlaywrightDiscoveryObservationExtractor,
  recordDiscoveryObservation,
} from "@auto-demo/agent";

const extractor = createPlaywrightDiscoveryObservationExtractor(page, {
  artifactSink: {
    async write({ id, bytes }) {
      const path = `artifacts/${id}.png`;
      await writeFile(join(sessionDirectory, path), bytes);
      return { path };
    },
  },
});

const extracted = await extractor.observe();
if (!extracted.ok) throw new Error(extracted.errors[0]?.code ?? "observation_failed");
const recorded = recordDiscoveryObservation(session, extracted.observation);
```

Screenshots are opt-in. Successful observations contain only their safe relative path, media
type, and SHA-256 hash; screenshot bytes stay behind the sink boundary. Target IDs remain stable
while the same DOM element stays attached to the current main document. Use `hasLiveTarget()`
before acting on a retained ID; navigation, removal, or element replacement invalidates it.

Collection covers the main document and open shadow roots, excludes iframe contents, prioritizes
accessible semantic controls, and reports bounded fallback targets and truncation through
runtime-only diagnostics. It never returns form values, selectors, raw DOM, screenshot bytes, or
exception details. Credential-like inputs appear only as safe target metadata. WES-185 owns
browser actions; this extractor only observes and checks target liveness.

## Discovery Rehearsal Controller

`createPlaywrightDiscoveryRehearsalController()` drives atomic rehearsal actions on an existing
Playwright page and records bounded `DiscoverySessionV1` evidence. The host supplies a required
authorizer for every action and a runtime-only input resolver for demo-data bindings.

```ts
import { createPlaywrightDiscoveryRehearsalController } from "@auto-demo/agent";

const controller = createPlaywrightDiscoveryRehearsalController(page, {
  authorizer,
  inputResolver: {
    async resolve(binding) {
      return binding === "demo-name"
        ? { ok: true, value: "Demo Person" }
        : {
            ok: false,
            code: "input_binding_unavailable",
            summary: "Demo input is unavailable.",
          };
    },
  },
});

const started = await controller.start({
  id: "profile-discovery",
  target: { kind: "browser", startUrl: "https://example.test/profile" },
  goal: "Save a demo profile",
  host: { name: "codex", version: "1.0.0" },
});
```

Each `perform()` call authorizes one declared action, begins one attempt, executes at most one
browser effect, records one resulting observation when available, evaluates only the declared
expectations, and finalizes the attempt before returning. Blocked actions are retained as
evidence without resolving inputs or changing the page. Type values exist only between the
resolver and the Playwright driver; they are never stored in the session or returned result.

Click and type actions use only opaque target IDs from the latest observation. A target removed
after observation produces a fixed `target_stale` failure; the controller never remaps it by
selector, label, role, or similarity. Retrying is host-directed through the explicit
retryOfAttemptId field; no action is silently repeated or queued.

The host must complete or abandon explicitly with `stop()`. Completion accepts only a selected,
continuous successful path with matched evidence, while failed or abandoned exploration remains
available outside that path. Browser loss finalizes any pending attempt before failing the
session. Terminal sessions reject later actions.

The factory does not launch or close the browser and does not start final media capture. The host
owns the page lifecycle. WES-186 supplies the concrete authorization policy, and WES-187 compiles
selected discovery traces into executable walkthrough plans. This library workflow does not add
a discovery CLI.

## Policy-Enforced Discovery Rehearsal

`createPolicyEnforcedPlaywrightDiscoveryRehearsalController()` is the supported safe default for
driving discovery in an isolated Chromium rehearsal context containing one page. It couples per-action policy
with browser request enforcement so a permissive action decision cannot be separated from its
origin, mutation, download, or WebSocket protections. The host supplies exact allowed origins;
paths, wildcard domains, embedded credentials, and non-HTTP(S) schemes are rejected.

```ts
import { createPolicyEnforcedPlaywrightDiscoveryRehearsalController } from "@auto-demo/agent";

const safe = await createPolicyEnforcedPlaywrightDiscoveryRehearsalController(page, {
  chromiumNetworkInstrumentation: "exclusive",
  policy: { mode: "safe", allowedOrigins: ["https://demo.example"] },
  inputResolver,
});

const disposable = await createPolicyEnforcedPlaywrightDiscoveryRehearsalController(page, {
  chromiumNetworkInstrumentation: "exclusive",
  policy: {
    mode: "disposable",
    acknowledgement: "environment-is-disposable",
    allowedOrigins: ["https://sandbox.example"],
  },
  inputResolver,
});
```

Safe mode blocks destructive-looking actions and all non-idempotent browser requests. Disposable
mode permits those mutations only while one authorized action is active and only within the exact
declared origins. The host is responsible for obtaining explicit user approval before constructing
the disposable declaration.

Both modes permanently block credential and payment inputs, secret-like resolved values, unsafe
or credential-bearing navigation, undeclared top-level origins, downloads, uploads, and
WebSockets. Runtime target risk, resolved input values, request details, policy permits, and the
disposable declaration are never written to `DiscoverySessionV1`.

The controller uses page-target Chromium DevTools Protocol interception for every HTTP redirect
hop, bypasses service workers, blocks WebSockets, cancels downloads, and rejects popup first
navigations at the isolated context boundary. The context must contain only the rehearsal page
when the controller is created and must not share external CDP network overrides. `stop()` and
idempotent `dispose()` remove those guards without closing the page or context; disposal waits for
an in-flight action, and cleanup failures remain retryable. The host retains browser ownership and
must not use a shared production session.

If observed browser work cannot become quiet within the bounded action window, the attempt fails
with `policy_guard_unavailable`, the guard rejects later actions, and teardown remains available.

The required `chromiumNetworkInstrumentation: "exclusive"` acknowledgement makes that CDP
ownership precondition explicit; construction fails closed when it is absent at runtime.
If construction throws `DiscoveryPolicyControllerError`, callers may safely `await error.cleanup()`;
it is normally a no-op, but preserves a retry path when rare partial browser-hook rollback could not
finish before the creation error was returned.

Disposable authority applies to one controller instance. It never carries into final capture,
compiled walkthrough plans, replay, review, approval, or execution. Those later workflows retain
their own safety and approval boundaries.

## Wrapper Artifacts

- Codex skill wrapper: `skills/codex-auto-demo/SKILL.md`
- Happy-path Codex transcript: `fixtures/codex-happy-path.md`
- Invalid-project Codex transcript: `fixtures/codex-invalid-project.md`
- Walkthrough review/approval transcript: `fixtures/codex-walkthrough-review-approval.md`
- Walkthrough refinement transcript: `fixtures/codex-walkthrough-refinement.md`
- Walkthrough execution transcript: `fixtures/codex-walkthrough-execution.md`
- Risk-tier selection pressure scenario: `fixtures/codex-risk-tier-selection.md`
- Historical bounded-discovery approval transcript: `fixtures/codex-yolo-discovery-approval.md`
- Claude parity requirements: `claude-wrapper-parity.md`

## MCP Decision

MCP is deferred from the MVP. The accepted MVP integration path is the CLI plus
Codex wrapper, using
`autodemo agent run --project <project-dir-or-manifest> --json` as the stable
noninteractive handoff. This keeps Agent Integrations focused on the executable
workflow while Export And Packaging owns rendered artifacts and packaging.

Future MCP work should be opened when the workflow needs persistent
project/session discovery, editor handoff lifecycle status or stop controls,
artifact inspection across generated outputs, host integration evidence shows
repeated CLI orchestration mistakes, or a host requires MCP instead of shell
commands.

The minimum future MCP capability set is project discovery and validation, an
agent workflow run tool for selecting or generating a saved variant, local
editor launch handoff with explicit lifecycle behavior, artifact inspection for
project/variant/export paths, and stable non-secret error responses. MCP does
not introduce a new project schema, new variant-selection rules, hosted
services, or final MP4 export behavior; local MP4 export stays CLI-owned through
`autodemo export`.
