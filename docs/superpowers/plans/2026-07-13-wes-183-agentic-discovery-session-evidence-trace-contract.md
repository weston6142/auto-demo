# WES-183 Agentic Discovery Session And Evidence Trace Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a versioned, portable, transcript-safe discovery-session contract with immutable lifecycle operations and evidence-backed selected paths to `@auto-demo/agent`.

**Architecture:** Keep public JSON types and limits in `discoveryContract.ts`, untrusted-artifact parsing and cross-reference validation in `discoveryValidation.ts`, and immutable state transitions in `discoverySession.ts`. The module records caller-supplied observations and action outcomes but performs no browser, filesystem, policy, plan-compilation, or model work.

**Tech Stack:** TypeScript ESM, Vitest, existing `@auto-demo/agent` transcript sanitizers, npm workspaces, ESLint, Prettier.

---

## File Structure

- Create `packages/agent/src/discoveryContract.ts`: public schema version, limits, JSON-safe types, error codes, and result types.
- Create `packages/agent/src/discoveryValidation.ts`: allowlisted sanitization, schema parsing, serialized-size checks, and relationship validation.
- Create `packages/agent/src/discoverySession.ts`: immutable create, observe, attempt, selection, terminal, and child-session operations.
- Create `packages/agent/src/discoverySession.test.ts`: behavior tests for creation, observation, attempt, selection, terminal state, limits, sanitization, and immutability.
- Create `packages/agent/src/discoveryValidation.test.ts`: untrusted JSON, unknown-field, version, reference, size, path, and secret-hygiene tests.
- Create `packages/agent/fixtures/discovery-session-completed.json`: completed continuous path fixture for WES-187.
- Create `packages/agent/fixtures/discovery-session-with-abandoned-attempts.json`: completed fixture retaining failed exploration outside the selected path.
- Create `packages/agent/fixtures/discovery-session-invalid-version.json`: unsupported schema fixture.
- Create `packages/agent/fixtures/discovery-session-invalid-reference.json`: broken selected-path fixture.
- Create `packages/agent/fixtures/discovery-session-unsafe-content.json`: unsafe artifact-path and unknown-field fixture.
- Modify `packages/agent/src/index.ts`: export the public discovery contract and operations.
- Modify `packages/agent/package.json`: include the two new tests in the workspace test command.
- Modify `packages/agent/src/wrapper-docs.test.ts`: assert discovery documentation and fixture validity.
- Modify `packages/agent/README.md`: document the API, safety model, lifecycle, and downstream deferrals.
- Modify `README.md`: add the contract to repository status and package responsibilities without documenting a nonexistent CLI.
- Modify `docs/linear/auto-demo-project-structure.md`: record implementation and completion evidence during the Linear completion gate.

### Task 1: Public Discovery Contract And Exports

**Files:**

- Create: `packages/agent/src/discoveryContract.ts`
- Create: `packages/agent/src/discoverySession.test.ts`
- Modify: `packages/agent/src/index.ts`

- [ ] **Step 1: Write the failing public-contract test**

Create `packages/agent/src/discoverySession.test.ts` with the first public behavior:

```ts
import { describe, expect, it } from "vitest";
import {
  DISCOVERY_LIMITS,
  DISCOVERY_SCHEMA_VERSION,
  type DiscoveryAction,
  type DiscoverySessionV1,
} from "./index.js";

describe("discovery session contract", () => {
  it("publishes one fixed version and bounded JSON contract", () => {
    expect(DISCOVERY_SCHEMA_VERSION).toBe(1);
    expect(DISCOVERY_LIMITS).toEqual({
      observations: 256,
      attempts: 256,
      selectedPathAttempts: 128,
      interactiveTargetsPerObservation: 100,
      visibleStatesPerObservation: 50,
      artifactReferencesPerObservation: 8,
      identifierCharacters: 128,
      publicStringCharacters: 2_000,
      waitDurationMs: 30_000,
      serializedBytes: 5 * 1024 * 1024,
      terminalReserveBytes: 64 * 1024,
    });

    const action: DiscoveryAction = {
      kind: "type",
      targetId: "target-company",
      inputBinding: "companyName",
      valueClass: "demo-data",
    };
    expect("value" in action).toBe(false);

    const compileOnly: DiscoverySessionV1 | undefined = undefined;
    expect(compileOnly).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify the public contract is missing**

Run:

```bash
rtk npx vitest run packages/agent/src/discoverySession.test.ts
```

Expected: FAIL because `DISCOVERY_LIMITS`, `DISCOVERY_SCHEMA_VERSION`, and the discovery types are not exported.

- [ ] **Step 3: Define the complete public type vocabulary**

Create `packages/agent/src/discoveryContract.ts` with these exported definitions. Keep every type JSON-safe and do not add index signatures or extension bags.

```ts
export const DISCOVERY_SCHEMA_VERSION = 1 as const;

export const DISCOVERY_LIMITS = {
  observations: 256,
  attempts: 256,
  selectedPathAttempts: 128,
  interactiveTargetsPerObservation: 100,
  visibleStatesPerObservation: 50,
  artifactReferencesPerObservation: 8,
  identifierCharacters: 128,
  publicStringCharacters: 2_000,
  waitDurationMs: 30_000,
  serializedBytes: 5 * 1024 * 1024,
  terminalReserveBytes: 64 * 1024,
} as const;

export type DiscoverySessionStatus = "active" | "completed" | "failed" | "abandoned";
export type DiscoveryAttemptStatus = "pending" | "succeeded" | "failed" | "blocked";
export type DiscoveryConfidenceLevel = "high" | "medium" | "low";
export type DiscoveryConfidenceBasis =
  | "exact-accessible-target"
  | "expected-navigation-observed"
  | "expected-visible-state-observed"
  | "positional-intent"
  | "host-inference";

export type DiscoveryHostProvenance = {
  name: string;
  version: string;
  model?: string;
};

export type DiscoveryArtifactReference = {
  id: string;
  kind: "screenshot" | "viewport";
  path: string;
  mediaType: "image/png" | "image/jpeg";
  sha256?: string;
};

export type DiscoveryVisibleState = {
  id: string;
  kind: "text" | "status";
  summary: string;
};

export type DiscoveryInteractiveTarget = {
  id: string;
  label: string;
  role?: string;
  occurrence?: number;
  disabled: boolean;
  actionRisk?: "potentially-mutating";
};

export type DiscoveryObservation = {
  id: string;
  sequence: number;
  observedAt: string;
  page: {
    url: string;
    title: string;
    viewport: { width: number; height: number };
    navigation: { canGoBack: boolean };
  };
  visibleStates: DiscoveryVisibleState[];
  interactiveTargets: DiscoveryInteractiveTarget[];
  artifacts: DiscoveryArtifactReference[];
};

export type DiscoveryAction =
  | { kind: "navigate"; url: string }
  | { kind: "click"; targetId: string }
  | {
      kind: "type";
      targetId: string;
      inputBinding: string;
      valueClass: "demo-data";
    }
  | { kind: "wait"; durationMs: number }
  | { kind: "inspect" }
  | { kind: "back" }
  | { kind: "refresh" };

export type DiscoveryExpectationOrigin = "declared-before-action" | "derived-from-observation";

export type DiscoveryExpectation =
  | {
      id: string;
      kind: "navigation";
      origin: DiscoveryExpectationOrigin;
      url: string;
      match: "exact-url" | "same-origin-path";
    }
  | {
      id: string;
      kind: "visible-state";
      origin: DiscoveryExpectationOrigin;
      targetId?: string;
      publicCondition?: string;
      role?: string;
    };

export type DiscoveryObservedEffect = {
  expectationId: string;
  status: "matched" | "not-matched";
  observationId: string;
  summary: string;
};

export type DiscoveryConfidence = {
  level: DiscoveryConfidenceLevel;
  bases: DiscoveryConfidenceBasis[];
  note?: string;
};

export type DiscoveryAttemptBase = {
  id: string;
  sequence: number;
  startedAt: string;
  beforeObservationId: string;
  action: DiscoveryAction;
  expectations: DiscoveryExpectation[];
  confidence: DiscoveryConfidence;
  retryOfAttemptId?: string;
};

export type PendingDiscoveryAttempt = DiscoveryAttemptBase & {
  status: "pending";
};

export type FinalizedDiscoveryAttempt = DiscoveryAttemptBase & {
  status: "succeeded" | "failed" | "blocked";
  finishedAt: string;
  derivedExpectations: DiscoveryExpectation[];
  observedEffects: DiscoveryObservedEffect[];
  afterObservationId?: string;
  outcome: { code: string; summary: string };
};

export type DiscoveryAttempt = PendingDiscoveryAttempt | FinalizedDiscoveryAttempt;

export type DiscoverySelectedPath = {
  attemptIds: string[];
  selectedAt: string;
  source: "host-agent" | "user-directed";
};

export type DiscoveryTerminal =
  | { status: "completed"; completedAt: string }
  | { status: "failed"; failedAt: string; reason: { code: string; summary: string } }
  | { status: "abandoned"; abandonedAt: string; reason: { code: string; summary: string } };

