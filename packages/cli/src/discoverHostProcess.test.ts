import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DiscoverHostRuntime } from "./discoverHost.js";
import { runDiscoverHostProcess } from "./discoverHostProcess.js";
import type { DiscoverRuntimeOperationStage } from "./discoverHostDiagnostics.js";
import { allocateDiscoverHostSocket } from "./discoverHostSocket.js";
import { sendDiscoverHostRequest } from "./discoverProtocol.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function stubRuntime(overrides: Partial<DiscoverHostRuntime> = {}): DiscoverHostRuntime {
  return {
    observe: async () => ({ ok: true }),
    act: async () => ({ ok: true }),
    status: async () => ({ ok: true, status: "discovering" }),
    finish: async () => ({ ok: true }),
    abandon: async () => ({ ok: true }),
    close: async () => undefined,
    ...overrides,
  };
}

async function writeBootstrap(sessionDirectory: string): Promise<string> {
  await mkdir(sessionDirectory, { recursive: true });
  const bootstrapPath = join(sessionDirectory, "bootstrap.json");
  await writeFile(
    bootstrapPath,
    JSON.stringify({
      schemaVersion: 1,
      sessionId: "discovery-123",
      sessionDirectory,
      token: "private-token",
      start: {
        url: "https://example.test/",
        goal: "Open results",
        risk: "yolo",
        allowedOrigins: [],
        grid: false,
      },
    }),
  );
  return bootstrapPath;
}

describe("runDiscoverHostProcess", () => {
  it("serves a deliberately long session path through a short private socket", async () => {
    const root = await mkdtemp(join(tmpdir(), "discover-host-process-"));
    directories.push(root);
    const sessionDirectory = join(
      root,
      "a-deliberately-long-workflow-segment-that-would-overflow-the-unix-socket-path-limit-if-sockets-lived-under-it",
      "workflow",
      "discovery-123",
    );
    const bootstrapPath = await writeBootstrap(sessionDirectory);
    let socketDirectory = "";

    await runDiscoverHostProcess(bootstrapPath, {
      createRuntime: async () => ({
        runtime: stubRuntime(),
        initialResponse: { ok: true, sessionId: "discovery-123" },
      }),
      allocateSocket: async () => {
        const allocation = await allocateDiscoverHostSocket();
        socketDirectory = allocation.socketDirectory;
        directories.push(allocation.socketDirectory);
        return allocation;
      },
    });

    const host = JSON.parse(await readFile(join(sessionDirectory, "host.json"), "utf8"));
    expect(host).toMatchObject({ schemaVersion: 1, pid: process.pid });
    expect(host.socketPath).toBe(join(socketDirectory, "host.sock"));
    expect(host.socketPath.startsWith(sessionDirectory)).toBe(false);
    expect(host.socketPath.length).toBeLessThan(104);
    const hostMetadata = await lstat(join(sessionDirectory, "host.json"));
    expect(hostMetadata.mode & 0o777).toBe(0o600);
    const ready = JSON.parse(await readFile(join(sessionDirectory, "ready.json"), "utf8"));
    expect(ready).toEqual({ ok: true, sessionId: "discovery-123" });

    const status = await sendDiscoverHostRequest({
      socketPath: host.socketPath,
      token: "private-token",
      request: { command: "status", sessionId: "discovery-123" },
    });
    expect(status).toEqual({ ok: true, status: "discovering" });

    const abandoned = await sendDiscoverHostRequest({
      socketPath: host.socketPath,
      token: "private-token",
      request: { command: "abandon", sessionId: "discovery-123" },
    });
    expect(abandoned).toEqual({ ok: true });
  });

  it("cleans up the private socket directory when the host closes normally", async () => {
    const root = await mkdtemp(join(tmpdir(), "discover-host-process-"));
    directories.push(root);
    const sessionDirectory = join(root, "workflow", "discovery-123");
    const bootstrapPath = await writeBootstrap(sessionDirectory);
    let socketDirectory = "";
    let runtimeClosed = false;

    await runDiscoverHostProcess(bootstrapPath, {
      createRuntime: async () => ({
        runtime: stubRuntime({
          close: async () => {
            runtimeClosed = true;
          },
        }),
        initialResponse: { ok: true, sessionId: "discovery-123" },
      }),
      allocateSocket: async () => {
        const allocation = await allocateDiscoverHostSocket();
        socketDirectory = allocation.socketDirectory;
        directories.push(allocation.socketDirectory);
        return allocation;
      },
    });

    const host = JSON.parse(await readFile(join(sessionDirectory, "host.json"), "utf8"));
    await sendDiscoverHostRequest({
      socketPath: host.socketPath,
      token: "private-token",
      request: { command: "abandon", sessionId: "discovery-123" },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(runtimeClosed).toBe(true);
    await expect(lstat(socketDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("records bounded startup evidence and cleans up when the socket bind fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "discover-host-process-"));
    directories.push(root);
    const sessionDirectory = join(root, "workflow", "discovery-123");
    const bootstrapPath = await writeBootstrap(sessionDirectory);
    const stages: DiscoverRuntimeOperationStage[] = [];
    let runtimeClosed = false;
    let cleanedUp = false;

    await runDiscoverHostProcess(bootstrapPath, {
      createRuntime: async () => ({
        runtime: stubRuntime({
          close: async () => {
            runtimeClosed = true;
          },
        }),
        initialResponse: { ok: true, sessionId: "discovery-123" },
        recordStartupFailure: async (stage) => {
          stages.push(stage);
        },
      }),
      allocateSocket: async () => ({
        socketDirectory: join(root, "missing"),
        socketPath: join(root, "missing", "host.sock"),
        cleanup: async () => {
          cleanedUp = true;
        },
      }),
    });

    const ready = JSON.parse(await readFile(join(sessionDirectory, "ready.json"), "utf8"));
    expect(ready).toEqual({
      ok: false,
      code: "discovery_host_start_failed",
      message: "Discover host did not become ready.",
    });
    expect(JSON.stringify(ready)).not.toContain(root);
    await expect(lstat(join(sessionDirectory, "host.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(stages).toEqual(["host_socket_bind"]);
    expect(runtimeClosed).toBe(true);
    expect(cleanedUp).toBe(true);
  });

  it.each(["host.json", "ready.json"])(
    "closes the runtime and socket when publishing %s fails",
    async (failedFilename) => {
      const root = await mkdtemp(join(tmpdir(), "discover-host-process-"));
      directories.push(root);
      const sessionDirectory = join(root, "workflow", "discovery-123");
      const bootstrapPath = await writeBootstrap(sessionDirectory);
      let runtimeClosed = false;
      let socketCleaned = false;

      await runDiscoverHostProcess(bootstrapPath, {
        createRuntime: async () => ({
          runtime: stubRuntime({
            close: async () => {
              runtimeClosed = true;
            },
          }),
          initialResponse: { ok: true, sessionId: "discovery-123" },
        }),
        allocateSocket: async () => {
          const allocation = await allocateDiscoverHostSocket(root);
          directories.push(allocation.socketDirectory);
          return {
            ...allocation,
            cleanup: async () => {
              socketCleaned = true;
              await allocation.cleanup();
            },
          };
        },
        writeJson: async (path, value, mode) => {
          if (path.endsWith(failedFilename)) throw new Error("injected publication failure");
          await writeFile(path, `${JSON.stringify(value)}\n`, {
            ...(mode === undefined ? {} : { mode }),
          });
        },
      });

      expect(runtimeClosed).toBe(true);
      expect(socketCleaned).toBe(true);
    },
  );
});
