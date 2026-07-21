import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  validateBrowserLaunchProfile,
  type BrowserLaunchProfileV1,
} from "@auto-demo/browser-profile";
import { DISCOVERY_LIMITS, type DiscoverySessionV1 } from "./discoveryContract.js";
import { isSafeDiscoveryId, validateDiscoverySession } from "./discoveryValidation.js";
import type { WalkthroughPlan } from "./index.js";
import { isWalkthroughPlan } from "./walkthroughValidation.js";

export type AutonomousDiscoveryRunPhase =
  | "discovering"
  | "replaying"
  | "review-required"
  | "recording"
  | "completed"
  | "abandoned"
  | "failed";

export type AutonomousDiscoveryArtifactKind =
  | "root-session"
  | "repair-1-session"
  | "repair-2-session"
  | "draft-plan"
  | "replay"
  | "replay-validated-plan"
  | "review"
  | "approved-plan"
  | "execution"
  | "handoff";

export type AutonomousDiscoveryRunCheckpoint = {
  schemaVersion: 1;
  runId: string;
  phase: AutonomousDiscoveryRunPhase;
  policySelection: AutonomousDiscoveryPolicySelection;
  target: { url: string; goal: string };
  launchProfile: BrowserLaunchProfileV1;
  artifacts: Partial<Record<AutonomousDiscoveryArtifactKind, string>>;
};

export type AutonomousDiscoveryPolicySelection =
  { mode: "yolo" } | { mode: "safe" | "public-browse" | "disposable"; allowedOrigins: string[] };

export type AutonomousDiscoveryReplayArtifact = {
  schemaVersion: 1;
  status: "passed" | "failed";
  attempts: number;
};

export type AutonomousDiscoveryReviewArtifact = {
  schemaVersion: 1;
  planFingerprint: string;
  approval: { eligible: boolean; basis?: "validated" | "best-guess-bypass" };
  blockerCount: number;
};

export type AutonomousDiscoveryExecutionArtifact = {
  schemaVersion: 1;
  status: "completed";
  stepCount: number;
};

export type AutonomousDiscoveryHandoffArtifact = {
  schemaVersion: 1;
  status: "completed";
  projectDirectory: string;
  projectName: string;
  nextStepCount: number;
};

export type AutonomousDiscoveryStoreErrorCode =
  | "workflow_directory_not_empty"
  | "missing_runner_checkpoint"
  | "invalid_runner_checkpoint"
  | "invalid_runner_artifact"
  | "runner_artifact_read_failed"
  | "runner_artifact_write_failed";

export type AutonomousDiscoveryStoreError = {
  ok: false;
  code: AutonomousDiscoveryStoreErrorCode;
  message: string;
};

export type AutonomousDiscoveryStoreWriteResult =
  { ok: true; path: string } | AutonomousDiscoveryStoreError;

export type AutonomousDiscoverySessionArtifact = "root" | "repair-1" | "repair-2";
export type AutonomousDiscoveryPlanArtifact = "draft" | "replay-validated" | "approved";

export type AutonomousDiscoveryStore = {
  initialize(
    checkpoint: AutonomousDiscoveryRunCheckpoint,
  ): Promise<{ ok: true } | AutonomousDiscoveryStoreError>;
  loadCheckpoint(): Promise<
    { ok: true; checkpoint: AutonomousDiscoveryRunCheckpoint } | AutonomousDiscoveryStoreError
  >;
  writeCheckpoint(
    checkpoint: AutonomousDiscoveryRunCheckpoint,
  ): Promise<AutonomousDiscoveryStoreWriteResult>;
  writeSession(
    kind: AutonomousDiscoverySessionArtifact,
    session: DiscoverySessionV1,
  ): Promise<AutonomousDiscoveryStoreWriteResult>;
  writePlan(
    kind: AutonomousDiscoveryPlanArtifact,
    plan: WalkthroughPlan,
  ): Promise<AutonomousDiscoveryStoreWriteResult>;
  loadPlan(
    kind: "replay-validated" | "approved",
  ): Promise<{ ok: true; plan: WalkthroughPlan } | AutonomousDiscoveryStoreError>;
  writeReplay(
    value: AutonomousDiscoveryReplayArtifact,
  ): Promise<AutonomousDiscoveryStoreWriteResult>;
  writeReview(
    value: AutonomousDiscoveryReviewArtifact,
  ): Promise<AutonomousDiscoveryStoreWriteResult>;
  loadReview(): Promise<
    { ok: true; review: AutonomousDiscoveryReviewArtifact } | AutonomousDiscoveryStoreError
  >;
  writeExecution(
    value: AutonomousDiscoveryExecutionArtifact,
  ): Promise<AutonomousDiscoveryStoreWriteResult>;
  writeHandoff(
    value: AutonomousDiscoveryHandoffArtifact,
  ): Promise<AutonomousDiscoveryStoreWriteResult>;
};

