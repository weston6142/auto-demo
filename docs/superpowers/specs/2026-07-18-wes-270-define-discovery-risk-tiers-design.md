# WES-270 Discovery Risk Tiers And Start-Of-Skill Selection Contract Design

Date: 2026-07-18
Issue: WES-270, “Define discovery risk tiers and start-of-skill selection contract”

## Summary

Auto Demo’s repository-owned Codex skill currently treats “YOLO discovery” as bounded autonomous discovery that silently starts in safe exact-origin mode. That historical meaning is no longer precise enough for public-site discovery. WES-270 replaces it with an explicit four-tier contract: `safe`, `public-browse`, `disposable`, and `yolo`.

The skill must resolve a tier before it opens a browser or performs any network activity. An unambiguous tier in the user’s prompt is sufficient; otherwise Codex asks one focused selection question and pauses. The selected tier governs discovery and replay and, only after review and explicit approval, is freshly established again in a new recording context. Browser state, policy permits, acknowledgements, and runtime authority never cross a phase boundary.

This issue defines and publishes the contract. It does not implement the new `public-browse` or unrestricted `yolo` runtime policies, network-side-effect classification, browser launch unification, form actions, target ranking, or the autonomous runner owned by later Milestone 10 issues.

## Existing Gap And Baseline Evidence

The pre-WES-270 skill has only two runtime policy modes: safe and exact-origin disposable. Its “Goal-Driven YOLO Discovery” section says to start safe unless the user declares a disposable environment. A pressure scenario that explicitly asked for urgent “YOLO discovery” on Cars.com therefore produced these behaviors:

- Codex treated YOLO as bounded safe-mode autonomy rather than an unrestricted risk tier.
- Codex did not ask for a risk selection before discovery.
- Background POST and telemetry behavior remained ambiguous.
- Review and explicit approval before recording remained intact.

This observed failure is the RED baseline for the skill change. The implementation must make the first three behaviors impossible while preserving the fourth.

## Considered Approaches

### 1. Canonical contract in the skill with executable documentation tests

Make `packages/agent/skills/codex-auto-demo/SKILL.md` the operational source of truth, mirror the contract in agent-facing documentation, add a pressure-scenario fixture, and enforce it in `wrapper-docs.test.ts`.

This is the selected approach. It directly changes the agent behavior WES-270 owns without prematurely implementing later runtime policy work.

### 2. Add TypeScript risk-tier APIs now

A typed runtime contract would be machine-readable, but public-browse and unrestricted YOLO policy behavior belongs to WES-269 and WES-266. Adding types without the behavior would create a misleading public API and broaden this issue.

### 3. Publish a standalone policy reference

A separate policy document would be easy to read but would create another source of truth and make the start-of-skill selection rule easier to skip. The operational contract belongs where Codex must act on it.

## Canonical Tier Semantics

The skill publishes this exact behavioral matrix.

### `safe`

- Intended for read-only or idempotent rehearsal within declared exact origins.
- Allows bounded observation, ordinary navigation, and actions already accepted by the existing safe policy.
- Blocks user-visible mutations and non-idempotent requests.
- Blocks credential entry, payment data, uploads, downloads, WebSockets, unsafe schemes, and undeclared origins.
- Is available through the existing discovery and replay runtime policy. Fresh recording-tier establishment remains a downstream capability.

### `public-browse`

- Intended for ordinary unauthenticated public websites whose search, filtering, navigation, telemetry, or background services may use POST, fetch, beacon, or service-worker traffic without representing a meaningful user mutation.
- Allows traffic only after WES-269’s sanitized request classification can distinguish routine public browsing from meaningful side effects.
- Blocks account or data mutation, credential entry, payment data, uploads, downloads, WebSockets, unsafe schemes, and actions whose effect cannot be classified safely.
- Is contract-defined but unavailable until the downstream classifier and policy profile land. The skill must report the tier as unsupported before opening a browser; it must not downgrade to `safe` or approximate the behavior.

### `disposable`

- Intended for explicitly disposable environments and exact origins named by the user.
- Requires a fresh `environment-is-disposable` acknowledgement and exact allowed origins for each discovery or replay run.
- Allows user mutations and non-idempotent requests only within that exact scope.
- Still blocks credential entry, payment data, uploads, downloads, WebSockets, unsafe schemes, and undeclared origins.
- Is available through the existing discovery and replay runtime policy. Fresh recording-tier establishment remains a downstream capability.

### `yolo`

- Means the unrestricted Auto Demo tier. It no longer means bounded safe-mode autonomy.
- Disables Auto Demo discovery and replay safeguards after the user explicitly selects it. Host, platform, repository, and system instructions still apply.
- Does not imply plan approval, allow best-guess approval bypass, reuse discovery state for recording, or remove the mandatory review and explicit-approval gate.
- Is contract-defined but unavailable until WES-266 implements the profile. The skill must report the tier as unsupported before opening a browser; it must not silently substitute safe or disposable behavior.

## Start-Of-Skill Selection

The skill resolves risk before checking the target in a browser, launching Playwright, or sending a request.

