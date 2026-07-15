# WES-186 Safe And Disposable Discovery Policies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a policy-enforced Playwright discovery controller with safe defaults, explicit disposable-origin mutation authority, hard secret and browser protections, and no authority carryover into persisted artifacts.

**Architecture:** Keep the WES-185 generic controller browser-agnostic. Add focused safety helpers, a pure discovery-policy module, runtime-only target risk in the opaque registry, a page-scoped Chromium CDP guard plus an isolated-context popup boundary, and an async coupled factory that wires those pieces together with one-use internal permits. The host continues to own the isolated one-page Chromium context, while request, download, popup, service-worker-bypass, and WebSocket hooks are removed on stop or dispose.

**Tech Stack:** TypeScript, Playwright 1.61, Vitest, npm workspaces, ESLint, Prettier.

---

## Execution Preconditions

- Execute inline in the current checkout, per the user's explicit implementation approval; leave all changes unstaged and uncommitted.
- Preserve unrelated untracked `check-codex-usage` documents and `packages/agent/skills/auto-demo-linear-brainstorming/`.
- Use `rtk` for shell commands.
- Keep tests behavior-oriented: assert public decisions, browser effects, persisted evidence, and cleanup behavior rather than private callback counts or internal map contents.
- Do not add capture, plan compilation, CLI, authentication, wildcard origins, or browser ownership.

## File Map

- Create `packages/agent/src/actionSafety.ts`: shared destructive-language, URL credential, secret-value, and exact-origin helpers.
- Create `packages/agent/src/actionSafety.test.ts`: public behavior for shared safety helpers.
- Create `packages/agent/src/discoveryPolicy.ts`: policy input validation, action authorization, stable outcomes, and internal one-use permit types.
- Create `packages/agent/src/discoveryPolicy.test.ts`: safe/disposable policy behavior.
- Modify `packages/agent/src/discoveryObservation.ts`: transient payment/upload risk fields and extractor-to-registry handoff.
- Modify `packages/agent/src/discoveryObservationTransform.ts`: register runtime risk without persisting it.
- Modify `packages/agent/src/discoveryTargetRegistry.ts`: retain runtime-only risk beside opaque target identity.
- Modify `packages/agent/src/playwrightDiscoveryPage.ts`: detect credential, payment, upload, and mutation risk from DOM metadata.
- Modify `packages/agent/src/discoveryObservation.test.ts`: prove risk remains outside persisted observations.
- Modify `packages/agent/src/playwrightDiscoveryObservation.test.ts`: behavior coverage for sensitive and upload targets.
- Create `packages/agent/src/playwrightDiscoveryPolicyGuard.ts`: CDP request/redirect/service-worker/WebSocket enforcement plus isolated-context popup and download guards.
- Create `packages/agent/src/playwrightDiscoveryPolicyGuard.test.ts`: browser enforcement and retryable cleanup.
- Create `packages/agent/src/playwrightPolicyDiscoveryRehearsal.ts`: async coupled factory, value gate, guarded driver, stop/dispose cleanup.
- Create `packages/agent/src/playwrightPolicyDiscoveryRehearsal.test.ts`: end-to-end safe/disposable rehearsal behavior.
- Modify `packages/agent/src/playwrightDiscoveryRehearsal.ts`: extract a small internal runtime builder reused by the legacy and policy-enforced factories.
- Modify `packages/agent/src/walkthroughValidation.ts`: consume shared safety helpers without behavior change.
- Modify `packages/agent/src/index.ts`: export only the supported public policy and factory surface.
- Modify `packages/agent/package.json`: include new test files in the agent test command.
- Modify `packages/agent/README.md`: document safe default, disposable declaration, hard protections, isolated Chromium-page lifecycle, and downstream non-carryover.
- Modify `docs/linear/auto-demo-project-structure.md`: record implementation and completion evidence during the sync gate.

### Task 1: Extract Shared Safety Primitives

**Files:**

- Create: `packages/agent/src/actionSafety.ts`
- Create: `packages/agent/src/actionSafety.test.ts`
- Modify: `packages/agent/src/walkthroughValidation.ts`
- Modify: `packages/agent/package.json`

- [ ] **Step 1: Write failing behavior tests for shared helpers**

Create tests that cover destructive vocabulary, credential-bearing URLs, safe exact origins, and secret-like runtime values:

```ts
import { describe, expect, it } from "vitest";
import {
  hasCredentialLikeUrlData,
  hasDestructiveActionLanguage,
  isSecretLikeValue,
  normalizeHttpOrigin,
} from "./actionSafety.js";

describe("action safety", () => {
  it.each(["Delete account", "Publish changes", "Submit order", "Invite teammate"])(
    "classifies destructive language: %s",
    (value) => expect(hasDestructiveActionLanguage(value)).toBe(true),
  );

  it("rejects credential-bearing and non-HTTP origins", () => {
    expect(hasCredentialLikeUrlData("https://example.test/?api_key=secret-value-123456789")).toBe(
      true,
    );
    expect(normalizeHttpOrigin("javascript:alert(1)")).toBeUndefined();
    expect(normalizeHttpOrigin("https://user:pass@example.test/path")).toBeUndefined();
    expect(normalizeHttpOrigin("https://example.test/path")).toBe("https://example.test");
  });

  it("recognizes secret-like runtime values without returning them", () => {
    expect(isSecretLikeValue("sk-example123456789")).toBe(true);
    expect(isSecretLikeValue("Demo Person")).toBe(false);
  });
});
```

