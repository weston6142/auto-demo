import { rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDiscoverSessionHost } from "./discoverHost.js";
import { allocateDiscoverHostSocket } from "./discoverHostSocket.js";
import {
  createPlaywrightDiscoverRuntime,
  readDiscoverBootstrap,
} from "./playwrightDiscoverRuntime.js";

export type DiscoverHostProcessDependencies = {
  createRuntime?: typeof createPlaywrightDiscoverRuntime;
  allocateSocket?: typeof allocateDiscoverHostSocket;
  writeJson?: typeof atomicJson;
};

export async function runDiscoverHostProcess(
  bootstrapPath: string,
  dependencies: DiscoverHostProcessDependencies = {},
): Promise<void> {
  let bootstrap;
  try {
    bootstrap = await readDiscoverBootstrap(bootstrapPath);
  } catch {
    return;
  }
  const createRuntime = dependencies.createRuntime ?? createPlaywrightDiscoverRuntime;
  const created = await createRuntime(bootstrap).catch(() => undefined);
  if (created === undefined || !created.initialResponse.ok) {
    await atomicJson(
      join(bootstrap.sessionDirectory, "ready.json"),
      created?.initialResponse ?? startFailure(),
    ).catch(() => undefined);
    await created?.runtime.close().catch(() => undefined);
    return;
  }
  const allocateSocket = dependencies.allocateSocket ?? allocateDiscoverHostSocket;
  const writeJson = dependencies.writeJson ?? atomicJson;
  let socket: Awaited<ReturnType<typeof allocateDiscoverHostSocket>> | undefined;
  let host: Awaited<ReturnType<typeof createDiscoverSessionHost>>;
  try {
    socket = await allocateSocket();
    host = await createDiscoverSessionHost({
      socketPath: socket.socketPath,
      token: bootstrap.token,
      sessionId: bootstrap.sessionId,
      runtime: {
        ...created.runtime,
        close: async () => {
          await created.runtime.close();
          await socket?.cleanup().catch(() => undefined);
        },
      },
    });
  } catch {
    await created.recordStartupFailure?.("host_socket_bind").catch(() => undefined);
    await atomicJson(join(bootstrap.sessionDirectory, "ready.json"), startFailure()).catch(
      () => undefined,
    );
    await created.runtime.close().catch(() => undefined);
    await socket?.cleanup().catch(() => undefined);
    return;
  }
  // Unreachable: the try block assigns socket or the catch returns. TypeScript
  // cannot narrow the assignment across the try/catch boundary.
  if (socket === undefined) return;
  const hostMetadataPath = join(bootstrap.sessionDirectory, "host.json");
  try {
    await writeJson(
      hostMetadataPath,
      {
        schemaVersion: 1,
        socketPath: socket.socketPath,
        pid: process.pid,
      },
      0o600,
    );
    await writeJson(join(bootstrap.sessionDirectory, "ready.json"), created.initialResponse);
  } catch {
    await created.recordStartupFailure?.("host_metadata_publish").catch(() => undefined);
    await host.close().catch(() => undefined);
    await socket.cleanup().catch(() => undefined);
    await rm(hostMetadataPath, { force: true }).catch(() => undefined);
    return;
  }

  const close = () => void host.close().finally(() => process.exit(0));
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

function startFailure() {
  return {
    ok: false,
    code: "discovery_host_start_failed",
    message: "Discover host did not become ready.",
  };
}

async function atomicJson(path: string, value: unknown, mode?: number): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
      ...(mode === undefined ? {} : { mode }),
    });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
