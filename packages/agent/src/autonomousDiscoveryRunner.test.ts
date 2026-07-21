import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type { BrowserLaunchProfileV1 } from "@auto-demo/browser-profile";
import type { Page } from "playwright";
import {
  approveWalkthroughPlan,
  compileDiscoverySessionToWalkthroughPlan,
  DISCOVERY_LIMITS,
  reviewWalkthroughPlan,
  type DiscoveryReplayResult,
  type DiscoverySessionV1,
  type WalkthroughPlan,
} from "./index.js";
import {
  completeApprovedAutonomousDiscovery,
  runAutonomousDiscoveryToReview,
  type AutonomousDiscoveryRunnerDependencies,
  type CompleteApprovedAutonomousDiscoveryDependencies,
} from "./autonomousDiscoveryRunner.js";
import type {
  AutonomousDiscoveryPlanArtifact,
  AutonomousDiscoveryReviewArtifact,
  AutonomousDiscoveryRunCheckpoint,
  AutonomousDiscoverySessionArtifact,
  AutonomousDiscoveryStore,
} from "./autonomousDiscoveryStore.js";

const PROFILE: BrowserLaunchProfileV1 = {
  schemaVersion: 1,
  browser: "chromium",
  channel: "bundled",
  headless: true,
  viewport: { width: 1280, height: 720 },
};

const INPUT = {
  runId: "runner-1",
  targetUrl: "https://example.com/checkout",
  goal: "Show the checkout payment flow",
  host: { name: "codex", version: "1" },
  policy: { mode: "yolo" } as const,
  launchProfilePlan: { schemaVersion: 1 as const, primary: PROFILE },
  inputBindings: {},
};

type StoreEvent = { kind: string; value: unknown };

class MemoryStore implements AutonomousDiscoveryStore {
  readonly events: StoreEvent[] = [];
  checkpoint?: AutonomousDiscoveryRunCheckpoint;
  plans = new Map<string, WalkthroughPlan>();
  reviewValue?: AutonomousDiscoveryReviewArtifact;
  failSessionWriteAt?: number;
  private sessionWrites = 0;
  readonly visualBytes = new Map<string, Uint8Array>();

  async writeVisualArtifact(input: { id: string; bytes: Uint8Array }) {
    const path = `visuals/${input.id}.png`;
    this.visualBytes.set(path, input.bytes);
    return { ok: true, path } as const;
  }

  async loadVisualArtifact(artifact: { path: string }) {
    const bytes = this.visualBytes.get(artifact.path);
    return bytes === undefined
      ? ({ ok: false, code: "invalid_runner_artifact", message: "invalid" } as const)
      : ({ ok: true, bytes } as const);
  }

  async initialize(checkpoint: AutonomousDiscoveryRunCheckpoint) {
    this.checkpoint = structuredClone(checkpoint);
    this.events.push({ kind: "checkpoint", value: checkpoint });
    return { ok: true } as const;
  }

  async loadCheckpoint() {
    if (this.checkpoint === undefined) {
      return {
        ok: false,
        code: "missing_runner_checkpoint",
        message: "Autonomous discovery checkpoint was not found.",
      } as const;
    }
    return { ok: true, checkpoint: structuredClone(this.checkpoint) } as const;
  }

  async writeCheckpoint(checkpoint: AutonomousDiscoveryRunCheckpoint) {
    this.checkpoint = structuredClone(checkpoint);
    this.events.push({ kind: "checkpoint", value: checkpoint });
    return { ok: true, path: "run.json" } as const;
  }

  async writeSession(kind: AutonomousDiscoverySessionArtifact, session: DiscoverySessionV1) {
    this.sessionWrites += 1;
    if (this.failSessionWriteAt === this.sessionWrites) {
      return {
        ok: false,
        code: "runner_artifact_write_failed",
        message: "Autonomous discovery artifact could not be persisted.",
      } as const;
    }
    this.events.push({ kind: "session", value: { kind, session } });
    return { ok: true, path: `sessions/${kind}.json` } as const;
  }

