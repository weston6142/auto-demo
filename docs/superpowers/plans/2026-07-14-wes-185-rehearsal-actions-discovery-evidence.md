# WES-185 Rehearsal Actions And Discovery Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a stateful controller for an existing host-owned Playwright page that authorizes each rehearsal action, records atomic WES-183 attempt evidence, resolves non-secret inputs only at runtime, and explicitly completes or abandons discovery without starting final capture.

**Architecture:** `discoveryRehearsal.ts` owns the public controller, lifecycle, authorization, input resolution, expectation matching, and structured results. A narrow shared-registry driver connects the controller to WES-184 observation extraction, while `playwrightDiscoveryPage.ts` and `playwrightDiscoveryRehearsal.ts` adapt an existing Playwright page without owning its lifecycle. Fake-driver tests cover orchestration as a black box; routed local HTML tests cover actual browser effects and opaque-target behavior.

**Tech Stack:** TypeScript ES modules, Playwright 1.61, Vitest 4, npm workspaces, ESLint, Prettier, Linear CLI.

---

## Approved Inputs

- Design spec: `docs/superpowers/specs/2026-07-14-wes-185-rehearsal-actions-discovery-evidence-design.md`
- Project map: `docs/linear/auto-demo-project-structure.md`
- Linear issue: https://linear.app/weston-bushyeager/issue/WES-185/drive-rehearsal-actions-and-capture-discovery-evidence
- Required dependencies: WES-183 and WES-184 are Done and durable on `develop`.
- Linear state at plan time: WES-185 is In Progress.

## File Map

Create:

- `packages/agent/src/discoveryTargetRegistry.ts` — internal document-scoped mapping between opaque public target IDs and page-local identity keys.
- `packages/agent/src/discoveryRehearsal.ts` — public controller types, state machine, authorization, runtime input resolution, expectation evaluation, retries, stopping, and structured errors.
- `packages/agent/src/discoveryRehearsal.test.ts` — fake-driver black-box tests for controller behavior.
- `packages/agent/src/playwrightDiscoveryPage.ts` — shared Playwright page adapter for WES-184 observation collection and WES-185 low-level action execution.
- `packages/agent/src/playwrightDiscoveryRehearsal.ts` — Playwright rehearsal driver and controller factory for an existing page.
- `packages/agent/src/playwrightDiscoveryRehearsal.test.ts` — routed local HTML behavior tests for real actions, history, target invalidation, branching, and closed-page failure.

Modify:

- `packages/agent/src/discoveryObservation.ts` — use an injectable internal target registry while preserving the public WES-184 extractor contract.
- `packages/agent/src/playwrightDiscoveryObservation.ts` — become a small WES-184-compatible wrapper over the shared Playwright page adapter.
- `packages/agent/src/index.ts` — export the WES-185 controller factories and public types.
- `packages/agent/package.json` — include the two WES-185 test files in the package test command.
- `packages/agent/src/wrapper-docs.test.ts` — assert the host-owned lifecycle, required authorizer/resolver, explicit retry, and no-capture boundaries.
- `packages/agent/README.md` — document the public rehearsal API and security model.
- `README.md` — update the repository-level agentic discovery capability summary.
- `docs/linear/auto-demo-project-structure.md` — record implementation, verification, completion evidence, and the next-task pointer.

The generic controller and Playwright adapter remain separate because orchestration and browser mechanics have different failure modes and test seams. The target registry is internal and receives no direct implementation-detail test; its behavior is covered through public observation and controller results.

### Task 0: Run The WES-185 Implementation Preflight

**Files:**

- Inspect: `docs/superpowers/specs/2026-07-14-wes-185-rehearsal-actions-discovery-evidence-design.md`
- Inspect: `docs/linear/auto-demo-project-structure.md`
- Inspect: `packages/agent/src/discoverySession.ts`
- Inspect: `packages/agent/src/discoveryObservation.ts`
- Inspect: `packages/agent/src/playwrightDiscoveryObservation.ts`

- [ ] **Step 1: Confirm the approved dependencies and branch state**

Run:

```bash
rtk git status --short
rtk git log -5 --oneline --decorate
rtk git log --oneline -- packages/agent/src/discoverySession.ts packages/agent/src/discoveryObservation.ts
```

Expected: `develop` contains WES-183 and WES-184, including merge `44dde68` or a descendant. Preserve the existing unrelated `check-codex-usage` files and `packages/agent/skills/auto-demo-linear-brainstorming/`; do not stage, delete, or rewrite them.

- [ ] **Step 2: Re-run `linear-sync-gate` in `pre-task` mode**

Provide this contract:

```text
mode: pre-task
repository: /Users/weston.bushyeager/code/personal/auto-demo
project map: docs/linear/auto-demo-project-structure.md
Linear project: Auto Demo Balanced MVP
candidate: WES-185
milestone: Agentic Flow Discovery
selection rule: earliest incomplete milestone; prefer started, then dependency-ready work
dependency evidence: WES-183 and WES-184 are Done and durable on develop
```

Expected: WES-185 remains the active dependency-ready issue, WES-186 remains a parallel policy sibling, and WES-187 remains downstream. Stop if Linear or local evidence contradicts that state.

- [ ] **Step 3: Prepare the execution workspace without losing the approved artifacts**

Invoke `superpowers:using-git-worktrees` unless the user explicitly directs implementation in the current checkout. Use the current checkout as the read-only source for the approved spec and this plan. Do not copy unrelated dirty files into the implementation branch.

Expected: product edits begin in a clean WES-185 workspace based on the `develop` commit that contains WES-184. The approved spec and plan remain readable from their current absolute paths until they are added to the implementation branch deliberately.

### Task 1: Define The Controller Contract And Start Lifecycle

**Files:**

- Create: `packages/agent/src/discoveryRehearsal.ts`
- Create: `packages/agent/src/discoveryRehearsal.test.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/package.json`

- [ ] **Step 1: Write the failing start and snapshot tests**

Create `packages/agent/src/discoveryRehearsal.test.ts` with deterministic helpers and the first public behavior:

```ts
import { describe, expect, it } from "vitest";
import {
  createDiscoveryRehearsalController,
  type DiscoveryActionAuthorization,
  type DiscoveryActionAuthorizer,
  type DiscoveryInputResolver,
  type DiscoveryRehearsalDriver,
} from "./index.js";

const initialObservation = {
  id: "observation-1",
  observedAt: "2026-07-14T12:00:01.000Z",
  page: {
    url: "https://example.test/start",
    title: "Start",
    viewport: { width: 1280, height: 720 },
    navigation: { canGoBack: false },
  },
  visibleStates: [{ id: "visible-start", kind: "text" as const, summary: "Ready" }],
  interactiveTargets: [{ id: "target-next", label: "Next", role: "button", disabled: false }],
  artifacts: [],
};

function dependencies() {
  const driver: DiscoveryRehearsalDriver<{ policy: "test" }> = {
    async observe() {
      return { ok: true as const, observation: initialObservation, diagnostics: [] };
    },
    async hasLiveTarget() {
      return true;
    },
    async execute() {
      return { ok: true as const, code: "action_completed", summary: "Action completed." };
    },
    async isAvailable() {
      return true;
    },
  };
  const authorizer: DiscoveryActionAuthorizer<{ policy: "test" }> = {
    async authorize(): Promise<DiscoveryActionAuthorization<{ policy: "test" }>> {
      return { decision: "allow", permit: { policy: "test" } };
    },
  };
  const inputResolver: DiscoveryInputResolver = {
    async resolve() {
      return { ok: true, value: "demo value" };
    },
  };
  const times = [
    "2026-07-14T12:00:00.000Z",
    "2026-07-14T12:00:02.000Z",
    "2026-07-14T12:00:05.000Z",
    "2026-07-14T12:00:08.000Z",
    "2026-07-14T12:00:11.000Z",
    "2026-07-14T12:00:14.000Z",
  ];
  let nextAttempt = 1;
  return {
    driver,
    authorizer,
    inputResolver,
    clock: () => times.shift() ?? "2026-07-14T12:00:20.000Z",
    idGenerator: () => `attempt-${nextAttempt++}`,
  };
}

describe("createDiscoveryRehearsalController", () => {
  it("starts by creating a session and recording one bounded observation", async () => {
    const controller = createDiscoveryRehearsalController(dependencies());
    const result = await controller.start({
      id: "session-1",
      target: { kind: "browser", startUrl: "https://example.test/start" },
      goal: "Show the next screen",
      host: { name: "codex", version: "1.0.0" },
    });

    expect(result).toMatchObject({
      ok: true,
      session: {
        id: "session-1",
        status: "active",
        createdAt: "2026-07-14T12:00:00.000Z",
        observations: [{ id: "observation-1", sequence: 1 }],
      },
      observation: { id: "observation-1", sequence: 1 },
      diagnostics: [],
    });
    expect(controller.getSession()).toEqual(result.ok ? result.session : undefined);
  });

  it("remains unstarted when the initial observation fails", async () => {
    const deps = dependencies();
    deps.driver.observe = async () => ({
      ok: false,
      errors: [{ code: "browser_unavailable", message: "Browser unavailable." }],
    });
    const controller = createDiscoveryRehearsalController(deps);
    const result = await controller.start({
      id: "session-1",
      target: { kind: "browser", startUrl: "https://example.test/start" },
      goal: "Show the next screen",
      host: { name: "codex", version: "1.0.0" },
    });

    expect(result).toMatchObject({ ok: false, errors: [{ code: "browser_unavailable" }] });
    expect(controller.getSession()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Register the test and verify the red state**

Append `src/discoveryRehearsal.test.ts` to the `test` script in `packages/agent/package.json`, then run:

```bash
rtk npm --workspace @auto-demo/agent test -- src/discoveryRehearsal.test.ts
```

Expected: FAIL because the controller factory and public types are not exported.

- [ ] **Step 3: Add the public contracts and minimal start implementation**

Create `packages/agent/src/discoveryRehearsal.ts` with these public contracts:

```ts
import type {
  DiscoveryAction,
  DiscoveryAttempt,
  DiscoveryConfidence,
  DiscoveryExpectation,
  DiscoveryInteractiveTarget,
  DiscoveryObservation,
  DiscoverySessionV1,
} from "./discoveryContract.js";
import {
  createDiscoverySession,
  recordDiscoveryObservation,
  type CreateDiscoverySessionInput,
} from "./discoverySession.js";
import type {
  DiscoveryObservationDiagnostic,
  DiscoveryObservationExtractionResult,
} from "./discoveryObservation.js";

