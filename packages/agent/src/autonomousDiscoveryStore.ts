import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  validateBrowserLaunchProfile,
  type BrowserLaunchProfileV1,
} from "@auto-demo/browser-profile";
import type { DiscoveryPolicy } from "./discoveryPolicy.js";
import { validateDiscoveryPolicy } from "./discoveryPolicy.js";
import type { DiscoverySessionV1 } from "./discoveryContract.js";
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
  policy: DiscoveryPolicy;
  target: { url: string; goal: string };
  launchProfile: BrowserLaunchProfileV1;
  artifacts: Partial<Record<AutonomousDiscoveryArtifactKind, string>>;
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
  | { ok: true; path: string }
  | AutonomousDiscoveryStoreError;

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
  writeReplay(value: unknown): Promise<AutonomousDiscoveryStoreWriteResult>;
  writeReview(value: unknown): Promise<AutonomousDiscoveryStoreWriteResult>;
  writeExecution(value: unknown): Promise<AutonomousDiscoveryStoreWriteResult>;
  writeHandoff(value: unknown): Promise<AutonomousDiscoveryStoreWriteResult>;
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

export function createFileAutonomousDiscoveryStore(
  directory: string,
): AutonomousDiscoveryStore {
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
      return await writeArtifact(ARTIFACT_PATHS.replay, value);
    },
    async writeReview(value) {
      return await writeArtifact(ARTIFACT_PATHS.review, value);
    },
    async writeExecution(value) {
      return await writeArtifact(ARTIFACT_PATHS.execution, value);
    },
    async writeHandoff(value) {
      return await writeArtifact(ARTIFACT_PATHS.handoff, value);
    },
  };
}

function isCheckpoint(value: unknown): value is AutonomousDiscoveryRunCheckpoint {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "schemaVersion",
    "runId",
    "phase",
    "policy",
    "target",
    "launchProfile",
    "artifacts",
  ])) return false;
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
  ) return false;
  try {
    const url = new URL(value.target.url);
    if (!/^https?:$/.test(url.protocol) || url.username !== "" || url.password !== "") return false;
  } catch {
    return false;
  }
  if (!validateBrowserLaunchProfile(value.launchProfile).ok) return false;
  if (!validateDiscoveryPolicy(value.policy as DiscoveryPolicy, value.target.url).ok) return false;
  return Object.entries(value.artifacts).every(
    ([kind, path]) =>
      isArtifactKind(kind) && typeof path === "string" && path === artifactPathForKind(kind),
  );
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
