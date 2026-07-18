/// <reference lib="dom" />

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  approveWalkthroughPlan,
  compileDiscoverySessionToWalkthroughPlan,
  createPlaywrightDiscoveryReplayBrowserFactory,
  createPolicyEnforcedPlaywrightDiscoveryRehearsalController,
  replayAndRepairDiscoveryPlan,
  reviewWalkthroughPlan,
  type DiscoveryRehearsalResult,
  type DiscoverySessionV1,
} from "@auto-demo/agent";
import { loadProject } from "@auto-demo/project";
import { afterEach, describe, expect, it } from "vitest";
import {
  DISCARDED_TARGET_CANARY,
  FAILURE_DETAIL_CANARY,
  QUERY_CANARY,
  RUNTIME_CANARY,
  startAgenticDiscoveryAcceptanceFixture,
  type AgenticDiscoveryAcceptanceFixture,
} from "./agenticDiscoveryAcceptanceFixture.js";
import { runCliAsync } from "./index.js";

let browser: Browser | undefined;
let context: BrowserContext | undefined;
let page: Page | undefined;
let fixture: AgenticDiscoveryAcceptanceFixture | undefined;
const tempRoots: string[] = [];

const RAW_DISCARDED_TARGET = `Continue story ${DISCARDED_TARGET_CANARY}`;
const PRIVATE_CANARIES = [
  DISCARDED_TARGET_CANARY,
  FAILURE_DETAIL_CANARY,
  QUERY_CANARY,
  RUNTIME_CANARY,
  RAW_DISCARDED_TARGET,
];

function expectPrivateCanariesAbsent(value: unknown): void {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  for (const canary of PRIVATE_CANARIES) expect(serialized).not.toContain(canary);
}

afterEach(async () => {
  await context?.close();
  await browser?.close();
  await fixture?.close();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  page = undefined;
  context = undefined;
  browser = undefined;
  fixture = undefined;
});

function requireObservation(result: DiscoveryRehearsalResult) {
  if (!result.ok || result.observation === undefined) {
    throw new Error("acceptance observation must succeed");
  }
  return result.observation;
}

async function discoverStoryPath(
  activeBrowser: Browser,
  activeFixture: AgenticDiscoveryAcceptanceFixture,
  actionLabel: "initial" | "repaired",
  sessionId: string,
  parentSessionId?: string,
): Promise<DiscoverySessionV1> {
  const discoveryContext = await activeBrowser.newContext({
    viewport: { width: 640, height: 360 },
  });
  const discoveryPage = await discoveryContext.newPage();
  await discoveryPage.goto(activeFixture.storiesUrl);
  const controller = await createPolicyEnforcedPlaywrightDiscoveryRehearsalController(
    discoveryPage,
    {
      chromiumNetworkInstrumentation: "exclusive",
      policy: { mode: "safe", allowedOrigins: [activeFixture.origin] },
      inputResolver: {
        async resolve() {
          return { ok: true as const, value: RUNTIME_CANARY };
        },
      },
    },
  );
  try {
    const started = await controller.start({
      id: sessionId,
      target: { kind: "browser", startUrl: activeFixture.storiesUrl },
      goal: "Open the first story and show it is ready",
      host: { name: "codex", version: "1.0.0" },
      ...(parentSessionId === undefined ? {} : { parentSessionId }),
    });
    const firstStory = requireObservation(started).interactiveTargets.find(
      (target) =>
        target.label === "Read story" && target.role === "link" && target.occurrence === 1,
    );
    if (firstStory === undefined) throw new Error("first story target missing");
    const opened = await controller.perform({
      action: { kind: "click", targetId: firstStory.id },
      expectations: [
        {
          id: `${sessionId}-story-url`,
          kind: "navigation",
          origin: "declared-before-action",
          url: activeFixture.firstStoryUrl,
          match: "exact-url",
        },
        {
          id: `${sessionId}-story-heading`,
          kind: "visible-state",
          origin: "declared-before-action",
          publicCondition: "First story",
          role: "heading",
        },
      ],
      confidence: { level: "high", bases: ["exact-accessible-target", "positional-intent"] },
    });
    const storyInput = requireObservation(opened).interactiveTargets.find(
      (target) => target.label === "Story note" && target.role === "textbox",
    );
    if (storyInput === undefined) throw new Error("story input target missing");
    const typed = await controller.perform({
      action: {
        kind: "type",
        targetId: storyInput.id,
        inputBinding: "story-note",
        valueClass: "demo-data",
      },
      expectations: [],
      confidence: { level: "high", bases: ["exact-accessible-target"] },
    });
    const expectedActionLabel =
      actionLabel === "initial" ? "Continue story [redacted-secret]" : "Open story";
    const storyAction = requireObservation(typed).interactiveTargets.find(
      (target) => target.label === expectedActionLabel && target.role === "button",
    );
    if (storyAction === undefined) throw new Error("story action target missing");
    const ready = await controller.perform({
      action: { kind: "click", targetId: storyAction.id },
      expectations: [
        {
          id: `${sessionId}-story-ready`,
          kind: "visible-state",
          origin: "declared-before-action",
          publicCondition: "Story ready",
        },
      ],
      confidence: { level: "high", bases: ["expected-visible-state-observed"] },
    });
    if (
      !opened.ok ||
      opened.attempt === undefined ||
      !typed.ok ||
      typed.attempt === undefined ||
      !ready.ok ||
      ready.attempt === undefined
    ) {
      throw new Error("story path must succeed");
    }
    const completed = await controller.stop({
      outcome: "complete",
      attemptIds: [opened.attempt.id, typed.attempt.id, ready.attempt.id],
      source: "host-agent",
    });
    if (!completed.ok) {
      throw new Error(`story session must complete: ${JSON.stringify(completed.errors)}`);
    }
    return completed.session;
  } finally {
    await controller.dispose();
    await discoveryContext.close();
  }
}

