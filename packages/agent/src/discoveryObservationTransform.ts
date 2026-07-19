import { DISCOVERY_LIMITS, type DiscoveryInteractiveTarget } from "./discoveryContract.js";
import type {
  DiscoveryObservationDiagnostic,
  DiscoveryObservationExtractionError,
  DiscoveryObservationIdKind,
  DiscoveryObservationPageSnapshot,
  DiscoveryObservationRawTarget,
  DiscoveryObservationRawVisibleState,
} from "./discoveryObservation.js";
import type { RecordDiscoveryObservationInput } from "./discoverySession.js";
import { sanitizeDiscoveryText, sanitizeDiscoveryUrl } from "./discoveryValidation.js";

const TITLE_LIMIT = 512;
const LABEL_LIMIT = 256;
const SUMMARY_LIMIT = 500;

const MESSAGES = {
  interactive_targets_truncated: "Additional interactive targets were omitted.",
  visible_states_truncated: "Additional visible states were omitted.",
  content_redacted: "Sensitive or oversized page content was redacted.",
  credential_target_present: "Credential-like input is present.",
  fallback_targets_included: "Focusable or clickable-looking fallback targets were included.",
  screenshot_unavailable: "The optional viewport screenshot is unavailable.",
  unstable_page_retried: "Observation retried after the main document changed.",
} as const;

export function diagnostic(
  code: DiscoveryObservationDiagnostic["code"],
  count?: number,
): DiscoveryObservationDiagnostic {
  return { code, message: MESSAGES[code], ...(count === undefined ? {} : { count }) };
}

function publicText(value: string, limit: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const sanitized = sanitizeDiscoveryText(normalized).replace(/\s+/g, " ").trim();
  const bounded = sanitized.slice(0, limit).trim();
  return { value: bounded, changed: bounded !== normalized };
}

const TARGET_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "switch",
  "combobox",
  "listbox",
  "option",
  "tab",
  "menuitem",
  "slider",
  "spinbutton",
]);

export type BuildDiscoveryObservationInput = {
  snapshot: DiscoveryObservationPageSnapshot;
  observedAt: string;
  idGenerator: (kind: DiscoveryObservationIdKind) => string;
  targetId: (candidate: DiscoveryObservationRawTarget) => string;
};

export type BuildDiscoveryObservationResult =
  | {
      ok: true;
      observation: RecordDiscoveryObservationInput;
      diagnostics: DiscoveryObservationDiagnostic[];
    }
  | { ok: false; errors: DiscoveryObservationExtractionError[] };

