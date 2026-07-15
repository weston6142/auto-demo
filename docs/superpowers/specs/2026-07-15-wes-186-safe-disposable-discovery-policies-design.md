# WES-186 Safe And Disposable Discovery Policies Design

## Context

WES-183 defined bounded, transcript-safe discovery sessions. WES-184 added browser observations with opaque target identity and runtime-only credential detection. WES-185 added a browser-agnostic rehearsal controller that requires per-action authorization and passes an opaque permit to the browser driver.

The remaining gap is a concrete policy. A host can currently supply any authorizer, while the Playwright driver does not enforce origin, request, download, or WebSocket restrictions. WES-186 makes safe rehearsal the built-in default and adds a deliberately narrow disposable-environment mode without changing the persisted `DiscoverySessionV1` contract or starting final capture.

## Goal

Add a policy-enforced Playwright discovery controller to `@auto-demo/agent` that:

- blocks credential entry, unsafe navigation, downloads, WebSockets, and unapproved top-level origin changes in every mode;
- blocks destructive-looking actions and server-mutating requests in safe mode;
- permits destructive-looking actions and server-mutating requests only within explicitly declared disposable origins;
- keeps disposable authority, resolved input values, browser request details, and internal permits out of persisted discovery artifacts;
- records bounded, sanitized policy outcomes as ordinary blocked or failed discovery attempts; and
- removes its browser hooks without closing or otherwise taking ownership of the host's page or context, including the Chromium DevTools Protocol WebSocket block.

## Non-Goals

WES-186 does not:

- build a confirmation UI or infer consent from conversational text;
- authenticate to applications or permit credential, secret, payment, or production-data entry;
- own browser launch, context creation, page closure, or final media capture;
- compile discovery evidence into a walkthrough plan;
- grant disposable authority to replay, approval, execution, or final capture;
- guarantee that an HTTP method is semantically read-only or mutating; or
- support wildcard origins, arbitrary URL schemes, file uploads, or downloads.

## User Experience

Safe rehearsal requires no disposable declaration. The host supplies the exact origins the session may navigate among and creates a policy-enforced Playwright controller. Inspection, bounded waits, refresh/back operations, non-mutating navigation, and clearly non-destructive interactions can proceed. Policy denials remain visible as sanitized discovery attempts so the host agent can choose a safer path or ask the user for a disposable environment.

Disposable discovery is opt-in. The host translates explicit user approval into a runtime-only declaration containing an acknowledgement and an exact set of disposable origins. The library validates the declaration before creating a controller. Within those origins, potentially mutating clicks and non-idempotent HTTP requests may proceed. All hard protections remain active.

The declaration applies to one controller instance only. It is never written into `DiscoverySessionV1`, compiled plans, approval artifacts, or final-capture inputs. A later replay or capture starts with no disposable authority.

## Considered Approaches

### Coupled policy-enforced Playwright factory — selected

A new factory owns both the policy authorizer and Playwright enforcement hooks. Its internal permit links one authorized action to one guarded driver execution.

This prevents a caller from pairing a permissive authorizer with missing or differently scoped browser guards. It preserves the generic WES-185 controller and gives the Playwright-specific protections access to transient target and request metadata.

### Separately composed public authorizer and browser guard

This is more flexible, but installation order, scope mismatches, cleanup, and omitted guards become caller responsibilities. A disposable authorizer without its matching request guard would be an unsafe partial configuration.

### Policy inside the generic rehearsal controller

This would reduce the number of factories but would force browser schemes, origins, requests, downloads, and Playwright lifecycle concerns into the browser-agnostic controller. It would also make non-browser drivers inherit irrelevant policy concepts.

## Public API Shape

The package adds two validated policy inputs:

```ts
type SafeDiscoveryPolicy = {
  mode: "safe";
  allowedOrigins: string[];
};

type DisposableDiscoveryPolicy = {
  mode: "disposable";
  acknowledgement: "environment-is-disposable";
  allowedOrigins: string[];
};
```