1. If the prompt explicitly names exactly one canonical tier, use it. The word “YOLO” now unambiguously selects `yolo`; it is not interpreted through the historical WES-189 meaning.
2. If the prompt does not name exactly one tier, ask: “Choose discovery risk: safe, public-browse, disposable, or yolo?” Add concise consequences: disposable requires exact disposable origins; yolo disables Auto Demo safeguards.
3. If multiple tiers are named or the intent conflicts, ask the same focused question rather than guessing.
4. For disposable, collect the exact origins and fresh acknowledgement before opening a browser.
5. Check runtime support after selection and before browser or network activity. Unsupported tiers stop with a concise `risk_tier_not_supported` result and identify the downstream capability, without silently changing the tier.

Terms such as “autonomous,” “discover it,” “figure it out,” “go ahead,” urgency, or a request to avoid questions do not select a tier. They describe agency or pressure, not risk authority.

## Phase And Approval Boundaries

The host retains the selected tier as workflow intent, not as a reusable policy object or browser session.

- Discovery starts in a new isolated context with a policy freshly created for the selected tier.
- Replay starts in another new isolated context and freshly re-establishes the same selected tier. Disposable replay needs a new scoped acknowledgement. No discovery permit, page, context, cookies, storage, or runtime values carry over.
- Codex presents the replay-validated, transcript-safe plan. Review and explicit approval remain mandatory for every tier, including YOLO.
- Recording starts only after approval, in a new isolated capture context, with the same selected tier freshly established. If the runtime cannot establish that tier for recording, capture stops; it never falls back to a safer or broader tier without a new user selection.
- Discovery authority, browser state, replay repair authority, and runtime values never carry into recording.

The existing best-guess bypass remains migration-only and is never available to evidence-backed discovery plans.

## Documentation Structure

The current `Goal-Driven YOLO Discovery` section becomes a risk-tiered discovery section. It begins with selection and support checks, then retains the existing structured observation, action, evidence, compile, replay/repair, review, approve, execute, and handoff lifecycle.

Agent README and Claude parity documentation summarize the same tier names, selection-before-network rule, historical YOLO correction, unsupported-tier fail-closed behavior, fresh-phase policy establishment, and mandatory approval gate. The root README receives only the concise user-facing summary needed to avoid retaining the old overloaded terminology.

A new pressure-scenario fixture demonstrates an ambiguous urgent public-site request. Codex asks for the tier before browsing, does not interpret urgency as authority, and explains what happens for unsupported public-browse or YOLO selections. The completed WES-186 and WES-189 design specs, plans, and completion evidence remain unchanged historical artifacts.

## Error Handling

- Missing or ambiguous tier: ask one focused tier question and do nothing else.
- Disposable without exact origins or fresh acknowledgement: request the missing scope and do not browse.
- Public-browse or YOLO before runtime support: return `risk_tier_not_supported` before browser/network activity; do not approximate or downgrade.
- Tier cannot be freshly re-established for replay or recording: stop that phase and preserve prior evidence without reusing earlier authority.
- Policy denial in safe, public-browse, or disposable: report only the existing sanitized result and never repair around a hard boundary.
- Explicit YOLO selection: disable only Auto Demo safeguards when runtime support exists; all higher-priority instructions continue to apply.

## Behavior-Focused Verification

`packages/agent/src/wrapper-docs.test.ts` will verify observable skill behavior rather than Markdown layout:

- all four canonical tier names and distinguishing permissions are published;
- tier selection precedes browser and network activity;
- unambiguous YOLO selects the unrestricted tier, while generic autonomy does not;
- ambiguous or conflicting prompts require a focused question;
- unsupported public-browse and YOLO stop without fallback;
- disposable requires exact origins and a fresh acknowledgement;
- review and explicit approval remain mandatory for every tier;
- discovery, replay, and recording use fresh contexts and never carry authority or browser state;
- the historical best-guess bypass remains forbidden for discovery plans.

The pre-change pressure scenario is re-run against the updated skill. Because it contains the exact word “YOLO,” GREEN requires the agent to select the unrestricted tier and fail closed as unsupported before discovery until WES-266 lands. A separate ambiguous “autonomous discovery” scenario must stop and ask for a tier before browser or network activity.

## Scope Boundaries

In scope:

- canonical tier definitions and start-of-skill selection grammar;
- repository-owned Codex skill behavior;
- agent-facing documentation, parity notes, pressure fixture, and behavioral documentation tests;
- project-map and Linear evidence for WES-270.

Out of scope:

- runtime policy type or implementation changes;
- sanitized network classification;
- public-browse or YOLO policy enforcement;
- browser launch profiles, semantic form controls, target ranking, autonomous runner, or Cars.com acceptance;
- rewriting completed WES-186 or WES-189 specs, plans, or historical completion evidence.

## Acceptance Criteria

WES-270 is complete when the repository-owned skill defines the four-tier contract, resolves risk before any browser/network activity, fails closed for unsupported tiers, preserves mandatory review and approval, specifies fresh phase-scoped re-establishment, and has behavior-focused tests plus a pressure scenario that prove the old overloaded YOLO behavior is gone. No downstream runtime capability is claimed or implemented.
