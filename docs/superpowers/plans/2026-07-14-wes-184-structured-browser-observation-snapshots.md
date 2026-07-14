# WES-184 Structured Browser Observation Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded, transcript-safe, stateful browser observation extractor that returns WES-183-compatible discovery observations with stable opaque target IDs and an optional screenshot reference.

**Architecture:** `discoveryObservation.ts` owns the public result types, document-scoped target registry, retry loop, screenshot coordination, and structured failures. `discoveryObservationTransform.ts` owns pure sanitization, prioritization, occurrence calculation, limits, and diagnostics. `playwrightDiscoveryObservation.ts` adapts an existing Playwright `Page` through one atomic main-document evaluation while preserving page-side element identity.

**Tech Stack:** TypeScript ES modules, Node.js crypto, Playwright 1.61, Vitest 4, npm workspaces, ESLint, Prettier, Linear CLI.

---

## Dependency Gate

WES-184 implementation is blocked until WES-183 is durably integrated or explicitly reopened and reconciled. At plan-writing time, WES-183 is Done in Linear but its implementation exists only in the dirty worktree at `develop`/`origin/develop` commit `089cda0`.

Do not create a WES-184 implementation branch, move WES-184 to In Progress, or edit product source until Task 0 passes.

## Approved Design

- Spec: `docs/superpowers/specs/2026-07-14-wes-184-structured-browser-observation-snapshots-design.md`
- Project map: `docs/linear/auto-demo-project-structure.md`
- Linear issue: https://linear.app/weston-bushyeager/issue/WES-184/expose-structured-browser-observation-snapshots-for-host-agents

## File Map

Create:

- `packages/agent/src/discoveryObservation.ts` — public extractor API, registry lifetime, retry, screenshot persistence, and stable errors.
- `packages/agent/src/discoveryObservationTransform.ts` — pure raw-snapshot conversion, sanitization, tier ordering, occurrence values, limits, and diagnostics.
- `packages/agent/src/discoveryObservation.test.ts` — fake-adapter behavior tests for the generic extractor.
- `packages/agent/src/playwrightDiscoveryObservation.ts` — concrete Playwright page adapter and atomic browser-side collection.
- `packages/agent/src/playwrightDiscoveryObservation.test.ts` — Playwright-backed behavior tests against routed local HTML.

Modify:

- `packages/agent/src/index.ts` — export the WES-184 public factories and types.
- `packages/agent/package.json` — include both new test files in the package test command.
- `packages/agent/README.md` — document observation extraction, diagnostics, target lifetime, and screenshot behavior.
- `README.md` — update the repository-level discovery capability summary.
- `docs/linear/auto-demo-project-structure.md` — record WES-184 design, implementation, verification, and dependency reconciliation.

The new modules stay separate because page collection, pure transformation, and orchestration have different change reasons and test seams.

### Task 0: Reconcile WES-183 And Re-run The Pre-Task Gate

**Files:**

- Inspect: `packages/agent/src/discoveryContract.ts`
- Inspect: `packages/agent/src/discoverySession.ts`
- Inspect: `packages/agent/src/discoveryValidation.ts`
- Inspect: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Confirm the WES-183 files are durably present in git history**

Run:

```bash
rtk git log --all --oneline -- packages/agent/src/discoveryContract.ts packages/agent/src/discoverySession.ts packages/agent/src/discoveryValidation.ts
rtk git status --short packages/agent/src/discoveryContract.ts packages/agent/src/discoverySession.ts packages/agent/src/discoveryValidation.ts
```

Expected: the log contains the integrated WES-183 commit or merge, and the status command shows no uncommitted WES-183 source files. If the log is empty or the files remain dirty, stop WES-184 work and either finish integrating WES-183 or reopen WES-183 in Linear.

- [ ] **Step 2: Confirm the WES-183 public contract is available from the package entrypoint**

Run:

```bash
rtk rg -n "DiscoverySessionV1|RecordDiscoveryObservationInput|recordDiscoveryObservation|sanitizeDiscoveryText|sanitizeDiscoveryUrl|isSafeArtifactPath" packages/agent/src/index.ts packages/agent/src/discoverySession.ts packages/agent/src/discoveryValidation.ts
```

Expected: the WES-183 types and lifecycle operation exist, and the internal sanitization/path helpers are available for WES-184 reuse.

- [ ] **Step 3: Run `linear-sync-gate` in `pre-task` mode**

Provide:

```text
mode: pre-task
repository: /Users/weston.bushyeager/code/personal/auto-demo
project map: docs/linear/auto-demo-project-structure.md
Linear project: Auto Demo Balanced MVP
candidate: WES-184
selection rule: earliest incomplete milestone; prefer started, then unblocked design/spec, then dependency-ready implementation
dependency evidence: integrated WES-183 commit plus current verification evidence
```

Expected: the gate confirms WES-184 is implementation-ready. If it still reports WES-183 as local-only or ambiguous, stop.

- [ ] **Step 4: Move WES-184 to In Progress only after the gate passes**

Run:

```bash
rtk linear issue update WES-184 --state "In Progress"
rtk linear issue view WES-184 --no-pager
```

Expected: WES-184 reports `State: In Progress`; WES-182 remains Backlog and WES-185 remains blocked by WES-184.

- [ ] **Step 5: Create or switch to the isolated WES-184 implementation worktree**

Invoke `superpowers:using-git-worktrees` and create the worktree from the branch containing the integrated WES-183 dependency. Do not carry unrelated dirty files into it.

Expected: the isolated worktree is clean and contains the approved spec plus integrated WES-183 source.

### Task 1: Define The Generic Extractor Contract And Happy Path

**Files:**

- Create: `packages/agent/src/discoveryObservation.ts`
- Create: `packages/agent/src/discoveryObservation.test.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/package.json`

- [ ] **Step 1: Write the failing public happy-path test**

Create `packages/agent/src/discoveryObservation.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import {
  createDiscoveryObservationExtractor,
  createDiscoverySession,
  recordDiscoveryObservation,
  type DiscoveryObservationPage,
} from "./index.js";

function safePage(): DiscoveryObservationPage {
  return {
    async isAvailable() {
      return true;
    },
    async readDocumentToken() {
      return "document-1";
    },
    async collectSnapshot() {
      return {
        documentToken: "document-1",
        url: "https://example.com/checkout",
        title: "Checkout",
        viewport: { width: 1280, height: 720 },
        canGoBack: false,
        visibleStates: [
          { identityKey: "text-cart", kind: "heading" as const, summary: "Your cart", order: 1 },
        ],
        interactiveTargets: [
          {
            identityKey: "element-checkout",
            tier: "semantic" as const,
            label: "Checkout",
            role: "button",
            order: 2,
            disabled: false,
            credential: false,
          },
        ],
      };
    },
    async captureViewportPng() {
      return new Uint8Array([1, 2, 3]);
    },
    async hasLiveIdentity(identityKey, documentToken) {
      return identityKey === "element-checkout" && documentToken === "document-1";
    },
  };
}

describe("createDiscoveryObservationExtractor", () => {
  it("returns an observation accepted by the discovery session lifecycle", async () => {
    const ids = ["observation-1", "target-checkout", "visible-cart"];
    const extractor = createDiscoveryObservationExtractor({
      page: safePage(),
      clock: () => "2026-07-14T12:00:01.000Z",
      idGenerator: () => ids.shift() ?? "unexpected-id",
    });

    const extracted = await extractor.observe();
    expect(extracted).toEqual({
      ok: true,
      observation: {
        id: "observation-1",
        observedAt: "2026-07-14T12:00:01.000Z",
        page: {
          url: "https://example.com/checkout",
          title: "Checkout",
          viewport: { width: 1280, height: 720 },
          navigation: { canGoBack: false },
        },
        visibleStates: [{ id: "visible-cart", kind: "text", summary: "Your cart" }],
        interactiveTargets: [
          { id: "target-checkout", label: "Checkout", role: "button", disabled: false },
        ],
        artifacts: [],
      },
      diagnostics: [],
    });

    const created = createDiscoverySession({
      id: "session-1",
      target: { kind: "browser", startUrl: "https://example.com/checkout" },
      goal: "Show checkout",
      host: { name: "codex", version: "1.0.0" },
      createdAt: "2026-07-14T12:00:00.000Z",
    });
    if (!created.ok || !extracted.ok) throw new Error("fixtures must be valid");
    expect(recordDiscoveryObservation(created.session, extracted.observation)).toMatchObject({
      ok: true,
      session: { observations: [{ id: "observation-1", sequence: 1 }] },
    });
  });
});
```

