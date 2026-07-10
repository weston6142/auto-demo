# WES-178 Validate Mode For Rehearsing User Demo Scripts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build non-interactive validate mode that rehearses a walkthrough plan in a browser and annotates it with structured checks and blockers.

**Architecture:** Keep validation in `@auto-demo/agent` next to walkthrough plan intake, but put the validation core in focused files instead of growing `index.ts`. The core validator depends on a small fakeable browser-runner interface; a Playwright-backed runner provides the real browser behavior. The CLI adds `autodemo agent validate` for both plan-file and URL/script inputs.

**Tech Stack:** TypeScript, Vitest, npm workspaces, Playwright, existing Auto Demo CLI and agent packages.

---

## File Structure

- Create `packages/agent/src/walkthroughValidation.ts`: validation types, fakeable browser-runner interface, plan-shape guard, validation algorithm, stable error helpers.
- Create `packages/agent/src/walkthroughValidation.test.ts`: behavior-first API tests with fake browser runners.
- Create `packages/agent/src/playwrightValidationRunner.ts`: production Playwright runner for visible-text, role/name, field, click, type, wait, and navigation checks.
- Modify `packages/agent/src/index.ts`: export validation API/types and default Playwright runner.
- Modify `packages/agent/package.json`: add `playwright` dependency and include `src/walkthroughValidation.test.ts` in `npm test`.
- Modify `packages/agent/README.md`: document validate mode, output shape, errors, and WES-177 handoff.
- Modify `packages/agent/src/wrapper-docs.test.ts`: assert docs mention validation error codes and WES-177 handoff.
- Modify `packages/cli/src/index.ts`: parse and run `agent validate --plan <file> --json` and `agent validate --url <url> --script <script> --json`.
- Modify `packages/cli/src/index.test.ts`: CLI tests for plan-file validation, URL/script validation, missing JSON, invalid plan JSON, missing plan file, and unknown arguments.
- Modify `packages/cli/README.md`: document `agent validate`.
- Modify `docs/linear/auto-demo-project-structure.md`: add WES-178 implementation-plan link and, after implementation, summary/evidence notes.

### Task 1: Agent Validation API And Data Model

**Files:**

- Create: `packages/agent/src/walkthroughValidation.ts`
- Create: `packages/agent/src/walkthroughValidation.test.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/package.json`

- [ ] **Step 1: Write failing API tests**

Create `packages/agent/src/walkthroughValidation.test.ts` with these tests:

```ts
import { describe, expect, it } from "vitest";
import {
  createWalkthroughPlan,
  validateWalkthroughPlan,
  type WalkthroughValidationBrowserRunner,
  type WalkthroughValidationMatch,
} from "./index.js";

function plan(script: string) {
  const result = createWalkthroughPlan({
    targetUrl: "https://example.com/signup",
    script,
    mode: "validate-first",
  });
  if (!result.ok) {
    throw new Error("test plan should be valid");
  }
  return result.plan;
}

function runner(
  matchesByStep: Record<string, WalkthroughValidationMatch[]>,
): WalkthroughValidationBrowserRunner {
  return {
    async open(url) {
      expect(url).toBe("https://example.com/signup");
    },
    async findMatches(step) {
      return matchesByStep[step.id] ?? [{ id: `${step.id}-match`, label: step.public.summary }];
    },
    async click(match) {
      expect(match.id).toContain("match");
    },
    async type(match) {
      expect(match.id).toContain("match");
    },
    async waitForIdle() {},
    async close() {},
  };
}

describe("validateWalkthroughPlan", () => {
  it("marks a straightforward resolved plan as ready", async () => {
    const result = await validateWalkthroughPlan(
      plan("Go to https://example.com/signup. Click Get started. Verify pricing appears."),
      { now: () => new Date("2026-07-09T12:00:00.000Z") },
      { browser: runner({}) },
    );

    expect(result).toMatchObject({
      ok: true,
      plan: {
        validation: {
          status: "ready",
          validatedAt: "2026-07-09T12:00:00.000Z",
          mode: "dry-run",
          blockers: [],
        },
      },
    });
    expect(result.ok && result.plan.validation.checks.map((check) => check.status)).toEqual([
      "passed",
      "passed",
      "passed",
    ]);
  });

  it("returns all safely discoverable blockers and skips unsafe dependent actions", async () => {
    const result = await validateWalkthroughPlan(
      plan("Click Get started. Type hunter2 into the password field. Verify dashboard appears."),
      { now: () => new Date("2026-07-09T12:00:00.000Z") },
      {
        browser: runner({
          "step-1": [
            { id: "candidate-1", label: "Header: Get started", role: "button" },
            { id: "candidate-2", label: "Hero: Get started", role: "button" },
          ],
          "step-3": [],
        }),
      },
    );

    expect(result.ok && result.plan.validation.status).toBe("blocked");
    expect(result.ok && result.plan.validation.blockers).toEqual([
      {
        id: "blocker-1",
        stepId: "step-1",
        reason: "multiple_matching_elements",
        question: "Which 'Click Get started.' target should be used?",
        candidates: [
          { id: "candidate-1", label: "Header: Get started", role: "button" },
          { id: "candidate-2", label: "Hero: Get started", role: "button" },
        ],
      },
      {
        id: "blocker-3",
        stepId: "step-3",
        reason: "missing_element",
        question: "What visible page element should satisfy: Verify dashboard appears.?",
      },
    ]);
    expect(result.ok && result.plan.validation.checks.map((check) => check.status)).toEqual([
      "blocked",
      "skipped",
      "blocked",
    ]);
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });

  it("preserves unresolved plan questions as validation blockers", async () => {
    const result = await validateWalkthroughPlan(
      plan("Open the dashboard. Pick the best option."),
      { now: () => new Date("2026-07-09T12:00:00.000Z") },
      { browser: runner({}) },
    );

    expect(result.ok && result.plan.validation.status).toBe("blocked");
    expect(result.ok && result.plan.validation.blockers).toContainEqual({
      id: "blocker-2",
      stepId: "step-2",
      reason: "unresolved_plan_question",
      question: "Clarify how to perform: Pick the best option.",
    });
  });

  it("returns a structured setup failure when the browser cannot open", async () => {
    const result = await validateWalkthroughPlan(
      plan("Click Get started."),
      {},
      {
        browser: {
          async open() {
            throw new Error("browser unavailable with token=secret");
          },
          async findMatches() {
            return [];
          },
          async click() {},
          async type() {},
          async waitForIdle() {},
          async close() {},
        },
      },
    );

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "browser_setup_failed",
          message: "Walkthrough validation browser setup failed.",
        },
      ],
    });
  });
});
```