export type DiscoverySessionV1 = {
  schemaVersion: 1;
  id: string;
  status: DiscoverySessionStatus;
  target: { kind: "browser"; startUrl: string };
  goal: string;
  host: DiscoveryHostProvenance;
  parentSessionId?: string;
  createdAt: string;
  updatedAt: string;
  observations: DiscoveryObservation[];
  attempts: DiscoveryAttempt[];
  selectedPath?: DiscoverySelectedPath;
  terminal?: DiscoveryTerminal;
};

export type DiscoveryContractErrorCode =
  | "invalid_discovery_session"
  | "invalid_discovery_input"
  | "unsupported_discovery_schema"
  | "invalid_discovery_transition"
  | "terminal_discovery_session"
  | "session_limit_exceeded"
  | "duplicate_discovery_record"
  | "missing_discovery_reference"
  | "inconsistent_discovery_reference"
  | "pending_attempt_conflict"
  | "pending_attempt_required"
  | "invalid_selected_path"
  | "expectation_evidence_missing"
  | "unsafe_discovery_url"
  | "unsafe_discovery_content"
  | "invalid_discovery_artifact_reference";

export type DiscoveryContractError = {
  code: DiscoveryContractErrorCode;
  message: string;
  path?: string;
  recordId?: string;
};

export type DiscoveryContractResult =
  { ok: true; session: DiscoverySessionV1 } | { ok: false; errors: DiscoveryContractError[] };
```

- [ ] **Step 4: Export the contract**

Add a re-export block near the other public export blocks in `packages/agent/src/index.ts`:

```ts
export {
  DISCOVERY_LIMITS,
  DISCOVERY_SCHEMA_VERSION,
  type DiscoveryAction,
  type DiscoveryArtifactReference,
  type DiscoveryAttempt,
  type DiscoveryAttemptStatus,
  type DiscoveryConfidence,
  type DiscoveryConfidenceBasis,
  type DiscoveryConfidenceLevel,
  type DiscoveryContractError,
  type DiscoveryContractErrorCode,
  type DiscoveryContractResult,
  type DiscoveryExpectation,
  type DiscoveryExpectationOrigin,
  type DiscoveryHostProvenance,
  type DiscoveryInteractiveTarget,
  type DiscoveryObservation,
  type DiscoveryObservedEffect,
  type DiscoverySelectedPath,
  type DiscoverySessionStatus,
  type DiscoverySessionV1,
  type DiscoveryTerminal,
  type DiscoveryVisibleState,
  type FinalizedDiscoveryAttempt,
  type PendingDiscoveryAttempt,
} from "./discoveryContract.js";
```

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
rtk npx vitest run packages/agent/src/discoverySession.test.ts
rtk npm --workspace @auto-demo/agent run typecheck
```

Expected: the focused test passes and TypeScript reports no errors.

- [ ] **Step 6: Commit the public contract**

```bash
rtk git add packages/agent/src/discoveryContract.ts packages/agent/src/discoverySession.test.ts packages/agent/src/index.ts
rtk git commit -m "feat: define discovery session contract"
```

### Task 2: Session Creation And Untrusted Artifact Validation

**Files:**

- Create: `packages/agent/src/discoveryValidation.ts`
- Create: `packages/agent/src/discoverySession.ts`
- Create: `packages/agent/src/discoveryValidation.test.ts`
- Modify: `packages/agent/src/discoverySession.test.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/package.json`

- [ ] **Step 1: Write failing creation and parsing tests**

Define this shared valid input in `discoverySession.test.ts`:

```ts
const SESSION_INPUT = {
  id: "session-checkout",
  target: { kind: "browser" as const, startUrl: "https://example.com/checkout" },
  goal: "Show the checkout flow",
  host: { name: "codex", version: "1.0.0", model: "gpt-5" },
  createdAt: "2026-07-13T12:00:00.000Z",
};
```

Add these tests:

```ts
import { createDiscoverySession } from "./index.js";

it("creates an immutable active session from explicit identity and time", () => {
  const result = createDiscoverySession(SESSION_INPUT);

  expect(result).toEqual({
    ok: true,
    session: {
      schemaVersion: 1,
      id: "session-checkout",
      status: "active",
      target: { kind: "browser", startUrl: "https://example.com/checkout" },
      goal: "Show the checkout flow",
      host: { name: "codex", version: "1.0.0", model: "gpt-5" },
      createdAt: "2026-07-13T12:00:00.000Z",
      updatedAt: "2026-07-13T12:00:00.000Z",
      observations: [],
      attempts: [],
    },
  });
  expect(SESSION_INPUT).toEqual({
    id: "session-checkout",
    target: { kind: "browser", startUrl: "https://example.com/checkout" },
    goal: "Show the checkout flow",
    host: { name: "codex", version: "1.0.0", model: "gpt-5" },
    createdAt: "2026-07-13T12:00:00.000Z",
  });
});
```

Replace `discoveryValidation.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { createDiscoverySession, validateDiscoverySession } from "./index.js";

const valid = createDiscoverySession({
  id: "session-checkout",
  target: { kind: "browser", startUrl: "https://example.com/checkout" },
  goal: "Show checkout",
  host: { name: "codex", version: "1.0.0" },
  createdAt: "2026-07-13T12:00:00.000Z",
});

describe("discovery session validation", () => {
  it("round-trips a valid JSON artifact", () => {
    expect(valid.ok).toBe(true);
    const artifact = JSON.parse(JSON.stringify(valid.ok ? valid.session : null));
    expect(validateDiscoverySession(artifact)).toEqual(valid);
  });

  it("rejects unsupported versions and unknown properties", () => {
    expect(validateDiscoverySession({ schemaVersion: 2 })).toMatchObject({
      ok: false,
      errors: [{ code: "unsupported_discovery_schema" }],
    });
    expect(
      validateDiscoverySession({
        ...(valid.ok ? valid.session : {}),
        extraSecret: "sk-live-secret",
      }),
    ).toMatchObject({
      ok: false,
      errors: [{ code: "unsafe_discovery_content", path: "extraSecret" }],
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify creation and validation are missing**

```bash
rtk npx vitest run packages/agent/src/discoverySession.test.ts packages/agent/src/discoveryValidation.test.ts
```

Expected: FAIL because `createDiscoverySession()` and `validateDiscoverySession()` are not exported.

- [ ] **Step 3: Implement safe scalar parsing and base-session validation**

Create `packages/agent/src/discoveryValidation.ts`. Import `sanitizeWalkthroughText` and `sanitizeWalkthroughUrl` from `walkthroughValidation.ts`, and implement these concrete helpers:

```ts
import { Buffer } from "node:buffer";
import {
  DISCOVERY_LIMITS,
  type DiscoveryContractError,
  type DiscoveryContractResult,
  type DiscoverySessionV1,
} from "./discoveryContract.js";
import { sanitizeWalkthroughText, sanitizeWalkthroughUrl } from "./walkthroughValidation.js";

const IDENTIFIER = /^[a-z0-9][a-z0-9_-]*$/i;
const EXACT_SESSION_KEYS = new Set([
  "schemaVersion",
  "id",
  "status",
  "target",
  "goal",
  "host",
  "parentSessionId",
  "createdAt",
  "updatedAt",
  "observations",
  "attempts",
  "selectedPath",
  "terminal",
]);

export function discoveryError(
  code: DiscoveryContractError["code"],
  message: string,
  options: Pick<DiscoveryContractError, "path" | "recordId"> = {},
): DiscoveryContractError {
  return { code, message, ...options };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

export function isSafeDiscoveryId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= DISCOVERY_LIMITS.identifierCharacters &&
    IDENTIFIER.test(value)
  );
}

export function isNormalizedIsoTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

export function sanitizeDiscoveryText(value: string): string {
  return sanitizeWalkthroughText(value);
}

export function isBoundedDiscoveryText(value: unknown): value is string {
  return typeof value === "string" && value.length <= DISCOVERY_LIMITS.publicStringCharacters;
}

export function sanitizeDiscoveryUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (
      !/^https?:$/.test(parsed.protocol) ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      hasCredentialLikeDiscoveryUrlData(parsed)
    ) {
      return undefined;
    }
    const sanitized = sanitizeWalkthroughUrl(value);
    return sanitized === "[redacted-url]" ? undefined : sanitized;
  } catch {
    return undefined;
  }
}

function hasCredentialLikeDiscoveryUrlData(url: URL): boolean {
  const credentialKey =
    /(^|[-_.])(auth|authorization|token|api[-_]?key|key|secret|password|passcode|credential|signature|sig|code)($|[-_.])/i;
  const parameterSets = [url.searchParams];
  if (url.hash.includes("=")) parameterSets.push(new URLSearchParams(url.hash.slice(1)));
  return parameterSets.some((parameters) =>
    Array.from(parameters).some(
      ([key, value]) =>
        credentialKey.test(key) || sanitizeWalkthroughText(value).includes("[redacted-secret]"),
    ),
  );
}