- [ ] **Step 2: Add the test file to the package command and verify the red state**

Append `src/discoveryObservation.test.ts` to the `test` script in `packages/agent/package.json`.

Run:

```bash
rtk npm --workspace @auto-demo/agent test -- src/discoveryObservation.test.ts
```

Expected: FAIL because `createDiscoveryObservationExtractor` and `DiscoveryObservationPage` are not exported.

- [ ] **Step 3: Add the public types and minimal stateful extractor**

Create `packages/agent/src/discoveryObservation.ts` with these complete public shapes and the initial safe-path coordinator:

```ts
import { randomUUID } from "node:crypto";
import { DISCOVERY_LIMITS } from "./discoveryContract.js";
import type { RecordDiscoveryObservationInput } from "./discoverySession.js";

export type DiscoveryObservationDiagnosticCode =
  | "interactive_targets_truncated"
  | "visible_states_truncated"
  | "content_redacted"
  | "credential_target_present"
  | "fallback_targets_included"
  | "screenshot_unavailable"
  | "unstable_page_retried";

export type DiscoveryObservationDiagnostic = {
  code: DiscoveryObservationDiagnosticCode;
  message: string;
  count?: number;
};

export type DiscoveryObservationExtractionErrorCode =
  | "browser_unavailable"
  | "page_evaluation_failed"
  | "invalid_page_state"
  | "unsafe_page_url"
  | "unstable_page";

export type DiscoveryObservationExtractionError = {
  code: DiscoveryObservationExtractionErrorCode;
  message: string;
  path?: string;
};

export type DiscoveryObservationExtractionResult =
  | {
      ok: true;
      observation: RecordDiscoveryObservationInput;
      diagnostics: DiscoveryObservationDiagnostic[];
    }
  | { ok: false; errors: DiscoveryObservationExtractionError[] };

export type DiscoveryObservationRawVisibleState = {
  identityKey: string;
  kind: "status" | "heading" | "text";
  summary: string;
  order: number;
};

export type DiscoveryObservationRawTarget = {
  identityKey: string;
  tier: "semantic" | "fallback";
  label: string;
  role?: string;
  order: number;
  disabled: boolean;
  credential: boolean;
  actionRisk?: "potentially-mutating";
};

export type DiscoveryObservationPageSnapshot = {
  documentToken: string;
  url: string;
  title: string;
  viewport: { width: number; height: number };
  canGoBack: boolean;
  visibleStates: DiscoveryObservationRawVisibleState[];
  interactiveTargets: DiscoveryObservationRawTarget[];
};

export interface DiscoveryObservationPage {
  isAvailable(): Promise<boolean>;
  readDocumentToken(): Promise<string>;
  collectSnapshot(): Promise<DiscoveryObservationPageSnapshot>;
  captureViewportPng(): Promise<Uint8Array>;
  hasLiveIdentity(identityKey: string, documentToken: string): Promise<boolean>;
}

export type DiscoveryObservationArtifactSink = {
  write(input: {
    id: string;
    bytes: Uint8Array;
    mediaType: "image/png";
    sha256: string;
  }): Promise<{ path: string }>;
};

export type DiscoveryObservationIdKind = "observation" | "visible-state" | "target" | "artifact";

export type DiscoveryObservationExtractorDependencies = {
  page: DiscoveryObservationPage;
  artifactSink?: DiscoveryObservationArtifactSink;
  clock?: () => string;
  idGenerator?: (kind: DiscoveryObservationIdKind) => string;
};

export interface DiscoveryObservationExtractor {
  observe(): Promise<DiscoveryObservationExtractionResult>;
  hasLiveTarget(targetId: string): Promise<boolean>;
}

const error = (
  code: DiscoveryObservationExtractionErrorCode,
  message: string,
  path?: string,
): DiscoveryObservationExtractionResult => ({
  ok: false,
  errors: [{ code, message, ...(path === undefined ? {} : { path }) }],
});

export function createDiscoveryObservationExtractor(
  dependencies: DiscoveryObservationExtractorDependencies,
): DiscoveryObservationExtractor {
  const clock = dependencies.clock ?? (() => new Date().toISOString());
  const idGenerator =
    dependencies.idGenerator ?? ((kind: DiscoveryObservationIdKind) => `${kind}-${randomUUID()}`);
  let activeDocumentToken: string | undefined;
  const targetIdByIdentity = new Map<string, string>();
  const identityByTargetId = new Map<string, string>();

  const resetDocument = (documentToken: string) => {
    if (activeDocumentToken === documentToken) return;
    activeDocumentToken = documentToken;
    targetIdByIdentity.clear();
    identityByTargetId.clear();
  };

  const targetId = (identityKey: string) => {
    const existing = targetIdByIdentity.get(identityKey);
    if (existing !== undefined) return existing;
    const created = idGenerator("target");
    targetIdByIdentity.set(identityKey, created);
    identityByTargetId.set(created, identityKey);
    return created;
  };

  return {
    async observe() {
      if (!(await dependencies.page.isAvailable())) {
        return error("browser_unavailable", "Discovery observation browser is unavailable.");
      }
      let snapshot: DiscoveryObservationPageSnapshot;
      try {
        snapshot = await dependencies.page.collectSnapshot();
      } catch {
        return error("page_evaluation_failed", "Discovery page observation failed.");
      }
      resetDocument(snapshot.documentToken);
      const observationId = idGenerator("observation");
      const occurrence = new Map<string, number>();
      const targets = snapshot.interactiveTargets
        .sort((left, right) => left.order - right.order)
        .slice(0, DISCOVERY_LIMITS.interactiveTargetsPerObservation)
        .map((candidate) => {
          const key = `${candidate.label}\u0000${candidate.role ?? ""}`;
          const nextOccurrence = (occurrence.get(key) ?? 0) + 1;
          occurrence.set(key, nextOccurrence);
          return {
            id: targetId(candidate.identityKey),
            label: candidate.label,
            ...(candidate.role === undefined ? {} : { role: candidate.role }),
            ...(snapshot.interactiveTargets.filter(
              (value) => `${value.label}\u0000${value.role ?? ""}` === key,
            ).length > 1
              ? { occurrence: nextOccurrence }
              : {}),
            disabled: candidate.disabled,
            ...(candidate.actionRisk === undefined ? {} : { actionRisk: candidate.actionRisk }),
          };
        });
      return {
        ok: true,
        observation: {
          id: observationId,
          observedAt: clock(),
          page: {
            url: snapshot.url,
            title: snapshot.title,
            viewport: snapshot.viewport,
            navigation: { canGoBack: snapshot.canGoBack },
          },
          visibleStates: snapshot.visibleStates
            .sort((left, right) => left.order - right.order)
            .slice(0, DISCOVERY_LIMITS.visibleStatesPerObservation)
            .map((value) => ({
              id: idGenerator("visible-state"),
              kind: value.kind === "status" ? "status" : "text",
              summary: value.summary,
            })),
          interactiveTargets: targets,
          artifacts: [],
        },
        diagnostics: [],
      };
    },
    async hasLiveTarget(candidateTargetId) {
      const identityKey = identityByTargetId.get(candidateTargetId);
      if (identityKey === undefined || activeDocumentToken === undefined) return false;
      const live = await dependencies.page.hasLiveIdentity(identityKey, activeDocumentToken);
      if (!live) {
        identityByTargetId.delete(candidateTargetId);
        targetIdByIdentity.delete(identityKey);
      }
      return live;
    },
  };
}
```

- [ ] **Step 4: Export the generic API**

Add to `packages/agent/src/index.ts` after the discovery-session exports:

```ts
export {
  createDiscoveryObservationExtractor,
  type DiscoveryObservationArtifactSink,
  type DiscoveryObservationDiagnostic,
  type DiscoveryObservationDiagnosticCode,
  type DiscoveryObservationExtractionError,
  type DiscoveryObservationExtractionErrorCode,
  type DiscoveryObservationExtractionResult,
  type DiscoveryObservationExtractor,
  type DiscoveryObservationExtractorDependencies,
  type DiscoveryObservationIdKind,
  type DiscoveryObservationPage,
  type DiscoveryObservationPageSnapshot,
  type DiscoveryObservationRawTarget,
  type DiscoveryObservationRawVisibleState,
} from "./discoveryObservation.js";
```

