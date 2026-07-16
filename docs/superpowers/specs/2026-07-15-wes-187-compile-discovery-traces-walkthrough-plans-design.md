# WES-187: Compile Discovery Traces Into Walkthrough Plans

## Context

The Agentic Flow Discovery milestone now has a durable discovery contract, bounded browser observations, a rehearsal controller, and safe/disposable discovery policies. A completed `DiscoverySessionV1` contains all attempted exploration plus one continuous selected path whose attempts succeeded and whose expectations matched recorded evidence.

The existing `WalkthroughPlan` lifecycle supports review, browser validation, approval fingerprints, deterministic execution under capture, and project handoff. It currently enters that lifecycle through a deterministic text parser. WES-187 adds the missing evidence-aware entry path. It compiles only the selected discovery path into the existing plan model; it does not replay, approve, capture, or repair the plan.

## Goals

- Accept an untrusted completed `DiscoverySessionV1` and fail closed unless it validates.
- Compile only the selected continuous successful path. Preserve abandoned, failed, blocked, and unselected attempts in the discovery artifact, not in the plan.
- Produce resolved navigation, click, type, wait, and assertion steps that the existing plan execution lifecycle can consume.
- Preserve stable accessible target hints, runtime input binding names, expected destinations, expected visible outcomes, and bounded discovery provenance.
- Return a deterministic `draft`, `validate-first`, unapproved plan with no validation or execution evidence.
- Keep typed values, raw page content, selectors, policy permits, disposable-environment authority, query strings, fragments, and arbitrary exception text out of the compiled artifact and errors.
- Preserve approval safety by fingerprinting every new execution-relevant assertion and provenance field.

## Non-Goals

- Replaying the compiled plan in a fresh browser, promoting it to `validated`, or producing repair evidence; WES-188 owns those behaviors.
- Approving or executing final capture.
- Carrying safe/disposable discovery policy state into the plan.
- Embedding a model or asking a model to reinterpret discovery evidence.
- Compiling failed branches, confidence notes, screenshots, or arbitrary outcome summaries.
- Replacing or retiring deterministic text intake; WES-191 owns that cleanup.
- Adding a second discovered-plan lifecycle alongside `WalkthroughPlan`.

## Chosen Approach

Implement a pure, direct compiler from validated discovery evidence to `WalkthroughPlan`.

The compiler walks the selected attempt IDs, resolves each referenced action and observation, converts the action into an executable step, and converts every matched expectation into an explicit assertion step immediately after its action. It adds a discovery-aware source variant and bounded step provenance, but otherwise reuses the existing review, validation, approval, execution, and serialization model.

This is preferred over two alternatives:

1. **Render a synthetic script and call the deterministic parser.** This would reuse more code, but it would flatten exact targets, expectation match modes, input bindings, and evidence provenance into text and then attempt to infer them again. That is lossy and makes transcript safety harder to prove.
2. **Create a separate discovered-plan artifact and lifecycle.** This would avoid extending `WalkthroughPlan`, but it would duplicate review, approval, fingerprint, execution, and handoff rules. It would also conflict with the milestone requirement to compile into the existing lifecycle.

## Public API And Ownership

The compiler belongs in `@auto-demo/agent` beside the discovery and walkthrough contracts. Its public surface follows the package's existing discriminated-result pattern:

```ts
type CompileDiscoverySessionOptions = {
  mode?: "validate-first";
};

type CompileDiscoverySessionResult =
  { ok: true; plan: WalkthroughPlan } | { ok: false; errors: DiscoveryPlanCompilationError[] };

function compileDiscoverySessionToWalkthroughPlan(
  value: unknown,
  options?: CompileDiscoverySessionOptions,
): CompileDiscoverySessionResult;
```

The input is `unknown` deliberately. The compiler first calls `validateDiscoverySession()` and compiles only the returned sanitized session. The only supported mode is `validate-first`; accepting an option leaves room for explicit API evolution without permitting the existing best-guess approval bypass for discovered plans.

The implementation should live in a focused compiler module rather than further growing `packages/agent/src/index.ts`. The package index exports the API and its types.

## Walkthrough Contract Extensions

### Discovery-aware source

Change `WalkthroughPlan.source` into a discriminated union while preserving existing deterministic artifacts:

