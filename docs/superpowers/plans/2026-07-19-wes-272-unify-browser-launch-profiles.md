# WES-272 Unified Browser Launch Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> The active `$linear-deliver-next-task` invocation overrides that execution handoff: the main agent executes this plan inline with `superpowers:test-driven-development`, without a worktree or implementation subagents.

**Goal:** Make discovery resolve one bounded browser launch profile and make fresh replay and final capture use that exact sanitized configuration while distinguishing anti-bot challenges from policy failures.

**Architecture:** Add a dependency-light `@auto-demo/browser-profile` package for validation, normalized identity, fallback bounds, and challenge classification. Persist the resolved profile in discovery-derived artifacts, then pass it through replay and approved execution into capture; each phase still launches its own browser and context.

**Tech Stack:** TypeScript, npm workspaces, Playwright, Vitest, Node.js crypto, Markdown contract tests.

---

### Task 1: Publish the shared browser-profile contract

**Files:**

- Create: `packages/browser-profile/package.json`
- Create: `packages/browser-profile/tsconfig.json`
- Create: `packages/browser-profile/src/index.ts`
- Create: `packages/browser-profile/src/index.test.ts`
- Modify: `package-lock.json`

- [ ] **Step 1: Write failing public-contract tests**

Create table-driven tests that import only the public package module and assert:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BROWSER_LAUNCH_PROFILE,
  browserLaunchProfileId,
  classifyBrowserChallenge,
  validateBrowserLaunchProfile,
  validateBrowserLaunchProfilePlan,
} from "./index.js";

const chromeHeadful = {
  schemaVersion: 1,
  browser: "chromium",
  channel: "chrome",
  headless: false,
  viewport: { width: 1440, height: 900 },
} as const;

it("normalizes one supported public launch profile", () => {
  expect(validateBrowserLaunchProfile(chromeHeadful)).toEqual({
    ok: true,
    profile: chromeHeadful,
    profileId: browserLaunchProfileId(chromeHeadful),
  });
});

it("rejects unknown fields, invalid dimensions, unsupported channels, duplicates, and a fourth attempt", () => {
  expect(
    validateBrowserLaunchProfile({ ...chromeHeadful, executablePath: "/secret" }),
  ).toMatchObject({ ok: false });
  expect(
    validateBrowserLaunchProfile({ ...chromeHeadful, viewport: { width: 0, height: 900 } }),
  ).toMatchObject({ ok: false });
  expect(validateBrowserLaunchProfile({ ...chromeHeadful, channel: "canary" })).toMatchObject({
    ok: false,
  });
  expect(
    validateBrowserLaunchProfilePlan({
      schemaVersion: 1,
      primary: chromeHeadful,
      fallbacks: [chromeHeadful],
    }),
  ).toMatchObject({ ok: false });
  expect(
    validateBrowserLaunchProfilePlan({
      schemaVersion: 1,
      primary: DEFAULT_BROWSER_LAUNCH_PROFILE,
      fallbacks: [
        chromeHeadful,
        { ...chromeHeadful, channel: "msedge" },
        { ...chromeHeadful, headless: true },
      ],
    }),
  ).toMatchObject({ ok: false });
});

