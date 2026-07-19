import type { BrowserLaunchProfileV1 } from "@auto-demo/browser-profile";

export const DISCOVERY_SCHEMA_VERSION = 1 as const;

export const DISCOVERY_LIMITS = {
  observations: 256,
  attempts: 256,
  selectedPathAttempts: 128,
  interactiveTargetsPerObservation: 100,
  formOptionsPerTarget: 50,
  visibleStatesPerObservation: 50,
  artifactReferencesPerObservation: 8,
  identifierCharacters: 128,
  publicStringCharacters: 2_000,
  waitDurationMs: 30_000,
  serializedBytes: 5 * 1024 * 1024,
  terminalReserveBytes: 64 * 1024,
} as const;

export type DiscoverySessionStatus = "active" | "completed" | "failed" | "abandoned";
export type DiscoveryAttemptStatus = "pending" | "succeeded" | "failed" | "blocked";
export type DiscoveryConfidenceLevel = "high" | "medium" | "low";
export type DiscoveryConfidenceBasis =
  | "exact-accessible-target"
  | "expected-navigation-observed"
  | "expected-visible-state-observed"
  | "positional-intent"
  | "host-inference";

export type DiscoveryHostProvenance = {
  name: string;
  version: string;
  model?: string;
};

export type DiscoveryArtifactReference = {
  id: string;
  kind: "screenshot" | "viewport";
  path: string;
  mediaType: "image/png" | "image/jpeg";
  sha256?: string;
};

export type DiscoveryVisibleState = {
  id: string;
  kind: "text" | "status";
  summary: string;
};

export type DiscoveryInteractiveTarget = {
  id: string;
  label: string;
  role?: string;
  occurrence?: number;
  disabled: boolean;
  actionRisk?: "potentially-mutating";
  form?: DiscoveryFormState;
};

export type DiscoveryFormOption = {
  label: string;
  disabled: boolean;
  selected: boolean;
};

export type DiscoveryFormState = {
  required: boolean;
  hasValue: boolean;
  validity: "valid" | "invalid" | "unknown";
  checked?: boolean;
  selectedOption?: string;
  options?: DiscoveryFormOption[];
};

export type DiscoveryObservation = {
  id: string;
  sequence: number;
  observedAt: string;
  page: {
    url: string;
    title: string;
    viewport: { width: number; height: number };
    navigation: { canGoBack: boolean };
  };
  visibleStates: DiscoveryVisibleState[];
  interactiveTargets: DiscoveryInteractiveTarget[];
  artifacts: DiscoveryArtifactReference[];
};

export type DiscoveryAction =
  | { kind: "navigate"; url: string }
  | { kind: "click"; targetId: string }
  | {
      kind: "type";
      targetId: string;
      inputBinding: string;
      valueClass: "demo-data";
    }
  | { kind: "wait"; durationMs: number }
  | { kind: "inspect" }
  | { kind: "back" }
  | { kind: "refresh" };

export type DiscoveryExpectationOrigin = "declared-before-action" | "derived-from-observation";

export type DiscoveryExpectation =
  | {
      id: string;
      kind: "navigation";
      origin: DiscoveryExpectationOrigin;
      url: string;
      match: "exact-url" | "same-origin-path";
    }
  | {
      id: string;
      kind: "visible-state";
      origin: DiscoveryExpectationOrigin;
      targetId?: string;
      publicCondition?: string;
      role?: string;
    };

export type DiscoveryObservedEffect = {
  expectationId: string;
  status: "matched" | "not-matched";
  observationId: string;
  summary: string;
};

export type DiscoveryConfidence = {
  level: DiscoveryConfidenceLevel;
  bases: DiscoveryConfidenceBasis[];
  note?: string;
};

export type DiscoveryAttemptBase = {
  id: string;
  sequence: number;
  startedAt: string;
  beforeObservationId: string;
  action: DiscoveryAction;
  expectations: DiscoveryExpectation[];
  confidence: DiscoveryConfidence;
  retryOfAttemptId?: string;
};

export type PendingDiscoveryAttempt = DiscoveryAttemptBase & {
  status: "pending";
};

export type FinalizedDiscoveryAttempt = DiscoveryAttemptBase & {
  status: "succeeded" | "failed" | "blocked";
  finishedAt: string;
  derivedExpectations: DiscoveryExpectation[];
  observedEffects: DiscoveryObservedEffect[];
  afterObservationId?: string;
  outcome: { code: string; summary: string };
};

export type DiscoveryAttempt = PendingDiscoveryAttempt | FinalizedDiscoveryAttempt;

export type DiscoverySelectedPath = {
  attemptIds: string[];
  selectedAt: string;
  source: "host-agent" | "user-directed";
};

export type DiscoveryTerminal =
  | { status: "completed"; completedAt: string }
  | { status: "failed"; failedAt: string; reason: { code: string; summary: string } }
  | { status: "abandoned"; abandonedAt: string; reason: { code: string; summary: string } };

export type DiscoverySessionV1 = {
  schemaVersion: 1;
  id: string;
  status: DiscoverySessionStatus;
  target: { kind: "browser"; startUrl: string };
  goal: string;
  host: DiscoveryHostProvenance;
  launchProfile?: BrowserLaunchProfileV1;
  parentSessionId?: string;
  createdAt: string;
  updatedAt: string;
  observations: DiscoveryObservation[];
  attempts: DiscoveryAttempt[];
  selectedPath?: DiscoverySelectedPath;
  terminal?: DiscoveryTerminal;
};

export type DiscoveryContractErrorCode =
  | "invalid_discovery_session"
  | "invalid_discovery_input"
  | "unsupported_discovery_schema"
  | "invalid_discovery_transition"
  | "terminal_discovery_session"
  | "session_limit_exceeded"
  | "duplicate_discovery_record"
  | "missing_discovery_reference"
  | "inconsistent_discovery_reference"
  | "pending_attempt_conflict"
  | "pending_attempt_required"
  | "invalid_selected_path"
  | "expectation_evidence_missing"
  | "unsafe_discovery_url"
  | "unsafe_discovery_content"
  | "invalid_discovery_artifact_reference";

export type DiscoveryContractError = {
  code: DiscoveryContractErrorCode;
  message: string;
  path?: string;
  recordId?: string;
};

export type DiscoveryContractResult =
  { ok: true; session: DiscoverySessionV1 } | { ok: false; errors: DiscoveryContractError[] };
