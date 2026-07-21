import { lstat, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
  PlaywrightCoordinateDiscoveryPage,
  createMacOsBrowserWindowCapture,
  createCoordinateDiscoverySession,
  createFileCoordinateDiscoveryStore,
  createPlaywrightDiscoveryBrowserLauncher,
  createPlaywrightDiscoveryReplayBrowserFactory,
  finalizeCoordinateDiscovery,
  replayAndRepairDiscoveryPlan,
  reviewWalkthroughPlan,
  type CapturedCoordinateFrame,
  type BrowserWindowCapture,
  type CoordinateDiscoveryCheckpoint,
  type CoordinateDiscoverySession,
  type DiscoveryBrowserLaunchHandle,
  type DiscoveryPolicy,
} from "@auto-demo/agent";
import type { Page } from "playwright";
import type { DiscoverHostBootstrap } from "./discoverBackend.js";
import type { DiscoverHostRuntime } from "./discoverHost.js";

export type PlaywrightDiscoverRuntimeResult = {
  runtime: DiscoverHostRuntime;
  initialResponse: Record<string, unknown> & { ok: boolean };
};

export type PlaywrightDiscoverRuntimeOptions = {
  createWindowCapture?: (page: Page) => Promise<BrowserWindowCapture | undefined>;
};

export async function createPlaywrightDiscoverRuntime(
  bootstrap: DiscoverHostBootstrap,
  options: PlaywrightDiscoverRuntimeOptions = {},
): Promise<PlaywrightDiscoverRuntimeResult> {
  const launcher = createPlaywrightDiscoveryBrowserLauncher();
  const launched = await launcher.launch({
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
  });
  if (!launched.ok) {
    return {
      runtime: failedRuntime(),
      initialResponse: {
        ok: false,
        code: launched.code,
        message: launched.message,
      },
    };
  }

  const windowCapture = await (options.createWindowCapture ?? createMacOsBrowserWindowCapture)(
    launched.page,
  );
  const adapter = new PlaywrightCoordinateDiscoveryPage(
    launched.page,
    { ...(windowCapture === undefined ? {} : { windowCapture }) },
    { x: 64, y: 64 },
  );
  const session = createCoordinateDiscoverySession({ page: adapter, grid: bootstrap.start.grid });
  const store = createFileCoordinateDiscoveryStore(bootstrap.sessionDirectory);
  const started = await session.start();
  if (!started.ok) {
    await launched.close();
    return { runtime: failedRuntime(), initialResponse: started };
  }
  const state = createRuntimeState(bootstrap, launched, session, store);
  const frame = await state.persistFrame(started.frame);
  if (!frame.ok) {
    await launched.close();
    return { runtime: failedRuntime(), initialResponse: frame };
  }
  await state.persistCheckpoint("discovering", started.frame.id);
  return {
    runtime: runtimeFor(state),
    initialResponse: { ok: true, sessionId: bootstrap.sessionId, frame: frame.frame },
  };
}

function createRuntimeState(
  bootstrap: DiscoverHostBootstrap,
  launched: DiscoveryBrowserLaunchHandle,
  session: CoordinateDiscoverySession,
  store: ReturnType<typeof createFileCoordinateDiscoveryStore>,
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
      await launched.close();
    },
  };
}

function runtimeFor(state: ReturnType<typeof createRuntimeState>): DiscoverHostRuntime {
  return {
    async observe() {
      const observed = await state.session.observe();
      if (!observed.ok) return observed;
      const persisted = await state.persistFrame(observed.frame);
      if (!persisted.ok) return persisted;
      await state.persistCheckpoint(state.phase, observed.frame.id);
      return { ok: true, sessionId: state.bootstrap.sessionId, frame: persisted.frame };
    },
    async act(actions) {
      const acted = await state.session.act(actions);
      if (!acted.ok && acted.code === "anti_bot_challenge") state.phase = "failed";
      let frame: Record<string, unknown> | undefined;
      if (acted.frame !== undefined) {
        const persisted = await state.persistFrame(acted.frame);
        if (!persisted.ok) return persisted;
        frame = persisted.frame;
      }
      await state.persistCheckpoint(state.phase, acted.frame?.id);
      return {
        ...acted,
        ...(frame === undefined ? {} : { frame }),
      } as Record<string, unknown> & { ok: boolean };
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
      if (state.phase === "failed") {
        return {
          ok: false,
          code: "anti_bot_challenge",
          message: "Coordinate discovery stopped at an anti-bot challenge.",
        };
      }
      const finalized = await finalizeCoordinateDiscovery(
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
      await state.persistCheckpoint(state.phase);
      if (finalized.ok && finalized.phase === "review_required") {
        await atomicJson(
          join(state.bootstrap.sessionDirectory, "plan.replay-validated.json"),
          finalized.plan,
        );
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
    },
    async abandon() {
      state.phase = "abandoned";
      await state.persistCheckpoint("abandoned");
      await state.close();
      return { ok: true, sessionId: state.bootstrap.sessionId, status: "abandoned" };
    },
    close: () => state.close(),
  };
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