export type DiscoveryRehearsalStartInput = Omit<CreateDiscoverySessionInput, "createdAt">;

export type DiscoveryActionAuthorization<TPermit> =
  | { decision: "allow"; permit: TPermit }
  | { decision: "block"; reason: { code: string; summary: string } };

export interface DiscoveryActionAuthorizer<TPermit> {
  authorize(input: {
    session: DiscoverySessionV1;
    observation: DiscoveryObservation;
    action: DiscoveryAction;
    target?: DiscoveryInteractiveTarget;
  }): Promise<DiscoveryActionAuthorization<TPermit>>;
}

export interface DiscoveryInputResolver {
  resolve(
    inputBinding: string,
  ): Promise<
    { ok: true; value: string } | { ok: false; code: "input_binding_unavailable"; summary: string }
  >;
}

export type DiscoveryRehearsalDriverResult =
  | { ok: true; code: string; summary: string }
  | { ok: false; code: string; summary: string; recoverable: boolean };

export interface DiscoveryRehearsalDriver<TPermit> {
  observe(): Promise<DiscoveryObservationExtractionResult>;
  hasLiveTarget(targetId: string): Promise<boolean>;
  execute(input: {
    action: DiscoveryAction;
    permit: TPermit;
    resolvedValue?: string;
  }): Promise<DiscoveryRehearsalDriverResult>;
  isAvailable(): Promise<boolean>;
}

export type DiscoveryRehearsalActionInput = {
  action: DiscoveryAction;
  expectations: DiscoveryExpectation[];
  confidence: DiscoveryConfidence;
  retryOfAttemptId?: string;
};

export type DiscoveryRehearsalError = {
  code: string;
  message: string;
  recordId?: string;
};

export type DiscoveryRehearsalResult =
  | {
      ok: true;
      session: DiscoverySessionV1;
      observation?: DiscoveryObservation;
      attempt?: DiscoveryAttempt;
      diagnostics: DiscoveryObservationDiagnostic[];
    }
  | { ok: false; session?: DiscoverySessionV1; errors: DiscoveryRehearsalError[] };
