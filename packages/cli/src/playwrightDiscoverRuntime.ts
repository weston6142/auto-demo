import { lstat, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
  PlaywrightCoordinateDiscoveryPage,
  createMacOsCaptureHelperClient,
  createMacOsBrowserWindowCapture,
  createCoordinateDiscoverySession,
  createFileCoordinateDiscoveryStore,
  createPlaywrightDiscoveryBrowserLauncher,
  createPlaywrightDiscoveryReplayBrowserFactory,
  finalizeCoordinateDiscovery,
  preflightMacOsCaptureHelper,
  replayAndRepairDiscoveryPlan,
  reviewWalkthroughPlan,
  type CapturedCoordinateFrame,
  type BrowserWindowCapture,
  type CoordinateDiscoveryCheckpoint,
  type CoordinateDiscoveryPage,
  type CoordinateDiscoverySession,
  type CoordinateDiscoveryStore,
  type DiscoveryBrowserLaunchHandle,
  type DiscoveryBrowserLauncher,
  type DiscoveryPolicy,
  type MacOsCaptureHelperClient,
  type MacOsCaptureHelperPreflightResult,
} from "@auto-demo/agent";
import type { Page } from "playwright";
import type { DiscoverHostBootstrap } from "./discoverBackend.js";
import {
  createDiscoverPageDiagnostics,
  createDiscoverHostDiagnosticRecorder,
  type DiscoverHostDiagnosticRecorder,
  type DiscoverRuntimeOperationStage,
} from "./discoverHostDiagnostics.js";
import type { DiscoverHostRuntime } from "./discoverHost.js";

export type PlaywrightDiscoverRuntimeResult = {
  runtime: DiscoverHostRuntime;
  initialResponse: Record<string, unknown> & { ok: boolean };
};

export type PlaywrightDiscoverRuntimeOptions = {
  createWindowCapture?: (page: Page) => Promise<BrowserWindowCapture | undefined>;
  platform?: NodeJS.Platform;
  preflightCaptureHelper?: () => Promise<MacOsCaptureHelperPreflightResult>;
  createCaptureHelperClient?: typeof createMacOsCaptureHelperClient;
  launchBrowser?: DiscoveryBrowserLauncher["launch"];
  createCoordinateStore?: (sessionDirectory: string) => CoordinateDiscoveryStore;
  finalizeCoordinateDiscovery?: typeof finalizeCoordinateDiscovery;
  createCoordinatePage?: (input: {
    page: Page;
    windowCapture?: BrowserWindowCapture;
  }) => CoordinateDiscoveryPage;
};