```ts
type WalkthroughPlanSource =
  | {
      parser: "deterministic-v1";
      script: string;
    }
  | {
      parser: "discovery-v1";
      script: string;
      discovery: {
        schemaVersion: 1;
        sessionId: string;
        selectedPathFingerprint: string;
      };
    };
```

For a discovered plan, `script` is a canonical transcript-safe rendering of the compiled public step summaries. It exists for current review and artifact compatibility; it is never reparsed and is not the source of execution fields. The discovery metadata contains only a safe session ID and a SHA-256 fingerprint, not timestamps, goal text, observations, policy declarations, or abandoned attempts.

All walkthrough sanitizers must preserve the union discriminator and allowlisted discovery metadata. They must not silently rewrite a discovery source to `deterministic-v1`.

### Structured assertions

Add an assertion payload used only by `assert` steps:

```ts
type WalkthroughPlanAssertion =
  | {
      kind: "navigation";
      url: string;
      match: "exact-url" | "same-origin-path";
    }
  | {
      kind: "visible-state";
      condition: string;
      role?: string;
      occurrence?: number;
    };
```

`WalkthroughPlanStep.assertion` is required on newly compiled assertion steps and forbidden on non-assertion steps. Legacy deterministic assertion steps without the field remain valid and continue using their existing `targetHint` or public-summary behavior.

A compiled visible-state assertion also receives a matching accessible `targetHint`; this keeps it executable through existing target-matching abstractions. A navigation assertion intentionally has no target hint. Walkthrough validation and final execution gain explicit navigation-assertion handling using the current sanitized browser URL and the recorded match mode.

### Bounded provenance

Add optional compiler provenance to a step:

```ts
type WalkthroughPlanStepProvenance = {
  kind: "discovery";
  sessionId: string;
  attemptId: string;
  expectationId?: string;
  expectationOrigin?: "declared-before-action" | "derived-from-observation";
  normalizedFrom?: "inspect" | "back" | "refresh";
};
```

Action steps reference their selected attempt. Assertion steps additionally reference their expectation and origin. `normalizedFrom` makes semantic normalization reviewable without retaining arbitrary evidence text. Provenance is allowlisted, sanitized, and included in the approval fingerprint because WES-188 will use it to associate replay failures with compilation inputs.

## Compilation Preconditions

Compilation succeeds only when all of the following hold:

1. `validateDiscoverySession(value)` succeeds.
2. The sanitized session has `status: "completed"` and a matching completed terminal record.
3. A non-empty selected path exists.
4. Every selected attempt is finalized and succeeded.
5. Every required before/after observation, action target, expectation, and matched observed effect resolves.
6. The selected path still satisfies the discovery contract's ordering, continuity, and visible-evidence rules.
7. Every compiled URL, identifier, binding, target hint, assertion, and public summary passes the walkthrough contract's safety and size rules.
8. The resulting plan passes `isWalkthroughPlan()` before it is returned.

The discovery validator already proves most structural invariants. The compiler repeats lookup checks at its own boundary rather than using non-null assertions, so later contract changes fail closed.

## Target And Step Mapping

### Plan target

The plan target is the sanitized URL of the first selected attempt's `beforeObservation`, not necessarily `session.target.startUrl`. Discovery may contain abandoned exploration before the selected route begins. WES-188 will determine whether that selected baseline can actually be recreated in a fresh context.

### Action steps

Selected actions map in order:

- `navigate` becomes a resolved `navigate` step using the action URL.
- `click` becomes a resolved `click` step. Its opaque discovery target ID is resolved against the before-observation and replaced by an accessible hint containing label, optional role, and optional occurrence.
- `type` becomes a resolved `type` step with the same accessible target hint and binding name. No runtime value is resolved or copied.
- `wait` becomes a resolved `wait` step with its bounded duration.
- `back` becomes a resolved `navigate` step to the after-observation's sanitized URL and records `normalizedFrom: "back"`.
- `refresh` becomes a resolved `navigate` step to the after-observation's sanitized URL and records `normalizedFrom: "refresh"`.
- `inspect` emits no browser action. Its matched expectations still compile into assertion steps with `normalizedFrom: "inspect"`.