  async writePlan(kind: AutonomousDiscoveryPlanArtifact, plan: WalkthroughPlan) {
    this.plans.set(kind, structuredClone(plan));
    this.events.push({ kind: "plan", value: { kind, plan } });
    return { ok: true, path: `plan.${kind}.json` } as const;
  }

  async loadPlan(kind: "replay-validated" | "approved") {
    const plan = this.plans.get(kind);
    if (plan === undefined) {
      return {
        ok: false,
        code: "runner_artifact_read_failed",
        message: "Autonomous discovery artifact could not be read.",
      } as const;
    }
    return { ok: true, plan: structuredClone(plan) } as const;
  }

  async writeReplay(value: unknown) {
    this.events.push({ kind: "replay", value });
    return { ok: true, path: "replay.json" } as const;
  }

  async writeReview(value: AutonomousDiscoveryReviewArtifact) {
    this.reviewValue = structuredClone(value);
    this.events.push({ kind: "review", value });
    return { ok: true, path: "review.json" } as const;
  }

  async loadReview() {
    if (this.reviewValue === undefined) {
      return {
        ok: false,
        code: "runner_artifact_read_failed",
        message: "Autonomous discovery artifact could not be read.",
      } as const;
    }
    return { ok: true, review: structuredClone(this.reviewValue) } as const;
  }

  async writeExecution(value: unknown) {
    this.events.push({ kind: "execution", value });
    return { ok: true, path: "execution.json" } as const;
  }

  async writeHandoff(value: unknown) {
    this.events.push({ kind: "handoff", value });
    return { ok: true, path: "handoff.json" } as const;
  }
}

async function completedSession(): Promise<DiscoverySessionV1> {
  return JSON.parse(
    await readFile(
      new URL("../fixtures/discovery-session-completed.json", import.meta.url),
      "utf8",
    ),
  ) as DiscoverySessionV1;
}

function replaySuccess(session: DiscoverySessionV1, plan: WalkthroughPlan): DiscoveryReplayResult {
  const validated = structuredClone(plan);
  validated.state = "validated";
  validated.approvals = { required: true, approved: false };
  validated.validation = {
    status: "ready",
    validatedAt: "2026-07-20T12:05:00.000Z",
    mode: "discovery-replay",
    checks: validated.steps.map((step) => ({
      id: `check-${step.id}`,
      stepId: step.id,
      action: step.action,
      status: "passed",
      summary: "Replay step passed.",
    })),
    blockers: [],
    replay: {
      replayId: "replay-1",
      attempts: 1,
      sourceSessionId: session.id,
      selectedPathFingerprint:
        validated.source.parser === "discovery-v1"
          ? validated.source.discovery.selectedPathFingerprint
          : "invalid",
    },
  };
  const review = reviewWalkthroughPlan(validated);
  if (!review.ok) throw new Error("fixture review must validate");
  return {
    ok: true,
    plan: validated as Extract<DiscoveryReplayResult, { ok: true }>["plan"],
    sourceSession: session,
    attempts: [
      {
        attempt: 1,
        replayId: "replay-1",
        planId: plan.id,
        sourceSessionId: session.id,
        selectedPathFingerprint:
          plan.source.parser === "discovery-v1"
            ? plan.source.discovery.selectedPathFingerprint
            : "invalid",
        status: "passed",
        checks: validated.validation.checks,
      },
    ],
    review: review.review,
  };
}