describe("agentic discovery acceptance", () => {
  it("selects the first semantic duplicate and records cross-page evidence", async () => {
    fixture = await startAgenticDiscoveryAcceptanceFixture();
    browser = await chromium.launch();
    context = await browser.newContext({ viewport: { width: 640, height: 360 } });
    page = await context.newPage();
    await page.goto(fixture.storiesUrl);
    const controller = await createPolicyEnforcedPlaywrightDiscoveryRehearsalController(page, {
      chromiumNetworkInstrumentation: "exclusive",
      policy: { mode: "safe", allowedOrigins: [fixture.origin] },
      inputResolver: {
        async resolve() {
          return {
            ok: false as const,
            code: "input_binding_unavailable" as const,
            summary: "No input expected.",
          };
        },
      },
    });

    const started = await controller.start({
      id: "semantic-first-story",
      target: { kind: "browser", startUrl: fixture.storiesUrl },
      goal: "Open the first story",
      host: { name: "codex", version: "1.0.0" },
    });
    const observation = requireObservation(started);
    const storyTargets = observation.interactiveTargets.filter(
      (target) => target.label === "Read story" && target.role === "link",
    );
    expect(storyTargets.map((target) => target.occurrence)).toEqual([1, 2]);
    const firstStory = storyTargets.find((target) => target.occurrence === 1);
    if (firstStory === undefined) throw new Error("first story target missing");

    const opened = await controller.perform({
      action: { kind: "click", targetId: firstStory.id },
      expectations: [
        {
          id: "expect-first-story-url",
          kind: "navigation",
          origin: "declared-before-action",
          url: fixture.firstStoryUrl,
          match: "exact-url",
        },
        {
          id: "expect-first-story-heading",
          kind: "visible-state",
          origin: "declared-before-action",
          publicCondition: "First story",
          role: "heading",
        },
      ],
      confidence: {
        level: "high",
        bases: ["exact-accessible-target", "positional-intent"],
      },
    });
    expect(opened).toMatchObject({
      ok: true,
      attempt: {
        status: "succeeded",
        observedEffects: [
          { expectationId: "expect-first-story-url", status: "matched" },
          { expectationId: "expect-first-story-heading", status: "matched" },
        ],
      },
      observation: { page: { url: fixture.firstStoryUrl } },
    });
    if (!opened.ok || opened.attempt === undefined) throw new Error("story click must succeed");
    const completed = await controller.stop({
      outcome: "complete",
      attemptIds: [opened.attempt.id],
      source: "host-agent",
    });
    expect(completed).toMatchObject({
      ok: true,
      session: {
        status: "completed",
        selectedPath: { attemptIds: [opened.attempt.id] },
      },
    });
    await controller.dispose();
  });

  it("requires exact-origin disposable authority for mutation", async () => {
    fixture = await startAgenticDiscoveryAcceptanceFixture();
    browser = await chromium.launch();

    const safeContext = await browser.newContext({ viewport: { width: 640, height: 360 } });
    const safePage = await safeContext.newPage();
    await safePage.goto(fixture.profileUrl);
    const safeController = await createPolicyEnforcedPlaywrightDiscoveryRehearsalController(
      safePage,
      {
        chromiumNetworkInstrumentation: "exclusive",
        policy: { mode: "safe", allowedOrigins: [fixture.origin] },
        inputResolver: {
          async resolve() {
            return { ok: true as const, value: "Demo Person" };
          },
        },
      },
    );
    const safeStarted = await safeController.start({
      id: "safe-profile",
      target: { kind: "browser", startUrl: fixture.profileUrl },
      goal: "Save the profile",
      host: { name: "codex", version: "1.0.0" },
    });
    const safeSave = requireObservation(safeStarted).interactiveTargets.find(
      (target) => target.label === "Save profile",
    );
    if (safeSave === undefined) throw new Error("safe save target missing");
    const blocked = await safeController.perform({
      action: { kind: "click", targetId: safeSave.id },
      expectations: [],
      confidence: { level: "high", bases: ["exact-accessible-target"] },
    });
    expect(blocked).toMatchObject({
      ok: true,
      attempt: { status: "blocked", outcome: { code: "destructive_action_blocked" } },
    });
    expect(fixture.mutationCount()).toBe(0);
    await safeController.dispose();
    await safeContext.close();

    const wrongOriginContext = await browser.newContext({ viewport: { width: 640, height: 360 } });
    const wrongOriginPage = await wrongOriginContext.newPage();
    await wrongOriginPage.goto(fixture.profileUrl);
    await expect(
      createPolicyEnforcedPlaywrightDiscoveryRehearsalController(wrongOriginPage, {
        chromiumNetworkInstrumentation: "exclusive",
        policy: {
          mode: "disposable",
          acknowledgement: "environment-is-disposable",
          allowedOrigins: ["http://127.0.0.1:1"],
        },
        inputResolver: {
          async resolve() {
            return { ok: true as const, value: "Demo Person" };
          },
        },
      }),
    ).rejects.toMatchObject({ code: "origin_not_allowed" });
    expect(fixture.mutationCount()).toBe(0);
    await wrongOriginContext.close();

    context = await browser.newContext({ viewport: { width: 640, height: 360 } });
    page = await context.newPage();
    await page.goto(fixture.profileUrl);
    const disposableController = await createPolicyEnforcedPlaywrightDiscoveryRehearsalController(
      page,
      {
        chromiumNetworkInstrumentation: "exclusive",
        policy: {
          mode: "disposable",
          acknowledgement: "environment-is-disposable",
          allowedOrigins: [fixture.origin],
        },
        inputResolver: {
          async resolve() {
            return { ok: true as const, value: "Demo Person" };
          },
        },
      },
    );
    const disposableStarted = await disposableController.start({
      id: "disposable-profile",
      target: { kind: "browser", startUrl: fixture.profileUrl },
      goal: "Save the profile",
      host: { name: "codex", version: "1.0.0" },
    });
    const disposableSave = requireObservation(disposableStarted).interactiveTargets.find(
      (target) => target.label === "Save profile",
    );
    if (disposableSave === undefined) throw new Error("disposable save target missing");
    const saved = await disposableController.perform({
      action: { kind: "click", targetId: disposableSave.id },
      expectations: [
        {
          id: "expect-profile-saved",
          kind: "visible-state",
          origin: "declared-before-action",
          publicCondition: "Profile saved",
        },
      ],
      confidence: { level: "high", bases: ["expected-visible-state-observed"] },
    });
    expect(saved).toMatchObject({
      ok: true,
      attempt: {
        status: "succeeded",
        observedEffects: [{ expectationId: "expect-profile-saved", status: "matched" }],
      },
    });
    if (!saved.ok || saved.attempt === undefined) throw new Error("profile save must succeed");
    expect(fixture.mutationCount()).toBe(1);
    const disposableCompleted = await disposableController.stop({
      outcome: "complete",
      attemptIds: [saved.attempt.id],
      source: "host-agent",
    });
    expect(disposableCompleted).toMatchObject({
      ok: true,
      session: { status: "completed", selectedPath: { attemptIds: [saved.attempt.id] } },
    });
    expect(JSON.stringify(disposableCompleted)).not.toContain("environment-is-disposable");
    await disposableController.dispose();
  });

  it("repairs a stale semantic target in a direct child and passes fresh replay", async () => {
    fixture = await startAgenticDiscoveryAcceptanceFixture();
    browser = await chromium.launch();
    const rootSession = await discoverStoryPath(browser, fixture, "initial", "story-root");
    const compiled = compileDiscoverySessionToWalkthroughPlan(rootSession);
    if (!compiled.ok) throw new Error("root discovery must compile");
    expect(compiled.plan).toMatchObject({
      state: "draft",
      approvals: { required: true, approved: false },
      source: { parser: "discovery-v1" },
    });

    fixture.useRepairedStoryTarget();
    let repairFailureCode: string | undefined;
    const result = await replayAndRepairDiscoveryPlan(
      {
        plan: compiled.plan,
        sourceSession: rootSession,
        policy: { mode: "safe", allowedOrigins: [fixture.origin] },
        inputBindings: { "story-note": RUNTIME_CANARY },
      },
      { maxRepairs: 1, replayIdGenerator: () => "story-replay" },
      {
        browserFactory: createPlaywrightDiscoveryReplayBrowserFactory({
          viewport: { width: 640, height: 360 },
          stabilityDurationMs: 25,
        }),
        repair: {
          async repair(input) {
            repairFailureCode = input.failure.code;
            const child = await discoverStoryPath(
              browser!,
              fixture!,
              "repaired",
              "story-repair-1",
              input.parentSession.id,
            );
            return { decision: "repaired" as const, session: child };
          },
        },
      },
    );

    expect(repairFailureCode).toBe("target_not_found");
    expect(result).toMatchObject({
      ok: true,
      attempts: [{ status: "failed" }, { status: "passed" }],
      sourceSession: { id: "story-repair-1", parentSessionId: rootSession.id },
      plan: {
        state: "validated",
        approvals: { required: true, approved: false },
        validation: { mode: "discovery-replay", replay: { attempts: 2 } },
      },
    });
    expectPrivateCanariesAbsent(result);
    expect(JSON.stringify(result)).not.toContain("environment-is-disposable");
    if (!result.ok) throw new Error("repaired replay must pass");

    const review = reviewWalkthroughPlan(result.plan);
    expect(review).toMatchObject({
      ok: true,
      review: { approval: { eligible: true, basis: "validated" } },
    });
    const root = await mkdtemp(join(tmpdir(), "auto-demo-agentic-acceptance-"));
    tempRoots.push(root);
    const validatedPlanPath = join(root, "validated-plan.json");
    const inputsPath = join(root, "inputs.json");
    await writeFile(inputsPath, `${JSON.stringify({ "story-note": RUNTIME_CANARY })}\n`);
    await writeFile(
      validatedPlanPath,
      `${JSON.stringify({ ok: true, plan: result.plan }, null, 2)}\n`,
    );
    const unapproved = await runCliAsync([
      "agent",
      "execute",
      "--plan",
      validatedPlanPath,
      "--out",
      join(root, "unapproved-capture"),
      "--inputs",
      inputsPath,
      "--viewport",
      "640x360",
      "--json",
    ]);
    expect(unapproved.exitCode).toBe(1);
    expect(JSON.parse(unapproved.stdout)).toMatchObject({
      ok: false,
      errors: [{ code: "unapproved_plan" }],
    });

    const approved = approveWalkthroughPlan(result.plan, {
      now: () => new Date("2026-07-18T14:00:00.000Z"),
    });
    if (!approved.ok) throw new Error("validated discovery plan must approve");
    expect(approved.plan).toMatchObject({
      state: "approved",
      approvals: { required: true, approved: true, basis: "validated" },
    });
    const approvedPlanPath = join(root, "approved-plan.json");
    const captureDir = join(root, "capture");
    await writeFile(
      approvedPlanPath,
      `${JSON.stringify({ ok: true, plan: approved.plan }, null, 2)}\n`,
    );
    const execution = await runCliAsync([
      "agent",
      "execute",
      "--plan",
      approvedPlanPath,
      "--out",
      captureDir,
      "--inputs",
      inputsPath,
      "--viewport",
      "640x360",
      "--json",
    ]);
    expect(execution.exitCode).toBe(0);
    const executionOutput = JSON.parse(execution.stdout);
    expect(executionOutput).toMatchObject({
      ok: true,
      plan: { state: "executed", execution: { status: "completed" } },
    });
    expect((await stat(executionOutput.capture.mediaPath)).size).toBeGreaterThan(0);
    const captureManifest = JSON.parse(
      await readFile(executionOutput.capture.manifestPath, "utf8"),
    );
    const captureMetadata = await readFile(executionOutput.capture.metadataPath, "utf8");
    expect(captureManifest.status).toBe("completed");
    expectPrivateCanariesAbsent([execution.stdout, captureManifest, captureMetadata]);
    expect(execution.stdout).not.toContain("environment-is-disposable");

    const executionPath = join(root, "execution.json");
    const projectDir = join(root, "project");
    await writeFile(executionPath, execution.stdout);
    const handoff = await runCliAsync([
      "agent",
      "handoff",
      "--execution",
      executionPath,
      "--project",
      projectDir,
      "--name",
      "Agentic Story Demo",
      "--json",
    ]);
    expect(handoff.exitCode).toBe(0);
    const handoffOutput = JSON.parse(handoff.stdout);
    expect(handoffOutput).toMatchObject({
      ok: true,
      variant: { id: "baseline-polish", path: "variants/baseline-polish.json" },
      nextSteps: {
        editor: { args: expect.arrayContaining(["open", "--project", projectDir]) },
        export: {
          args: expect.arrayContaining([
            "export",
            "--project",
            projectDir,
            "--variant",
            "baseline-polish",
          ]),
        },
      },
    });
    expectPrivateCanariesAbsent(handoff.stdout);
    const loaded = await loadProject(projectDir);
    expect(loaded).toMatchObject({
      ok: true,
      manifest: {
        sourceCapture: { status: "completed" },
        variants: [expect.objectContaining({ id: "baseline-polish" })],
      },
    });
    expect((await stat(join(projectDir, "variants", "baseline-polish.json"))).size).toBeGreaterThan(
      0,
    );

    fixture.removeStoryTarget();
    const failedCaptureDir = join(root, "failed-capture");
    const failedExecution = await runCliAsync([
      "agent",
      "execute",
      "--plan",
      approvedPlanPath,
      "--out",
      failedCaptureDir,
      "--inputs",
      inputsPath,
      "--viewport",
      "640x360",
      "--json",
    ]);
    expect(failedExecution.exitCode).toBe(1);
    const failedOutput = JSON.parse(failedExecution.stdout);
    expect(failedOutput).toMatchObject({
      ok: false,
      phase: "execution",
      errors: [{ code: "target_not_found" }],
    });
    const failedManifest = JSON.parse(await readFile(failedOutput.capture.manifestPath, "utf8"));
    const failedMetadata = await readFile(failedOutput.capture.metadataPath, "utf8");
    expect(failedManifest.status).toBe("failed");
    expect((await stat(failedOutput.capture.mediaPath)).size).toBeGreaterThan(0);
    expectPrivateCanariesAbsent([failedExecution.stdout, failedManifest, failedMetadata]);
    expect(failedExecution.stdout).not.toContain("environment-is-disposable");
  }, 60_000);
});
