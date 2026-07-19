import { Buffer } from "node:buffer";
import { isDeepStrictEqual } from "node:util";
import { validateBrowserLaunchProfile } from "@auto-demo/browser-profile";
import {
  DISCOVERY_LIMITS,
  type DiscoveryAction,
  type DiscoveryConfidence,
  type DiscoveryContractError,
  type DiscoveryContractResult,
  type DiscoveryExpectation,
  type DiscoveryObservedEffect,
  type DiscoveryObservation,
  type DiscoverySelectedPath,
  type DiscoveryAttempt,
  type FinalizedDiscoveryAttempt,
  type PendingDiscoveryAttempt,
  type DiscoverySessionV1,
} from "./discoveryContract.js";
import type {
  BeginDiscoveryAttemptInput,
  FinishDiscoveryAttemptInput,
  RecordDiscoveryObservationInput,
} from "./discoverySession.js";
import { sanitizeWalkthroughText, sanitizeWalkthroughUrl } from "./walkthroughValidation.js";

const IDENTIFIER = /^[a-z0-9][a-z0-9_-]*$/i;
const CREDENTIAL_KEY =
  /(^|[-_.])(auth|authorization|token|api[-_]?key|key|secret|password|passcode|credential|signature|sig|code)($|[-_.])/i;
const SESSION_KEYS = [
  "schemaVersion",
  "id",
  "status",
  "target",
  "goal",
  "host",
  "launchProfile",
  "parentSessionId",
  "createdAt",
  "updatedAt",
  "observations",
  "attempts",
  "selectedPath",
  "terminal",
] as const;

export function discoveryError(
  code: DiscoveryContractError["code"],
  message: string,
  options: Pick<DiscoveryContractError, "path" | "recordId"> = {},
): DiscoveryContractError {
  return { code, message, ...options };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

export function isSafeDiscoveryId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= DISCOVERY_LIMITS.identifierCharacters &&
    IDENTIFIER.test(value)
  );
}

export function isNormalizedIsoTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

export function sanitizeDiscoveryText(value: string): string {
  return sanitizeWalkthroughText(value);
}

export function isBoundedDiscoveryText(value: unknown): value is string {
  return typeof value === "string" && value.length <= DISCOVERY_LIMITS.publicStringCharacters;
}

function hasCredentialLikeUrlData(url: URL): boolean {
  const parameterSets = [url.searchParams];
  if (url.hash.includes("=")) parameterSets.push(new URLSearchParams(url.hash.slice(1)));
  return parameterSets.some((parameters) =>
    Array.from(parameters).some(
      ([key, value]) =>
        CREDENTIAL_KEY.test(key) || sanitizeWalkthroughText(value).includes("[redacted-secret]"),
    ),
  );
}

export function sanitizeDiscoveryUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (
      !/^https?:$/.test(parsed.protocol) ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      hasCredentialLikeUrlData(parsed)
    ) {
      return undefined;
    }
    const sanitized = sanitizeWalkthroughUrl(value);
    return sanitized === "[redacted-url]" ? undefined : sanitized;
  } catch {
    return undefined;
  }
}