async function runnerFixture(store = new MemoryStore()) {
  const completed = { ...(await completedSession()), launchProfile: PROFILE };
  completed.observations[0]!.interactiveTargets[0]!.label = "Continue";
  const initial: DiscoverySessionV1 = {
    ...completed,
    status: "active",
    updatedAt: completed.observations[0]!.observedAt,
    observations: [completed.observations[0]!],
    attempts: [],
    selectedPath: undefined,
    terminal: undefined,
  };
  const visualBytes = new Uint8Array([137, 80, 78, 71]);
  initial.observations[0]!.artifacts = [
    {
      id: "artifact-visual",
      kind: "screenshot",
      path: "visuals/artifact-visual.png",
      mediaType: "image/png",
    },
  ];
  store.visualBytes.set("visuals/artifact-visual.png", visualBytes);
  const acted: DiscoverySessionV1 = {
    ...completed,
    status: "active",
    selectedPath: undefined,
    terminal: undefined,
  };
  acted.observations.at(-1)!.artifacts = [
    {
      id: "artifact-after-action",
      kind: "screenshot",
      path: "visuals/artifact-after-action.png",
      mediaType: "image/png",
    },
  ];
  store.visualBytes.set("visuals/artifact-after-action.png", new Uint8Array([137, 80, 78, 72]));
  const browser = { page: {} as Page, profile: PROFILE, closed: false };
  const controller = {
    start: vi.fn(async () => ({
      ok: true as const,
      session: initial,
      observation: initial.observations[0],
      diagnostics: [],
    })),
    perform: vi.fn(async () => ({
      ok: true as const,
      session: acted,
      observation: acted.observations.at(-1),
      attempt: acted.attempts.at(-1),
      diagnostics: [],
    })),
    stop: vi.fn(async () => ({ ok: true as const, session: completed, diagnostics: [] })),
    dispose: vi.fn(async () => undefined),
  };
  let decisions = 0;
  const decisionProvider = {
    decide: vi.fn(async () => {
      decisions += 1;
      if (decisions === 1) {
        return {
          kind: "act" as const,
          input: {
            action: {
              kind: "click" as const,
              targetId: initial.observations[0]!.interactiveTargets[0]!.id,
            },
            expectations: [],
            confidence: { level: "high" as const, bases: ["exact-accessible-target" as const] },
          },
        };
      }
      return {
        kind: "complete" as const,
        attemptIds: completed.selectedPath!.attemptIds,
        source: "host-agent" as const,
      };
    }),
  };
  const dependencies: AutonomousDiscoveryRunnerDependencies = {
    store,
    decisionProvider,
    inputResolver: {
      async resolve() {
        return {
          ok: false as const,
          code: "input_binding_unavailable" as const,
          summary: "Input binding is unavailable.",
        };
      },
    },
    browserLauncher: {
      async launch() {
        return {
          ok: true as const,
          page: browser.page,
          profile: PROFILE,
          profileId: "profile-1",
          attempts: [],
          async close() {
            browser.closed = true;
          },
        };
      },
    },
    async createController() {
      return controller;
    },
    compile: compileDiscoverySessionToWalkthroughPlan,
    async replay({ sourceSession, plan }) {
      return replaySuccess(sourceSession, plan);
    },
    review: reviewWalkthroughPlan,
    clock: () => "2026-07-20T12:00:00.000Z",
    idGenerator: (kind) => `${kind}-1`,
  };
  return { browser, completed, controller, decisionProvider, dependencies, store };
}

