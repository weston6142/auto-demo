# WES-266 Public-Browse and Phase-Scoped YOLO Policy Design

## Summary

WES-266 turns the four risk tiers defined by WES-270 into executable discovery and replay policy behavior. `safe` and `disposable` retain their current behavior. `public-browse` permits routine unauthenticated public-site browsing, search, filtering, and narrowly classified background traffic without treating every POST as a user mutation. `yolo` disables Auto Demo's discovery and replay safeguards after explicit selection while leaving host, platform, repository, and system instructions in force.

Review and explicit approval remain mandatory for every tier. Discovery, replay, and recording use fresh isolated contexts. A discovery permit, policy guard, browser, cookie jar, or other browser state never crosses the review boundary. After approval, the host must freshly resolve the selected tier for recording; selecting YOLO again means the new recording context runs without Auto Demo policy enforcement.

## Scope

### In scope

- First-class `public-browse` and `yolo` variants in the public discovery policy contract.
- Policy validation, action authorization, Playwright rehearsal, and Playwright replay behavior for all four tiers.
- A centralized, behavior-oriented network decision for classified requests.
- Fresh-context and no-authority-carryover requirements in the repository-owned Codex workflow.
- Public documentation and regression fixtures that no longer report public-browse or YOLO as unsupported.
- Black-box tests for observable action, request, replay, and workflow outcomes.

### Out of scope

- Browser launch-profile parity, Cloudflare fallback, or anti-bot detection (WES-272).
- New form actions or richer form-state observation (WES-271).
- Structural positional target intent (WES-267).
- A discovery CLI or repository-owned autonomous runner (WES-268).
- Running the final Cars.com acceptance test (WES-273).
- Weakening the approval lifecycle or introducing a best-guess bypass for discovery plans.
- Persisting network URLs, bodies, headers, credentials, tokens, cookies, or browser state.

## Approaches Considered

### 1. First-class policy modes with centralized enforcement (selected)

Extend `DiscoveryPolicy` and its validated form with `public-browse` and `yolo`. Keep action decisions in `authorizeDiscoveryPolicyAction()`, network decisions in one pure classifier-driven policy function, and let rehearsal/replay install a guard only for enforced modes.

This keeps tier identity visible through the public API, makes behavior consistent between discovery and replay, and supports direct black-box tests without introducing a new orchestration layer.

### 2. Translate new tiers into safe/disposable at the host boundary

The host could approximate public-browse with disposable and implement YOLO by avoiding policy-aware factories. This minimizes library changes, but it silently changes the selected contract, loses tier identity, and makes phase parity difficult to verify. It is rejected.

### 3. Replace policy modes with a generic capability matrix

A matrix of capabilities could model future tiers, but it would expand the public contract and validation surface beyond the four approved modes. It is unnecessary for this milestone and is rejected.

## Public Policy Contract

`DiscoveryPolicy` becomes a discriminated union:

- `{ mode: "safe", allowedOrigins }`
- `{ mode: "public-browse", allowedOrigins }`
- `{ mode: "disposable", acknowledgement: "environment-is-disposable", allowedOrigins }`
- `{ mode: "yolo" }`

Safe, public-browse, and disposable require one or more exact HTTP(S) origins and require the current page origin to be declared. Disposable still requires its exact acknowledgement. YOLO requires no Auto Demo acknowledgement or origin allowlist because its explicit risk-tier selection is the authority to bypass Auto Demo safeguards. Runtime shape validation remains fail-closed for malformed policies.

Validated policies retain the selected mode. Enforced modes carry their normalized exact-origin scope; YOLO carries an empty origin set only to preserve the shared validated-policy shape, and enforcement must never interpret that set as YOLO scope. Opaque action permits remain single-use for enforced modes. YOLO may use an opaque per-action structural token required by the shared controller interface, but no guard consumes it and it conveys no reusable policy authority.

## Action Authorization

Safe behavior is unchanged: exact-origin navigation and non-mutating interactions are allowed; potentially mutating or destructive clicks, credentials, payment data, uploads, unsafe navigation, and missing runtime risk metadata are blocked.

Disposable behavior is unchanged: exact-origin mutations are allowed after a fresh acknowledgement, while credential, payment, upload, unsafe-origin, download, and WebSocket boundaries remain.

Public-browse:

- permits exact-origin HTTP(S) navigation, typing non-secret demo data, ordinary clicks, and public form submissions such as search or filtering;
- blocks credential and payment input, uploads, disabled or unknown targets, unsafe schemes, and undeclared top-level origins;
- blocks actions whose public label or role carries destructive or account/data-mutation language;
- permits a form-submit target marked `potentially-mutating` only when it is not classified as destructive by the public action metadata;
- never converts a blocked action into disposable authority.

YOLO authorizes every structurally valid discovery action without applying Auto Demo target-risk, origin, credential, payment, upload, or destructive-language checks. This is deliberately limited to Auto Demo policy behavior; callers still obey higher-priority instructions and the browser/runtime's own constraints.

## Network Enforcement

One pure network-decision function consumes only the WES-269 sanitized classification plus the selected policy mode, declared origins, request origin, and whether an authorized action is active. It returns allow/block without retaining raw request data.

### Safe

- Allows read-method traffic.
- Blocks every potential-side-effect or unknown method with `network_request_blocked`.
- Retains existing top-level origin, WebSocket, popup, download, service-worker isolation, and recovery behavior.

### Public-browse

