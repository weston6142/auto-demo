# WES-272 Unified Browser Launch Profiles Design

## Summary

WES-272 adds one bounded, sanitized browser launch-profile contract that discovery can resolve from a deterministic fallback list and that fresh replay and final capture can consume unchanged. The selected profile is configuration only: browser cookies, storage, pages, contexts, policy permits, and authenticated state are never reused between phases.

The profile becomes durable discovery and walkthrough-plan metadata so parity is enforced by the public workflow rather than depending on hidden operator knowledge. Browser challenge pages receive a dedicated `anti_bot_challenge` outcome with a bounded provider classification; policy violations retain their existing policy-specific outcomes.

## Scope

### In scope

- A shared versioned launch-profile contract for bundled Chromium, installed Chrome, or installed Edge; headful/headless mode; and viewport.
- Strict validation, normalization, deterministic identity, and bounded primary/fallback plans.
- A Playwright discovery launcher that creates a fresh browser/context/page for each attempt, resolves the first usable profile, and returns only sanitized attempt evidence.
- Durable selected-profile metadata in new discovery sessions and compiled walkthrough plans.
- Fresh replay driven by the plan's selected profile instead of hard-coded headless bundled Chromium.
- Final capture driven by the approved plan's selected profile instead of an independently chosen browser configuration.
- Bounded detection of Cloudflare and generic human-verification challenge pages after navigation.
- Behavior-focused coverage for parity, fallback, isolation, challenge outcomes, and compatibility.

### Out of scope

- Persistent browser profiles, `userDataDir`, storage-state import/export, cookie transfer, CDP attachment, authenticated-session reuse, proxies, proxy credentials, arbitrary executable paths, or arbitrary browser arguments.
- Automatically weakening the selected risk tier or converting an anti-bot challenge into policy authority.
- Semantic form controls (WES-271), structural target ranking (WES-267), the autonomous runner (WES-268), or Cars.com acceptance (WES-273).
- Firefox/WebKit capture, site-specific Cloudflare bypasses, CAPTCHA solving, stealth plugins, or browser fingerprint spoofing.

## Approaches Considered

### 1. Shared versioned contract with durable artifact parity (selected)

Create a small `@auto-demo/browser-profile` workspace package with no dependency on agent, capture, or CLI packages. Discovery, replay, capture, and CLI depend on it. New discovery sessions record the resolved profile, compilation copies it into the walkthrough plan, replay consumes it, and approved execution passes it to capture.

This makes cross-phase parity observable and testable while preserving fresh contexts. It also gives fallback and diagnostics one owner without making capture depend on agent or agent depend on capture.

### 2. Capture-owned profile with caller injection

The capture package could publish the type and the agent package could accept it. This creates an undesirable domain dependency from discovery to capture and still leaves durable plan parity optional. It is rejected.

### 3. Host-only browser flags

The Codex workflow could ask the host to repeat browser flags for each phase. This is small but preserves the current hidden-context failure mode, cannot prove parity in artifacts, and makes fallback selection nondeterministic across phases. It is rejected.

## Shared Profile Contract

`@auto-demo/browser-profile` publishes:

```ts
type BrowserLaunchProfileV1 = {
  schemaVersion: 1;
  browser: "chromium";
  channel: "bundled" | "chrome" | "msedge";
  headless: boolean;
  viewport: { width: number; height: number };
};

type BrowserLaunchProfilePlanV1 = {
  schemaVersion: 1;
  primary: BrowserLaunchProfileV1;
  fallbacks?: BrowserLaunchProfileV1[];
};
```

The MVP intentionally supports only Chromium-family browsers because the current discovery, replay policy guard, execution controller, and video capture are Chromium-based. `bundled` maps to Playwright's bundled Chromium without a channel override; `chrome` and `msedge` map to Playwright's public channel names. Viewport dimensions are positive bounded integers. Unknown fields, duplicate profiles, more than two fallbacks, unsupported browsers/channels, and invalid dimensions fail closed before browser activity.

Normalization returns fresh immutable values and a deterministic non-secret `profileId` derived only from the normalized public fields. Evidence may include `profileId`, attempt ordinal, browser, channel, headless mode, viewport, outcome code, and challenge provider. It never includes paths, raw launch errors, page text, HTML, headers, cookies, URLs with query/fragment data, or browser state.

The package also exports a legacy-compatible default: bundled Chromium, headless, 1280x720. Existing artifacts without explicit profile metadata retain this behavior; every newly launched discovery flow should declare and persist a profile.

## Discovery Launch And Fallback

Add a focused Playwright discovery launcher in `@auto-demo/agent`. It accepts a target URL and a validated profile plan, then tries the primary and fallbacks in declaration order. Each attempt launches a new browser and new context, navigates once, and runs bounded challenge detection. Failed launch, navigation, and challenge attempts are closed before the next profile is tried.

The launcher returns either:

- a live isolated page handle plus the exact resolved profile and bounded prior-attempt evidence; or
- a stable setup failure with bounded evidence for every attempted profile.

The caller supplies the successful page to the existing policy-enforced rehearsal controller, creates the discovery session with the returned resolved profile, and owns cleanup through the launch handle. Fallback is limited to discovery profile resolution. Replay and capture do not silently select a different profile: they use the resolved profile exactly. If the same profile later encounters a challenge, that phase fails distinctly and the host may start a new discovery cycle with the next declared profile. This prevents replay or capture from validating a different browser environment than discovery.

## Durable Artifact Parity

`DiscoverySessionV1` gains optional validated `launchProfile` metadata. It is optional only for compatibility with existing version-1 fixtures and historical artifacts. New sessions created from the Playwright launcher include it.