- [ ] **Step 2: Run API tests to verify RED**

Run:

```bash
rtk npm --workspace @auto-demo/agent test -- src/walkthroughValidation.test.ts
```

Expected: FAIL because `packages/agent/src/walkthroughValidation.test.ts` does not compile and `validateWalkthroughPlan` is not exported.

- [ ] **Step 3: Implement validation core**

Create `packages/agent/src/walkthroughValidation.ts`:

```ts
import type { WalkthroughPlan, WalkthroughPlanStep, WalkthroughPlanStepAction } from "./index.js";

export type WalkthroughPlanValidationStatus = "ready" | "blocked";
export type WalkthroughPlanValidationCheckStatus = "passed" | "blocked" | "skipped";
export type WalkthroughPlanValidationReason =
  | "unresolved_plan_question"
  | "missing_element"
  | "multiple_matching_elements"
  | "unexpected_navigation"
  | "navigation_failed"
  | "auth_wall_detected"
  | "timing_failure"
  | "unsafe_dependent_step"
  | "unsupported_step_action";

export type WalkthroughValidationMatch = {
  id: string;
  label: string;
  role?: string;
};

export type WalkthroughPlanValidationCheck = {
  id: string;
  stepId: string;
  action: WalkthroughPlanStepAction;
  status: WalkthroughPlanValidationCheckStatus;
  reason?: WalkthroughPlanValidationReason;
  summary: string;
};

export type WalkthroughPlanValidationBlocker = {
  id: string;
  stepId: string;
  reason: WalkthroughPlanValidationReason;
  question: string;
  candidates?: WalkthroughValidationMatch[];
};

export type WalkthroughPlanValidation = {
  status: WalkthroughPlanValidationStatus;
  validatedAt: string;
  mode: "dry-run";
  checks: WalkthroughPlanValidationCheck[];
  blockers: WalkthroughPlanValidationBlocker[];
};

export type ValidatedWalkthroughPlan = WalkthroughPlan & {
  validation: WalkthroughPlanValidation;
};

export type WalkthroughValidationErrorCode =
  "invalid_plan" | "browser_setup_failed" | "navigation_failed";

export type WalkthroughValidationError = {
  code: WalkthroughValidationErrorCode;
  message: string;
};

export type WalkthroughValidationResult =
  | { ok: true; plan: ValidatedWalkthroughPlan }
  | { ok: false; errors: WalkthroughValidationError[] };

export type WalkthroughValidationOptions = {
  now?: () => Date;
};

export type WalkthroughValidationBrowserRunner = {
  open(url: string): Promise<void>;
  findMatches(step: WalkthroughPlanStep): Promise<WalkthroughValidationMatch[]>;
  click(match: WalkthroughValidationMatch): Promise<void>;
  type(match: WalkthroughValidationMatch, options: { redactedValue: true }): Promise<void>;
  waitForIdle(): Promise<void>;
  close(): Promise<void>;
};

export type WalkthroughValidationDependencies = {
  browser: WalkthroughValidationBrowserRunner;
};

export function isWalkthroughPlan(value: unknown): value is WalkthroughPlan {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<WalkthroughPlan>;
  return (
    typeof candidate.id === "string" &&
    candidate.target?.kind === "browser" &&
    typeof candidate.target.url === "string" &&
    Array.isArray(candidate.steps) &&
    Array.isArray(candidate.questions)
  );
}

export async function validateWalkthroughPlan(
  plan: WalkthroughPlan,
  options: WalkthroughValidationOptions = {},
  dependencies: WalkthroughValidationDependencies,
): Promise<WalkthroughValidationResult> {
  if (!isWalkthroughPlan(plan)) {
    return failure("invalid_plan", "Walkthrough validation requires a valid walkthrough plan.");
  }

  const now = options.now ?? (() => new Date());
  const checks: WalkthroughPlanValidationCheck[] = [];
  const blockers: WalkthroughPlanValidationBlocker[] = [];
  let unsafeAfterStateChangeBlocker = false;

  try {
    await dependencies.browser.open(plan.target.url);
  } catch {
    return failure("browser_setup_failed", "Walkthrough validation browser setup failed.");
  }

  try {
    for (const step of plan.steps) {
      const blockerId = `blocker-${step.order}`;
      if (step.action === "question" || step.resolution === "unresolved") {
        const question =
          plan.questions.find((candidate) => candidate.stepId === step.id)?.prompt ??
          step.public.summary;
        blockers.push({
          id: blockerId,
          stepId: step.id,
          reason: "unresolved_plan_question",
          question,
        });
        checks.push(blockedCheck(step, "unresolved_plan_question", question));
        continue;
      }

      if (unsafeAfterStateChangeBlocker && isStateChanging(step)) {
        checks.push({
          id: `check-${step.order}`,
          stepId: step.id,
          action: step.action,
          status: "skipped",
          reason: "unsafe_dependent_step",
          summary: `Skipped because an earlier state-changing step is blocked: ${safeSummary(step)}.`,
        });
        continue;
      }

      const matches = await dependencies.browser.findMatches(step);
      if (matches.length === 0) {
        const question = missingQuestion(step);
        blockers.push({
          id: blockerId,
          stepId: step.id,
          reason: "missing_element",
          question,
        });
        checks.push(blockedCheck(step, "missing_element", question));
        if (isStateChanging(step)) {
          unsafeAfterStateChangeBlocker = true;
        }
        continue;
      }

      if (matches.length > 1) {
        const question = `Which '${safeSummary(step)}' target should be used?`;
        blockers.push({
          id: blockerId,
          stepId: step.id,
          reason: "multiple_matching_elements",
          question,
          candidates: matches.map(sanitizeMatch),
        });
        checks.push(blockedCheck(step, "multiple_matching_elements", question));
        if (isStateChanging(step)) {
          unsafeAfterStateChangeBlocker = true;
        }
        continue;
      }

      try {
        await performStep(step, matches[0], dependencies.browser);
        checks.push({
          id: `check-${step.order}`,
          stepId: step.id,
          action: step.action,
          status: "passed",
          summary: `Validated: ${safeSummary(step)}.`,
        });
      } catch {
        const reason: WalkthroughPlanValidationReason =
          step.action === "navigate" ? "navigation_failed" : "timing_failure";
        const question = `How should validation recover from: ${safeSummary(step)}?`;
        blockers.push({ id: blockerId, stepId: step.id, reason, question });
        checks.push(blockedCheck(step, reason, question));
        if (isStateChanging(step)) {
          unsafeAfterStateChangeBlocker = true;
        }
      }
    }
  } finally {
    await dependencies.browser.close().catch(() => undefined);
  }

  return {
    ok: true,
    plan: {
      ...plan,
      validation: {
        status: blockers.length === 0 ? "ready" : "blocked",
        validatedAt: now().toISOString(),
        mode: "dry-run",
        checks,
        blockers,
      },
    },
  };
}

function failure(
  code: WalkthroughValidationErrorCode,
  message: string,
): WalkthroughValidationResult {
  return { ok: false, errors: [{ code, message }] };
}

function isStateChanging(step: WalkthroughPlanStep): boolean {
  return step.action === "click" || step.action === "type" || step.action === "navigate";
}

function safeSummary(step: WalkthroughPlanStep): string {
  return step.public.summary.replace(/\s+/g, " ").trim();
}

function missingQuestion(step: WalkthroughPlanStep): string {
  return `What visible page element should satisfy: ${safeSummary(step)}?`;
}

function blockedCheck(
  step: WalkthroughPlanStep,
  reason: WalkthroughPlanValidationReason,
  summary: string,
): WalkthroughPlanValidationCheck {
  return {
    id: `check-${step.order}`,
    stepId: step.id,
    action: step.action,
    status: "blocked",
    reason,
    summary,
  };
}

function sanitizeMatch(match: WalkthroughValidationMatch): WalkthroughValidationMatch {
  return {
    id: match.id,
    label: match.label.replace(/\s+/g, " ").trim().slice(0, 120),
    ...(match.role === undefined ? {} : { role: match.role }),
  };
}

async function performStep(
  step: WalkthroughPlanStep,
  match: WalkthroughValidationMatch,
  browser: WalkthroughValidationBrowserRunner,
): Promise<void> {
  if (step.action === "click") {
    await browser.click(match);
    await browser.waitForIdle();
    return;
  }
  if (step.action === "type") {
    await browser.type(match, { redactedValue: true });
    await browser.waitForIdle();
    return;
  }
  if (step.action === "navigate" || step.action === "wait") {
    await browser.waitForIdle();
    return;
  }
  if (step.action === "assert") {
    return;
  }
  throw new Error("Unsupported walkthrough validation action.");
}
```

