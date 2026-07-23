# WES-273 macOS Capture Helper Supervision Design

Date: 2026-07-21
Issue: WES-273, "Pass fresh-agent Cars.com Kia Sorento acceptance"

## Goal

Make macOS Screen Recording permission, preflight, capture, and shutdown truthfully belong to the signed `Auto Demo Capture.app`. Replace direct inner-executable launch with a supervised Launch Services boundary, prove the real local capability, and only then resume the prompt-only Cars.com acceptance.

## Problem

The published helper is a correctly signed agent app with bundle identifier `com.autodemo.capture-helper`, but TypeScript invokes `Contents/MacOS/AutoDemoCaptureHelper` directly for permission probes and session service. On macOS 26.5.1, the direct process does not receive the Screen Recording grant shown for `Auto Demo Capture` in System Settings. Launching the app bundle through Launch Services creates and uses the correct permission identity.

The shipped unit tests mock helper command results and run in Ubuntu CI. They prove parsing, signing orchestration, socket behavior, and bounded responses, but not macOS process attribution or Swift compilation. The missing real-helper gate allowed PR #66 to merge with an invalid launch boundary.

## Scope

This correction owns:

- one native supervisor executable shipped inside the signed helper bundle;
- Launch Services startup for permission probes and session service;
- exact launched-application lifecycle ownership;
- private one-shot probe results;
- TypeScript and Swift regression coverage;
- a focused macOS CI job for build and unit verification;
- a real local signed-helper capture and cleanup gate;
- the subsequent clean WES-273 Cars.com acceptance.

It does not add a model-provider adapter, a persistent daemon, a login item, a network service, a new permission identity, Cars.com-specific behavior, or any editor/export behavior.

## Approaches Considered

### Native Bundle Supervisor With `NSWorkspace` (Selected)

Ship `AutoDemoCaptureSupervisor` inside `Auto Demo Capture.app`. Node starts the supervisor, which derives its sibling app bundle from its own installed location and launches a fresh background instance through `NSWorkspace.openApplication`. The returned `NSRunningApplication` provides exact child identity, termination observation, graceful termination, and force-termination fallback.

This preserves one TCC identity and gives the session direct lifecycle ownership without introducing a Node native addon.

### `/usr/bin/open` Proxy

The `open` command can establish the correct app identity, but it is a proxy rather than the launched application. One-shot commands can produce ambiguous exit status, and terminating the proxy does not provide a strong contract that the app instance also terminated. Making this safe would require additional shutdown protocol behavior while still leaving weaker crash ownership. Rejected.

### AppKit Node Addon

A native Node addon could call Launch Services directly. It would add ABI, Node-version, build, and packaging complexity unrelated to the capture feature. Rejected.

## Architecture

```text
Node discovery host
    |
    | starts and monitors
    v
AutoDemoCaptureSupervisor
    |
    | NSWorkspace.openApplication(...)
    v
Auto Demo Capture.app
    |
    | authenticated owner-only Unix socket
    v
bounded PNG capture response
```

The supervisor does not call ScreenCaptureKit. Its responsibilities are limited to validating a private launch request, launching exactly the sibling capture app as a fresh non-activating instance, returning bounded launch status, observing termination, and terminating the exact launched instance when its own session closes.

The capture app remains responsible for Core Graphics permission calls, ScreenCaptureKit capture, private bootstrap validation, socket authentication, request bounds, and PNG generation.

## Installed Bundle

The signed application contains:

- `Contents/MacOS/AutoDemoCaptureHelper`, the `CFBundleExecutable` launched by Launch Services;
- `Contents/MacOS/AutoDemoCaptureSupervisor`, the non-capturing process Node invokes;
- the existing Info.plist and source/signature metadata.

The supervisor derives the enclosing `.app` path from its own canonical installed executable path. It does not accept an arbitrary application URL or bundle identifier from Node. Setup verifies the complete app signature and both regular, non-symlinked executables before either is used.

## Permission And Protocol Probe Flow

1. TypeScript verifies source hash, bundle signature, helper protocol, and supervisor presence.
2. TypeScript creates an owner-only temporary probe directory and a `0600` launch-request file.
3. The launch request selects one bounded mode: version, permission preflight, or permission request. It includes an initially nonexistent response path in the same private directory and no credentials, session token, or capture data.
4. Node starts the supervisor with only the launch-request path.
5. The supervisor validates request ownership, mode, size, file type, and paths, then launches a fresh background capture-app instance through `NSWorkspace.OpenConfiguration` with activation disabled and running-application substitution disabled.
6. The capture app performs the selected operation, atomically writes one bounded JSON response, and exits.
7. The supervisor observes exit, validates that the response exists, and exits with a bounded status.
8. TypeScript validates the response, maps it to the existing public setup/preflight result, and removes the private directory.

The permission call always runs inside the Launch Services-created capture app. There is no fallback to the direct helper executable, supervisor, terminal, Codex, ChatGPT, or another model host.

