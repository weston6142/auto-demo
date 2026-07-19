# @auto-demo/capture

Provides the browser capture boundary, Playwright viewport recording, interaction metadata, and
capture bundle lifecycle used by Auto Demo.

The controllable browser used by approved agent execution supports accessible click, type, native
select-by-public-label, navigation, visible-state assertions, and bounded control-state assertions.
Native option values and other form values are never returned; interaction metadata distinguishes a
native selection and retains only its bounded public option label plus redacted target metadata.

## Browser launch profiles

Browser capture accepts the shared sanitized launch profile: Chromium with a `bundled`, `chrome`,
or `msedge` channel, headless mode, and a viewport from 1x1 through 4096x4096. When final agent
execution supplies an approved discovery profile, capture launches that exact profile in a fresh
isolated browser and context. Its viewport must match the capture viewport; a mismatch fails before
browser launch. Legacy callers that omit a profile retain bundled headless Chromium using their
requested viewport, normally 1280x720.

Capture never accepts persistent browser state, cookies, storage state, authenticated state,
executable paths, or arbitrary launch arguments. It does not try discovery fallbacks. A recognized
Cloudflare or generic verification page returns `anti_bot_challenge` with only a bounded provider
and deterministic profile identifier, distinct from policy failures and without page or URL data.