`allowedOrigins` contains normalized exact origins, not paths or wildcard patterns. Duplicate origins are removed after validation. Origins may use HTTPS or explicitly supplied HTTP; usernames, passwords, query strings, fragments, opaque origins, and non-HTTP(S) schemes are rejected. The initial page origin must be included.

The new factory is conceptually:

```ts
await createPolicyEnforcedPlaywrightDiscoveryRehearsalController(page, {
  chromiumNetworkInstrumentation: "exclusive",
  policy,
  inputResolver,
  // Existing WES-185 clocks, IDs, and optional observation artifact sink.
});
```

Factory creation is asynchronous because all required browser hooks must be installed before a controller is returned. It returns the existing `start()`, `perform()`, `stop()`, and `getSession()` operations plus an idempotent `dispose()` operation for removing CDP request/WebSocket interception, the popup route, and event listeners owned by the policy guard. `stop()` makes the controller terminal and performs the same cleanup automatically; `dispose()` waits for any in-flight operation before teardown and supports abandoned setup or host teardown before a terminal stop. Neither operation closes the page or browser context.

The guard uses a page-scoped Chromium DevTools Protocol session rather than Playwright's redirect-, service-worker-, and popup-limited page routing or irreversible `page.routeWebSocket()` API. CDP Fetch interception evaluates every request and redirect hop, service-worker handling is bypassed, and an exact context route plus page listener rejects and closes popup activity. The factory therefore requires an isolated Chromium rehearsal context containing only the supplied page at creation and the explicit `chromiumNetworkInstrumentation: "exclusive"` acknowledgement that no external client manages CDP network state on that target. It fails closed when those enforcement surfaces are unavailable and removes its enforcement when the controller stops or is disposed.

The existing generic and custom-authorizer factories remain available for internal tests and advanced integrations. Documentation identifies the policy-enforced factory as the supported safe default for Playwright discovery.

## Architecture

### Policy input validator

The validator normalizes exact origins and rejects malformed or ambiguous declarations before any browser hooks are installed. Disposable mode requires the exact acknowledgement literal and at least one allowed origin. The result is immutable runtime configuration.

### Pure action policy

The action policy evaluates sanitized session state, the latest observation, the requested action, public target metadata, and transient runtime target risk. It returns either a bounded denial or an internal permit.

The permit is module-private and valid for one action execution. It contains only normalized enforcement facts such as mode and allowed origins. It cannot be serialized into the discovery session and is not reusable by final capture.

### Runtime target-risk registry

WES-184 already detects credential-like controls from input type and autocomplete metadata, but intentionally omits that sensitive implementation detail from persisted targets. The raw Playwright observation boundary adds similarly transient upload and sensitive-payment classifications. The shared opaque-target registry is extended with runtime-only risk metadata keyed by target ID.

The policy can therefore hard-block typing into credential-like or sensitive-payment targets and clicking upload/file controls without adding risk flags to `DiscoveryInteractiveTarget` or changing `DiscoverySessionV1`. Registry entries reset on main-document replacement and disappear when the controller is disposed.

### Playwright policy guard

The guard is installed before `start()` and shares the validated policy with the authorizer. It observes the supplied page plus only the minimum isolated-context navigation surface needed to reject popup first requests. It:

- rejects disallowed top-level navigation before it commits;
- evaluates every redirect hop and bypasses service-worker handling;
- rejects popup navigations and subresources and closes the popup;
- blocks non-idempotent HTTP requests in safe mode;
- in disposable mode, allows non-idempotent requests only to declared disposable origins;
- closes attempted WebSockets;
- cancels downloads immediately and marks the active action as a policy violation;
- treats unsafe or credential-bearing URLs as violations; and
- exposes only a bounded violation code and generic summary to the controller.

The guard does not store headers, cookies, request bodies, response bodies, download names, or raw URLs. Hook installation is all-or-nothing. If required Playwright enforcement cannot be installed, controller creation fails rather than falling back to an authorizer-only configuration.

Because the browser is host-owned, the guard removes only its exact context popup route, event listeners, and CDP session state. Cleanup attempts every step, reports a fixed error if any step fails, and remains retryable. The isolated-context/no-external-CDP precondition prevents cleanup from competing with unrelated page or CDP network policy.