- [ ] **Step 4: Export validation API from agent index**

Add this export block near the top-level exports in `packages/agent/src/index.ts`:

```ts
export {
  isWalkthroughPlan,
  validateWalkthroughPlan,
  type ValidatedWalkthroughPlan,
  type WalkthroughPlanValidation,
  type WalkthroughPlanValidationBlocker,
  type WalkthroughPlanValidationCheck,
  type WalkthroughPlanValidationReason,
  type WalkthroughValidationBrowserRunner,
  type WalkthroughValidationDependencies,
  type WalkthroughValidationError,
  type WalkthroughValidationErrorCode,
  type WalkthroughValidationMatch,
  type WalkthroughValidationOptions,
  type WalkthroughValidationResult,
} from "./walkthroughValidation.js";
```

- [ ] **Step 5: Update agent test script**

Modify `packages/agent/package.json` test script to include the new test:

```json
"test": "vitest run src/index.test.ts src/wrapper-docs.test.ts src/walkthroughValidation.test.ts"
```

- [ ] **Step 6: Run API tests to verify GREEN**

Run:

```bash
rtk npm --workspace @auto-demo/agent test -- src/walkthroughValidation.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
rtk git status --short
rtk git add packages/agent/src/walkthroughValidation.ts packages/agent/src/walkthroughValidation.test.ts packages/agent/src/index.ts packages/agent/package.json
rtk git commit -m "feat(agent): add walkthrough validation core"
```

