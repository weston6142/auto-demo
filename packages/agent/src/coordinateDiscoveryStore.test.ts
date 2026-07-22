import { mkdtemp, readFile, readdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFileCoordinateDiscoveryStore,
  type CoordinateDiscoveryCheckpoint,
} from "./coordinateDiscoveryStore.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "coordinate-discovery-store-"));
  temporaryDirectories.push(directory);
  return directory;
}

function checkpoint(
  runtimeBindings: Record<string, string> = {},
): CoordinateDiscoveryCheckpoint & { runtimeBindings: Record<string, string> } {
  return {
    schemaVersion: 1,
    sessionId: "discovery-123",
    phase: "discovering",
    target: { url: "https://example.test", goal: "Open the first organic result" },
    pointer: { x: 64, y: 64 },
    frameId: "frame-1",
    transientBindings: Object.keys(runtimeBindings),
    runtimeBindings,
    trace: [],
  };
}

describe("coordinate discovery store", () => {
  it("initializes an empty session directory and replaces checkpoints atomically", async () => {
    const directory = join(await temporaryDirectory(), "workflow", "discovery-123");
    const store = createFileCoordinateDiscoveryStore(directory);

    expect(await store.initialize(checkpoint())).toEqual({ ok: true });
    expect(
      await store.writeCheckpoint({ ...checkpoint(), pointer: { x: 420, y: 245 } }),
    ).toMatchObject({ ok: true, path: "session.json" });
    expect(await store.loadCheckpoint()).toMatchObject({
      ok: true,
      checkpoint: { pointer: { x: 420, y: 245 } },
    });
    expect((await readdir(directory)).some((name) => name.includes(".tmp-"))).toBe(false);
  });

  it("persists transient binding names without persisting their runtime values", async () => {
    const directory = join(await temporaryDirectory(), "discovery-123");
    const store = createFileCoordinateDiscoveryStore(directory);
    const secret = "Sorento private runtime value";

    expect(await store.initialize(checkpoint({ model: secret }))).toEqual({ ok: true });

    const durable = await readFile(join(directory, "session.json"), "utf8");
    expect(durable).not.toContain(secret);
    expect(durable).not.toContain("runtimeBindings");
    expect(await store.loadCheckpoint()).toMatchObject({
      ok: true,
      checkpoint: { transientBindings: ["model"] },
    });
  });

  it("writes only safe exact PNG frame artifacts with hashes", async () => {
    const directory = join(await temporaryDirectory(), "discovery-123");
    const store = createFileCoordinateDiscoveryStore(directory);
    await store.initialize(checkpoint());

    const written = await store.writeFrame({ id: "frame-2", bytes: Buffer.from("png-bytes") });
    expect(written).toMatchObject({
      ok: true,
      path: "frames/frame-2.png",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(await readFile(join(directory, "frames", "frame-2.png"), "utf8")).toBe("png-bytes");
    expect(await store.writeFrame({ id: "../escape", bytes: Buffer.from("bad") })).toMatchObject({
      ok: false,
      code: "invalid_coordinate_artifact",
    });
  });

  it("refuses non-empty or symlinked session roots", async () => {
    const parent = await temporaryDirectory();
    const real = join(parent, "real");
    const first = createFileCoordinateDiscoveryStore(real);
    await first.initialize(checkpoint());
    expect(await createFileCoordinateDiscoveryStore(real).initialize(checkpoint())).toMatchObject({
      ok: false,
      code: "coordinate_directory_not_empty",
    });

    const linked = join(parent, "linked");
    await symlink(real, linked);
    expect(await createFileCoordinateDiscoveryStore(linked).initialize(checkpoint())).toMatchObject(
      {
        ok: false,
        code: "unsafe_coordinate_directory",
      },
    );
  });
});