export function serializedDiscoveryBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function validateDiscoverySession(value: unknown): DiscoveryContractResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      errors: [discoveryError("invalid_discovery_session", "Discovery session must be an object.")],
    };
  }
  if (value.schemaVersion !== 1) {
    return {
      ok: false,
      errors: [
        discoveryError(
          "unsupported_discovery_schema",
          "Discovery session schemaVersion must be 1.",
          { path: "schemaVersion" },
        ),
      ],
    };
  }
  const unknown = Object.keys(value).find((key) => !EXACT_SESSION_KEYS.has(key));
  if (unknown !== undefined) {
    return {
      ok: false,
      errors: [
        discoveryError("unsafe_discovery_content", "Unknown discovery session field.", {
          path: unknown,
        }),
      ],
    };
  }
  if (!isBaseSession(value)) {
    return {
      ok: false,
      errors: [discoveryError("invalid_discovery_session", "Discovery session is invalid.")],
    };
  }
  if (serializedDiscoveryBytes(value) > DISCOVERY_LIMITS.serializedBytes) {
    return {
      ok: false,
      errors: [discoveryError("session_limit_exceeded", "Discovery session is too large.")],
    };
  }
  return { ok: true, session: structuredClone(value) as DiscoverySessionV1 };
}
```

In the same file, define `isBaseSession()` to check exact nested keys for `target` and `host`, safe IDs, normalized timestamps, sanitized non-empty goal/host strings, `status === "active"`, empty observation and attempt arrays for this incremental task, and absent selected/terminal values. Do not use a truthy cast as validation.

- [ ] **Step 4: Implement immutable creation**

Create `packages/agent/src/discoverySession.ts`:

```ts
import {
  DISCOVERY_LIMITS,
  DISCOVERY_SCHEMA_VERSION,
  type DiscoveryContractResult,
  type DiscoveryHostProvenance,
} from "./discoveryContract.js";
import {
  discoveryError,
  isNormalizedIsoTime,
  isSafeDiscoveryId,
  sanitizeDiscoveryText,
  sanitizeDiscoveryUrl,
  validateDiscoverySession,
} from "./discoveryValidation.js";

export type CreateDiscoverySessionInput = {
  id: string;
  target: { kind: "browser"; startUrl: string };
  goal: string;
  host: DiscoveryHostProvenance;
  parentSessionId?: string;
  createdAt: string;
};

export function createDiscoverySession(
  input: CreateDiscoverySessionInput,
): DiscoveryContractResult {
  if (
    !isRecord(input) ||
    !hasOnlyKeys(input, ["id", "target", "goal", "host", "parentSessionId", "createdAt"]) ||
    !isRecord(input.target) ||
    !hasOnlyKeys(input.target, ["kind", "startUrl"]) ||
    input.target.kind !== "browser" ||
    typeof input.target.startUrl !== "string" ||
    !isRecord(input.host) ||
    !hasOnlyKeys(input.host, ["name", "version", "model"]) ||
    typeof input.goal !== "string" ||
    typeof input.host.name !== "string" ||
    typeof input.host.version !== "string" ||
    (input.host.model !== undefined && typeof input.host.model !== "string")
  ) {
    return {
      ok: false,
      errors: [discoveryError("invalid_discovery_input", "Discovery session input is invalid.")],
    };
  }
  const startUrl = sanitizeDiscoveryUrl(input.target.startUrl);
  const hostValues = [input.host.name, input.host.version, input.host.model].filter(
    (value): value is string => value !== undefined,
  );
  if (
    input.goal.length > DISCOVERY_LIMITS.publicStringCharacters ||
    hostValues.some((value) => value.length > DISCOVERY_LIMITS.identifierCharacters)
  ) {
    return {
      ok: false,
      errors: [discoveryError("session_limit_exceeded", "Discovery public text is too long.")],
    };
  }
  const goal = sanitizeDiscoveryText(input.goal);
  const hostName = sanitizeDiscoveryText(input.host.name);
  const hostVersion = sanitizeDiscoveryText(input.host.version);
  if (
    !isSafeDiscoveryId(input.id) ||
    (input.parentSessionId !== undefined && !isSafeDiscoveryId(input.parentSessionId)) ||
    !isNormalizedIsoTime(input.createdAt) ||
    startUrl === undefined ||
    goal.length === 0 ||
    hostName.length === 0 ||
    hostVersion.length === 0
  ) {
    return {
      ok: false,
      errors: [discoveryError("invalid_discovery_input", "Discovery session input is invalid.")],
    };
  }
  const session = {
    schemaVersion: DISCOVERY_SCHEMA_VERSION,
    id: input.id,
    status: "active" as const,
    target: { kind: "browser" as const, startUrl },
    goal,
    host: {
      name: hostName,
      version: hostVersion,
      ...(input.host.model === undefined ? {} : { model: sanitizeDiscoveryText(input.host.model) }),
    },
    ...(input.parentSessionId === undefined ? {} : { parentSessionId: input.parentSessionId }),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    observations: [],
    attempts: [],
  };
  return validateDiscoverySession(session);
}
```

- [ ] **Step 5: Export creation and validation and register both test files**

Add to `packages/agent/src/index.ts`:

```ts
export { createDiscoverySession, type CreateDiscoverySessionInput } from "./discoverySession.js";
export { validateDiscoverySession } from "./discoveryValidation.js";
```

Update the `test` script in `packages/agent/package.json`:

```json
"test": "vitest run src/index.test.ts src/wrapper-docs.test.ts src/walkthroughValidation.test.ts src/playwrightValidationRunner.test.ts src/walkthroughReview.test.ts src/walkthroughApproval.test.ts src/walkthroughRefinement.test.ts src/walkthroughExecution.test.ts src/discoverySession.test.ts src/discoveryValidation.test.ts"
```

- [ ] **Step 6: Run focused tests and typecheck**

```bash
rtk npx vitest run packages/agent/src/discoverySession.test.ts packages/agent/src/discoveryValidation.test.ts
rtk npm --workspace @auto-demo/agent run typecheck
```

Expected: all focused tests pass and TypeScript reports no errors.

- [ ] **Step 7: Commit creation and validation**

```bash
rtk git add packages/agent/src/discoveryValidation.ts packages/agent/src/discoverySession.ts packages/agent/src/discoverySession.test.ts packages/agent/src/discoveryValidation.test.ts packages/agent/src/index.ts packages/agent/package.json
rtk git commit -m "feat: create and validate discovery sessions"
```

### Task 3: Bounded Observations And Artifact References

**Files:**

- Modify: `packages/agent/src/discoverySession.ts`
- Modify: `packages/agent/src/discoveryValidation.ts`
- Modify: `packages/agent/src/discoverySession.test.ts`
- Modify: `packages/agent/src/discoveryValidation.test.ts`
- Modify: `packages/agent/src/index.ts`

- [ ] **Step 1: Write failing observation behavior tests**

Add a helper that unwraps successful results and these cases to `discoverySession.test.ts`:

```ts
function session() {
  const result = createDiscoverySession(SESSION_INPUT);
  if (!result.ok) throw new Error("fixture session must be valid");
  return result.session;
}

const OBSERVATION_INPUT = {
  id: "observation-1",
  observedAt: "2026-07-13T12:00:01.000Z",
  page: {
    url: "https://example.com/checkout",
    title: "Checkout",
    viewport: { width: 1280, height: 720 },
    navigation: { canGoBack: false },
  },
  visibleStates: [{ id: "visible-cart", kind: "text" as const, summary: "Your cart" }],
  interactiveTargets: [
    {
      id: "target-checkout",
      label: "Checkout",
      role: "button",
      disabled: false,
    },
  ],
  artifacts: [
    {
      id: "artifact-1",
      kind: "screenshot" as const,
      path: "artifacts/observation-1.png",
      mediaType: "image/png" as const,
    },
  ],
};

it("records a sanitized bounded observation without mutating the session", () => {
  const before = session();
  const result = recordDiscoveryObservation(before, OBSERVATION_INPUT);

  expect(result.ok && result.session.observations[0]).toMatchObject({
    id: "observation-1",
    sequence: 1,
    page: { title: "Checkout", navigation: { canGoBack: false } },
  });
  expect(before.observations).toEqual([]);
});