Expected: commit succeeds with only Task 1 files staged.

### Task 2: Playwright Validation Runner

**Files:**

- Create: `packages/agent/src/playwrightValidationRunner.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/package.json`

- [ ] **Step 1: Add Playwright dependency to agent package**

Modify `packages/agent/package.json` dependencies:

```json
"dependencies": {
  "@auto-demo/polish": "0.0.0",
  "@auto-demo/project": "0.0.0",
  "playwright": "^1.61.1"
}
```

- [ ] **Step 2: Implement production runner**

Create `packages/agent/src/playwrightValidationRunner.ts`:

```ts
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import type {
  WalkthroughPlanStep,
  WalkthroughValidationBrowserRunner,
  WalkthroughValidationMatch,
} from "./index.js";

type Candidate = WalkthroughValidationMatch & {
  locator: Locator;
};

export type PlaywrightValidationRunnerOptions = {
  viewport?: { width: number; height: number };
  timeoutMs?: number;
};

export function createPlaywrightValidationRunner(
  options: PlaywrightValidationRunnerOptions = {},
): WalkthroughValidationBrowserRunner {
  return new PlaywrightValidationRunner(options);
}

class PlaywrightValidationRunner implements WalkthroughValidationBrowserRunner {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private candidates = new Map<string, Candidate>();

  constructor(private readonly options: PlaywrightValidationRunnerOptions) {}

  async open(url: string): Promise<void> {
    this.browser = await chromium.launch();
    this.context = await this.browser.newContext({
      viewport: this.options.viewport ?? { width: 1280, height: 720 },
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.options.timeoutMs ?? 3000);
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
  }

  async findMatches(step: WalkthroughPlanStep): Promise<WalkthroughValidationMatch[]> {
    const page = this.requirePage();
    this.candidates.clear();
    const targetText = targetTextForStep(step);
    const candidates: Candidate[] = [];

    if (targetText.length > 0) {
      const textLocator = page.getByText(targetText, { exact: true });
      candidates.push(...(await visibleCandidates(textLocator, "text", targetText)));

      for (const role of ["button", "link", "textbox"] as const) {
        const roleLocator = page.getByRole(role, { name: targetText, exact: true });
        candidates.push(...(await visibleCandidates(roleLocator, role, targetText)));
      }

      if (step.action === "type") {
        candidates.push(
          ...(await visibleCandidates(page.getByLabel(targetText), "textbox", targetText)),
        );
        candidates.push(
          ...(await visibleCandidates(page.getByPlaceholder(targetText), "textbox", targetText)),
        );
      }
    }

    const unique = dedupeCandidates(candidates);
    for (const candidate of unique) {
      this.candidates.set(candidate.id, candidate);
    }
    return unique.map(({ locator: _locator, ...match }) => match);
  }

  async click(match: WalkthroughValidationMatch): Promise<void> {
    await this.requireCandidate(match).locator.click();
  }

  async type(match: WalkthroughValidationMatch): Promise<void> {
    await this.requireCandidate(match).locator.fill("redacted-validation-value");
  }

  async waitForIdle(): Promise<void> {
    await this.requirePage().waitForLoadState("domcontentloaded", {
      timeout: this.options.timeoutMs ?? 3000,
    });
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.context = undefined;
    this.browser = undefined;
    this.page = undefined;
    this.candidates.clear();
  }

  private requirePage(): Page {
    if (this.page === undefined) {
      throw new Error("Validation browser is not open.");
    }
    return this.page;
  }

  private requireCandidate(match: WalkthroughValidationMatch): Candidate {
    const candidate = this.candidates.get(match.id);
    if (candidate === undefined) {
      throw new Error("Validation candidate is no longer available.");
    }
    return candidate;
  }
}

async function visibleCandidates(
  locator: Locator,
  role: string,
  label: string,
): Promise<Candidate[]> {
  const count = await locator.count().catch(() => 0);
  const candidates: Candidate[] = [];
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (await item.isVisible().catch(() => false)) {
      candidates.push({
        id: `${role}-${index + 1}`,
        label,
        role,
        locator: item,
      });
    }
  }
  return candidates;
}

function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const unique: Candidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.role ?? ""}:${candidate.label}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(candidate);
    }
  }
  return unique;
}

function targetTextForStep(step: WalkthroughPlanStep): string {
  return step.public.summary
    .replace(/^Click\s+/i, "")
    .replace(/^Verify\s+/i, "")
    .replace(/^Type\s+\[redacted\]\s+into\s+/i, "")
    .replace(/\.$/, "")
    .trim();
}
```