Back and refresh are normalized instead of expanding the public action enum. Their user-visible result is the evidence-confirmed destination; direct navigation is the deterministic operation the existing plan runner understands. Fresh replay in WES-188 will expose any route whose behavior depended on browser history or transient refresh state.

The compiler emits a fixed transcript-safe warning when a selected path contains a normalized `inspect`, `back`, or `refresh` action. It does not include URLs, labels, or evidence text in the warning.

### Assertion steps

For each selected attempt, combine declared expectations followed by derived expectations in their stored order. Each expectation must have exactly one matched observed effect in the attempt's after-observation.

- A navigation expectation becomes a resolved `assert` step with a structured navigation assertion containing the sanitized expected URL and exact match mode.
- A visible-state expectation with `targetId` resolves that ID against the after-observation. An interactive target contributes its label, role, and occurrence. A visible-state record contributes its bounded summary. The result becomes a visible-state assertion and matching accessible target hint.
- A visible-state expectation with `publicCondition` becomes a visible-state assertion using that sanitized condition and optional role.

Every assertion is placed immediately after the action that produced its evidence. Assertions from `inspect` occupy the inspect attempt's position even though no action step precedes them. The compiler does not create assertions from observed effects alone, confidence notes, or outcome summaries.

### IDs and public summaries

Step IDs are derived deterministically from selected-path order, not timestamps: `step-1`, `step-2`, and so on after normalization and assertion expansion. Public summaries use fixed templates over sanitized structured data. Type summaries mention only the binding and target, never a value. Navigation summaries use sanitized URLs. Source text is generated from the same safe template and is not copied from arbitrary outcome or goal text.

## Determinism And Fingerprints

Compilation is pure. The same validated input produces byte-equivalent plan content.

Two hashes have separate purposes:

- `selectedPathFingerprint` is SHA-256 over a canonical allowlisted projection of the selected attempt IDs, actions, resolved target descriptors, expectations, and matched effect references. It identifies the evidence used by compilation. It excludes timestamps, screenshots, confidence notes, outcome summaries, and unselected records.
- The plan ID uses the existing `plan-<12 hex>` shape but hashes a canonical projection of the sanitized plan target, mode, ordered compiled steps, assertions, and provenance. It does not depend on object key order or wall-clock time.

Approval fingerprints must add the structured assertion and step provenance fields to their canonical step projection. The source script remains excluded as today. Mutating an expected URL, visible condition, expectation origin, normalized action source, or discovery record association after approval therefore produces stale approval evidence.

## Lifecycle

A successful compilation always returns:

- `mode: "validate-first"`;
- `state: "draft"`;
- every step resolved;
- no questions;
- `approvals: { required: true, approved: false }`;
- `execution: { status: "not-started" }`;
- no `validation` payload.

Discovery success is not fresh-context validation. The compiled plan cannot be approved through the validated path until WES-188 replays it and produces blocker-free validation evidence. It also cannot use the best-guess bypass because discovered plans are fixed to `validate-first`.

WES-188 may repair and recompile from a new or child discovery session, but WES-187 itself never mutates an existing plan or session.

## Runtime Input Bindings

The compiler copies only binding identifiers from type actions. Reusing the same binding in multiple selected type actions is valid and means the same runtime value is supplied to each occurrence.

The current execution preflight requires each type step to use a unique binding. WES-187 must narrow that restriction: collect unique required binding keys, validate each supplied value once, and permit repeated steps to reference the same key. Unexpected keys remain errors, and values remain memory-only during execution. This is necessary for compiled routes such as entering the same demo identifier twice; inventing suffixed keys would misrepresent discovery intent.

## Validation And Execution Compatibility

Existing deterministic plans and serialized artifacts remain valid.

- `isWalkthroughPlan()` accepts both source variants, legacy assertions, and structured assertions with strict field/action consistency.
- Sanitization preserves discovery sources, assertions, and provenance and continues to clear approval and execution state where appropriate.
- Review output identifies the plan as discovery-compiled, shows normalized-action warnings, and renders assertion summaries without exposing session internals.
- Browser validation evaluates navigation assertions against the current sanitized URL and visible assertions through the existing accessible matcher. It still owns the later transition from `draft` to `validated` when used directly, though WES-188 will add fresh-context replay and repair orchestration.
- Final execution evaluates navigation assertions without mutating the page and visible assertions through `assertVisible`.
- Refinement preserves or deliberately replaces provenance. Any refinement that changes execution content clears validation and approval as it does today.