export function buildDiscoveryObservation(
  input: BuildDiscoveryObservationInput,
): BuildDiscoveryObservationResult {
  const { snapshot, observedAt, idGenerator, targetId } = input;
  const url = sanitizeDiscoveryUrl(snapshot.url);
  if (url === undefined) {
    return {
      ok: false,
      errors: [
        { code: "unsafe_page_url", message: "Discovery page URL is unsafe.", path: "page.url" },
      ],
    };
  }
  if (
    !Number.isInteger(snapshot.viewport.width) ||
    snapshot.viewport.width <= 0 ||
    !Number.isInteger(snapshot.viewport.height) ||
    snapshot.viewport.height <= 0
  ) {
    return {
      ok: false,
      errors: [
        {
          code: "invalid_page_state",
          message: "Discovery page state is invalid.",
          path: "page.viewport",
        },
      ],
    };
  }
  const title = publicText(snapshot.title, TITLE_LIMIT);
  if (title.value.length === 0) {
    return {
      ok: false,
      errors: [
        {
          code: "invalid_page_state",
          message: "Discovery page state is invalid.",
          path: "page.title",
        },
      ],
    };
  }
  const observationId = idGenerator("observation");

  let redactedCount = (snapshot.truncatedContent ?? 0) + (title.changed ? 1 : 0);
  const seenSummaries = new Set<string>();
  const visibleCandidates = snapshot.visibleStates
    .map((candidate) => ({ candidate, sanitized: publicText(candidate.summary, SUMMARY_LIMIT) }))
    .sort((left, right) => {
      const tier = (kind: DiscoveryObservationRawVisibleState["kind"]) =>
        kind === "status" ? 0 : kind === "heading" ? 1 : 2;
      return (
        tier(left.candidate.kind) - tier(right.candidate.kind) ||
        left.candidate.order - right.candidate.order
      );
    })
    .filter(({ sanitized }) => {
      if (sanitized.changed) redactedCount += 1;
      if (sanitized.value.length === 0 || seenSummaries.has(sanitized.value)) return false;
      seenSummaries.add(sanitized.value);
      return true;
    });

  const targetCandidates = snapshot.interactiveTargets
    .map((candidate) => {
      const sanitized = publicText(candidate.label, LABEL_LIMIT);
      const candidateRole =
        candidate.role === undefined
          ? undefined
          : publicText(candidate.role.toLowerCase(), LABEL_LIMIT).value;
      const role =
        candidateRole !== undefined && TARGET_ROLES.has(candidateRole) ? candidateRole : undefined;
      const options = candidate.form?.options
        ?.map((option) => ({ ...option, sanitized: publicText(option.label, LABEL_LIMIT) }))
        .filter(({ sanitized: optionLabel }) => optionLabel.value.length > 0)
        .slice(0, DISCOVERY_LIMITS.formOptionsPerTarget);
      const selectedOption =
        candidate.form?.selectedOption === undefined
          ? undefined
          : publicText(candidate.form.selectedOption, LABEL_LIMIT).value;
      return { candidate, sanitized, role, options, selectedOption };
    })
    .filter(({ sanitized }) => {
      if (sanitized.changed) redactedCount += 1;
      return sanitized.value.length > 0;
    })
    .sort((left, right) => {
      const leftTier = left.candidate.tier === "semantic" ? 0 : 1;
      const rightTier = right.candidate.tier === "semantic" ? 0 : 1;
      return leftTier - rightTier || left.candidate.order - right.candidate.order;
    });

  const duplicateCounts = new Map<string, number>();
  for (const { sanitized, role } of targetCandidates) {
    const key = `${sanitized.value}\u0000${role ?? ""}`;
    duplicateCounts.set(key, (duplicateCounts.get(key) ?? 0) + 1);
  }
  const occurrences = new Map<string, number>();
  const selectedTargets = targetCandidates.slice(
    0,
    DISCOVERY_LIMITS.interactiveTargetsPerObservation,
  );
  const interactiveTargets: DiscoveryInteractiveTarget[] = selectedTargets.map(
    ({ candidate, sanitized, role, options, selectedOption }) => {
      const key = `${sanitized.value}\u0000${role ?? ""}`;
      const occurrence = (occurrences.get(key) ?? 0) + 1;
      occurrences.set(key, occurrence);
      return {
        id: targetId(candidate),
        label: sanitized.value,
        ...(role === undefined ? {} : { role }),
        ...((duplicateCounts.get(key) ?? 0) > 1 ? { occurrence } : {}),
        disabled: candidate.disabled,
        ...(candidate.actionRisk === undefined ? {} : { actionRisk: candidate.actionRisk }),
        ...(candidate.form === undefined
          ? {}
          : {
              form: {
                required: candidate.form.required,
                hasValue: candidate.form.hasValue,
                validity: candidate.form.validity,
                ...(candidate.form.checked === undefined
                  ? {}
                  : { checked: candidate.form.checked }),
                ...(selectedOption === undefined || selectedOption.length === 0
                  ? {}
                  : { selectedOption }),
                ...(options === undefined
                  ? {}
                  : {
                      options: options.map(({ sanitized: optionLabel, disabled, selected }) => ({
                        label: optionLabel.value,
                        disabled,
                        selected,
                      })),
                    }),
              },
            }),
      };
    },
  );

  const diagnostics: DiscoveryObservationDiagnostic[] = [];
  const omittedVisibleStates =
    Math.max(0, snapshot.omittedVisibleStates ?? 0) +
    Math.max(0, visibleCandidates.length - DISCOVERY_LIMITS.visibleStatesPerObservation);
  if (omittedVisibleStates > 0) {
    diagnostics.push(diagnostic("visible_states_truncated", omittedVisibleStates));
  }
  const omittedInteractiveTargets =
    Math.max(0, snapshot.omittedInteractiveTargets ?? 0) +
    Math.max(0, targetCandidates.length - DISCOVERY_LIMITS.interactiveTargetsPerObservation);
  if (omittedInteractiveTargets > 0) {
    diagnostics.push(diagnostic("interactive_targets_truncated", omittedInteractiveTargets));
  }
  if (redactedCount > 0) diagnostics.push(diagnostic("content_redacted", redactedCount));
  const credentialCount = selectedTargets.filter(({ candidate }) => candidate.credential).length;
  if (credentialCount > 0)
    diagnostics.push(diagnostic("credential_target_present", credentialCount));
  const fallbackCount = selectedTargets.filter(
    ({ candidate }) => candidate.tier === "fallback",
  ).length;
  if (fallbackCount > 0) diagnostics.push(diagnostic("fallback_targets_included", fallbackCount));

  return {
    ok: true,
    observation: {
      id: observationId,
      observedAt,
      page: {
        url,
        title: title.value,
        viewport: { ...snapshot.viewport },
        navigation: { canGoBack: snapshot.canGoBack },
      },
      visibleStates: visibleCandidates
        .slice(0, DISCOVERY_LIMITS.visibleStatesPerObservation)
        .map(({ candidate, sanitized }) => ({
          id: idGenerator("visible-state"),
          kind: candidate.kind === "status" ? "status" : "text",
          summary: sanitized.value,
        })),
      interactiveTargets,
      artifacts: [],
    },
    diagnostics,
  };
}