- [ ] **Step 3: Export production runner**

Add this export block to `packages/agent/src/index.ts`:

```ts
export {
  createPlaywrightValidationRunner,
  type PlaywrightValidationRunnerOptions,
} from "./playwrightValidationRunner.js";
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
rtk npm --workspace @auto-demo/agent run typecheck
```

Expected: PASS. If TypeScript reports that `Locator` overloads require looser call shapes, adjust only `playwrightValidationRunner.ts` while preserving the public runner interface from Task 1.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
rtk git status --short
rtk git add packages/agent/src/playwrightValidationRunner.ts packages/agent/src/index.ts packages/agent/package.json package-lock.json
rtk git commit -m "feat(agent): add playwright walkthrough validation runner"
```

Expected: commit succeeds with only Task 2 files staged. Include `package-lock.json` only if npm updated it while adding the dependency.

### Task 3: CLI Validate Command

**Files:**

- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/index.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Add these tests inside `describe("runCliAsync agent", () => { ... })` in `packages/cli/src/index.test.ts`:

```ts
it("validates a walkthrough plan file as JSON", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "auto-demo-agent-validate-"));
  const planPath = join(tempDir, "plan.json");
  await writeFile(
    planPath,
    JSON.stringify(
      createWalkthroughPlan({
        targetUrl: "https://example.com/signup",
        script: "Click Get started.",
        mode: "validate-first",
      }),
      null,
      2,
    ),
  );

  const result = await runCliAsync(["agent", "validate", "--plan", planPath, "--json"], {
    ...testDependencies(),
    createValidationRunner: () => ({
      async open() {},
      async findMatches() {
        return [{ id: "match-1", label: "Get started", role: "button" }];
      },
      async click() {},
      async type() {},
      async waitForIdle() {},
      async close() {},
    }),
  });
  const output = JSON.parse(result.stdout) as {
    ok: boolean;
    plan: { validation: { status: string } };
  };

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(output.ok).toBe(true);
  expect(output.plan.validation.status).toBe("ready");
});

it("validates url and script input as JSON", async () => {
  const result = await runCliAsync(
    [
      "agent",
      "validate",
      "--url",
      "https://example.com/signup",
      "--script",
      "Click Get started.",
      "--json",
    ],
    {
      ...testDependencies(),
      createValidationRunner: () => ({
        async open() {},
        async findMatches() {
          return [
            { id: "candidate-1", label: "Header: Get started", role: "button" },
            { id: "candidate-2", label: "Hero: Get started", role: "button" },
          ];
        },
        async click() {},
        async type() {},
        async waitForIdle() {},
        async close() {},
      }),
    },
  );
  const output = JSON.parse(result.stdout) as {
    ok: boolean;
    plan: { validation: { status: string; blockers: Array<{ reason: string }> } };
  };

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(output.ok).toBe(true);
  expect(output.plan.validation.status).toBe("blocked");
  expect(output.plan.validation.blockers).toEqual([
    {
      reason: "multiple_matching_elements",
      id: expect.any(String),
      stepId: "step-1",
      question: expect.any(String),
      candidates: expect.any(Array),
    },
  ]);
});

it("requires JSON output for walkthrough validation", async () => {
  const result = await runCliAsync([
    "agent",
    "validate",
    "--url",
    "https://example.com",
    "--script",
    "Click",
  ]);

  expect(result).toEqual({
    exitCode: 1,
    stdout: "",
    stderr: "autodemo agent validate currently requires --json output.\n",
  });
});