it("rejects duplicate observation ids and unsafe artifact paths", () => {
  const first = recordDiscoveryObservation(session(), OBSERVATION_INPUT);
  if (!first.ok) throw new Error("first observation must be valid");
  expect(recordDiscoveryObservation(first.session, OBSERVATION_INPUT)).toMatchObject({
    ok: false,
    errors: [{ code: "duplicate_discovery_record", recordId: "observation-1" }],
  });
  expect(
    recordDiscoveryObservation(session(), {
      ...OBSERVATION_INPUT,
      artifacts: [{ ...OBSERVATION_INPUT.artifacts[0], path: "../secret.png" }],
    }),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "invalid_discovery_artifact_reference" }],
  });
});
```

- [ ] **Step 2: Run the observation tests to verify the operation is missing**

```bash
rtk npx vitest run packages/agent/src/discoverySession.test.ts
```

Expected: FAIL because `recordDiscoveryObservation()` is not exported.

- [ ] **Step 3: Add exact observation parsing and sanitization**

In `discoveryValidation.ts`, add:

```ts
function sanitizeRequiredPublicText(
  value: unknown,
  path: string,
  errors: DiscoveryContractError[],
): string | undefined {
  if (typeof value !== "string") {
    errors.push(discoveryError("invalid_discovery_input", "Discovery text is required.", { path }));
    return undefined;
  }
  if (value.length > DISCOVERY_LIMITS.publicStringCharacters) {
    errors.push(discoveryError("session_limit_exceeded", "Discovery text is too long.", { path }));
    return undefined;
  }
  const sanitized = sanitizeDiscoveryText(value);
  if (sanitized.length === 0) {
    errors.push(discoveryError("invalid_discovery_input", "Discovery text is empty.", { path }));
    return undefined;
  }
  return sanitized;
}