```

Add `createDiscoveryRehearsalController()` with `start()` and `getSession()`:

```ts
export function createDiscoveryRehearsalController<TPermit>(dependencies: {
  driver: DiscoveryRehearsalDriver<TPermit>;
  authorizer: DiscoveryActionAuthorizer<TPermit>;
  inputResolver: DiscoveryInputResolver;
  clock?: () => string;
  idGenerator?: () => string;
}) {
  const clock = dependencies.clock ?? (() => new Date().toISOString());
  let current: DiscoverySessionV1 | undefined;
  let busy = false;

  const getSession = () => (current === undefined ? undefined : structuredClone(current));

  const start = async (input: DiscoveryRehearsalStartInput): Promise<DiscoveryRehearsalResult> => {
    if (busy)
      return {
        ok: false,
        errors: [{ code: "discovery_controller_busy", message: "Discovery controller is busy." }],
      };
    if (current !== undefined)
      return {
        ok: false,
        session: getSession(),
        errors: [
          {
            code: "discovery_controller_already_started",
            message: "Discovery controller already started.",
          },
        ],
      };
    busy = true;
    try {
      const created = createDiscoverySession({ ...input, createdAt: clock() });
      if (!created.ok) return { ok: false, errors: created.errors };
      let observed: DiscoveryObservationExtractionResult;
      try {
        observed = await dependencies.driver.observe();
      } catch {
        return {
          ok: false,
          errors: [
            { code: "page_evaluation_failed", message: "Initial discovery observation failed." },
          ],
        };
      }
      if (!observed.ok) return { ok: false, errors: observed.errors };
      const recorded = recordDiscoveryObservation(created.session, observed.observation);
      if (!recorded.ok) return { ok: false, errors: recorded.errors };
      current = recorded.session;
      return {
        ok: true,
        session: structuredClone(current),
        observation: structuredClone(current.observations.at(-1)),
        diagnostics: observed.diagnostics,
      };
    } finally {
      busy = false;
    }
  };

  return { start, getSession };
}
```

Export the factory and public types from `packages/agent/src/index.ts`.

- [ ] **Step 4: Run the focused test and typecheck**

```bash
rtk npm --workspace @auto-demo/agent test -- src/discoveryRehearsal.test.ts
rtk npm --workspace @auto-demo/agent run typecheck
```

Expected: both start tests PASS and typecheck exits 0.

- [ ] **Step 5: Commit the controller foundation**

```bash
rtk git add packages/agent/src/discoveryRehearsal.ts packages/agent/src/discoveryRehearsal.test.ts packages/agent/src/index.ts packages/agent/package.json
rtk git commit -m "feat: define discovery rehearsal controller"
```

### Task 2: Record Authorized And Blocked Attempts Atomically

**Files:**

- Modify: `packages/agent/src/discoveryRehearsal.ts`
- Modify: `packages/agent/src/discoveryRehearsal.test.ts`

- [ ] **Step 1: Write failing blocked-action behavior tests**

Add tests proving authorization happens before input resolution or page effects:

```ts
it("records a blocked action without executing or resolving input", async () => {
  const deps = dependencies();
  let executed = 0;
  let resolved = 0;
  deps.driver.execute = async () => {
    executed += 1;
    return { ok: true, code: "action_completed", summary: "Action completed." };
  };
  deps.inputResolver.resolve = async () => {
    resolved += 1;
    return { ok: true, value: "must-not-be-read" };
  };
  deps.authorizer.authorize = async () => ({
    decision: "block",
    reason: { code: "credential_target", summary: "Credential input is blocked." },
  });
  const times = [
    "2026-07-14T12:00:00.000Z",
    "2026-07-14T12:00:02.000Z",
    "2026-07-14T12:00:03.000Z",
  ];
  deps.clock = () => times.shift() ?? "2026-07-14T12:00:04.000Z";
  const controller = createDiscoveryRehearsalController(deps);
  await controller.start({
    id: "session-1",
    target: { kind: "browser", startUrl: "https://example.test/start" },
    goal: "Fill the form",
    host: { name: "codex", version: "1.0.0" },
  });

  const result = await controller.perform({
    action: {
      kind: "type",
      targetId: "target-next",
      inputBinding: "demo-name",
      valueClass: "demo-data",
    },
    expectations: [],
    confidence: { level: "high", bases: ["exact-accessible-target"] },
  });

  expect(result).toMatchObject({
    ok: true,
    attempt: { status: "blocked", outcome: { code: "credential_target" } },
    session: { attempts: [{ status: "blocked" }] },
  });
  expect(executed).toBe(0);
  expect(resolved).toBe(0);
  expect(JSON.stringify(result)).not.toContain("must-not-be-read");
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

```bash
rtk npm --workspace @auto-demo/agent test -- src/discoveryRehearsal.test.ts
```

Expected: FAIL because `perform()` does not exist.

- [ ] **Step 3: Add the authorization and blocked-attempt path**

Import `beginDiscoveryAttempt` and `finishDiscoveryAttempt`. Add a `perform()` method that validates active state, locates the current observation and optional target, obtains authorization, begins one attempt, and finalizes block decisions:

```ts
const latestObservation = (session: DiscoverySessionV1) => session.observations.at(-1);

const perform = async (input: DiscoveryRehearsalActionInput): Promise<DiscoveryRehearsalResult> => {
  if (busy)
    return {
      ok: false,
      session: getSession(),
      errors: [{ code: "discovery_controller_busy", message: "Discovery controller is busy." }],
    };
  if (current === undefined)
    return {
      ok: false,
      errors: [
        {
          code: "discovery_controller_not_started",
          message: "Discovery controller is not started.",
        },
      ],
    };
  if (current.status !== "active")
    return {
      ok: false,
      session: getSession(),
      errors: [{ code: "terminal_discovery_session", message: "Discovery session is terminal." }],
    };
  busy = true;
  try {
    const before = latestObservation(current);
    if (before === undefined)
      return {
        ok: false,
        session: getSession(),
        errors: [
          {
            code: "invalid_discovery_rehearsal_input",
            message: "Discovery observation is missing.",
          },
        ],
      };
    const targetId =
      input.action.kind === "click" || input.action.kind === "type"
        ? input.action.targetId
        : undefined;
    const target =
      targetId === undefined
        ? undefined
        : before.interactiveTargets.find((candidate) => candidate.id === targetId);
    let authorization: DiscoveryActionAuthorization<TPermit>;
    try {
      authorization = await dependencies.authorizer.authorize({
        session: structuredClone(current),
        observation: structuredClone(before),
        action: structuredClone(input.action),
        target: target === undefined ? undefined : structuredClone(target),
      });
    } catch {
      return {
        ok: false,
        session: getSession(),
        errors: [
          {
            code: "discovery_authorization_failed",
            message: "Discovery action authorization failed.",
          },
        ],
      };
    }
    const attemptId = dependencies.idGenerator?.() ?? `attempt-${randomUUID()}`;
    const begun = beginDiscoveryAttempt(current, {
      id: attemptId,
      startedAt: clock(),
      beforeObservationId: before.id,
      action: input.action,
      expectations: input.expectations,
      confidence: input.confidence,
      ...(input.retryOfAttemptId === undefined ? {} : { retryOfAttemptId: input.retryOfAttemptId }),
    });
    if (!begun.ok) return { ok: false, session: getSession(), errors: begun.errors };
    current = begun.session;
    if (authorization.decision === "block") {
      const finished = finishDiscoveryAttempt(current, attemptId, {
        status: "blocked",
        finishedAt: clock(),
        derivedExpectations: [],
        observedEffects: [],
        outcome: authorization.reason,
      });
      if (!finished.ok) return { ok: false, session: getSession(), errors: finished.errors };
      current = finished.session;
      return {
        ok: true,
        session: structuredClone(current),
        attempt: structuredClone(current.attempts.at(-1)),
        diagnostics: [],
      };
    }
    return await performAllowed(input, attemptId, authorization.permit);
  } finally {
    busy = false;
  }
};
```

Import `randomUUID` from `node:crypto` and return `perform` from the factory. Continue directly through Task 3 before running typecheck or committing so the referenced `performAllowed()` path is implemented in the same red-green batch. Do not export or commit a partially functional allow path.

- [ ] **Step 4: Run the blocked test and commit only after the allow-path stub is removed by Task 3**

Do not commit Task 2 independently. Continue directly to Task 3 so every commit supports both allow and block decisions without a deliberately throwing product path.

### Task 3: Execute Allowed Actions, Resolve Inputs, And Evaluate Evidence

**Files:**

- Modify: `packages/agent/src/discoveryRehearsal.ts`
- Modify: `packages/agent/src/discoveryRehearsal.test.ts`

- [ ] **Step 1: Write failing allowed click, type, inspect, and expectation tests**

Add behavior tests that assert browser effects and returned artifacts rather than dependency call order:

```ts
it("executes an allowed type with a runtime-only value and records matched evidence", async () => {
  const deps = dependencies();
  let driverValue: string | undefined;
  deps.driver.execute = async (input) => {
    driverValue = input.resolvedValue;
    return { ok: true, code: "action_completed", summary: "Action completed." };
  };
  const observations = [
    initialObservation,
    {
      ...initialObservation,
      id: "observation-2",
      observedAt: "2026-07-14T12:00:04.000Z",
      visibleStates: [{ id: "visible-done", kind: "status" as const, summary: "Saved" }],
    },
  ];
  deps.driver.observe = async () => ({
    ok: true,
    observation: observations.shift()!,
    diagnostics: [],
  });
  const controller = createDiscoveryRehearsalController(deps);
  await controller.start({
    id: "session-1",
    target: { kind: "browser", startUrl: "https://example.test/start" },
    goal: "Save demo data",
    host: { name: "codex", version: "1.0.0" },
  });
  const result = await controller.perform({
    action: {
      kind: "type",
      targetId: "target-next",
      inputBinding: "demo-name",
      valueClass: "demo-data",
    },
    expectations: [
      {
        id: "expect-saved",
        kind: "visible-state",
        origin: "declared-before-action",
        publicCondition: "Saved",
      },
    ],
    confidence: { level: "high", bases: ["expected-visible-state-observed"] },
  });

  expect(driverValue).toBe("demo value");
  expect(result).toMatchObject({
    ok: true,
    attempt: {
      status: "succeeded",
      observedEffects: [
        { expectationId: "expect-saved", status: "matched", observationId: "observation-2" },
      ],
    },
  });
  expect(JSON.stringify(result)).not.toContain("demo value");
});

it("records an expectation mismatch as a failed attempt", async () => {
  const deps = dependencies();
  const observations = [
    initialObservation,
    { ...initialObservation, id: "observation-2", observedAt: "2026-07-14T12:00:04.000Z" },
  ];
  deps.driver.observe = async () => ({
    ok: true,
    observation: observations.shift()!,
    diagnostics: [],
  });
  const controller = createDiscoveryRehearsalController(deps);
  await controller.start({
    id: "session-1",
    target: { kind: "browser", startUrl: "https://example.test/start" },
    goal: "Find completion",
    host: { name: "codex", version: "1.0.0" },
  });
  const result = await controller.perform({
    action: { kind: "inspect" },
    expectations: [
      {
        id: "expect-complete",
        kind: "visible-state",
        origin: "declared-before-action",
        publicCondition: "Complete",
      },
    ],
    confidence: { level: "medium", bases: ["host-inference"] },
  });
  expect(result).toMatchObject({
    ok: true,
    attempt: { status: "failed", outcome: { code: "expectation_unmatched" } },
  });
});
```

- [ ] **Step 2: Run the focused test to verify the new cases fail**

```bash
rtk npm --workspace @auto-demo/agent test -- src/discoveryRehearsal.test.ts
```

Expected: blocked behavior may pass, while allowed execution and expectation tests FAIL.

- [ ] **Step 3: Implement deterministic expectation evaluation**

Add pure helpers to `discoveryRehearsal.ts`:

```ts
import { matchesNavigationExpectation } from "./discoveryValidation.js";
import type { DiscoveryObservedEffect } from "./discoveryContract.js";

const normalizePublicCondition = (value: string) => value.trim().replace(/\s+/g, " ");

function evaluateExpectations(
  expectations: DiscoveryExpectation[],
  observation: DiscoveryObservation,
): DiscoveryObservedEffect[] {
  return expectations.map((expectation) => {
    const matched =
      expectation.kind === "navigation"
        ? matchesNavigationExpectation(expectation, observation.page.url)
        : expectation.targetId !== undefined
          ? observation.visibleStates.some((state) => state.id === expectation.targetId) ||
            observation.interactiveTargets.some((target) => target.id === expectation.targetId)
          : expectation.publicCondition !== undefined &&
            [
              ...observation.visibleStates.map((state) => state.summary),
              ...observation.interactiveTargets.map((target) => target.label),
            ].some(
              (value) =>
                normalizePublicCondition(value) ===
                normalizePublicCondition(expectation.publicCondition!),
            );
    return {
      expectationId: expectation.id,
      status: matched ? "matched" : "not-matched",
      observationId: observation.id,
      summary: matched
        ? "Expected page evidence matched."
        : "Expected page evidence did not match.",
    };
  });
}
```

- [ ] **Step 4: Implement the complete allowed-action path**

Add `performAllowed()` inside the factory so it can update `current`:

```ts
const performAllowed = async (
  input: DiscoveryRehearsalActionInput,
  attemptId: string,
  permit: TPermit,
): Promise<DiscoveryRehearsalResult> => {
  let resolvedValue: string | undefined;
  if (input.action.kind === "back" && !latestObservation(current!)!.page.navigation.canGoBack) {
    return finalizeRecoverableFailure(
      attemptId,
      "back_unavailable",
      "Discovery back navigation is unavailable.",
    );
  }
  if (input.action.kind === "click" || input.action.kind === "type") {
    if (!(await dependencies.driver.hasLiveTarget(input.action.targetId))) {
      return finalizeRecoverableFailure(
        attemptId,
        "target_stale",
        "Discovery target is no longer live.",
      );
    }
  }
  if (input.action.kind === "type") {
    let resolved: Awaited<ReturnType<DiscoveryInputResolver["resolve"]>>;
    try {
      resolved = await dependencies.inputResolver.resolve(input.action.inputBinding);
    } catch {
      return finalizeRecoverableFailure(
        attemptId,
        "input_resolution_failed",
        "Discovery input could not be resolved.",
      );
    }
    if (!resolved.ok)
      return finalizeRecoverableFailure(
        attemptId,
        resolved.code,
        "Discovery input could not be resolved.",
      );
    resolvedValue = resolved.value;
  }
  let executed: DiscoveryRehearsalDriverResult;
  try {
    executed = await dependencies.driver.execute({
      action: input.action,
      permit,
      ...(resolvedValue === undefined ? {} : { resolvedValue }),
    });
  } catch {
    executed = {
      ok: false,
      code: "action_failed",
      summary: "Discovery action failed.",
      recoverable: await dependencies.driver.isAvailable().catch(() => false),
    };
  } finally {
    resolvedValue = undefined;
  }
  if (!executed.ok && !executed.recoverable) return failForUnavailableBrowser(attemptId);
  let observed: DiscoveryObservationExtractionResult;
  try {
    observed = await dependencies.driver.observe();
  } catch {
    if (!(await dependencies.driver.isAvailable().catch(() => false)))
      return failForUnavailableBrowser(attemptId);
    return finalizeRecoverableFailure(
      attemptId,
      "observation_failed",
      "Discovery result could not be observed.",
    );
  }
  if (!observed.ok) {
    if (observed.errors.some((error) => error.code === "browser_unavailable"))
      return failForUnavailableBrowser(attemptId);
    return finalizeRecoverableFailure(
      attemptId,
      "observation_failed",
      "Discovery result could not be observed.",
    );
  }
  const recorded = recordDiscoveryObservation(current!, observed.observation);
  if (!recorded.ok) return { ok: false, session: getSession(), errors: recorded.errors };
  current = recorded.session;
  const after = current.observations.at(-1)!;
  const effects = evaluateExpectations(input.expectations, after);
  const matched = effects.every((effect) => effect.status === "matched");
  const finished = finishDiscoveryAttempt(current, attemptId, {
    status: executed.ok && matched ? "succeeded" : "failed",
    finishedAt: clock(),
    derivedExpectations: [],
    observedEffects: effects,
    afterObservationId: after.id,
    outcome:
      executed.ok && matched
        ? { code: executed.code, summary: executed.summary }
        : !executed.ok
          ? { code: executed.code, summary: executed.summary }
          : { code: "expectation_unmatched", summary: "Discovery expectation did not match." },
  });
  if (!finished.ok) return { ok: false, session: getSession(), errors: finished.errors };
  current = finished.session;
  return {
    ok: true,
    session: structuredClone(current),
    observation: structuredClone(after),
    attempt: structuredClone(current.attempts.at(-1)),
    diagnostics: observed.diagnostics,
  };
};
```

Add the recoverable finalizer used above:

```ts
const finalizeRecoverableFailure = (
  attemptId: string,
  code: string,
  summary: string,
): DiscoveryRehearsalResult => {
  const finished = finishDiscoveryAttempt(current!, attemptId, {
    status: "failed",
    finishedAt: clock(),
    derivedExpectations: [],
    observedEffects: [],
    outcome: { code, summary },
  });
  if (!finished.ok) return { ok: false, session: getSession(), errors: finished.errors };
  current = finished.session;
  return {
    ok: true,
    session: structuredClone(current),
    attempt: structuredClone(current.attempts.at(-1)),
    diagnostics: [],
  };
};
```

`failForUnavailableBrowser()` is added in Task 4 because it introduces the terminal failure transition.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
rtk npm --workspace @auto-demo/agent test -- src/discoveryRehearsal.test.ts
rtk npm --workspace @auto-demo/agent run typecheck
```

Expected: start, block, allowed input, matched evidence, and mismatch tests PASS; typecheck exits 0.

- [ ] **Step 6: Commit atomic action recording**

```bash
rtk git add packages/agent/src/discoveryRehearsal.ts packages/agent/src/discoveryRehearsal.test.ts
rtk git commit -m "feat: record authorized discovery actions"
```

### Task 4: Handle Explicit Retries, Concurrency, And Browser Loss

**Files:**

- Modify: `packages/agent/src/discoveryRehearsal.ts`
- Modify: `packages/agent/src/discoveryRehearsal.test.ts`

- [ ] **Step 1: Add failing stale-target, retry, browser-loss, and busy tests**

Add these black-box cases:

```ts
it("records a stale target once and requires an explicit linked retry", async () => {
  const deps = dependencies();
  let live = false;
  const observations = [
    initialObservation,
    { ...initialObservation, id: "observation-2", observedAt: "2026-07-14T12:00:10.000Z" },
  ];
  deps.driver.observe = async () => ({
    ok: true,
    observation: observations.shift()!,
    diagnostics: [],
  });
  deps.driver.hasLiveTarget = async () => live;
  const controller = createDiscoveryRehearsalController(deps);
  await controller.start({
    id: "session-1",
    target: { kind: "browser", startUrl: "https://example.test/start" },
    goal: "Continue",
    host: { name: "codex", version: "1.0.0" },
  });
  const first = await controller.perform({
    action: { kind: "click", targetId: "target-next" },
    expectations: [],
    confidence: { level: "medium", bases: ["exact-accessible-target"] },
  });
  expect(first).toMatchObject({
    ok: true,
    attempt: { status: "failed", outcome: { code: "target_stale" } },
  });
  live = true;
  const retried = await controller.perform({
    action: { kind: "click", targetId: "target-next" },
    expectations: [],
    confidence: { level: "medium", bases: ["exact-accessible-target"] },
    retryOfAttemptId: "attempt-1",
  });
  expect(retried).toMatchObject({ ok: true, attempt: { retryOfAttemptId: "attempt-1" } });
});

it("rejects a concurrent action instead of queuing it", async () => {
  const deps = dependencies();
  let release!: () => void;
  deps.driver.execute = async () =>
    await new Promise((resolve) => {
      release = () => resolve({ ok: true, code: "action_completed", summary: "Action completed." });
    });
  const controller = createDiscoveryRehearsalController(deps);
  await controller.start({
    id: "session-1",
    target: { kind: "browser", startUrl: "https://example.test/start" },
    goal: "Inspect",
    host: { name: "codex", version: "1.0.0" },
  });
  const first = controller.perform({
    action: { kind: "inspect" },
    expectations: [],
    confidence: { level: "high", bases: ["host-inference"] },
  });
  await Promise.resolve();
  const second = await controller.perform({
    action: { kind: "inspect" },
    expectations: [],
    confidence: { level: "high", bases: ["host-inference"] },
  });
  expect(second).toMatchObject({ ok: false, errors: [{ code: "discovery_controller_busy" }] });
  release();
  await first;
});
```

Add the unrecoverable browser case:

```ts
it("fails the session without a pending attempt when the browser is lost", async () => {
  const deps = dependencies();
  deps.driver.execute = async () => ({
    ok: false,
    code: "browser_unavailable",
    summary: "token=abcdefghijklmnopqrstuvwx1234",
    recoverable: false,
  });
  deps.driver.isAvailable = async () => false;
  const controller = createDiscoveryRehearsalController(deps);
  await controller.start({
    id: "session-1",
    target: { kind: "browser", startUrl: "https://example.test/start" },
    goal: "Inspect",
    host: { name: "codex", version: "1.0.0" },
  });
  const result = await controller.perform({
    action: { kind: "inspect" },
    expectations: [],
    confidence: { level: "high", bases: ["host-inference"] },
  });
  expect(result).toMatchObject({
    ok: true,
    session: {
      status: "failed",
      terminal: { status: "failed", reason: { code: "browser_unavailable" } },
    },
  });
  if (!result.ok) throw new Error("terminal failure must be recorded");
  expect(result.session.attempts.some((attempt) => attempt.status === "pending")).toBe(false);
  expect(JSON.stringify(result)).not.toContain("abcdefghijklmnopqrstuvwx1234");
});
```

- [ ] **Step 2: Run the focused test to verify the new failures**

```bash
rtk npm --workspace @auto-demo/agent test -- src/discoveryRehearsal.test.ts
```

Expected: stale target may pass after Task 3, while retry IDs, busy timing, and terminal browser-loss behavior FAIL.

- [ ] **Step 3: Finalize pending attempts before terminal browser failure**

Import `failDiscoverySession`. Add this exact helper inside the controller factory:

```ts
const failForUnavailableBrowser = async (attemptId: string): Promise<DiscoveryRehearsalResult> => {
  const finalized = finishDiscoveryAttempt(current!, attemptId, {
    status: "failed",
    finishedAt: clock(),
    derivedExpectations: [],
    observedEffects: [],
    outcome: { code: "browser_unavailable", summary: "Discovery browser is unavailable." },
  });
  if (!finalized.ok) return { ok: false, session: getSession(), errors: finalized.errors };
  const failed = failDiscoverySession(finalized.session, {
    failedAt: clock(),
    reason: { code: "browser_unavailable", summary: "Discovery browser is unavailable." },
  });
  if (!failed.ok)
    return { ok: false, session: structuredClone(finalized.session), errors: failed.errors };
  current = failed.session;
  return {
    ok: true,
    session: structuredClone(current),
    attempt: structuredClone(current.attempts.at(-1)),
    diagnostics: [],
  };
};
```

Keep the single in-flight guard as an immediate rejection. Do not add a queue. Let `beginDiscoveryAttempt()` validate `retryOfAttemptId` against the existing WES-183 rules; return its structured errors without rewriting the prior attempt.

- [ ] **Step 4: Add security regressions for resolver and dependency failures**

Add a table-driven dependency sanitization regression:

```ts
it.each(["authorizer", "resolver", "driver", "observer"] as const)(
  "sanitizes %s failures",
  async (failure) => {
    const deps = dependencies();
    const controller = createDiscoveryRehearsalController(deps);
    await controller.start({
      id: "session-1",
      target: { kind: "browser", startUrl: "https://example.test/start" },
      goal: "Inspect",
      host: { name: "codex", version: "1.0.0" },
    });
    if (failure === "authorizer")
      deps.authorizer.authorize = async () => {
        throw new Error("token=abcdefghijklmnopqrstuvwx1234");
      };
    if (failure === "resolver")
      deps.inputResolver.resolve = async () => {
        throw new Error("token=abcdefghijklmnopqrstuvwx1234");
      };
    if (failure === "driver")
      deps.driver.execute = async () => {
        throw new Error("token=abcdefghijklmnopqrstuvwx1234");
      };
    if (failure === "observer")
      deps.driver.observe = async () => {
        throw new Error("token=abcdefghijklmnopqrstuvwx1234");
      };
    const input =
      failure === "resolver"
        ? {
            action: {
              kind: "type" as const,
              targetId: "target-next",
              inputBinding: "demo-name",
              valueClass: "demo-data" as const,
            },
            expectations: [],
            confidence: { level: "high" as const, bases: ["exact-accessible-target" as const] },
          }
        : {
            action: { kind: "inspect" as const },
            expectations: [],
            confidence: { level: "high" as const, bases: ["host-inference" as const] },
          };
    const beforeCount = controller.getSession()?.attempts.length;
    const result = await controller.perform(input);
    expect(JSON.stringify(result)).not.toContain("abcdefghijklmnopqrstuvwx1234");
    if (failure === "authorizer")
      expect(controller.getSession()?.attempts.length).toBe(beforeCount);
    if (failure === "resolver")
      expect(controller.getSession()?.attempts.at(-1)).toMatchObject({ status: "failed" });
  },
);
```

- [ ] **Step 5: Run focused tests and typecheck**

```bash
rtk npm --workspace @auto-demo/agent test -- src/discoveryRehearsal.test.ts
rtk npm --workspace @auto-demo/agent run typecheck
```

Expected: all controller tests PASS with no pending attempts after any returned result; typecheck exits 0.

- [ ] **Step 6: Commit retry and failure behavior**

```bash
rtk git add packages/agent/src/discoveryRehearsal.ts packages/agent/src/discoveryRehearsal.test.ts
rtk git commit -m "feat: handle discovery retries and failures"
```

### Task 5: Complete Or Abandon Explicitly

**Files:**

- Modify: `packages/agent/src/discoveryRehearsal.ts`
- Modify: `packages/agent/src/discoveryRehearsal.test.ts`

- [ ] **Step 1: Write failing completion, branch exclusion, and abandonment tests**

Add complete public helpers that produce an active session and an explored branch:

```ts
async function startedController() {
  const controller = createDiscoveryRehearsalController(dependencies());
  const started = await controller.start({
    id: "session-1",
    target: { kind: "browser", startUrl: "https://example.test/start" },
    goal: "Find success",
    host: { name: "codex", version: "1.0.0" },
  });
  if (!started.ok) throw new Error("start fixture must succeed");
  return controller;
}

async function controllerWithExploredBranch() {
  const deps = dependencies();
  const observations = [
    initialObservation,
    {
      ...initialObservation,
      id: "observation-wrong",
      observedAt: "2026-07-14T12:00:03.000Z",
      visibleStates: [{ id: "visible-wrong", kind: "text" as const, summary: "Wrong route" }],
    },
    { ...initialObservation, id: "observation-returned", observedAt: "2026-07-14T12:00:06.000Z" },
    {
      ...initialObservation,
      id: "observation-success",
      observedAt: "2026-07-14T12:00:09.000Z",
      visibleStates: [{ id: "visible-success", kind: "status" as const, summary: "Success" }],
    },
    {
      ...initialObservation,
      id: "observation-inspected",
      observedAt: "2026-07-14T12:00:12.000Z",
      visibleStates: [{ id: "visible-success", kind: "status" as const, summary: "Success" }],
    },
  ];
  const executions: DiscoveryRehearsalDriverResult[] = [
    { ok: false, code: "wrong_route", summary: "Wrong route.", recoverable: true },
    { ok: true, code: "action_completed", summary: "Action completed." },
    { ok: true, code: "action_completed", summary: "Action completed." },
    { ok: true, code: "action_completed", summary: "Action completed." },
  ];
  deps.driver.observe = async () => ({
    ok: true,
    observation: observations.shift()!,
    diagnostics: [],
  });
  deps.driver.execute = async () => executions.shift()!;
  const times = [
    "2026-07-14T12:00:00.000Z",
    "2026-07-14T12:00:02.000Z",
    "2026-07-14T12:00:04.000Z",
    "2026-07-14T12:00:05.000Z",
    "2026-07-14T12:00:07.000Z",
    "2026-07-14T12:00:08.000Z",
    "2026-07-14T12:00:10.000Z",
    "2026-07-14T12:00:11.000Z",
    "2026-07-14T12:00:13.000Z",
    "2026-07-14T12:00:14.000Z",
    "2026-07-14T12:00:15.000Z",
  ];
  deps.clock = () => times.shift()!;
  const controller = createDiscoveryRehearsalController(deps);
  await controller.start({
    id: "session-1",
    target: { kind: "browser", startUrl: "https://example.test/start" },
    goal: "Find success",
    host: { name: "codex", version: "1.0.0" },
  });
  await controller.perform({
    action: { kind: "click", targetId: "target-next" },
    expectations: [],
    confidence: { level: "medium", bases: ["host-inference"] },
  });
  await controller.perform({
    action: { kind: "back" },
    expectations: [],
    confidence: { level: "high", bases: ["host-inference"] },
  });
  await controller.perform({
    action: { kind: "click", targetId: "target-next" },
    expectations: [],
    confidence: { level: "high", bases: ["exact-accessible-target"] },
  });
  await controller.perform({
    action: { kind: "inspect" },
    expectations: [
      {
        id: "expect-success",
        kind: "visible-state",
        origin: "declared-before-action",
        publicCondition: "Success",
      },
    ],
    confidence: { level: "high", bases: ["expected-visible-state-observed"] },
  });
  return controller;
}
```

Then add:

```ts
it("completes only an explicitly selected continuous successful path", async () => {
  const controller = await controllerWithExploredBranch();
  const result = await controller.stop({
    outcome: "complete",
    attemptIds: ["attempt-3", "attempt-4"],
    source: "host-agent",
  });
  expect(result).toMatchObject({
    ok: true,
    session: {
      status: "completed",
      selectedPath: { attemptIds: ["attempt-3", "attempt-4"] },
      terminal: { status: "completed" },
    },
  });
  if (!result.ok) throw new Error("completion must succeed");
  expect(result.session.selectedPath?.attemptIds).not.toContain("attempt-1");
});

it("abandons explicitly and preserves evidence", async () => {
  const controller = await startedController();
  const result = await controller.stop({
    outcome: "abandon",
    reason: { code: "user_stopped", summary: "User stopped discovery." },
  });
  expect(result).toMatchObject({
    ok: true,
    session: { status: "abandoned", terminal: { status: "abandoned" } },
  });
});
```

Also assert an invalid completion path returns `ok: false` and leaves the controller active, and all later `perform()` or `stop()` calls after a valid terminal transition return `terminal_discovery_session`.

- [ ] **Step 2: Run the focused test to verify `stop()` is missing**

```bash
rtk npm --workspace @auto-demo/agent test -- src/discoveryRehearsal.test.ts
```

Expected: the new completion and abandonment tests FAIL.

- [ ] **Step 3: Implement explicit stop semantics**

Add the public input and method:

```ts
export type DiscoveryRehearsalStopInput =
  | { outcome: "complete"; attemptIds: string[]; source: "host-agent" | "user-directed" }
  | { outcome: "abandon"; reason: { code: string; summary: string } };
```

```ts
const stop = async (input: DiscoveryRehearsalStopInput): Promise<DiscoveryRehearsalResult> => {
  if (busy)
    return {
      ok: false,
      session: getSession(),
      errors: [{ code: "discovery_controller_busy", message: "Discovery controller is busy." }],
    };
  if (current === undefined)
    return {
      ok: false,
      errors: [
        {
          code: "discovery_controller_not_started",
          message: "Discovery controller is not started.",
        },
      ],
    };
  if (current.status !== "active")
    return {
      ok: false,
      session: getSession(),
      errors: [{ code: "terminal_discovery_session", message: "Discovery session is terminal." }],
    };
  busy = true;
  try {
    if (input.outcome === "abandon") {
      const abandoned = abandonDiscoverySession(current, {
        abandonedAt: clock(),
        reason: input.reason,
      });
      if (!abandoned.ok) return { ok: false, session: getSession(), errors: abandoned.errors };
      current = abandoned.session;
      return { ok: true, session: structuredClone(current), diagnostics: [] };
    }
    const selected = selectDiscoveryPath(current, {
      attemptIds: input.attemptIds,
      selectedAt: clock(),
      source: input.source,
    });
    if (!selected.ok) return { ok: false, session: getSession(), errors: selected.errors };
    const completed = completeDiscoverySession(selected.session, { completedAt: clock() });
    if (!completed.ok) return { ok: false, session: getSession(), errors: completed.errors };
    current = completed.session;
    return { ok: true, session: structuredClone(current), diagnostics: [] };
  } finally {
    busy = false;
  }
};
```

Return `stop` from the factory and export its input type.

- [ ] **Step 4: Run controller tests, agent typecheck, and agent build**

```bash
rtk npm --workspace @auto-demo/agent test -- src/discoveryRehearsal.test.ts
rtk npm --workspace @auto-demo/agent run typecheck
rtk npm --workspace @auto-demo/agent run build
```

Expected: all controller tests PASS; typecheck and build exit 0.

- [ ] **Step 5: Commit terminal lifecycle behavior**

```bash
rtk git add packages/agent/src/discoveryRehearsal.ts packages/agent/src/discoveryRehearsal.test.ts packages/agent/src/index.ts
rtk git commit -m "feat: finalize discovery rehearsals explicitly"
```

### Task 6: Share Opaque Target Identity With The Playwright Driver

**Files:**

- Create: `packages/agent/src/discoveryTargetRegistry.ts`
- Create: `packages/agent/src/playwrightDiscoveryPage.ts`
- Create: `packages/agent/src/playwrightDiscoveryRehearsal.ts`
- Create: `packages/agent/src/playwrightDiscoveryRehearsal.test.ts`
- Modify: `packages/agent/src/discoveryObservation.ts`
- Modify: `packages/agent/src/playwrightDiscoveryObservation.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/package.json`

- [ ] **Step 1: Write the failing real-browser start, click, and type test**

Create `packages/agent/src/playwrightDiscoveryRehearsal.test.ts` using the existing routed local HTML setup from `playwrightDiscoveryObservation.test.ts`. Add this first behavior:

```ts
it("acts on observed opaque targets without exposing runtime input values", async () => {
  await openHtml(`
    <title>Profile</title>
    <label>Name <input /></label>
    <button onclick="document.querySelector('output').textContent = 'Saved'">Save</button>
    <output>Not saved</output>
  `);
  const controller = createPlaywrightDiscoveryRehearsalController(page, {
    authorizer: {
      async authorize() {
        return { decision: "allow" as const, permit: { policy: "test" as const } };
      },
    },
    inputResolver: {
      async resolve() {
        return { ok: true as const, value: "Demo Person" };
      },
    },
  });
  const started = await controller.start({
    id: "session-1",
    target: { kind: "browser", startUrl: "https://example.test/" },
    goal: "Save a profile",
    host: { name: "codex", version: "1.0.0" },
  });
  if (!started.ok || started.observation === undefined) throw new Error("start must succeed");
  const inputId = started.observation.interactiveTargets.find(
    (target) => target.role === "textbox",
  )?.id;
  const saveId = started.observation.interactiveTargets.find(
    (target) => target.label === "Save",
  )?.id;
  if (inputId === undefined || saveId === undefined) throw new Error("targets missing");
  await controller.perform({
    action: { kind: "type", targetId: inputId, inputBinding: "demo-name", valueClass: "demo-data" },
    expectations: [],
    confidence: { level: "high", bases: ["exact-accessible-target"] },
  });
  const clicked = await controller.perform({
    action: { kind: "click", targetId: saveId },
    expectations: [
      {
        id: "expect-saved",
        kind: "visible-state",
        origin: "declared-before-action",
        publicCondition: "Saved",
      },
    ],
    confidence: { level: "high", bases: ["expected-visible-state-observed"] },
  });
  expect(clicked).toMatchObject({ ok: true, attempt: { status: "succeeded" } });
  expect(JSON.stringify(clicked)).not.toContain("Demo Person");
  expect(await page.locator("output").textContent()).toBe("Saved");
});
```

Append `src/playwrightDiscoveryRehearsal.test.ts` to the package test command.

- [ ] **Step 2: Run the real-browser test to verify it fails**

```bash
rtk npm --workspace @auto-demo/agent test -- src/playwrightDiscoveryRehearsal.test.ts
```

Expected: FAIL because the Playwright rehearsal factory and shared target-action path do not exist.

- [ ] **Step 3: Extract the internal target registry**

Create `packages/agent/src/discoveryTargetRegistry.ts`:

```ts
export type DiscoveryTargetRegistry = {
  resetDocument(documentToken: string): void;
  targetId(identityKey: string): string;
  resolve(targetId: string): { identityKey: string; documentToken: string } | undefined;
  remove(targetId: string): void;
};

export function createDiscoveryTargetRegistry(idGenerator: () => string): DiscoveryTargetRegistry {
  let documentToken: string | undefined;
  const targetIdByIdentity = new Map<string, string>();
  const identityByTargetId = new Map<string, string>();
  return {
    resetDocument(nextToken) {
      if (documentToken === nextToken) return;
      documentToken = nextToken;
      targetIdByIdentity.clear();
      identityByTargetId.clear();
    },
    targetId(identityKey) {
      const existing = targetIdByIdentity.get(identityKey);
      if (existing !== undefined) return existing;
      const created = idGenerator();
      targetIdByIdentity.set(identityKey, created);
      identityByTargetId.set(created, identityKey);
      return created;
    },
    resolve(targetId) {
      const identityKey = identityByTargetId.get(targetId);
      return identityKey === undefined || documentToken === undefined
        ? undefined
        : { identityKey, documentToken };
    },
    remove(targetId) {
      const identityKey = identityByTargetId.get(targetId);
      identityByTargetId.delete(targetId);
      if (identityKey !== undefined) targetIdByIdentity.delete(identityKey);
    },
  };
}
```

Refactor `createDiscoveryObservationExtractor()` to create this registry by default and add a module-internal `createDiscoveryObservationExtractorWithRegistry(dependencies, registry)` used by WES-185. Preserve the public factory signature and every WES-184 test. Replace the local maps with `registry.resetDocument()`, `registry.targetId()`, `registry.resolve()`, and `registry.remove()`.

- [ ] **Step 4: Move the Playwright page implementation behind a shared adapter**

Use `git mv packages/agent/src/playwrightDiscoveryObservation.ts packages/agent/src/playwrightDiscoveryPage.ts`. Export the existing `PlaywrightDiscoveryObservationPage` class from the moved file and add a low-level action method that resolves page-side identity keys without exposing them publicly:

```ts
async executeAction(input: { action: DiscoveryAction; identityKey?: string; resolvedValue?: string }) {
  switch (input.action.kind) {
    case "navigate": await this.page.goto(input.action.url); return;
    case "wait": await this.page.waitForTimeout(input.action.durationMs); return;
    case "inspect": return;
    case "back": await this.page.goBack(); return;
    case "refresh": await this.page.reload(); return;
    case "click":
    case "type": {
      if (input.identityKey === undefined) throw new Error("target unavailable");
      const handle = await this.page.evaluateHandle(({ registryKey, identityKey }) => {
        const root = globalThis as typeof globalThis & Record<string, unknown>;
        const state = root[registryKey] as { elements: Map<string, Element> } | undefined;
        return state?.elements.get(identityKey);
      }, { registryKey: this.registryKey, identityKey: input.identityKey });
      const element = handle.asElement();
      if (element === null) { await handle.dispose(); throw new Error("target unavailable"); }
      try {
        if (input.action.kind === "click") await element.click();
        else await element.fill(input.resolvedValue ?? "");
      } finally {
        await element.dispose();
      }
    }
  }
}
```

Recreate `packages/agent/src/playwrightDiscoveryObservation.ts` as a small compatibility wrapper that imports the shared class and returns the existing observation extractor. Run existing WES-184 tests immediately after the move.

- [ ] **Step 5: Create the Playwright rehearsal driver and factory**

Create `packages/agent/src/playwrightDiscoveryRehearsal.ts`. Construct one shared page adapter, one target registry, and one observation extractor. The driver resolves click/type targets through the registry, verifies the page-side identity remains live, and executes exactly once:

```ts
export function createPlaywrightDiscoveryRehearsalController<TPermit>(
  page: Page,
  options: PlaywrightDiscoveryRehearsalOptions<TPermit>,
) {
  const adapter = new PlaywrightDiscoveryObservationPage(page);
  const idGenerator =
    options.observationIdGenerator ??
    ((kind: DiscoveryObservationIdKind) => `${kind}-${randomUUID()}`);
  const registry = createDiscoveryTargetRegistry(() => idGenerator("target"));
  const extractor = createDiscoveryObservationExtractorWithRegistry(
    {
      page: adapter,
      artifactSink: options.artifactSink,
      clock: options.observationClock,
      idGenerator,
    },
    registry,
  );
  const driver: DiscoveryRehearsalDriver<TPermit> = {
    observe: () => extractor.observe(),
    hasLiveTarget: (targetId) => extractor.hasLiveTarget(targetId),
    isAvailable: () => adapter.isAvailable(),
    async execute({ action, resolvedValue }) {
      const target =
        action.kind === "click" || action.kind === "type"
          ? registry.resolve(action.targetId)
          : undefined;
      if ((action.kind === "click" || action.kind === "type") && target === undefined)
        return {
          ok: false,
          code: "target_stale",
          summary: "Discovery target is no longer live.",
          recoverable: true,
        };
      try {
        await adapter.executeAction({
          action,
          ...(target === undefined ? {} : { identityKey: target.identityKey }),
          ...(resolvedValue === undefined ? {} : { resolvedValue }),
        });
        return { ok: true, code: "action_completed", summary: "Discovery action completed." };
      } catch {
        const available = await adapter.isAvailable().catch(() => false);
        return {
          ok: false,
          code: available ? "action_failed" : "browser_unavailable",
          summary: available ? "Discovery action failed." : "Discovery browser is unavailable.",
          recoverable: available,
        };
      }
    },
  };
  return createDiscoveryRehearsalController({
    driver,
    authorizer: options.authorizer,
    inputResolver: options.inputResolver,
    clock: options.clock,
    idGenerator: options.attemptIdGenerator,
  });
}
```

Define the options type exactly:

```ts
export type PlaywrightDiscoveryRehearsalOptions<TPermit> = {
  authorizer: DiscoveryActionAuthorizer<TPermit>;
  inputResolver: DiscoveryInputResolver;
  artifactSink?: DiscoveryObservationArtifactSink;
  observationClock?: () => string;
  observationIdGenerator?: (kind: DiscoveryObservationIdKind) => string;
  clock?: () => string;
  attemptIdGenerator?: () => string;
};
```

Do not add browser launch, context creation, close, or capture-package dependencies.

- [ ] **Step 6: Run old observation tests plus the new Playwright test**

```bash
rtk npm --workspace @auto-demo/agent test -- src/discoveryObservation.test.ts src/playwrightDiscoveryObservation.test.ts src/playwrightDiscoveryRehearsal.test.ts
rtk npm --workspace @auto-demo/agent run typecheck
```

Expected: all WES-184 observation tests remain green, the new real click/type behavior passes, and typecheck exits 0.

- [ ] **Step 7: Commit the shared-registry Playwright driver**

```bash
rtk git add packages/agent/src/discoveryTargetRegistry.ts packages/agent/src/discoveryObservation.ts packages/agent/src/playwrightDiscoveryPage.ts packages/agent/src/playwrightDiscoveryObservation.ts packages/agent/src/playwrightDiscoveryRehearsal.ts packages/agent/src/playwrightDiscoveryRehearsal.test.ts packages/agent/src/index.ts packages/agent/package.json
rtk git commit -m "feat: drive Playwright discovery rehearsals"
```

### Task 7: Cover Real Navigation, History, Refresh, Stale Targets, And Branching

**Files:**

- Modify: `packages/agent/src/playwrightDiscoveryRehearsal.test.ts`
- Modify: `packages/agent/src/playwrightDiscoveryPage.ts`
- Modify: `packages/agent/src/playwrightDiscoveryRehearsal.ts`

- [ ] **Step 1: Add failing action-matrix tests**

Add routed tests for:

- navigate with exact matched URL evidence;
- wait followed by a delayed visible status;
- inspect producing a fresh observation without changing the URL;
- known-history back returning to the prior page;
- refresh invalidating old target IDs;
- removed and recreated controls returning `target_stale` without clicking the replacement;
- duplicate labels acting on the selected opaque ID only;
- a wrong route, explicit back, successful route, inspect evidence, and completion whose selected IDs exclude the wrong branch;
- closed page producing a failed terminal session with no pending attempt.

Use browser-visible assertions such as URL, output text, input value, and returned session evidence. Do not assert `evaluateHandle`, map contents, registry keys, or locator construction.

Add the navigation, history, refresh, and stale-target case:

```ts
it("navigates, returns through known history, refreshes, and rejects old targets", async () => {
  await page.route("https://example.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body:
        path === "/first"
          ? "<title>First</title><button>First action</button>"
          : "<title>Second</title><h1>Second page</h1>",
    });
  });
  await page.goto("https://example.test/first");
  const controller = createPlaywrightDiscoveryRehearsalController(page, allowOptions());
  const started = await controller.start({
    id: "session-1",
    target: { kind: "browser", startUrl: "https://example.test/first" },
    goal: "Visit second and return",
    host: { name: "codex", version: "1.0.0" },
  });
  if (!started.ok || started.observation === undefined) throw new Error("start must succeed");
  const oldTarget = started.observation.interactiveTargets[0]!.id;
  const navigated = await controller.perform({
    action: { kind: "navigate", url: "https://example.test/second" },
    expectations: [
      {
        id: "expect-second",
        kind: "navigation",
        origin: "declared-before-action",
        url: "https://example.test/second",
        match: "exact-url",
      },
    ],
    confidence: { level: "high", bases: ["expected-navigation-observed"] },
  });
  expect(navigated).toMatchObject({
    ok: true,
    attempt: { status: "succeeded" },
    observation: { page: { navigation: { canGoBack: true } } },
  });
  const returned = await controller.perform({
    action: { kind: "back" },
    expectations: [
      {
        id: "expect-first",
        kind: "navigation",
        origin: "declared-before-action",
        url: "https://example.test/first",
        match: "exact-url",
      },
    ],
    confidence: { level: "high", bases: ["expected-navigation-observed"] },
  });
  expect(returned).toMatchObject({
    ok: true,
    attempt: { status: "succeeded" },
    observation: { page: { url: "https://example.test/first" } },
  });
  const stale = await controller.perform({
    action: { kind: "click", targetId: oldTarget },
    expectations: [],
    confidence: { level: "medium", bases: ["exact-accessible-target"] },
  });
  expect(stale).toMatchObject({
    ok: true,
    attempt: { status: "failed", outcome: { code: "target_stale" } },
  });
  const refreshed = await controller.perform({
    action: { kind: "refresh" },
    expectations: [],
    confidence: { level: "high", bases: ["host-inference"] },
  });
  expect(refreshed).toMatchObject({ ok: true, attempt: { status: "succeeded" } });
});
```

Add the abandoned-branch selection case:

```ts
it("keeps a wrong branch outside the explicitly selected successful path", async () => {
  await page.route("https://example.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === "/start"
        ? "<title>Start</title><button onclick=\"location.href='/wrong'\">Wrong</button><button onclick=\"location.href='/success'\">Success</button>"
        : path === "/wrong"
          ? "<title>Wrong</title><h1>Wrong branch</h1>"
          : "<title>Success</title><h1>Success</h1>";
    await route.fulfill({ status: 200, contentType: "text/html", body });
  });
  await page.goto("https://example.test/start");
  let nextAttempt = 1;
  const controller = createPlaywrightDiscoveryRehearsalController(page, {
    ...allowOptions(),
    attemptIdGenerator: () => `attempt-${nextAttempt++}`,
  });
  const started = await controller.start({
    id: "session-1",
    target: { kind: "browser", startUrl: "https://example.test/start" },
    goal: "Reach success",
    host: { name: "codex", version: "1.0.0" },
  });
  if (!started.ok || started.observation === undefined) throw new Error("start must succeed");
  const wrongId = started.observation.interactiveTargets.find(
    (target) => target.label === "Wrong",
  )!.id;
  const wrong = await controller.perform({
    action: { kind: "click", targetId: wrongId },
    expectations: [],
    confidence: { level: "medium", bases: ["host-inference"] },
  });
  expect(wrong).toMatchObject({ ok: true, attempt: { id: "attempt-1" } });
  const returned = await controller.perform({
    action: { kind: "back" },
    expectations: [],
    confidence: { level: "high", bases: ["host-inference"] },
  });
  if (!returned.ok || returned.observation === undefined) throw new Error("back must succeed");
  const successId = returned.observation.interactiveTargets.find(
    (target) => target.label === "Success",
  )!.id;
  const success = await controller.perform({
    action: { kind: "click", targetId: successId },
    expectations: [],
    confidence: { level: "high", bases: ["exact-accessible-target"] },
  });
  const inspected = await controller.perform({
    action: { kind: "inspect" },
    expectations: [
      {
        id: "expect-success",
        kind: "visible-state",
        origin: "declared-before-action",
        publicCondition: "Success",
      },
    ],
    confidence: { level: "high", bases: ["expected-visible-state-observed"] },
  });
  if (
    !success.ok ||
    !inspected.ok ||
    success.attempt === undefined ||
    inspected.attempt === undefined
  )
    throw new Error("successful branch must be recorded");
  const completed = await controller.stop({
    outcome: "complete",
    attemptIds: [success.attempt.id, inspected.attempt.id],
    source: "host-agent",
  });
  expect(completed).toMatchObject({
    ok: true,
    session: { status: "completed", selectedPath: { attemptIds: ["attempt-3", "attempt-4"] } },
  });
  if (!completed.ok) throw new Error("completion must succeed");
  expect(completed.session.selectedPath?.attemptIds).not.toContain("attempt-1");
});
```

Define `allowOptions()` once in the test file:

```ts
function allowOptions() {
  return {
    authorizer: {
      async authorize() {
        return { decision: "allow" as const, permit: { policy: "test" as const } };
      },
    },
    inputResolver: {
      async resolve() {
        return { ok: true as const, value: "Demo Person" };
      },
    },
  };
}
```

Add wait/inspect, duplicate-target, and closed-page tests:

```ts
it("waits and inspects bounded visible evidence", async () => {
  await openHtml(
    "<title>Wait</title><div role='status' id='status'>Waiting</div><script>setTimeout(() => status.textContent = 'Ready', 10)</script>",
  );
  const controller = createPlaywrightDiscoveryRehearsalController(page, allowOptions());
  await controller.start({
    id: "session-1",
    target: { kind: "browser", startUrl: "https://example.test/" },
    goal: "Wait for ready",
    host: { name: "codex", version: "1.0.0" },
  });
  const waited = await controller.perform({
    action: { kind: "wait", durationMs: 25 },
    expectations: [
      {
        id: "expect-ready",
        kind: "visible-state",
        origin: "declared-before-action",
        publicCondition: "Ready",
      },
    ],
    confidence: { level: "high", bases: ["expected-visible-state-observed"] },
  });
  expect(waited).toMatchObject({ ok: true, attempt: { status: "succeeded" } });
  const inspected = await controller.perform({
    action: { kind: "inspect" },
    expectations: [
      {
        id: "expect-ready-again",
        kind: "visible-state",
        origin: "declared-before-action",
        publicCondition: "Ready",
      },
    ],
    confidence: { level: "high", bases: ["expected-visible-state-observed"] },
  });
  expect(inspected).toMatchObject({ ok: true, attempt: { status: "succeeded" } });
});

