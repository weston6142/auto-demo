# Screenshot-Coordinate CLI Discovery Design

**Date:** 2026-07-21
**Status:** Approved, including on-demand macOS capture-helper revision
**Issue context:** WES-273 final Cars.com acceptance

## Goal

Replace the slow host-authored autonomous discovery loop with a stable, model-neutral CLI workflow. A vision-capable agent reads browser screenshots, chooses screen-coordinate actions, and uses Auto Demo to execute those actions with deterministic natural mouse and keyboard behavior. Auto Demo privately maps the resulting trace to durable semantic targets, then keeps the existing compile, replay, review, approval, recording, and handoff contracts.

The first implementation is accepted with Codex. Claude must remain compatible with the public protocol, but a fresh Claude acceptance run is deferred and must be tracked in Linear as follow-up work.

## Product Decisions

- The public integration is a CLI, not MCP and not a provider SDK.
- Auto Demo never invokes a model API. The operator may use Codex, Claude, or another agent through that agent's existing product access.
- The agent-facing discovery surface is screenshot-first. The agent does not choose DOM targets.
- Raw coordinates are valid only during first-pass discovery. They never become replay authority.
- Auto Demo silently captures semantic and structural evidence beneath coordinate actions so the existing replay pipeline can use durable targets.
- Natural, visible, deterministic pointer movement is required during discovery, replay, and final recording.
- The final recording must use physical pointer, wheel, and keyboard events rather than DOM shortcuts such as programmatic clicking or direct native-select mutation.
- Native browser UI on macOS is captured by one Auto Demo-owned helper with a stable local signing identity. Model hosts do not need individual Screen Recording permission.
- The helper runs only for an active Auto Demo session and has no network access or login-item persistence.
- Bot challenges, CAPTCHAs, browser security warnings, and policy boundaries are stop conditions. Natural pointer movement is interaction fidelity, not authority to bypass site protections.

## Architecture

### Discovery CLI

The CLI exposes these lifecycle commands:

```text
autodemo discover start
autodemo discover observe
autodemo discover act
autodemo discover status
autodemo discover finish
autodemo discover abandon
```

Commands return bounded JSON. Screenshots are local PNG artifacts referenced by safe paths. The agent reads those files with its own image capability and submits actions through a JSON file. No provider-specific response schema crosses this boundary.

### Persistent Session Host

`discover start` launches a fresh headed browser and creates a persistent local session. The session owns:

- the browser, context, and active page;
- the chosen discovery risk policy;
- viewport dimensions and device scale factor;
- current pointer coordinates;
- the active coordinate frame;
- accepted actions and private semantic evidence;
- screenshot artifacts and sanitized diagnostics.

Later CLI calls attach to the session rather than rebuilding a host or launching another agent. Accepted state is persisted after every action so `discover status` can recover after the calling agent or shell exits.

### Visual Capture Adapter

Each observation contains:

- a stable frame ID;
- an exact-width, exact-height PNG;
- viewport dimensions in screenshot pixels;
- device scale factor `1`;
- the current pointer coordinate;
- bounded public page metadata such as title and current origin.

The agent-visible PNG includes a cursor overlay at the persisted pointer position. The overlay is not rendered into the actual browser or final recording. An optional diagnostic grid may be requested, but it is off by default.

Ordinary page state may use a page-surface capture. Expanded native browser UI requires a browser-window capture that includes the popup. On macOS, the capture request crosses the private helper boundary described below. If the platform cannot capture required native UI, the CLI returns a bounded setup or capability error rather than presenting a misleading page-only image.

### On-Demand macOS Capture Helper

The public repository contains source and generic setup logic for `Auto Demo Capture.app`. A one-time command installs the built helper under `~/Applications`:

```bash
autodemo setup capture-helper --json
```

The setup command discovers eligible local Apple Development signing identities. It automatically uses the identity only when exactly one is eligible. With zero or multiple eligible identities, JSON mode returns `signing_identity_required` plus bounded local choices and executes no build; the operator reruns with `--signing-identity <SHA-1 fingerprint>` or explicitly chooses `--ad-hoc`. It never automatically uses a third-party Developer ID identity. The chosen certificate and private key remain in the macOS Keychain; their name, key material, provisioning data, and the built app never enter tracked repository files. The explicit ad-hoc mode warns that macOS may require Screen Recording approval again after rebuilding.

The signed app uses the stable bundle identifier `com.autodemo.capture-helper` and is an agent-only background application. Setup launches the installed helper itself to request or preflight Screen Recording permission, ensuring macOS grants access to the helper rather than the calling model host. `discover start` preflights its installation, code signature, protocol version, and Screen Recording capability before opening the target site. When native UI capture may be needed, the session host launches the installed app with a path to a private `0600` bootstrap file inside the discovery directory. The bootstrap contains a random session token and the path of a private Unix socket in a short owner-only temporary directory, avoiding the macOS Unix-socket path limit while keeping the bootstrap tied to the discovery session. Secrets are not passed on the process command line.

