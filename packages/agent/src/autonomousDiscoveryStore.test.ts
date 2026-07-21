import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createDiscoverySession } from "./discoverySession.js";
import {
  createFileAutonomousDiscoveryStore,
  type AutonomousDiscoveryRunCheckpoint,
} from "./autonomousDiscoveryStore.js";

const PROFILE = {
  schemaVersion: 1,
  browser: "chromium",
  channel: "bundled",
  headless: true,
  viewport: { width: 1280, height: 720 },
} as const;

const CHECKPOINT: AutonomousDiscoveryRunCheckpoint = {
  schemaVersion: 1,
  runId: "run-1",
  phase: "discovering",
  policySelection: { mode: "yolo" },
  target: { url: "https://example.com/search", goal: "Find one vehicle" },
  launchProfile: PROFILE,
  artifacts: {},
};

function session() {
  const result = createDiscoverySession({
    id: "session-1",
    target: { kind: "browser", startUrl: CHECKPOINT.target.url },
    goal: CHECKPOINT.target.goal,
    host: { name: "codex", version: "1" },
    launchProfile: PROFILE,
    createdAt: "2026-07-20T12:00:00.000Z",
  });
  if (!result.ok) throw new Error("fixture session must validate");
  return result.session;
}

describe("file autonomous discovery store", () => {
  it("writes and reloads bounded PNGs without serializing bytes into JSON artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "autodemo-runner-store-"));
    const directory = join(root, "run-1");
    const store = createFileAutonomousDiscoveryStore(directory);
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await store.initialize(CHECKPOINT);

    await expect(
      store.writeVisualArtifact({ id: "artifact-1", bytes, mediaType: "image/png", sha256 }),
    ).resolves.toEqual({ ok: true, path: "visuals/artifact-1.png" });
    await expect(
      store.loadVisualArtifact({
        id: "artifact-1",
        kind: "screenshot",
        path: "visuals/artifact-1.png",
        mediaType: "image/png",
        sha256,
      }),
    ).resolves.toEqual({ ok: true, bytes });
    expect(await readFile(join(directory, "visuals/artifact-1.png"))).toEqual(Buffer.from(bytes));
    expect(await readFile(join(directory, "run.json"), "utf8")).not.toContain("137,80,78,71");
  });

  it("rejects unsafe or mismatched visual artifact references", async () => {
    const root = await mkdtemp(join(tmpdir(), "autodemo-runner-store-"));
    const store = createFileAutonomousDiscoveryStore(join(root, "run-1"));
    const bytes = new Uint8Array([1, 2, 3]);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await store.initialize(CHECKPOINT);
    await store.writeVisualArtifact({ id: "artifact-1", bytes, mediaType: "image/png", sha256 });

    await expect(
      store.loadVisualArtifact({
        id: "artifact-1",
        kind: "screenshot",
        path: "../artifact-1.png",
        mediaType: "image/png",
        sha256,
      }),
    ).resolves.toMatchObject({ ok: false, code: "invalid_runner_artifact" });
    await expect(
      store.loadVisualArtifact({
        id: "artifact-1",
        kind: "screenshot",
        path: "visuals/artifact-1.png",
        mediaType: "image/png",
        sha256: "0".repeat(64),
      }),
    ).resolves.toMatchObject({ ok: false, code: "invalid_runner_artifact" });
  });
  it("initializes an empty workflow and atomically persists typed artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "autodemo-runner-store-"));
    const directory = join(root, "run-1");
    const store = createFileAutonomousDiscoveryStore(directory);

    await expect(store.initialize(CHECKPOINT)).resolves.toEqual({ ok: true });
    await expect(store.writeSession("root", session())).resolves.toEqual({
      ok: true,
      path: "sessions/root.json",
    });

    expect(JSON.parse(await readFile(join(directory, "sessions/root.json"), "utf8"))).toEqual(
      session(),
    );
    expect(await store.loadCheckpoint()).toEqual({ ok: true, checkpoint: CHECKPOINT });
  });

  it("rejects initialization into a non-empty workflow directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "autodemo-runner-store-"));
    const directory = join(root, "existing");
    await mkdir(directory);
    await writeFile(join(directory, "keep.txt"), "keep");

    await expect(
      createFileAutonomousDiscoveryStore(directory).initialize(CHECKPOINT),
    ).resolves.toEqual({
      ok: false,
      code: "workflow_directory_not_empty",
      message: "Autonomous discovery workflow directory must be missing or empty.",
    });
    expect(await readFile(join(directory, "keep.txt"), "utf8")).toBe("keep");
  });

  it("rejects malformed checkpoints with a fixed non-secret error", async () => {
    const root = await mkdtemp(join(tmpdir(), "autodemo-runner-store-"));
    const directory = join(root, "run-1");
    await mkdir(directory);
    await writeFile(
      join(directory, "run.json"),
      JSON.stringify({ ...CHECKPOINT, policySelection: {} }),
    );

    await expect(createFileAutonomousDiscoveryStore(directory).loadCheckpoint()).resolves.toEqual({
      ok: false,
      code: "invalid_runner_checkpoint",
      message: "Autonomous discovery checkpoint is invalid.",
    });
  });

  it("owns repair paths and rejects ordinals outside the bounded replay contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "autodemo-runner-store-"));
    const store = createFileAutonomousDiscoveryStore(join(root, "run-1"));
    await store.initialize(CHECKPOINT);

    await expect(store.writeSession("repair-3" as "repair-1", session())).resolves.toEqual({
      ok: false,
      code: "invalid_runner_artifact",
      message: "Autonomous discovery artifact is invalid.",
    });
  });

  it("never persists runtime bindings because the artifact contract has no value-bearing input", async () => {
    const root = await mkdtemp(join(tmpdir(), "autodemo-runner-store-"));
    const directory = join(root, "run-1");
    const store = createFileAutonomousDiscoveryStore(directory);
    await store.initialize(CHECKPOINT);
    await store.writeSession("root", session());

    const checkpointText = await readFile(join(directory, "run.json"), "utf8");
    const sessionText = await readFile(join(directory, "sessions/root.json"), "utf8");
    expect(`${checkpointText}${sessionText}`).not.toContain("inputBindings");
    expect(`${checkpointText}${sessionText}`).not.toContain("10001");
  });

  it("rejects arbitrary value-bearing execution artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "autodemo-runner-store-"));
    const store = createFileAutonomousDiscoveryStore(join(root, "run-1"));
    await store.initialize(CHECKPOINT);

    await expect(
      store.writeExecution({
        schemaVersion: 1,
        status: "completed",
        stepCount: 1,
        capture: {
          outputDir: "capture",
          manifestPath: "capture/capture.manifest.json",
          mediaPath: "capture/media/viewport.webm",
          metadataPath: "capture/metadata/events.jsonl",
          startedAt: "2026-07-20T12:00:00.000Z",
          endedAt: "2026-07-20T12:01:00.000Z",
          durationMs: 60_000,
        },
        inputBindings: { "demo-zip": "10001" },
      } as never),
    ).resolves.toEqual({
      ok: false,
      code: "invalid_runner_artifact",
      message: "Autonomous discovery artifact is invalid.",
    });
  });

  it("rejects unbounded or malformed review fingerprints", async () => {
    const root = await mkdtemp(join(tmpdir(), "autodemo-runner-store-"));
    const store = createFileAutonomousDiscoveryStore(join(root, "run-1"));
    await store.initialize(CHECKPOINT);

    await expect(
      store.writeReview({
        schemaVersion: 1,
        planFingerprint: "runtime-value",
        approval: { eligible: true, basis: "validated" },
        blockerCount: 0,
      }),
    ).resolves.toEqual({
      ok: false,
      code: "invalid_runner_artifact",
      message: "Autonomous discovery artifact is invalid.",
    });
  });
});
