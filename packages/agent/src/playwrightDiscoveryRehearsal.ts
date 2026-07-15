import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import type { DiscoveryAction } from "./discoveryContract.js";
import {
  createDiscoveryObservationExtractorWithRegistry,
  type DiscoveryObservationArtifactSink,
  type DiscoveryObservationIdKind,
} from "./discoveryObservation.js";
import {
  createDiscoveryRehearsalController,
  type DiscoveryActionAuthorizer,
  type DiscoveryInputResolver,
  type DiscoveryRehearsalDriver,
  type DiscoveryRehearsalDriverResult,
} from "./discoveryRehearsal.js";
import {
  createDiscoveryTargetRegistry,
  type DiscoveryTargetRegistry,
  type DiscoveryTargetRuntimeRisk,
} from "./discoveryTargetRegistry.js";
import { PlaywrightDiscoveryObservationPage } from "./playwrightDiscoveryPage.js";

export type PlaywrightDiscoveryRehearsalOptions<TPermit> = {
  authorizer: DiscoveryActionAuthorizer<TPermit>;
  inputResolver: DiscoveryInputResolver;
  artifactSink?: DiscoveryObservationArtifactSink;
  observationClock?: () => string;
  observationIdGenerator?: (kind: DiscoveryObservationIdKind) => string;
  clock?: () => string;
  attemptIdGenerator?: () => string;
};

export type PlaywrightDiscoveryRehearsalRuntimeOptions = Omit<
  PlaywrightDiscoveryRehearsalOptions<unknown>,
  "authorizer" | "inputResolver"
>;

export type PlaywrightDiscoveryDriverHookInput<TPermit> = {
  action: DiscoveryAction;
  permit: TPermit;
  resolvedValue?: string;
  targetRisk?: DiscoveryTargetRuntimeRisk;
};

export type PlaywrightDiscoveryDriverHooks<TPermit> = {
  beforeExecute?(
    input: PlaywrightDiscoveryDriverHookInput<TPermit>,
  ):
    | Promise<DiscoveryRehearsalDriverResult | undefined>
    | DiscoveryRehearsalDriverResult
    | undefined;
  afterExecute?():
    | Promise<DiscoveryRehearsalDriverResult | undefined>
    | DiscoveryRehearsalDriverResult
    | undefined;
};

export type PlaywrightDiscoveryRehearsalRuntime<TPermit> = {
  driver: DiscoveryRehearsalDriver<TPermit>;
  registry: DiscoveryTargetRegistry;
};

export function createPlaywrightDiscoveryRehearsalController<TPermit>(
  page: Page,
  options: PlaywrightDiscoveryRehearsalOptions<TPermit>,
) {
  const { driver } = createPlaywrightDiscoveryRehearsalRuntime<TPermit>(page, options);
  return createDiscoveryRehearsalController({
    driver,
    authorizer: options.authorizer,
    inputResolver: options.inputResolver,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.attemptIdGenerator === undefined
      ? {}
      : { idGenerator: options.attemptIdGenerator }),
  });
}

export function createPlaywrightDiscoveryRehearsalRuntime<TPermit>(
  page: Page,
  options: PlaywrightDiscoveryRehearsalRuntimeOptions,
  hooks: PlaywrightDiscoveryDriverHooks<TPermit> = {},
): PlaywrightDiscoveryRehearsalRuntime<TPermit> {
  const adapter = new PlaywrightDiscoveryObservationPage(page);
  const idGenerator =
    options.observationIdGenerator ??
    ((kind: DiscoveryObservationIdKind) => `${kind}-${randomUUID()}`);
  const registry = createDiscoveryTargetRegistry(() => idGenerator("target"));
  const extractor = createDiscoveryObservationExtractorWithRegistry(
    {
      page: adapter,
      idGenerator,
      ...(options.artifactSink === undefined ? {} : { artifactSink: options.artifactSink }),
      ...(options.observationClock === undefined ? {} : { clock: options.observationClock }),
    },
    registry,
  );
  const driver: DiscoveryRehearsalDriver<TPermit> = {
    observe: () => extractor.observe(),
    hasLiveTarget: (targetId) => extractor.hasLiveTarget(targetId),
    isAvailable: () => adapter.isAvailable(),
    async execute({ action, permit, resolvedValue }) {
      const target =
        action.kind === "click" || action.kind === "type"
          ? registry.resolve(action.targetId)
          : undefined;
      if ((action.kind === "click" || action.kind === "type") && target === undefined) {
        return {
          ok: false,
          code: "target_stale",
          summary: "Discovery target is no longer live.",
          recoverable: true,
        };
      }
      const before = await hooks.beforeExecute?.({
        action,
        permit,
        ...(resolvedValue === undefined ? {} : { resolvedValue }),
        ...(target === undefined ? {} : { targetRisk: target.risk }),
      });
      if (before !== undefined) return before;
      let executed: DiscoveryRehearsalDriverResult;
      try {
        await adapter.executeAction({
          action,
          ...(target === undefined ? {} : { identityKey: target.identityKey }),
          ...(resolvedValue === undefined ? {} : { resolvedValue }),
        });
        executed = {
          ok: true,
          code: "action_completed",
          summary: "Discovery action completed.",
        };
      } catch {
        const available = await adapter.isAvailable().catch(() => false);
        executed = {
          ok: false,
          code: available ? "action_failed" : "browser_unavailable",
          summary: available ? "Discovery action failed." : "Discovery browser is unavailable.",
          recoverable: available,
        };
      }
      const after = await hooks.afterExecute?.();
      return after ?? executed;
    },
  };
  return { driver, registry };
}
