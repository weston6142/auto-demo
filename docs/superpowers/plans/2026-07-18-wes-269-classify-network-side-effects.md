# WES-269 Network Side-Effect Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify browser network side effects and expose bounded sanitized diagnostics without retaining secret-bearing request data.

**Architecture:** A pure `discoveryNetworkClassification` module converts minimal transient request metadata into closed-enum classifications. The existing Chromium policy guard consumes that classification, aggregates blocked requests, and passes sanitized evidence through the generic rehearsal driver boundary so the controller can report whether declared visible expectations were prevented. Replay remains fail closed and does not persist diagnostics.

**Tech Stack:** TypeScript, Playwright Chromium/CDP, Vitest, npm workspaces.

**Execution:** The `linear-deliver-next-task` standing authorization selects inline execution in the current checkout. The main agent owns all writes and follows each RED-GREEN-REFACTOR checkbox without a worktree or implementation subagent.

---

## File Structure

- Create `packages/agent/src/discoveryNetworkClassification.ts`: public pure classification types, classifier, bounded blocked-request evidence types, and fixed diagnostic conversion.
- Create `packages/agent/src/discoveryNetworkClassification.test.ts`: black-box classifier and secret non-retention coverage.
- Modify `packages/agent/src/discoveryRehearsal.ts`: carry sanitized blocked-network evidence from a failed driver result to the public result and compute visible-effect prevention after observation.
- Modify `packages/agent/src/discoveryRehearsal.test.ts`: behavior coverage for blocked-network diagnostics with matched and unmatched expectations.
- Modify `packages/agent/src/discoveryPolicy.ts`: add the neutral classified-network outcome and summary while retaining historical type compatibility only where required.
- Modify `packages/agent/src/playwrightDiscoveryPolicyGuard.ts`: classify every intercepted request, make network decisions from the classification, aggregate bounded evidence, and return it on network violations.
- Modify `packages/agent/src/playwrightDiscoveryPolicyGuard.test.ts`: browser-level classification, aggregation, bounds, and secret-safety coverage.
- Modify `packages/agent/src/playwrightPolicyDiscoveryRehearsal.ts`: translate guard network evidence into the generic driver-result boundary.
- Modify `packages/agent/src/playwrightPolicyDiscoveryRehearsal.test.ts`: public controller diagnostics and visible-effect-prevention coverage.
- Modify `packages/agent/src/playwrightDiscoveryReplay.test.ts`: regression coverage that classified network blocks remain replay hard boundaries.
- Modify `packages/agent/src/index.ts`: export the classifier and diagnostic contracts.
- Modify `packages/agent/package.json`: include the new focused test file in the package test command.
- Modify `packages/agent/README.md`, `packages/agent/skills/codex-auto-demo/SKILL.md`, `packages/agent/claude-wrapper-parity.md`, and `README.md`: document sanitized classification and preserve the WES-266 policy boundary.
- Modify `packages/agent/src/wrapper-docs.test.ts`: require wrapper documentation to describe WES-269 as available while leaving public-browse policy unsupported until WES-266.
- Modify `docs/linear/auto-demo-project-structure.md`: record design, plan, implementation, verification, PR, and deterministic next-task evidence.

### Task 1: Pure Request Classification Contract

**Files:**

- Create: `packages/agent/src/discoveryNetworkClassification.test.ts`
- Create: `packages/agent/src/discoveryNetworkClassification.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/package.json`

- [x] **Step 1: Write the failing classifier tests**

Create table-driven tests that exercise the public API from `./index.js`:

```ts
import { describe, expect, it } from "vitest";
import { classifyDiscoveryNetworkRequest } from "./index.js";

describe("classifyDiscoveryNetworkRequest", () => {
  it.each([
    ["document navigation", { resourceType: "Document", isNavigationRequest: true, isMainFrame: true, isServiceWorker: false }, "document-navigation", "top-level"],
    ["XHR", { resourceType: "XHR", isNavigationRequest: false, isMainFrame: false, isServiceWorker: false }, "xhr-fetch", "subresource"],
    ["fetch", { resourceType: "Fetch", isNavigationRequest: false, isMainFrame: false, isServiceWorker: false }, "xhr-fetch", "subresource"],
    ["beacon", { resourceType: "Ping", isNavigationRequest: false, isMainFrame: false, isServiceWorker: false }, "beacon", "subresource"],
    ["service worker", { resourceType: "Fetch", isNavigationRequest: false, isMainFrame: false, isServiceWorker: true }, "service-worker", "subresource"],
    ["other", { resourceType: "Image", isNavigationRequest: false, isMainFrame: false, isServiceWorker: false }, "other", "subresource"],
  ] as const)("classifies %s", (_label, request, requestClass, scope) => {
    expect(classifyDiscoveryNetworkRequest({
      method: "POST",
      currentOrigin: "https://example.test",
      requestOrigin: "https://example.test",
      ...request,
    })).toEqual({
      requestClass,
      methodCategory: "potential-side-effect",
      originRelation: "same-origin",
      scope,
    });
  });

  it.each([
    ["GET", "read"],
    ["HEAD", "read"],
    ["OPTIONS", "read"],
    ["POST", "potential-side-effect"],
    ["PUT", "potential-side-effect"],
    ["PATCH", "potential-side-effect"],
    ["DELETE", "potential-side-effect"],
    ["PROPFIND", "other"],
  ] as const)("classifies %s methods", (method, methodCategory) => {
    expect(classifyDiscoveryNetworkRequest({
      method,
      resourceType: "Fetch",
      isNavigationRequest: false,
      isMainFrame: false,
      isServiceWorker: false,
      currentOrigin: "https://example.test",
      requestOrigin: "https://other.test",
    })).toMatchObject({ methodCategory, originRelation: "cross-origin" });
  });

  it("returns only closed sanitized fields", () => {
    const secret = "do-not-record-secret-token";
    const result = classifyDiscoveryNetworkRequest({
      method: `POST-${secret}`,
      resourceType: `Fetch-${secret}`,
      isNavigationRequest: false,
      isMainFrame: false,
      isServiceWorker: false,
      currentOrigin: "https://example.test",
      requestOrigin: undefined,
    });
    expect(result).toEqual({
      requestClass: "other",
      methodCategory: "other",
      originRelation: "unknown",
      scope: "subresource",
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm exec vitest run packages/agent/src/discoveryNetworkClassification.test.ts
```

Expected: FAIL because `classifyDiscoveryNetworkRequest` is not exported.

- [x] **Step 3: Implement the minimal pure classifier and types**

Create `discoveryNetworkClassification.ts` with closed types and deterministic order:

```ts
export type DiscoveryNetworkRequestClass =
  | "document-navigation"
  | "xhr-fetch"
  | "beacon"
  | "service-worker"
  | "other";
export type DiscoveryNetworkMethodCategory = "read" | "potential-side-effect" | "other";
export type DiscoveryNetworkOriginRelation = "same-origin" | "cross-origin" | "unknown";
export type DiscoveryNetworkScope = "top-level" | "subresource";

export type DiscoveryNetworkClassification = {
  requestClass: DiscoveryNetworkRequestClass;
  methodCategory: DiscoveryNetworkMethodCategory;
  originRelation: DiscoveryNetworkOriginRelation;
  scope: DiscoveryNetworkScope;
};

export type DiscoveryNetworkRequestMetadata = {
  method: string;
  resourceType?: string;
  isNavigationRequest: boolean;
  isMainFrame: boolean;
  isServiceWorker: boolean;
  currentOrigin?: string;
  requestOrigin?: string;
};

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SIDE_EFFECT_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function classifyDiscoveryNetworkRequest(
  input: DiscoveryNetworkRequestMetadata,
): DiscoveryNetworkClassification {
  const resourceType = input.resourceType?.toUpperCase();
  const method = input.method.toUpperCase();
  return {
    requestClass: input.isServiceWorker
      ? "service-worker"
      : input.isNavigationRequest && resourceType === "DOCUMENT"
        ? "document-navigation"
        : resourceType === "XHR" || resourceType === "FETCH"
          ? "xhr-fetch"
          : resourceType === "PING"
            ? "beacon"
            : "other",
    methodCategory: READ_METHODS.has(method)
      ? "read"
      : SIDE_EFFECT_METHODS.has(method)
        ? "potential-side-effect"
        : "other",
    originRelation:
      input.currentOrigin === undefined || input.requestOrigin === undefined
        ? "unknown"
        : input.currentOrigin === input.requestOrigin
          ? "same-origin"
          : "cross-origin",
    scope: input.isMainFrame && input.isNavigationRequest ? "top-level" : "subresource",
  };
}
```

