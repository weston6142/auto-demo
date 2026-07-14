# WES-184 Structured Browser Observation Snapshots Design

## Context

WES-183 defines a portable, bounded `DiscoverySessionV1` contract and immutable operations for recording caller-supplied observations and attempts. It intentionally does not inspect or control a browser. WES-184 supplies the next boundary: a host agent must be able to request a transcript-safe description of the current rehearsal page without receiving raw DOM, form values, selectors, or unbounded accessibility output.

The repository already has Playwright-backed validation and capture code, but those paths are shaped around deterministic walkthrough execution and media recording. Discovery observation is a distinct agent-facing capability and belongs in `@auto-demo/agent`.

The WES-183 implementation, tests, fixtures, spec, plan, exports, and documentation currently exist only in the dirty working tree. Linear marks WES-183 Done, but no local or remote commit contains that dependency. This design may proceed, but WES-184 implementation must not begin until WES-183 is durably integrated or reopened and reconciled.

## Goal

Add a public stateful observation extractor to `@auto-demo/agent` that converts the current main-document browser state into a WES-183-compatible `RecordDiscoveryObservationInput`. The output must give a host enough bounded context to choose its next discovery action while preserving stable opaque target identity, transcript safety, deterministic limits, and structured failure behavior.

## Scope And Linear Boundaries

WES-184 owns:

- a public session-scoped observation extractor API;
- a narrow browser-page adapter and a concrete Playwright adapter;
- stable opaque target IDs for attached elements within a browser document;
- bounded page metadata, visible-state summaries, and interactive-target collection;
- accessibility-first target discovery plus bounded focusable or clickable-looking fallbacks;
- optional viewport screenshot capture through an injected artifact sink;
- transcript-safe sanitization and credential-value exclusion;
- runtime-only diagnostics for redaction, truncation, fallbacks, credentials, retries, and screenshot failure;
- one retry when navigation or document replacement makes an extraction attempt unstable;
- structured extraction errors;
- behavior-focused fake-adapter and Playwright-backed tests;
- agent-package documentation.

WES-184 does not:

- launch or close a browser;
- navigate, click, type, wait, refresh, or go back;
- authorize or block discovery actions;
- collect network payloads, cookies, headers, storage state, raw DOM, selectors, or form values;
- inspect iframe content;
- continuously observe DOM mutations;
- mutate a `DiscoverySessionV1` directly;
- compile or replay a `WalkthroughPlan`;
- add a CLI command;
- define final artifact-bundle layout or final recording behavior.

Downstream ownership remains:

- WES-185 controls the rehearsal browser and records action attempts against observed target IDs.
- WES-186 enforces safe-default and explicitly disposable-environment policy.
- WES-187 compiles a selected discovery trace into `WalkthroughPlan`.
- WES-188 replays and repairs compiled plans.
- WES-189 exposes the Codex-facing discovery and approval workflow.

## Chosen Approach

Use a stateful on-demand extractor created once for a supplied browser page. The extractor maintains document-local target identity and produces one atomic structured snapshot per `observe()` call. It does not install a continuous page observer or derive identity from mutable labels and positions.

This approach preserves the identity of an attached element across repeated observations, distinguishes duplicate controls, resets safely after navigation, and gives WES-185 a future session-scoped dependency without coupling WES-184 to browser actions.

## Architecture

The design has five focused units:

1. `DiscoveryObservationExtractor` is the public session-scoped facade. It coordinates extraction, retry, sanitization, screenshot persistence, diagnostics, and structured results.
2. `DiscoveryObservationPage` is a narrow adapter over a supplied browser page. It reads a document token, performs an atomic main-document collection, captures an optional viewport PNG, and reports conservative navigation state.
3. `DiscoveryTargetRegistry` is an internal document-local identity registry. It assigns opaque IDs to attached elements and reports whether an ID still refers to a live target. It never exposes DOM handles or selectors publicly.
4. `DiscoveryObservationArtifactSink` optionally persists screenshot bytes and returns a candidate safe relative path. The extractor validates the path and builds the WES-183 artifact reference.
5. Sanitization and result helpers convert adapter data into bounded `RecordDiscoveryObservationInput`, fixed diagnostics, or fixed extraction errors.