### Guarded driver execution

The internal permit arms a single action window immediately before the driver executes. The driver consumes the permit once, applies a runtime value-safety check to any resolved demo input, performs at most one browser action, then waits for bounded browser-event quiescence and checks the guard plus the raw resulting page URL before recording the resulting observation. Unsafe non-network page transitions are failed and restored to the last safe in-scope URL before observation. The value-safety check rejects oversized or secret-like resolved values without retaining or echoing them.

If the browser blocks a request, navigation, WebSocket, or download, the attempt finishes with a sanitized policy outcome. A browser effect that cannot be fully prevented is reported as failed rather than successful. No resolved input value or raw browser error enters the attempt.

## Policy Matrix

| Behavior                                               | Safe                                      | Disposable                                |
| ------------------------------------------------------ | ----------------------------------------- | ----------------------------------------- |
| Inspect, bounded wait                                  | Allow                                     | Allow                                     |
| Back, refresh                                          | Allow if enforcement remains within scope | Allow if enforcement remains within scope |
| Navigate to declared origin                            | Allow                                     | Allow                                     |
| Navigate to undeclared origin                          | Block                                     | Block                                     |
| Non-HTTP(S) or credential-bearing URL                  | Block                                     | Block                                     |
| Clearly non-mutating click                             | Allow                                     | Allow                                     |
| Potentially mutating click                             | Block                                     | Allow within disposable origins           |
| Type bounded, non-secret demo-data into ordinary field | Allow                                     | Allow                                     |
| Type into credential-like field                        | Block                                     | Block                                     |
| Non-idempotent request                                 | Block                                     | Allow only to disposable origins          |
| WebSocket                                              | Block                                     | Block                                     |
| Download                                               | Block/cancel                              | Block/cancel                              |
| Upload or file chooser                                 | Block                                     | Block                                     |

`GET`, `HEAD`, and `OPTIONS` are treated as non-mutating for the MVP request guard. Other methods are treated as potentially mutating. Passive HTTP(S) subresources may load, but top-level navigations and all non-idempotent requests must satisfy the origin policy. The design documents that method classification is a practical boundary, not proof of server semantics.

## Action Classification

The pure policy uses conservative behavior:

- `inspect`, `wait`, `back`, and `refresh` pass action authorization, with browser enforcement still active;
- `navigate` requires a safe HTTP(S) URL, no credential-like URL data, and an allowed exact origin;
- `type` requires `valueClass: "demo-data"`, a live target, no runtime credential or sensitive-payment risk, and a bounded resolved value that does not match secret detectors;
- a target already marked `potentially-mutating` is blocked in safe mode;
- click labels and roles are also checked against the existing destructive-action vocabulary so obvious destructive controls remain blocked when markup lacks form metadata; and
- unknown, stale, disabled, upload, file-input, or credential-risk targets fail closed.

The destructive vocabulary is shared with walkthrough validation through a small focused helper, rather than maintaining two divergent regex lists. Browser-network enforcement remains separate because discovery operates an existing page while walkthrough validation owns a fresh context.

## Origin And Redirect Rules

Origin comparison uses normalized scheme, hostname, and effective port. Paths do not broaden authority. Subdomains and sibling ports require separate entries. Redirects are evaluated at every top-level navigation hop; a redirect to an undeclared origin is blocked.

The policy validates the current page origin during `start()`. If the page is already outside scope, start fails without recording a discovery session. Later unexpected out-of-scope page state makes the current attempt fail and the session remain available for a safe host decision unless the browser itself becomes unavailable.

## Outcomes And Evidence

Stable outcome codes distinguish the main policy decisions without exposing browser details:

- `credential_action_blocked`
- `sensitive_input_blocked`
- `destructive_action_blocked`
- `origin_not_allowed`
- `unsafe_navigation_blocked`
- `mutating_request_blocked`
- `websocket_blocked`
- `download_blocked`
- `upload_blocked`
- `policy_guard_unavailable`

