import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CoordinateTraceRecord } from "./coordinateDiscoverySession.js";

export type CoordinateDiscoveryPhase =
  | "starting"
  | "discovering"
  | "repairing"
  | "review-required"
  | "completed"
  | "abandoned"
  | "failed";

export type CoordinateDiscoveryCheckpoint = {
  schemaVersion: 1;
  sessionId: string;
  phase: CoordinateDiscoveryPhase;
  target: { url: string; goal: string };
  pointer: { x: number; y: number };
  frameId?: string;
  transientBindings: string[];
  trace: CoordinateTraceRecord[];
};

export type CoordinateDiscoveryStoreErrorCode =
  | "coordinate_directory_not_empty"
  | "unsafe_coordinate_directory"
  | "invalid_coordinate_checkpoint"
  | "invalid_coordinate_artifact"
  | "coordinate_store_read_failed"
  | "coordinate_store_write_failed";

export type CoordinateDiscoveryStoreError = {
  ok: false;
  code: CoordinateDiscoveryStoreErrorCode;
  message: string;
};

type WriteResult = { ok: true; path: string } | CoordinateDiscoveryStoreError;

export type CoordinateDiscoveryStore = {
  initialize(
    checkpoint: CoordinateDiscoveryCheckpoint,
  ): Promise<{ ok: true } | CoordinateDiscoveryStoreError>;
  writeCheckpoint(checkpoint: CoordinateDiscoveryCheckpoint): Promise<WriteResult>;
  loadCheckpoint(): Promise<
    { ok: true; checkpoint: CoordinateDiscoveryCheckpoint } | CoordinateDiscoveryStoreError
  >;
  writeFrame(input: {
    id: string;
    bytes: Uint8Array;
  }): Promise<{ ok: true; path: string; sha256: string } | CoordinateDiscoveryStoreError>;
};

const MAX_CHECKPOINT_BYTES = 5 * 1024 * 1024;
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

