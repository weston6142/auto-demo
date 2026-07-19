# WES-271 Semantic Form Controls And Observable Action Effects Design

## Context

Auto Demo can currently observe text inputs, checkboxes, radios, and native selects as generic accessible targets, but discovery can only click or type. It does not expose bounded form state or public option choices, so an agent cannot reliably choose condition, make, model, or distance. The rehearsal controller also treats a successfully dispatched action with no declared expectations as successful even when the page did not change. That allows a no-op click to enter a selected path and leaves replay and recording with no effect to reproduce.

WES-271 adds semantic native-form support across observation, discovery, compilation, fresh replay, approved execution, and capture. It preserves the existing risk-tier policy, isolated browser contexts, launch-profile parity, review, approval, and transcript-safety boundaries.

## Approaches Considered

### 1. First-class native select action and bounded form state (selected)

Add a `select` action whose durable choice is a sanitized public option label. Extend observed targets with bounded public form metadata and derive reproducible expectations from meaningful post-action changes. Replay and capture select the option by label and verify the resulting assertion.

This is the smallest design that gives selection the same deterministic lifecycle as click and type. It does require coordinated schema changes across the agent and capture packages, but every layer keeps one explicit responsibility.

### 2. Encode selection as click and type

Treat a select as a click followed by typing or clicking a separately observed option. This avoids a new plan action but is browser- and widget-state-dependent, performs poorly for closed native selects, and cannot clearly distinguish an option label from a secret-bearing value. It also produces fragile replay artifacts.

### 3. Introduce a generic form mutation action

Add one extensible action for text, select, checkbox, radio, sliders, dates, and future custom widgets. This could eventually reduce action variants, but it broadens the contract and migration surface far beyond the native select and observable-effect requirements. WES-271 does not need that irreversible abstraction.

## Public Contracts

### Bounded form metadata

`DiscoveryInteractiveTarget` gains optional `form` metadata:

- `required`: whether the control is required;
- `hasValue`: whether a non-empty value exists, without exposing that value;
- `validity`: `valid`, `invalid`, or `unknown`;
- `checked`: only for checkbox, radio, or switch controls;
- `selectedOption`: the sanitized visible label of the selected native option, when public and non-empty;
- `options`: at most 50 sanitized visible native option labels, each with `disabled` and `selected` flags.

The extractor never returns input values, option `value` attributes, hidden/autofilled content, credentials, raw DOM, or selectors. Secret-like or empty option labels are omitted, diagnostics account for truncation/redaction, and all strings use existing public-text sanitization and limits.

### Semantic select action

`DiscoveryAction` gains:

```ts
{
  kind: "select";
  targetId: string;
  optionLabel: string;
}
```

The action is valid only for a live native select target whose bounded public options contain exactly one enabled matching label. The runtime resolves the opaque target in memory and calls Playwright selection by visible label. It never persists or selects by the option value.

Compiled walkthrough plans gain a `select` step and `optionLabel`. Walkthrough validation rejects missing, unsafe, unbounded, or unexpected option labels. Fresh replay and final capture locate the select through the existing accessible target hint and select the public label. The option label participates in plan fingerprints and approval freshness.

### Observable effects

Click, type, and select are state-changing discovery actions. A state-changing attempt succeeds only when:

1. all declared expectations match; and
2. either at least one declared expectation exists or the before/after observations prove a meaningful effect.

Meaningful effects are bounded to:

- a navigation change;
- a newly visible public state; or
- a changed public form-state field on a target that remains identifiable in the same document.

The controller derives expectations for proven effects. Navigation and new visible state reuse the existing expectation forms. Form changes use a new `control-state` expectation containing an accessible public target identity and only the changed public fields. The derived expectation and its matched effect are persisted in the finalized attempt.

A dispatched action with no declared expectations and no meaningful effect finishes as failed with `action_no_observable_effect`. An action with declared expectations retains the existing matched/unmatched result. This rule prevents no-op clicks from entering a completed selected path while allowing checkboxes, radios, selects, typed fields, and conditionally revealed controls to prove their effects without arbitrary host assertions.

## Compilation, Replay, And Recording

The discovery compiler emits:

- `select` for a selected native option;
- an accessible target hint for the select;
- the sanitized `optionLabel`; and
- assertions for every declared or derived effect.

`control-state` assertions identify the control using its accessible label, role, and occurrence and contain the expected bounded public state. Replay and capture query the live control state after settling and compare only the asserted fields. They do not expose the live value in results or errors.

The Playwright replay browser, walkthrough execution browser, and capture controller each gain `select(target, optionLabel)`. Browser matching continues to require exactly one visible accessible target unless an occurrence is present. Failures retain the existing non-secret `target_not_found`, `ambiguous_target`, `action_failed`, and `assertion_failed` categories.

Capture metadata records selection as a redacted semantic interaction. It may include the public control label and public option label under existing bounded metadata rules, but never the native option value or other form values.

## Error Handling And Compatibility

- Selecting a missing, disabled, ambiguous, non-native, or stale option fails safely without guessing.
- Secret-like or oversized labels are rejected or redacted before persistence.
- Existing discovery sessions and walkthrough plans remain valid because all new fields are optional and existing actions are unchanged.
- Existing type actions retain runtime-only input bindings and never expose typed values.
- Existing click behavior with declared expectations is unchanged; only expectation-free no-op state-changing actions become failed attempts.
- Custom combobox/listbox widgets remain observable as existing accessible targets but are not granted native select semantics in WES-271.
- Structural ranking, autonomous runner ownership, and Cars.com acceptance remain in WES-267, WES-268, and WES-273.

## Black-Box Test Strategy

Behavior-focused Playwright fixtures will expose native controls for condition, make, model, distance, and a conditional ZIP field. Tests will drive public controllers and assert returned observations, finalized attempts, compiled plans, replay results, capture controller behavior, and redacted metadata rather than internal DOM helpers.

Coverage includes:

- bounded form metadata without raw input or option values;
- selecting condition, make, model, and distance by public label;
- a selection revealing the conditional ZIP control as a meaningful effect;
- checkbox/radio checked-state effects and typed-field has-value effects;
- a no-op click failing with `action_no_observable_effect`;
- compilation and validation of select and control-state assertions;
- fresh Playwright replay reproducing selection and effects;
- approved execution and capture selecting the same option;
- missing, disabled, ambiguous, secret-like, stale, and malformed options failing safely;
- existing click, type, policy, launch-profile, approval, and recording behavior remaining green.

## Scope

In scope: native HTML select/option semantics, bounded non-secret form metadata, observable-effect enforcement, durable compilation, replay, approved execution, capture, docs, and black-box tests.

Out of scope: custom JavaScript combobox behavior, structural/positional ranking, autonomous runner implementation, live Cars.com acceptance, authenticated state, arbitrary browser evaluation, policy changes, approval bypass, editor launch, and export.