The generic extractor depends only on the narrow page interface. A concrete Playwright factory adapts an existing Playwright `Page`. `@auto-demo/capture` remains unchanged because observation extraction is rehearsal and host-agent behavior rather than media recording.

The browser page, target registry, and later WES-185 controller share one session lifetime internally. WES-184 exposes liveness checks but no action or raw-target capability. WES-185 may add controlled action operations against the same internal registry without changing the public observation format.

## Public API

The initial public factories are:

```ts
createDiscoveryObservationExtractor(dependencies);
createPlaywrightDiscoveryObservationExtractor(page, options);
```

They return:

```ts
interface DiscoveryObservationExtractor {
  observe(): Promise<DiscoveryObservationExtractionResult>;
  hasLiveTarget(targetId: string): Promise<boolean>;
}
```

The generic dependencies include:

- a `DiscoveryObservationPage` adapter;
- an optional `DiscoveryObservationArtifactSink`;
- an injectable clock;
- an injectable safe opaque-ID generator.

Production defaults may use the system clock and UUID-backed safe IDs. Tests inject deterministic values. `observe()` generates the observation ID, timestamp, visible-state IDs, target IDs, and artifact IDs; callers do not have to coordinate these values separately.

The result is a discriminated union:

```ts
type DiscoveryObservationExtractionResult =
  | {
      ok: true;
      observation: RecordDiscoveryObservationInput;
      diagnostics: DiscoveryObservationDiagnostic[];
    }
  | {
      ok: false;
      errors: DiscoveryObservationExtractionError[];
    };
```

Every successful `observation` must be accepted by `recordDiscoveryObservation()` when added to a valid active session with remaining WES-183 count and byte capacity, and the resulting session must remain valid when passed to `validateDiscoverySession()`.

The extractor does not own the supplied page and therefore has no browser `close()` method. A closed or replaced page makes subsequent operations fail with `browser_unavailable`.

## Target Identity And Lifetime

Target IDs are opaque and session-unique. Their values must not encode labels, roles, selectors, DOM paths, element text, or user data.

The concrete page adapter maintains a document-local weak identity mapping for elements. The same attached DOM element receives the same target ID across observations even if its label, position, disabled state, or occurrence changes. Duplicate elements always receive different IDs.

Identity has these fixed rules:

- An attached element keeps its ID while the same document and element identity remain live.
- Removing and recreating an equivalent-looking element creates a new ID.
- Navigation or main-document replacement invalidates every prior target ID.
- IDs created after a document replacement cannot collide with prior-document IDs.
- `hasLiveTarget()` returns `false` for removed elements, prior-document IDs, unknown IDs, or unavailable pages.
- Snapshot-local `occurrence` is computed among targets with the same sanitized label and role in current document order. Reordering may change occurrence without changing attached-element IDs.

The registry uses weak document-side element identity and prunes disconnected reverse mappings during every `observe()` and `hasLiveTarget()` call. Main-document replacement clears the prior document epoch. These rules prevent removed targets from remaining live or accumulating indefinitely.

The registry remains encapsulated. Hosts receive only target IDs, and WES-184 does not expose a selector, DOM handle, or direct action method.

## Interactive Target Collection

Collection is main-document only. Normal Playwright traversal through open shadow roots is included. Iframes, hidden elements, inert content, disabled hidden descendants, and elements without a useful sanitized label are excluded.

Targets are selected in two tiers.

Tier 1 contains visible native controls and recognized interactive ARIA roles. The version 1 role allowlist covers:

- button and link;
- textbox and searchbox;
- checkbox, radio, and switch;
- combobox, listbox, and option;
- tab and menuitem;
- slider and spinbutton.

Native controls include visible links with destinations, buttons, non-hidden inputs, textareas, selects, summaries, and editable controls. Native semantics determine the role where possible.

Tier 2 contains visible, labeled fallback targets that are clearly focusable or clickable-looking, including non-native elements with a non-negative `tabIndex`, editable content, or computed `cursor: pointer`. Fallbacks do not include arbitrary visible text nodes. When a fallback candidate is nested inside another eligible element that represents the same interaction surface, only the nearest eligible actionable ancestor is retained. Their inclusion produces a `fallback_targets_included` diagnostic.

Targets are ordered by tier and then main-document order. This makes native and ARIA controls survive truncation before heuristic fallbacks.