## Capture Session Flow

1. Node creates the existing `0600` bootstrap containing the random session token, owner-only socket path, protocol version, and five-minute idle timeout.
2. Node writes a private supervisor launch request that selects service mode and refers to the bootstrap path. The token itself remains absent from process arguments.
3. Node starts the supervisor and monitors it as the owned child process.
4. The supervisor launches a fresh non-activating capture-app instance through `NSWorkspace` and retains its `NSRunningApplication`.
5. The capture app preflights Screen Recording, validates the bootstrap, binds the private socket, and serves same-user authenticated capture requests.
6. Node waits for the socket and performs capture through the existing bounded protocol.
7. If the capture app exits, the supervisor exits and Node treats the helper as unavailable.
8. On normal close, Node sends `SIGTERM` to the supervisor. The supervisor requests graceful termination of the exact captured `NSRunningApplication`, waits for a bounded interval, and uses `forceTerminate()` only if the instance remains alive.
9. After termination, Node removes the bootstrap, response, socket, and temporary directories it owns.
10. If the supervisor is itself force-killed, the capture app's five-minute idle timeout remains the final orphan-protection backstop without expiring during ordinary autonomous reasoning between native captures.

Every discovery session receives a new application instance, bootstrap, token, and socket. No browser, permission object, or helper state crosses discovery, review, replay, or recording boundaries.

## Security And Privacy Boundaries

- Only `Auto Demo Capture.app` requests and uses Screen Recording permission.
- The supervisor never captures screen content, opens network connections, or persists after its child exits.
- Launch and bootstrap files must be regular, non-symlinked, current-user-owned, private, absolute, and size-bounded.
- The app bundle path is derived from the installed supervisor, not caller input.
- Session tokens remain in private files and authenticated socket messages, never process arguments, conversation, logs, or tracked artifacts.
- The capture app continues to enforce peer UID, constant-time token comparison, region limits, timeouts, response-size limits, and exact PNG dimensions.
- Native UI capture never falls back to a misleading page-only image.
- The helper remains an `LSUIElement` agent app with no login-item or LaunchAgent persistence.

## Failure Handling

- Missing supervisor or capture executable returns `capture_helper_not_installed`.
- Invalid bundle structure or code signature returns `capture_helper_signature_invalid`.
- Incompatible launcher, helper, or response version returns `capture_helper_protocol_mismatch`.
- Missing permission returns `capture_helper_permission_required` before browser launch.
- Launch Services failure, early app exit, or missing service socket returns `capture_helper_unavailable`.
- A malformed, oversized, late, or mismatched probe response fails closed without opening a browser.
- Invalid private request or bootstrap ownership fails before launch.
- Capture timeouts, malformed responses, invalid dimensions, permission revocation, and helper crashes retain bounded capability errors and close the affected session.
- Normal shutdown first requests graceful termination. A bounded force-termination fallback targets only the exact launched application instance.
- If cleanup cannot be confirmed, the workflow reports a bounded cleanup failure and does not claim the session closed cleanly.

Arbitrary exception messages, local certificate names, signing fingerprints, Team IDs, process arguments, tokens, raw screen data, and private paths never enter public results.

### Acceptance-driven capture diagnostics

The first clean Cars.com acceptance attempts exposed intermittent native-window
capture failures while a native distance menu was open. The existing boundary
collapsed ScreenCaptureKit, display selection, transport, response validation,
and PNG normalization failures into one public capability code, leaving no
safe root-cause evidence.

Each discovery session therefore retains one owner-only
`native-capture-diagnostics.jsonl`. Records use stable lifecycle and failure
stage codes, a monotonic sequence, bounded elapsed time, the requested numeric
region, bounded system error domain/code, and output byte length. They never
contain screenshots, page content, URLs, target labels, tokens, socket or
bootstrap paths, signing data, or raw exception text. Browser geometry is read
again for every native capture so window movement cannot silently reuse stale
coordinates.

### Acceptance-driven discovery-host diagnostics

The reviewed five-minute-backstop acceptance proved that native capture was
healthy, then exposed a different opaque boundary: both the initial discovery
and its single clean retry reached the public search submission, displayed a
retained hard-block page, and returned only `discover_host_failed`. The failing
click never entered the durable trace, the public result contained no response
status or challenge classification, and the existing host logs were empty.

Each discovery session therefore also retains one owner-only
`discover-host-diagnostics.jsonl`. Its ordered, best-effort records contain a
monotonic sequence, bounded session-relative elapsed time, the resolved public
browser-profile projection, main-document response status, whether the response
origin is the starting origin or another origin, action type/index, stable
coordinate-session failure stage, bounded action outcome code/boundary, and
clean host shutdown. The recorder never stores raw URLs, hostnames, request or
response headers, bodies, page text or titles, target labels, coordinates,
runtime bindings, tokens, socket/bootstrap paths, screenshots, or raw exception
text. Diagnostic write or close failures cannot change the public result or mask
browser/helper cleanup.

