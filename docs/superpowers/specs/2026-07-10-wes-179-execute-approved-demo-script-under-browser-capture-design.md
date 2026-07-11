# WES-179 Execute Approved Demo Script Under Browser Capture Design

Date: 2026-07-10

## Overview

WES-179 connects the existing walkthrough planning, validation, review, and approval workflow to the existing browser capture runtime. It adds one execution command that verifies an approved structured plan, drives its browser actions on the same Playwright page being recorded, and returns a valid completed or failed capture bundle with transcript-safe step outcomes.

The executor produces a capture bundle only. Importing that bundle into an Auto Demo project, generating a baseline variant, and handing off to editor or export remain WES-180.

## Goals

- Execute a verifiably approved walkthrough plan on the browser page being recorded.
- Support navigation, click, type, wait, and visibility-assert actions.
- Supply typed values at runtime without placing them in plans, command-line arguments, logs, diagnostics, or JSON results.
- Resolve browser targets strictly enough that a changed page fails instead of recording the wrong action.
- Produce natural-looking, deterministic action pacing suitable for a recorded demo.
- Stop on the first execution failure and preserve useful partial capture artifacts.
- Return an immutable executed or failed artifact without overwriting the approved plan.
- Keep execution behavior fakeable and behavior-testable without coupling `@auto-demo/agent` to Playwright or `@auto-demo/capture`.

## Non-Goals

WES-179 does not:

- import a capture into an Auto Demo project;
- generate or save a polish variant;
- open the editor or run export;
- execute an unapproved plan;
- add an execute-time approval bypass;
- automate credentials, password fields, payment fields, destructive production actions, or arbitrary OS applications;
- persist typed values in an approved or executed plan;
- use randomized or AI-selected pacing;
- recover from ambiguity by choosing a different target;
- add distributed workers, browser attachment, CDP handoff, or cross-process execution.

## Operator Contract

The primary command is:

```bash
npm run autodemo -- agent execute \
  --plan <approved-plan-json-file> \
  [--inputs <runtime-inputs-json-file>] \
  --out <capture-directory> \
  [--viewport <width>x<height>] \
  --json
```

`--inputs` is required when the plan contains type steps and rejected when the file contains bindings the plan does not consume. `--viewport` uses the existing capture default when omitted. JSON is the only MVP output mode.

The command never overwrites the plan or input-binding file. It rejects an existing non-empty output directory before capture starts. An existing empty directory may be used.

There is no `--allow-unapproved` or execute-time best-guess flag. A best-guess plan must first pass the existing explicit approval command with `--allow-best-guess-bypass`. The resulting artifact records `basis: "best-guess-bypass"` and is then verified by execute mode like any other approved artifact.

## Approved Plan Execution Data

The plan schema gains only the structured fields required to execute already-supported step actions:

- A type step carries an `inputBinding` key. Intake assigns the stable step identifier by default, such as `step-3`. The value remains external.
- A wait step carries a bounded `waitDurationMs` value. MVP durations must be greater than zero and no more than 60 seconds.
- A navigation step carries an absolute safe HTTP(S) `navigationUrl` when it navigates somewhere other than the plan target.
- Click, type, and assert steps may carry the existing accessible `targetHint` with label, optional role, and optional occurrence.

Plan creation and structured refinement populate these fields when they can do so deterministically. An approved artifact missing required execution data fails preflight and must be refined and approved again. Execute mode never mutates an approved plan to invent missing values.

These fields are execution-relevant and must be included in the approval fingerprint. Any change to them invalidates the old approval. Existing approved artifacts created before this schema extension remain valid plan artifacts but are not executable when required fields are absent.

## Runtime Input Bindings

The inputs file is a JSON object keyed by the type step's `inputBinding`:

```json
{
  "step-3": "Auto Demo launch"
}
```

Preflight requires exactly one string value for every binding referenced by the plan. Missing bindings, duplicate binding references, non-string values, and unused input keys are errors. Values are read from the file rather than CLI arguments so they do not appear in the process list.

Bound values are held only in memory while executing the associated step. They are never copied into the plan, approval fingerprint, result JSON, capture manifest, step outcomes, or metadata event payloads. The browser and recorded video necessarily display the entered demo value. Operators remain responsible for using non-secret demo data.

The executor rejects type targets identified as passwords, tokens, credentials, payment data, or similarly sensitive inputs. Existing transcript-safety and unsafe-action checks remain authoritative. Errors identify the step and binding key but never the bound value.