const ARTIFACT_PATHS = {
  root: "sessions/root.json",
  "repair-1": "sessions/repair-1.json",
  "repair-2": "sessions/repair-2.json",
  draft: "plan.draft.json",
  "replay-validated": "plan.replay-validated.json",
  approved: "plan.approved.json",
  replay: "replay.json",
  review: "review.json",
  execution: "execution.json",
  handoff: "handoff.json",
} as const;

export function createFileAutonomousDiscoveryStore(directory: string): AutonomousDiscoveryStore {
  const writeArtifact = async (
    relativePath: string,
    value: unknown,
  ): Promise<AutonomousDiscoveryStoreWriteResult> => {
    try {
      const path = join(directory, relativePath);
      await mkdir(dirname(path), { recursive: true });
      const temporaryPath = `${path}.tmp-${randomUUID()}`;
      await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      await rename(temporaryPath, path);
      return { ok: true, path: relativePath };
    } catch {
      return storeError(
        "runner_artifact_write_failed",
        "Autonomous discovery artifact could not be persisted.",
      );
    }
  };

  const readJson = async (
    relativePath: string,
  ): Promise<{ ok: true; value: unknown } | AutonomousDiscoveryStoreError> => {
    try {
      return { ok: true, value: JSON.parse(await readFile(join(directory, relativePath), "utf8")) };
    } catch {
      return storeError(
        "runner_artifact_read_failed",
        "Autonomous discovery artifact could not be read.",
      );
    }
  };

  return {
    async initialize(checkpoint) {
      if (!isCheckpoint(checkpoint)) {
        return storeError(
          "invalid_runner_checkpoint",
          "Autonomous discovery checkpoint is invalid.",
        );
      }
      try {
        await mkdir(directory, { recursive: true });
        if ((await readdir(directory)).length > 0) {
          return storeError(
            "workflow_directory_not_empty",
            "Autonomous discovery workflow directory must be missing or empty.",
          );
        }
      } catch {
        return storeError(
          "runner_artifact_write_failed",
          "Autonomous discovery artifact could not be persisted.",
        );
      }
      const written = await writeArtifact("run.json", checkpoint);
      return written.ok ? { ok: true } : written;
    },
    async loadCheckpoint() {
      let raw: string;
      try {
        raw = await readFile(join(directory, "run.json"), "utf8");
      } catch {
        return storeError(
          "missing_runner_checkpoint",
          "Autonomous discovery checkpoint was not found.",
        );
      }
      try {
        const value: unknown = JSON.parse(raw);
        if (!isCheckpoint(value)) throw new Error("invalid");
        return { ok: true, checkpoint: structuredClone(value) };
      } catch {
        return storeError(
          "invalid_runner_checkpoint",
          "Autonomous discovery checkpoint is invalid.",
        );
      }
    },
    async writeCheckpoint(checkpoint) {
      if (!isCheckpoint(checkpoint)) {
        return storeError(
          "invalid_runner_checkpoint",
          "Autonomous discovery checkpoint is invalid.",
        );
      }
      return await writeArtifact("run.json", checkpoint);
    },
    async writeSession(kind, session) {
      if (!(kind in ARTIFACT_PATHS) || !["root", "repair-1", "repair-2"].includes(kind)) {
        return storeError("invalid_runner_artifact", "Autonomous discovery artifact is invalid.");
      }
      const validated = validateDiscoverySession(session);
      if (!validated.ok) {
        return storeError("invalid_runner_artifact", "Autonomous discovery artifact is invalid.");
      }
      return await writeArtifact(ARTIFACT_PATHS[kind], validated.session);
    },
    async writePlan(kind, plan) {
      if (!isWalkthroughPlan(plan)) {
        return storeError("invalid_runner_artifact", "Autonomous discovery artifact is invalid.");
      }
      return await writeArtifact(ARTIFACT_PATHS[kind], plan);
    },
    async loadPlan(kind) {
      const read = await readJson(ARTIFACT_PATHS[kind]);
      if (!read.ok) return read;
      if (!isWalkthroughPlan(read.value)) {
        return storeError("invalid_runner_artifact", "Autonomous discovery artifact is invalid.");
      }
      return { ok: true, plan: structuredClone(read.value) };
    },
    async writeReplay(value) {
      if (!isReplayArtifact(value)) return invalidArtifact();
      return await writeArtifact(ARTIFACT_PATHS.replay, value);
    },
    async writeReview(value) {
      if (!isReviewArtifact(value)) return invalidArtifact();
      return await writeArtifact(ARTIFACT_PATHS.review, value);
    },
    async loadReview() {
      const read = await readJson(ARTIFACT_PATHS.review);
      if (!read.ok) return read;
      if (!isReviewArtifact(read.value)) return invalidArtifact();
      return { ok: true, review: structuredClone(read.value) };
    },
    async writeExecution(value) {
      if (!isExecutionArtifact(value)) return invalidArtifact();
      return await writeArtifact(ARTIFACT_PATHS.execution, value);
    },
    async writeHandoff(value) {
      if (!isHandoffArtifact(value)) return invalidArtifact();
      return await writeArtifact(ARTIFACT_PATHS.handoff, value);
    },
  };
}

