# WES-267 Target Ranking And Structural Positional Intent Design

## Context

Auto Demo currently collects semantic targets before fallback targets and then keeps the first 100 sanitized candidates. Layout visibility does not distinguish controls inside the viewport from off-screen controls, late form controls can lose to unrelated earlier content, and a large semantic-target set can exclude every custom or clickable-looking fallback control. Compiled plans identify repeated targets with an accessible label plus a global occurrence, so a fresh replay can pin to a stale vehicle name or the wrong repeated card instead of preserving intent such as “the first non-promoted vehicle listing in the normal results region.”

WES-267 improves bounded target discovery and adds a portable structural target hint across compilation, fresh replay, bounded repair, approval, and final recording. It preserves the existing sanitized evidence, risk-tier, browser-profile, fresh-context, review, and approval boundaries.

## Approaches Considered

### 1. Bounded ranking plus portable structural target hints (selected)

Rank observed targets using public layout facts, reserve space for fallback/custom controls, and attach bounded landmark/list context when the page exposes a durable repeated-item structure. Compile that context into the walkthrough target hint and resolve it independently in replay and recording.

This addresses both discovery starvation and stale-label replay while keeping the contract browser-independent and reviewable. It requires coordinated changes to observation, plan validation, replay, and capture, but each layer retains a clear responsibility.

### 2. Ranking improvements only

Reorder the current target list and reserve fallback capacity without changing compiled plans. This would help an agent see relevant controls but would still persist a global label occurrence. It cannot express first eligible results-order intent and does not satisfy the replay and repair requirement.

### 3. Persist selectors or DOM paths

Store a CSS selector, XPath, or internal DOM ancestry for the selected element. This is exact for one snapshot but brittle across fresh sessions, implementation-coupled, and likely to leak private page structure. It conflicts with the repository's sanitized public-evidence boundary.

## Bounded Observation And Ranking

The browser snapshot collector derives only these additional public facts for an interactive candidate:

- whether its rectangle intersects the current viewport;
- whether it is inside a native form or an explicitly labelled form/region/landmark;
- the nearest bounded accessible region or form identity, when available;
- the nearest semantic repeated-item context formed by a list, feed, article collection, or list-item ancestry;
- whether that repeated item contains an explicit public promotion marker such as `Sponsored`, `Promoted`, `Ad`, or `Advertisement`.

The collector never returns selectors, raw DOM, attributes unrelated to accessible identity, URLs, hidden text, form values, or arbitrary ancestor content. Context labels pass through the existing public-text sanitizer and limits. Ancestor inspection and retained candidates are bounded.

Candidates are ordered by observable usefulness: viewport-intersecting form-local controls, other viewport-intersecting controls, off-screen form-local controls, then remaining controls. Semantic confidence breaks equal-priority ties before document order. The final 100-target observation guarantees capacity for the best 20 fallback/custom targets when they exist, while additional fallback targets may survive when they outrank weaker semantic candidates; unused reserve returns to the best remaining candidates. This prevents semantic volume from starving fallback controls without lowering the total bound or allowing weak targets to outrank relevant viewport/form controls indiscriminately.

The existing truncation diagnostic continues to report the full omitted count. A fallback diagnostic continues to report fallback targets that actually survived selection.

## Structural Target Contract

`DiscoveryInteractiveTarget` gains optional sanitized structural context. A target may identify:

- a containing accessible form or landmark;
- a repeated-item container and item role;
- its one-based position among eligible items in that container; and
- an explicit `exclude-marked-promoted` rule when the selected item was not marked promoted.

Absence of a promotion marker is represented as “not explicitly marked,” not as a claim that inventory is organic. A target that is itself explicitly marked promoted does not receive the exclusion rule.

`WalkthroughPlanTargetHint` keeps the existing accessible label and role for review, diagnostics, and backward compatibility, and gains the optional structural constraint. When present, the constraint is authoritative for runtime resolution: find the bounded accessible container, enumerate visible repeated items in document order, remove items with explicit promotion markers when requested, select the recorded one-based eligible position, and then resolve the action target by role within that item. The old accessible label is descriptive and must not pin resolution to a stale vehicle name.

Structural target data participates in selected-path and approval fingerprints. Existing plans without structural context retain their current label, role, and occurrence behavior byte-for-byte.

## Replay, Repair, And Recording

Fresh Playwright replay and final capture implement the same structural resolver. They do not silently fall back to label-only matching when a structural constraint exists. Missing containers, insufficient eligible items, or multiple action targets within the selected item fail with the existing bounded `target_not_found` or `ambiguous_target` outcomes.

Repair sessions may replace stale labels and rediscover the route, but they must preserve every ordered structural constraint from the plan being repaired. A repair that removes or changes the container, eligible position, role, or promotion exclusion fails as `repair_structural_intent_mismatch`. This prevents a repair from converting “first non-promoted result” into a named stale vehicle or a sponsored card while still allowing fresh evidence to update descriptive labels.

Approval freshness covers the complete structural hint, so any structural refinement invalidates prior approval. Review output remains sanitized and contains only the public accessible context, position, role, and promotion-exclusion rule.

## Error Handling And Compatibility

- Unsupported, empty, unsafe, oversized, or internally contradictory structural metadata is rejected during discovery-session and walkthrough-plan validation.
- Structural positions are positive bounded integers and cannot exceed the observation target limit.
- Promotion exclusion is based only on an explicit bounded public marker; the system does not infer advertiser identity or inspect network payloads.
- Cross-origin frames remain outside the current observation contract.
- Existing accessible-only sessions, plans, approvals, replay, and capture behavior remain valid.
- Policy authorization still inspects the resolved live target before an action; structural resolution does not bypass risk-tier enforcement.
- Custom combobox behavior, the repository-owned autonomous runner, and live Cars.com acceptance remain downstream in WES-268 and WES-273.

## Black-Box Test Strategy

Behavior-focused browser fixtures exercise the public observation, compilation, replay, repair, approval, and capture APIs rather than DOM helper internals. Coverage includes:

- a page with more than 100 semantic targets where viewport/form-local controls remain visible in the observation;
- a page with semantic volume where bounded fallback/custom controls retain reserved representation;
- stable ranking and accurate omission diagnostics across repeated observations;
- sanitized form/region/list context without selectors, raw DOM, hidden values, or secret-like labels;
- compiling the first non-promoted listing into a structural target hint instead of a global stale label occurrence;
- fresh replay selecting the first eligible item after listing names change or a promoted card is inserted;
- final approved capture resolving the same structural item;
- repair accepting changed descriptive labels while preserving structural intent;
- repair rejecting removed or altered position, context, role, or promotion exclusion;
- missing, ambiguous, malformed, secret-like, and out-of-bound structure failing safely; and
- existing accessible-only plans retaining their current fingerprints and runtime behavior.

## Scope

In scope: bounded viewport/form-aware ranking, fallback reservation, sanitized form/landmark/list ancestry, explicit promotion-marker exclusion, durable structural target hints, fresh replay and capture resolution, repair preservation, approval freshness, documentation, and black-box tests.

Out of scope: CSS or XPath persistence, raw DOM evidence, arbitrary site-specific selectors, inferred advertising identity, cross-origin frame traversal, custom-combobox action semantics, policy changes, browser-state reuse, autonomous runner ownership, live Cars.com acceptance, editor launch, and export.