Export the function and types from `index.ts`, and add the new test path to the agent package's `test` script.

- [x] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm exec vitest run packages/agent/src/discoveryNetworkClassification.test.ts
```

Expected: PASS with all request-class, method, origin, scope, and sanitation cases green.

- [x] **Step 5: Refactor names only while green**

Keep the module free of Playwright/CDP imports and arbitrary output strings. Re-run the focused test after any cleanup.

- [x] **Step 6: Commit the classifier slice**

```bash
git add packages/agent/src/discoveryNetworkClassification.ts packages/agent/src/discoveryNetworkClassification.test.ts packages/agent/src/index.ts packages/agent/package.json docs/superpowers/specs/2026-07-18-wes-269-classify-network-side-effects-design.md docs/superpowers/plans/2026-07-18-wes-269-classify-network-side-effects.md docs/linear/auto-demo-project-structure.md
git commit -m "WES-269: define sanitized network classification"
```

### Task 2: Rehearsal Diagnostic Propagation

**Files:**

- Modify: `packages/agent/src/discoveryNetworkClassification.ts`
- Modify: `packages/agent/src/discoveryRehearsal.test.ts`
- Modify: `packages/agent/src/discoveryRehearsal.ts`
- Modify: `packages/agent/src/index.ts`

- [x] **Step 1: Write failing controller-result tests**

Add two tests to `discoveryRehearsal.test.ts`. Configure `driver.execute()` to return a recoverable `network_request_blocked` failure with one sanitized blocked-network evidence object. Configure the post-action observation once without the declared visible state and once with it.

Assert the unmatched case returns:

```ts
expect(result).toMatchObject({
  ok: true,
  attempt: { status: "failed", outcome: { code: "network_request_blocked" } },
  diagnostics: [
    {
      code: "network_requests_blocked",
      totalBlockedRequestCount: 1,
      classifications: [
        {
          requestClass: "xhr-fetch",
          methodCategory: "potential-side-effect",
          originRelation: "same-origin",
          scope: "subresource",
          blockedRequestCount: 1,
        },
      ],
      expectedVisibleEffectPrevented: true,
    },
  ],
});
```

Assert the matched case returns the same sanitized evidence with `expectedVisibleEffectPrevented: false`. Assert serialized results do not contain a fixture secret.

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm exec vitest run packages/agent/src/discoveryRehearsal.test.ts
```

Expected: FAIL because driver results cannot carry blocked-network evidence and result diagnostics accept only observation diagnostics.

- [x] **Step 3: Add exact evidence and diagnostic types**

Extend `discoveryNetworkClassification.ts`:

```ts
export type DiscoveryBlockedNetworkClassification = DiscoveryNetworkClassification & {
  blockedRequestCount: number;
};

export type DiscoveryBlockedNetworkEvidence = {
  classifications: DiscoveryBlockedNetworkClassification[];
  totalBlockedRequestCount: number;
  omittedClassificationCount?: number;
};

export type DiscoveryNetworkDiagnostic = DiscoveryBlockedNetworkEvidence & {
  code: "network_requests_blocked";
  expectedVisibleEffectPrevented: boolean;
};
```

Extend `DiscoveryRehearsalDriverResult` with optional `blockedNetworkEvidence` on both success and failure branches. Define the public result diagnostic union as `DiscoveryObservationDiagnostic | DiscoveryNetworkDiagnostic`.

- [x] **Step 4: Convert evidence after expectation evaluation**

In `performAllowed()`, after `evaluateExpectations()` computes `effects`, convert any driver evidence without mutating it:

```ts
const networkDiagnostics: DiscoveryNetworkDiagnostic[] =
  executed.blockedNetworkEvidence === undefined
    ? []
    : [
        {
          code: "network_requests_blocked",
          ...structuredClone(executed.blockedNetworkEvidence),
          expectedVisibleEffectPrevented:
            input.expectations.length > 0 && effects.some((effect) => effect.status !== "matched"),
        },
      ];
```

Return `diagnostics: [...observed.diagnostics, ...networkDiagnostics]`. Export the result diagnostic and network types from `index.ts`.