This evidence is diagnostic only. It must not introduce a Cars.com selector,
Cloudflare workaround, provider-specific browser behavior, automatic retry, or
weakened policy. A later fresh acceptance may attribute a public hard block only
to the bounded response and stage evidence actually retained; the server's
private classification reason remains unknown unless the server exposes it.

## Testing Strategy

### TypeScript RED-GREEN Coverage

- Setup permission and version probes require the supervisor and fail if the inner capture executable is invoked directly.
- Runtime preflight uses the private probe contract and maps bounded results to the existing public errors.
- Session creation launches the supervisor with a private request path and keeps the token out of arguments.
- Client close, early child exit, socket timeout, malformed response, and cleanup behavior remain observable at the public boundary.
- Existing signature, source-hash, same-user socket, authentication, response-bound, and secret-hygiene tests remain green.
- Failed helper responses preserve bounded diagnostic stages in the private
  JSONL file, malformed responses identify response validation, invalid PNGs
  identify normalization, and capture continues to expose only the existing
  public capability error.
- Discovery-host diagnostics persist the resolved browser profile, bounded
  main-document status/origin relation, successful action outcomes, the exact
  stable action stage that throws, and clean shutdown without retaining raw
  navigation, page, request, response, input, target, token, or exception data.

### Swift RED-GREEN Coverage

Use a small injected application-launching boundary so unit tests cover:

- exact sibling-bundle derivation and rejection of arbitrary app paths;
- fresh, non-activating launch configuration and bounded arguments;
- version, permission-preflight, permission-request, and service modes;
- private request and response validation;
- success, launch error, early exit, missing response, malformed response, and timeout;
- graceful termination, bounded force-termination fallback, and supervisor interruption;
- continued capture-protocol validation, same-user enforcement, request bounds, and idle shutdown.

### CI Gate

Add a focused `macos-latest` job that builds the Swift package, runs all Swift unit tests, builds an ad-hoc test bundle, and validates its structure. It must not request Screen Recording or capture runner content. Existing Ubuntu static, docs, TypeScript unit, browser, and aggregate validation jobs remain required.

### Real Local macOS Gate

Before Cars.com acceptance:

1. Build and development-sign the complete app bundle.
2. Run setup through the supervisor and require `capture_helper_ready`.
3. Start a real service instance through Launch Services.
4. Capture one small known screen region.
5. Validate PNG signature and exact dimensions without committing or uploading the image.
6. Close the client and require both supervisor and capture app to exit.
7. Confirm bootstrap, response, socket, and temporary directories are removed.
8. Rerun setup and require permission preflight to remain ready.

If the stable development-signed rebuild causes macOS to require authorization again, setup fails closed and the user authorizes the same `Auto Demo Capture` identity once. The workflow does not silently switch identities or broaden permission.

## WES-273 Rollout

After the helper gate passes:

1. Run the complete relevant repository verification and independent review.
2. Create a new clean acceptance checkout at the reviewed branch head.
3. Dispatch a context-isolated Codex agent with the exact recorded headed-YOLO Cars.com prompt and normal committed repository instructions only.
4. Require discovery and semantic replay to reach a blocker-free `review_required` result.
5. Present the complete sanitized walkthrough to the user and obtain explicit approval.
6. Freshly establish YOLO for recording, create the capture and `./demos/cars-kia-sorento` project, and verify it through public commands.
7. Keep the editor closed and do not export an MP4.
8. Publish, merge, and run the WES-273 completion sync. WES-275 remains deferred and unstarted.

## Acceptance Criteria

- Screen Recording permission belongs to `com.autodemo.capture-helper`, not a model host or terminal.
- Setup and runtime never invoke the inner capture executable directly from Node.
- The supervisor launches a fresh background capture-app instance through Launch Services and owns its lifecycle.
- Permission, protocol, capture, and cleanup pass through the real local helper gate.
- Swift helper and supervisor code compile and pass unit tests in required macOS CI.
- No helper process, private file, or socket remains after verified normal shutdown.
- The subsequent fresh Codex Cars.com acceptance receives no hidden Cars.com guidance and stops for explicit approval before recording.
- WES-273 is not marked Done until helper verification, Cars.com discovery/replay, explicit approval, recording, handoff, PR integration, and completion synchronization all pass.

## Self-Review

- Placeholder scan: no deferred implementation choice or unfinished marker remains.
- Consistency: permission identity, launch ownership, child termination, and idle-timeout backstop agree across setup and session flows.
- Scope: the design corrects one WES-273 helper boundary and resumes the existing acceptance; it does not start WES-275 or add provider-specific behavior.
- Ambiguity: bundle derivation, fresh-instance launch, private result transport, shutdown escalation, CI limits, local capability proof, and acceptance sequencing are explicit.