it("acts on the selected duplicate target only", async () => {
  await openHtml(
    "<title>Duplicates</title><button onclick=\"output.textContent='first'\">Continue</button><button onclick=\"output.textContent='second'\">Continue</button><output id='output'></output>",
  );
  const controller = createPlaywrightDiscoveryRehearsalController(page, allowOptions());
  const started = await controller.start({
    id: "session-1",
    target: { kind: "browser", startUrl: "https://example.test/" },
    goal: "Choose second",
    host: { name: "codex", version: "1.0.0" },
  });
  if (!started.ok || started.observation === undefined) throw new Error("start must succeed");
  const second = started.observation.interactiveTargets.find(
    (target) => target.label === "Continue" && target.occurrence === 2,
  );
  if (second === undefined) throw new Error("second target missing");
  await controller.perform({
    action: { kind: "click", targetId: second.id },
    expectations: [],
    confidence: { level: "high", bases: ["exact-accessible-target"] },
  });
  expect(await page.locator("output").textContent()).toBe("second");
});

it("fails terminally when the host closes the page", async () => {
  await openHtml("<title>Close</title><h1>Ready</h1>");
  const controller = createPlaywrightDiscoveryRehearsalController(page, allowOptions());
  await controller.start({
    id: "session-1",
    target: { kind: "browser", startUrl: "https://example.test/" },
    goal: "Inspect",
    host: { name: "codex", version: "1.0.0" },
  });
  await page.close();
  const result = await controller.perform({
    action: { kind: "inspect" },
    expectations: [],
    confidence: { level: "high", bases: ["host-inference"] },
  });
  expect(result).toMatchObject({
    ok: true,
    session: { status: "failed", terminal: { status: "failed" } },
  });
  if (!result.ok) throw new Error("browser loss must be recorded");
  expect(result.session.attempts.some((attempt) => attempt.status === "pending")).toBe(false);
});
```

- [ ] **Step 2: Run the Playwright test to verify the failing cases**

```bash
rtk npm --workspace @auto-demo/agent test -- src/playwrightDiscoveryRehearsal.test.ts
```

Expected: at least history, refresh invalidation, and branch completion FAIL until the shared page adapter updates document tokens and known-history state after actions.

- [ ] **Step 3: Make the smallest driver corrections required by public behavior**

Keep action execution single-shot. After navigate, back, or refresh, let the next `observe()` establish the new document token and registry epoch. The generic controller check added in Task 3 rejects back when the current recorded observation says `canGoBack: false` and records a recoverable fixed `back_unavailable` outcome. Preserve Playwright's normal actionability behavior for click and fill, but catch and sanitize all exceptions at the driver boundary.

Do not add semantic target remapping, automatic retries, iframe actions, downloads, request policy, or disposable-origin logic.

- [ ] **Step 4: Assert final capture never starts**

Add a source-boundary test that imports and runs the Playwright controller without any `@auto-demo/capture` dependency and assert the returned session contains discovery observations/attempts only. Also run:

```bash
rtk rg -n "@auto-demo/capture|recordVideo|capture\.start|startCapture" packages/agent/src/discoveryRehearsal.ts packages/agent/src/playwrightDiscoveryPage.ts packages/agent/src/playwrightDiscoveryRehearsal.ts
```

Expected: no matches.

- [ ] **Step 5: Run focused and package verification**

```bash
rtk npm --workspace @auto-demo/agent test -- src/discoveryRehearsal.test.ts src/playwrightDiscoveryRehearsal.test.ts src/discoveryObservation.test.ts src/playwrightDiscoveryObservation.test.ts
rtk npm --workspace @auto-demo/agent test
rtk npm --workspace @auto-demo/agent run typecheck
rtk npm --workspace @auto-demo/agent run build
```

Expected: all focused tests and the full agent suite pass; typecheck and build exit 0.

- [ ] **Step 6: Commit real-browser behavior coverage**

```bash
rtk git add packages/agent/src/playwrightDiscoveryRehearsal.test.ts packages/agent/src/playwrightDiscoveryPage.ts packages/agent/src/playwrightDiscoveryRehearsal.ts
rtk git commit -m "test: cover discovery rehearsal browser behavior"
```

### Task 8: Export And Document The WES-185 Boundary

**Files:**

- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/src/wrapper-docs.test.ts`
- Modify: `packages/agent/README.md`
- Modify: `README.md`
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Write the failing documentation contract test**

