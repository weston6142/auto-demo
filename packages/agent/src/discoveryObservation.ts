import { createHash, randomUUID } from "node:crypto";
import { DISCOVERY_LIMITS } from "./discoveryContract.js";
import type { RecordDiscoveryObservationInput } from "./discoverySession.js";
import {
  createDiscoveryTargetRegistry,
  type DiscoveryTargetRegistry,
} from "./discoveryTargetRegistry.js";
import { buildDiscoveryObservation, diagnostic } from "./discoveryObservationTransform.js";
import { isSafeArtifactPath, sanitizeObservationInput } from "./discoveryValidation.js";

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
  sensitivePayment?: boolean;
  upload?: boolean;
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
  omittedVisibleStates?: number;
  omittedInteractiveTargets?: number;
  truncatedContent?: number;
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
  const idGenerator =
    dependencies.idGenerator ?? ((kind: DiscoveryObservationIdKind) => `${kind}-${randomUUID()}`);
  return createDiscoveryObservationExtractorWithRegistry(
    dependencies,
    createDiscoveryTargetRegistry(() => idGenerator("target")),
  );
}

export function createDiscoveryObservationExtractorWithRegistry(
  dependencies: DiscoveryObservationExtractorDependencies,
  registry: DiscoveryTargetRegistry,
): DiscoveryObservationExtractor {
  const clock = dependencies.clock ?? (() => new Date().toISOString());
  const idGenerator =
    dependencies.idGenerator ?? ((kind: DiscoveryObservationIdKind) => `${kind}-${randomUUID()}`);

  return {
    async observe() {
      let available: boolean;
      try {
        available = await dependencies.page.isAvailable();
      } catch {
        available = false;
      }
      if (!available) {
        return error("browser_unavailable", "Discovery observation browser is unavailable.");
      }
      let retried = false;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const beforeToken = await dependencies.page.readDocumentToken();
          const snapshot = await dependencies.page.collectSnapshot();
          let screenshotBytes: Uint8Array | undefined;
          let screenshotFailed = false;
          if (dependencies.artifactSink !== undefined) {
            try {
              screenshotBytes = await dependencies.page.captureViewportPng();
            } catch {
              screenshotFailed = true;
            }
          }
          const afterToken = await dependencies.page.readDocumentToken();
          if (beforeToken !== snapshot.documentToken || snapshot.documentToken !== afterToken) {
            retried = true;
            continue;
          }
          registry.resetDocument(snapshot.documentToken);
          const built = buildDiscoveryObservation({
            snapshot,
            observedAt: clock(),
            idGenerator,
            targetId: (candidate) =>
              registry.targetId(candidate.identityKey, {
                credential: candidate.credential,
                sensitivePayment: candidate.sensitivePayment ?? false,
                upload: candidate.upload ?? false,
              }),
          });
          if (!built.ok) return built;
          if (Array.isArray(sanitizeObservationInput(built.observation, 1))) {
            return error("invalid_page_state", "Discovery page state is invalid.", "observation");
          }
          const screenshotDiagnostics: DiscoveryObservationDiagnostic[] = [];
          if (screenshotFailed) {
            screenshotDiagnostics.push(diagnostic("screenshot_unavailable", 1));
          }
          if (screenshotBytes !== undefined && dependencies.artifactSink !== undefined) {
            const artifactId = idGenerator("artifact");
            const sha256 = createHash("sha256").update(screenshotBytes).digest("hex");
            const artifact = {
              id: artifactId,
              kind: "screenshot" as const,
              path: "artifacts/pending.png",
              mediaType: "image/png" as const,
              sha256,
            };
            if (
              Array.isArray(
                sanitizeObservationInput(
                  { ...built.observation, artifacts: [...built.observation.artifacts, artifact] },
                  1,
                ),
              )
            ) {
              return error("invalid_page_state", "Discovery page state is invalid.", "observation");
            }
            try {
              const stored = await dependencies.artifactSink.write({
                id: artifactId,
                bytes: screenshotBytes,
                mediaType: "image/png",
                sha256,
              });
              if (
                !isSafeArtifactPath(stored.path) ||
                stored.path.length > DISCOVERY_LIMITS.publicStringCharacters
              ) {
                screenshotDiagnostics.push(diagnostic("screenshot_unavailable", 1));
              } else {
                built.observation.artifacts.push({
                  ...artifact,
                  path: stored.path,
                });
              }
            } catch {
              screenshotDiagnostics.push(diagnostic("screenshot_unavailable", 1));
            }
          }
          if (Array.isArray(sanitizeObservationInput(built.observation, 1))) {
            return error("invalid_page_state", "Discovery page state is invalid.", "observation");
          }
          return {
            ...built,
            diagnostics: [
              ...(retried ? [diagnostic("unstable_page_retried", 1)] : []),
              ...built.diagnostics,
              ...screenshotDiagnostics,
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
    async hasLiveTarget(candidateTargetId) {
      const target = registry.resolve(candidateTargetId);
      if (target === undefined) return false;
      try {
        if (!(await dependencies.page.isAvailable())) return false;
        const currentToken = await dependencies.page.readDocumentToken();
        if (currentToken !== target.documentToken) {
          registry.resetDocument(currentToken);
          return false;
        }
        const live = await dependencies.page.hasLiveIdentity(
          target.identityKey,
          target.documentToken,
        );
        if (!live) registry.remove(candidateTargetId);
        return live;
      } catch {
        return false;
      }
    },
  };
}