No discovery policy permit, disposable declaration, runtime target-risk registry, or input value enters these paths.

## Errors

Compilation returns fixed, transcript-safe errors:

```ts
type DiscoveryPlanCompilationErrorCode =
  | "invalid_discovery_session"
  | "incomplete_discovery_session"
  | "missing_selected_path"
  | "missing_compilation_reference"
  | "unsupported_compilation_action"
  | "unsafe_compilation_content"
  | "invalid_compiled_plan";

type DiscoveryPlanCompilationError = {
  code: DiscoveryPlanCompilationErrorCode;
  message: string;
  attemptId?: string;
  expectationId?: string;
};
```

Messages are fixed strings. Optional IDs must pass the safe discovery identifier rules. Errors never echo labels, conditions, URLs, bindings, goal text, session content, runtime values, or caught exception messages. Expected invalid input returns a result and does not throw. Programmer defects may still throw internally during development, but the public boundary catches and replaces unknown failures with `invalid_compiled_plan`.

`unsupported_compilation_action` is a forward-compatibility guard for a future discovery action kind; all current action kinds have defined mappings.

## Security And Privacy

- Compile only the sanitized value returned by `validateDiscoverySession()`.
- Re-sanitize all URLs and public strings at the walkthrough boundary.
- Resolve target IDs to bounded accessible descriptors and never persist the opaque browser registry or selectors.
- Never invoke an input resolver.
- Never copy confidence notes, outcome summaries, page titles, screenshots, goal text, or abandoned attempts.
- Do not infer disposable authority from evidence that a mutation succeeded.
- Keep approval mandatory and exclude discovered plans from best-guess bypass.
- Include every new execution-relevant field in validation, sanitization, review, refinement, and approval fingerprint coverage.

## Testing Strategy

Tests should treat the compiler and public plan lifecycle as black boxes where practical.

### Compiler behavior

- A completed fixture compiles into the expected ordered action and assertion behavior.
- Abandoned and failed attempts outside the selected path do not appear in the plan.
- Click and type targets compile to accessible hints rather than opaque IDs.
- Type values never appear; binding names do, including safe repeated binding reuse.
- Navigation and visible-state expectations compile in declared-then-derived order.
- `inspect`, `back`, and `refresh` produce the specified semantic normalization and warnings.
- The first selected before-observation supplies the plan target.
- Equivalent repeated compilation yields byte-equivalent output and stable hashes.
- Input objects remain unchanged.

### Failure behavior

- Malformed, active, failed, abandoned, or completed-without-selection sessions fail with fixed errors.
- Missing observations, targets, effects, or expectation references fail closed without throwing.
- Unsafe URLs, secret-like public strings, and malformed bindings do not leak through plan output or errors.
- Future unknown action kinds return `unsupported_compilation_action`.

### Lifecycle compatibility

- Existing deterministic fixtures still validate, sanitize, review, approve, verify, and execute unchanged.
- Discovery sources and provenance survive artifact sanitization.
- A compiled plan is draft, unapproved, and not directly approvable.
- Structured visible and navigation assertions validate and execute through public behavior.
- Changing an assertion or provenance field after approval causes stale fingerprint verification.
- Repeated binding keys require one runtime value and drive every referencing type step.

Repository coverage should include focused compiler tests, walkthrough contract/approval/validation/execution regressions, package typecheck/build, and the normal repository validation commands. Tests must assert public results and user-facing effects rather than private helper calls or internal iteration mechanics.

## Documentation

Update the agent package documentation to show the boundary:

1. discover and complete a safe session;
2. compile its selected path into a draft unapproved plan;
3. replay and repair in WES-188;
4. review and approve;
5. execute approved final capture.

The example must state that compilation does not validate, approve, carry disposable authority, resolve runtime values, or start capture.

## Downstream Contract

WES-188 receives a deterministic draft plan with structured assertions and bounded links back to selected evidence. It owns fresh-context replay, structured failure evidence, bounded repair, recompilation, and the transition to reviewable validation evidence. WES-189 later exposes that flow through the Codex discovery wrapper and explicit approval handoff. WES-191 decides the fate of the legacy deterministic intake path only after the agentic path is proven.