export function isSafeArtifactPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\")) return false;
  if (value.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function sanitizeObservationInput(
  input: RecordDiscoveryObservationInput,
  sequence: number,
): DiscoveryObservation | DiscoveryContractError[] {
  const errors: DiscoveryContractError[] = [];
  if (!isSafeDiscoveryId(input.id)) {
    errors.push(
      discoveryError("invalid_discovery_input", "Observation id is invalid.", { path: "id" }),
    );
  }
  if (!isNormalizedIsoTime(input.observedAt)) {
    errors.push(
      discoveryError("invalid_discovery_input", "Observation time is invalid.", {
        path: "observedAt",
      }),
    );
  }
  const url = sanitizeDiscoveryUrl(input.page.url);
  if (url === undefined) {
    errors.push(
      discoveryError("unsafe_discovery_url", "Observation URL is unsafe.", { path: "page.url" }),
    );
  }
  const title = sanitizeRequiredPublicText(input.page.title, "page.title", errors);
  if (
    !Number.isInteger(input.page.viewport.width) ||
    input.page.viewport.width <= 0 ||
    !Number.isInteger(input.page.viewport.height) ||
    input.page.viewport.height <= 0 ||
    typeof input.page.navigation.canGoBack !== "boolean"
  ) {
    errors.push(
      discoveryError("invalid_discovery_input", "Observation page state is invalid.", {
        path: "page",
      }),
    );
  }
  for (const [values, maximum, path] of [
    [input.visibleStates, DISCOVERY_LIMITS.visibleStatesPerObservation, "visibleStates"],
    [
      input.interactiveTargets,
      DISCOVERY_LIMITS.interactiveTargetsPerObservation,
      "interactiveTargets",
    ],
    [input.artifacts, DISCOVERY_LIMITS.artifactReferencesPerObservation, "artifacts"],
  ] as const) {
    if (!Array.isArray(values) || values.length > maximum) {
      errors.push(
        discoveryError("session_limit_exceeded", "Observation collection limit exceeded.", {
          path,
        }),
      );
    }
  }

  const nestedIds = new Set<string>();
  const visibleStates = input.visibleStates.flatMap((visible, index) => {
    const path = `visibleStates.${index}`;
    const summary = sanitizeRequiredPublicText(visible.summary, `${path}.summary`, errors);
    if (
      !isSafeDiscoveryId(visible.id) ||
      nestedIds.has(visible.id) ||
      (visible.kind !== "text" && visible.kind !== "status")
    ) {
      errors.push(discoveryError("invalid_discovery_input", "Visible state is invalid.", { path }));
      return [];
    }
    nestedIds.add(visible.id);
    return summary === undefined ? [] : [{ id: visible.id, kind: visible.kind, summary }];
  });

  const interactiveTargets = input.interactiveTargets.flatMap((target, index) => {
    const path = `interactiveTargets.${index}`;
    const label = sanitizeRequiredPublicText(target.label, `${path}.label`, errors);
    const role =
      target.role === undefined
        ? undefined
        : sanitizeRequiredPublicText(target.role, `${path}.role`, errors);
    if (
      !isSafeDiscoveryId(target.id) ||
      nestedIds.has(target.id) ||
      typeof target.disabled !== "boolean" ||
      (target.occurrence !== undefined &&
        (!Number.isInteger(target.occurrence) || target.occurrence < 1)) ||
      (target.actionRisk !== undefined && target.actionRisk !== "potentially-mutating")
    ) {
      errors.push(
        discoveryError("invalid_discovery_input", "Interactive target is invalid.", { path }),
      );
      return [];
    }
    nestedIds.add(target.id);
    if (label === undefined || (target.role !== undefined && role === undefined)) return [];
    return [
      {
        id: target.id,
        label,
        ...(role === undefined ? {} : { role }),
        ...(target.occurrence === undefined ? {} : { occurrence: target.occurrence }),
        disabled: target.disabled,
        ...(target.actionRisk === undefined ? {} : { actionRisk: target.actionRisk }),
      },
    ];
  });

  const artifacts = input.artifacts.flatMap((artifact, index) => {
    const path = `artifacts.${index}`;
    if (
      !isSafeDiscoveryId(artifact.id) ||
      nestedIds.has(artifact.id) ||
      (artifact.kind !== "screenshot" && artifact.kind !== "viewport") ||
      !isSafeArtifactPath(artifact.path) ||
      (artifact.mediaType !== "image/png" && artifact.mediaType !== "image/jpeg") ||
      (artifact.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(artifact.sha256))
    ) {
      errors.push(
        discoveryError("invalid_discovery_artifact_reference", "Artifact reference is invalid.", {
          path,
        }),
      );
      return [];
    }
    nestedIds.add(artifact.id);
    return [structuredClone(artifact)];
  });

  if (errors.length > 0 || url === undefined || title === undefined) return errors;
  return {
    id: input.id,
    sequence,
    observedAt: input.observedAt,
    page: {
      url,
      title,
      viewport: structuredClone(input.page.viewport),
      navigation: { canGoBack: input.page.navigation.canGoBack },
    },
    visibleStates,
    interactiveTargets,
    artifacts,
  };
}
```

Add `isObservation()` using `isRecord()`, `hasOnlyKeys()`, and the same scalar checks, then call it from full-session validation so JSON-loaded observations receive exact-key and relationship checks. Before calling `sanitizeObservationInput()`, reject non-array nested collections and malformed `page` objects with `invalid_discovery_input`; do not access nested properties until those guards pass.

- [ ] **Step 4: Add immutable observation recording**

In `discoverySession.ts`, define:

```ts
export type RecordDiscoveryObservationInput = Omit<DiscoveryObservation, "sequence">;

export function recordDiscoveryObservation(
  session: DiscoverySessionV1,
  input: RecordDiscoveryObservationInput,
): DiscoveryContractResult {
  const active = requireActiveSession(session);
  if (!active.ok) return active;
  if (session.observations.some((observation) => observation.id === input.id)) {
    return {
      ok: false,
      errors: [
        discoveryError("duplicate_discovery_record", "Observation id already exists.", {
          recordId: isSafeDiscoveryId(input.id) ? input.id : undefined,
        }),
      ],
    };
  }
  if (session.observations.length >= DISCOVERY_LIMITS.observations) {
    return limitError("Observation limit reached.");
  }
  const observation = sanitizeObservationInput(input, session.observations.length + 1);
  if (Array.isArray(observation)) return { ok: false, errors: observation };
  return validateCandidate({
    ...structuredClone(session),
    updatedAt: observation.observedAt,
    observations: [...session.observations, observation],
  });
}
```

In the same file, implement shared `requireActiveSession()`, `limitError()`, and `validateCandidate()` helpers. `validateCandidate()` must enforce the evidence-size threshold of `serializedBytes - terminalReserveBytes` for observation and attempt appends, then call `validateDiscoverySession()`.

- [ ] **Step 5: Export observation recording and run focused tests**

Add `recordDiscoveryObservation` and `RecordDiscoveryObservationInput` to the `discoverySession.ts` export block in `index.ts`, then run:

```bash
rtk npx vitest run packages/agent/src/discoverySession.test.ts packages/agent/src/discoveryValidation.test.ts
rtk npm --workspace @auto-demo/agent run typecheck
```

Expected: observation, creation, validation, and immutability tests pass.

- [ ] **Step 6: Commit observation support**

```bash
rtk git add packages/agent/src/discoverySession.ts packages/agent/src/discoveryValidation.ts packages/agent/src/discoverySession.test.ts packages/agent/src/discoveryValidation.test.ts packages/agent/src/index.ts
rtk git commit -m "feat: record bounded discovery observations"
```

### Task 4: Pending And Finalized Attempt Lifecycle

**Files:**

- Modify: `packages/agent/src/discoverySession.ts`
- Modify: `packages/agent/src/discoveryValidation.ts`
- Modify: `packages/agent/src/discoverySession.test.ts`
- Modify: `packages/agent/src/discoveryValidation.test.ts`
- Modify: `packages/agent/src/index.ts`

- [ ] **Step 1: Write failing attempt lifecycle tests**

Add a helper that records `OBSERVATION_INPUT`, then test one successful click, one blocked type action, a pending conflict, and input immutability:

```ts
function observedSession() {
  const result = recordDiscoveryObservation(session(), OBSERVATION_INPUT);
  if (!result.ok) throw new Error("fixture observation must be valid");
  return result.session;
}

const ATTEMPT_INPUT = {
  id: "attempt-1",
  startedAt: "2026-07-13T12:00:02.000Z",
  beforeObservationId: "observation-1",
  action: { kind: "click" as const, targetId: "target-checkout" },
  expectations: [
    {
      id: "expectation-1",
      kind: "navigation" as const,
      origin: "declared-before-action" as const,
      url: "https://example.com/payment",
      match: "same-origin-path" as const,
    },
  ],
  confidence: {
    level: "high" as const,
    bases: ["exact-accessible-target" as const],
  },
};

it("begins and finishes one successful attempt around a resulting observation", () => {
  const begun = beginDiscoveryAttempt(observedSession(), ATTEMPT_INPUT);
  expect(begun.ok && begun.session.attempts[0].status).toBe("pending");
  if (!begun.ok) throw new Error("attempt must begin");

  const after = recordDiscoveryObservation(begun.session, {
    ...OBSERVATION_INPUT,
    id: "observation-2",
    observedAt: "2026-07-13T12:00:03.000Z",
    page: { ...OBSERVATION_INPUT.page, url: "https://example.com/payment", title: "Payment" },
    visibleStates: [{ id: "visible-payment", kind: "text", summary: "Payment details" }],
  });
  if (!after.ok) throw new Error("resulting observation must be valid");

  const finished = finishDiscoveryAttempt(after.session, "attempt-1", {
    status: "succeeded",
    finishedAt: "2026-07-13T12:00:04.000Z",
    afterObservationId: "observation-2",
    derivedExpectations: [
      {
        id: "expectation-2",
        kind: "visible-state",
        origin: "derived-from-observation",
        targetId: "visible-payment",
      },
    ],
    observedEffects: [
      {
        expectationId: "expectation-1",
        status: "matched",
        observationId: "observation-2",
        summary: "Reached payment",
      },
      {
        expectationId: "expectation-2",
        status: "matched",
        observationId: "observation-2",
        summary: "Payment details are visible",
      },
    ],
    outcome: { code: "action_completed", summary: "Checkout opened payment" },
  });

  expect(finished.ok && finished.session.attempts[0]).toMatchObject({
    status: "succeeded",
    afterObservationId: "observation-2",
  });
});

it("rejects a second pending attempt", () => {
  const begun = beginDiscoveryAttempt(observedSession(), ATTEMPT_INPUT);
  if (!begun.ok) throw new Error("attempt must begin");
  expect(beginDiscoveryAttempt(begun.session, { ...ATTEMPT_INPUT, id: "attempt-2" })).toMatchObject(
    { ok: false, errors: [{ code: "pending_attempt_conflict" }] },
  );
});
```

Add this separate test proving a `type` action accepts only `inputBinding`:

```ts
it("rejects persisted type values without exposing them", () => {
  const unsafe = {
    ...ATTEMPT_INPUT,
    action: {
      kind: "type",
      targetId: "target-checkout",
      inputBinding: "companyName",
      valueClass: "demo-data",
      value: "password=hunter2",
    },
  } as unknown as typeof ATTEMPT_INPUT;

  const result = beginDiscoveryAttempt(observedSession(), unsafe);
  expect(result).toMatchObject({
    ok: false,
    errors: [{ code: "unsafe_discovery_content" }],
  });
  expect(JSON.stringify(result)).not.toContain("hunter2");
});
```

- [ ] **Step 2: Run the attempt tests to verify lifecycle operations are missing**

```bash
rtk npx vitest run packages/agent/src/discoverySession.test.ts
```

Expected: FAIL because `beginDiscoveryAttempt()` and `finishDiscoveryAttempt()` are not exported.

- [ ] **Step 3: Implement attempt parsing and relationship validation**

In `discoveryValidation.ts`, add exact parsers for:

- action union fields and target lookup against `beforeObservationId`;
- wait duration from `0` through `DISCOVERY_LIMITS.waitDurationMs`;
- binding keys and all record IDs;
- navigation and visible-state expectation unions;
- exactly one of `targetId` and `publicCondition` for visible-state expectations;
- non-empty unique confidence bases from the fixed allowlist;
- finalized status, timestamps, safe outcome code, derived expectations, observed effects, and optional after-observation reference;
- unique expectation IDs across declared and derived arrays;
- observed effects that each reference one expectation and the declared resulting observation;
- `succeeded` attempts with no `not-matched` effects;
- `retryOfAttemptId` that references an earlier finalized attempt.

Expose these functions to `discoverySession.ts`:

```ts
export function sanitizeAttemptInput(
  session: DiscoverySessionV1,
  input: BeginDiscoveryAttemptInput,
  sequence: number,
): PendingDiscoveryAttempt | DiscoveryContractError[];

export function finalizeAttemptInput(
  session: DiscoverySessionV1,
  attempt: PendingDiscoveryAttempt,
  input: FinishDiscoveryAttemptInput,
): FinalizedDiscoveryAttempt | DiscoveryContractError[];
```

Extend `validateDiscoverySession()` so loaded artifacts use the same parsers and allowlists rather than TypeScript casts.

- [ ] **Step 4: Implement immutable begin and finish operations**

Add these input types and operations to `discoverySession.ts`:

```ts
export type BeginDiscoveryAttemptInput = Omit<PendingDiscoveryAttempt, "sequence" | "status">;

export type FinishDiscoveryAttemptInput = Omit<
  FinalizedDiscoveryAttempt,
  keyof DiscoveryAttemptBase | "sequence"
>;

export function beginDiscoveryAttempt(
  session: DiscoverySessionV1,
  input: BeginDiscoveryAttemptInput,
): DiscoveryContractResult {
  const active = requireActiveSession(session);
  if (!active.ok) return active;
  if (session.attempts.some((attempt) => attempt.status === "pending")) {
    return {
      ok: false,
      errors: [discoveryError("pending_attempt_conflict", "A discovery attempt is pending.")],
    };
  }
  if (session.attempts.some((attempt) => attempt.id === input.id)) {
    return duplicateAttemptError(input.id);
  }
  if (session.attempts.length >= DISCOVERY_LIMITS.attempts) {
    return limitError("Attempt limit reached.");
  }
  const attempt = sanitizeAttemptInput(session, input, session.attempts.length + 1);
  if (Array.isArray(attempt)) return { ok: false, errors: attempt };
  return validateCandidate({
    ...structuredClone(session),
    updatedAt: attempt.startedAt,
    attempts: [...session.attempts, attempt],
  });
}

export function finishDiscoveryAttempt(
  session: DiscoverySessionV1,
  attemptId: string,
  input: FinishDiscoveryAttemptInput,
): DiscoveryContractResult {
  const active = requireActiveSession(session);
  if (!active.ok) return active;
  const index = session.attempts.findIndex((attempt) => attempt.id === attemptId);
  const pending = index === -1 ? undefined : session.attempts[index];
  if (pending?.status !== "pending") {
    return {
      ok: false,
      errors: [
        discoveryError("pending_attempt_required", "Pending attempt not found.", {
          recordId: isSafeDiscoveryId(attemptId) ? attemptId : undefined,
        }),
      ],
    };
  }
  const finalized = finalizeAttemptInput(session, pending, input);
  if (Array.isArray(finalized)) return { ok: false, errors: finalized };
  const attempts = session.attempts.map((attempt, attemptIndex) =>
    attemptIndex === index ? finalized : attempt,
  );
  return validateCandidate({
    ...structuredClone(session),
    updatedAt: finalized.finishedAt,
    attempts,
  });
}
```

Define `duplicateAttemptError()` beside the other lifecycle error helpers.

- [ ] **Step 5: Export attempt operations and run focused tests**

Export `beginDiscoveryAttempt`, `finishDiscoveryAttempt`, and both input types from `index.ts`, then run:

```bash
rtk npx vitest run packages/agent/src/discoverySession.test.ts packages/agent/src/discoveryValidation.test.ts
rtk npm --workspace @auto-demo/agent run typecheck
```

Expected: attempt, observation, creation, validation, sanitization, and immutability tests pass.

- [ ] **Step 6: Commit attempt lifecycle support**

```bash
rtk git add packages/agent/src/discoverySession.ts packages/agent/src/discoveryValidation.ts packages/agent/src/discoverySession.test.ts packages/agent/src/discoveryValidation.test.ts packages/agent/src/index.ts
rtk git commit -m "feat: record discovery attempt outcomes"
```

### Task 5: Selected Paths, Terminal States, And Child Lineage

**Files:**

- Modify: `packages/agent/src/discoverySession.ts`
- Modify: `packages/agent/src/discoveryValidation.ts`
- Modify: `packages/agent/src/discoverySession.test.ts`
- Modify: `packages/agent/src/discoveryValidation.test.ts`
- Modify: `packages/agent/src/index.ts`

- [ ] **Step 1: Write failing path and terminal behavior tests**

Refactor the successful-attempt setup from Task 4 into `successfulAttemptSession()`. Add tests that:

```ts
it("selects and completes one continuous evidence-backed path", () => {
  const ready = successfulAttemptSession();
  const selected = selectDiscoveryPath(ready, {
    attemptIds: ["attempt-1"],
    selectedAt: "2026-07-13T12:00:05.000Z",
    source: "host-agent",
  });
  if (!selected.ok) throw new Error("path must select");

  const completed = completeDiscoverySession(selected.session, {
    completedAt: "2026-07-13T12:00:06.000Z",
  });
  expect(completed.ok && completed.session).toMatchObject({
    status: "completed",
    selectedPath: { attemptIds: ["attempt-1"], source: "host-agent" },
    terminal: { status: "completed", completedAt: "2026-07-13T12:00:06.000Z" },
  });
  if (!completed.ok) throw new Error("session must complete");
  expect(recordDiscoveryObservation(completed.session, OBSERVATION_INPUT)).toMatchObject({
    ok: false,
    errors: [{ code: "terminal_discovery_session" }],
  });
});

it("rejects failed, duplicated, reordered, and disconnected selected attempts", () => {
  const ready = successfulAttemptSession();
  expect(
    selectDiscoveryPath(ready, {
      attemptIds: ["missing-attempt"],
      selectedAt: "2026-07-13T12:00:05.000Z",
      source: "host-agent",
    }),
  ).toMatchObject({ ok: false, errors: [{ code: "invalid_selected_path" }] });
});

it("creates a new active child instead of reopening a terminal session", () => {
  const failed = failDiscoverySession(observedSession(), {
    failedAt: "2026-07-13T12:00:05.000Z",
    reason: { code: "browser_unavailable", summary: "Browser became unavailable" },
  });
  if (!failed.ok) throw new Error("session must fail");
  const child = createChildDiscoverySession(failed.session, {
    ...SESSION_INPUT,
    id: "session-checkout-repair-1",
    createdAt: "2026-07-13T12:01:00.000Z",
  });
  expect(child.ok && child.session).toMatchObject({
    status: "active",
    parentSessionId: "session-checkout",
    observations: [],
    attempts: [],
  });
});
```

Add a table-driven validator test that starts from the successfully selected artifact and applies these exact mutations:

```ts
it("rejects corrupted selected-path relationships", () => {
  const selected = selectDiscoveryPath(successfulAttemptSession(), {
    attemptIds: ["attempt-1"],
    selectedAt: "2026-07-13T12:00:05.000Z",
    source: "host-agent",
  });
  if (!selected.ok) throw new Error("fixture path must select");

  const corruptions: Array<{
    name: string;
    mutate(session: DiscoverySessionV1): void;
    code: string;
  }> = [
    {
      name: "empty path",
      mutate: (value) => {
        value.selectedPath = { ...value.selectedPath!, attemptIds: [] };
      },
      code: "invalid_selected_path",
    },
    {
      name: "pending attempt",
      mutate: (value) => {
        value.attempts[0].status = "pending";
      },
      code: "invalid_selected_path",
    },
    {
      name: "unmatched expectation",
      mutate: (value) => {
        const attempt = value.attempts[0] as FinalizedDiscoveryAttempt;
        attempt.observedEffects[0].status = "not-matched";
      },
      code: "expectation_evidence_missing",
    },
    {
      name: "missing visible evidence",
      mutate: (value) => {
        const attempt = value.attempts[0] as FinalizedDiscoveryAttempt;
        attempt.derivedExpectations = [];
        attempt.observedEffects = attempt.observedEffects.filter(
          (effect) => effect.expectationId !== "expectation-2",
        );
      },
      code: "invalid_selected_path",
    },
    {
      name: "non-increasing sequence",
      mutate: (value) => {
        value.attempts[0].sequence = 0;
      },
      code: "invalid_discovery_session",
    },
  ];

  for (const testCase of corruptions) {
    const value = structuredClone(selected.session);
    testCase.mutate(value);
    expect(validateDiscoverySession(value), testCase.name).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: testCase.code })]),
    });
  }
});
```

Build a two-attempt fixture through the public operations and assert that reversing its IDs and changing the second `beforeObservationId` both return `invalid_selected_path`. Add direct lifecycle tests that move `updatedAt` backward and call every mutation operation on completed, failed, and abandoned sessions; each must return `invalid_discovery_transition` or `terminal_discovery_session` without changing the terminal artifact.

- [ ] **Step 2: Run path tests to verify selection and terminal operations are missing**

```bash
rtk npx vitest run packages/agent/src/discoverySession.test.ts
```

Expected: FAIL because selection, terminal, and child-session operations are not exported.

- [ ] **Step 3: Implement selected-path integrity validation**

In `discoveryValidation.ts`, implement:

```ts
function pathError(message: string, recordId?: string): DiscoveryContractError {
  return discoveryError("invalid_selected_path", message, { recordId });
}