The discovery compiler copies the profile unchanged into an optional `launchProfile` field on `WalkthroughPlan`. Existing validation and sanitization treat it as execution-relevant public metadata. Because the approval fingerprint covers execution-relevant plan content, changing the profile after review invalidates approval.

Replay preflight passes the canonical compiled plan profile to every fresh browser attempt. A supplied plan whose profile differs from the canonical compilation fails the existing plan/source mismatch boundary before launch. Custom replay factories receive the profile in their factory input; the production Playwright factory validates and uses it. Legacy plans without a profile use the exported default.

Approved execution passes the approved plan profile through `startCapture()`. The CLI and capture adapter do not accept an independent profile override for agent execution, so recording cannot drift from the approved artifact. The existing standalone `capture` command remains viewport-based and legacy-compatible because it is not a discovery-to-recording handoff.

## Capture Integration

`BrowserCaptureOptions` gains an optional launch profile. The default adapter validates it and requires its viewport to equal the capture viewport. The Playwright driver receives the normalized profile and launches bundled Chromium or the declared installed channel with the declared headless value. The context remains newly created and video recording remains sized to the declared viewport.

Agent execution derives both profile and viewport from the approved plan when profile metadata exists. For legacy plans, it retains the current CLI viewport/default behavior. This preserves old scripts while making new discovery-derived plans self-contained and parity-safe.

## Anti-Bot Challenge Classification

The shared package exposes a pure bounded classifier over an in-memory page summary: sanitized title plus a capped visible-text prefix collected after DOM readiness. It recognizes a narrow set of stable Cloudflare markers and generic human-verification markers. It returns only:

- `provider: "cloudflare"` for known Cloudflare challenge combinations;
- `provider: "generic"` for a bounded human-verification combination; or
- no challenge.

One weak string is insufficient; tests require marker combinations to limit false positives. Raw page content is discarded immediately.

Discovery setup, replay setup, and capture setup map a detected challenge to `anti_bot_challenge`. Replay adds this as a hard-boundary failure separate from `policy_blocked`; the repair provider is not invoked. Capture returns the stable setup code and closes its fresh resources. A request blocked by the policy guard remains `policy_blocked` or `network_request_blocked` and is never relabeled as an anti-bot challenge.

## Freshness And Authority Boundaries

The resolved profile may cross phases because it contains only bounded public configuration. These may not cross phases:

- browser or context objects;
- pages, cookies, local/session storage, cache, service workers, storage-state files, or downloads;
- discovery permits, policy guards, disposable acknowledgements as runtime authority, or YOLO runtime state;
- raw launch errors or challenge-page content.

Discovery cleanup closes its own browser. Every replay attempt launches and closes another browser. Final capture launches another browser after approval. The selected risk tier is still freshly established according to WES-270/WES-266; the profile does not convey policy authority.

## Error Handling

- Invalid profile or fallback plans fail before browser activity with `invalid_browser_launch_profile`.
- Missing installed channels and launch failures return `browser_launch_failed` with only sanitized profile/ordinal evidence.
- Navigation failures return `browser_navigation_failed`.
- Recognized challenge pages return `anti_bot_challenge` and the bounded provider.
- Exhausted discovery fallbacks return `browser_profile_fallback_exhausted` with at most three evidence entries.
- Replay preserves `policy_blocked` for policy enforcement and uses `anti_bot_challenge` only after a page successfully loads enough to classify.
- All cleanup remains idempotent and original stable failures are preserved if cleanup itself fails.

## Testing

Tests assert public behavior rather than helper internals:

- Shared-contract tests accept the supported normalized profiles and reject unknown fields, invalid bounds, duplicates, and excessive fallback lists.
- Discovery launcher tests use injected browser boundaries to prove ordered fallback, full cleanup between attempts, exact resolved-profile return, sanitized bounded evidence, and no fallback after success.
- Local Playwright fixtures prove a normal page is accepted, Cloudflare/generic challenge fixtures return `anti_bot_challenge`, and ordinary pages containing one weak marker do not false-positive.
- Session/compiler/approval tests prove the resolved profile survives compilation and that profile mutation invalidates source equivalence or approval.
- Replay tests prove the hard-coded headless launch is removed, the plan's channel/headless/viewport reaches each fresh attempt, challenge failures are distinct from policy failures, and legacy defaults remain compatible.
- Capture and agent-execution tests prove the approved profile reaches a fresh recording browser, viewport mismatch fails closed, installed-channel launch options are forwarded, and no browser/context is reused.
- Existing risk-tier, replay, execution, capture, and repository suites remain green.

## Documentation

Update the repository root, agent README, capture README, CLI help/docs, and repository-owned Codex skill to describe:

- the supported launch-profile fields and bounded fallback behavior;
- that discovery resolves the profile while replay and recording use the same resolved profile;
- that every phase still uses a fresh isolated browser context and freshly established risk tier;
- the difference between `anti_bot_challenge` and policy violations;
- unsupported authenticated-state reuse, arbitrary launch arguments, and CAPTCHA bypass behavior.

## Acceptance Criteria

WES-272 is complete when:

1. New discovery flows can declare a bounded profile/fallback plan and receive one resolved sanitized profile.
2. The resolved profile is durable in discovery/plan artifacts and is used unchanged by fresh replay and final capture.
3. Replay no longer hardcodes headless bundled Chromium when an explicit profile exists.
4. Discovery, replay, and capture never reuse browser state or runtime policy authority.
5. Cloudflare/generic challenge pages produce a bounded `anti_bot_challenge` outcome distinct from policy violations.
6. Fallback is deterministic, capped at three profiles, and cannot silently make replay or capture differ from discovery.
7. Existing artifacts and standalone capture remain compatible through the documented default profile.
8. Focused behavior tests and the full relevant repository validation pass.
