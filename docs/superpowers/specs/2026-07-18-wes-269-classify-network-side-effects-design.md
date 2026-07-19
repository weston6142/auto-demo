# WES-269 Network Side-Effect Classification Design

## Purpose

Auto Demo currently treats every non-`GET`/`HEAD`/`OPTIONS` request observed by the Chromium discovery guard as the same `mutating_request_blocked` outcome. That protects safe discovery, but it cannot distinguish top-level navigation from background search, telemetry, beacon, fetch, service-worker, or other traffic. It also gives the host too little sanitized evidence to explain what was blocked or to implement the later `public-browse` policy safely.

WES-269 introduces a reusable request-classification contract and bounded network diagnostics. The policy guard will make decisions from the classification and expose only non-secret aggregate evidence. WES-266 will later use the same contract to implement `public-browse` and unrestricted YOLO behavior; WES-269 does not add either policy mode.

## Scope

This issue will:

- classify intercepted requests as `document-navigation`, `xhr-fetch`, `beacon`, `service-worker`, or `other`;
- classify methods as `read`, `potential-side-effect`, or `other`;
- classify origin relation as `same-origin`, `cross-origin`, or `unknown`;
- classify request scope as `top-level` or `subresource`;
- aggregate blocked requests into bounded sanitized diagnostics;
- expose the total blocked-request count and whether declared visible expectations were prevented;
- make safe-policy network decisions consume the classifier rather than interpreting the raw method directly;
- retain current hard boundaries for unsafe URLs, origin escape, WebSockets, downloads, uploads, and unavailable enforcement;
- preserve replay's fail-closed behavior while allowing policy-enforced rehearsal results to expose the new diagnostics;
- document the public contract and the handoff to WES-266.

This issue will not implement `public-browse` or YOLO policies, change risk-tier selection, reuse browser state between phases, change browser launch profiles, add form actions, alter target ranking, or create an autonomous runner.

## Considered Approaches

### 1. Reusable pure classifier with guard-owned aggregation — selected

A focused module converts minimal transient browser metadata into a small sanitized value object. The existing Chromium guard calls the classifier before deciding whether to continue or fail a request and aggregates only the classifier output.

This creates the stable decision input WES-266 needs, keeps browser enforcement in one place, and makes secret non-retention testable. It also allows classifier tests to cover request classes without depending on private CDP mechanics.

### 2. Classify only inside the policy guard

Keeping all classification branches in `playwrightDiscoveryPolicyGuard.ts` would require fewer files, but it would couple policy decisions to CDP details and force WES-266 either to duplicate logic or to depend on guard internals. It is rejected because the classification is a public policy input, not a private interception detail.

### 3. Add a separate full network recorder

An independent event recorder could provide richer history, but it would duplicate the guard's instrumentation, complicate event correlation, and create unnecessary retention risk for URLs, headers, and bodies. WES-269 needs bounded policy evidence rather than a network archive, so this approach is rejected.

## Public Contract

`@auto-demo/agent` will export a pure classifier and its sanitized types from a focused network-classification module.

The classifier input is an internal adapter boundary containing only values required to classify one request:

- HTTP method;
- resource type;
- whether it is a navigation request;
- whether it is associated with the main frame;
- whether it originated from a service worker;
- the current page origin and request origin after credential-safe normalization.

Raw browser URLs may be inspected transiently to derive a normalized origin relation, but they are never copied into the classifier result, guard state, thrown errors, attempt outcomes, or diagnostics. Request bodies, headers, cookies, credentials, filenames, and tokens are never inputs to the classifier.

Unsafe top-level recovery retains only the last approved normalized origin. Recovery returns to that origin root instead of retaining or replaying the prior path, query, or fragment.

The sanitized classification contains exactly:

- `requestClass`: `document-navigation`, `xhr-fetch`, `beacon`, `service-worker`, or `other`;
- `methodCategory`: `read`, `potential-side-effect`, or `other`;
- `originRelation`: `same-origin`, `cross-origin`, or `unknown`;
- `scope`: `top-level` or `subresource`.

Classification order is deterministic. A service-worker-originated request is `service-worker`; otherwise a navigation document is `document-navigation`; `XHR` and `Fetch` are `xhr-fetch`; `Ping` is `beacon`; all remaining resource types are `other`. `GET`, `HEAD`, and `OPTIONS` are `read`; `POST`, `PUT`, `PATCH`, and `DELETE` are `potential-side-effect`; unfamiliar methods are `other` and fail closed.

## Guard Integration And Aggregation

The Chromium guard remains the only component that continues or fails intercepted network requests. It will derive a sanitized classification before evaluating the policy. Safe policy continues only classified `read` requests whose existing origin rules pass. Classified `potential-side-effect` and `other` methods fail closed. Disposable policy keeps its current exact-origin, active-permit behavior for potential side effects.

The guard does not retain one record per raw request. For the current action, it aggregates blocked requests by the four classification fields. Each aggregate entry contains the classification plus a positive `blockedRequestCount`. The list is capped at eight distinct entries. Additional distinct entries increment an `omittedClassificationCount`; every blocked request still contributes to `totalBlockedRequestCount`.