it("returns structured errors for invalid validate input", async () => {
  const result = await runCliAsync([
    "agent",
    "validate",
    "--plan",
    "missing.json",
    "--wat",
    "--json",
  ]);
  const output = JSON.parse(result.stdout) as { ok: boolean; errors: Array<{ code: string }> };

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe("");
  expect(output.ok).toBe(false);
  expect(output.errors.map((error) => error.code)).toEqual([
    "missing_plan_file",
    "unknown_agent_argument",
  ]);
});
```

If `testDependencies()` does not exist in `packages/cli/src/index.test.ts`, add this helper near the top of the file:

```ts
function testDependencies(): CliDependencies {
  return {
    browserCaptureAdapter: {
      kind: "browser",
      async start() {
        throw new Error("capture should not start during agent validate tests");
      },
    },
    now: () => new Date("2026-07-09T12:00:00.000Z"),
    async runChildCommand() {
      return { exitCode: 0 };
    },
  };
}
```

- [ ] **Step 2: Run CLI tests to verify RED**

Run:

```bash
rtk npm --workspace @auto-demo/cli test -- src/index.test.ts
```

Expected: FAIL because `CliDependencies` has no validation runner dependency and `agent validate` is unsupported.

- [ ] **Step 3: Extend CLI dependencies and imports**

In `packages/cli/src/index.ts`, extend the agent import:

```ts
import {
  createPlaywrightValidationRunner,
  createWalkthroughPlan,
  isWalkthroughPlan,
  runAgentWorkflow,
  validateWalkthroughPlan,
  type AgentWorkflowError,
  type AgentWorkflowSaveTarget,
  type WalkthroughPlanError,
  type WalkthroughPlanMode,
  type WalkthroughValidationBrowserRunner,
  type WalkthroughValidationError,
} from "@auto-demo/agent";
```

Add `readFile` to the fs imports:

```ts
import { readFile } from "node:fs/promises";
```

Add a dependency hook to `CliDependencies`:

```ts
createValidationRunner?: () => WalkthroughValidationBrowserRunner;
```

- [ ] **Step 4: Add parse/result types**

In `packages/cli/src/index.ts`, add:

```ts
type AgentValidateErrorCode =
  | WalkthroughPlanError["code"]
  | WalkthroughValidationError["code"]
  | "missing_plan_file"
  | "invalid_plan_json"
  | "invalid_plan"
  | "missing_validate_input";

type AgentValidateError = {
  code: AgentValidateErrorCode;
  message: string;
};

type ParsedAgentValidateCommand =
  | {
      ok: true;
      json: true;
      planPath?: string;
      targetUrl?: string;
      script?: string;
      mode: WalkthroughPlanMode;
    }
  | {
      ok: false;
      json: boolean;
      stderr?: string;
      errors: AgentValidateError[];
    };
```

- [ ] **Step 5: Route `agent validate`**

In the async agent command handler, add a branch before the existing `agent plan` or unsupported-command branch:

```ts
if (subcommand === "validate") {
  const parsed = parseAgentValidateCommand(rest);
  if (!parsed.ok) {
    return parsed.json
      ? jsonFailure(parsed.errors)
      : {
          exitCode: 1,
          stdout: "",
          stderr: `${parsed.stderr ?? "Invalid agent validate command."}\n`,
        };
  }

  const planResult =
    parsed.planPath === undefined
      ? createWalkthroughPlan({
          targetUrl: parsed.targetUrl ?? "",
          script: parsed.script ?? "",
          mode: parsed.mode,
        })
      : await readPlanFile(parsed.planPath);

  if (!planResult.ok) {
    return jsonFailure(planResult.errors);
  }

  const validation = await validateWalkthroughPlan(
    planResult.plan,
    { now: dependencies.now },
    {
      browser: (dependencies.createValidationRunner ?? createPlaywrightValidationRunner)(),
    },
  );

  if (!validation.ok) {
    return jsonFailure(validation.errors);
  }

  return { exitCode: 0, stdout: `${JSON.stringify(validation, null, 2)}\n`, stderr: "" };
}
```

If the local function names differ, keep this behavior exactly: parse first, create or read a plan, run validation with injected dependency, print pretty JSON.

- [ ] **Step 6: Add parser and plan file helpers**

Add these helpers near the existing agent parser helpers:

```ts
function parseAgentValidateCommand(args: string[]): ParsedAgentValidateCommand {
  let json = false;
  let planPath: string | undefined;
  let targetUrl: string | undefined;
  let script: string | undefined;
  let mode: WalkthroughPlanMode = "validate-first";
  const errors: AgentValidateError[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--plan") {
      planPath = parseValidateOptionValue(args, index, arg, errors);
      if (planPath !== undefined) index += 1;
      continue;
    }
    if (arg === "--url") {
      targetUrl = parseValidateOptionValue(args, index, arg, errors);
      if (targetUrl !== undefined) index += 1;
      continue;
    }
    if (arg === "--script") {
      script = parseValidateOptionValue(args, index, arg, errors);
      if (script !== undefined) index += 1;
      continue;
    }
    if (arg === "--mode") {
      const value = parseValidateOptionValue(args, index, arg, errors);
      if (value === "validate-first" || value === "best-guess") {
        mode = value;
      } else if (value !== undefined) {
        errors.push({
          code: "unsupported_plan_mode",
          message: "Walkthrough validation mode must be validate-first or best-guess.",
        });
      }
      if (value !== undefined) index += 1;
      continue;
    }
    errors.push({
      code: "unknown_agent_argument",
      message: `Unknown agent validate argument: ${arg}`,
    });
  }

  if (!json) {
    return {
      ok: false,
      json: false,
      stderr: "autodemo agent validate currently requires --json output.",
      errors,
    };
  }

  if (planPath === undefined && (targetUrl === undefined || script === undefined)) {
    errors.push({
      code: "missing_validate_input",
      message:
        "autodemo agent validate requires --plan <file> or --url <target-url> --script <script-text>.",
    });
  }

  if (errors.length > 0) {
    return { ok: false, json, errors };
  }

  return { ok: true, json: true, planPath, targetUrl, script, mode };
}