Add `src/actionSafety.test.ts` to the explicit Vitest list in `packages/agent/package.json`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/actionSafety.test.ts
```

Expected: FAIL because `actionSafety.ts` does not exist.

- [ ] **Step 3: Implement the shared helpers**

Create the shared destructive vocabulary and secret/credential detectors with the implementation below. Keep helpers pure and return no diagnostic strings containing input:

```ts
const DESTRUCTIVE_ACTION =
  /\b(delete|destroy|erase|wipe|remove|clear all|save|create|register|sign up|purchase|buy|pay|checkout|submit|confirm|send|publish|post|deploy|invite|transfer|approve|merge|enable|disable|revoke|archive|restore|upload|commit|cancel account|close account)\b/i;

export const hasDestructiveActionLanguage = (value: string) => DESTRUCTIVE_ACTION.test(value);

const CREDENTIAL_KEY =
  /(^|[-_.])(auth|authorization|token|api[-_]?key|key|secret|password|passcode|credential|signature|sig|code)($|[-_.])/i;

export function normalizeHttpOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username !== "" || url.password !== "") return;
    return url.origin;
  } catch {
    return;
  }
}

export function hasCredentialLikeUrlData(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return true;
  }
  let rawFragment: string;
  try {
    rawFragment = decodeURIComponent(url.hash.replace(/^#/, ""));
  } catch {
    return true;
  }
  if (rawFragment.length > 0 && !rawFragment.includes("=") && isSecretLikeValue(rawFragment)) {
    return true;
  }
  const parameterSets = [url.searchParams];
  if (url.hash.includes("=")) parameterSets.push(new URLSearchParams(url.hash.slice(1)));
  return parameterSets.some((parameters) =>
    Array.from(parameters).some(
      ([key, parameterValue]) => CREDENTIAL_KEY.test(key) || isSecretLikeValue(parameterValue),
    ),
  );
}

export function isSecretLikeValue(value: string): boolean {
  if (/^sk-[a-z0-9_-]{8,}$/i.test(value)) return true;
  if (/^[a-z0-9_-]{8,}\.[a-z0-9_-]{4,}\.[a-z0-9_-]{4,}$/i.test(value)) return true;
  return value.length >= 24 && /[a-z]/i.test(value) && /\d/.test(value);
}
```

Import these helpers in `walkthroughValidation.ts`; delete the duplicate local functions and replace its destructive regex with `hasDestructiveActionLanguage(description)`.

- [ ] **Step 4: Run focused and regression tests**

Run:

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/actionSafety.test.ts src/walkthroughValidation.test.ts
```

Expected: both files PASS with existing walkthrough behavior unchanged.

- [ ] **Step 5: Commit the safety extraction**

```bash
git add packages/agent/src/actionSafety.ts packages/agent/src/actionSafety.test.ts packages/agent/src/walkthroughValidation.ts packages/agent/package.json
git commit -m "refactor: share agent action safety checks"
```

### Task 2: Implement Pure Discovery Policy Decisions

**Files:**

- Create: `packages/agent/src/discoveryPolicy.ts`
- Create: `packages/agent/src/discoveryPolicy.test.ts`
- Modify: `packages/agent/package.json`

- [ ] **Step 1: Write failing policy validation tests**

Cover exact-origin normalization, duplicate removal, acknowledgement, initial-origin inclusion, and no secret echo:

```ts
import { describe, expect, it } from "vitest";
import { validateDiscoveryPolicy } from "./discoveryPolicy.js";

describe("validateDiscoveryPolicy", () => {
  it("normalizes an exact safe scope", () => {
    expect(
      validateDiscoveryPolicy(
        { mode: "safe", allowedOrigins: ["https://example.test/", "https://example.test"] },
        "https://example.test/start",
      ),
    ).toEqual({
      ok: true,
      policy: { mode: "safe", allowedOrigins: ["https://example.test"] },
    });
  });

  it("requires explicit disposable acknowledgement", () => {
    expect(
      validateDiscoveryPolicy(
        { mode: "disposable", allowedOrigins: ["https://example.test"] } as never,
        "https://example.test/start",
      ),
    ).toMatchObject({ ok: false, errors: [{ code: "disposable_acknowledgement_required" }] });
  });

  it("requires the current origin to be in scope", () => {
    expect(
      validateDiscoveryPolicy(
        { mode: "safe", allowedOrigins: ["https://other.test"] },
        "https://example.test/start",
      ),
    ).toMatchObject({ ok: false, errors: [{ code: "origin_not_allowed" }] });
  });
});
```

- [ ] **Step 2: Write failing action-decision tests**

Use sanitized public targets plus transient risk:

```ts
function policy(input: DiscoveryPolicy): ValidatedDiscoveryPolicy {
  const result = validateDiscoveryPolicy(input, "https://example.test/start");
  if (!result.ok) throw new Error("policy fixture must validate");
  return result.policy;
}

const safePolicy = policy({ mode: "safe", allowedOrigins: ["https://example.test"] });
const disposablePolicy = policy({
  mode: "disposable",
  acknowledgement: "environment-is-disposable",
  allowedOrigins: ["https://example.test"],
});
const noRisk = { credential: false, sensitivePayment: false, upload: false };

it("blocks mutations in safe mode and permits scoped mutations when disposable", () => {
  const action = { kind: "click", targetId: "target-save" } as const;
  const target = {
    id: "target-save",
    label: "Save",
    role: "button",
    disabled: false,
    actionRisk: "potentially-mutating" as const,
  };

  expect(
    authorizeDiscoveryPolicyAction({
      policy: safePolicy,
      observationUrl: "https://example.test/start",
      action,
      target,
      risk: noRisk,
    }),
  ).toMatchObject({ decision: "block", reason: { code: "destructive_action_blocked" } });
  expect(
    authorizeDiscoveryPolicyAction({
      policy: disposablePolicy,
      observationUrl: "https://example.test/start",
      action,
      target,
      risk: noRisk,
    }),
  ).toMatchObject({ decision: "allow" });
});

it("never allows credentials, uploads, disabled targets, or unscoped navigation", () => {
  expect(
    authorizeDiscoveryPolicyAction({
      policy: disposablePolicy,
      observationUrl: "https://example.test/start",
      action: {
        kind: "type",
        targetId: "target-input",
        inputBinding: "demo-name",
        valueClass: "demo-data",
      },
      target: { id: "target-input", label: "Password", role: "textbox", disabled: false },
      risk: { ...noRisk, credential: true },
    }),
  ).toMatchObject({
    decision: "block",
    reason: { code: "credential_action_blocked" },
  });
  expect(
    authorizeDiscoveryPolicyAction({
      policy: disposablePolicy,
      observationUrl: "https://example.test/start",
      action: { kind: "click", targetId: "target-upload" },
      target: { id: "target-upload", label: "Upload", disabled: false },
      risk: { ...noRisk, upload: true },
    }),
  ).toMatchObject({
    decision: "block",
    reason: { code: "upload_blocked" },
  });
  expect(
    authorizeDiscoveryPolicyAction({
      policy: disposablePolicy,
      observationUrl: "https://example.test/start",
      action: { kind: "navigate", url: "https://other.test/" },
    }),
  ).toMatchObject({
    decision: "block",
    reason: { code: "origin_not_allowed" },
  });
});
```

Add `src/discoveryPolicy.test.ts` to the agent test script.

- [ ] **Step 3: Run the policy tests and verify RED**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/discoveryPolicy.test.ts
```

Expected: FAIL because policy exports are missing.

- [ ] **Step 4: Implement policy types, validation, and decisions**

Implement these exact public inputs and internal result shapes:

```ts
export type SafeDiscoveryPolicy = { mode: "safe"; allowedOrigins: string[] };
export type DisposableDiscoveryPolicy = {
  mode: "disposable";
  acknowledgement: "environment-is-disposable";
  allowedOrigins: string[];
};
export type DiscoveryPolicy = SafeDiscoveryPolicy | DisposableDiscoveryPolicy;

export type ValidatedDiscoveryPolicy = {
  readonly mode: "safe" | "disposable";
  readonly allowedOrigins: ReadonlySet<string>;
};

export type DiscoveryPolicyValidationErrorCode =
  "invalid_discovery_policy" | "disposable_acknowledgement_required" | "origin_not_allowed";

export type DiscoveryRuntimeTargetRisk = {
  credential: boolean;
  sensitivePayment: boolean;
  upload: boolean;
};

export type DiscoveryPolicyOutcomeCode =
  | "credential_action_blocked"
  | "sensitive_input_blocked"
  | "destructive_action_blocked"
  | "origin_not_allowed"
  | "unsafe_navigation_blocked"
  | "mutating_request_blocked"
  | "websocket_blocked"
  | "download_blocked"
  | "upload_blocked"
  | "policy_guard_unavailable";

export const DISCOVERY_POLICY_SUMMARIES: Record<DiscoveryPolicyOutcomeCode, string> = {
  credential_action_blocked: "Discovery blocked credential entry.",
  sensitive_input_blocked: "Discovery blocked sensitive input.",
  destructive_action_blocked: "Discovery blocked a potentially destructive action.",
  origin_not_allowed: "Discovery blocked an origin outside the approved scope.",
  unsafe_navigation_blocked: "Discovery blocked unsafe navigation.",
  mutating_request_blocked: "Discovery blocked a server-mutating request.",
  websocket_blocked: "Discovery blocked a WebSocket connection.",
  download_blocked: "Discovery blocked a download.",
  upload_blocked: "Discovery blocked an upload control.",
  policy_guard_unavailable: "Discovery policy enforcement is unavailable.",
};

export type DiscoveryPolicyPermit = {
  readonly token: symbol;
  readonly mode: "safe" | "disposable";
  readonly allowedOrigins: ReadonlySet<string>;
};
```

Keep `DiscoveryPolicyPermit` importable only by internal modules; do not export it from `index.ts`. Use fixed summaries. Fail closed for missing/stale/disabled targets, unsafe URLs, credential/payment/upload risk, and destructive safe-mode clicks. Permit `inspect`, bounded `wait`, `back`, and `refresh`; leave navigation enforcement active in the browser guard.

- [ ] **Step 5: Run policy and discovery contract tests**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/actionSafety.test.ts src/discoveryPolicy.test.ts src/discoveryValidation.test.ts
```

Expected: PASS; policy inputs and permits do not appear in `DiscoverySessionV1` serialization.

- [ ] **Step 6: Commit pure policy behavior**

```bash
git add packages/agent/src/discoveryPolicy.ts packages/agent/src/discoveryPolicy.test.ts packages/agent/package.json
git commit -m "feat: define safe discovery policy decisions"
```

### Task 3: Retain Runtime-Only Target Risk

**Files:**

- Modify: `packages/agent/src/discoveryObservation.ts`
- Modify: `packages/agent/src/discoveryObservationTransform.ts`
- Modify: `packages/agent/src/discoveryTargetRegistry.ts`
- Modify: `packages/agent/src/playwrightDiscoveryPage.ts`
- Modify: `packages/agent/src/discoveryObservation.test.ts`
- Modify: `packages/agent/src/playwrightDiscoveryObservation.test.ts`

- [ ] **Step 1: Write failing behavior tests for transient risk**

Extend the Playwright observation test with password, payment, and file controls. Assert public observations remain safe:

```ts
await openHtml(`
  <label>Password <input type="password" autocomplete="current-password"></label>
  <label>Card <input autocomplete="cc-number"></label>
  <label>Upload <input type="file"></label>
`);
const result = await createPlaywrightDiscoveryObservationExtractor(page).observe();
if (!result.ok) throw new Error("observation must succeed");
for (const target of result.observation.interactiveTargets) {
  expect(target).not.toHaveProperty("credential");
  expect(target).not.toHaveProperty("sensitivePayment");
  expect(target).not.toHaveProperty("upload");
}
```

Add an extractor-with-registry test that resolves each opaque target and observes only its runtime risk through the internal registry API:

```ts
const registry = createDiscoveryTargetRegistry(() => "target-sensitive");
const extractor = createDiscoveryObservationExtractorWithRegistry(
  { page: sensitivePage(), idGenerator: () => "observation-1" },
  registry,
);
const result = await extractor.observe();
if (!result.ok) throw new Error("observation must succeed");
const targetId = result.observation.interactiveTargets[0]!.id;
expect(registry.resolve(targetId)).toMatchObject({
  risk: { credential: true, sensitivePayment: false, upload: false },
});
expect(result.observation.interactiveTargets[0]).not.toHaveProperty("risk");
```

- [ ] **Step 2: Run focused observation tests and verify RED**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/discoveryObservation.test.ts src/playwrightDiscoveryObservation.test.ts
```

Expected: FAIL because payment/upload risk is not collected and registry resolution has no risk.

- [ ] **Step 3: Extend the raw target and registry boundary**

Add optional raw fields without changing `DiscoveryInteractiveTarget`:

```ts
export type DiscoveryObservationRawTarget = {
  // existing fields
  credential: boolean;
  sensitivePayment?: boolean;
  upload?: boolean;
  actionRisk?: "potentially-mutating";
};

export type DiscoveryTargetRuntimeRisk = {
  credential: boolean;
  sensitivePayment: boolean;
  upload: boolean;
};
```

Change registry registration so each selected target stores normalized booleans beside `identityKey` and `documentToken`. `resolve(targetId)` returns identity plus runtime risk. Reset and removal clear both identity and risk. Do not expose risk through observation output, fixtures, or `index.ts`.

- [ ] **Step 4: Detect payment and upload controls in the Playwright snapshot**

Classify runtime risk using DOM properties only:

```ts
const autocompleteTokens = new Set(autocomplete.split(/\s+/));
const sensitivePayment = [...autocompleteTokens].some((token) =>
  /^(cc-name|cc-number|cc-exp|cc-exp-month|cc-exp-year|cc-csc)$/.test(token),
);
const upload = inputElement?.type.toLowerCase() === "file";
```

Keep editable values unread. Preserve existing sanitized labels and `credential_target_present` diagnostic behavior.

- [ ] **Step 5: Run observation, session, and serialization tests**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/discoveryObservation.test.ts src/playwrightDiscoveryObservation.test.ts src/discoverySession.test.ts src/discoveryValidation.test.ts
```

Expected: PASS; risk is usable by internal policy code and absent from persisted observations.

- [ ] **Step 6: Commit runtime risk metadata**

```bash
git add packages/agent/src/discoveryObservation.ts packages/agent/src/discoveryObservationTransform.ts packages/agent/src/discoveryTargetRegistry.ts packages/agent/src/playwrightDiscoveryPage.ts packages/agent/src/discoveryObservation.test.ts packages/agent/src/playwrightDiscoveryObservation.test.ts
git commit -m "feat: retain runtime discovery target risk"
```

### Task 4: Add The Playwright Policy Guard

**Files:**

- Create: `packages/agent/src/playwrightDiscoveryPolicyGuard.ts`
- Create: `packages/agent/src/playwrightDiscoveryPolicyGuard.test.ts`
- Modify: `packages/agent/package.json`

- [ ] **Step 1: Write failing browser tests for request and origin enforcement**

Use local routed pages and public browser effects. Cover safe-mode POST blocking, disposable scoped POST success, out-of-scope top-level navigation blocking, and passive GET success:

```ts
const safeValidation = validateDiscoveryPolicy(
  { mode: "safe", allowedOrigins: ["https://example.test"] },
  "https://example.test/start",
);
if (!safeValidation.ok) throw new Error("safe policy fixture must validate");
const safeAuthorization = authorizeDiscoveryPolicyAction({
  policy: safeValidation.policy,
  observationUrl: "https://example.test/start",
  action: { kind: "inspect" },
});
if (safeAuthorization.decision !== "allow") throw new Error("inspect fixture must be allowed");
const validatedSafePolicy = safeValidation.policy;
const safePermit = safeAuthorization.permit;

const disposableValidation = validateDiscoveryPolicy(
  {
    mode: "disposable",
    acknowledgement: "environment-is-disposable",
    allowedOrigins: ["https://example.test"],
  },
  "https://example.test/start",
);
if (!disposableValidation.ok) throw new Error("disposable policy fixture must validate");
const disposableAuthorization = authorizeDiscoveryPolicyAction({
  policy: disposableValidation.policy,
  observationUrl: "https://example.test/start",
  action: { kind: "inspect" },
});
if (disposableAuthorization.decision !== "allow") {
  throw new Error("inspect fixture must be allowed");
}
const disposablePermit = disposableAuthorization.permit;

const guard = await installPlaywrightDiscoveryPolicyGuard(page, validatedSafePolicy);
guard.arm(safePermit);
await page.evaluate(() => fetch("/mutate", { method: "POST" }).catch(() => undefined));
expect(guard.finishAction()).toEqual({
  code: "mutating_request_blocked",
  summary: "Discovery blocked a server-mutating request.",
});

guard.arm(disposablePermit);
await page.evaluate(() => fetch("/mutate", { method: "POST" }));
expect(guard.finishAction()).toBeUndefined();
expect(serverMutationCount).toBe(1);
```

Assert only normalized origin or fixed summaries appear in violations; never assert private handler counts.

- [ ] **Step 2: Write failing download, WebSocket, and cleanup tests**

Verify a download is canceled, WebSocket creation is blocked, and `dispose()` removes the guard's popup route/download listener and CDP enforcement while leaving the page open and unrelated host routing functional.

```ts
const guard = await installPlaywrightDiscoveryPolicyGuard(page, validatedSafePolicy);
guard.arm(safePermit);
const download = await Promise.all([
  page.waitForEvent("download"),
  page.getByRole("link", { name: "Download" }).click(),
]).then(([item]) => item);
expect(await download.failure()).toBe("canceled");
expect(guard.finishAction()).toMatchObject({ code: "download_blocked" });

await guard.dispose();
expect(page.isClosed()).toBe(false);
await page.goto("https://example.test/host-route-still-active");
expect(await page.title()).toBe("Host route");
```

- [ ] **Step 3: Run guard tests and verify RED**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/playwrightDiscoveryPolicyGuard.test.ts
```

Expected: FAIL because the guard module is missing.

- [ ] **Step 4: Implement a one-action guard**

Implement the internal interface:

```ts
export type DiscoveryPolicyViolation = {
  code: DiscoveryPolicyOutcomeCode;
  summary: string;
};

export type PlaywrightDiscoveryPolicyGuard = {
  arm(permit: DiscoveryPolicyPermit): void;
  finishAction(): DiscoveryPolicyViolation | undefined;
  dispose(): Promise<void>;
};

export async function installPlaywrightDiscoveryPolicyGuard(
  page: Page,
  policy: ValidatedDiscoveryPolicy,
): Promise<PlaywrightDiscoveryPolicyGuard>;

export class DiscoveryPolicyGuardError extends Error {
  constructor(
    readonly code: "policy_guard_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "DiscoveryPolicyGuardError";
  }
}
```

Use page-target CDP Fetch interception so every request and redirect hop is evaluated without displacing existing Playwright routes. Bypass service workers for the page target. Use one exact context route plus a page listener to reject popup navigation/subresource requests and close the popup, retaining both handlers for cleanup. Monitor main-frame transitions and revalidate the raw page URL after bounded event quiescence so non-network navigation fails and returns to the last safe page before observation. Abort disallowed top-level navigation and mutating requests. Allow disposable mutations only while an unconsumed disposable permit is armed and the request origin is in scope.

Attach a named `download` listener that immediately calls `download.cancel()` and records `download_blocked`. Create a page-scoped Chromium DevTools Protocol session, enable network observation, listen for attempted WebSocket creation, and block `ws://*` and `wss://*`. Do not read request headers, bodies, response bodies, filenames, cookies, or storage state.

- [ ] **Step 5: Implement fail-closed installation and cleanup**

Require an isolated Chromium context containing exactly the supplied page plus the explicit `chromiumNetworkInstrumentation: "exclusive"` acknowledgement. Install fallible CDP Fetch/frame/service-worker/WebSocket enforcement first, then the popup route/listener and download listener as one fail-closed setup. On any installation failure, retry removal of the exact installed handlers, disable Fetch, restore service-worker handling, clear blocked URL patterns, and detach the CDP session. If immediate rollback still fails, retain cleanup on the public creation error for caller retry. Make cleanup stateful and retryable; `dispose()` is idempotent, waits for the action window to close, and attempts every unfinished cleanup step. Race observed pending work against the fixed quiescence deadline rather than awaiting it without a bound; timeout makes the guard terminal for future actions but remains forcibly cleanable.

```ts
let cdpSession: CDPSession | undefined;
try {
  await page.context().route(ROUTE_MATCHER, popupRouteHandler);
  page.on("download", downloadHandler);
  cdpSession = await page.context().newCDPSession(page);
  await cdpSession.send("Network.enable");
  await cdpSession.send("Network.setBypassServiceWorker", { bypass: true });
  cdpSession.on("Network.webSocketCreated", webSocketHandler);
  await cdpSession.send("Network.setBlockedURLs", { urls: ["ws://*", "wss://*"] });
  cdpSession.on("Fetch.requestPaused", fetchHandler);
  await cdpSession.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
} catch {
  await page
    .context()
    .unroute(ROUTE_MATCHER, popupRouteHandler)
    .catch(() => undefined);
  page.off("download", downloadHandler);
  await cdpSession?.send("Fetch.disable").catch(() => undefined);
  await cdpSession
    ?.send("Network.setBypassServiceWorker", { bypass: false })
    .catch(() => undefined);
  await cdpSession?.send("Network.setBlockedURLs", { urls: [] }).catch(() => undefined);
  await cdpSession?.detach().catch(() => undefined);
  throw new DiscoveryPolicyGuardError("policy_guard_unavailable", "Discovery policy setup failed.");
}
```

- [ ] **Step 6: Run guard and existing Playwright validation tests**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/playwrightDiscoveryPolicyGuard.test.ts src/playwrightValidationRunner.test.ts
```

Expected: PASS; the new page-scoped guard does not change the existing fresh-context validation runner.

- [ ] **Step 7: Commit browser enforcement**

```bash
git add packages/agent/src/playwrightDiscoveryPolicyGuard.ts packages/agent/src/playwrightDiscoveryPolicyGuard.test.ts packages/agent/package.json
git commit -m "feat: enforce discovery browser policy"
```

### Task 5: Build The Coupled Policy-Enforced Controller

**Files:**

- Create: `packages/agent/src/playwrightPolicyDiscoveryRehearsal.ts`
- Create: `packages/agent/src/playwrightPolicyDiscoveryRehearsal.test.ts`
- Modify: `packages/agent/src/playwrightDiscoveryRehearsal.ts`
- Modify: `packages/agent/package.json`

- [ ] **Step 1: Write failing end-to-end safe-mode tests**

Create the controller with a safe scope and prove public outcomes:

```ts
const sessionInput = {
  id: "session-1",
  target: { kind: "browser" as const, startUrl: "https://example.test/start" },
  goal: "Explore the demo",
  host: { name: "codex", version: "1.0.0" },
};
const demoInputResolver = {
  async resolve() {
    return { ok: true as const, value: "Demo Person" };
  },
};
const click = (targetId: string): DiscoveryRehearsalActionInput => ({
  action: { kind: "click", targetId },
  expectations: [],
  confidence: { level: "high", bases: ["exact-accessible-target"] },
});
const targetId = (result: DiscoveryRehearsalResult, label: string): string => {
  if (!result.ok || result.observation === undefined) throw new Error("observation missing");
  const id = result.observation.interactiveTargets.find((target) => target.label === label)?.id;
  if (id === undefined) throw new Error(`target missing: ${label}`);
  return id;
};

const controller = await createPolicyEnforcedPlaywrightDiscoveryRehearsalController(page, {
  chromiumNetworkInstrumentation: "exclusive",
  policy: { mode: "safe", allowedOrigins: ["https://example.test"] },
  inputResolver: demoInputResolver,
});
const started = await controller.start(sessionInput);
const save = targetId(started, "Save");
const result = await controller.perform(click(save));

expect(result).toMatchObject({
  ok: true,
  attempt: { status: "blocked", outcome: { code: "destructive_action_blocked" } },
});
expect(serverMutationCount).toBe(0);
```

Add cases for ordinary GET interaction, out-of-scope navigation, credential/payment typing, upload controls, secret-like resolved values, disabled/stale targets, and absent policy/permit data in `JSON.stringify(result)`.

- [ ] **Step 2: Write failing disposable-mode and one-use permit tests**

Prove explicit acknowledgement plus exact scope permits a POST-producing click, while an out-of-scope POST remains failed. Perform a second action after the first and prove the prior permit cannot authorize it.

```ts
const controller = await createPolicyEnforcedPlaywrightDiscoveryRehearsalController(page, {
  chromiumNetworkInstrumentation: "exclusive",
  policy: {
    mode: "disposable",
    acknowledgement: "environment-is-disposable",
    allowedOrigins: ["https://example.test"],
  },
  inputResolver: demoInputResolver,
});
const started = await controller.start(sessionInput);
const submitted = await controller.perform(click(targetId(started, "Submit")));
expect(submitted).toMatchObject({ ok: true, attempt: { status: "succeeded" } });
expect(serverMutationCount).toBe(1);

const escaped = await controller.perform(click(targetId(submitted, "Mutate other origin")));
expect(escaped).toMatchObject({
  ok: true,
  attempt: { status: "failed", outcome: { code: "mutating_request_blocked" } },
});
expect(otherOriginMutationCount).toBe(0);
```

- [ ] **Step 3: Write failing lifecycle tests**

Verify:

- creation rejects an invalid scope before returning a controller;
- `start()` rejects a page outside the declared origin without creating a session;
- `stop()` cleans policy hooks and leaves the page open;
- `dispose()` is idempotent and rejects later `start()`/`perform()`;
- blocked actions do not resolve input bindings;
- guard-detected violations become failed attempts; and
- browser loss retains WES-185 terminal behavior.

```ts
await expect(
  createPolicyEnforcedPlaywrightDiscoveryRehearsalController(page, {
    chromiumNetworkInstrumentation: "exclusive",
    policy: { mode: "safe", allowedOrigins: ["https://other.test"] },
    inputResolver: demoInputResolver,
  }),
).rejects.toMatchObject({ code: "origin_not_allowed" });

const controller = await createPolicyEnforcedPlaywrightDiscoveryRehearsalController(page, {
  chromiumNetworkInstrumentation: "exclusive",
  policy: { mode: "safe", allowedOrigins: ["https://example.test"] },
  inputResolver: demoInputResolver,
});
await controller.dispose();
await controller.dispose();
expect(page.isClosed()).toBe(false);
await expect(controller.start(sessionInput)).resolves.toMatchObject({
  ok: false,
  errors: [{ code: "discovery_policy_controller_disposed" }],
});
```

- [ ] **Step 4: Run policy controller tests and verify RED**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/playwrightPolicyDiscoveryRehearsal.test.ts
```

Expected: FAIL because the coupled factory does not exist.

- [ ] **Step 5: Extract a reusable internal Playwright runtime builder**

Refactor `playwrightDiscoveryRehearsal.ts` without changing its public factory. The internal builder should create the shared adapter, target registry, extractor, and base driver, and accept focused hooks:

```ts
type PlaywrightDiscoveryDriverHooks<TPermit> = {
  authorizeTarget?(targetId: string): DiscoveryRuntimeTargetRisk | undefined;
  beforeExecute?(input: {
    action: DiscoveryAction;
    permit: TPermit;
    resolvedValue?: string;
  }): DiscoveryRehearsalDriverResult | undefined;
  afterExecute?(): DiscoveryRehearsalDriverResult | undefined;
};
```

The legacy factory passes no hooks and must keep all existing tests green. The policy factory supplies hooks; do not duplicate the Playwright action driver.

- [ ] **Step 6: Implement the async coupled factory**

The factory performs this order:

```ts
export type DiscoveryPolicyControllerErrorCode =
  | DiscoveryPolicyValidationErrorCode
  | "policy_guard_unavailable"
  | "discovery_policy_controller_disposed";

export class DiscoveryPolicyControllerError extends Error {
  constructor(readonly code: DiscoveryPolicyControllerErrorCode) {
    super("Policy-enforced discovery controller setup failed.");
    this.name = "DiscoveryPolicyControllerError";
  }
}

const validated = validateDiscoveryPolicy(options.policy, page.url());
if (!validated.ok) {
  throw new DiscoveryPolicyControllerError(validated.errors[0]!.code);
}
const guard = await installPlaywrightDiscoveryPolicyGuard(page, validated.policy);
const authorizer = createDiscoveryPolicyAuthorizer(validated.policy, runtimeRiskLookup);
const controller = createPlaywrightDiscoveryRehearsalControllerInternal(page, {
  ...options,
  authorizer,
  hooks: policyHooks(guard),
});
return withPolicyLifecycle(controller, guard);
```

Use a wrapped input resolver or `beforeExecute` hook to reject oversized or `isSecretLikeValue()` inputs before the adapter receives them. Never include the resolved value in errors. Arm the guard only with the permit returned for the current action; consume it once. Convert pre-action policy decisions to blocked attempts through the existing authorizer seam and browser-time violations to failed driver outcomes.

Wrap `stop()` so terminal completion/abandonment is recorded before policy-hook cleanup. Return a stable cleanup error without reopening the terminal session. Serialize wrapper lifecycle operations so `dispose()` first prevents new work, waits for any active operation, then invokes retryable guard cleanup without closing the page.

- [ ] **Step 7: Run legacy and policy controller tests**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/playwrightDiscoveryRehearsal.test.ts src/playwrightPolicyDiscoveryRehearsal.test.ts src/discoveryRehearsal.test.ts
```

Expected: PASS with no behavior change to custom-authorizer consumers.

- [ ] **Step 8: Commit the coupled controller**

```bash
git add packages/agent/src/playwrightPolicyDiscoveryRehearsal.ts packages/agent/src/playwrightPolicyDiscoveryRehearsal.test.ts packages/agent/src/playwrightDiscoveryRehearsal.ts packages/agent/package.json
git commit -m "feat: add policy-enforced discovery controller"
```

### Task 6: Export And Document The Supported Workflow

**Files:**

- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/README.md`
- Modify: `packages/agent/src/wrapper-docs.test.ts`

- [ ] **Step 1: Write failing public-surface and documentation tests**

Add a compile-time/public import in `wrapper-docs.test.ts` and assert README coverage:

```ts
import {
  createPolicyEnforcedPlaywrightDiscoveryRehearsalController,
  type DiscoveryPolicy,
  type DisposableDiscoveryPolicy,
  type SafeDiscoveryPolicy,
} from "./index.js";

expect(readme).toContain("environment-is-disposable");
expect(readme).toContain("isolated Chromium rehearsal context");
expect(readme).toContain("never carries into final capture");
```

Do not export `DiscoveryPolicyPermit`, runtime target risk, guard interfaces, or raw violation storage.

- [ ] **Step 2: Run the docs test and verify RED**

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/wrapper-docs.test.ts
```

Expected: FAIL because the public exports and README text are missing.

- [ ] **Step 3: Add the supported exports**

Export the factory, input policy types, public creation error/result types, and stable policy outcome code from `index.ts`. Keep permit, guard, and runtime-risk types internal.

```ts
export {
  createPolicyEnforcedPlaywrightDiscoveryRehearsalController,
  DiscoveryPolicyControllerError,
  type DiscoveryPolicyControllerErrorCode,
  type PlaywrightPolicyDiscoveryRehearsalOptions,
} from "./playwrightPolicyDiscoveryRehearsal.js";

export {
  type DiscoveryPolicy,
  type DiscoveryPolicyOutcomeCode,
  type DisposableDiscoveryPolicy,
  type SafeDiscoveryPolicy,
} from "./discoveryPolicy.js";
```

- [ ] **Step 4: Document safe and disposable examples**

Add a README section showing:

```ts
const safe = await createPolicyEnforcedPlaywrightDiscoveryRehearsalController(page, {
  chromiumNetworkInstrumentation: "exclusive",
  policy: { mode: "safe", allowedOrigins: ["https://demo.example"] },
  inputResolver,
});

const disposable = await createPolicyEnforcedPlaywrightDiscoveryRehearsalController(page, {
  chromiumNetworkInstrumentation: "exclusive",
  policy: {
    mode: "disposable",
    acknowledgement: "environment-is-disposable",
    allowedOrigins: ["https://sandbox.example"],
  },
  inputResolver,
});
```

State that the host obtains explicit approval, uses an isolated Chromium rehearsal context containing one page with no external CDP network overrides, disposes the controller after rehearsal, and receives no authority transfer to WES-187 compilation, replay, approval, execution, or capture. List protections that remain hard-blocked in both modes.

- [ ] **Step 5: Run docs, typecheck, and the full agent suite**

```bash
rtk npm --workspace @auto-demo/agent run typecheck
rtk npm --workspace @auto-demo/agent test
```

Expected: typecheck PASS and all agent tests PASS, including every new explicit test file.

- [ ] **Step 6: Commit exports and documentation**

```bash
git add packages/agent/src/index.ts packages/agent/README.md packages/agent/src/wrapper-docs.test.ts
git commit -m "docs: describe safe discovery policy workflow"
```

### Task 7: Review, Repository Verification, And Linear Completion Gate

**Files:**

- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Run focused formatting and diff checks**

```bash
rtk proxy npx prettier --check packages/agent/src/actionSafety.ts packages/agent/src/actionSafety.test.ts packages/agent/src/discoveryPolicy.ts packages/agent/src/discoveryPolicy.test.ts packages/agent/src/discoveryObservation.ts packages/agent/src/discoveryObservationTransform.ts packages/agent/src/discoveryTargetRegistry.ts packages/agent/src/playwrightDiscoveryPage.ts packages/agent/src/playwrightDiscoveryPolicyGuard.ts packages/agent/src/playwrightDiscoveryPolicyGuard.test.ts packages/agent/src/playwrightPolicyDiscoveryRehearsal.ts packages/agent/src/playwrightPolicyDiscoveryRehearsal.test.ts packages/agent/src/playwrightDiscoveryRehearsal.ts packages/agent/src/walkthroughValidation.ts packages/agent/src/index.ts packages/agent/src/wrapper-docs.test.ts packages/agent/README.md packages/agent/package.json docs/superpowers/specs/2026-07-15-wes-186-safe-disposable-discovery-policies-design.md docs/superpowers/plans/2026-07-15-wes-186-safe-disposable-discovery-policies.md docs/linear/auto-demo-project-structure.md
rtk git diff --check
```

Expected: both commands PASS. If repository-wide formatting later fails only on preserved unrelated user files, report that separately and do not modify them without authorization.

- [ ] **Step 2: Run full repository verification**

```bash
rtk npm run build
rtk npm run typecheck
rtk npm run lint
rtk npm test
rtk npm run format:check
```

Expected: build, typecheck, lint, all workspace tests, and formatting PASS. Record exact test counts and any unrelated pre-existing failure rather than claiming success from partial checks.

- [ ] **Step 3: Request code review and address findings**

Use `superpowers:requesting-code-review`. Review specifically for fail-open paths, permit reuse, secret leakage, origin normalization, CDP WebSocket cleanup, unrelated route removal, and `DiscoverySessionV1` changes. Apply accepted findings with focused regression tests, then rerun Step 2.

- [ ] **Step 4: Run the Linear completion sync gate**

Use `linear-sync-gate` in `completion-gate` mode with WES-186, this spec and plan, changed files, commits, review result, and fresh verification evidence. Reconcile WES-187 and WES-188 readiness plus tracker WES-182.

- [ ] **Step 5: Apply only clear completion writes**

If the completion gate passes, add concise evidence to WES-186, move it to Done, add a readiness note to WES-188, and update the project map with commit/PR/test evidence and the next-task pointer. Do not close WES-182 or claim WES-187 complete.

- [ ] **Step 6: Commit the project sync update**

```bash
git add docs/linear/auto-demo-project-structure.md
git commit -m "docs: complete WES-186 project sync"
```

Expected: working tree contains only preserved unrelated user files, and WES-186 completion is supported by durable verification evidence.