Each target contains only the WES-183 fields:

- opaque `id`;
- sanitized bounded `label`;
- optional allowlisted or inferred `role`;
- optional duplicate `occurrence`;
- `disabled`;
- optional `actionRisk: "potentially-mutating"`.

The extractor marks structurally mutating controls, such as form-submit controls, as `potentially-mutating`. This is an observation signal only. WES-186 owns the policy decision.

## Credential Controls

The extractor never reads or returns form-control values, selected secret values, autofill data, or value-bearing attributes. This prohibition applies even when the page adapter could technically read them.

Credential-like controls remain visible to the host through safe metadata so the host can recognize an authentication boundary. Password inputs and controls with credential autocomplete semantics produce:

- an opaque target ID;
- a sanitized label;
- an allowlisted role when available;
- disabled state;
- a `credential_target_present` diagnostic.

No diagnostic identifies the value, account, username, or secret type. WES-186 later blocks credential entry according to safety policy.

## Visible-State Collection

Visible states provide compact context rather than a body-text dump. Collection has two tiers:

1. Visible `status` and `alert` content, in document order.
2. Visible headings followed by meaningful non-control text blocks, in document order.

A meaningful non-control text block is a visible non-interactive element with nonempty direct text, or a semantic paragraph, list item, description, caption, or note whose text is not already represented by a more specific visible child block. This leaf-first rule prevents the same nested page copy from being emitted repeatedly. Whitespace is normalized, equivalent summaries are deduplicated, and control labels already represented as targets are not repeated merely to consume text capacity. Empty, generic, or entirely redacted summaries are omitted.

The extractor uses tighter presentation bounds than the WES-183 contract maximums:

- target labels: 256 characters after sanitization;
- page titles: 512 characters after sanitization;
- visible-state summaries: 500 characters after sanitization;
- page URLs: the existing WES-183 public-string and URL rules.

Truncating a string or omitting additional eligible states produces a diagnostic. The observation does not gain new persisted truncation fields.

## Navigation State

The adapter reports `canGoBack` conservatively. It becomes `true` only when the adapter knows that the current page has a prior main-document entry in the supplied rehearsal-page lifetime. Unknown pre-existing browser history and the initial `about:blank` page do not count as safe known back destinations.

WES-184 only reports this state. WES-185 owns the eventual back action and its safety checks.

## Observation Data Flow

One `observe()` call follows this sequence:

1. Confirm that the supplied page is available.
2. Read the current main-document identity token.
3. Perform one atomic in-page evaluation that collects page metadata, visible states, eligible interactive targets, and credential presence.
4. Assign or reuse opaque target IDs through the document-local registry.
5. If an artifact sink exists, capture one viewport PNG into transient memory.
6. Re-read the main-document token.
7. If navigation or document replacement changed the token, discard the candidate data and screenshot and retry the full operation once.
8. If the second attempt also changes documents, return `unstable_page` with no observation.
9. Sanitize, prioritize, deduplicate, and bound the structured data.
10. If screenshot bytes exist, compute SHA-256, ask the sink to persist them, validate its returned relative path, and create the artifact reference.
11. Return the `RecordDiscoveryObservationInput` and runtime diagnostics.

The in-page collection is atomic, so ordinary DOM mutation cannot tear the structured target and text arrays during that evaluation. The screenshot is captured immediately afterward and may reflect a slightly later visual moment. The document-token recheck prevents pairing data with a different navigation or replaced main document; WES-184 does not promise to freeze arbitrary client-side animations or continuously changing same-document content.

The sink is not invoked for an unstable discarded attempt, preventing orphan artifacts from retries.

## Screenshot Artifacts

Screenshot support is optional. Without a sink, extraction succeeds with structured page data, an empty artifact list, and no warning because the omission is intentional.

When a sink is supplied:

- the Playwright adapter captures the current viewport as PNG;
- raw bytes remain internal and are never returned in an observation or diagnostic;
- the extractor computes SHA-256;
- the sink receives the bytes, media type, and safe suggested artifact ID;
- the sink returns only a candidate relative path;
- the extractor validates that path with the WES-183 artifact rules;
- the returned observation contains one `screenshot` reference with `image/png`, relative path, and digest.