- [x] **Step 5: Run the focused tests and verify GREEN**

Run:

```bash
npm exec vitest run packages/agent/src/discoveryRehearsal.test.ts packages/agent/src/discoveryNetworkClassification.test.ts
```

Expected: PASS; existing observation diagnostics remain unchanged and new network diagnostics reflect observable expectations.

- [x] **Step 6: Commit the propagation slice**

```bash
git add packages/agent/src/discoveryNetworkClassification.ts packages/agent/src/discoveryRehearsal.ts packages/agent/src/discoveryRehearsal.test.ts packages/agent/src/index.ts
git commit -m "WES-269: expose blocked network diagnostics"
```

### Task 3: Policy Guard Classification And Bounded Aggregation

**Files:**

- Modify: `packages/agent/src/discoveryPolicy.ts`
- Modify: `packages/agent/src/playwrightDiscoveryPolicyGuard.test.ts`
- Modify: `packages/agent/src/playwrightDiscoveryPolicyGuard.ts`

- [x] **Step 1: Replace legacy outcome expectations with classified evidence assertions**

Update the existing safe `POST`/`PUT`/`PATCH`/`DELETE` tests to expect `network_request_blocked` and sanitized `blockedNetworkEvidence`. Add browser-level cases for:

```ts
expect(await guard.finishAction()).toMatchObject({
  code: "network_request_blocked",
  blockedNetworkEvidence: {
    totalBlockedRequestCount: 1,
    classifications: [
      {
        requestClass: "xhr-fetch",
        methodCategory: "potential-side-effect",
        originRelation: "same-origin",
        scope: "subresource",
        blockedRequestCount: 1,
      },
    ],
  },
});
```

Use `navigator.sendBeacon()` to assert `beacon`; use a POST form submission to assert top-level `document-navigation`; use a cross-origin fetch to assert `cross-origin`. Add a repeated-request case proving the count aggregates, and a table of more than eight classification combinations proving the returned list is capped while totals and omitted distinct-classification count remain accurate.

Add a request containing a secret query, body, and header. Assert none appear in `JSON.stringify(violation)`, errors, or fixed summaries.

- [x] **Step 2: Run the guard tests and verify RED**

Run:

```bash
npm exec vitest run packages/agent/src/playwrightDiscoveryPolicyGuard.test.ts
```

Expected: FAIL because the guard still emits `mutating_request_blocked` without classified evidence.

- [x] **Step 3: Add the neutral policy outcome**

In `discoveryPolicy.ts`, replace new runtime use of `mutating_request_blocked` with:

```ts
| "network_request_blocked"
```

and add:

```ts
network_request_blocked: "Discovery blocked classified network activity.",
```

Retain the historical string only if an existing saved-artifact validation test proves it is required; do not emit it from new guard paths.

- [x] **Step 4: Implement a bounded sanitized accumulator**

In the guard, define `MAX_NETWORK_CLASSIFICATIONS = 8` and an internal accumulator that stores only classification keys, counts, a bounded public entry list, total blocked requests, and a bounded set of omitted enum keys. Its snapshot returns `DiscoveryBlockedNetworkEvidence` and never accepts a URL or arbitrary browser string.

Classify each request from transient metadata:

```ts
const classification = classifyDiscoveryNetworkRequest({
  method: event.request.method,
  resourceType: event.resourceType,
  isNavigationRequest: event.resourceType === "Document",
  isMainFrame: event.frameId !== undefined && event.frameId === mainFrameId,
  isServiceWorker: event.resourceType !== "Document" && event.frameId === undefined,
  currentOrigin: safeRequestOrigin(page.url()),
  requestOrigin,
});
```

Use `classification.methodCategory` for safe/disposable network decisions. Unknown methods fail closed. On a block, add the classification to the active or idle accumulator and record `network_request_blocked`.

- [x] **Step 5: Return and clear evidence at the existing action boundaries**

Extend `DiscoveryPolicyViolation` with optional `blockedNetworkEvidence`. `finishAction()` and `checkForViolation()` attach an immutable snapshot only for `network_request_blocked`, then clear the corresponding accumulator exactly when the violation is consumed. Preserve first-violation behavior for unrelated hard boundaries.

- [x] **Step 6: Run guard and policy tests and verify GREEN**

Run:

```bash
npm exec vitest run packages/agent/src/discoveryNetworkClassification.test.ts packages/agent/src/discoveryPolicy.test.ts packages/agent/src/playwrightDiscoveryPolicyGuard.test.ts
```

Expected: PASS with classified safe blocks, unchanged disposable permits, bounded aggregation, and no secret-bearing output.

- [ ] **Step 7: Commit the enforcement slice**

```bash
git add packages/agent/src/discoveryPolicy.ts packages/agent/src/playwrightDiscoveryPolicyGuard.ts packages/agent/src/playwrightDiscoveryPolicyGuard.test.ts
git commit -m "WES-269: classify policy-guard network blocks"
```

### Task 4: Controller And Replay Integration

**Files:**

- Modify: `packages/agent/src/playwrightPolicyDiscoveryRehearsal.test.ts`
- Modify: `packages/agent/src/playwrightPolicyDiscoveryRehearsal.ts`
- Modify: `packages/agent/src/playwrightDiscoveryReplay.test.ts`

- [ ] **Step 1: Write the failing policy-controller tests**

Add a safe-policy fixture action that triggers a same-origin fetch `POST` and declares an expected visible state that the server response would create. Assert the request does not reach the server, the attempt outcome is `network_request_blocked`, and the result includes one `network_requests_blocked` diagnostic with `expectedVisibleEffectPrevented: true`.

Add a background blocked request with no declared expectation and assert `expectedVisibleEffectPrevented: false`. Serialize both results and assert raw paths, queries, bodies, headers, and fixture tokens are absent.

- [ ] **Step 2: Write the failing replay regression assertion**

Update the safe form-mutation replay test to prove the classified block still rejects with public error code `policy_blocked`, the mutation count remains zero, and the serialized error contains no request data.

- [ ] **Step 3: Run controller and replay tests and verify RED**

Run:

```bash
npm exec vitest run packages/agent/src/playwrightPolicyDiscoveryRehearsal.test.ts packages/agent/src/playwrightDiscoveryReplay.test.ts
```

Expected: FAIL because the policy adapter drops guard evidence and old outcome expectations remain.

- [ ] **Step 4: Pass guard evidence through the driver result**

Change `policyDriverFailure()` to accept a `DiscoveryPolicyViolation` rather than only a code:

```ts
function policyDriverFailure(violation: DiscoveryPolicyViolation) {
  return {
    ok: false as const,
    code: violation.code,
    summary: violation.summary,
    recoverable: true,
    ...(violation.blockedNetworkEvidence === undefined
      ? {}
      : { blockedNetworkEvidence: structuredClone(violation.blockedNetworkEvidence) }),
  };
}
```

Fixed pre-execution failures continue to use a small helper that creates a violation from `DISCOVERY_POLICY_SUMMARIES`. `afterExecute()` passes the complete guard violation. Replay continues to ignore evidence and translate any violation to `policy_blocked`.

- [ ] **Step 5: Run controller and replay tests and verify GREEN**

Run:

```bash
npm exec vitest run packages/agent/src/discoveryRehearsal.test.ts packages/agent/src/playwrightPolicyDiscoveryRehearsal.test.ts packages/agent/src/playwrightDiscoveryReplay.test.ts
```

Expected: PASS with public rehearsal diagnostics and unchanged replay hard-boundary behavior.

- [ ] **Step 6: Commit the integration slice**

```bash
git add packages/agent/src/playwrightPolicyDiscoveryRehearsal.ts packages/agent/src/playwrightPolicyDiscoveryRehearsal.test.ts packages/agent/src/playwrightDiscoveryReplay.test.ts
git commit -m "WES-269: surface classified network evidence"
```

### Task 5: Public Documentation And Wrapper Contract

**Files:**

- Modify: `packages/agent/src/wrapper-docs.test.ts`
- Modify: `packages/agent/README.md`
- Modify: `packages/agent/skills/codex-auto-demo/SKILL.md`
- Modify: `packages/agent/claude-wrapper-parity.md`
- Modify: `README.md`
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Write failing documentation-contract assertions**

Update `wrapper-docs.test.ts` to require the repository-owned skill and parity document to state that sanitized classification is implemented, that diagnostics never include request URLs/bodies/headers/credentials/tokens, and that `public-browse` remains unsupported until WES-266.