Add to `wrapper-docs.test.ts`:

```ts
it("documents host-owned discovery rehearsal actions and downstream policy", async () => {
  const agentReadme = normalizeWhitespace(await readAgentDoc("README.md"));
  const rootReadme = normalizeWhitespace(await readRootDoc("README.md"));
  const combined = `${agentReadme} ${rootReadme}`;
  for (const expected of [
    "createPlaywrightDiscoveryRehearsalController",
    "existing Playwright page",
    "required authorizer",
    "runtime-only input resolver",
    "explicit retryOfAttemptId",
    "complete or abandon explicitly",
    "does not launch or close the browser",
    "does not start final media capture",
    "WES-186",
    "WES-187",
  ])
    expect(combined).toContain(expected);
  expect(combined).not.toContain("autodemo agent discover");
});
```

- [ ] **Step 2: Run the docs test to verify it fails**

```bash
rtk npm --workspace @auto-demo/agent test -- src/wrapper-docs.test.ts
```

Expected: FAIL because the WES-185 API is not documented.

- [ ] **Step 3: Document the public workflow and security model**

Add an `## Discovery Rehearsal Controller` section to `packages/agent/README.md` with a complete host-owned example:

```ts
const controller = createPlaywrightDiscoveryRehearsalController(page, {
  authorizer,
  inputResolver: {
    async resolve(binding) {
      return binding === "demo-name"
        ? { ok: true, value: "Demo Person" }
        : { ok: false, code: "input_binding_unavailable", summary: "Demo input is unavailable." };
    },
  },
});

const started = await controller.start({
  id: "profile-discovery",
  target: { kind: "browser", startUrl: "https://example.test/profile" },
  goal: "Save a demo profile",
  host: { name: "codex", version: "1.0.0" },
});
```