The helper accepts connections only from the current local user, authenticates the session token, validates the protocol-v1 request and a viewport rectangle no larger than 8192 by 8192 pixels, captures that region with ScreenCaptureKit, and returns an exact-size PNG no larger than 32 MiB over the Unix socket. Each request has a five-second timeout. The helper has no network entitlement or network client, never writes browser content itself, and serves only the session that launched it. It quits when the session closes, the client disconnects, or 30 seconds pass without a request. It is not installed as a login item or persistent LaunchAgent.

The TypeScript capture adapter validates the returned PNG dimensions before adding any diagnostic cursor or grid overlay. A helper response never supplies semantic targets, raw DOM data, or provider-specific fields, so Codex, Claude, and other screenshot-capable agents continue to consume the same PNG-plus-JSON CLI protocol.

### Natural Input Driver

The agent supplies destinations, not movement paths. The driver creates a deterministic trajectory from the persisted pointer coordinate to the destination using:

- distance-aware duration;
- a curved path;
- eased acceleration and deceleration;
- intermediate pointer events;
- a short hover-settling interval;
- a physical mouse click, double-click, wheel event, or keyboard event.

The same driver is used for discovery, replay, and recording. Equal inputs produce equal paths and timing; random jitter is not used.

### Coordinate Frames And Action Batches

`discover act` accepts a bounded ordered action array associated with one frame ID. Supported actions are:

- `move`;
- `click`;
- `double-click`;
- `scroll` with a destination coordinate and wheel delta;
- `keypress`;
- `type` through runtime-only input handling;
- `wait`.

A static page may execute multiple actions from one cached screenshot. Before each action, Auto Demo verifies that the coordinate frame remains valid. Navigation, page scrolling, viewport changes, popup opening, or meaningful layout movement ends the batch before the next action and returns a fresh screenshot with a new frame ID. This is an expected observation boundary, not a discovery failure.

Invalid or stale frame IDs execute nothing. Out-of-bounds coordinates fail instead of being clamped.

### Dropdown Behavior

Scrolling is location-aware. The driver naturally moves the pointer to the requested coordinate before sending wheel events, allowing a custom dropdown, scrollable panel, or the page itself to receive the scroll according to normal browser behavior.

Opening a dropdown invalidates the prior frame and returns a fresh screenshot. The agent may then:

- scroll within the open menu;
- click a visible option;
- use Arrow, Page Up/Down, Home/End, Enter, or Escape;
- click outside to cancel.

For a native `<select>`, Auto Demo records public form state before and after the physical interaction. The private mapper converts the observed change into the exact public option label for deterministic replay. Replay and final recording pointer-focus the control and select through real keyboard input; they do not call a programmatic option-selection shortcut.

### Private Trace Mapper

Before and after coordinate actions, Auto Demo privately records the bounded evidence required by the existing discovery contract:

- the live element beneath the destination coordinate;
- accessible role, public label, and occurrence;
- repeated-result structural position and promotion exclusion;
- public form state and selected-option changes;
- navigation and visible-state effects;
- current document and layout identity;
- screenshots and pointer state.

Runtime input values remain transient and must not enter the durable session, plan, review, execution, or handoff artifacts.

The agent never receives the private DOM-derived target inventory during normal screenshot discovery. This removes the current model round trip over a large sanitized observation while retaining evidence for compilation.

### Finish, Replay, And Review

`discover finish` asks the session host to finalize the accepted coordinate trace. It converts the private evidence into the current sanitized discovery session and passes that session through the existing compiler.

Every selected coordinate action must map to replayable semantic or structural intent. If a required action cannot be mapped, finish refuses to create a coordinate-only plan and reports the bounded action index that needs a different path or manual review.

Successful compilation enters the existing fresh-browser semantic replay and bounded repair flow. Replay uses durable targets plus the natural input driver. It does not repeat coordinate discovery unless the existing repair contract explicitly starts a new discovery session. A passing replay produces the existing sanitized review and pauses for explicit approval before recording.

## CLI Contract Sketch

Start:

```bash
autodemo discover start \
  --url https://www.cars.com/ \
  --goal "Search nationwide for new Kia Sorento vehicles and open the first organic listing" \
  --risk yolo \
  --json
```

Representative start or observation result:

```json
{
  "ok": true,
  "sessionId": "discovery-123",
  "frame": {
    "id": "frame-1",
    "screenshotPath": "workflow/discovery-123/frames/frame-1.png",
    "width": 1280,
    "height": 720,
    "deviceScaleFactor": 1,
    "pointer": { "x": 64, "y": 64 }
  }
}
```

Act:

```bash
autodemo discover act \
  --session discovery-123 \
  --actions-file workflow/discovery-123/next-actions.json \
  --json
```

Representative action file:

```json
{
  "frameId": "frame-1",
  "actions": [
    { "type": "click", "x": 420, "y": 245 },
    { "type": "keypress", "keys": ["N", "ENTER"] },
    { "type": "click", "x": 420, "y": 310 },
    { "type": "keypress", "keys": ["K", "I", "A", "ENTER"] }
  ]
}
```

Finish:

```bash
autodemo discover finish --session discovery-123 --json
```

## Failures And Recovery

- Missing helper installation, invalid signature, protocol mismatch, or missing Screen Recording permission fails during `discover start` with the exact setup command required to recover. The browser is not opened first.
- A rejected frame or action has no browser side effect.
- If an action in a batch fails, later actions are skipped and the result identifies the zero-based failed action index with a bounded public reason.
- A state-changing observation boundary returns the newest screenshot and next frame ID.
- Helper authentication failures, invalid rectangles, timeouts, crashes, permission revocation, and malformed or incorrectly sized images return bounded capability errors and close the affected session safely.
- Native browser UI never falls back to a misleading page-only image.
- Prohibited actions and policy boundaries stop the session without attempting a workaround.
- Bot challenges and CAPTCHAs are surfaced and not circumvented.
- Sessions are reconnectable through `status` and explicitly terminated through `finish` or `abandon`.
- Abandoned sessions close owned browser resources while retaining sanitized diagnostics.
- Failed semantic mapping blocks compilation rather than weakening replay to raw coordinates.
- Replay failures use the existing bounded repair contract.

## Testing

### Automated Behavior Coverage

Tests verify:

- capture-helper protocol authentication, same-user enforcement, rectangle and image limits, timeouts, and sanitized errors;
- setup behavior for local signing selection, explicit ad-hoc fallback, stable installation, signature validation, permission preflight, and source-version changes;
- absence of certificate names, key material, session tokens, sockets, and built app artifacts from tracked output;
- deterministic natural trajectories, intermediate pointer events, easing, settling, and physical clicks;
- location-aware wheel events that scroll the control beneath the pointer;
- multi-action execution against one unchanged coordinate frame;
- early batch termination on navigation, scrolling, popup opening, viewport changes, and layout movement;
- no side effects for stale frames, invalid action files, or out-of-bounds coordinates;
- native-popup frames flowing through a fake helper in CI without Screen Recording permission;
- a local-only real-helper capability check covering signature, permission, socket handshake, and exact-size PNG capture;
- native-select changes becoming exact public option labels;
- runtime input values staying out of durable artifacts;
- coordinate actions mapping to accessible and structural replay targets;
- unmappable required actions blocking compilation;
- replay and recording using the same natural input driver;
- session recovery and owned-browser cleanup.

Tests assert public behavior and artifacts rather than private implementation mechanics.

### Codex Acceptance

One fresh Codex session receives only the recorded Cars.com prompt and published CLI instructions. It must:

- start headed YOLO discovery;
- use screenshots and coordinate actions without a host-authored runner script;
- select New, Kia, Sorento, and Nationwide or All miles;
- open the first organic listing in normal results order;
- use natural pointer movement throughout discovery;
- compile and pass a fresh semantic replay using natural input;
- present the sanitized review for explicit approval;
- receive no hidden Cars.com guidance.

Timing evidence records total duration, model turns, screenshots, action batches, and recovery events for comparison with the current runner. The implementation does not promise a fixed performance threshold until the first measured baseline exists.

### Deferred Claude Acceptance

Claude must be able to consume the same PNG and JSON CLI protocol without an Auto Demo provider adapter. A fresh Claude acceptance run is deferred from this implementation and must be captured as Linear follow-up work. No Codex-specific fields, commands, or durable artifacts may be introduced while Claude acceptance is deferred.

## Out Of Scope

- Calling OpenAI, Anthropic, or another model API from Auto Demo.
- MCP transport.
- Provider-specific computer-use action schemas.
- A permanent capture daemon, login item, or LaunchAgent.
- Committing or distributing a locally signed helper app, certificate, private key, provisioning material, or signing-identity configuration.
- Automatic use of an organization-owned Developer ID certificate.
- Raw-coordinate replay or recording.
- Randomized stealth behavior or bypassing bot protections.
- Editor launch or MP4 export as part of discovery.
- Claude acceptance in the first delivery.
