import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileDiscoverCommandBackend } from "./discoverBackend.js";
import { allocateDiscoverHostSocket } from "./discoverHostSocket.js";
import { createDiscoverHostServer, type DiscoverHostServer } from "./discoverProtocol.js";

const directories: string[] = [];
const servers: DiscoverHostServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("file discover command backend", () => {
  it("starts once and reconnects later commands from validated private socket metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "discover-backend-"));
    directories.push(root);
    const workflowDirectory = join(
      root,
      "a-deliberately-long-workflow-segment-that-would-overflow-the-unix-socket-path-limit-if-sockets-lived-under-it",
      "workflow",
    );
    const backend = createFileDiscoverCommandBackend({
      workflowDirectory,
      idGenerator: () => "discovery-123",
      tokenGenerator: () => "private-token",
      async launch(bootstrapPath) {
        const bootstrap = JSON.parse(await readFile(bootstrapPath, "utf8"));
        const allocation = await allocateDiscoverHostSocket();
        directories.push(allocation.socketDirectory);
        servers.push(
          await createDiscoverHostServer({
            socketPath: allocation.socketPath,
            token: bootstrap.token,
            async handle(request) {
              return { ok: true, sessionId: request.sessionId, status: "discovering" };
            },
          }),
        );
        await writeFile(
          join(bootstrap.sessionDirectory, "host.json"),
          JSON.stringify({ schemaVersion: 1, socketPath: allocation.socketPath, pid: process.pid }),
        );
        await writeFile(
          join(bootstrap.sessionDirectory, "ready.json"),
          JSON.stringify({
            ok: true,
            sessionId: bootstrap.sessionId,
            frame: {
              id: "frame-1",
              screenshotPath: "workflow/discovery-123/frames/frame-1.png",
              width: 1280,
              height: 720,
              deviceScaleFactor: 1,
              pointer: { x: 64, y: 64 },
            },
          }),
        );
      },
      pollIntervalMs: 1,
      startupTimeoutMs: 100,
    });

    const started = await backend.start({
      url: "https://example.test/",
      goal: "Open the first organic result",
      risk: "yolo",
      allowedOrigins: [],
      grid: false,
    });
    const status = await backend.request("discovery-123", "status");

    expect(started).toMatchObject({ ok: true, sessionId: "discovery-123" });
    expect(status).toEqual({ ok: true, sessionId: "discovery-123", status: "discovering" });
    expect(await readFile(join(workflowDirectory, "discovery-123", ".host-token"), "utf8")).toBe(
      "private-token",
    );
  });

  it("refuses to connect through host metadata pointing at an untrusted socket directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "discover-backend-"));
    directories.push(root);
    const workflowDirectory = join(root, "workflow");
    const backend = createFileDiscoverCommandBackend({
      workflowDirectory,
      idGenerator: () => "discovery-123",
      tokenGenerator: () => "private-token",
      async launch(bootstrapPath) {
        const bootstrap = JSON.parse(await readFile(bootstrapPath, "utf8"));
        const allocation = await allocateDiscoverHostSocket();
        directories.push(allocation.socketDirectory);
        servers.push(
          await createDiscoverHostServer({
            socketPath: allocation.socketPath,
            token: bootstrap.token,
            async handle(request) {
              return { ok: true, sessionId: request.sessionId, status: "discovering" };
            },
          }),
        );
        await chmod(allocation.socketDirectory, 0o755);
        await writeFile(
          join(bootstrap.sessionDirectory, "host.json"),
          JSON.stringify({ schemaVersion: 1, socketPath: allocation.socketPath, pid: process.pid }),
        );
        await writeFile(
          join(bootstrap.sessionDirectory, "ready.json"),
          JSON.stringify({ ok: true, sessionId: bootstrap.sessionId }),
        );
      },
      pollIntervalMs: 1,
      startupTimeoutMs: 100,
    });

    await backend.start({
      url: "https://example.test/",
      goal: "Open the first organic result",
      risk: "yolo",
      allowedOrigins: [],
      grid: false,
    });

    await expect(backend.request("discovery-123", "status")).resolves.toEqual({
      ok: false,
      code: "discovery_host_unavailable",
      message: "Discover host is unavailable.",
    });
  });

  it("fails safely when the detached host does not become ready", async () => {
    const workflowDirectory = await mkdtemp(join(tmpdir(), "discover-backend-"));
    directories.push(workflowDirectory);
    const backend = createFileDiscoverCommandBackend({
      workflowDirectory,
      idGenerator: () => "discovery-123",
      tokenGenerator: () => "private-token",
      async launch() {},
      pollIntervalMs: 1,
      startupTimeoutMs: 5,
    });

    await expect(
      backend.start({
        url: "https://example.test/",
        goal: "Open results",
        risk: "yolo",
        allowedOrigins: [],
        grid: false,
      }),
    ).resolves.toEqual({
      ok: false,
      code: "discovery_host_start_failed",
      message: "Discover host did not become ready.",
    });
  });
});