function isCheckpoint(value: unknown): value is AutonomousDiscoveryRunCheckpoint {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "runId",
      "phase",
      "policySelection",
      "target",
      "launchProfile",
      "artifacts",
    ])
  )
    return false;
  if (
    value.schemaVersion !== 1 ||
    typeof value.runId !== "string" ||
    !isSafeDiscoveryId(value.runId) ||
    !isRunPhase(value.phase) ||
    !isRecord(value.target) ||
    !hasOnlyKeys(value.target, ["url", "goal"]) ||
    typeof value.target.url !== "string" ||
    typeof value.target.goal !== "string" ||
    value.target.goal.trim().length === 0 ||
    !isRecord(value.artifacts)
  )
    return false;
  try {
    const url = new URL(value.target.url);
    if (!/^https?:$/.test(url.protocol) || url.username !== "" || url.password !== "") return false;
  } catch {
    return false;
  }
  if (!validateBrowserLaunchProfile(value.launchProfile).ok) return false;
  if (!isPolicySelection(value.policySelection, value.target.url)) return false;
  return Object.entries(value.artifacts).every(
    ([kind, path]) =>
      isArtifactKind(kind) && typeof path === "string" && path === artifactPathForKind(kind),
  );
}

function isPolicySelection(
  value: unknown,
  targetUrl: string,
): value is AutonomousDiscoveryPolicySelection {
  if (!isRecord(value) || typeof value.mode !== "string") return false;
  if (value.mode === "yolo") return hasOnlyKeys(value, ["mode"]);
  if (
    !["safe", "public-browse", "disposable"].includes(value.mode) ||
    !hasOnlyKeys(value, ["mode", "allowedOrigins"]) ||
    !Array.isArray(value.allowedOrigins) ||
    value.allowedOrigins.length === 0 ||
    !value.allowedOrigins.every((origin) => typeof origin === "string" && isExactOrigin(origin))
  )
    return false;
  return value.allowedOrigins.includes(new URL(targetUrl).origin);
}