export function serializedDiscoveryBytes(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined
      ? Number.POSITIVE_INFINITY
      : Buffer.byteLength(serialized, "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function sanitizeRequiredPublicText(
  value: unknown,
  path: string,
  errors: DiscoveryContractError[],
): string | undefined {
  if (typeof value !== "string") {
    errors.push(discoveryError("invalid_discovery_input", "Discovery text is required.", { path }));
    return undefined;
  }
  if (value.length > DISCOVERY_LIMITS.publicStringCharacters) {
    errors.push(discoveryError("session_limit_exceeded", "Discovery text is too long.", { path }));
    return undefined;
  }
  const sanitized = sanitizeDiscoveryText(value);
  if (sanitized.length === 0) {
    errors.push(discoveryError("invalid_discovery_input", "Discovery text is empty.", { path }));
    return undefined;
  }
  return sanitized;
}

export function isSafeArtifactPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\")) return false;
  if (value.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function invalidUnknownFields(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): DiscoveryContractError[] {
  return Object.keys(value)
    .filter((key) => !keys.includes(key))
    .map(() =>
      discoveryError("unsafe_discovery_content", "Unknown discovery field.", {
        path: path.length === 0 ? "unknown" : path,
      }),
    );
}

export function sanitizeObservationInput(
  input: RecordDiscoveryObservationInput,
  sequence: number,
): DiscoveryObservation | DiscoveryContractError[] {
  if (
    !isRecord(input) ||
    !isRecord(input.page) ||
    !isRecord(input.page.viewport) ||
    !isRecord(input.page.navigation) ||
    !Array.isArray(input.visibleStates) ||
    !Array.isArray(input.interactiveTargets) ||
    !Array.isArray(input.artifacts)
  ) {
    return [discoveryError("invalid_discovery_input", "Observation input is invalid.")];
  }

  const errors = [
    ...invalidUnknownFields(
      input,
      ["id", "observedAt", "page", "visibleStates", "interactiveTargets", "artifacts"],
      "",
    ),
    ...invalidUnknownFields(input.page, ["url", "title", "viewport", "navigation"], "page"),
    ...invalidUnknownFields(input.page.viewport, ["width", "height"], "page.viewport"),
    ...invalidUnknownFields(input.page.navigation, ["canGoBack"], "page.navigation"),
  ];

  if (!isSafeDiscoveryId(input.id)) {
    errors.push(
      discoveryError("invalid_discovery_input", "Observation id is invalid.", { path: "id" }),
    );
  }
  if (!isNormalizedIsoTime(input.observedAt)) {
    errors.push(
      discoveryError("invalid_discovery_input", "Observation time is invalid.", {
        path: "observedAt",
      }),
    );
  }
  const url = typeof input.page.url === "string" ? sanitizeDiscoveryUrl(input.page.url) : undefined;
  if (
    typeof input.page.url === "string" &&
    input.page.url.length > DISCOVERY_LIMITS.publicStringCharacters
  ) {
    errors.push(
      discoveryError("session_limit_exceeded", "Observation URL is too long.", {
        path: "page.url",
      }),
    );
  }
  if (url === undefined) {
    errors.push(
      discoveryError("unsafe_discovery_url", "Observation URL is unsafe.", {
        path: "page.url",
      }),
    );
  }
  const title = sanitizeRequiredPublicText(input.page.title, "page.title", errors);
  if (
    !Number.isInteger(input.page.viewport.width) ||
    Number(input.page.viewport.width) <= 0 ||
    !Number.isInteger(input.page.viewport.height) ||
    Number(input.page.viewport.height) <= 0 ||
    typeof input.page.navigation.canGoBack !== "boolean"
  ) {
    errors.push(
      discoveryError("invalid_discovery_input", "Observation page state is invalid.", {
        path: "page",
      }),
    );
  }

  const collections: Array<[unknown[], number, string]> = [
    [input.visibleStates, DISCOVERY_LIMITS.visibleStatesPerObservation, "visibleStates"],
    [
      input.interactiveTargets,
      DISCOVERY_LIMITS.interactiveTargetsPerObservation,
      "interactiveTargets",
    ],
    [input.artifacts, DISCOVERY_LIMITS.artifactReferencesPerObservation, "artifacts"],
  ];
  for (const [values, maximum, path] of collections) {
    if (values.length > maximum) {
      errors.push(
        discoveryError("session_limit_exceeded", "Observation collection limit exceeded.", {
          path,
        }),
      );
    }
  }

  const nestedIds = new Set<string>();
  const visibleStates = input.visibleStates.flatMap((value, index) => {
    const path = `visibleStates.${index}`;
    if (!isRecord(value)) {
      errors.push(discoveryError("invalid_discovery_input", "Visible state is invalid.", { path }));
      return [];
    }
    errors.push(...invalidUnknownFields(value, ["id", "kind", "summary"], path));
    const summary = sanitizeRequiredPublicText(value.summary, `${path}.summary`, errors);
    if (
      !isSafeDiscoveryId(value.id) ||
      nestedIds.has(value.id) ||
      (value.kind !== "text" && value.kind !== "status")
    ) {
      errors.push(discoveryError("invalid_discovery_input", "Visible state is invalid.", { path }));
      return [];
    }
    nestedIds.add(value.id);
    return summary === undefined ? [] : [{ id: value.id, kind: value.kind, summary }];
  });

  const interactiveTargets = input.interactiveTargets.flatMap((value, index) => {
    const path = `interactiveTargets.${index}`;
    if (!isRecord(value)) {
      errors.push(
        discoveryError("invalid_discovery_input", "Interactive target is invalid.", { path }),
      );
      return [];
    }
    errors.push(
      ...invalidUnknownFields(
        value,
        ["id", "label", "role", "occurrence", "disabled", "actionRisk"],
        path,
      ),
    );
    const label = sanitizeRequiredPublicText(value.label, `${path}.label`, errors);
    const role =
      value.role === undefined
        ? undefined
        : sanitizeRequiredPublicText(value.role, `${path}.role`, errors);
    if (
      !isSafeDiscoveryId(value.id) ||
      nestedIds.has(value.id) ||
      typeof value.disabled !== "boolean" ||
      (value.occurrence !== undefined &&
        (!Number.isInteger(value.occurrence) || Number(value.occurrence) < 1)) ||
      (value.actionRisk !== undefined && value.actionRisk !== "potentially-mutating")
    ) {
      errors.push(
        discoveryError("invalid_discovery_input", "Interactive target is invalid.", { path }),
      );
      return [];
    }
    nestedIds.add(value.id);
    if (label === undefined || (value.role !== undefined && role === undefined)) return [];
    return [
      {
        id: value.id,
        label,
        ...(role === undefined ? {} : { role }),
        ...(value.occurrence === undefined ? {} : { occurrence: Number(value.occurrence) }),
        disabled: value.disabled,
        ...(value.actionRisk === undefined ? {} : { actionRisk: value.actionRisk }),
      },
    ];
  });

  const artifacts = input.artifacts.flatMap((value, index) => {
    const path = `artifacts.${index}`;
    if (!isRecord(value)) {
      errors.push(
        discoveryError("invalid_discovery_artifact_reference", "Artifact reference is invalid.", {
          path,
        }),
      );
      return [];
    }
    errors.push(
      ...invalidUnknownFields(value, ["id", "kind", "path", "mediaType", "sha256"], path),
    );
    if (
      typeof value.path === "string" &&
      value.path.length > DISCOVERY_LIMITS.publicStringCharacters
    ) {
      errors.push(
        discoveryError("session_limit_exceeded", "Artifact path is too long.", {
          path: `${path}.path`,
        }),
      );
    }
    if (
      !isSafeDiscoveryId(value.id) ||
      nestedIds.has(value.id) ||
      (value.kind !== "screenshot" && value.kind !== "viewport") ||
      !isSafeArtifactPath(value.path) ||
      (value.mediaType !== "image/png" && value.mediaType !== "image/jpeg") ||
      (value.sha256 !== undefined &&
        (typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)))
    ) {
      errors.push(
        discoveryError("invalid_discovery_artifact_reference", "Artifact reference is invalid.", {
          path,
        }),
      );
      return [];
    }
    nestedIds.add(value.id);
    return [
      {
        id: value.id,
        kind: value.kind,
        path: value.path,
        mediaType: value.mediaType,
        ...(value.sha256 === undefined ? {} : { sha256: value.sha256 }),
      },
    ];
  });

  if (errors.length > 0 || url === undefined || title === undefined) return errors;
  return {
    id: input.id,
    sequence,
    observedAt: input.observedAt,
    page: {
      url,
      title,
      viewport: {
        width: Number(input.page.viewport.width),
        height: Number(input.page.viewport.height),
      },
      navigation: { canGoBack: input.page.navigation.canGoBack as boolean },
    },
    visibleStates,
    interactiveTargets,
    artifacts,
  };
}

function isObservation(value: unknown, sequence: number): value is DiscoveryObservation {
  if (!isRecord(value) || value.sequence !== sequence) return false;
  const input = { ...value };
  delete input.sequence;
  const sanitized = sanitizeObservationInput(input as RecordDiscoveryObservationInput, sequence);
  return !Array.isArray(sanitized) && isDeepStrictEqual(sanitized, value);
}

const CONFIDENCE_BASES = new Set([
  "exact-accessible-target",
  "expected-navigation-observed",
  "expected-visible-state-observed",
  "positional-intent",
  "host-inference",
]);

function sanitizeAction(
  value: unknown,
  before: DiscoveryObservation,
  errors: DiscoveryContractError[],
): DiscoveryAction | undefined {
  if (!isRecord(value) || typeof value.kind !== "string") {
    errors.push(
      discoveryError("invalid_discovery_input", "Discovery action is invalid.", { path: "action" }),
    );
    return undefined;
  }
  const targetExists = (targetId: unknown) =>
    isSafeDiscoveryId(targetId) &&
    before.interactiveTargets.some((target) => target.id === targetId);
  if (value.kind === "navigate") {
    errors.push(...invalidUnknownFields(value, ["kind", "url"], "action"));
    if (
      typeof value.url === "string" &&
      value.url.length > DISCOVERY_LIMITS.publicStringCharacters
    ) {
      errors.push(
        discoveryError("session_limit_exceeded", "Navigation URL is too long.", {
          path: "action.url",
        }),
      );
    }
    const url = typeof value.url === "string" ? sanitizeDiscoveryUrl(value.url) : undefined;
    if (url === undefined) {
      errors.push(
        discoveryError("unsafe_discovery_url", "Navigation URL is unsafe.", { path: "action.url" }),
      );
      return undefined;
    }
    return { kind: "navigate", url };
  }
  if (value.kind === "click") {
    errors.push(...invalidUnknownFields(value, ["kind", "targetId"], "action"));
    if (!targetExists(value.targetId)) {
      errors.push(
        discoveryError("missing_discovery_reference", "Action target is missing.", {
          path: "action.targetId",
        }),
      );
      return undefined;
    }
    return { kind: "click", targetId: value.targetId as string };
  }
  if (value.kind === "type") {
    errors.push(
      ...invalidUnknownFields(value, ["kind", "targetId", "inputBinding", "valueClass"], "action"),
    );
    if (
      !targetExists(value.targetId) ||
      !isSafeDiscoveryId(value.inputBinding) ||
      value.valueClass !== "demo-data"
    ) {
      errors.push(
        discoveryError("invalid_discovery_input", "Type action is invalid.", { path: "action" }),
      );
      return undefined;
    }
    return {
      kind: "type",
      targetId: value.targetId as string,
      inputBinding: value.inputBinding,
      valueClass: "demo-data",
    };
  }
  if (value.kind === "wait") {
    errors.push(...invalidUnknownFields(value, ["kind", "durationMs"], "action"));
    if (
      !Number.isInteger(value.durationMs) ||
      Number(value.durationMs) < 0 ||
      Number(value.durationMs) > DISCOVERY_LIMITS.waitDurationMs
    ) {
      errors.push(
        discoveryError("session_limit_exceeded", "Wait duration is invalid.", {
          path: "action.durationMs",
        }),
      );
      return undefined;
    }
    return { kind: "wait", durationMs: Number(value.durationMs) };
  }
  if (value.kind === "inspect" || value.kind === "back" || value.kind === "refresh") {
    errors.push(...invalidUnknownFields(value, ["kind"], "action"));
    return { kind: value.kind };
  }
  errors.push(
    discoveryError("invalid_discovery_input", "Discovery action kind is invalid.", {
      path: "action.kind",
    }),
  );
  return undefined;
}

function sanitizeExpectation(
  value: unknown,
  expectedOrigin: "declared-before-action" | "derived-from-observation",
  path: string,
  errors: DiscoveryContractError[],
): DiscoveryExpectation | undefined {
  if (!isRecord(value) || !isSafeDiscoveryId(value.id) || value.origin !== expectedOrigin) {
    errors.push(
      discoveryError("invalid_discovery_input", "Discovery expectation is invalid.", { path }),
    );
    return undefined;
  }
  if (value.kind === "navigation") {
    errors.push(...invalidUnknownFields(value, ["id", "kind", "origin", "url", "match"], path));
    if (
      typeof value.url === "string" &&
      value.url.length > DISCOVERY_LIMITS.publicStringCharacters
    ) {
      errors.push(
        discoveryError("session_limit_exceeded", "Expectation URL is too long.", {
          path: `${path}.url`,
        }),
      );
    }
    const url = typeof value.url === "string" ? sanitizeDiscoveryUrl(value.url) : undefined;
    if (url === undefined || (value.match !== "exact-url" && value.match !== "same-origin-path")) {
      errors.push(
        discoveryError("invalid_discovery_input", "Navigation expectation is invalid.", { path }),
      );
      return undefined;
    }
    return { id: value.id, kind: "navigation", origin: expectedOrigin, url, match: value.match };
  }
  if (value.kind === "visible-state") {
    errors.push(
      ...invalidUnknownFields(
        value,
        ["id", "kind", "origin", "targetId", "publicCondition", "role"],
        path,
      ),
    );
    const hasTarget = value.targetId !== undefined;
    const hasCondition = value.publicCondition !== undefined;
    if (hasTarget === hasCondition || (hasTarget && !isSafeDiscoveryId(value.targetId))) {
      errors.push(
        discoveryError("invalid_discovery_input", "Visible-state expectation is invalid.", {
          path,
        }),
      );
      return undefined;
    }
    const publicCondition =
      typeof value.publicCondition === "string"
        ? sanitizeRequiredPublicText(value.publicCondition, `${path}.publicCondition`, errors)
        : undefined;
    const role =
      typeof value.role === "string"
        ? sanitizeRequiredPublicText(value.role, `${path}.role`, errors)
        : value.role === undefined
          ? undefined
          : (errors.push(
              discoveryError("invalid_discovery_input", "Expectation role is invalid.", {
                path: `${path}.role`,
              }),
            ),
            undefined);
    if (
      (hasCondition && publicCondition === undefined) ||
      (value.role !== undefined && role === undefined)
    )
      return undefined;
    return {
      id: value.id,
      kind: "visible-state",
      origin: expectedOrigin,
      ...(hasTarget ? { targetId: value.targetId as string } : { publicCondition }),
      ...(role === undefined ? {} : { role }),
    };
  }
  errors.push(
    discoveryError("invalid_discovery_input", "Discovery expectation kind is invalid.", { path }),
  );
  return undefined;
}

function sanitizeExpectations(
  values: unknown,
  origin: "declared-before-action" | "derived-from-observation",
  path: string,
  errors: DiscoveryContractError[],
): DiscoveryExpectation[] {
  if (!Array.isArray(values)) {
    errors.push(
      discoveryError("invalid_discovery_input", "Expectations must be an array.", { path }),
    );
    return [];
  }
  const result = values.flatMap((value, index) => {
    const expectation = sanitizeExpectation(value, origin, `${path}.${index}`, errors);
    return expectation === undefined ? [] : [expectation];
  });
  if (new Set(result.map((value) => value.id)).size !== result.length) {
    errors.push(
      discoveryError("duplicate_discovery_record", "Expectation id is duplicated.", { path }),
    );
  }
  return result;
}

function sanitizeConfidence(
  value: unknown,
  errors: DiscoveryContractError[],
): DiscoveryConfidence | undefined {
  if (!isRecord(value)) {
    errors.push(
      discoveryError("invalid_discovery_input", "Discovery confidence is invalid.", {
        path: "confidence",
      }),
    );
    return undefined;
  }
  errors.push(...invalidUnknownFields(value, ["level", "bases", "note"], "confidence"));
  if (
    (value.level !== "high" && value.level !== "medium" && value.level !== "low") ||
    !Array.isArray(value.bases) ||
    value.bases.length === 0 ||
    value.bases.some((basis) => typeof basis !== "string" || !CONFIDENCE_BASES.has(basis)) ||
    new Set(value.bases).size !== value.bases.length
  ) {
    errors.push(
      discoveryError("invalid_discovery_input", "Discovery confidence is invalid.", {
        path: "confidence",
      }),
    );
    return undefined;
  }
  const note =
    value.note === undefined
      ? undefined
      : sanitizeRequiredPublicText(value.note, "confidence.note", errors);
  if (value.note !== undefined && note === undefined) return undefined;
  return {
    level: value.level,
    bases: value.bases as DiscoveryConfidence["bases"],
    ...(note === undefined ? {} : { note }),
  };
}

export function sanitizeAttemptInput(
  session: DiscoverySessionV1,
  input: BeginDiscoveryAttemptInput,
  sequence: number,
): PendingDiscoveryAttempt | DiscoveryContractError[] {
  if (!isRecord(input)) {
    return [discoveryError("invalid_discovery_input", "Attempt input is invalid.")];
  }
  const errors = invalidUnknownFields(
    input,
    [
      "id",
      "startedAt",
      "beforeObservationId",
      "action",
      "expectations",
      "confidence",
      "retryOfAttemptId",
    ],
    "",
  );
  const before = session.observations.find((value) => value.id === input.beforeObservationId);
  if (!isSafeDiscoveryId(input.id) || !isNormalizedIsoTime(input.startedAt)) {
    errors.push(discoveryError("invalid_discovery_input", "Attempt identity is invalid."));
  }
  if (before === undefined) {
    errors.push(
      discoveryError("missing_discovery_reference", "Attempt observation is missing.", {
        path: "beforeObservationId",
      }),
    );
  }
  if (input.retryOfAttemptId !== undefined) {
    const retry = session.attempts.find((value) => value.id === input.retryOfAttemptId);
    if (retry === undefined || retry.status === "pending") {
      errors.push(
        discoveryError("missing_discovery_reference", "Retry attempt is missing.", {
          path: "retryOfAttemptId",
        }),
      );
    }
  }
  const action = before === undefined ? undefined : sanitizeAction(input.action, before, errors);
  const expectations = sanitizeExpectations(
    input.expectations,
    "declared-before-action",
    "expectations",
    errors,
  );
  const confidence = sanitizeConfidence(input.confidence, errors);
  if (errors.length > 0 || action === undefined || confidence === undefined) return errors;
  return {
    id: input.id,
    sequence,
    status: "pending",
    startedAt: input.startedAt,
    beforeObservationId: input.beforeObservationId,
    action,
    expectations,
    confidence,
    ...(input.retryOfAttemptId === undefined ? {} : { retryOfAttemptId: input.retryOfAttemptId }),
  };
}

function sanitizeObservedEffects(
  values: unknown,
  expectations: DiscoveryExpectation[],
  afterObservationId: string | undefined,
  errors: DiscoveryContractError[],
): DiscoveryObservedEffect[] {
  if (!Array.isArray(values)) {
    errors.push(
      discoveryError("invalid_discovery_input", "Observed effects must be an array.", {
        path: "observedEffects",
      }),
    );
    return [];
  }
  const expectationIds = new Set(expectations.map((value) => value.id));
  const seen = new Set<string>();
  return values.flatMap((value, index) => {
    const path = `observedEffects.${index}`;
    if (!isRecord(value)) {
      errors.push(
        discoveryError("invalid_discovery_input", "Observed effect is invalid.", { path }),
      );
      return [];
    }
    errors.push(
      ...invalidUnknownFields(value, ["expectationId", "status", "observationId", "summary"], path),
    );
    const summary = sanitizeRequiredPublicText(value.summary, `${path}.summary`, errors);
    if (
      !isSafeDiscoveryId(value.expectationId) ||
      !expectationIds.has(value.expectationId) ||
      seen.has(value.expectationId) ||
      (value.status !== "matched" && value.status !== "not-matched") ||
      value.observationId !== afterObservationId
    ) {
      errors.push(
        discoveryError("invalid_discovery_input", "Observed effect is invalid.", { path }),
      );
      return [];
    }
    seen.add(value.expectationId);
    return summary === undefined
      ? []
      : [
          {
            expectationId: value.expectationId,
            status: value.status,
            observationId: value.observationId as string,
            summary,
          },
        ];
  });
}

export function finalizeAttemptInput(
  session: DiscoverySessionV1,
  attempt: PendingDiscoveryAttempt,
  input: FinishDiscoveryAttemptInput,
): FinalizedDiscoveryAttempt | DiscoveryContractError[] {
  if (!isRecord(input)) {
    return [discoveryError("invalid_discovery_input", "Attempt outcome is invalid.")];
  }
  const errors = invalidUnknownFields(
    input,
    [
      "status",
      "finishedAt",
      "derivedExpectations",
      "observedEffects",
      "afterObservationId",
      "outcome",
    ],
    "",
  );
  if (
    (input.status !== "succeeded" && input.status !== "failed" && input.status !== "blocked") ||
    !isNormalizedIsoTime(input.finishedAt) ||
    input.finishedAt < attempt.startedAt
  ) {
    errors.push(discoveryError("invalid_discovery_input", "Attempt outcome status is invalid."));
  }
  const after =
    typeof input.afterObservationId === "string"
      ? session.observations.find((value) => value.id === input.afterObservationId)
      : undefined;
  const before = session.observations.find((value) => value.id === attempt.beforeObservationId);
  if (input.status === "succeeded" && after === undefined) {
    errors.push(
      discoveryError("missing_discovery_reference", "Successful attempt requires an observation.", {
        path: "afterObservationId",
      }),
    );
  } else if (input.afterObservationId !== undefined && after === undefined) {
    errors.push(
      discoveryError("missing_discovery_reference", "Attempt observation is missing.", {
        path: "afterObservationId",
      }),
    );
  }
  if (
    after !== undefined &&
    before !== undefined &&
    (after.sequence <= before.sequence ||
      after.observedAt < attempt.startedAt ||
      (typeof input.finishedAt === "string" && after.observedAt > input.finishedAt))
  ) {
    errors.push(
      discoveryError(
        "inconsistent_discovery_reference",
        "Attempt observations are not chronological.",
        { path: "afterObservationId", recordId: attempt.id },
      ),
    );
  }
  const derivedExpectations = sanitizeExpectations(
    input.derivedExpectations,
    "derived-from-observation",
    "derivedExpectations",
    errors,
  );
  const expectations = [...attempt.expectations, ...derivedExpectations];
  if (new Set(expectations.map((value) => value.id)).size !== expectations.length) {
    errors.push(discoveryError("duplicate_discovery_record", "Expectation id is duplicated."));
  }
  const observedEffects = sanitizeObservedEffects(
    input.observedEffects,
    expectations,
    typeof input.afterObservationId === "string" ? input.afterObservationId : undefined,
    errors,
  );
  if (input.status === "succeeded") {
    if (
      observedEffects.length !== expectations.length ||
      observedEffects.some((value) => value.status !== "matched")
    ) {
      errors.push(
        discoveryError(
          "expectation_evidence_missing",
          "Successful attempt requires matched evidence.",
        ),
      );
    }
  }
  if (!isRecord(input.outcome)) {
    errors.push(
      discoveryError("invalid_discovery_input", "Attempt outcome is invalid.", { path: "outcome" }),
    );
  }
  const outcomeCode = isRecord(input.outcome) ? input.outcome.code : undefined;
  const outcomeSummary = isRecord(input.outcome)
    ? sanitizeRequiredPublicText(input.outcome.summary, "outcome.summary", errors)
    : undefined;
  if (
    isRecord(input.outcome) &&
    (!hasOnlyKeys(input.outcome, ["code", "summary"]) || !isSafeDiscoveryId(outcomeCode))
  ) {
    errors.push(
      discoveryError("invalid_discovery_input", "Attempt outcome is invalid.", { path: "outcome" }),
    );
  }
  if (errors.length > 0 || outcomeSummary === undefined || !isSafeDiscoveryId(outcomeCode))
    return errors;
  return {
    ...structuredClone(attempt),
    status: input.status as FinalizedDiscoveryAttempt["status"],
    finishedAt: input.finishedAt as string,
    derivedExpectations,
    observedEffects,
    ...(after === undefined ? {} : { afterObservationId: after.id }),
    outcome: { code: outcomeCode, summary: outcomeSummary },
  };
}

function validateAttempts(session: DiscoverySessionV1): boolean {
  if (session.attempts.length > DISCOVERY_LIMITS.attempts) return false;
  const validated: DiscoveryAttempt[] = [];
  for (const [index, value] of session.attempts.entries()) {
    if (!isRecord(value) || value.sequence !== index + 1 || typeof value.status !== "string")
      return false;
    const partial = { ...session, attempts: validated };
    const pendingInput = {
      id: value.id,
      startedAt: value.startedAt,
      beforeObservationId: value.beforeObservationId,
      action: value.action,
      expectations: value.expectations,
      confidence: value.confidence,
      ...(value.retryOfAttemptId === undefined ? {} : { retryOfAttemptId: value.retryOfAttemptId }),
    } as BeginDiscoveryAttemptInput;
    const pending = sanitizeAttemptInput(partial, pendingInput, index + 1);
    if (Array.isArray(pending)) return false;
    if (value.status === "pending") {
      if (!isDeepStrictEqual(pending, value)) return false;
      validated.push(pending);
      continue;
    }
    const finalized = finalizeAttemptInput(partial, pending, {
      status: value.status,
      finishedAt: value.finishedAt,
      derivedExpectations: value.derivedExpectations,
      observedEffects: value.observedEffects,
      ...(value.afterObservationId === undefined
        ? {}
        : { afterObservationId: value.afterObservationId }),
      outcome: value.outcome,
    } as FinishDiscoveryAttemptInput);
    if (Array.isArray(finalized) || !isDeepStrictEqual(finalized, value)) return false;
    validated.push(finalized);
  }
  return validated.filter((attempt) => attempt.status === "pending").length <= 1;
}

function isNonEmptyBoundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function pathError(message: string, recordId?: string): DiscoveryContractError {
  return discoveryError("invalid_selected_path", message, { recordId });
}

export function matchesNavigationExpectation(
  expected: DiscoveryExpectation,
  actualUrl: string,
): boolean {
  if (expected.kind !== "navigation") return false;
  try {
    const expectedUrl = new URL(expected.url);
    const actual = new URL(actualUrl);
    if (expected.match === "exact-url") return expectedUrl.toString() === actual.toString();
    const effectivePort = (url: URL) =>
      url.port || (url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : "");
    return (
      expectedUrl.protocol === actual.protocol &&
      expectedUrl.hostname === actual.hostname &&
      effectivePort(expectedUrl) === effectivePort(actual) &&
      expectedUrl.pathname === actual.pathname
    );
  } catch {
    return false;
  }
}

export function validateSelectedPath(
  session: DiscoverySessionV1,
  selectedPath: DiscoverySelectedPath,
): DiscoveryContractError[] {
  if (!isRecord(selectedPath) || !Array.isArray(selectedPath.attemptIds)) {
    return [pathError("Selected path is invalid.")];
  }
  if (!hasOnlyKeys(selectedPath, ["attemptIds", "selectedAt", "source"])) {
    return [pathError("Selected path has unknown fields.")];
  }
  if (
    selectedPath.attemptIds.length === 0 ||
    selectedPath.attemptIds.length > DISCOVERY_LIMITS.selectedPathAttempts
  ) {
    return [
      selectedPath.attemptIds.length > DISCOVERY_LIMITS.selectedPathAttempts
        ? discoveryError("session_limit_exceeded", "Selected path is too long.", {
            path: "selectedPath.attemptIds",
          })
        : pathError("Selected path must not be empty."),
    ];
  }

  const errors: DiscoveryContractError[] = [];
  if (
    !isNormalizedIsoTime(selectedPath.selectedAt) ||
    (selectedPath.source !== "host-agent" && selectedPath.source !== "user-directed") ||
    selectedPath.attemptIds.some((attemptId) => !isSafeDiscoveryId(attemptId))
  ) {
    return [pathError("Selected path metadata is invalid.")];
  }
  const attempts = new Map(session.attempts.map((attempt) => [attempt.id, attempt]));
  const observations = new Map(
    session.observations.map((observation) => [observation.id, observation]),
  );
  const seen = new Set<string>();
  let previousAfterObservationId: string | undefined;
  let previousSequence = 0;
  let hasVisibleEvidence = false;

  for (const attemptId of selectedPath.attemptIds) {
    if (seen.has(attemptId)) {
      errors.push(pathError("Selected path contains a duplicate attempt.", attemptId));
      continue;
    }
    seen.add(attemptId);
    const attempt = attempts.get(attemptId);
    if (attempt === undefined || attempt.status !== "succeeded") {
      errors.push(pathError("Selected attempt must exist and succeed.", attemptId));
      continue;
    }
    if (attempt.sequence <= previousSequence) {
      errors.push(pathError("Selected attempt order is invalid.", attemptId));
    }
    if (
      previousAfterObservationId !== undefined &&
      attempt.beforeObservationId !== previousAfterObservationId
    ) {
      errors.push(pathError("Selected attempt observations are disconnected.", attemptId));
    }
    const before = observations.get(attempt.beforeObservationId);
    const after =
      attempt.afterObservationId === undefined
        ? undefined
        : observations.get(attempt.afterObservationId);
    if (before === undefined || after === undefined) {
      errors.push(pathError("Selected attempt observation is missing.", attemptId));
      continue;
    }
    if (
      after.sequence <= before.sequence ||
      after.observedAt < attempt.startedAt ||
      after.observedAt > attempt.finishedAt
    ) {
      errors.push(pathError("Selected attempt observations are not chronological.", attemptId));
    }
    if (attempt.action.kind === "click" || attempt.action.kind === "type") {
      const targetId = attempt.action.targetId;
      if (!before.interactiveTargets.some((target) => target.id === targetId)) {
        errors.push(pathError("Selected action target is missing.", attemptId));
      }
    }

    const expectations = [...attempt.expectations, ...attempt.derivedExpectations];
    for (const expectation of expectations) {
      const effects = attempt.observedEffects.filter(
        (effect) => effect.expectationId === expectation.id,
      );
      if (
        effects.length !== 1 ||
        effects[0].status !== "matched" ||
        effects[0].observationId !== after.id
      ) {
        errors.push(
          discoveryError("expectation_evidence_missing", "Expectation lacks matched evidence.", {
            recordId: attemptId,
          }),
        );
      }
      if (expectation.kind === "visible-state") {
        hasVisibleEvidence = true;
        const targetExists =
          expectation.targetId === undefined ||
          after.visibleStates.some((state) => state.id === expectation.targetId) ||
          after.interactiveTargets.some((target) => target.id === expectation.targetId);
        if (!targetExists) {
          errors.push(pathError("Visible-state target is missing.", attemptId));
        }
      } else if (!matchesNavigationExpectation(expectation, after.page.url)) {
        errors.push(pathError("Navigation expectation contradicts the observation.", attemptId));
      }
    }
    if (attempt.action.kind === "navigate") {
      const navigation = expectations.find(
        (expectation) =>
          expectation.kind === "navigation" &&
          matchesNavigationExpectation(expectation, after.page.url),
      );
      if (navigation === undefined) {
        errors.push(pathError("Navigation attempt lacks matched destination evidence.", attemptId));
      }
    }
    previousAfterObservationId = attempt.afterObservationId;
    previousSequence = attempt.sequence;
  }
  if (!hasVisibleEvidence && errors.length === 0) {
    errors.push(pathError("Selected path requires visible-state evidence."));
  }
  return errors;
}

function isTerminalForStatus(value: Record<string, unknown>): boolean {
  if (value.status === "active") return value.terminal === undefined;
  if (!isRecord(value.terminal) || value.terminal.status !== value.status) return false;
  if (value.status === "completed") {
    return (
      hasOnlyKeys(value.terminal, ["status", "completedAt"]) &&
      value.terminal.completedAt === value.updatedAt &&
      isNormalizedIsoTime(value.terminal.completedAt)
    );
  }
  const timeKey = value.status === "failed" ? "failedAt" : "abandonedAt";
  if (
    (value.status !== "failed" && value.status !== "abandoned") ||
    !hasOnlyKeys(value.terminal, ["status", timeKey, "reason"]) ||
    value.terminal[timeKey] !== value.updatedAt ||
    !isNormalizedIsoTime(value.terminal[timeKey]) ||
    !isRecord(value.terminal.reason) ||
    !hasOnlyKeys(value.terminal.reason, ["code", "summary"]) ||
    !isSafeDiscoveryId(value.terminal.reason.code) ||
    !isNonEmptyBoundedText(
      value.terminal.reason.summary,
      DISCOVERY_LIMITS.publicStringCharacters,
    ) ||
    sanitizeDiscoveryText(value.terminal.reason.summary) !== value.terminal.reason.summary
  ) {
    return false;
  }
  return true;
}

function isBaseSession(value: Record<string, unknown>): value is DiscoverySessionV1 {
  if (
    !isSafeDiscoveryId(value.id) ||
    (value.status !== "active" &&
      value.status !== "completed" &&
      value.status !== "failed" &&
      value.status !== "abandoned") ||
    !isRecord(value.target) ||
    !hasOnlyKeys(value.target, ["kind", "startUrl"]) ||
    value.target.kind !== "browser" ||
    typeof value.target.startUrl !== "string" ||
    sanitizeDiscoveryUrl(value.target.startUrl) !== value.target.startUrl ||
    !isNonEmptyBoundedText(value.goal, DISCOVERY_LIMITS.publicStringCharacters) ||
    sanitizeDiscoveryText(value.goal) !== value.goal ||
    !isRecord(value.host) ||
    !hasOnlyKeys(value.host, ["name", "version", "model"]) ||
    !isNonEmptyBoundedText(value.host.name, DISCOVERY_LIMITS.identifierCharacters) ||
    !isNonEmptyBoundedText(value.host.version, DISCOVERY_LIMITS.identifierCharacters) ||
    (value.host.model !== undefined &&
      !isNonEmptyBoundedText(value.host.model, DISCOVERY_LIMITS.identifierCharacters)) ||
    (value.launchProfile !== undefined && !validateBrowserLaunchProfile(value.launchProfile).ok) ||
    (value.parentSessionId !== undefined && !isSafeDiscoveryId(value.parentSessionId)) ||
    !isNormalizedIsoTime(value.createdAt) ||
    !isNormalizedIsoTime(value.updatedAt) ||
    value.updatedAt < value.createdAt ||
    !Array.isArray(value.observations) ||
    value.observations.length > DISCOVERY_LIMITS.observations ||
    !value.observations.every((observation, index) => isObservation(observation, index + 1)) ||
    new Set(
      value.observations.flatMap((observation) =>
        isRecord(observation) && typeof observation.id === "string" ? [observation.id] : [],
      ),
    ).size !== value.observations.length ||
    !Array.isArray(value.attempts) ||
    !validateAttempts(value as DiscoverySessionV1) ||
    new Set(
      value.attempts.flatMap((attempt) =>
        isRecord(attempt) && typeof attempt.id === "string" ? [attempt.id] : [],
      ),
    ).size !== value.attempts.length ||
    (value.parentSessionId !== undefined && value.parentSessionId === value.id) ||
    (value.selectedPath !== undefined &&
      (!isRecord(value.selectedPath) ||
        !Array.isArray(value.selectedPath.attemptIds) ||
        !isNormalizedIsoTime(value.selectedPath.selectedAt) ||
        value.selectedPath.selectedAt > value.updatedAt)) ||
    (value.status === "completed" && value.selectedPath === undefined) ||
    (value.status === "completed" &&
      value.attempts.some((attempt) => isRecord(attempt) && attempt.status === "pending")) ||
    !isTerminalForStatus(value)
  ) {
    return false;
  }
  return true;
}

export function validateDiscoverySession(value: unknown): DiscoveryContractResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      errors: [discoveryError("invalid_discovery_session", "Discovery session must be an object.")],
    };
  }
  if (value.schemaVersion !== 1) {
    return {
      ok: false,
      errors: [
        discoveryError(
          "unsupported_discovery_schema",
          "Discovery session schemaVersion must be 1.",
          { path: "schemaVersion" },
        ),
      ],
    };
  }
  const unknown = Object.keys(value).find((key) => !SESSION_KEYS.includes(key as never));
  if (unknown !== undefined) {
    return {
      ok: false,
      errors: [
        discoveryError("unsafe_discovery_content", "Unknown discovery session field.", {
          path: "unknown",
        }),
      ],
    };
  }
  if (isRecord(value.host)) {
    for (const key of ["name", "version", "model"] as const) {
      const hostValue = value.host[key];
      if (typeof hostValue === "string" && sanitizeDiscoveryText(hostValue) !== hostValue) {
        return {
          ok: false,
          errors: [
            discoveryError("unsafe_discovery_content", "Host metadata is unsafe.", {
              path: `host.${key}`,
            }),
          ],
        };
      }
    }
  }
  const observations = Array.isArray(value.observations) ? value.observations : [];
  const hasOversizedObservationCollection = observations.some(
    (observation) =>
      isRecord(observation) &&
      ((Array.isArray(observation.visibleStates) &&
        observation.visibleStates.length > DISCOVERY_LIMITS.visibleStatesPerObservation) ||
        (Array.isArray(observation.interactiveTargets) &&
          observation.interactiveTargets.length >
            DISCOVERY_LIMITS.interactiveTargetsPerObservation) ||
        (Array.isArray(observation.artifacts) &&
          observation.artifacts.length > DISCOVERY_LIMITS.artifactReferencesPerObservation)),
  );
  if (
    (Array.isArray(value.observations) &&
      value.observations.length > DISCOVERY_LIMITS.observations) ||
    (Array.isArray(value.attempts) && value.attempts.length > DISCOVERY_LIMITS.attempts) ||
    (isRecord(value.selectedPath) &&
      Array.isArray(value.selectedPath.attemptIds) &&
      value.selectedPath.attemptIds.length > DISCOVERY_LIMITS.selectedPathAttempts) ||
    hasOversizedObservationCollection ||
    serializedDiscoveryBytes(value) > DISCOVERY_LIMITS.serializedBytes
  ) {
    return {
      ok: false,
      errors: [discoveryError("session_limit_exceeded", "Discovery session limit exceeded.")],
    };
  }
  const canValidateSelectedPath =
    isRecord(value.selectedPath) &&
    Array.isArray(value.selectedPath.attemptIds) &&
    Array.isArray(value.attempts) &&
    value.attempts.every(
      (attempt) =>
        isRecord(attempt) &&
        Number.isInteger(attempt.sequence) &&
        Number(attempt.sequence) > 0 &&
        (attempt.status !== "succeeded" ||
          (isRecord(attempt.action) &&
            typeof attempt.beforeObservationId === "string" &&
            typeof attempt.afterObservationId === "string" &&
            Array.isArray(attempt.expectations) &&
            attempt.expectations.every(isRecord) &&
            Array.isArray(attempt.derivedExpectations) &&
            attempt.derivedExpectations.every(isRecord) &&
            Array.isArray(attempt.observedEffects) &&
            attempt.observedEffects.every(isRecord))),
    ) &&
    Array.isArray(value.observations) &&
    value.observations.every(
      (observation) =>
        isRecord(observation) &&
        isRecord(observation.page) &&
        typeof observation.page.url === "string" &&
        Array.isArray(observation.visibleStates) &&
        observation.visibleStates.every(isRecord) &&
        Array.isArray(observation.interactiveTargets) &&
        observation.interactiveTargets.every(isRecord),
    );
  if (canValidateSelectedPath) {
    const pathErrors = validateSelectedPath(
      value as unknown as DiscoverySessionV1,
      value.selectedPath as DiscoverySelectedPath,
    );
    if (pathErrors.length > 0) return { ok: false, errors: pathErrors };
  }
  if (!isBaseSession(value)) {
    return {
      ok: false,
      errors: [discoveryError("invalid_discovery_session", "Discovery session is invalid.")],
    };
  }
  if (value.selectedPath !== undefined) {
    const pathErrors = validateSelectedPath(value, value.selectedPath);
    if (pathErrors.length > 0) return { ok: false, errors: pathErrors };
  }
  if (serializedDiscoveryBytes(value) > DISCOVERY_LIMITS.serializedBytes) {
    return {
      ok: false,
      errors: [discoveryError("session_limit_exceeded", "Discovery session is too large.")],
    };
  }
  return { ok: true, session: structuredClone(value) };
}