it("classifies only bounded challenge marker combinations", () => {
  expect(
    classifyBrowserChallenge({
      title: "Just a moment...",
      visibleText:
        "Performing security verification This website uses a security service to protect itself",
    }),
  ).toEqual({ provider: "cloudflare" });
  expect(
    classifyBrowserChallenge({
      title: "Verify you are human",
      visibleText: "Complete the verification to continue",
    }),
  ).toEqual({ provider: "generic" });
  expect(
    classifyBrowserChallenge({ title: "Just a moment...", visibleText: "Ordinary product copy" }),
  ).toBeUndefined();
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm exec vitest -- run packages/browser-profile/src/index.test.ts`

Expected: FAIL because `packages/browser-profile/src/index.ts` and its exports do not exist.

- [ ] **Step 3: Implement the minimal package**

Create the workspace package and implement these exact public shapes:

```ts
export const BROWSER_LAUNCH_PROFILE_SCHEMA_VERSION = 1 as const;
export const MAX_BROWSER_LAUNCH_ATTEMPTS = 3 as const;

export type BrowserLaunchProfileV1 = {
  schemaVersion: 1;
  browser: "chromium";
  channel: "bundled" | "chrome" | "msedge";
  headless: boolean;
  viewport: { width: number; height: number };
};

export type BrowserLaunchProfilePlanV1 = {
  schemaVersion: 1;
  primary: BrowserLaunchProfileV1;
  fallbacks?: BrowserLaunchProfileV1[];
};

export const DEFAULT_BROWSER_LAUNCH_PROFILE: BrowserLaunchProfileV1 = {
  schemaVersion: 1,
  browser: "chromium",
  channel: "bundled",
  headless: true,
  viewport: { width: 1280, height: 720 },
};
```

Use exact-key validation, dimensions `1..4096`, at most two fallbacks, and duplicate rejection by deterministic ID. Return stable errors with code `invalid_browser_launch_profile` and no raw values. Compute `profileId` as `sha256:<digest>` over canonical normalized public fields. Implement challenge classification over lower-cased strings capped at 8,192 characters and return only `{ provider: "cloudflare" | "generic" }`.

- [ ] **Step 4: Update workspace links without downloading new dependencies**

Run: `npm install --package-lock-only --ignore-scripts`

Expected: PASS and `package-lock.json` contains `node_modules/@auto-demo/browser-profile` plus the new workspace package entry.

- [ ] **Step 5: Run package tests, build, and typecheck**

Run: `npm test -w @auto-demo/browser-profile && npm run build -w @auto-demo/browser-profile && npm run typecheck -w @auto-demo/browser-profile`

Expected: PASS.

- [ ] **Step 6: Commit the shared contract**

```bash
git add packages/browser-profile package-lock.json
git commit -m "WES-272: add browser launch profile contract"
```

### Task 2: Resolve discovery profiles with bounded fresh-browser fallback

**Files:**

- Create: `packages/agent/src/playwrightDiscoveryBrowserLauncher.ts`
- Create: `packages/agent/src/playwrightDiscoveryBrowserLauncher.test.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/package.json`

- [ ] **Step 1: Write failing launcher behavior tests**

Use an injected boundary that records launches, contexts, navigation, summaries, and closes. Assert ordered primary/fallback attempts and public output:

```ts
const result = await createPlaywrightDiscoveryBrowserLauncherForDriver(driver).launch({
  url: "https://example.com/search",
  profilePlan: {
    schemaVersion: 1,
    primary: bundledHeadless,
    fallbacks: [chromeHeadful],
  },
});

expect(result).toMatchObject({
  ok: true,
  profile: chromeHeadful,
  attempts: [{ ordinal: 1, outcome: "anti_bot_challenge", challenge: { provider: "cloudflare" } }],
});
expect(driver.launches).toEqual([bundledHeadless, chromeHeadful]);
expect(driver.resourcesForAttempt(1)).toMatchObject({ contextClosed: true, browserClosed: true });
```

Also assert invalid plans launch nothing, three failed attempts return `browser_profile_fallback_exhausted`, evidence contains no injected raw error/page secret, success does not continue fallback, and `close()` is idempotent.

- [ ] **Step 2: Run the launcher test and verify RED**

Run: `npm exec vitest -- run packages/agent/src/playwrightDiscoveryBrowserLauncher.test.ts`

Expected: FAIL because the launcher module does not exist.

- [ ] **Step 3: Implement the injected and production launchers**

Publish:

```ts
export type DiscoveryBrowserLaunchAttempt = {
  ordinal: 1 | 2 | 3;
  profileId: string;
  outcome: "browser_launch_failed" | "browser_navigation_failed" | "anti_bot_challenge";
  challenge?: { provider: "cloudflare" | "generic" };
};

export type DiscoveryBrowserLaunchHandle = {
  page: Page;
  profile: BrowserLaunchProfileV1;
  profileId: string;
  attempts: DiscoveryBrowserLaunchAttempt[];
  close(): Promise<void>;
};

export function createPlaywrightDiscoveryBrowserLauncher(): DiscoveryBrowserLauncher;
```

Map `bundled` to no Playwright channel, map installed channels by name, pass `headless`, create a context with the exact viewport, navigate with `waitUntil: "domcontentloaded"`, classify `{ title, visibleText }`, and close failed resources before trying the next declared profile. Cap visible text before calling the shared classifier. Do not accept storage state, persistent context, arbitrary args, or executable path.

- [ ] **Step 4: Export the launcher and add the workspace dependency**

Add `@auto-demo/browser-profile: "0.0.0"` to `packages/agent/package.json`, add the new test to its `test` script, and export launcher/result types from `packages/agent/src/index.ts`.

- [ ] **Step 5: Verify GREEN**

Run: `npm exec vitest -- run packages/agent/src/playwrightDiscoveryBrowserLauncher.test.ts && npm run build -w @auto-demo/agent`

Expected: PASS.

- [ ] **Step 6: Commit the discovery launcher**

```bash
git add packages/agent/package.json packages/agent/src/index.ts packages/agent/src/playwrightDiscoveryBrowserLauncher.ts packages/agent/src/playwrightDiscoveryBrowserLauncher.test.ts package-lock.json
git commit -m "WES-272: resolve discovery browser profiles"
```

### Task 3: Persist the resolved profile through discovery and plan approval

**Files:**

- Modify: `packages/agent/src/discoveryContract.ts`
- Modify: `packages/agent/src/discoverySession.ts`
- Modify: `packages/agent/src/discoveryValidation.ts`
- Modify: `packages/agent/src/discoveryPlanCompiler.ts`
- Modify: `packages/agent/src/walkthroughValidation.ts`
- Modify: `packages/agent/src/walkthroughApproval.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/src/discoverySession.test.ts`
- Modify: `packages/agent/src/discoveryValidation.test.ts`
- Modify: `packages/agent/src/discoveryPlanCompiler.test.ts`
- Modify: `packages/agent/src/walkthroughValidation.test.ts`
- Modify: `packages/agent/src/walkthroughApproval.test.ts`

- [ ] **Step 1: Write failing artifact-parity tests**

Create a completed discovery fixture with `launchProfile: chromeHeadful`; assert validation preserves it and compilation produces:

```ts
expect(compiled.plan.launchProfile).toEqual(chromeHeadful);
expect(isWalkthroughPlan(compiled.plan)).toBe(true);

const approved = approveWalkthroughPlan(validatedPlan, { now });
expect(approved.ok).toBe(true);
if (!approved.ok) throw new Error("approval failed");
approved.plan.launchProfile = bundledHeadless;
expect(verifyWalkthroughPlanApproval(approved.plan)).toMatchObject({
  ok: false,
  errors: [{ code: "stale_approval" }],
});
```

Also assert malformed/unknown profile fields fail session and plan validation, child discovery sessions preserve the profile, profile changes cause `plan_source_mismatch`, and historical fixtures without a profile still validate.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm exec vitest -- run packages/agent/src/discoverySession.test.ts packages/agent/src/discoveryValidation.test.ts packages/agent/src/discoveryPlanCompiler.test.ts packages/agent/src/walkthroughValidation.test.ts packages/agent/src/walkthroughApproval.test.ts`

Expected: FAIL because profile metadata is not accepted, copied, validated, sanitized, or fingerprinted.

- [ ] **Step 3: Add optional validated profile metadata to discovery**

Add `launchProfile?: BrowserLaunchProfileV1` to `DiscoverySessionV1` and `CreateDiscoverySessionInput`. Permit exactly the `launchProfile` key, validate it through `validateBrowserLaunchProfile()`, and copy only the normalized profile. Preserve it in `createChildDiscoverySession()` by requiring a child profile equal to the terminal parent's profile when the parent has one; profile drift returns `invalid_discovery_transition`.

- [ ] **Step 4: Add optional profile metadata to plans**

Add `launchProfile?: BrowserLaunchProfileV1` to `WalkthroughPlan`. The compiler copies `session.launchProfile`; `isWalkthroughPlan()` validates it; `sanitizePlan()` copies the normalized public fields; and `walkthroughPlanFingerprint()` includes `launchProfile: plan.launchProfile ?? null`. Legacy fingerprint fallbacks are valid only when the plan itself has no launch profile.

- [ ] **Step 5: Verify GREEN**

Run: `npm exec vitest -- run packages/agent/src/discoverySession.test.ts packages/agent/src/discoveryValidation.test.ts packages/agent/src/discoveryPlanCompiler.test.ts packages/agent/src/walkthroughValidation.test.ts packages/agent/src/walkthroughApproval.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit durable parity metadata**

```bash
git add packages/agent/src/discoveryContract.ts packages/agent/src/discoverySession.ts packages/agent/src/discoveryValidation.ts packages/agent/src/discoveryPlanCompiler.ts packages/agent/src/walkthroughValidation.ts packages/agent/src/walkthroughApproval.ts packages/agent/src/index.ts packages/agent/src/discoverySession.test.ts packages/agent/src/discoveryValidation.test.ts packages/agent/src/discoveryPlanCompiler.test.ts packages/agent/src/walkthroughValidation.test.ts packages/agent/src/walkthroughApproval.test.ts
git commit -m "WES-272: preserve launch profiles in discovery plans"
```

### Task 4: Launch fresh replay from the plan profile and classify challenges

**Files:**

- Modify: `packages/agent/src/discoveryReplay.ts`
- Modify: `packages/agent/src/playwrightDiscoveryReplay.ts`
- Modify: `packages/agent/src/discoveryReplay.test.ts`
- Modify: `packages/agent/src/playwrightDiscoveryReplay.test.ts`

- [ ] **Step 1: Write failing replay parity tests**

Extend the fake factory assertion to require the canonical profile on every attempt:

```ts
expect(factory.created).toEqual([
  { policy, attempt: 1, launchProfile: chromeHeadful },
  { policy, attempt: 2, launchProfile: chromeHeadful },
]);
```

Add production-driver tests that assert `channel: "chrome"`, `headless: false`, and the exact viewport reach a fresh browser/context. Add a local challenge fixture and assert:

```ts
expect(result).toMatchObject({
  ok: false,
  attempts: [
    {
      status: "failed",
      failure: {
        code: "anti_bot_challenge",
        repairability: "hard-boundary",
        observed: { challenge: { provider: "cloudflare" } },
      },
    },
  ],
});
expect(repair).not.toHaveBeenCalled();
```

Retain a separate policy-blocking case that still reports `policy_blocked`.

- [ ] **Step 2: Run replay tests and verify RED**

Run: `npm exec vitest -- run packages/agent/src/discoveryReplay.test.ts packages/agent/src/playwrightDiscoveryReplay.test.ts`

Expected: FAIL because replay factory input has no profile and setup collapses every non-policy failure.

- [ ] **Step 3: Extend the replay boundary and evidence**

Change the factory input to:

```ts
create(input: {
  policy: DiscoveryPolicy;
  attempt: number;
  launchProfile: BrowserLaunchProfileV1;
}): Promise<DiscoveryReplayBrowser>;
```

Add `anti_bot_challenge` to `DiscoveryReplayFailureCode`, add optional bounded `challenge` to `observed`, and let `DiscoveryReplayBrowserError` carry only the provider for that code. Pass `prepared.plan.launchProfile ?? DEFAULT_BROWSER_LAUNCH_PROFILE` to every attempt. Treat anti-bot as a hard boundary and never call repair.

- [ ] **Step 4: Remove the production hard-coded launch assumption**

Make the Playwright factory use the profile from `create()`:

```ts
this.browser = await chromium.launch({
  headless: profile.headless,
  ...(profile.channel === "bundled" ? {} : { channel: profile.channel }),
});
this.context = await this.browser.newContext({
  ...(validation.policy.mode === "yolo" ? {} : { serviceWorkers: "block" as const }),
  viewport: profile.viewport,
});
```

After bootstrap navigation and policy checks, collect bounded title/text in memory and throw `anti_bot_challenge` with provider when classified. Keep `actionTimeoutMs` and `stabilityDurationMs` as factory options; remove independent replay viewport configuration.

- [ ] **Step 5: Verify GREEN**

Run: `npm exec vitest -- run packages/agent/src/discoveryReplay.test.ts packages/agent/src/playwrightDiscoveryReplay.test.ts && npm test -w @auto-demo/agent`

Expected: PASS.

- [ ] **Step 6: Commit replay parity**

```bash
git add packages/agent/src/discoveryReplay.ts packages/agent/src/playwrightDiscoveryReplay.ts packages/agent/src/discoveryReplay.test.ts packages/agent/src/playwrightDiscoveryReplay.test.ts
git commit -m "WES-272: replay with the resolved browser profile"
```

### Task 5: Launch capture with the approved profile

**Files:**

- Modify: `packages/capture/package.json`
- Modify: `packages/capture/src/index.ts`
- Modify: `packages/capture/src/playwrightDriver.ts`
- Modify: `packages/capture/src/playwrightAdapter.ts`
- Modify: `packages/capture/src/playwrightAdapter.test.ts`

- [ ] **Step 1: Write failing capture behavior tests**

Extend the fake driver to record the launch profile. Assert a profile-aware start launches the declared channel/headless mode, creates exactly one fresh context, records at the profile viewport, and navigates. Add cases for profile/viewport mismatch, invalid profiles, and challenge summaries. Expected challenge result:

```ts
expect(result).toMatchObject({
  ok: false,
  code: "anti_bot_challenge",
  diagnostic: { provider: "cloudflare", profileId: browserLaunchProfileId(chromeHeadful) },
});
expect(driver.browser.closed).toBe(true);
expect(driver.browser.context.closed).toBe(true);
```

- [ ] **Step 2: Run capture tests and verify RED**

Run: `npm exec vitest -- run packages/capture/src/playwrightAdapter.test.ts`

Expected: FAIL because capture options and the driver ignore launch profiles and challenge pages.

- [ ] **Step 3: Extend capture public options and stable failures**

Add `launchProfile?: BrowserLaunchProfileV1` to `BrowserCaptureOptions`. Add `invalid_browser_launch_profile` and `anti_bot_challenge` to `CaptureErrorCode`; challenge failures may include only `{ provider, profileId }`. Default an omitted profile from `options.viewport`, and reject an explicit profile whose viewport differs from `options.viewport` before creating directories or launching.

- [ ] **Step 4: Make the driver profile-aware**

Change `PlaywrightDriver.launchChromium()` to `launchChromium(profile)` and map normalized channel/headless fields to `chromium.launch()`. Add a bounded `challengeSummary()` page boundary returning only title and capped visible text. In the adapter, classify immediately after initial navigation; close resources and return the dedicated challenge failure before exposing a capture session.

- [ ] **Step 5: Add the workspace dependency and verify GREEN**

Add `@auto-demo/browser-profile: "0.0.0"` to capture dependencies.

Run: `npm exec vitest -- run packages/capture/src/playwrightAdapter.test.ts && npm test -w @auto-demo/capture && npm run build -w @auto-demo/capture`

Expected: PASS.

- [ ] **Step 6: Commit capture parity**

```bash
git add packages/capture/package.json packages/capture/src/index.ts packages/capture/src/playwrightDriver.ts packages/capture/src/playwrightAdapter.ts packages/capture/src/playwrightAdapter.test.ts package-lock.json
git commit -m "WES-272: capture with approved browser profiles"
```

### Task 6: Forward the approved profile through final agent execution

**Files:**

- Modify: `packages/agent/src/walkthroughExecution.ts`
- Modify: `packages/agent/src/walkthroughExecution.test.ts`
- Modify: `packages/cli/src/agentExecuteCommand.ts`
- Modify: `packages/cli/src/agentExecuteCommand.test.ts`
- Modify: `packages/cli/src/agentExecuteCommand.smoke.test.ts`

- [ ] **Step 1: Write failing execution handoff tests**

Assert `executeWalkthroughPlan()` passes the approved profile into `startCapture()` unchanged and rejects an explicit viewport that differs from it before capture starts:

```ts
expect(starts).toEqual([
  { sourceUrl, outputDir, viewport: chromeHeadful.viewport, launchProfile: chromeHeadful },
]);

expect(mismatch).toMatchObject({
  ok: false,
  phase: "preflight",
  errors: [{ code: "launch_profile_mismatch" }],
});
expect(starts).toHaveLength(0);
```

Add CLI cases showing an omitted `--viewport` derives viewport from the approved profile, an explicit matching viewport works, an explicit mismatch fails without capture, and legacy plans retain 1280x720/default behavior.

- [ ] **Step 2: Run execution tests and verify RED**

Run: `npm exec vitest -- run packages/agent/src/walkthroughExecution.test.ts packages/cli/src/agentExecuteCommand.test.ts packages/cli/src/agentExecuteCommand.smoke.test.ts`

Expected: FAIL because execution passes only viewport and CLI eagerly defaults it.

- [ ] **Step 3: Extend the structural execution boundary**

Add `launch_profile_mismatch` to `WalkthroughExecutionErrorCode`. Let `WalkthroughExecutionInput.viewport` be optional, resolve it from `plan.launchProfile?.viewport` before the legacy default, and fail when an explicitly supplied viewport differs. Extend `startCapture()` options with optional `launchProfile` and pass the approved plan field unchanged.

- [ ] **Step 4: Make CLI viewport fallback profile-aware**

Have argument parsing return `viewport?: CaptureViewport`; after reading the plan, resolve:

```ts
const viewport =
  parsed.viewport ?? planResult.plan.launchProfile?.viewport ?? DEFAULT_BROWSER_VIEWPORT;
```

Pass `launchProfile` from the agent start-capture options into `captureAdapter.start()`. Do not add a CLI profile override: the approved plan is authoritative.

- [ ] **Step 5: Verify GREEN and end-to-end smoke behavior**

Run: `npm exec vitest -- run packages/agent/src/walkthroughExecution.test.ts packages/cli/src/agentExecuteCommand.test.ts packages/cli/src/agentExecuteCommand.smoke.test.ts && npm test -w @auto-demo/cli`

Expected: PASS.

- [ ] **Step 6: Commit the final-capture handoff**

```bash
git add packages/agent/src/walkthroughExecution.ts packages/agent/src/walkthroughExecution.test.ts packages/cli/src/agentExecuteCommand.ts packages/cli/src/agentExecuteCommand.test.ts packages/cli/src/agentExecuteCommand.smoke.test.ts
git commit -m "WES-272: preserve browser profile through recording"
```

### Task 7: Document the workflow and verify the whole repository

**Files:**

- Modify: `README.md`
- Modify: `packages/agent/README.md`
- Modify: `packages/capture/README.md`
- Modify: `packages/cli/README.md`
- Modify: `packages/agent/skills/auto-demo/SKILL.md`
- Modify: `packages/agent/src/wrapper-docs.test.ts`
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Write failing documentation contract assertions**

Extend wrapper/docs tests to require the workflow to state:

```ts
expect(skill).toContain("browser launch profile");
expect(skill).toContain("same resolved profile");
expect(skill).toContain("fresh isolated browser");
expect(skill).toContain("anti_bot_challenge");
expect(skill).toContain("Do not reuse cookies, storage state, or authenticated browser state");
```

- [ ] **Step 2: Run the docs test and verify RED**

Run: `npm exec vitest -- run packages/agent/src/wrapper-docs.test.ts`

Expected: FAIL because current documentation does not describe the WES-272 profile contract.

- [ ] **Step 3: Update public and operator documentation**

Document supported fields, primary plus at most two fallbacks, discovery-only resolution, exact resolved-profile reuse by fresh replay/capture, fresh risk-tier establishment, `anti_bot_challenge` versus policy errors, legacy defaults, and prohibited state reuse. Do not claim WES-268's autonomous runner or WES-273 Cars.com acceptance.

- [ ] **Step 4: Record verified local implementation evidence in the project map**

Add WES-272 design/plan links near the other Milestone 10 links and append an implementation note containing exact passing commands/test counts. Keep WES-272 In Progress and WES-271 as the deterministic post-merge pointer until PR integration succeeds.

- [ ] **Step 5: Run focused formatting and diff checks**

Run: `npm exec prettier -- --check packages/browser-profile packages/agent packages/capture packages/cli README.md docs/superpowers/specs/2026-07-19-wes-272-unify-browser-launch-profiles-design.md docs/superpowers/plans/2026-07-19-wes-272-unify-browser-launch-profiles.md docs/linear/auto-demo-project-structure.md && rtk git diff --check`

Expected: PASS.

- [ ] **Step 6: Run the complete relevant local suite**

Run: `npm run build && npm run typecheck && npm test && npm run format:check`

Expected: build, every workspace typecheck, all Node/Vitest tests, and repository-wide formatting PASS. If repository-wide ESLint is run locally, preserve and report only the pre-existing untracked `workflow/cars-kia-sorento/discover.mjs` findings; clean-checkout CI remains authoritative for unrelated user-owned artifacts.

- [ ] **Step 7: Commit documentation and verified evidence**

```bash
git add README.md packages/agent/README.md packages/capture/README.md packages/cli/README.md packages/agent/skills/auto-demo/SKILL.md packages/agent/src/wrapper-docs.test.ts docs/linear/auto-demo-project-structure.md docs/superpowers/specs/2026-07-19-wes-272-unify-browser-launch-profiles-design.md docs/superpowers/plans/2026-07-19-wes-272-unify-browser-launch-profiles.md
git commit -m "WES-272: document unified browser profiles"
```

### Task 8: Review, publish, merge, and synchronize

**Files:**

- Modify only issue-owned files needed for valid review/CI corrections.
- Modify before merge: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Run verification-before-completion and independent read-only review**

Review the issue, design, plan, complete diff, tests, profile/state boundaries, diagnostics, and compatibility. Fix verified findings through RED-GREEN and rerun affected checks.

- [ ] **Step 2: Publish a focused PR to `develop`**

Push `wes-272-unify-browser-launch-profiles`; create a PR referencing WES-272, the spec and plan, exact verification commands, fresh-context guarantees, and preserved unrelated files.

- [ ] **Step 3: Monitor checks and review threads**

Use structured PR status until required checks pass. Diagnose failed checks with `gh-pr-failing-tests`; classify review feedback with `gh-pr-review-triage`; apply only technically valid in-scope corrections and rerun affected verification.

- [ ] **Step 4: Add stable pre-merge completion evidence to the map**

Record the implementation behavior, exact final PR head, required check/run, review result, and deterministic post-merge pointer WES-271. Push the map update and wait for the final required check.

- [ ] **Step 5: Squash merge and synchronize**

Squash merge only after all acceptance criteria, required checks, and actionable review threads pass. Switch to `develop`, verify its upstream owns the PR base, fetch `origin/develop`, and run `git pull --ff-only origin develop` without touching `.gitignore` or `workflow/cars-kia-sorento/`.

- [ ] **Step 6: Run the completion sync gate**

Use the merged PR, squash commit, checks, local verification, spec, plan, and map as evidence. Add a concise Linear completion comment, move WES-272 to Done, add the readiness handoff to WES-271, reconcile WES-268/WES-273 blockers, and leave WES-271 unstarted as the next pointer.