export function createFileCoordinateDiscoveryStore(directory: string): CoordinateDiscoveryStore {
  const writeCheckpoint = async (
    checkpoint: CoordinateDiscoveryCheckpoint,
  ): Promise<WriteResult> => {
    const durable = durableCheckpoint(checkpoint);
    if (!isCheckpoint(durable)) return storeError("invalid_coordinate_checkpoint");
    const serialized = `${JSON.stringify(durable, null, 2)}\n`;
    if (Buffer.byteLength(serialized) > MAX_CHECKPOINT_BYTES) {
      return storeError("invalid_coordinate_checkpoint");
    }
    return await atomicWrite("session.json", serialized);
  };

  const atomicWrite = async (
    relativePath: string,
    value: string | Uint8Array,
  ): Promise<WriteResult> => {
    try {
      const path = join(directory, relativePath);
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.tmp-${randomUUID()}`;
      await writeFile(temporary, value, { flag: "wx" });
      await rename(temporary, path);
      return { ok: true, path: relativePath };
    } catch {
      return storeError("coordinate_store_write_failed");
    }
  };

  return {
    async initialize(checkpoint) {
      try {
        const existing = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        });
        if (existing?.isSymbolicLink()) return storeError("unsafe_coordinate_directory");
        if (existing === undefined) await mkdir(directory, { recursive: true });
        else if (!existing.isDirectory()) return storeError("unsafe_coordinate_directory");
        if ((await readdir(directory)).length > 0) {
          return storeError("coordinate_directory_not_empty");
        }
      } catch {
        return storeError("unsafe_coordinate_directory");
      }
      const written = await writeCheckpoint(checkpoint);
      return written.ok ? { ok: true } : written;
    },

    writeCheckpoint,

    async loadCheckpoint() {
      try {
        const parsed: unknown = JSON.parse(await readFile(join(directory, "session.json"), "utf8"));
        return isCheckpoint(parsed)
          ? { ok: true, checkpoint: parsed }
          : storeError("invalid_coordinate_checkpoint");
      } catch {
        return storeError("coordinate_store_read_failed");
      }
    },

    async writeFrame(input) {
      if (
        !isSafeId(input.id) ||
        input.bytes.byteLength < 1 ||
        input.bytes.byteLength > MAX_FRAME_BYTES
      ) {
        return storeError("invalid_coordinate_artifact");
      }
      const path = `frames/${input.id}.png`;
      const written = await atomicWrite(path, input.bytes);
      if (!written.ok) return written;
      return {
        ok: true,
        path,
        sha256: createHash("sha256").update(input.bytes).digest("hex"),
      };
    },
  };
}

function durableCheckpoint(value: CoordinateDiscoveryCheckpoint): CoordinateDiscoveryCheckpoint {
  const candidate = value as CoordinateDiscoveryCheckpoint & { runtimeBindings?: unknown };
  return {
    schemaVersion: candidate.schemaVersion,
    sessionId: candidate.sessionId,
    phase: candidate.phase,
    target: structuredClone(candidate.target),
    pointer: { ...candidate.pointer },
    ...(candidate.frameId === undefined ? {} : { frameId: candidate.frameId }),
    transientBindings: [...candidate.transientBindings],
    trace: structuredClone(candidate.trace),
  };
}

function isCheckpoint(value: unknown): value is CoordinateDiscoveryCheckpoint {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    !Object.keys(candidate).every((key) =>
      [
        "schemaVersion",
        "sessionId",
        "phase",
        "target",
        "pointer",
        "frameId",
        "transientBindings",
        "trace",
      ].includes(key),
    ) ||
    candidate.schemaVersion !== 1 ||
    !isSafeId(candidate.sessionId) ||
    ![
      "starting",
      "discovering",
      "repairing",
      "review-required",
      "completed",
      "abandoned",
      "failed",
    ].includes(String(candidate.phase)) ||
    !isTarget(candidate.target) ||
    !isPoint(candidate.pointer) ||
    (candidate.frameId !== undefined && !isSafeId(candidate.frameId)) ||
    !Array.isArray(candidate.transientBindings) ||
    !candidate.transientBindings.every(isSafeId) ||
    !Array.isArray(candidate.trace)
  ) {
    return false;
  }
  return true;
}

function isTarget(value: unknown): value is CoordinateDiscoveryCheckpoint["target"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const target = value as Record<string, unknown>;
  if (!Object.keys(target).every((key) => ["url", "goal"].includes(key))) return false;
  if (typeof target.url !== "string" || typeof target.goal !== "string") return false;
  try {
    return (
      new URL(target.url).protocol === "https:" &&
      target.goal.length > 0 &&
      target.goal.length <= 2_000
    );
  } catch {
    return false;
  }
}

function isPoint(value: unknown): value is { x: number; y: number } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const point = value as Record<string, unknown>;
  return (
    Object.keys(point).every((key) => ["x", "y"].includes(key)) &&
    typeof point.x === "number" &&
    Number.isFinite(point.x) &&
    typeof point.y === "number" &&
    Number.isFinite(point.y)
  );
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,127}$/i.test(value);
}

function storeError(code: CoordinateDiscoveryStoreErrorCode): CoordinateDiscoveryStoreError {
  const messages: Record<CoordinateDiscoveryStoreErrorCode, string> = {
    coordinate_directory_not_empty: "Coordinate discovery directory must be empty.",
    unsafe_coordinate_directory: "Coordinate discovery directory is unsafe.",
    invalid_coordinate_checkpoint: "Coordinate discovery checkpoint is invalid.",
    invalid_coordinate_artifact: "Coordinate discovery artifact is invalid.",
    coordinate_store_read_failed: "Coordinate discovery artifact could not be read.",
    coordinate_store_write_failed: "Coordinate discovery artifact could not be persisted.",
  };
  return { ok: false, code, message: messages[code] };
}