export function validateSelectedPath(
  session: DiscoverySessionV1,
  selectedPath: DiscoverySelectedPath,
): DiscoveryContractError[] {
  const errors: DiscoveryContractError[] = [];
  if (
    selectedPath.attemptIds.length === 0 ||
    selectedPath.attemptIds.length > DISCOVERY_LIMITS.selectedPathAttempts
  ) {
    return [
      selectedPath.attemptIds.length > DISCOVERY_LIMITS.selectedPathAttempts
        ? discoveryError("session_limit_exceeded", "Selected path is too long.", {
            path: "selectedPath.attemptIds",
          })
        : pathError("Selected path must not be empty."),
    ];
  }
  if (
    !isNormalizedIsoTime(selectedPath.selectedAt) ||
    (selectedPath.source !== "host-agent" && selectedPath.source !== "user-directed")
  ) {
    errors.push(pathError("Selected path metadata is invalid."));
  }
  const attempts = new Map(session.attempts.map((attempt) => [attempt.id, attempt]));
  const observations = new Map(
    session.observations.map((observation) => [observation.id, observation]),
  );
  const seen = new Set<string>();
  let previousAfterObservationId: string | undefined;
  let previousSequence = 0;
  let hasVisibleEvidence = false;

  for (const attemptId of selectedPath.attemptIds) {
    if (seen.has(attemptId)) {
      errors.push(pathError("Selected path contains a duplicate attempt.", attemptId));
      continue;
    }
    seen.add(attemptId);
    const attempt = attempts.get(attemptId);
    if (attempt === undefined || attempt.status !== "succeeded") {
      errors.push(pathError("Selected attempt must exist and succeed.", attemptId));
      continue;
    }
    if (attempt.sequence <= previousSequence) {
      errors.push(pathError("Selected attempt order is invalid.", attemptId));
    }
    if (
      previousAfterObservationId !== undefined &&
      attempt.beforeObservationId !== previousAfterObservationId
    ) {
      errors.push(pathError("Selected attempt observations are disconnected.", attemptId));
    }
    const before = observations.get(attempt.beforeObservationId);
    const after =
      attempt.afterObservationId === undefined
        ? undefined
        : observations.get(attempt.afterObservationId);
    if (before === undefined || after === undefined) {
      errors.push(pathError("Selected attempt observation is missing.", attemptId));
      continue;
    }
    if (attempt.action.kind === "click" || attempt.action.kind === "type") {
      if (!before.interactiveTargets.some((target) => target.id === attempt.action.targetId)) {
        errors.push(pathError("Selected action target is missing.", attemptId));
      }
    }

    const expectations = [...attempt.expectations, ...attempt.derivedExpectations];
    for (const expectation of expectations) {
      const effects = attempt.observedEffects.filter(
        (effect) => effect.expectationId === expectation.id,
      );
      if (
        effects.length !== 1 ||
        effects[0].status !== "matched" ||
        effects[0].observationId !== after.id
      ) {
        errors.push(
          discoveryError("expectation_evidence_missing", "Expectation lacks matched evidence.", {
            recordId: attemptId,
          }),
        );
      }
      if (expectation.kind === "visible-state") {
        hasVisibleEvidence = true;
        const targetExists =
          expectation.targetId === undefined ||
          after.visibleStates.some((state) => state.id === expectation.targetId) ||
          after.interactiveTargets.some((target) => target.id === expectation.targetId);
        if (!targetExists) errors.push(pathError("Visible-state target is missing.", attemptId));
      }
    }
    if (attempt.action.kind === "navigate") {
      const navigation = expectations.find(
        (expectation) =>
          expectation.kind === "navigation" &&
          matchesNavigationExpectation(expectation, after.page.url),
      );
      if (navigation === undefined) {
        errors.push(pathError("Navigation attempt lacks matched destination evidence.", attemptId));
      }
    }
    previousAfterObservationId = attempt.afterObservationId;
    previousSequence = attempt.sequence;
  }
  if (!hasVisibleEvidence) {
    errors.push(pathError("Selected path requires visible-state evidence."));
  }
  return errors;
}
```

Use a `Map` for attempts and observations, and compare references rather than array positions. Add `matchesNavigationExpectation(expected, actual)` with these exact rules:

```ts
export function matchesNavigationExpectation(
  expected: DiscoveryExpectation,
  actualUrl: string,
): boolean {
  if (expected.kind !== "navigation") return false;
  const expectedUrl = new URL(expected.url);
  const actual = new URL(actualUrl);
  if (expected.match === "exact-url") return expectedUrl.toString() === actual.toString();
  const effectivePort = (url: URL) =>
    url.port || (url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : "");
  return (
    expectedUrl.protocol === actual.protocol &&
    expectedUrl.hostname === actual.hostname &&
    effectivePort(expectedUrl) === effectivePort(actual) &&
    expectedUrl.pathname === actual.pathname
  );
}
```

Extend `validateDiscoverySession()` with status/terminal correspondence, pending-attempt constraints, selected-path validation, monotonic sequences, normalized timestamps, and parent-session rules.

- [ ] **Step 4: Implement immutable selection and terminal operations**

Add exact public inputs and operations to `discoverySession.ts`:

```ts
export type SelectDiscoveryPathInput = DiscoverySelectedPath;
export type CompleteDiscoverySessionInput = { completedAt: string };
export type FailDiscoverySessionInput = {
  failedAt: string;
  reason: { code: string; summary: string };
};
export type AbandonDiscoverySessionInput = {
  abandonedAt: string;
  reason: { code: string; summary: string };
};