Summaries are fixed or derived only from already sanitized public action metadata. Raw URLs are reduced to normalized origins when an origin is safe to expose; request paths, query strings, fragments, bodies, headers, download names, and resolved input values are never included.

Pre-action denials become `blocked` attempts. Violations detected while an allowed action executes become `failed` attempts because some browser processing may already have occurred. The host can explicitly retry only after choosing a different action or policy scope; the library never silently upgrades safe mode to disposable mode.

## Failure And Cleanup Behavior

- Invalid policy declarations fail before controller creation.
- Fallible CDP setup precedes context hooks. Partial installation receives bounded immediate cleanup retries before returning an error; if rollback still cannot finish, the public creation error retains an idempotent `cleanup()` operation for later retry. Controller creation fails closed if required CDP or context enforcement cannot be installed.
- The current page origin is revalidated at `start()` before a session is recorded.
- Concurrent disposal waits for an in-flight start, action, or stop before removing enforcement.
- Post-action quiescence races all observed pending browser work against the remaining fixed deadline. Expiry records `policy_guard_unavailable`, makes the guard terminal for future actions, and still permits forced retryable cleanup despite stale pending work.
- An authorization or guard exception fails closed with a sanitized stable error.
- A disposed controller rejects later `start()` or `perform()` calls.
- `stop()` remains explicit and terminal; cleanup failure is reported without reopening the session.
- Browser loss continues to use the WES-185 terminal browser-unavailable behavior.
- No policy failure starts capture, closes the host page, or clears unrelated Playwright routes/listeners.

## Testing Strategy

Tests stay behavior-oriented and exercise public outcomes rather than private route installation.

Pure policy tests cover:

- policy normalization and invalid declarations;
- exact-origin, scheme, redirect, and credential-bearing URL decisions;
- safe versus disposable destructive-action decisions;
- credential, payment, and upload-risk targets in both modes;
- secret-like resolved values without retaining or echoing them; and
- fixed, transcript-safe denial evidence.

Playwright integration tests use local routed pages to verify:

- safe GET interactions succeed;
- POST, PUT, PATCH, and DELETE attempts are blocked in safe mode;
- scoped mutations succeed in disposable mode and out-of-scope mutations remain blocked;
- top-level redirects cannot escape allowed origins;
- popup navigation/subresource requests, non-network top-level transitions, and service-worker-handled mutations cannot bypass a failed policy outcome;
- downloads, WebSockets, uploads, and credential inputs remain blocked in both modes;
- blocked browser activity produces failed sanitized attempts without leaking request data;
- runtime input resolution happens only after authorization;
- secret-like resolved input is rejected before a browser effect and absent from results;
- one permit cannot authorize a later action; and
- stop/dispose removes policy-owned context routing, listeners, and CDP enforcement while leaving the host page open; cleanup failure is retryable and disposal cannot race an action.

Existing WES-183 through WES-185 suites remain unchanged except for focused shared-helper coverage. Repository build, typecheck, lint, workspace tests, formatting, and diff checks remain the completion gate.

## Documentation And Handoff

`packages/agent/README.md` will document safe mode as the default Playwright discovery path, show an explicit disposable declaration, list hard protections that never relax, and state that the host must obtain user approval and provide an isolated Chromium context containing only the rehearsal page with no external CDP network overrides.

WES-187 receives only completed `DiscoverySessionV1` evidence and therefore cannot inherit disposable authority. WES-188 replay and WES-189 host workflow must establish their own safe execution and approval rules. Final capture continues to require the existing review and approval lifecycle and never consumes a WES-186 permit or policy declaration.

## Acceptance Criteria

WES-186 is complete when:

1. safe Playwright discovery has a built-in policy-enforced factory;
2. disposable mode requires a validated runtime-only exact-origin declaration;
3. action authorization and browser enforcement cannot be configured independently through that factory;
4. hard protections remain enforced in both modes;
5. policy outcomes are bounded, deterministic, and transcript-safe;
6. disposable authority is absent from persisted sessions and downstream plan/capture artifacts;
7. policy hooks, including WebSocket enforcement, clean up without taking ownership of the host browser; and
8. behavior-focused tests prove the policy matrix and cleanup contract.