- [ ] **Step 2: Run wrapper documentation tests and verify RED**

Run:

```bash
npm exec vitest run packages/agent/src/wrapper-docs.test.ts
```

Expected: FAIL because the docs still say WES-269 classification is pending.

- [ ] **Step 3: Update public documentation**

Document:

- the five request classes and three method categories;
- same/cross/unknown origin and top-level/subresource evidence;
- bounded aggregate counts and visible-effect prevention;
- fixed summaries and strict secret non-retention;
- safe enforcement consuming the classifier;
- `public-browse` and YOLO policy behavior remaining unsupported until WES-266;
- replay remaining a hard boundary without persisted network details.

Add the WES-269 design and plan links plus current implementation evidence to the project map. Do not change the deterministic next pointer from WES-269 until merge evidence exists.

- [ ] **Step 4: Run documentation tests and verify GREEN**

Run:

```bash
npm exec vitest run packages/agent/src/wrapper-docs.test.ts
```

Expected: PASS with WES-269 available and WES-266 explicitly deferred.

- [ ] **Step 5: Run the complete agent package test suite**

Run:

```bash
npm --workspace @auto-demo/agent test
```

Expected: PASS with the classifier test included in the package command.

- [ ] **Step 6: Commit the documentation slice**

```bash
git add packages/agent/src/wrapper-docs.test.ts packages/agent/README.md packages/agent/skills/codex-auto-demo/SKILL.md packages/agent/claude-wrapper-parity.md README.md docs/linear/auto-demo-project-structure.md
git commit -m "docs: explain classified network diagnostics"
```

### Task 6: Verification And Completion Evidence

**Files:**

- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Run focused classification and policy verification**

```bash
npm exec vitest run packages/agent/src/discoveryNetworkClassification.test.ts packages/agent/src/discoveryRehearsal.test.ts packages/agent/src/discoveryPolicy.test.ts packages/agent/src/playwrightDiscoveryPolicyGuard.test.ts packages/agent/src/playwrightPolicyDiscoveryRehearsal.test.ts packages/agent/src/playwrightDiscoveryReplay.test.ts packages/agent/src/wrapper-docs.test.ts
```

Expected: PASS with zero failures.

- [ ] **Step 2: Run repository verification**

```bash
npm test
npm run build
npm run typecheck
npm run lint
npm run format:check
git diff --check origin/develop...HEAD
```

Expected: every issue-owned check passes. If full lint observes the preserved untracked `workflow/` artifacts, record that separately and run the tracked-file/clean-checkout equivalent without changing those artifacts.

- [ ] **Step 3: Inspect the complete issue diff and requirements**

```bash
git diff --stat origin/develop...HEAD
git diff origin/develop...HEAD -- packages/agent README.md docs/superpowers docs/linear/auto-demo-project-structure.md
git status --short
```

Expected: only WES-269 paths are committed; `.gitignore` and `workflow/` remain preserved and unstaged.

- [ ] **Step 4: Request independent read-only review**

Give the reviewer WES-269, the design, the plan, `origin/develop`, `HEAD`, and the complete diff. Fix every verified Critical or Important issue and low-risk valid Minor issue through a fresh RED-GREEN cycle, then rerun affected and full verification.

- [ ] **Step 5: Record pre-PR evidence**

Update the project map with exact commands, counts, review result, commit SHAs, preserved unrelated changes, and the fact that WES-269 remains In Progress until merge. Keep WES-266 blocked until completion evidence is merged.

- [ ] **Step 6: Commit final local evidence**

```bash
git add docs/linear/auto-demo-project-structure.md
git commit -m "docs: record WES-269 verification evidence"
```

- [ ] **Step 7: Publish, monitor, and squash merge**

Push the feature branch, open a PR targeting `develop`, include Linear/spec/plan/verification evidence, monitor required checks and review threads, repair only verified issue-scoped findings, update the project map with durable PR evidence before merge, and squash merge when all gates pass.

- [ ] **Step 8: Synchronize and complete Linear**

Switch to `develop`, verify its upstream owns the PR base, fetch and fast-forward from the explicit base remote, confirm the squash commit locally, run the Linear completion gate, add the completion comment, move WES-269 to Done, add WES-266's readiness note, and set WES-266 as the deterministic next-task pointer without starting it.