- [ ] **Step 5: Run the focused test and package typecheck**

Run:

```bash
rtk npm --workspace @auto-demo/agent test -- src/discoveryObservation.test.ts
rtk npm --workspace @auto-demo/agent run typecheck
```

Expected: the focused test passes with 1 test, and typecheck exits 0.

- [ ] **Step 6: Commit the public contract slice**

```bash
rtk git add packages/agent/src/discoveryObservation.ts packages/agent/src/discoveryObservation.test.ts packages/agent/src/index.ts packages/agent/package.json
rtk git commit -m "feat: define discovery observation extractor"
```

### Task 2: Add Pure Sanitization, Priority, Limits, And Diagnostics

**Files:**

- Create: `packages/agent/src/discoveryObservationTransform.ts`
- Modify: `packages/agent/src/discoveryObservation.ts`
- Modify: `packages/agent/src/discoveryObservation.test.ts`

- [ ] **Step 1: Add failing black-box tests for redaction and deterministic limits**

Add two tests to `packages/agent/src/discoveryObservation.test.ts`:

```ts
it("sanitizes content and prioritizes semantic targets before fallbacks", async () => {
  const page = safePage();
  page.collectSnapshot = async () => ({
    documentToken: "document-1",
    url: "https://example.com/checkout",
    title: "Checkout token=abcdefghijklmnopqrstuvwx1234",
    viewport: { width: 1280, height: 720 },
    canGoBack: false,
    visibleStates: [
      {
        identityKey: "text-1",
        kind: "text",
        summary: "token=abcdefghijklmnopqrstuvwx1234",
        order: 1,
      },
      { identityKey: "status-1", kind: "status", summary: "Ready", order: 2 },
    ],
    interactiveTargets: [
      {
        identityKey: "fallback-1",
        tier: "fallback",
        label: "Card",
        order: 1,
        disabled: false,
        credential: false,
      },
      {
        identityKey: "semantic-1",
        tier: "semantic",
        label: "Submit",
        role: "button",
        order: 2,
        disabled: false,
        credential: true,
        actionRisk: "potentially-mutating",
      },
    ],
  });
  const ids = ["observation-1", "target-1", "target-2", "visible-1", "visible-2"];
  const result = await createDiscoveryObservationExtractor({
    page,
    clock: () => "2026-07-14T12:00:01.000Z",
    idGenerator: () => ids.shift() ?? "unexpected-id",
  }).observe();

  expect(result).toMatchObject({
    ok: true,
    observation: {
      page: { title: expect.stringContaining("[redacted-secret]") },
      visibleStates: expect.arrayContaining([
        { id: expect.any(String), kind: "status", summary: "Ready" },
        { id: expect.any(String), kind: "text", summary: "[redacted-secret]" },
      ]),
      interactiveTargets: [
        { label: "Submit", role: "button", actionRisk: "potentially-mutating" },
        { label: "Card" },
      ],
    },
    diagnostics: expect.arrayContaining([
      { code: "content_redacted" },
      { code: "credential_target_present", count: 1 },
      { code: "fallback_targets_included", count: 1 },
    ]),
  });
  expect(JSON.stringify(result)).not.toContain("abcdefghijklmnopqrstuvwx1234");
});

it("reports omitted target and visible-state counts without returning omitted content", async () => {
  const page = safePage();
  page.collectSnapshot = async () => ({
    documentToken: "document-1",
    url: "https://example.com",
    title: "Example",
    viewport: { width: 1280, height: 720 },
    canGoBack: false,
    visibleStates: Array.from({ length: 51 }, (_, index) => ({
      identityKey: `visible-${index}`,
      kind: "text" as const,
      summary: `Visible ${index}`,
      order: index,
    })),
    interactiveTargets: Array.from({ length: 101 }, (_, index) => ({
      identityKey: `target-${index}`,
      tier: "semantic" as const,
      label: `Target ${index}`,
      role: "button",
      order: index,
      disabled: false,
      credential: false,
    })),
  });
  const result = await createDiscoveryObservationExtractor({ page }).observe();
  expect(result).toMatchObject({
    ok: true,
    observation: { visibleStates: { length: 50 }, interactiveTargets: { length: 100 } },
    diagnostics: expect.arrayContaining([
      { code: "visible_states_truncated", count: 1 },
      { code: "interactive_targets_truncated", count: 1 },
    ]),
  });
  expect(JSON.stringify(result)).not.toContain("Target 100");
  expect(JSON.stringify(result)).not.toContain("Visible 50");
});
```

- [ ] **Step 2: Run the tests to verify the new behavior is missing**

Run:

```bash
rtk npm --workspace @auto-demo/agent test -- src/discoveryObservation.test.ts
```

Expected: FAIL because semantic targets are not prioritized and diagnostics/redaction are absent.

- [ ] **Step 3: Add the pure transformation module**

Create `packages/agent/src/discoveryObservationTransform.ts`. Implement and export:

```ts
import { DISCOVERY_LIMITS, type DiscoveryInteractiveTarget } from "./discoveryContract.js";
import type {
  DiscoveryObservationDiagnostic,
  DiscoveryObservationExtractionError,
  DiscoveryObservationIdKind,
  DiscoveryObservationPageSnapshot,
} from "./discoveryObservation.js";
import type { RecordDiscoveryObservationInput } from "./discoverySession.js";
import { sanitizeDiscoveryText, sanitizeDiscoveryUrl } from "./discoveryValidation.js";

const TITLE_LIMIT = 512;
const LABEL_LIMIT = 256;
const SUMMARY_LIMIT = 500;

const MESSAGES = {
  interactive_targets_truncated: "Additional interactive targets were omitted.",
  visible_states_truncated: "Additional visible states were omitted.",
  content_redacted: "Sensitive or oversized page content was redacted.",
  credential_target_present: "Credential-like input is present.",
  fallback_targets_included: "Focusable or clickable-looking fallback targets were included.",
  screenshot_unavailable: "The optional viewport screenshot is unavailable.",
  unstable_page_retried: "Observation retried after the main document changed.",
} as const;

export function diagnostic(
  code: DiscoveryObservationDiagnostic["code"],
  count?: number,
): DiscoveryObservationDiagnostic {
  return { code, message: MESSAGES[code], ...(count === undefined ? {} : { count }) };
}

function publicText(value: string, limit: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const sanitized = sanitizeDiscoveryText(normalized).replace(/\s+/g, " ").trim();
  const bounded = sanitized.slice(0, limit).trim();
  return { value: bounded, changed: bounded !== normalized };
}

const TARGET_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "switch",
  "combobox",
  "listbox",
  "option",
  "tab",
  "menuitem",
  "slider",
  "spinbutton",
]);

export type BuildDiscoveryObservationInput = {
  snapshot: DiscoveryObservationPageSnapshot;
  observedAt: string;
  idGenerator: (kind: DiscoveryObservationIdKind) => string;
  targetId: (identityKey: string) => string;
};

export type BuildDiscoveryObservationResult =
  | {
      ok: true;
      observation: RecordDiscoveryObservationInput;
      diagnostics: DiscoveryObservationDiagnostic[];
    }
  | { ok: false; errors: DiscoveryObservationExtractionError[] };

export function buildDiscoveryObservation(
  input: BuildDiscoveryObservationInput,
): BuildDiscoveryObservationResult {
  const { snapshot, observedAt, idGenerator, targetId } = input;
  const url = sanitizeDiscoveryUrl(snapshot.url);
  if (url === undefined) {
    return {
      ok: false,
      errors: [
        { code: "unsafe_page_url", message: "Discovery page URL is unsafe.", path: "page.url" },
      ],
    };
  }
  if (
    !Number.isInteger(snapshot.viewport.width) ||
    snapshot.viewport.width <= 0 ||
    !Number.isInteger(snapshot.viewport.height) ||
    snapshot.viewport.height <= 0
  ) {
    return {
      ok: false,
      errors: [
        {
          code: "invalid_page_state",
          message: "Discovery page state is invalid.",
          path: "page.viewport",
        },
      ],
    };
  }
  const title = publicText(snapshot.title, TITLE_LIMIT);
  if (title.value.length === 0) {
    return {
      ok: false,
      errors: [
        {
          code: "invalid_page_state",
          message: "Discovery page state is invalid.",
          path: "page.title",
        },
      ],
    };
  }
  const observationId = idGenerator("observation");

  let redactedCount = title.changed ? 1 : 0;
  const seenSummaries = new Set<string>();
  const visibleCandidates = snapshot.visibleStates
    .map((candidate) => ({ candidate, sanitized: publicText(candidate.summary, SUMMARY_LIMIT) }))
    .filter(({ sanitized }) => {
      if (sanitized.changed) redactedCount += 1;
      if (sanitized.value.length === 0 || seenSummaries.has(sanitized.value)) return false;
      seenSummaries.add(sanitized.value);
      return true;
    })
    .sort((left, right) => {
      const leftTier = left.candidate.kind === "status" ? 0 : 1;
      const rightTier = right.candidate.kind === "status" ? 0 : 1;
      return leftTier - rightTier || left.candidate.order - right.candidate.order;
    });

  const targetCandidates = snapshot.interactiveTargets
    .map((candidate) => {
      const sanitized = publicText(candidate.label, LABEL_LIMIT);
      const candidateRole =
        candidate.role === undefined
          ? undefined
          : publicText(candidate.role.toLowerCase(), LABEL_LIMIT).value;
      const role =
        candidateRole !== undefined && TARGET_ROLES.has(candidateRole) ? candidateRole : undefined;
      return { candidate, sanitized, role };
    })
    .filter(({ sanitized }) => {
      if (sanitized.changed) redactedCount += 1;
      return sanitized.value.length > 0;
    })
    .sort((left, right) => {
      const leftTier = left.candidate.tier === "semantic" ? 0 : 1;
      const rightTier = right.candidate.tier === "semantic" ? 0 : 1;
      return leftTier - rightTier || left.candidate.order - right.candidate.order;
    });

  const duplicateCounts = new Map<string, number>();
  for (const { sanitized, role } of targetCandidates) {
    const key = `${sanitized.value}\u0000${role ?? ""}`;
    duplicateCounts.set(key, (duplicateCounts.get(key) ?? 0) + 1);
  }
  const occurrences = new Map<string, number>();
  const selectedTargets = targetCandidates.slice(
    0,
    DISCOVERY_LIMITS.interactiveTargetsPerObservation,
  );
  const interactiveTargets: DiscoveryInteractiveTarget[] = selectedTargets.map(
    ({ candidate, sanitized, role }) => {
      const key = `${sanitized.value}\u0000${role ?? ""}`;
      const occurrence = (occurrences.get(key) ?? 0) + 1;
      occurrences.set(key, occurrence);
      return {
        id: targetId(candidate.identityKey),
        label: sanitized.value,
        ...(role === undefined ? {} : { role }),
        ...((duplicateCounts.get(key) ?? 0) > 1 ? { occurrence } : {}),
        disabled: candidate.disabled,
        ...(candidate.actionRisk === undefined ? {} : { actionRisk: candidate.actionRisk }),
      };
    },
  );

  const diagnostics: DiscoveryObservationDiagnostic[] = [];
  if (visibleCandidates.length > DISCOVERY_LIMITS.visibleStatesPerObservation) {
    diagnostics.push(
      diagnostic(
        "visible_states_truncated",
        visibleCandidates.length - DISCOVERY_LIMITS.visibleStatesPerObservation,
      ),
    );
  }
  if (targetCandidates.length > DISCOVERY_LIMITS.interactiveTargetsPerObservation) {
    diagnostics.push(
      diagnostic(
        "interactive_targets_truncated",
        targetCandidates.length - DISCOVERY_LIMITS.interactiveTargetsPerObservation,
      ),
    );
  }
  if (redactedCount > 0) diagnostics.push(diagnostic("content_redacted", redactedCount));
  const credentialCount = selectedTargets.filter(({ candidate }) => candidate.credential).length;
  if (credentialCount > 0)
    diagnostics.push(diagnostic("credential_target_present", credentialCount));
  const fallbackCount = selectedTargets.filter(
    ({ candidate }) => candidate.tier === "fallback",
  ).length;
  if (fallbackCount > 0) diagnostics.push(diagnostic("fallback_targets_included", fallbackCount));

  return {
    ok: true,
    observation: {
      id: observationId,
      observedAt,
      page: {
        url,
        title: title.value,
        viewport: { ...snapshot.viewport },
        navigation: { canGoBack: snapshot.canGoBack },
      },
      visibleStates: visibleCandidates
        .slice(0, DISCOVERY_LIMITS.visibleStatesPerObservation)
        .map(({ candidate, sanitized }) => ({
          id: idGenerator("visible-state"),
          kind: candidate.kind === "status" ? "status" : "text",
          summary: sanitized.value,
        })),
      interactiveTargets,
      artifacts: [],
    },
    diagnostics,
  };
}
```

- [ ] **Step 4: Replace inline transformation with the pure builder**

In `discoveryObservation.ts`, import `buildDiscoveryObservation`. After `resetDocument(snapshot.documentToken)`, replace the inline observation construction with:

```ts
return buildDiscoveryObservation({
  snapshot,
  observedAt: clock(),
  idGenerator,
  targetId,
});
```

Remove the now-unused `DISCOVERY_LIMITS` import and inline occurrence/collection code.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
rtk npm --workspace @auto-demo/agent test -- src/discoveryObservation.test.ts
rtk npm --workspace @auto-demo/agent run typecheck
```

Expected: all generic extractor tests pass and typecheck exits 0.

- [ ] **Step 6: Commit pure transformation behavior**

```bash
rtk git add packages/agent/src/discoveryObservation.ts packages/agent/src/discoveryObservationTransform.ts packages/agent/src/discoveryObservation.test.ts
rtk git commit -m "feat: sanitize bounded discovery observations"
```

### Task 3: Add Document Retry, Stable Target Lifetime, And Structured Failures

**Files:**

- Modify: `packages/agent/src/discoveryObservation.ts`
- Modify: `packages/agent/src/discoveryObservation.test.ts`

- [ ] **Step 1: Add failing tests for retry and stale targets**

Add tests that drive the public adapter boundary:

```ts
it("retries one document replacement and reports the retry", async () => {
  const page = safePage();
  const tokens = ["document-1", "document-2", "document-2", "document-2"];
  page.readDocumentToken = async () => tokens.shift() ?? "document-2";
  page.collectSnapshot = async () => ({
    ...(await safePage().collectSnapshot()),
    documentToken: tokens.length >= 2 ? "document-1" : "document-2",
  });
  const result = await createDiscoveryObservationExtractor({ page }).observe();
  expect(result).toMatchObject({
    ok: true,
    diagnostics: expect.arrayContaining([{ code: "unstable_page_retried", count: 1 }]),
  });
});

it("fails without partial output when both document attempts are unstable", async () => {
  const page = safePage();
  let token = 0;
  page.readDocumentToken = async () => `document-${++token}`;
  await expect(createDiscoveryObservationExtractor({ page }).observe()).resolves.toEqual({
    ok: false,
    errors: [{ code: "unstable_page", message: "Discovery page changed during observation." }],
  });
});

it("keeps attached target ids stable and invalidates removed targets", async () => {
  const page = safePage();
  let live = true;
  page.hasLiveIdentity = async () => live;
  const ids = ["observation-1", "target-stable", "visible-1", "observation-2", "visible-2"];
  const extractor = createDiscoveryObservationExtractor({
    page,
    idGenerator: () => ids.shift() ?? "unexpected-id",
  });
  const first = await extractor.observe();
  const second = await extractor.observe();
  expect(first.ok && first.observation.interactiveTargets[0]?.id).toBe("target-stable");
  expect(second.ok && second.observation.interactiveTargets[0]?.id).toBe("target-stable");
  expect(await extractor.hasLiveTarget("target-stable")).toBe(true);
  live = false;
  expect(await extractor.hasLiveTarget("target-stable")).toBe(false);
});
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```bash
rtk npm --workspace @auto-demo/agent test -- src/discoveryObservation.test.ts
```