Explain atomic `perform()`, blocked attempts, runtime-only values, stale targets, `retryOfAttemptId`, explicit completion/abandonment, and host-owned closure. State plainly that WES-186 owns the concrete policy and WES-187 owns compilation.

Update the root README capability paragraph without claiming a CLI, final recording, or autonomous end-to-end agentic discovery.

- [ ] **Step 4: Update exports and the package test script**

Confirm `packages/agent/src/index.ts` exports:

- `createDiscoveryRehearsalController`;
- `createPlaywrightDiscoveryRehearsalController`;
- controller, driver, authorizer, input resolver, action/start/stop/result/error types;
- Playwright options type.

Confirm the package test script includes `src/discoveryRehearsal.test.ts` and `src/playwrightDiscoveryRehearsal.test.ts` exactly once.

- [ ] **Step 5: Record the implementation note in the project map**

Add a concise WES-185 implementation note naming the controller factories, required authorization/input seams, atomic evidence behavior, focused test evidence, and remaining WES-186/WES-187 boundaries. Keep WES-185 In Progress until Task 9 passes.

- [ ] **Step 6: Run docs, package, and formatting checks**

```bash
rtk npm --workspace @auto-demo/agent test -- src/wrapper-docs.test.ts
rtk npm --workspace @auto-demo/agent test
rtk npx prettier --check packages/agent/src/discoveryRehearsal.ts packages/agent/src/discoveryRehearsal.test.ts packages/agent/src/discoveryTargetRegistry.ts packages/agent/src/playwrightDiscoveryPage.ts packages/agent/src/playwrightDiscoveryObservation.ts packages/agent/src/playwrightDiscoveryRehearsal.ts packages/agent/src/playwrightDiscoveryRehearsal.test.ts packages/agent/src/index.ts packages/agent/src/wrapper-docs.test.ts packages/agent/README.md README.md docs/linear/auto-demo-project-structure.md
rtk git diff --check
```