- Allows read-method traffic.
- Allows potential-side-effect top-level document navigation only when it is exact-origin and belongs to an active authorized action, covering public POST-based search/filter forms.
- Allows same-origin subresource `xhr-fetch` and `service-worker` potential-side-effect traffic, including routine background requests.
- Allows subresource `beacon` potential-side-effect traffic with a known HTTP(S) request origin, including cross-origin public-site telemetry.
- Blocks cross-origin potential-side-effect XHR/fetch, top-level side effects without an active action, `other` request classes, unknown method categories, and unknown origins.
- Keeps WebSockets, downloads, popups, unsafe navigation, and undeclared top-level origins blocked.

These rules intentionally use the classifier rather than request bodies, URLs, headers, or site-specific exceptions. They allow routine public traffic while retaining a deterministic boundary around unclassified or meaningfully mutating behavior.

### Disposable

- Retains the existing exact-origin potential-side-effect allowance.
- Unknown method categories continue to fail closed.

### YOLO

- Installs no Auto Demo request interception, WebSocket block, popup block, download cancellation, service-worker bypass, or navigation recovery guard.
- Does not generate Auto Demo policy violations or sanitized blocked-request diagnostics because Auto Demo does not block the traffic.

## Rehearsal and Replay

The policy-enforced rehearsal controller keeps one public entry point for all tiers. Enforced modes validate scope, install the guard, authorize each action, and return bounded policy outcomes as today. YOLO validates only its policy shape, creates the existing structured rehearsal runtime without the Auto Demo guard, and preserves the same bounded observations, action schema, input resolution, session lifecycle, and transcript-safety rules.

Replay uses the same selected tier in a fresh browser context. Safe, public-browse, and disposable bootstrap and action traffic through the centralized network decision. YOLO skips bootstrap routing and guard installation. Replay still performs deterministic target matching, assertions, bounded repair, runtime binding validation, and fresh-context creation; bypassing policy does not bypass correctness.

Default policy remains safe when a caller omits a policy. No existing safe/disposable caller changes behavior.

## Recording Boundary

WES-266 does not add a discovery CLI or store risk authority in a walkthrough plan. The repository-owned skill remains the host orchestration layer:

1. Resolve the tier before discovery.
2. Create a fresh discovery context with that tier.
3. Create a separate fresh replay context with the same tier selected again.
4. Present the replay-validated plan and obtain explicit approval in a separate turn.
5. Discard discovery/replay contexts and all policy permits.
6. Resolve the selected tier again immediately before creating the isolated recording context.

For YOLO, step 6 explicitly selects unrestricted Auto Demo behavior again; it does not rely on a discovery permit or reused browser. The existing approved execution path already owns a new capture context and applies no discovery/replay guard, so the host must treat that absence as the freshly established YOLO recording policy, not as inherited authority. Safe/public-browse/disposable recording enforcement beyond the existing approved execution contract is not introduced by this issue.

## Errors and Diagnostics

- Malformed policies return `invalid_discovery_policy` before browser activity.
- Missing disposable acknowledgement retains `disposable_acknowledgement_required`.
- Enforced-mode scope failures retain `origin_not_allowed`.
- Public-browse blocked traffic returns existing bounded `network_request_blocked` evidence.
- Public-browse never includes raw request fields or site-specific exceptions.
- YOLO does not manufacture policy-block errors; browser/action failures retain their existing non-policy replay or rehearsal errors.
- Cleanup remains idempotent. YOLO cleanup closes only the ordinary fresh browser/runtime resources because no guard was installed.

## Testing

Tests assert behavior through public results or browser-visible effects:

- Policy validation accepts all four supported modes and rejects malformed shapes.
- Action authorization distinguishes safe, public-browse, disposable, and YOLO for public search submits, destructive clicks, credentials, payment inputs, uploads, missing metadata, and origin changes.
- Pure network-decision cases cover each request class, method category, origin relation, scope, and active/idle action boundary without raw request data.
- Playwright guard tests prove public-browse permits same-origin search/background POST and beacon traffic but blocks cross-origin XHR mutation, unknown methods, WebSockets, downloads, and unsafe navigation.
- Rehearsal tests prove public-browse can complete a public search effect and YOLO can cross an Auto Demo-only boundary while still producing structured session evidence.
- Replay tests prove the same tier behavior is freshly applied at bootstrap and action time and that YOLO bypasses guard setup without bypassing plan assertions.
- Wrapper tests prove public-browse and YOLO are supported, review/approval remain mandatory, recording re-selects the tier in a fresh context, and no permit/browser state crosses phases.
- Existing safe/disposable suites remain green to prove compatibility.

## Documentation

Update the repository root, agent package README, and Codex skill to:

- mark public-browse and YOLO discovery/replay behavior as implemented;
- describe the classifier-based public-browse boundary without site-specific exceptions;
- state that YOLO disables only Auto Demo safeguards;
- retain mandatory review and explicit approval;
- require fresh tier establishment for discovery, replay, and recording;
- remove `risk_tier_not_supported` guidance for these two modes.

## Acceptance Criteria

WES-266 is complete when:

1. All four policy modes are public, validated, and behaviorally distinct.
2. Public-browse completes representative public search/background traffic without allowing destructive, credential, payment, upload, unknown, or cross-origin XHR mutation behavior.
3. YOLO bypasses Auto Demo safeguards in fresh discovery and replay contexts without weakening structured evidence, deterministic replay, review, approval, or host/platform instructions.
4. The Codex workflow freshly establishes YOLO again for the isolated recording phase and explicitly forbids authority or browser-state carryover.
5. Diagnostics remain bounded and secret-free.
6. Safe and disposable behavior remains compatible.
7. Focused tests and the repository validation suite pass.