export function selectDiscoveryPath(
  session: DiscoverySessionV1,
  input: SelectDiscoveryPathInput,
): DiscoveryContractResult {
  const active = requireActiveSession(session);
  if (!active.ok) return active;
  if (session.attempts.some((attempt) => attempt.status === "pending")) {
    return {
      ok: false,
      errors: [discoveryError("pending_attempt_conflict", "A discovery attempt is pending.")],
    };
  }
  const selectedPath = structuredClone(input);
  const timeError = validateTransitionTime(session, selectedPath.selectedAt, "selectedAt");
  if (timeError !== undefined) return { ok: false, errors: [timeError] };
  const errors = validateSelectedPath(session, selectedPath);
  if (errors.length > 0) return { ok: false, errors };
  return validateFullCandidate({
    ...structuredClone(session),
    updatedAt: selectedPath.selectedAt,
    selectedPath,
  });
}

export function completeDiscoverySession(
  session: DiscoverySessionV1,
  input: CompleteDiscoverySessionInput,
): DiscoveryContractResult {
  const active = requireActiveSession(session);
  if (!active.ok) return active;
  if (session.selectedPath === undefined) {
    return {
      ok: false,
      errors: [discoveryError("invalid_selected_path", "Completed session requires a path.")],
    };
  }
  if (session.attempts.some((attempt) => attempt.status === "pending")) {
    return {
      ok: false,
      errors: [discoveryError("pending_attempt_conflict", "A discovery attempt is pending.")],
    };
  }
  const timeError = validateTransitionTime(session, input.completedAt, "completedAt");
  if (timeError !== undefined) return { ok: false, errors: [timeError] };
  return validateFullCandidate({
    ...structuredClone(session),
    status: "completed",
    updatedAt: input.completedAt,
    terminal: { status: "completed", completedAt: input.completedAt },
  });
}

export function failDiscoverySession(
  session: DiscoverySessionV1,
  input: FailDiscoverySessionInput,
): DiscoveryContractResult {
  return terminateWithReason(session, "failed", input.failedAt, input.reason);
}

export function abandonDiscoverySession(
  session: DiscoverySessionV1,
  input: AbandonDiscoverySessionInput,
): DiscoveryContractResult {
  return terminateWithReason(session, "abandoned", input.abandonedAt, input.reason);
}

export function createChildDiscoverySession(
  terminalSession: DiscoverySessionV1,
  input: Omit<CreateDiscoverySessionInput, "parentSessionId">,
): DiscoveryContractResult {
  if (terminalSession.status === "active" || terminalSession.terminal === undefined) {
    return {
      ok: false,
      errors: [discoveryError("invalid_discovery_transition", "Child requires terminal parent.")],
    };
  }
  if (input.id === terminalSession.id) {
    return {
      ok: false,
      errors: [discoveryError("invalid_discovery_input", "Child session id must be new.")],
    };
  }
  return createDiscoverySession({ ...input, parentSessionId: terminalSession.id });
}

function validateTransitionTime(
  session: DiscoverySessionV1,
  value: string,
  path: string,
): DiscoveryContractError | undefined {
  if (!isNormalizedIsoTime(value) || value < session.updatedAt) {
    return discoveryError("invalid_discovery_transition", "Transition time is invalid.", { path });
  }
  return undefined;
}

function terminateWithReason(
  session: DiscoverySessionV1,
  status: "failed" | "abandoned",
  at: string,
  reason: { code: string; summary: string },
): DiscoveryContractResult {
  const active = requireActiveSession(session);
  if (!active.ok) return active;
  const timeError = validateTransitionTime(
    session,
    at,
    status === "failed" ? "failedAt" : "abandonedAt",
  );
  if (timeError !== undefined) return { ok: false, errors: [timeError] };
  if (
    !isSafeDiscoveryId(reason.code) ||
    reason.summary.length > DISCOVERY_LIMITS.publicStringCharacters
  ) {
    return {
      ok: false,
      errors: [discoveryError("invalid_discovery_input", "Terminal reason is invalid.")],
    };
  }
  const summary = sanitizeDiscoveryText(reason.summary);
  if (summary.length === 0) {
    return {
      ok: false,
      errors: [discoveryError("invalid_discovery_input", "Terminal reason is empty.")],
    };
  }
  const terminal =
    status === "failed"
      ? { status: "failed" as const, failedAt: at, reason: { code: reason.code, summary } }
      : { status: "abandoned" as const, abandonedAt: at, reason: { code: reason.code, summary } };
  return validateFullCandidate({
    ...structuredClone(session),
    status,
    updatedAt: at,
    terminal,
  });
}
```

Add `validateFullCandidate()` beside `validateCandidate()`. It checks the full `serializedBytes` limit without subtracting the terminal reserve, then calls `validateDiscoverySession()`. Full-session validation permits a pending attempt only when status is `active`, `failed`, or `abandoned`; completed sessions reject it.

- [ ] **Step 5: Export lifecycle operations and run focused tests**

Export all five operations and their input types from `index.ts`, then run:

```bash
rtk npx vitest run packages/agent/src/discoverySession.test.ts packages/agent/src/discoveryValidation.test.ts
rtk npm --workspace @auto-demo/agent run typecheck
```

Expected: selection, terminal, child-lineage, attempt, observation, and validation tests pass.

- [ ] **Step 6: Commit selected-path and terminal support**

```bash
rtk git add packages/agent/src/discoverySession.ts packages/agent/src/discoveryValidation.ts packages/agent/src/discoverySession.test.ts packages/agent/src/discoveryValidation.test.ts packages/agent/src/index.ts
rtk git commit -m "feat: finalize discovery session paths"
```

### Task 6: Security, Limits, And Portable Fixtures

**Files:**

- Modify: `packages/agent/src/discoverySession.test.ts`
- Modify: `packages/agent/src/discoveryValidation.test.ts`
- Create: `packages/agent/fixtures/discovery-session-completed.json`
- Create: `packages/agent/fixtures/discovery-session-with-abandoned-attempts.json`
- Create: `packages/agent/fixtures/discovery-session-invalid-version.json`
- Create: `packages/agent/fixtures/discovery-session-invalid-reference.json`
- Create: `packages/agent/fixtures/discovery-session-unsafe-content.json`
- Modify: `packages/agent/src/wrapper-docs.test.ts`

- [ ] **Step 1: Add failing cross-field security and hard-limit tests**

Add table-driven tests to `discoveryValidation.test.ts` that inject each secret into `goal`, host/model fields, page title, visible-state summary, target label/role, confidence note, expectation condition, observed-effect summary, outcome summary, terminal reason, and unknown properties. Use these values:

```ts
const SECRET_VALUES = [
  "password=hunter2",
  "Bearer abcdefghijklmnop",
  "sk-live-secretvalue",
  "eyJhbGciOiJIUzI1NiJ9.payload.signature",
  "token=abcdefghijklmnopqrstuvwx1234",
];

it("sanitizes secret-like public input and never echoes rejected values", () => {
  for (const secret of SECRET_VALUES) {
    const created = createDiscoverySession({
      id: "session-secret-check",
      target: { kind: "browser", startUrl: "https://example.com" },
      goal: `Show checkout with ${secret}`,
      host: { name: "codex", version: "1.0.0" },
      createdAt: "2026-07-13T12:00:00.000Z",
    });
    expect(JSON.stringify(created)).not.toContain(secret);
  }

  const rejected = validateDiscoverySession({
    schemaVersion: 1,
    extraSecret: "password=hunter2",
  });
  expect(rejected).toMatchObject({
    ok: false,
    errors: [{ code: "unsafe_discovery_content", path: "extraSecret" }],
  });
  expect(JSON.stringify(rejected)).not.toContain("hunter2");
});