Expected: retry and repeated-instability tests fail because `observe()` does not compare document tokens.

- [ ] **Step 3: Add the two-attempt coordinator**

Replace the `observe()` body in `discoveryObservation.ts` with:

```ts
async observe() {
  if (!(await dependencies.page.isAvailable())) {
    return error("browser_unavailable", "Discovery observation browser is unavailable.");
  }
  let retried = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const beforeToken = await dependencies.page.readDocumentToken();
      const snapshot = await dependencies.page.collectSnapshot();
      const afterToken = await dependencies.page.readDocumentToken();
      if (
        beforeToken !== snapshot.documentToken ||
        snapshot.documentToken !== afterToken
      ) {
        retried = true;
        continue;
      }
      resetDocument(snapshot.documentToken);
      const built = buildDiscoveryObservation({
        snapshot,
        observedAt: clock(),
        idGenerator,
        targetId,
      });
      if (!built.ok) return built;
      return {
        ...built,
        diagnostics: [
          ...(retried ? [diagnostic("unstable_page_retried", 1)] : []),
          ...built.diagnostics,
        ],
      };
    } catch {
      if (!(await dependencies.page.isAvailable().catch(() => false))) {
        return error("browser_unavailable", "Discovery observation browser is unavailable.");
      }
      return error("page_evaluation_failed", "Discovery page observation failed.");
    }
  }
  return error("unstable_page", "Discovery page changed during observation.");
},
```

Import `diagnostic` from `discoveryObservationTransform.ts`.

- [ ] **Step 4: Make liveness document-aware and exception-safe**

Replace `hasLiveTarget()` with:

```ts
async hasLiveTarget(candidateTargetId) {
  const identityKey = identityByTargetId.get(candidateTargetId);
  if (identityKey === undefined || activeDocumentToken === undefined) return false;
  try {
    if (!(await dependencies.page.isAvailable())) return false;
    const currentToken = await dependencies.page.readDocumentToken();
    if (currentToken !== activeDocumentToken) {
      resetDocument(currentToken);
      return false;
    }
    const live = await dependencies.page.hasLiveIdentity(identityKey, activeDocumentToken);
    if (!live) {
      identityByTargetId.delete(candidateTargetId);
      targetIdByIdentity.delete(identityKey);
    }
    return live;
  } catch {
    return false;
  }
},
```

- [ ] **Step 5: Add failure-table tests**

Add a table-driven test covering unavailable page, thrown collection, unsafe URL, invalid viewport, and empty title. Assert exact fixed codes and confirm serialized results do not contain an injected exception secret.

Use this expected table:

```ts
const expected = [
  "browser_unavailable",
  "page_evaluation_failed",
  "unsafe_page_url",
  "invalid_page_state",
  "invalid_page_state",
] as const;
```

Run the focused test after adding each case. Expected: every returned failure has `ok: false`, exactly one fixed error, and no partial `observation` property.

- [ ] **Step 6: Run focused tests and commit**

```bash
rtk npm --workspace @auto-demo/agent test -- src/discoveryObservation.test.ts
rtk npm --workspace @auto-demo/agent run typecheck
rtk git add packages/agent/src/discoveryObservation.ts packages/agent/src/discoveryObservation.test.ts
rtk git commit -m "feat: stabilize discovery observation sessions"
```

Expected: focused tests and typecheck pass, then the commit succeeds.

### Task 4: Add Optional Screenshot Persistence

**Files:**

- Modify: `packages/agent/src/discoveryObservation.ts`
- Modify: `packages/agent/src/discoveryObservation.test.ts`

- [ ] **Step 1: Write failing screenshot behavior tests**

Add tests for all four public outcomes:

```ts
it("persists an optional screenshot as a safe hashed artifact reference", async () => {
  const writes: Array<{ id: string; bytes: Uint8Array; sha256: string }> = [];
  const page = safePage();
  const ids = ["observation-1", "target-1", "visible-1", "artifact-1"];
  const result = await createDiscoveryObservationExtractor({
    page,
    idGenerator: () => ids.shift() ?? "unexpected-id",
    artifactSink: {
      async write(input) {
        writes.push(input);
        return { path: "artifacts/observation-1.png" };
      },
    },
  }).observe();
  expect(result).toMatchObject({
    ok: true,
    observation: {
      artifacts: [
        {
          id: "artifact-1",
          kind: "screenshot",
          path: "artifacts/observation-1.png",
          mediaType: "image/png",
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      ],
    },
  });
  expect(writes).toHaveLength(1);
  expect(Array.from(writes[0]?.bytes ?? [])).toEqual([1, 2, 3]);
});
```

Also add separate assertions that:

- no configured sink means `captureViewportPng()` is not called and `artifacts` stays empty without a diagnostic;
- a thrown capture or sink returns `ok: true`, no artifact, and one `screenshot_unavailable` diagnostic;
- sink path `../secret.png` returns the same diagnosed success and never exposes the path in the observation.

- [ ] **Step 2: Run the tests to verify screenshot behavior is missing**

Run:

```bash
rtk npm --workspace @auto-demo/agent test -- src/discoveryObservation.test.ts
```

Expected: FAIL because the sink is never called and no artifact is returned.

- [ ] **Step 3: Capture before the stability recheck and persist only after stability**

In `discoveryObservation.ts` import:

```ts
import { createHash, randomUUID } from "node:crypto";
import { isSafeArtifactPath } from "./discoveryValidation.js";
```

Inside each observation attempt, immediately after `collectSnapshot()` add:

```ts
let screenshotBytes: Uint8Array | undefined;
let screenshotFailed = false;
if (dependencies.artifactSink !== undefined) {
  try {
    screenshotBytes = await dependencies.page.captureViewportPng();
  } catch {
    screenshotFailed = true;
  }
}
```

After document stability and `buildDiscoveryObservation()` succeed, add:

```ts
const screenshotDiagnostics: DiscoveryObservationDiagnostic[] = [];
if (screenshotFailed) screenshotDiagnostics.push(diagnostic("screenshot_unavailable", 1));
if (screenshotBytes !== undefined && dependencies.artifactSink !== undefined) {
  const artifactId = idGenerator("artifact");
  const sha256 = createHash("sha256").update(screenshotBytes).digest("hex");
  try {
    const stored = await dependencies.artifactSink.write({
      id: artifactId,
      bytes: screenshotBytes,
      mediaType: "image/png",
      sha256,
    });
    if (!isSafeArtifactPath(stored.path)) {
      screenshotDiagnostics.push(diagnostic("screenshot_unavailable", 1));
    } else {
      built.observation.artifacts.push({
        id: artifactId,
        kind: "screenshot",
        path: stored.path,
        mediaType: "image/png",
        sha256,
      });
    }
  } catch {
    screenshotDiagnostics.push(diagnostic("screenshot_unavailable", 1));
  }
}
```

Return diagnostics in this order:

```ts
diagnostics: [
  ...(retried ? [diagnostic("unstable_page_retried", 1)] : []),
  ...built.diagnostics,
  ...screenshotDiagnostics,
],
```

Do not call the sink until after the second document-token read. Discard screenshot bytes from an unstable first attempt.

- [ ] **Step 4: Run focused tests, typecheck, and commit**

```bash
rtk npm --workspace @auto-demo/agent test -- src/discoveryObservation.test.ts
rtk npm --workspace @auto-demo/agent run typecheck
rtk git add packages/agent/src/discoveryObservation.ts packages/agent/src/discoveryObservation.test.ts
rtk git commit -m "feat: persist optional discovery screenshots"
```

Expected: focused tests and typecheck pass, then the commit succeeds.

### Task 5: Add The Concrete Playwright Observation Adapter

**Files:**

- Create: `packages/agent/src/playwrightDiscoveryObservation.ts`
- Create: `packages/agent/src/playwrightDiscoveryObservation.test.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/package.json`

- [ ] **Step 1: Write the first Playwright-backed behavior test**

Create `packages/agent/src/playwrightDiscoveryObservation.test.ts` with a routed local-page helper and one behavior test:

```ts
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPlaywrightDiscoveryObservationExtractor } from "./index.js";

let browser: Browser;
let context: BrowserContext;
let page: Page;

beforeEach(async () => {
  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  page = await context.newPage();
});

afterEach(async () => {
  await context.close();
  await browser.close();
});

async function openHtml(html: string, path = "/") {
  await page.route("https://example.test/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/html", body: html });
  });
  await page.goto(`https://example.test${path}`);
}

describe("createPlaywrightDiscoveryObservationExtractor", () => {
  it("describes visible semantic controls and meaningful page state", async () => {
    await openHtml(`
      <title>Checkout</title>
      <h1>Your cart</h1>
      <p>Review the selected items.</p>
      <button>Checkout</button>
      <button hidden>Hidden action</button>
      <div inert><button>Inert action</button></div>
    `);
    const result = await createPlaywrightDiscoveryObservationExtractor(page).observe();
    expect(result).toMatchObject({
      ok: true,
      observation: {
        page: {
          url: "https://example.test/",
          title: "Checkout",
          viewport: { width: 1280, height: 720 },
          navigation: { canGoBack: false },
        },
        visibleStates: expect.arrayContaining([
          expect.objectContaining({ kind: "text", summary: "Your cart" }),
          expect.objectContaining({ kind: "text", summary: "Review the selected items." }),
        ]),
        interactiveTargets: [
          expect.objectContaining({ label: "Checkout", role: "button", disabled: false }),
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain("Hidden action");
    expect(JSON.stringify(result)).not.toContain("Inert action");
  });
});
```

- [ ] **Step 2: Add the Playwright test file and verify the red state**

Append `src/playwrightDiscoveryObservation.test.ts` to the agent package test script.

Run:

```bash
rtk npm --workspace @auto-demo/agent test -- src/playwrightDiscoveryObservation.test.ts
```

Expected: FAIL because `createPlaywrightDiscoveryObservationExtractor` is not exported.

- [ ] **Step 3: Implement the concrete adapter boundary**

Create `packages/agent/src/playwrightDiscoveryObservation.ts` with:

```ts
import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import {
  createDiscoveryObservationExtractor,
  type DiscoveryObservationExtractor,
  type DiscoveryObservationExtractorDependencies,
  type DiscoveryObservationPage,
  type DiscoveryObservationPageSnapshot,
  type DiscoveryObservationRawTarget,
  type DiscoveryObservationRawVisibleState,
} from "./discoveryObservation.js";

export type PlaywrightDiscoveryObservationOptions = Omit<
  DiscoveryObservationExtractorDependencies,
  "page"
>;

type BrowserCollection = DiscoveryObservationPageSnapshot;

export function createPlaywrightDiscoveryObservationExtractor(
  page: Page,
  options: PlaywrightDiscoveryObservationOptions = {},
): DiscoveryObservationExtractor {
  return createDiscoveryObservationExtractor({
    ...options,
    page: new PlaywrightDiscoveryObservationPage(page),
  });
}

class PlaywrightDiscoveryObservationPage implements DiscoveryObservationPage {
  private readonly registryKey = `__auto_demo_discovery_${randomUUID().replaceAll("-", "_")}`;
  private knownMainDocumentEntries = 0;
  private lastMainDocumentUrl: string;

  constructor(private readonly page: Page) {
    this.lastMainDocumentUrl = page.url();
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      const nextUrl = frame.url();
      if (nextUrl === this.lastMainDocumentUrl) return;
      if (/^https?:/.test(this.lastMainDocumentUrl) && /^https?:/.test(nextUrl)) {
        this.knownMainDocumentEntries += 1;
      }
      this.lastMainDocumentUrl = nextUrl;
    });
  }

  async isAvailable() {
    return !this.page.isClosed();
  }

  async readDocumentToken() {
    return await this.page.evaluate(registryToken, this.registryKey);
  }

  async collectSnapshot(): Promise<BrowserCollection> {
    return await this.page.evaluate(collectBrowserSnapshot, {
      registryKey: this.registryKey,
      canGoBack: this.knownMainDocumentEntries > 0,
    });
  }

  async captureViewportPng() {
    return await this.page.screenshot({ type: "png" });
  }

  async hasLiveIdentity(identityKey: string, documentToken: string) {
    return await this.page.evaluate(
      ({ registryKey, identityKey, documentToken }) => {
        const root = globalThis as typeof globalThis & Record<string, unknown>;
        const state = root[registryKey] as
          { token: string; elements: Map<string, Element> } | undefined;
        if (state === undefined || state.token !== documentToken) return false;
        const element = state.elements.get(identityKey);
        if (element === undefined || !element.isConnected) {
          state.elements.delete(identityKey);
          return false;
        }
        return true;
      },
      { registryKey: this.registryKey, identityKey, documentToken },
    );
  }
}

function registryToken(registryKey: string) {
  const root = globalThis as typeof globalThis & Record<string, unknown>;
  type State = {
    token: string;
    nextIdentity: number;
    identities: WeakMap<Element, string>;
    elements: Map<string, Element>;
  };
  let state = root[registryKey] as State | undefined;
  if (state === undefined) {
    state = {
      token: `document-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      nextIdentity: 1,
      identities: new WeakMap<Element, string>(),
      elements: new Map<string, Element>(),
    };
    Object.defineProperty(root, registryKey, { value: state, configurable: true });
  }
  return state.token;
}
```

In the same file, implement `collectBrowserSnapshot()` as one browser evaluation. Use these exact rules:

```ts
function collectBrowserSnapshot(input: {
  registryKey: string;
  canGoBack: boolean;
}): BrowserCollection {
  const root = globalThis as typeof globalThis & Record<string, unknown>;
  type State = {
    token: string;
    nextIdentity: number;
    identities: WeakMap<Element, string>;
    elements: Map<string, Element>;
  };
  let state = root[input.registryKey] as State | undefined;
  if (state === undefined) {
    state = {
      token: `document-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      nextIdentity: 1,
      identities: new WeakMap<Element, string>(),
      elements: new Map<string, Element>(),
    };
    Object.defineProperty(root, input.registryKey, { value: state, configurable: true });
  }
  const documentToken = state.token;

  for (const [identity, element] of state.elements) {
    if (!element.isConnected) state.elements.delete(identity);
  }

  const identity = (element: Element) => {
    const existing = state.identities.get(element);
    if (existing !== undefined) return existing;
    const created = `element-${state.nextIdentity++}`;
    state.identities.set(element, created);
    state.elements.set(created, element);
    return created;
  };

  const elements: Element[] = [];
  const walk = (element: Element) => {
    elements.push(element);
    if (element instanceof HTMLElement && element.shadowRoot !== null) {
      for (const child of Array.from(element.shadowRoot.children)) walk(child);
    }
    if (element.tagName !== "IFRAME") {
      for (const child of Array.from(element.children)) walk(child);
    }
  };
  walk(document.documentElement);

  const visible = (element: Element) => {
    if (!(element instanceof HTMLElement) || element.hidden) return false;
    if (element.closest("[inert], [aria-hidden='true']") !== null) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const label = (element: Element) => {
    const labelledBy = element.getAttribute("aria-labelledby");
    const labelledText = labelledBy
      ?.split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    if (element instanceof HTMLInputElement && element.labels?.length) {
      const labels = Array.from(element.labels)
        .map((value) => value.textContent ?? "")
        .join(" ");
      if (labels.trim().length > 0) return labels;
    }
    return (
      element.getAttribute("aria-label") ??
      labelledText ??
      element.getAttribute("placeholder") ??
      element.getAttribute("alt") ??
      element.getAttribute("title") ??
      (element instanceof HTMLElement ? element.innerText : element.textContent) ??
      ""
    );
  };

  const role = (element: Element): string | undefined => {
    const explicit = element.getAttribute("role")?.toLowerCase();
    if (explicit !== undefined) return explicit;
    if (element instanceof HTMLAnchorElement && element.hasAttribute("href")) return "link";
    if (element instanceof HTMLButtonElement) return "button";
    if (element instanceof HTMLTextAreaElement) return "textbox";
    if (element instanceof HTMLSelectElement) return "combobox";
    if (element instanceof HTMLInputElement) {
      const type = element.type.toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      if (type === "number") return "spinbutton";
      if (type !== "hidden" && type !== "submit" && type !== "button" && type !== "image") {
        return type === "search" ? "searchbox" : "textbox";
      }
      return "button";
    }
    if (element instanceof HTMLElement && element.isContentEditable) return "textbox";
    return undefined;
  };

  const roleAllowlist = new Set([
    "button",
    "link",
    "textbox",
    "searchbox",
    "checkbox",
    "radio",
    "switch",
    "combobox",
    "listbox",
    "option",
    "tab",
    "menuitem",
    "slider",
    "spinbutton",
  ]);
  const native = (element: Element) =>
    element instanceof HTMLAnchorElement ||
    element instanceof HTMLButtonElement ||
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLSummaryElement;

  const interactiveTargets: DiscoveryObservationRawTarget[] = [];
  const interactiveElements = new Set<Element>();
  elements.forEach((element, order) => {
    if (!visible(element)) return;
    const inferredRole = role(element);
    const semantic =
      native(element) || (inferredRole !== undefined && roleAllowlist.has(inferredRole));
    const html = element instanceof HTMLElement ? element : undefined;
    const fallback =
      !semantic &&
      html !== undefined &&
      (html.tabIndex >= 0 || html.isContentEditable || getComputedStyle(html).cursor === "pointer");
    if (!semantic && !fallback) return;
    const publicLabel = label(element).trim();
    if (publicLabel.length === 0) return;
    for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
      if (fallback && interactiveElements.has(parent)) return;
    }
    interactiveElements.add(element);
    const inputElement = element instanceof HTMLInputElement ? element : undefined;
    const autocomplete = inputElement?.autocomplete.toLowerCase() ?? "";
    const credential =
      inputElement?.type.toLowerCase() === "password" ||
      /(^|\s)(username|current-password|new-password|one-time-code)(\s|$)/.test(autocomplete);
    const formControl = element.closest("button, input");
    const explicitType = formControl?.getAttribute("type")?.toLowerCase();
    const submitsForm =
      formControl?.closest("form") !== null &&
      ((formControl?.tagName === "BUTTON" &&
        (explicitType === undefined || explicitType === "submit")) ||
        (formControl?.tagName === "INPUT" &&
          (explicitType === "submit" || explicitType === "image")));
    interactiveTargets.push({
      identityKey: identity(element),
      tier: semantic ? "semantic" : "fallback",
      label: publicLabel,
      ...(inferredRole === undefined ? {} : { role: inferredRole }),
      order,
      disabled:
        (element instanceof HTMLButtonElement ||
          element instanceof HTMLInputElement ||
          element instanceof HTMLSelectElement ||
          element instanceof HTMLTextAreaElement) &&
        element.disabled,
      credential,
      ...(submitsForm ? { actionRisk: "potentially-mutating" as const } : {}),
    });
  });

  const visibleStates: DiscoveryObservationRawVisibleState[] = [];
  const seen = new Set<string>();
  elements.forEach((element, order) => {
    if (!visible(element) || interactiveElements.has(element)) return;
    const elementRole = element.getAttribute("role")?.toLowerCase();
    const tag = element.tagName;
    const isStatus = elementRole === "status" || elementRole === "alert";
    const isHeading = /^H[1-6]$/.test(tag) || elementRole === "heading";
    const semanticText = new Set(["P", "LI", "DT", "DD", "CAPTION", "FIGCAPTION"]);
    const directText = Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? "")
      .join(" ")
      .trim();
    const summary =
      isStatus || isHeading || semanticText.has(tag)
        ? (element.textContent ?? "").trim()
        : directText;
    if (summary.length === 0 || seen.has(summary)) return;
    seen.add(summary);
    visibleStates.push({
      identityKey: `visible-${order}`,
      kind: isStatus ? "status" : isHeading ? "heading" : "text",
      summary,
      order,
    });
  });

  return {
    documentToken,
    url: location.href,
    title: document.title,
    viewport: { width: innerWidth, height: innerHeight },
    canGoBack: input.canGoBack,
    visibleStates,
    interactiveTargets,
  };
}
```

- [ ] **Step 4: Export the Playwright factory**

Add to `packages/agent/src/index.ts`:

```ts
export {
  createPlaywrightDiscoveryObservationExtractor,
  type PlaywrightDiscoveryObservationOptions,
} from "./playwrightDiscoveryObservation.js";
```

- [ ] **Step 5: Run the focused Playwright test and typecheck**

```bash
rtk npm --workspace @auto-demo/agent test -- src/playwrightDiscoveryObservation.test.ts
rtk npm --workspace @auto-demo/agent run typecheck
```

Expected: the Playwright test passes without network access and typecheck exits 0. If browser binaries are unavailable, run `rtk npm run setup:browser` only with the required environment approval, then rerun.

- [ ] **Step 6: Commit the concrete adapter**

```bash
rtk git add packages/agent/src/playwrightDiscoveryObservation.ts packages/agent/src/playwrightDiscoveryObservation.test.ts packages/agent/src/index.ts packages/agent/package.json
rtk git commit -m "feat: inspect Playwright discovery pages"
```

### Task 6: Cover Stable IDs, Duplicates, Shadow DOM, Iframes, Credentials, And Screenshots

**Files:**

- Modify: `packages/agent/src/playwrightDiscoveryObservation.ts`
- Modify: `packages/agent/src/playwrightDiscoveryObservation.test.ts`

- [ ] **Step 1: Add failing identity and duplicate behavior tests**

Add one test that:

1. Opens two visible buttons both labeled `Continue`.
2. Observes and stores both IDs and occurrences.
3. Reorders the same attached elements with `insertBefore`.
4. Observes again and asserts the IDs stay attached to the same elements while occurrence values swap.
5. Removes one button and asserts `hasLiveTarget()` returns false.
6. Creates a new equivalent button and asserts it receives a new ID.

Use `data-testid` only inside `page.evaluate()` to drive the fixture; do not expose it in observation expectations.

Expected public assertions:

```ts
expect(firstTargets.map((target) => target.occurrence)).toEqual([1, 2]);
expect(new Set(firstTargets.map((target) => target.id)).size).toBe(2);
expect(secondTargets.map((target) => target.id)).toEqual([
  firstTargets[1]?.id,
  firstTargets[0]?.id,
]);
expect(await extractor.hasLiveTarget(removedId)).toBe(false);
expect(recreatedId).not.toBe(removedId);
```

- [ ] **Step 2: Add failing surface and security behavior tests**

Add separate tests that assert:

- an open-shadow-root button is included;
- a same-label iframe button is excluded;
- a `tabindex="0"` card and a pointer-cursor element are included after semantic controls with `fallback_targets_included` count 2;
- nested pointer-cursor descendants do not duplicate their actionable ancestor;
- a password input is included as safe `textbox` metadata with `credential_target_present`;
- a password value and a secret-like visible string never appear in serialized output;
- a submit control is marked `potentially-mutating`;
- 101 controls and 51 text states produce deterministic truncation diagnostics.

Run:

```bash
rtk npm --workspace @auto-demo/agent test -- src/playwrightDiscoveryObservation.test.ts
```

Expected: any behavior not already satisfied fails with a public observation mismatch, never an assertion about internal selectors or registry calls.

- [ ] **Step 3: Correct the browser collector until all surface tests pass**

Keep these invariants while making the minimal corrections:

```ts
const requiredInvariants = {
  oneAtomicEvaluation: true,
  mainDocumentOnly: true,
  openShadowRoots: true,
  readsFormValues: false,
  exposesSelectors: false,
  continuousMutationObserver: false,
} as const;
```

Do not add an iframe traversal, `input.value` read, selector field, or semantic-fingerprint ID. Adjust only visibility, traversal, label, fallback ancestor, role, and registry behavior needed by the failing public tests.

- [ ] **Step 4: Add the real screenshot artifact test**

Use an in-memory sink and assert the concrete adapter supplies nonempty PNG bytes while the returned observation contains only path, media type, and SHA-256:

```ts
const stored: Uint8Array[] = [];
const extractor = createPlaywrightDiscoveryObservationExtractor(page, {
  artifactSink: {
    async write(input) {
      stored.push(input.bytes);
      return { path: "artifacts/page.png" };
    },
  },
});
const result = await extractor.observe();
expect(stored[0]?.byteLength).toBeGreaterThan(0);
expect(result).toMatchObject({
  ok: true,
  observation: {
    artifacts: [
      {
        kind: "screenshot",
        path: "artifacts/page.png",
        mediaType: "image/png",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    ],
  },
});
expect(JSON.stringify(result)).not.toContain("bytes");
```

- [ ] **Step 5: Add navigation and closed-page behavior tests**

Route both `/first` and `/second`, construct the extractor on `/first`, navigate to `/second`, and assert:

- `/second` reports `canGoBack: true`;
- every `/first` target ID becomes non-live;
- `/second` targets use distinct IDs;
- after `page.close()`, `observe()` returns `browser_unavailable`.

- [ ] **Step 6: Run focused and full agent tests**

```bash
rtk npm --workspace @auto-demo/agent test -- src/discoveryObservation.test.ts src/playwrightDiscoveryObservation.test.ts
rtk npm --workspace @auto-demo/agent test
rtk npm --workspace @auto-demo/agent run typecheck
rtk npm --workspace @auto-demo/agent run build
```

Expected: focused tests, the complete agent suite, typecheck, and build all pass.

- [ ] **Step 7: Commit behavioral completion**

```bash
rtk git add packages/agent/src/playwrightDiscoveryObservation.ts packages/agent/src/playwrightDiscoveryObservation.test.ts
rtk git commit -m "test: cover discovery observation behavior"
```

### Task 7: Document And Export The Completed WES-184 Surface

**Files:**

- Modify: `packages/agent/README.md`
- Modify: `README.md`
- Modify: `packages/agent/src/wrapper-docs.test.ts`
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Add a failing documentation contract test**

Extend `packages/agent/src/wrapper-docs.test.ts` to require these public names and safety statements:

```ts
for (const expected of [
  "createPlaywrightDiscoveryObservationExtractor",
  "recordDiscoveryObservation",
  "hasLiveTarget",
  "optional artifact sink",
  "never returns form values",
  "WES-185 owns browser actions",
]) {
  expect(agentReadme).toContain(expected);
}
```

Run:

```bash
rtk npm --workspace @auto-demo/agent test -- src/wrapper-docs.test.ts
```

Expected: FAIL because the new observation API is not documented.

- [ ] **Step 2: Document the package API with a complete example**

Add `## Structured Browser Observation Snapshots` after the discovery-session contract in `packages/agent/README.md`. Include an example that:

```ts
const extractor = createPlaywrightDiscoveryObservationExtractor(page, {
  artifactSink: {
    async write({ id, bytes }) {
      const path = `artifacts/${id}.png`;
      await writeFile(join(sessionDirectory, path), bytes);
      return { path };
    },
  },
});

const extracted = await extractor.observe();
if (!extracted.ok) throw new Error(extracted.errors[0]?.code ?? "observation_failed");
const recorded = recordDiscoveryObservation(session, extracted.observation);
```

State explicitly that the caller owns the page and artifact storage, screenshots are optional, target IDs live only while their DOM element/document remains live, diagnostics are runtime-only, no form values/selectors/DOM are returned, and WES-185 owns actions.

- [ ] **Step 3: Update the root capability summary**

In `README.md`, replace the sentence that says WES-184 still owns future observation extraction with a concise statement that `@auto-demo/agent` now exposes stateful Playwright observation snapshots while WES-185 through WES-187 still own browser control, safety policy, and compilation.

- [ ] **Step 4: Update the project map**

Add:

- the WES-184 design spec and implementation plan paths under Local Context;
- a dated note recording the WES-183 dependency reconciliation;
- a dated WES-184 implementation note listing the public factories and behavior scope;
- the current Linear state;
- no claim that WES-184 is Done until Task 8 passes.

- [ ] **Step 5: Run docs tests and formatting**

```bash
rtk npm --workspace @auto-demo/agent test -- src/wrapper-docs.test.ts
rtk proxy npx prettier --check packages/agent/README.md README.md packages/agent/src/wrapper-docs.test.ts docs/linear/auto-demo-project-structure.md
```

Expected: docs tests pass and Prettier exits 0.

- [ ] **Step 6: Commit documentation**

```bash
rtk git add packages/agent/README.md README.md packages/agent/src/wrapper-docs.test.ts docs/linear/auto-demo-project-structure.md
rtk git commit -m "docs: explain discovery observation snapshots"
```

### Task 8: Repository Verification And Linear Completion Gate

**Files:**

- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Run focused WES-184 verification**

```bash
rtk npm --workspace @auto-demo/agent test -- src/discoveryObservation.test.ts src/playwrightDiscoveryObservation.test.ts
rtk npm --workspace @auto-demo/agent run typecheck
rtk npm --workspace @auto-demo/agent run build
```

Expected: all focused tests pass; typecheck and build exit 0.

- [ ] **Step 2: Run the full agent package suite**

```bash
rtk npm --workspace @auto-demo/agent test
```

Expected: every agent test file passes with zero failed tests.

- [ ] **Step 3: Run repository verification by phase**

```bash
rtk npm run build
rtk npm run typecheck
rtk npm run lint
rtk npm test
rtk proxy npx prettier --check packages/agent/src/discoveryObservation.ts packages/agent/src/discoveryObservationTransform.ts packages/agent/src/discoveryObservation.test.ts packages/agent/src/playwrightDiscoveryObservation.ts packages/agent/src/playwrightDiscoveryObservation.test.ts packages/agent/src/index.ts packages/agent/src/wrapper-docs.test.ts packages/agent/README.md README.md docs/linear/auto-demo-project-structure.md
```

Expected: build, typecheck, lint, all workspace tests, and WES-184 formatting pass.

- [ ] **Step 4: Run full repository validation**

```bash
rtk npm run validate
```

Expected: PASS. If the preserved unrelated `docs/superpowers/plans/2026-07-10-check-codex-usage-skill.md` formatting issue still fails, record that exact exception and do not claim a clean full-validation pass. Do not edit that unrelated user file without authorization.

- [ ] **Step 5: Review the complete diff against the approved spec**

```bash
rtk git status --short
rtk git diff --stat
rtk git diff --check
```

Confirm all of these before continuing:

```text
[ ] no browser launch or close ownership
[ ] no click/type/navigation action methods
[ ] no iframe traversal
[ ] no form value reads
[ ] no selector or raw DOM output
[ ] no continuous mutation observer
[ ] one retry for main-document replacement
[ ] optional screenshot sink only
[ ] WES-183-compatible successful observations
[ ] behavior-focused dynamic and duplicate tests
```

- [ ] **Step 6: Invoke `superpowers:requesting-code-review`**

Request review of the complete WES-184 diff against the approved spec. Address Critical and Important findings through `superpowers:receiving-code-review`, rerun the affected tests, and record the exact review result.

- [ ] **Step 7: Run `linear-sync-gate` in `completion-gate` mode**

Provide:

```text
active issue: WES-184
tracker: WES-182
direct dependent: WES-185
nearby parallel issue: WES-186
next-task rule: WES-185 after WES-184 unless a started issue or dependency correction changes the pointer
evidence: changed files, commits, test counts, build/typecheck/lint/test/format results, full validation result, review result
```

Expected: the gate confirms WES-184 acceptance criteria and identifies exact clear Linear/project-map writes.

- [ ] **Step 8: Apply only clear completion writes**

If the completion gate passes:

Copy the exact verified completion note from the project map into the WES-184 Linear comment with `rtk linear issue comment add WES-184 -b`, then run:

```bash
rtk linear issue update WES-184 --state Done
rtk linear issue comment add WES-185 -b "WES-184 is complete. WES-185 can consume the session-scoped observation extractor and its private target registry boundary for controlled rehearsal actions without reconstructing targets from labels or selectors."
```

The copied completion note must contain the actual non-secret command results and review result from Steps 1–6; do not use a template.

Update the project map with the same evidence and next-task pointer. Keep WES-182 Backlog until final milestone acceptance.

- [ ] **Step 9: Commit the completion evidence update**

```bash
rtk git add docs/linear/auto-demo-project-structure.md
rtk git commit -m "docs: sync WES-184 completion evidence"
```

- [ ] **Step 10: Run final verification on the committed tree**

```bash
rtk git status --short
rtk git log -5 --oneline
rtk npm --workspace @auto-demo/agent test
```

Expected: only explicitly preserved unrelated files remain dirty, recent history contains the WES-184 commits, and the full agent suite passes with zero failures.