Expected: docs and full agent tests pass, all listed files are formatted, and diff check exits 0.

- [ ] **Step 7: Commit exports and documentation**

```bash
rtk git add packages/agent/src/index.ts packages/agent/src/wrapper-docs.test.ts packages/agent/README.md README.md docs/linear/auto-demo-project-structure.md
rtk git commit -m "docs: explain discovery rehearsal controller"
```

### Task 9: Review, Verify, And Run The Linear Completion Gate

**Files:**

- Inspect: all WES-185 source, tests, and docs
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Review the diff against the approved spec**

Invoke `superpowers:requesting-code-review`. Require explicit review of:

- host-owned page lifecycle;
- no permissive default authorizer;
- authorization before runtime input resolution;
- no typed-value or dependency-exception leakage;
- no silent retry or semantic target remapping;
- one pending attempt maximum;
- valid terminal sessions after browser loss;
- selected-path exclusion of abandoned exploration;
- no WES-186 policy, WES-187 compilation, CLI, or capture scope creep;
- black-box tests rather than private registry assertions.

Expected: no unresolved Critical or Important findings. Fix findings through focused red-green tests before continuing.

- [ ] **Step 2: Run fresh focused verification**

```bash
rtk npm --workspace @auto-demo/agent test -- src/discoveryRehearsal.test.ts src/playwrightDiscoveryRehearsal.test.ts src/discoveryObservation.test.ts src/playwrightDiscoveryObservation.test.ts src/wrapper-docs.test.ts
rtk npm --workspace @auto-demo/agent run typecheck
rtk npm --workspace @auto-demo/agent run build
```