The guard's violation uses the neutral code `network_request_blocked` and fixed summary `Discovery blocked classified network activity.` The historical `mutating_request_blocked` code is no longer emitted by the guard because it overstates what is known about background `POST`, beacon, and unknown-method traffic. Validation may continue to recognize historical saved outcomes if necessary for existing fixture compatibility, but new code and documentation use the neutral result.

Idle violations retain the same aggregate shape and remain consumable exactly once. An action violation takes precedence according to the guard's existing first-hard-boundary behavior; classified network aggregates are attached only to a network violation and never leak into an unrelated higher-priority outcome.

## Rehearsal Diagnostics And Visible Effects

Policy-enforced rehearsal will surface a public `DiscoveryNetworkDiagnostic` in the successful controller result that records:

- fixed code `network_requests_blocked`;
- bounded aggregate classifications;
- `totalBlockedRequestCount`;
- `omittedClassificationCount` when nonzero;
- `expectedVisibleEffectPrevented`.

The guard produces the aggregate classification and counts. The generic rehearsal controller already observes the page after execution and evaluates declared expectations. It will refine a network diagnostic after that evaluation: `expectedVisibleEffectPrevented` is `true` when at least one declared expectation remains unmatched after classified network activity was blocked, and `false` when no expectation was declared or every declared expectation still matched. This reports observable behavior rather than guessing from the request method.

The diagnostic is returned to the caller but is not persisted inside `DiscoverySessionV1`. Existing portable attempt outcomes remain `{ code, summary }`, avoiding a schema migration and preventing request evidence from becoming durable session history by accident. The finalized attempt uses `network_request_blocked` when the blocked activity causes the driver failure.

The generic driver-result boundary will accept optional public diagnostics so the policy adapter can carry the sanitized aggregate to the expectation-evaluation point. Non-policy drivers and observation diagnostics remain compatible.

## Replay Behavior

Replay continues to translate any policy-guard violation into the existing `policy_blocked` replay error. It does not persist or return network details because the replay result contract currently needs only pass/fail repair evidence. Replay tests will prove that the new violation shape does not weaken fail-closed behavior or expose raw request data through thrown errors.

WES-266 may later choose to expose the same sanitized classification in richer replay diagnostics. That is not required for WES-269.

## Browser Metadata Mapping

The guard will use the request-stage metadata already available at its exclusive Chromium interception boundary. CDP resource type and main-frame identity determine most classifications. A missing frame on a non-document request is treated as service-worker context; document requests remain document navigation because initial navigation can precede frame attachment. The Playwright request abstraction's service-worker and navigation indicators may be used when available, but classification must remain deterministic when optional metadata is absent.

Service workers remain bypassed for enforcement as they are today. The `service-worker` class describes requests observed as worker-originated; it does not authorize worker traffic or weaken the bypass requirement.

## Error Handling And Security

- Credential-bearing or non-HTTP(S) request URLs remain `unsafe_navigation_blocked` and are failed before classification evidence is exposed.
- An unparseable request origin yields `originRelation: unknown`; it never includes the raw value and its request fails closed.
- Unknown methods are `other` and fail closed in safe mode.
- Aggregation overflow is represented only by a count; entries are never allowed to grow without bound.
- No diagnostic field accepts arbitrary browser strings. All strings are closed enums or fixed messages.
- No request URL, path, query, fragment, body, header, cookie, credential, token, filename, or raw method is stored or returned.
- Guard setup, interception, cleanup, and quiescence failures retain `policy_guard_unavailable` behavior.
- Existing WebSocket, popup, download, upload, origin, and unsafe-navigation boundaries are unchanged.

## Testing

Behavior-focused tests will cover:

- deterministic pure classification for document navigation, XHR/fetch, beacon, service-worker, and other resources;
- read, potential-side-effect, and unknown method categories;
- same-origin, cross-origin, and unknown origin relations;
- top-level and subresource scope;
- safe policy decisions consuming classification rather than branching on raw methods;
- disposable exact-origin mutation behavior remaining unchanged;
- guard results for blocked fetch, beacon, document, service-worker-context, and unknown requests;
- aggregation counts, eight-entry bounding, and omitted classification counts;
- a secret-bearing URL/body/header fixture that cannot appear in serialized classifications, diagnostics, outcomes, or errors;
- controller results reporting whether declared visible expectations were prevented;
- idle violation one-time consumption and action quiescence;
- replay remaining fail closed with the new violation code and diagnostic shape;
- public exports and documentation describing the sanitized contract and WES-266 boundary.

Tests will drive the public classifier, controller results, guard behavior, and replay outcomes. They will not assert private listener registration order, private maps, or the exact internal CDP call sequence.

## Completion Criteria

WES-269 is complete when the reusable classifier covers every required request class; safe enforcement consumes it; bounded sanitized diagnostics report classification, blocked counts, origin/scope, and visible-effect prevention; secret-bearing request data cannot escape; existing hard boundaries and replay fail-closed behavior remain intact; and documentation clearly leaves public-browse and YOLO policy decisions to WES-266.