export async function createPlaywrightDiscoverRuntime(
  bootstrap: DiscoverHostBootstrap,
  options: PlaywrightDiscoverRuntimeOptions = {},
): Promise<PlaywrightDiscoverRuntimeResult> {
  const platform = options.platform ?? process.platform;
  let helperPreflight: Extract<MacOsCaptureHelperPreflightResult, { ok: true }> | undefined;
  if (platform === "darwin" && options.createWindowCapture === undefined) {
    const preflight = await (options.preflightCaptureHelper ?? preflightMacOsCaptureHelper)();
    if (!preflight.ok) {
      return { runtime: failedRuntime(), initialResponse: preflight };
    }
    helperPreflight = preflight;
  }
  const launcher = createPlaywrightDiscoveryBrowserLauncher();
  const diagnostics = await createDiscoverHostDiagnosticRecorder(bootstrap.sessionDirectory);
  const pageDiagnostics = createDiscoverPageDiagnostics({
    startUrl: bootstrap.start.url,
    recorder: diagnostics,
  });
  let launched: Awaited<ReturnType<DiscoveryBrowserLauncher["launch"]>>;
  try {
    launched = await (options.launchBrowser ?? launcher.launch.bind(launcher))({
      url: bootstrap.start.url,
      profilePlan: {
        schemaVersion: 1,
        primary: {
          schemaVersion: 1,
          browser: "chromium",
          channel: "chrome",
          headless: false,
          viewport: { width: 1280, height: 720 },
        },
        fallbacks: [
          {
            schemaVersion: 1,
            browser: "chromium",
            channel: "bundled",
            headless: false,
            viewport: { width: 1280, height: 720 },
          },
        ],
      },
      onMainDocumentResponse: pageDiagnostics.onMainDocumentResponse,
      onLaunchAttempt: pageDiagnostics.onLaunchAttempt,
    });
  } catch (error) {
    await diagnostics.record({
      event: "runtime_operation_failed",
      operation: "startup",
      stage: "browser_launch",
    });
    await closeDiagnostics(pageDiagnostics, diagnostics);
    throw error;
  }
  if (!launched.ok) {
    await diagnostics.record({
      event: "runtime_operation_failed",
      operation: "startup",
      stage: "browser_launch",
    });
    await closeDiagnostics(pageDiagnostics, diagnostics);
    return {
      runtime: failedRuntime(),
      initialResponse: {
        ok: false,
        code: launched.code,
        message: launched.message,
      },
    };
  }

  await diagnostics.record({
    event: "runtime_started",
    profileId: launched.profileId,
    channel: launched.profile.channel,
    headless: launched.profile.headless,
    viewport: launched.profile.viewport,
  });
  let helperClient: MacOsCaptureHelperClient | undefined;
  let windowCapture: BrowserWindowCapture | undefined;
  try {
    if (options.createWindowCapture !== undefined) {
      windowCapture = await options.createWindowCapture(launched.page);
    } else if (helperPreflight !== undefined) {
      helperClient = await (options.createCaptureHelperClient ?? createMacOsCaptureHelperClient)({
        sessionDirectory: bootstrap.sessionDirectory,
        installPath: helperPreflight.installPath,
      });
      windowCapture = await createMacOsBrowserWindowCapture(launched.page, {
        platform,
        client: helperClient,
      });
    }
  } catch {
    await diagnostics.record({
      event: "runtime_operation_failed",
      operation: "startup",
      stage: "capture_setup",
    });
    await Promise.allSettled([helperClient?.close(), launched.close()]);
    await closeDiagnostics(pageDiagnostics, diagnostics);
    return {
      runtime: failedRuntime(),
      initialResponse: {
        ok: false,
        code: "capture_helper_unavailable",
        message: "Auto Demo Capture could not start.",
        setupCommand: "npm run autodemo -- setup capture-helper --json",
      },
    };
  }
  const adapter =
    options.createCoordinatePage?.({
      page: launched.page,
      ...(windowCapture === undefined ? {} : { windowCapture }),
    }) ??
    new PlaywrightCoordinateDiscoveryPage(
      launched.page,
      { ...(windowCapture === undefined ? {} : { windowCapture }) },
      { x: 64, y: 64 },
    );
  const session = createCoordinateDiscoverySession({
    page: adapter,
    grid: bootstrap.start.grid,
    diagnostics,
  });
  const store = (options.createCoordinateStore ?? createFileCoordinateDiscoveryStore)(
    bootstrap.sessionDirectory,
  );
  const started = await session.start();
  if (!started.ok) {
    await diagnostics.record({
      event: "runtime_operation_failed",
      operation: "startup",
      stage: "coordinate_session_start",
    });
    await Promise.allSettled([windowCapture?.close?.(), launched.close()]);
    await closeDiagnostics(pageDiagnostics, diagnostics);
    return { runtime: failedRuntime(), initialResponse: started };
  }
  const state = createRuntimeState(
    bootstrap,
    launched,
    session,
    store,
    diagnostics,
    pageDiagnostics,
    options.finalizeCoordinateDiscovery ?? finalizeCoordinateDiscovery,
    windowCapture,
  );
  const frame = await state.persistFrame(started.frame);
  if (!frame.ok) {
    await diagnostics.record({
      event: "runtime_operation_failed",
      operation: "startup",
      stage: "initial_frame_persistence",
    });
    await Promise.allSettled([windowCapture?.close?.(), launched.close()]);
    await closeDiagnostics(pageDiagnostics, diagnostics);
    return { runtime: failedRuntime(), initialResponse: frame };
  }
  const checkpoint = await state.persistCheckpoint("discovering", started.frame.id);
  if (!checkpoint.ok) {
    await diagnostics.record({
      event: "runtime_operation_failed",
      operation: "startup",
      stage: "checkpoint_persistence",
    });
  }
  return {
    runtime: runtimeFor(state),
    initialResponse: { ok: true, sessionId: bootstrap.sessionId, frame: frame.frame },
  };
}