Expected: focused tests pass; typecheck and build exit 0.

- [ ] **Step 3: Run fresh repository verification**

```bash
rtk npm run build
rtk npm run typecheck
rtk npm run lint
rtk npm test
rtk npm run format:check
rtk git diff --check
```

Expected: every command exits 0. If repository-wide formatting still fails only on a preserved unrelated user file, record that exact exception and run targeted Prettier checks for every WES-185 file; do not claim a clean full-validation pass.

- [ ] **Step 4: Run `linear-sync-gate` in `completion-gate` mode**

Provide:

```text
mode: completion-gate
repository: /Users/weston.bushyeager/code/personal/auto-demo
project map: docs/linear/auto-demo-project-structure.md
Linear project: Auto Demo Balanced MVP
active issue: WES-185
implementation summary: stateful host-owned-page rehearsal controller, shared opaque-target Playwright driver, required authorizer, runtime-only input resolver, atomic evidence, explicit retry and terminal stop
verification evidence: exact focused and repository commands plus review result
nearby issues: WES-182, WES-186, WES-187
```

Expected: the gate confirms whether WES-185 is complete, preserves WES-186 as the next parallel-safe policy task, and advances the dependency pointer to WES-186 before WES-187 if policy remains required for safe product use.

- [ ] **Step 5: Apply clear Linear and project-map writes**

If and only if the completion gate passes:

```bash
rtk linear issue comment add WES-185 -b "Completion evidence: implemented the host-owned-page rehearsal controller, required authorization and runtime-only input resolution, atomic WES-183 attempt/observation recording, explicit retries and terminal outcomes, and routed Playwright behavior coverage. Focused agent tests, agent typecheck/build, and repository build/typecheck/lint/test/format verification passed. Independent review reported no unresolved Critical or Important findings. No secret values were pasted."
rtk linear issue update WES-185 --state Done
```

Run that comment command only when the stated verification and review claims exactly match the fresh outputs from Steps 1-3. Add a readiness note to WES-186 describing the authorizer/permit seam. Add a WES-187 readiness note only if the gate confirms the completed selected-session artifact is sufficient for compilation work.

Update `docs/linear/auto-demo-project-structure.md` with the exact verification evidence, Linear writes, nearby issue reconciliation, and next-task pointer.

- [ ] **Step 6: Verify the final sync diff and commit completion evidence**

```bash
rtk npx prettier --check docs/linear/auto-demo-project-structure.md
rtk git diff --check
rtk git status --short
rtk git add docs/linear/auto-demo-project-structure.md
rtk git commit -m "docs: sync WES-185 completion evidence"
```

Expected: only intended WES-185 files are committed; unrelated user files remain untouched.