## Selected Architecture

Use one coordinated, controllable capture session. The CLI composes the public agent execution service with the capture implementation; no second browser or child executor process is involved.

```text
approved plan + runtime bindings
              |
              v
      agent execution core
        | preflight first
        v
  controllable capture session
        | same Playwright page
        v
 step execution + video + event metadata
        |
        v
 completed/failed capture bundle + immutable JSON result
```

### `@auto-demo/agent`

Add the public execution service and structural dependency interfaces. The service owns:

- plan and binding preflight;
- `verifyWalkthroughPlanApproval()` enforcement;
- conversion from approved steps to strict execution targets;
- sequential action execution;
- pacing policy;
- fail-fast behavior;
- sanitized step outcomes;
- top-level plan and execution lifecycle transitions;
- completed, failed, and interrupted result shapes.

The service receives a lazy capture-session factory. Preflight completes before the factory is called, guaranteeing that plan, approval, binding, and output-policy failures do not start recording. The interfaces are structural and do not import `@auto-demo/capture` or Playwright types.

### `@auto-demo/capture`

Add a controllable form of the existing Playwright capture session. It still owns browser/context/page creation, video recording, interaction metadata, capture manifests, artifact paths, and durable stop behavior. It additionally exposes a narrow controller for the same recorded page:

- navigate to an approved URL;
- resolve a sanitized accessible target descriptor;
- click one resolved target;
- type a runtime value with a supplied per-character delay;
- wait for bounded page settling;
- assert that one target is visible;
- sleep for an explicit wait duration.

The controller never returns raw DOM, selectors, element handles, or input values in public results. Capture session stop remains idempotent.

### `@auto-demo/cli`

Add a focused `agent execute` adapter. It parses paths and viewport settings, loads JSON files, supplies the real controllable capture factory to the agent service, preserves the existing interrupt handling behavior, serializes one JSON result, and maps the result to a stable process exit code.

## Execution Phases

### 1. Preflight

Before browser launch or output creation:

1. Parse and validate the plan artifact.
2. Require top-level `state: "approved"`.
3. Verify the approval fingerprint and recorded approval basis.
4. Require resolved, supported, safely executable steps.
5. Validate navigation URLs, wait durations, target descriptors, and runtime binding references.
6. Load and validate the exact input-binding set.
7. Reject sensitive type targets and unsafe actions.
8. Reject an existing non-empty output directory.

### 2. Start Capture

The controllable session launches one Playwright browser context with existing viewport video recording and interaction metadata. Its initial navigation uses the plan target URL and counts as the initial target navigation when the plan contains the equivalent first navigation step. The executor begins the natural pre-roll only after that navigation is ready.

### 3. Execute Sequentially

Steps run in plan order. Each step gets a sanitized `pending`, `completed`, `failed`, or `skipped` outcome in the returned artifact. Outcome details may include step identifier, action, timestamps, duration, and stable error code, but never source secrets, input values, raw URLs with query strings or fragments, DOM, selectors, or event payloads.

The first failed step ends execution. Remaining steps become skipped with a stable dependency-failure reason. The executor does not attempt to continue from a browser state that may no longer match the approved walkthrough.

### 4. Finalize Capture

When every step succeeds, the executor applies the final hold and stops capture as `completed`. On step failure it stops capture as `failed`. On interruption it stops capture as `interrupted`. Existing capture behavior preserves media, events, and a diagnostic manifest whenever artifacts have been created successfully.

Only a successful execution plus successful capture finalization changes the top-level plan state to `executed`.

### 5. Return Immutable Result

The command writes one JSON result to standard output. The approved input artifact remains unchanged.

On success, the result includes:

- `ok: true`;
- the returned plan with `state: "executed"`;
- `execution.status: "completed"`;
- start/end timestamps and duration;
- the `natural-v1` pacing profile identifier;
- sanitized step outcomes;
- capture output directory, manifest, media, and metadata paths.

On failure after execution begins, the result includes:

- `ok: false`;
- the returned plan still in `state: "approved"`;
- `execution.status: "failed"`;
- sanitized completed, failed, and skipped step outcomes;
- the stable failure phase and error code;
- available diagnostic bundle paths.

Preflight failures may return no plan copy when the input cannot be parsed safely and no capture paths because recording never started.

## Strict Target Resolution

For click, type, and assert actions:

1. Prefer the approved accessible target hint: label, optional role, and optional occurrence.
2. When no hint exists, derive the same sanitized accessible target descriptor used by validation from the approved public step summary.
3. Require exactly one visible match after applying the approved occurrence rule.
4. Return `target_not_found` for zero matches and `ambiguous_target` for multiple matches.

Execution may use Playwright's bounded waiting for the same target to become actionable. It must not switch to a different label, role, occurrence, selector strategy, or nearby element after ambiguity. There is no heuristic target retry.

Navigation executes only approved safe HTTP(S) destinations. Assertions in the MVP mean that the approved accessible target is visibly present. Rich text comparisons, screenshot comparisons, and arbitrary page JavaScript assertions are deferred.

## Natural Pacing

The MVP uses one deterministic, versioned pacing profile named `natural-v1`:

- 750 ms pre-roll after initial navigation is ready;
- 250 ms anticipation pause before click and type actions;
- 75 ms between typed characters;
- 500 ms settle pause after click, type, and assertion actions;
- 750 ms settle pause after navigation;
- the structured duration for explicit wait steps;
- 750 ms final hold before successful capture shutdown.

The profile uses no randomness. Page actions also retain bounded Playwright actionability and load-state waits, with a 10-second default action timeout. Explicit wait steps do not add the ordinary 500 ms settle pause. The result records the profile name, not every internal sleep.

Configurable pacing, alternative profiles, and adaptive scene timing are deferred until real demo evidence shows a need.

## Error Model

Expected failures return stable, transcript-safe JSON errors grouped by phase.

Preflight codes include:

- `invalid_execution_plan`;
- `unapproved_plan`;
- `stale_approval`;
- `unsupported_execution_action`;
- `missing_execution_data`;
- `invalid_navigation_url`;
- `invalid_wait_duration`;
- `missing_input_binding`;
- `unexpected_input_binding`;
- `invalid_input_binding`;
- `prohibited_input_target`;
- `capture_output_collision`.

Capture and step codes include:

- existing `capture_setup_failed` and `capture_stop_failed`;
- `target_not_found`;
- `ambiguous_target`;
- `navigation_failed`;
- `action_failed`;
- `assertion_failed`;
- `execution_timeout`;
- `execution_interrupted`.

Exit code `0` means execution and capture completed. Exit code `1` means an expected preflight, setup, execution, or finalization failure. Exit code `130` means interruption.

Unexpected programmer errors remain sanitized at the CLI boundary. Stack traces and raw exception messages are not placed in normal JSON results.

## Testing Strategy

Tests assert public behavior and generated artifacts rather than private call order.

### Agent execution behavior

- a valid approved plan executes supported steps in order and returns `executed`;
- unapproved and stale plans fail before the lazy capture factory is invoked;
- a best-guess plan executes only when its existing approval basis and fingerprint verify;
- missing, extra, invalid, and sensitive bindings fail without exposing values;
- the first step failure marks later steps skipped and leaves top-level state approved;
- completed, failed, and interrupted results contain only sanitized outcome fields;
- the approved input object is not mutated.

### CLI behavior

- command parsing covers required plan/output/JSON flags, optional inputs and viewport, and unknown arguments;
- temporary input files remain byte-for-byte unchanged;
- output collisions fail before capture;
- success, expected failure, and interruption map to exit codes 0, 1, and 130;
- stdout remains valid JSON and stderr does not leak bound values.

### Capture behavior

- controller actions affect the same page whose video and metadata are captured;
- strict zero/one/many matching produces the documented outcomes;
- human-paced typing changes the recorded page without recording its value in metadata;
- completed, failed, interrupted, and stop-failed sessions retain the existing manifest and artifact guarantees.

### Real Playwright smoke paths

Use a deterministic local page and approved fixture plan to cover navigation, click, type, wait, and visibility assertion through a valid capture bundle. A second path succeeds on an early step and fails on a later target, then verifies failed manifest status, preserved partial media/events, sanitized diagnostics, skipped later steps, and absence of a completed-demo claim.

Timing tests assert observable ordering and bounded completion, not exact scheduler call counts or every internal delay.

## Documentation And Handoff

Update the root and package READMEs plus the Codex and host-neutral agent guidance with the new approval-to-execution command. Correct the existing README statement that validation and approval are still downstream work. Document that input bindings are appropriate only for non-secret demo data and that entered values are visible in the recorded video even though they are excluded from metadata and JSON.

A successful WES-179 result ends at a validated capture bundle. WES-180 consumes that bundle, imports it into a normalized Auto Demo project, generates the baseline saved variant, and returns editor/export handoff instructions.