it.each([
  "/absolute.png",
  "../secret.png",
  "artifacts\\secret.png",
  "a//b.png",
  "https://example.com/a.png",
])("rejects unsafe artifact path %s", (path) => {
  expect(
    recordDiscoveryObservation(session(), {
      ...OBSERVATION_INPUT,
      artifacts: [{ ...OBSERVATION_INPUT.artifacts[0], path }],
    }),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "invalid_discovery_artifact_reference" }],
  });
});
```

Repeat the secret-injection assertion for host/model fields, page title, visible-state summary, target label/role, confidence note, expectation condition, observed-effect summary, outcome summary, and terminal reason. Add generated limit cases using `Array.from({ length: limit + 1 }, (_, index) => ...)` for 257 observations, 257 attempts, 129 selected IDs, 101 targets, 51 visible states, 9 artifacts, 129-character IDs, 2,001-character public strings, 30,001 ms waits, and serialized evidence above `serializedBytes - terminalReserveBytes`. Each operation must return `session_limit_exceeded` while preserving the prior input artifact.

- [ ] **Step 2: Run security and limit tests to expose incomplete checks**

```bash
rtk npx vitest run packages/agent/src/discoveryValidation.test.ts packages/agent/src/discoverySession.test.ts
```

Expected: at least one new table or bound case fails until all nested allowlists and size checks are complete.

- [ ] **Step 3: Complete nested allowlists and error accumulation**

Update `discoveryValidation.ts` so every object validator uses an exact allowed-key set, every list enforces its fixed count, every identifier and public string uses its specific length, and loaded artifacts accumulate independent safe errors. Ensure validation errors include only constant messages, allowlisted field paths, and already-validated record IDs.

Add a final serialized-output assertion to every successful lifecycle operation:

```ts
const serialized = JSON.stringify(result);
for (const secret of SECRET_VALUES) expect(serialized).not.toContain(secret);
expect(serialized).not.toContain("extraSecret");
```

Do not include raw rejected values in `message`, `path`, or `recordId`.

- [ ] **Step 4: Create the five JSON fixtures from public operations**

Use a temporary TypeScript test helper inside `discoveryValidation.test.ts` to build the two valid fixtures entirely through public lifecycle operations, compare the resulting objects with parsed fixture files, and validate both with `validateDiscoverySession()`. Hand-author the three small invalid fixtures with these exact defects:

- `discovery-session-invalid-version.json`: `{ "schemaVersion": 2 }`.
- `discovery-session-invalid-reference.json`: a structurally valid completed session whose selected path contains `attempt-missing`.
- `discovery-session-unsafe-content.json`: a structurally valid active session plus `extraSecret` and artifact path `../secret.png`.

The completed fixture must contain navigate/click evidence and one matched visible-state expectation. The abandoned-exploration fixture must contain one failed attempt and one succeeded attempt while selecting only the succeeded ID.

- [ ] **Step 5: Add fixture contract coverage to wrapper-docs tests**

Extend `wrapper-docs.test.ts` with:

```ts
it("publishes portable discovery session fixtures", async () => {
  const completed = JSON.parse(await readAgentDoc("fixtures/discovery-session-completed.json"));
  const explored = JSON.parse(
    await readAgentDoc("fixtures/discovery-session-with-abandoned-attempts.json"),
  );

  expect(validateDiscoverySession(completed)).toMatchObject({
    ok: true,
    session: { status: "completed", selectedPath: { attemptIds: expect.any(Array) } },
  });
  expect(validateDiscoverySession(explored)).toMatchObject({
    ok: true,
    session: { status: "completed" },
  });
  expect(explored.attempts.some((attempt: { status: string }) => attempt.status === "failed")).toBe(
    true,
  );
  expect(explored.selectedPath.attemptIds).not.toContain("attempt-abandoned");
});
```

Import `validateDiscoverySession` from `index.ts` at the top of the test.

- [ ] **Step 6: Run all agent-package tests**

```bash
rtk npm --workspace @auto-demo/agent test
```

Expected: all agent-package tests pass, including the new contract, security, and fixture coverage.

- [ ] **Step 7: Commit security and fixtures**

```bash
rtk git add packages/agent/src/discoverySession.test.ts packages/agent/src/discoveryValidation.test.ts packages/agent/src/wrapper-docs.test.ts packages/agent/fixtures/discovery-session-completed.json packages/agent/fixtures/discovery-session-with-abandoned-attempts.json packages/agent/fixtures/discovery-session-invalid-version.json packages/agent/fixtures/discovery-session-invalid-reference.json packages/agent/fixtures/discovery-session-unsafe-content.json
rtk git commit -m "test: cover discovery contract safety"
```

### Task 7: Public Documentation And Repository Verification

**Files:**

- Modify: `packages/agent/README.md`
- Modify: `README.md`
- Modify: `packages/agent/src/wrapper-docs.test.ts`
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Write failing documentation assertions**

Add a wrapper-docs test that reads both READMEs and asserts all approved public boundaries:

```ts
it("documents the WES-183 discovery contract without claiming a live workflow", async () => {
  const agentReadme = normalizeWhitespace(await readAgentDoc("README.md"));
  const rootReadme = normalizeWhitespace(await readRootDoc("README.md"));
  const combined = `${agentReadme} ${rootReadme}`;

  for (const required of [
    "DiscoverySessionV1",
    "createDiscoverySession()",
    "recordDiscoveryObservation()",
    "beginDiscoveryAttempt()",
    "finishDiscoveryAttempt()",
    "selectDiscoveryPath()",
    "completeDiscoverySession()",
    "runtime-only input bindings",
    "completed, failed, and abandoned sessions are terminal",
    "WES-184",
    "WES-185",
    "WES-186",
    "WES-187",
  ]) {
    expect(combined).toContain(required);
  }
  expect(combined).toContain("does not yet expose a discovery CLI");
  expect(combined).not.toContain("autodemo agent discover");
});
```

- [ ] **Step 2: Run the docs test to verify documentation is missing**

```bash
rtk npx vitest run packages/agent/src/wrapper-docs.test.ts
```

Expected: FAIL because the READMEs do not describe the discovery contract.

- [ ] **Step 3: Document the contract and explicit deferrals**

Add `## Agentic Discovery Session Contract` to `packages/agent/README.md`. Include a concise TypeScript example that creates an active session with explicit ID/time, records an observation, begins and finishes an attempt, selects its ID, and completes the session. State that:

- the JSON artifact is versioned and bounded;
- typed values use runtime-only input bindings;
- attempts retain abandoned exploration outside the selected path;
- completed, failed, and abandoned sessions are terminal;
- WES-184 through WES-187 own observation extraction, browser control, safety policy, and plan compilation;
- the package does not yet expose a discovery CLI or live browser workflow.

Update the root README status paragraph and `@auto-demo/agent` package bullet with the same accurate contract-only status. Do not add any command example.

- [ ] **Step 4: Run focused docs, type, build, and package tests**

```bash
rtk npx vitest run packages/agent/src/wrapper-docs.test.ts
rtk npm --workspace @auto-demo/agent run typecheck
rtk npm --workspace @auto-demo/agent run build
rtk npm --workspace @auto-demo/agent test
```

Expected: all commands exit 0 with no failed tests or TypeScript errors.

- [ ] **Step 5: Run full repository validation**

```bash
rtk npm run validate
```

Expected: workspace build, typecheck, ESLint, all tests, and Prettier validation pass.

- [ ] **Step 6: Commit implementation documentation**

```bash
rtk git add README.md packages/agent/README.md packages/agent/src/wrapper-docs.test.ts
rtk git commit -m "docs: describe discovery session contract"
```

- [ ] **Step 7: Run the Linear completion gate before making a done claim**

Invoke `linear-sync-gate` in `completion-gate` mode with candidate issue WES-183, this design spec, this implementation plan, changed files, focused test evidence, full `npm run validate` evidence, and current commit IDs. Reconcile WES-184 and WES-186 as direct dependents, WES-182 as the tracker, and WES-184 as the next-task pointer.

Apply only clear completion-gate writes: add concise non-secret evidence to WES-183, move it to Done only if every success criterion and verification command passed, add readiness notes to WES-184 and WES-186, and update `docs/linear/auto-demo-project-structure.md`. Block the done claim if the gate finds conflicting scope, missing verification, or an uncertain issue state.

- [ ] **Step 8: Verify the final project-map-only synchronization diff**

```bash
rtk git diff --check
rtk git status --short
```

Expected: `git diff --check` exits 0; status shows only the intended project-map completion update plus any explicitly preserved pre-existing user files.

- [ ] **Step 9: Commit the completion synchronization**

```bash
rtk git add docs/linear/auto-demo-project-structure.md
rtk git commit -m "docs: sync WES-183 completion evidence"
```

Do not stage or modify the pre-existing unrelated `check-codex-usage` documents or `packages/agent/skills/auto-demo-linear-brainstorming/` files.
