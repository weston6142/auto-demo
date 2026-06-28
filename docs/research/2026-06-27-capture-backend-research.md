# Capture Backend Research For WES-135

Date: 2026-06-27

## Question

For the first real Auto Demo capture runtime, should WES-135 start with browser-driven capture or OS screen/window capture?

## Recommendation

Start WES-135 with a browser-first Playwright capture adapter that records viewport media and writes structured interaction metadata in parallel.

Do not start WES-135 with OS/window capture. Native capture should remain an adapter target, but it should not be the first implementation path because it adds platform permissions, native media APIs, cursor polling, audio capture, and CI difficulty before the product loop is proven.

## Why

Auto Demo's MVP is agent-first and browser-first. The fastest credible path is to let the CLI launch or control a browser, record the viewport, and capture semantic interaction events directly from the browser automation layer.

The durable product contract should be the capture bundle and event timeline, not the first video backend. Playwright video is an acceptable first media source if it sits behind a capture adapter and can later be replaced or supplemented by CDP screencast, a Chrome extension, or native capture.

## Open-Source Findings

### Cap

Cap is the closest open-source Screen Studio-style reference. It is a serious native recorder/editor architecture:

- Rust/Tauri desktop application.
- ScreenCaptureKit-based capture on macOS.
- FFmpeg/media encoding crates.
- Screen/window/area target abstractions.
- Separate cursor and keyboard event capture.
- Rendering/editor code consumes cursor and keyboard metadata as first-class timeline data.

The key lesson is that polished interaction metadata is not inferred from recorded pixels. Cap records it in parallel. Its project model has cursor move and click events with timestamps, normalized coordinates, cursor IDs, and active modifiers. Its recording code polls cursor position, mouse buttons, and keyboard state, writes cursor images, and flushes cursor/keyboard files incrementally.

Primary source links:

- Cap cursor event model: https://github.com/CapSoftware/Cap/blob/a9f7d7ffc5fc59f34a3bc0f002b0661af3f9a351/crates/project/src/cursor.rs
- Cap keyboard event model: https://github.com/CapSoftware/Cap/blob/a9f7d7ffc5fc59f34a3bc0f002b0661af3f9a351/crates/project/src/keyboard.rs
- Cap cursor/keyboard recorder: https://github.com/CapSoftware/Cap/blob/a9f7d7ffc5fc59f34a3bc0f002b0661af3f9a351/crates/recording/src/cursor.rs
- Cap ScreenCaptureKit config: https://github.com/CapSoftware/Cap/blob/a9f7d7ffc5fc59f34a3bc0f002b0661af3f9a351/crates/scap-screencapturekit/src/config.rs

Implication for Auto Demo: keep interaction metadata separate from video and make it a first-class output. Do not assume a video file alone can support automatic zooms, click emphasis, keyboard overlays, or agent step reconstruction.

### Screenity

Screenity is a browser-extension recorder. Its code shows that browser capture is still non-trivial:

- Chrome extension permissions include `tabCapture`, `tabs`, `scripting`, and optional `desktopCapture`.
- Screen/window capture routes through `getDisplayMedia` or `desktopCapture` depending on host and platform needs.
- Tab capture routes through `chrome.tabCapture`.
- Recording uses MediaRecorder/WebCodecs paths with fallbacks, stream warmup, audio mixing, retry logic, and watchdogs.

Primary source links:

- Screenity manifest permissions: https://github.com/alyssaxuu/screenity/blob/19a1fc808df5791707edd262d8126e80865e8721/src/manifest.json
- Screenity recorder routing: https://github.com/alyssaxuu/screenity/blob/19a1fc808df5791707edd262d8126e80865e8721/src/pages/Recorder/Recorder.jsx
- Screenity screen capture mode decision: https://github.com/alyssaxuu/screenity/blob/19a1fc808df5791707edd262d8126e80865e8721/src/pages/utils/screenCaptureMode.js

Implication for Auto Demo: Chrome extension capture is useful later, especially for user-visible tab/screen capture and extension distribution. It is not the simplest first CLI path because extension capture introduces permission and UI flows that do not fit non-interactive agent capture cleanly.

### Web And Browser APIs

`getDisplayMedia()` is designed around user permission and browser UI. It is appropriate for browser apps and extensions, but it is not a clean non-interactive CLI primitive.

Playwright can record browser context videos and is already aligned with agent-driven browser control. It gives Auto Demo an initial media source without OS screen permissions.

Primary source links:

- MDN `getDisplayMedia`: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia
- Chrome `tabCapture`: https://developer.chrome.com/docs/extensions/reference/api/tabCapture
- Chrome `desktopCapture`: https://developer.chrome.com/docs/extensions/reference/api/desktopCapture
- Playwright video recording: https://playwright.dev/docs/videos

## Options Compared

### Playwright-Controlled Browser Capture

Pros:

- Best fit for agent-driven browser demos.
- Avoids OS screen recording permissions for the first implementation.
- Easier to run locally and test in CI.
- Can capture structured browser semantics directly: clicks, typing, navigation, URL changes, viewport, console/page errors, and agent step markers.
- Cross-platform sooner than native capture.
- Keeps the CLI non-interactive.

Cons:

- Captures browser viewport, not arbitrary desktop apps.
- Does not include browser chrome, system dialogs, or native menus.
- Playwright's video output should be treated as a first backend, not the permanent rendering foundation.
- Some browser-only surfaces may still need CDP or page instrumentation for high-quality event detail.

### Chrome Extension Capture

Pros:

- Strong fit for browser users and tab/screen capture.
- Can use `tabCapture`, `desktopCapture`, `getDisplayMedia`, MediaRecorder, and WebCodecs.
- Can capture user-visible browser workflows beyond a Playwright-owned page.

Cons:

- Adds extension packaging and permission flows.
- Screen/window capture often requires user picker UI.
- Harder to keep non-interactive for agents.
- More moving parts than needed for WES-135.

### Native OS Screen/Window Capture

Pros:

- Captures what the user sees, including browser chrome, system dialogs, native menus, and non-browser apps.
- Best long-term direction for Screen Studio-style general recording.
- Proven by Cap and OBS-style native recorder architectures.

Cons:

- Platform-specific capture stacks and permissions.
- Requires separate cursor/keyboard capture for useful metadata.
- More difficult to test in CI.
- More engineering before the core Auto Demo loop is proven.
- Less semantic information about browser navigation and app state unless paired with browser instrumentation.

## WES-135 Scope Implication

WES-135 should build the first capture runtime slice, not the full recorder/editor product:

- Add a concrete `browser` capture adapter.
- Add a CLI path for starting and stopping a browser-first capture.
- Record viewport media for the walkthrough.
- Record structured interaction metadata in parallel.
- Preserve partial artifacts on failure when possible.
- Write a capture bundle that the later project-format milestone can formalize.

Out of scope for WES-135:

- Native macOS/Windows/Linux screen capture.
- Chrome extension packaging.
- Full Auto Demo project schema.
- Auto polish decisions.
- Rendering polished variants.
- Browser editor UI.
- Export packaging.