function createRuntimeState(
  bootstrap: DiscoverHostBootstrap,
  launched: DiscoveryBrowserLaunchHandle,
  session: CoordinateDiscoverySession,
  store: CoordinateDiscoveryStore,
  diagnostics: DiscoverHostDiagnosticRecorder,
  pageDiagnostics: { close(): Promise<void> },
  finalizer: typeof finalizeCoordinateDiscovery,
  windowCapture?: BrowserWindowCapture,
) {
  let phase: CoordinateDiscoveryCheckpoint["phase"] = "discovering";
  let currentFrame: Record<string, unknown> | undefined;
  let closed = false;
  const policy = discoveryPolicy(bootstrap);
  return {
    bootstrap,
    launched,
    session,
    store,
    diagnostics,
    finalizer,
    policy,
    get phase() {
      return phase;
    },
    set phase(value: CoordinateDiscoveryCheckpoint["phase"]) {
      phase = value;
    },
    get currentFrame() {
      return currentFrame;
    },
    async persistFrame(frame: CapturedCoordinateFrame) {
      const written = await store.writeFrame({ id: frame.id, bytes: frame.png });
      if (!written.ok) return written;
      currentFrame = {
        id: frame.id,
        screenshotPath: relative(process.cwd(), join(bootstrap.sessionDirectory, written.path)),
        width: frame.width,
        height: frame.height,
        deviceScaleFactor: 1,
        pointer: frame.pointer,
      };
      return { ok: true as const, frame: currentFrame };
    },
    async persistCheckpoint(nextPhase: CoordinateDiscoveryCheckpoint["phase"], frameId?: string) {
      phase = nextPhase;
      return await store.writeCheckpoint({
        schemaVersion: 1,
        sessionId: bootstrap.sessionId,
        phase,
        target: { url: bootstrap.start.url, goal: bootstrap.start.goal },
        pointer: (currentFrame?.pointer as { x: number; y: number } | undefined) ?? {
          x: 64,
          y: 64,
        },
        ...(frameId === undefined ? {} : { frameId }),
        transientBindings: Object.keys(session.runtimeBindings()),
        trace: session.durableTrace(),
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await Promise.allSettled([windowCapture?.close?.(), launched.close()]);
      } finally {
        await closeDiagnostics(pageDiagnostics, diagnostics);
      }
    },
  };
}

function runtimeFor(state: ReturnType<typeof createRuntimeState>): DiscoverHostRuntime {
  return {
    async observe() {
      let stage: DiscoverRuntimeOperationStage = "coordinate_session";
      try {
        const observed = await state.session.observe();
        if (!observed.ok) return observed;
        stage = "frame_persistence";
        const persisted = await state.persistFrame(observed.frame);
        if (!persisted.ok) {
          await recordReturnedFailure(state, "observe", stage);
          return persisted;
        }
        stage = "checkpoint_persistence";
        const checkpoint = await state.persistCheckpoint(state.phase, observed.frame.id);
        if (!checkpoint.ok) await recordReturnedFailure(state, "observe", stage);
        return { ok: true, sessionId: state.bootstrap.sessionId, frame: persisted.frame };
      } catch (error) {
        await state.diagnostics.record({
          event: "runtime_operation_failed",
          operation: "observe",
          stage,
        });
        throw error;
      }
    },
    async act(actions) {
      let stage: DiscoverRuntimeOperationStage = "coordinate_session";
      try {
        const acted = await state.session.act(actions);
        await state.diagnostics.record({
          event: "coordinate_act_result",
          ok: acted.ok,
          executedActions: acted.executedActions,
          ...(acted.ok ? { boundary: acted.boundary } : { code: acted.code }),
        });
        if (!acted.ok && acted.code === "anti_bot_challenge") state.phase = "failed";
        let frame: Record<string, unknown> | undefined;
        if (acted.frame !== undefined) {
          stage = "frame_persistence";
          const persisted = await state.persistFrame(acted.frame);
          if (!persisted.ok) {
            await recordReturnedFailure(state, "act", stage);
            return persisted;
          }
          frame = persisted.frame;
        }
        stage = "checkpoint_persistence";
        const checkpoint = await state.persistCheckpoint(state.phase, acted.frame?.id);
        if (!checkpoint.ok) await recordReturnedFailure(state, "act", stage);
        return {
          ...acted,
          ...(frame === undefined ? {} : { frame }),
        } as Record<string, unknown> & { ok: boolean };
      } catch (error) {
        await state.diagnostics.record({
          event: "runtime_operation_failed",
          operation: "act",
          stage,
        });
        throw error;
      }
    },
    async status() {
      return {
        ok: true,
        sessionId: state.bootstrap.sessionId,
        status: state.phase,
        ...(state.currentFrame === undefined ? {} : { frame: state.currentFrame }),
        actionCount: state.session.durableTrace().length,
        transientBindings: Object.keys(state.session.runtimeBindings()),
      };
    },
    async finish() {
      let stage: DiscoverRuntimeOperationStage = "finalization";
      try {
        if (state.phase === "failed") {
          return {
            ok: false,
            code: "anti_bot_challenge",
            message: "Coordinate discovery stopped at an anti-bot challenge.",
          };
        }
        const finalized = await state.finalizer(
          {
            sessionId: state.bootstrap.sessionId,
            targetUrl: state.bootstrap.start.url,
            goal: state.bootstrap.start.goal,
            trace: state.session.durableTrace(),
            runtimeBindings: state.session.runtimeBindings(),
          },
          {
            now: () => new Date(),
            async replay({ sourceSession, plan, runtimeBindings }) {
              const replayed = await replayAndRepairDiscoveryPlan(
                {
                  sourceSession,
                  plan,
                  policy: state.policy,
                  inputBindings: runtimeBindings,
                },
                { maxRepairs: 0 },
                { browserFactory: createPlaywrightDiscoveryReplayBrowserFactory() },
              );
              if (replayed.ok) {
                return { ok: true, attempts: replayed.attempts.length, plan: replayed.plan };
              }
              const failed = replayed.attempts.at(-1);
              return {
                ok: false,
                attempts: replayed.attempts.length,
                failure: {
                  code:
                    failed?.status === "failed"
                      ? failed.failure.code
                      : (replayed.errors[0]?.code ?? "replay_failed"),
                  ...(failed?.status === "failed" && failed.failure.step !== undefined
                    ? { stepId: failed.failure.step.id }
                    : {}),
                },
              };
            },
            review: reviewWalkthroughPlan,
          },
        );
        state.phase = finalized.ok
          ? finalized.phase === "review_required"
            ? "review-required"
            : "repairing"
          : "failed";
        stage = "checkpoint_persistence";
        const checkpoint = await state.persistCheckpoint(state.phase);
        if (!checkpoint.ok) await recordReturnedFailure(state, "finish", stage);
        if (finalized.ok && finalized.phase === "review_required") {
          stage = "review_plan_persistence";
          await atomicJson(
            join(state.bootstrap.sessionDirectory, "plan.replay-validated.json"),
            finalized.plan,
          );
          stage = "review_artifact_persistence";
          await atomicJson(join(state.bootstrap.sessionDirectory, "review.json"), finalized.review);
          return {
            ok: true,
            sessionId: state.bootstrap.sessionId,
            phase: finalized.phase,
            replayAttempts: finalized.replayAttempts,
            plan: finalized.plan,
            review: finalized.review,
          };
        }
        return finalized as unknown as Record<string, unknown> & { ok: boolean };
      } catch (error) {
        await state.diagnostics.record({
          event: "runtime_operation_failed",
          operation: "finish",
          stage,
        });
        throw error;
      }
    },
    async abandon() {
      try {
        state.phase = "abandoned";
        const checkpoint = await state.persistCheckpoint("abandoned");
        if (!checkpoint.ok) {
          await recordReturnedFailure(state, "abandon", "checkpoint_or_close");
        }
        await state.close();
        return { ok: true, sessionId: state.bootstrap.sessionId, status: "abandoned" };
      } catch (error) {
        await state.diagnostics.record({
          event: "runtime_operation_failed",
          operation: "abandon",
          stage: "checkpoint_or_close",
        });
        throw error;
      }
    },
    close: () => state.close(),
  };
}

async function recordReturnedFailure(
  state: ReturnType<typeof createRuntimeState>,
  operation: "act" | "observe" | "finish" | "abandon" | "startup",
  stage: DiscoverRuntimeOperationStage,
): Promise<void> {
  await state.diagnostics.record({ event: "runtime_operation_failed", operation, stage });
}

async function closeDiagnostics(
  pageDiagnostics: { close(): Promise<void> },
  diagnostics: DiscoverHostDiagnosticRecorder,
): Promise<void> {
  await pageDiagnostics.close().catch(() => undefined);
  await diagnostics.record({ event: "runtime_stopped" });
  await diagnostics.close();
}

function discoveryPolicy(bootstrap: DiscoverHostBootstrap): DiscoveryPolicy {
  if (bootstrap.start.risk === "yolo") return { mode: "yolo" };
  const origin = new URL(bootstrap.start.url).origin;
  const allowedOrigins = [...new Set([origin, ...bootstrap.start.allowedOrigins])];
  if (bootstrap.start.risk === "disposable") {
    return {
      mode: "disposable",
      acknowledgement: "environment-is-disposable",
      allowedOrigins,
    };
  }
  return bootstrap.start.risk === "safe"
    ? { mode: "safe", allowedOrigins }
    : { mode: "public-browse", allowedOrigins };
}

function failedRuntime(): DiscoverHostRuntime {
  const failure = async () => ({
    ok: false,
    code: "discovery_host_unavailable",
    message: "Discover host is unavailable.",
  });
  return {
    observe: failure,
    act: failure,
    status: failure,
    finish: failure,
    abandon: failure,
    async close() {},
  };
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, path);
}

export async function readDiscoverBootstrap(path: string): Promise<DiscoverHostBootstrap> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 256_000) {
    throw new Error("invalid discover bootstrap");
  }
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isBootstrap(value) || dirname(path) !== value.sessionDirectory) {
    throw new Error("invalid discover bootstrap");
  }
  return value;
}

function isBootstrap(value: unknown): value is DiscoverHostBootstrap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return (
    input.schemaVersion === 1 &&
    typeof input.sessionId === "string" &&
    /^[a-z0-9][a-z0-9-]{0,127}$/i.test(input.sessionId) &&
    typeof input.sessionDirectory === "string" &&
    typeof input.token === "string" &&
    typeof input.start === "object" &&
    input.start !== null
  );
}