Capture failure, sink failure, or an invalid returned path is nonfatal. The bytes are discarded, the observation contains no screenshot reference, and `screenshot_unavailable` is emitted. Raw exception messages are never exposed.

## Limits And Deterministic Truncation

WES-183 remains authoritative for observation validation. WES-184 applies its per-observation limits before returning data:

- at most 100 interactive targets;
- at most 50 visible states;
- at most one screenshot artifact per extraction;
- safe WES-183 identifier, URL, path, and public-string rules;
- the tighter presentation bounds defined in this design.

When eligible items exceed a limit, the extractor preserves the tier priority and document order described above. Diagnostics report safe omitted counts but never omitted content.

The WES-183 session-level observation count and serialized-session byte limits remain the responsibility of `recordDiscoveryObservation()`. WES-184 produces one bounded candidate observation and does not inspect or mutate the session.

## Sanitization And Transcript Safety

WES-184 reuses the WES-183 allowlisted text, URL, identifier, and artifact-path rules rather than introducing a conflicting sanitizer. Shared helpers may be exposed within the package, but WES-183 behavior must not be weakened.

The extractor:

- strips or replaces secret-like substrings with the existing public redaction marker;
- rejects unsafe page URL schemes and credential-bearing URLs;
- never emits query or fragment content that the WES-183 URL sanitizer removes;
- normalizes whitespace before deduplication and bounds checks;
- omits entries that become empty after sanitization;
- never includes raw DOM, selectors, CSS paths, HTML, attributes unrelated to actionability, exception text, form values, cookies, headers, storage state, request bodies, or accessibility-tree dumps.

Screenshot pixels may contain page-visible sensitive data. WES-184 treats screenshot persistence as explicit caller opt-in through the artifact sink. The structured observation remains sanitized regardless of screenshot configuration. Later workflow and policy work owns user-facing authorization and retention rules for those artifacts.

## Runtime Diagnostics

Diagnostics are successful-extraction metadata, not persisted `DiscoveryObservation` fields. Each diagnostic contains a fixed code, fixed public message, and optional safe count. Initial codes are:

- `interactive_targets_truncated`;
- `visible_states_truncated`;
- `content_redacted`;
- `credential_target_present`;
- `fallback_targets_included`;
- `screenshot_unavailable`;
- `unstable_page_retried`.

Diagnostics never contain labels, omitted text, values, URLs, selectors, HTML, artifact bytes, or exception messages. Multiple occurrences of the same condition are aggregated into one diagnostic with a safe count.

## Error Handling

Extraction failures return no partial observation. Initial stable error codes are:

- `browser_unavailable`: the supplied page is closed, replaced, or inaccessible;
- `page_evaluation_failed`: atomic structured inspection could not complete;
- `invalid_page_state`: required viewport or page metadata is missing or invalid;
- `unsafe_page_url`: the current main-document URL cannot satisfy WES-183 URL rules;
- `unstable_page`: both the initial attempt and single retry crossed a navigation or main-document replacement.

Errors contain only a fixed code, fixed sanitized message, and an optional safe field path. Adapter or sink exception messages, page content, and target metadata are never echoed.

Screenshot and artifact-sink failures do not use the failure result. They produce a successful observation without an artifact plus `screenshot_unavailable`.

## Dynamic And Duplicate Target Behavior

Dynamic behavior is verified through public observations:

- adding an eligible element makes it appear on the next observation with a new ID;
- removing an element makes `hasLiveTarget()` false and removes it from later observations;
- recreating equivalent markup receives a new ID;
- modifying an attached element preserves its ID while returning current sanitized metadata;
- duplicate labels receive separate IDs and occurrence values;
- reordering attached duplicates changes occurrence values but preserves their IDs;
- main-document replacement invalidates all old IDs and creates a new document identity epoch.

The extractor does not attempt semantic identity recovery across replacement or re-render. Avoiding false identity is more important than preserving continuity for a different element that merely looks equivalent.

## Testing Strategy

Tests treat the extractor as a black box. They assert returned observations, diagnostics, errors, liveness answers, and artifact effects rather than helper calls, query strategies, registry data structures, or internal retries.

Deterministic fake-adapter tests cover:

- successful WES-183-compatible observation output when recorded into an active session with remaining capacity;
- injected clock and ID behavior;
- target and visible-state prioritization and truncation;
- aggregated diagnostics without content leakage;
- one successful unstable-page retry and repeated-instability failure;
- unavailable page, unsafe URL, invalid page state, and evaluation failures;
- intentional no-sink behavior;
- screenshot capture, persistence, digest, failure, and invalid-path behavior;
- no partial observation on failure;
- session-level validation after `recordDiscoveryObservation()`.

Playwright-backed local HTML tests cover:

- attached-element ID stability;
- removal and recreation;
- duplicate target occurrence and reorder behavior;
- native controls and interactive ARIA roles;
- `tabIndex`, editable, and pointer-cursor fallbacks;
- hidden and inert exclusion;
- open shadow-root inclusion;
- iframe exclusion;
- credential controls and value non-disclosure;
- secret-like visible content sanitization;
- navigation and document replacement;
- closed-page failure;
- real viewport screenshot persistence through a temporary test sink.

Repository verification must include:

- focused WES-184 tests;
- the full `@auto-demo/agent` test suite;
- agent package typecheck and build;
- repository build, typecheck, lint, and workspace tests;
- formatting checks for every WES-184 file;
- full `npm run validate`.

The current unrelated `check-codex-usage` formatting exception must be fixed or explicitly preserved in completion evidence. It must not be described as a clean full-validation pass.

## Documentation

`packages/agent/README.md` will document:

- creating a Playwright observation extractor for an existing page;
- obtaining an observation and recording it through `recordDiscoveryObservation()`;
- diagnostics versus errors;
- optional screenshot persistence;
- target-ID lifetime and stale-target behavior;
- the absence of browser actions and policy enforcement in WES-184;
- the prohibition on values, selectors, DOM, and embedded screenshot bytes.

The root README needs only a concise capability update if WES-184 materially changes the repository-level workflow description.

## Alternatives Considered

### Stateless semantic IDs

Deriving IDs from role, label, position, and occurrence would simplify construction but silently changes identity when duplicates reorder or labels change. It conflicts with the chosen attached-element stability rule.

### Persistent in-page mutation observer

A continuously installed observer could track rapidly changing pages, but it adds lifecycle, isolation, navigation, memory, content-security, and cleanup complexity. On-demand atomic snapshots are sufficient for WES-184.

### Extend the deterministic Playwright validation runner

Reusing the existing validation runner directly would reduce new surface area but couple agentic discovery to deterministic `WalkthroughPlan` validation. A narrow independent extractor is easier for WES-185 to consume and test.

### Put extraction in `@auto-demo/capture`

The capture package already wraps Playwright, but adding host-agent observation semantics would mix rehearsal discovery with media recording. The agent package is the correct owner.

### Persist truncation metadata in `DiscoveryObservation`

Changing the WES-183 artifact for extraction diagnostics would reopen the completed contract and burden every downstream consumer. Runtime diagnostics give hosts the required information without changing portable session JSON.

### Require screenshots

Mandatory artifacts would make structured observation depend on filesystem policy and would increase privacy and storage risk. An optional injected sink preserves a useful text-only path.

## Success Criteria

WES-184 is complete when:

- `@auto-demo/agent` exposes the generic and Playwright-backed stateful extractor APIs;
- successful extraction returns a bounded `RecordDiscoveryObservationInput` accepted by the WES-183 lifecycle and validator when the active session has remaining count and byte capacity;
- attached targets retain opaque IDs across observations while removed, recreated, and prior-document targets do not;
- native and ARIA targets plus bounded focusable/clickable fallbacks are collected predictably;
- main-document visible context is useful and bounded without iframe content or raw DOM;
- credential controls are recognizable without exposing values;
- secret-like structured content is sanitized and diagnostics never leak source content;
- optional screenshot persistence returns only a safe relative reference and SHA-256 digest;
- dynamic and duplicate targets have behavior-focused coverage;
- navigation instability retries once and repeated instability fails without partial output;
- all extraction failures are stable, structured, and sanitized;
- WES-184 remains free of browser control, safety-policy, compilation, replay, CLI, and final-capture behavior;
- focused, package, and repository verification evidence is recorded honestly;
- WES-183 is durably integrated or explicitly reopened and reconciled before WES-184 implementation begins.