function parseValidateOptionValue(
  args: string[],
  index: number,
  option: string,
  errors: AgentValidateError[],
): string | undefined {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    errors.push({
      code: "unknown_agent_argument",
      message: `Missing value for agent validate argument: ${option}`,
    });
    return undefined;
  }
  return value;
}

async function readPlanFile(
  path: string,
): Promise<
  | { ok: true; plan: import("@auto-demo/agent").WalkthroughPlan }
  | { ok: false; errors: AgentValidateError[] }
> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return {
      ok: false,
      errors: [
        { code: "missing_plan_file", message: "Walkthrough validation plan file was not found." },
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      errors: [
        {
          code: "invalid_plan_json",
          message: "Walkthrough validation plan file must contain JSON.",
        },
      ],
    };
  }

  const plan =
    typeof parsed === "object" && parsed !== null && "plan" in parsed
      ? (parsed as { plan?: unknown }).plan
      : parsed;
  if (!isWalkthroughPlan(plan)) {
    return {
      ok: false,
      errors: [
        {
          code: "invalid_plan",
          message: "Walkthrough validation plan file must contain a walkthrough plan.",
        },
      ],
    };
  }
  return { ok: true, plan };
}

function jsonFailure(errors: Array<{ code: string; message: string }>): CliResult {
  return { exitCode: 1, stdout: `${JSON.stringify({ ok: false, errors }, null, 2)}\n`, stderr: "" };
}
```

- [ ] **Step 7: Update help text**

In `helpText()` and agent help text, add lines equivalent to:

```ts
"  autodemo agent validate --plan <plan-json-file> --json",
"  autodemo agent validate --url <target-url> --script <script-text> --json",
"  --plan <plan-json-file>      Walkthrough plan JSON produced by agent plan",
```

- [ ] **Step 8: Run CLI tests to verify GREEN**

Run:

```bash
rtk npm --workspace @auto-demo/cli test -- src/index.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

Run:

```bash
rtk git status --short
rtk git add packages/cli/src/index.ts packages/cli/src/index.test.ts
rtk git commit -m "feat(cli): add walkthrough validate command"
```

Expected: commit succeeds with only Task 3 files staged.

### Task 4: Docs, Project Map, And Validation

**Files:**

- Modify: `packages/agent/README.md`
- Modify: `packages/agent/src/wrapper-docs.test.ts`
- Modify: `packages/cli/README.md`
- Modify: `docs/linear/auto-demo-project-structure.md`
- Modify: `docs/superpowers/plans/2026-07-09-wes-178-validate-mode-rehearsing-user-demo-scripts.md`

- [ ] **Step 1: Write failing docs tests**

In `packages/agent/src/wrapper-docs.test.ts`, add:

```ts
it("documents validate mode blockers and WES-177 handoff", async () => {
  const agentReadme = await readAgentDoc("README.md");
  const validateMode = section(agentReadme, "## Walkthrough Validate Mode");

  for (const required of [
    "autodemo agent validate --plan <plan-json-file> --json",
    "autodemo agent validate --url <target-url> --script <script-text> --json",
    "multiple_matching_elements",
    "missing_element",
    "unresolved_plan_question",
    "typed value redacted",
    "WES-177",
  ]) {
    expect(validateMode).toContain(required);
  }
});
```

- [ ] **Step 2: Run docs test to verify RED**

Run:

```bash
rtk npm --workspace @auto-demo/agent test -- src/wrapper-docs.test.ts
```

Expected: FAIL because the README does not have the validate-mode section.

- [ ] **Step 3: Update agent README**

Add this section to `packages/agent/README.md`:

````md
## Walkthrough Validate Mode

Validate mode is the WES-178 dry-run layer after walkthrough plan intake. It
rehearses a resolved `WalkthroughPlan` against a browser target and annotates the
plan with `validation.status`, step checks, and transcript-safe blockers.

Use an existing plan artifact:

```bash
npm run autodemo -- agent validate --plan <plan-json-file> --json
```
````

Or create and validate a plan in one command:

```bash
npm run autodemo -- agent validate --url <target-url> --script <script-text> --json
```

Validation returns `ready` only when all resolved steps pass and no blockers
remain. Blockers include `multiple_matching_elements`, `missing_element`,
`unresolved_plan_question`, `navigation_failed`, `unexpected_navigation`,
`auth_wall_detected`, `timing_failure`, and `unsafe_dependent_step`.

Typed input is reported as `typed value redacted`; validate mode must not print
secrets, raw DOM snapshots, tokens, or credentials. WES-178 does not ask the user
questions interactively. WES-177 consumes blockers and candidates, presents them
for review, and updates the structured plan from user answers.

````

- [ ] **Step 4: Update CLI README**

Add `agent validate` to `packages/cli/README.md` near the existing `agent plan` docs:

```md
### `agent validate`

Validate a walkthrough plan against browser page state without recording a
capture or creating an Auto Demo project:

```bash
npm run autodemo -- agent validate --plan <plan-json-file> --json
npm run autodemo -- agent validate --url <target-url> --script <script-text> --json
````

The command prints JSON with the validated plan, step checks, and any blockers
that can be discovered safely. User-facing resolution of blockers is deferred to
the review workflow.

````

- [ ] **Step 5: Update project map**

In `docs/linear/auto-demo-project-structure.md`, add the plan link near the WES-178 spec link:

```md
- WES-178 validate mode implementation plan: `docs/superpowers/plans/2026-07-09-wes-178-validate-mode-rehearsing-user-demo-scripts.md`
````

Add an investigation note:

```md
- 2026-07-09 WES-178 implementation plan: approved scope is non-interactive validation annotations on existing walkthrough plans, with all safely discoverable blockers returned and user question resolution deferred to WES-177.
```

- [ ] **Step 6: Run docs tests**

Run:

```bash
rtk npm --workspace @auto-demo/agent test -- src/wrapper-docs.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run package checks**

Run:

```bash
rtk npm --workspace @auto-demo/agent test
rtk npm --workspace @auto-demo/agent run typecheck
rtk npm --workspace @auto-demo/agent run build
rtk npm --workspace @auto-demo/cli test
rtk npm --workspace @auto-demo/cli run typecheck
rtk npm --workspace @auto-demo/cli run build
```

Expected: all commands exit 0.

- [ ] **Step 8: Run repository validation**

Run:

```bash
rtk npm run validate
```

Expected: exit 0.

- [ ] **Step 9: Commit Task 4**

Run:

```bash
rtk git status --short
rtk git add packages/agent/README.md packages/agent/src/wrapper-docs.test.ts packages/cli/README.md docs/linear/auto-demo-project-structure.md docs/superpowers/plans/2026-07-09-wes-178-validate-mode-rehearsing-user-demo-scripts.md
rtk git commit -m "docs(agent): document walkthrough validate mode"
```

Expected: commit succeeds with only Task 4 files staged.

## Self-Review

- Spec coverage: Task 1 covers validation annotations, all safely discoverable blockers, typed-value redaction, unresolved questions, and fakeable API tests. Task 2 covers the production Playwright browser-runner boundary. Task 3 covers both CLI forms and structured errors. Task 4 covers documentation, project-map links, WES-177 handoff, and full validation.
- Placeholder scan: no TBD, TODO, "add appropriate", or "similar to" placeholders remain.
- Type consistency: the plan consistently uses `validateWalkthroughPlan`, `WalkthroughValidationBrowserRunner`, `WalkthroughValidationResult`, `ValidatedWalkthroughPlan`, and `createPlaywrightValidationRunner`.

## Execution Notes

- The user explicitly requested inline execution in the current checkout, no worktree, no commits, and all changes left unstaged. Those instructions replace every commit step above.
- The Playwright runner received behavior-first fixture tests before implementation. Its matching strategy returns every visible element from the first successful ranked strategy so duplicate accessible names remain visible as ambiguity blockers.
- The runner boundary includes page URL, title, and auth-wall inspection so `unexpected_navigation` and `auth_wall_detected` are observable outcomes instead of unreachable reason values.
- Validate mode returns a sanitized plan copy. Type-step source text is used to reconstruct the output script, and URL credentials, query strings, and fragments are removed from validated output.
- Completion review added conservative safety gates for destructive-looking actions, credential-like fields, and credential-bearing target URLs; strict full-plan shape validation; allowlisted plan serialization with secret-pattern redaction; explicit navigation rehearsal; full-location change detection; unresolved-prerequisite dependency skipping; bounded SPA DOM stabilization; actionable ordinal candidate labels; and mutually exclusive CLI input forms.
- Follow-up review hardened credential phrase/query/fragment detection, plan cross-field invariants, hash-route comparison, form-submit risk metadata, a configurable 500 ms DOM quiet window, and production blocking for non-idempotent browser requests.
- Final review hardening blocks service workers and WebSocket connections, preserves unsafe initial-load request state, and redacts unlabeled JWT/high-entropy values plus bare secret fragments.