function isReplayArtifact(value: unknown): value is AutonomousDiscoveryReplayArtifact {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["schemaVersion", "status", "attempts"]) &&
    value.schemaVersion === 1 &&
    ["passed", "failed"].includes(String(value.status)) &&
    Number.isInteger(value.attempts) &&
    Number(value.attempts) >= 0 &&
    Number(value.attempts) <= 3
  );
}

function isReviewArtifact(value: unknown): value is AutonomousDiscoveryReviewArtifact {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["schemaVersion", "planFingerprint", "approval", "blockerCount"]) ||
    value.schemaVersion !== 1 ||
    typeof value.planFingerprint !== "string" ||
    !Number.isInteger(value.blockerCount) ||
    Number(value.blockerCount) < 0 ||
    !isRecord(value.approval)
  )
    return false;
  return (
    hasOnlyKeys(value.approval, ["eligible", "basis"]) &&
    typeof value.approval.eligible === "boolean" &&
    (value.approval.basis === undefined ||
      ["validated", "best-guess-bypass"].includes(String(value.approval.basis)))
  );
}

function isExecutionArtifact(value: unknown): value is AutonomousDiscoveryExecutionArtifact {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["schemaVersion", "status", "stepCount"]) ||
    value.schemaVersion !== 1 ||
    value.status !== "completed" ||
    !Number.isInteger(value.stepCount) ||
    Number(value.stepCount) < 0 ||
    Number(value.stepCount) > DISCOVERY_LIMITS.selectedPathAttempts
  )
    return false;
  return true;
}

function isHandoffArtifact(value: unknown): value is AutonomousDiscoveryHandoffArtifact {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "schemaVersion",
      "status",
      "projectDirectory",
      "projectName",
      "nextStepCount",
    ]) &&
    value.schemaVersion === 1 &&
    value.status === "completed" &&
    typeof value.projectDirectory === "string" &&
    value.projectDirectory.length > 0 &&
    value.projectDirectory.length <= DISCOVERY_LIMITS.publicStringCharacters &&
    typeof value.projectName === "string" &&
    value.projectName.length > 0 &&
    value.projectName.length <= DISCOVERY_LIMITS.publicStringCharacters &&
    Number.isInteger(value.nextStepCount) &&
    Number(value.nextStepCount) >= 0 &&
    Number(value.nextStepCount) <= DISCOVERY_LIMITS.selectedPathAttempts
  );
}

function isExactOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      /^https?:$/.test(url.protocol) &&
      url.origin === value &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function invalidArtifact(): AutonomousDiscoveryStoreError {
  return storeError("invalid_runner_artifact", "Autonomous discovery artifact is invalid.");
}

function isRunPhase(value: unknown): value is AutonomousDiscoveryRunPhase {
  return [
    "discovering",
    "replaying",
    "review-required",
    "recording",
    "completed",
    "abandoned",
    "failed",
  ].includes(String(value));
}

function isArtifactKind(value: string): value is AutonomousDiscoveryArtifactKind {
  return [
    "root-session",
    "repair-1-session",
    "repair-2-session",
    "draft-plan",
    "replay",
    "replay-validated-plan",
    "review",
    "approved-plan",
    "execution",
    "handoff",
  ].includes(value);
}

function artifactPathForKind(kind: AutonomousDiscoveryArtifactKind): string {
  const paths: Record<AutonomousDiscoveryArtifactKind, string> = {
    "root-session": ARTIFACT_PATHS.root,
    "repair-1-session": ARTIFACT_PATHS["repair-1"],
    "repair-2-session": ARTIFACT_PATHS["repair-2"],
    "draft-plan": ARTIFACT_PATHS.draft,
    replay: ARTIFACT_PATHS.replay,
    "replay-validated-plan": ARTIFACT_PATHS["replay-validated"],
    review: ARTIFACT_PATHS.review,
    "approved-plan": ARTIFACT_PATHS.approved,
    execution: ARTIFACT_PATHS.execution,
    handoff: ARTIFACT_PATHS.handoff,
  };
  return paths[kind];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function storeError(
  code: AutonomousDiscoveryStoreErrorCode,
  message: string,
): AutonomousDiscoveryStoreError {
  return { ok: false, code, message };
}
