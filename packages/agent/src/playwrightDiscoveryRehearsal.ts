import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
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
} from "./discoveryRehearsal.js";
import { createDiscoveryTargetRegistry } from "./discoveryTargetRegistry.js";
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

export function createPlaywrightDiscoveryRehearsalController<TPermit>(
  page: Page,
  options: PlaywrightDiscoveryRehearsalOptions<TPermit>,
) {
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
    async execute({ action, resolvedValue }) {
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
      try {
        await adapter.executeAction({
          action,
          ...(target === undefined ? {} : { identityKey: target.identityKey }),
          ...(resolvedValue === undefined ? {} : { resolvedValue }),
        });
        return {
          ok: true,
          code: "action_completed",
          summary: "Discovery action completed.",
        };
      } catch {
        const available = await adapter.isAvailable().catch(() => false);
        return {
          ok: false,
          code: available ? "action_failed" : "browser_unavailable",
          summary: available ? "Discovery action failed." : "Discovery browser is unavailable.",
          recoverable: available,
        };
      }
    },
  };
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
