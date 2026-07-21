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
  policy: { mode: "yolo" },
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
    await writeFile(join(directory, "run.json"), JSON.stringify({ ...CHECKPOINT, policy: {} }));

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
});