describe("autonomous discovery runner", () => {
  it("can change the next decision from image content absent from the text observation", async () => {
    const visible = await runnerFixture();
    const unavailable = await runnerFixture();
    unavailable.store.visualBytes.set(
      "visuals/artifact-visual.png",
      new Uint8Array([0, 80, 78, 71]),
    );
    const imageAwareProvider = (fixture: Awaited<ReturnType<typeof runnerFixture>>) => {
      let calls = 0;
      fixture.dependencies.decisionProvider.decide = vi.fn(async ({ visual }) => {
        calls += 1;
        if (calls === 1 && visual.status === "available" && visual.bytes[0] === 137) {
          return {
            kind: "act" as const,
            input: {
              action: {
                kind: "click" as const,
                targetId: fixture.completed.observations[0]!.interactiveTargets[0]!.id,
              },
              expectations: [],
              confidence: { level: "high" as const, bases: ["host-inference" as const] },
            },
          };
        }
        if (calls > 1) {
          return {
            kind: "complete" as const,
            attemptIds: fixture.completed.selectedPath!.attemptIds,
            source: "host-agent" as const,
          };
        }
        return {
          kind: "abandon" as const,
          reason: { code: "visible_state_missing", summary: "Visible state is missing." },
        };
      });
    };
    imageAwareProvider(visible);
    imageAwareProvider(unavailable);

    const visibleResult = await runAutonomousDiscoveryToReview(INPUT, visible.dependencies);
    const unavailableResult = await runAutonomousDiscoveryToReview(INPUT, unavailable.dependencies);

    expect(visibleResult).toMatchObject({ ok: true, phase: "review_required" });
    expect(unavailableResult).toMatchObject({ ok: true, phase: "abandoned" });
    expect(visible.controller.perform).toHaveBeenCalledTimes(1);
    expect(unavailable.controller.perform).not.toHaveBeenCalled();
  });

  it("distinguishes a failed capture from a missing visual artifact", async () => {
    const fixture = await runnerFixture();
    fixture.controller.start.mockImplementationOnce(
      async () =>
        ({
          ok: true,
          session: fixture.completed,
          observation: fixture.completed.observations[0],
          diagnostics: [
            {
              code: "screenshot_unavailable" as const,
              message: "The optional viewport screenshot is unavailable.",
            },
          ],
        }) as never,
    );
    fixture.dependencies.decisionProvider.decide = vi.fn(async () => ({
      kind: "abandon" as const,
      reason: { code: "visual_unavailable", summary: "Visual state is unavailable." },
    }));

    await runAutonomousDiscoveryToReview(INPUT, fixture.dependencies);

    expect(fixture.dependencies.decisionProvider.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        visual: {
          status: "unavailable",
          code: "visual_state_unavailable",
          reason: "capture_failed",
        },
      }),
    );
  });

  it("persists each transition before producing a replay-validated review checkpoint", async () => {
    const fixture = await runnerFixture();
    const result = await runAutonomousDiscoveryToReview(INPUT, fixture.dependencies);

    expect(result).toMatchObject({ ok: true, phase: "review_required", replayAttempts: 1 });
    expect(fixture.store.events.map((event) => event.kind)).toEqual([
      "checkpoint",
      "session",
      "session",
      "session",
      "plan",
      "checkpoint",
      "replay",
      "plan",
      "review",
      "checkpoint",
    ]);
    expect(fixture.decisionProvider.decide).toHaveBeenCalledTimes(2);
    expect(fixture.decisionProvider.decide).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        visual: expect.objectContaining({
          status: "available",
          bytes: new Uint8Array([137, 80, 78, 71]),
        }),
      }),
    );
    expect(fixture.decisionProvider.decide).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        visual: expect.objectContaining({
          status: "available",
          bytes: new Uint8Array([137, 80, 78, 72]),
        }),
      }),
    );
    expect(fixture.controller.perform).toHaveBeenCalledTimes(1);
    expect(fixture.browser.closed).toBe(true);
  });

  it("persists abandonment and never compiles or replays", async () => {
    const fixture = await runnerFixture();
    fixture.dependencies.decisionProvider.decide = vi.fn(async () => ({
      kind: "abandon" as const,
      reason: { code: "goal_unreachable", summary: "Goal is not reachable." },
    }));
    fixture.controller.stop.mockResolvedValueOnce({
      ok: true,
      session: {
        ...fixture.completed,
        status: "abandoned",
        selectedPath: undefined,
        terminal: {
          status: "abandoned",
          abandonedAt: "2026-07-20T12:01:00.000Z",
          reason: { code: "goal_unreachable", summary: "Goal is not reachable." },
        },
      },
      diagnostics: [],
    });
    const replay = vi.spyOn(fixture.dependencies, "replay");

    const result = await runAutonomousDiscoveryToReview(INPUT, fixture.dependencies);

    expect(result).toMatchObject({ ok: true, phase: "abandoned" });
    expect(replay).not.toHaveBeenCalled();
    expect(fixture.store.events.map((event) => event.kind)).toEqual([
      "checkpoint",
      "session",
      "session",
      "checkpoint",
    ]);
    expect(fixture.browser.closed).toBe(true);
  });

  it("stops before another decision when durable session persistence fails", async () => {
    const store = new MemoryStore();
    store.failSessionWriteAt = 2;
    const fixture = await runnerFixture(store);

    const result = await runAutonomousDiscoveryToReview(INPUT, fixture.dependencies);

    expect(result).toMatchObject({
      ok: false,
      phase: "discovery",
      errors: [{ code: "artifact_persistence_failed" }],
    });
    expect(fixture.decisionProvider.decide).toHaveBeenCalledTimes(1);
    expect(fixture.controller.perform).toHaveBeenCalledTimes(1);
    expect(fixture.browser.closed).toBe(true);
  });

  it("persists the controller's failed action session before returning", async () => {
    const fixture = await runnerFixture();
    const failedSession = {
      ...structuredClone(fixture.completed),
      status: "active" as const,
      selectedPath: undefined,
      terminal: undefined,
    };
    fixture.controller.perform.mockImplementationOnce(
      async () =>
        ({
          ok: false,
          session: failedSession,
          errors: [{ code: "policy_blocked", message: "Discovery action was blocked." }],
        }) as never,
    );

    const result = await runAutonomousDiscoveryToReview(INPUT, fixture.dependencies);

    expect(result).toMatchObject({ ok: false, phase: "discovery" });
    expect(fixture.store.events).toContainEqual({
      kind: "session",
      value: { kind: "root", session: failedSession },
    });
  });

  it("rejects invalid policy and launch profile input before browser launch", async () => {
    const fixture = await runnerFixture();
    const launch = vi.spyOn(fixture.dependencies.browserLauncher, "launch");

    const result = await runAutonomousDiscoveryToReview(
      { ...INPUT, policy: { mode: "safe", allowedOrigins: [] } },
      fixture.dependencies,
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "preflight",
      errors: [{ code: "invalid_runner_input" }],
    });
    expect(launch).not.toHaveBeenCalled();
  });

  it("rejects an oversized public goal before browser launch", async () => {
    const fixture = await runnerFixture();
    const launch = vi.spyOn(fixture.dependencies.browserLauncher, "launch");

    const result = await runAutonomousDiscoveryToReview(
      { ...INPUT, goal: "x".repeat(DISCOVERY_LIMITS.publicStringCharacters + 1) },
      fixture.dependencies,
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "preflight",
      errors: [{ code: "invalid_runner_input" }],
    });
    expect(launch).not.toHaveBeenCalled();
  });

  it("keeps approval separate from discovery review", async () => {
    const fixture = await runnerFixture();
    const result = await runAutonomousDiscoveryToReview(INPUT, fixture.dependencies);
    if (!result.ok || result.phase !== "review_required") throw new Error("review expected");

    expect(result.plan.approvals).toEqual({ required: true, approved: false });
    expect(approveWalkthroughPlan(result.plan, { now: () => new Date() }).ok).toBe(true);
  });

  it("reports cleanup failure instead of a successful review checkpoint", async () => {
    const fixture = await runnerFixture();
    fixture.dependencies.browserLauncher.launch = vi.fn(async () => ({
      ok: true as const,
      page: {} as Page,
      profile: PROFILE,
      profileId: "profile-1",
      attempts: [],
      async close() {
        throw new Error("private close detail");
      },
    }));

    const result = await runAutonomousDiscoveryToReview(INPUT, fixture.dependencies);

    expect(result).toMatchObject({
      ok: false,
      phase: "cleanup",
      errors: [{ code: "cleanup_failed", message: "Autonomous discovery cleanup failed." }],
    });
    expect(JSON.stringify(result)).not.toContain("private close detail");
  });

  it("persists disposable scope without carrying its acknowledgement authority", async () => {
    const fixture = await runnerFixture();
    const result = await runAutonomousDiscoveryToReview(
      {
        ...INPUT,
        policy: {
          mode: "disposable",
          acknowledgement: "environment-is-disposable",
          allowedOrigins: ["https://example.com"],
        },
      },
      fixture.dependencies,
    );

    expect(result.ok).toBe(true);
    const persisted = JSON.stringify(fixture.store.events);
    expect(persisted).toContain('"mode":"disposable"');
    expect(persisted).not.toContain("environment-is-disposable");
  });

  it("runs a bounded repair in a fresh child session", async () => {
    const fixture = await runnerFixture();
    const child: DiscoverySessionV1 = {
      ...structuredClone(fixture.completed),
      id: "repair-session-1",
      parentSessionId: fixture.completed.id,
    };
    const childActive: DiscoverySessionV1 = {
      ...child,
      status: "active",
      selectedPath: undefined,
      terminal: undefined,
    };
    const childController = {
      start: vi.fn(async () => ({
        ok: true as const,
        session: childActive,
        observation: childActive.observations.at(-1),
        diagnostics: [],
      })),
      perform: vi.fn(),
      stop: vi.fn(async () => ({ ok: true as const, session: child, diagnostics: [] })),
      dispose: vi.fn(async () => undefined),
    };
    let controllerCreates = 0;
    fixture.dependencies.createController = vi.fn(async () => {
      controllerCreates += 1;
      return controllerCreates === 1 ? fixture.controller : childController;
    });
    let launches = 0;
    fixture.dependencies.browserLauncher.launch = vi.fn(async () => {
      launches += 1;
      return {
        ok: true as const,
        page: {} as Page,
        profile: PROFILE,
        profileId: "profile-1",
        attempts: [],
        async close() {},
      };
    });
    const failure = {
      schemaVersion: 1 as const,
      code: "target_not_found" as const,
      repairability: "repairable" as const,
      observed: {},
      recommendation: "rediscover-target" as const,
    };
    fixture.dependencies.replay = vi.fn(async (input) => {
      const repair = await input.repair.repair({
        repairNumber: 1,
        parentSession: input.sourceSession,
        failedPlan: input.plan,
        failure,
      });
      if (repair.decision !== "repaired") throw new Error("repair expected");
      const compiled = compileDiscoverySessionToWalkthroughPlan(
        repair.session as DiscoverySessionV1,
      );
      if (!compiled.ok) throw new Error("repair must compile");
      return replaySuccess(repair.session as DiscoverySessionV1, compiled.plan);
    });

    const result = await runAutonomousDiscoveryToReview(INPUT, fixture.dependencies);

    expect(result).toMatchObject({ ok: true, phase: "review_required" });
    expect(launches).toBe(2);
    expect(childController.start).toHaveBeenCalledWith(
      expect.objectContaining({ parentSessionId: fixture.completed.id }),
    );
    expect(fixture.store.events).toContainEqual({
      kind: "session",
      value: { kind: "repair-1", session: child },
    });
    expect(fixture.decisionProvider.decide).toHaveBeenLastCalledWith(
      expect.objectContaining({ repair: { number: 1, failure } }),
    );
  });

  it("rejects unapproved completion before recording", async () => {
    const fixture = await runnerFixture();
    const discovered = await runAutonomousDiscoveryToReview(INPUT, fixture.dependencies);
    if (!discovered.ok || discovered.phase !== "review_required")
      throw new Error("review expected");
    const record = vi.fn();
    const completionDependencies: CompleteApprovedAutonomousDiscoveryDependencies = {
      store: fixture.store,
      record,
      handoff: vi.fn(),
    };

    const result = await completeApprovedAutonomousDiscovery(
      {
        plan: discovered.plan,
        policy: INPUT.policy,
        inputBindings: {},
        outputDir: "/capture",
        projectDirectory: "/project",
        projectName: "Demo project",
      },
      completionDependencies,
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "approval",
      errors: [{ code: "approved_plan_required" }],
    });
    expect(record).not.toHaveBeenCalled();
  });

  it("re-establishes the persisted tier for fresh approved recording before handoff", async () => {
    const fixture = await runnerFixture();
    const discovered = await runAutonomousDiscoveryToReview(INPUT, fixture.dependencies);
    if (!discovered.ok || discovered.phase !== "review_required")
      throw new Error("review expected");
    const approved = approveWalkthroughPlan(discovered.plan, {
      now: () => new Date("2026-07-20T12:10:00.000Z"),
    });
    if (!approved.ok) throw new Error("approval expected");
    const execution = {
      ok: true as const,
      phase: "completed" as const,
      plan: approved.plan,
      steps: [],
      capture: {
        outputDir: "/capture",
        manifestPath: "/capture/capture.manifest.json",
        mediaPath: "/capture/media/viewport.webm",
        metadataPath: "/capture/metadata/events.jsonl",
        startedAt: "2026-07-20T12:11:00.000Z",
        endedAt: "2026-07-20T12:12:00.000Z",
        durationMs: 60_000,
      },
      inputBindings: { "demo-zip": "10001" },
    };
    const handoffResult = {
      ok: true as const,
      projectDirectory: "/project",
      projectName: "Demo project",
      nextSteps: ["Open the editor when requested."],
    };
    const record = vi.fn(async () => execution);
    const handoff = vi.fn(async () => handoffResult);

    const result = await completeApprovedAutonomousDiscovery(
      {
        plan: approved.plan,
        policy: INPUT.policy,
        inputBindings: { "demo-zip": "10001" },
        outputDir: "/capture",
        projectDirectory: "/project",
        projectName: "Demo project",
      },
      { store: fixture.store, record, handoff },
    );

    expect(result).toMatchObject({
      ok: true,
      phase: "completed",
      execution: { schemaVersion: 1, status: "completed", stepCount: 0 },
      handoff: {
        schemaVersion: 1,
        status: "completed",
        projectDirectory: "/project",
        projectName: "Demo project",
        nextStepCount: 1,
      },
    });
    expect(record).toHaveBeenCalledWith({
      plan: approved.plan,
      policy: INPUT.policy,
      launchProfile: PROFILE,
      outputDir: "/capture",
      inputBindings: { "demo-zip": "10001" },
    });
    expect(handoff).toHaveBeenCalledWith({
      execution,
      projectDirectory: "/project",
      projectName: "Demo project",
    });
    const persisted = JSON.stringify(fixture.store.events);
    expect(persisted).not.toContain("10001");
    expect(persisted).not.toContain("inputBindings");
    expect(JSON.stringify(result)).not.toContain("10001");
    expect(JSON.stringify(result)).not.toContain("inputBindings");
  });

  it("treats changed discovery source lineage as stale approval", async () => {
    const fixture = await runnerFixture();
    const discovered = await runAutonomousDiscoveryToReview(INPUT, fixture.dependencies);
    if (!discovered.ok || discovered.phase !== "review_required")
      throw new Error("review expected");
    const approved = approveWalkthroughPlan(discovered.plan, {
      now: () => new Date("2026-07-20T12:10:00.000Z"),
    });
    if (!approved.ok || approved.plan.source.parser !== "discovery-v1") {
      throw new Error("discovery approval expected");
    }
    approved.plan.source.discovery.sessionId = "different-session";
    const record = vi.fn();

    const result = await completeApprovedAutonomousDiscovery(
      {
        plan: approved.plan,
        policy: INPUT.policy,
        outputDir: "/capture",
        projectDirectory: "/project",
        projectName: "Demo project",
      },
      { store: fixture.store, record, handoff: vi.fn() },
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "approval",
      errors: [{ code: "approved_plan_required" }],
    });
    expect(record).not.toHaveBeenCalled();
  });

  it("blocks completion when the persisted review artifact is missing", async () => {
    const fixture = await runnerFixture();
    const discovered = await runAutonomousDiscoveryToReview(INPUT, fixture.dependencies);
    if (!discovered.ok || discovered.phase !== "review_required")
      throw new Error("review expected");
    const approved = approveWalkthroughPlan(discovered.plan, {
      now: () => new Date("2026-07-20T12:10:00.000Z"),
    });
    if (!approved.ok) throw new Error("approval expected");
    fixture.store.reviewValue = undefined;
    const record = vi.fn();

    const result = await completeApprovedAutonomousDiscovery(
      {
        plan: approved.plan,
        policy: INPUT.policy,
        outputDir: "/capture",
        projectDirectory: "/project",
        projectName: "Demo project",
      },
      { store: fixture.store, record, handoff: vi.fn() },
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "approval",
      errors: [{ code: "runner_not_reviewable" }],
    });
    expect(record).not.toHaveBeenCalled();
  });

  it("blocks completion when persisted review evidence was substituted", async () => {
    const fixture = await runnerFixture();
    const discovered = await runAutonomousDiscoveryToReview(INPUT, fixture.dependencies);
    if (!discovered.ok || discovered.phase !== "review_required")
      throw new Error("review expected");
    const approved = approveWalkthroughPlan(discovered.plan, {
      now: () => new Date("2026-07-20T12:10:00.000Z"),
    });
    if (!approved.ok || fixture.store.reviewValue === undefined)
      throw new Error("approval expected");
    fixture.store.reviewValue = { ...fixture.store.reviewValue, planFingerprint: "substituted" };
    const record = vi.fn();

    const result = await completeApprovedAutonomousDiscovery(
      {
        plan: approved.plan,
        policy: INPUT.policy,
        outputDir: "/capture",
        projectDirectory: "/project",
        projectName: "Demo project",
      },
      { store: fixture.store, record, handoff: vi.fn() },
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "approval",
      errors: [{ code: "approved_plan_mismatch" }],
    });
    expect(record).not.toHaveBeenCalled();
  });

  it("rejects a freshly approved plan whose full reviewed identity changed", async () => {
    const fixture = await runnerFixture();
    const discovered = await runAutonomousDiscoveryToReview(INPUT, fixture.dependencies);
    if (!discovered.ok || discovered.phase !== "review_required")
      throw new Error("review expected");
    const changed = structuredClone(discovered.plan);
    changed.id = "changed-plan-id";
    const approved = approveWalkthroughPlan(changed, {
      now: () => new Date("2026-07-20T12:10:00.000Z"),
    });
    if (!approved.ok) throw new Error("approval expected");
    const record = vi.fn();

    const result = await completeApprovedAutonomousDiscovery(
      {
        plan: approved.plan,
        policy: INPUT.policy,
        outputDir: "/capture",
        projectDirectory: "/project",
        projectName: "Demo project",
      },
      { store: fixture.store, record, handoff: vi.fn() },
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "approval",
      errors: [{ code: "approved_plan_mismatch" }],
    });
    expect(record).not.toHaveBeenCalled();
  });

  it("requires fresh disposable acknowledgement for the recording phase", async () => {
    const fixture = await runnerFixture();
    const policy = {
      mode: "disposable" as const,
      acknowledgement: "environment-is-disposable" as const,
      allowedOrigins: ["https://example.com"],
    };
    const discovered = await runAutonomousDiscoveryToReview(
      { ...INPUT, policy },
      fixture.dependencies,
    );
    if (!discovered.ok || discovered.phase !== "review_required")
      throw new Error("review expected");
    const approved = approveWalkthroughPlan(discovered.plan, {
      now: () => new Date("2026-07-20T12:10:00.000Z"),
    });
    if (!approved.ok) throw new Error("approval expected");
    const record = vi.fn();

    const result = await completeApprovedAutonomousDiscovery(
      {
        plan: approved.plan,
        policy: { mode: "disposable", allowedOrigins: ["https://example.com"] } as never,
        outputDir: "/capture",
        projectDirectory: "/project",
        projectName: "Demo project",
      },
      { store: fixture.store, record, handoff: vi.fn() },
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "approval",
      errors: [{ code: "approved_plan_mismatch" }],
    });
    expect(record).not.toHaveBeenCalled();
  });
});
