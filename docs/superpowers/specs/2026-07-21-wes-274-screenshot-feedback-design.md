# WES-274 Screenshot Feedback Design

Date: 2026-07-21
Issue: WES-274, "Add screenshot feedback to autonomous discovery"

## Outcome

Autonomous discovery will make each decision from the existing sanitized text observation and bounded visual feedback from the same browser state. Image bytes remain runtime-only: durable sessions, checkpoints, reviews, logs, and text prompts retain only validated relative artifact references and diagnostics.

This work follows the WES-273 acceptance evidence that exposed the visual gap, but it is published independently from WES-273's paused implementation commits. WES-273's acceptance run, approval, recording, handoff, and completion are not part of WES-274.

## Selected Approach

Extend the existing discovery screenshot artifact boundary into the autonomous runner rather than creating a sidecar service or embedding image data in observations.

The autonomous store gains a bounded visual-artifact write/load contract. The Playwright rehearsal extractor writes focus-preserving PNGs through that contract. Before each decision, the runner resolves the current observation's screenshot reference and gives the decision provider a runtime-only visual value containing either validated PNG bytes or an explicit bounded unavailability result. No base64, raw bytes, absolute paths, selectors, DOM, or browser-private values enter durable JSON or text serialization.

This is preferred because the observation model already has safe screenshot references, hashes, limits, and artifact sinks. A sidecar would duplicate lifecycle and safety machinery. Embedding bytes in the session or textual model prompt would violate the issue's data boundary.

## Visual Capture Contract

`DiscoveryObservationPage` will expose a focus-neutral visual-state preflight before `captureViewportPng()`:

- `available`: proceed with a focus-preserving PNG representing page-rendered viewport content.
- `unavailable`: a bounded public reason when the browser state includes native UI that a page screenshot cannot represent faithfully.

The Playwright adapter captures through `page.screenshot()` without clicking, focusing, moving the pointer, or activating another application. Its preflight detects an expanded native select using public page state. Because browser/OS popup pixels are outside the page-rendered screenshot, that state returns `visual_state_unavailable` instead of a misleading partial image. Capture failures keep the existing bounded screenshot diagnostic; internal exception details are discarded.

Page-rendered dropdowns, dialogs, popovers, menus, and other DOM content remain capturable. A deterministic headed fixture will prove that screenshot capture preserves focus and the open state of a page-rendered occluding control.

## Artifact Storage And Loading

The existing `AutonomousDiscoveryStore` will add two operations:

- write a PNG by validated discovery artifact ID and SHA-256, returning a safe relative path under `visuals/`;
- load a PNG only from a validated screenshot reference, enforcing safe relative paths, expected media type, byte limit, and optional SHA-256 match.

The file store uses atomic writes, as it already does for JSON artifacts. The in-memory test store keeps bytes outside session/checkpoint event values. Invalid paths, missing files, oversized data, wrong media types, or hash mismatches produce one public `visual_state_unavailable` result and never expose raw error or path details.

## Decision Boundary

`AutonomousDiscoveryDecisionProvider.decide()` gains a `visual` field:

- `{ status: "available", artifact, bytes }`, where `artifact` is the safe public reference and `bytes` is a bounded `Uint8Array` supplied through the dedicated runtime channel; or
- `{ status: "unavailable", code: "visual_state_unavailable", reason }`, with a bounded public reason.

The runner resolves visual feedback immediately before every decision: initial observation, successful post-action observation, recoverable failed-action observation, and no-effect observation. The value is not copied into the session, store checkpoint, review, replay artifact, or error text. A provider test will hold text constant while changing only image bytes and prove that the returned action changes.

If a controller returns a recoverable action failure with a fresh observation, the runner will request another decision using that observation and its visual feedback rather than terminating before repair. Hard failures without a trustworthy fresh observation remain fail closed.

## Security And Bounds

- Accept only `image/png` screenshot artifacts with safe relative paths and valid IDs.
- Limit loaded image bytes with a dedicated constant below the serialized-session limit; reject oversize images before the decision call.
- Verify SHA-256 when the reference supplies one.
- Never serialize image bytes or load failures into discovery/session/review/checkpoint JSON.
- Preserve existing risk-tier, redaction, browser-profile, review, approval, and fresh-recording authority contracts.
- Add no site-specific selector, Cars.com branch, editor behavior, or export behavior.

## Testing

Behavior-focused RED-GREEN cycles will cover:

1. file-store PNG write/load, safe-path/hash/media/size rejection, and JSON byte exclusion;
2. focus-preserving Playwright capture of an open page-rendered occluding control;
3. explicit `visual_state_unavailable` for expanded native UI rather than a page-only screenshot;
4. initial, post-action, recoverable failed-action, and no-effect decisions receiving visual feedback;
5. a decision changing from image content while the sanitized text observation stays identical;
6. existing discovery, replay, recording, approval, policy, typecheck, lint, formatting, build, and repository tests.

## Acceptance Boundary

WES-274 completes when its behavior, repository verification, independent review, exact-head CI, merge, and completion sync pass. Completion advances the project pointer back to WES-273 and records that WES-273 must be rerun from its exact headed YOLO prompt in a fresh session. WES-273 and WES-265 remain incomplete.
