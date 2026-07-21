import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDiscoverSessionHost } from "./discoverHost.js";
import {
  createPlaywrightDiscoverRuntime,
  readDiscoverBootstrap,
} from "./playwrightDiscoverRuntime.js";

export async function runDiscoverHostProcess(bootstrapPath: string): Promise<void> {
  let bootstrap;
  try {
    bootstrap = await readDiscoverBootstrap(bootstrapPath);
  } catch {
    return;
  }
  const created = await createPlaywrightDiscoverRuntime(bootstrap).catch(() => undefined);
  if (created === undefined || !created.initialResponse.ok) {
    await atomicJson(
      join(bootstrap.sessionDirectory, "ready.json"),
      created?.initialResponse ?? {
        ok: false,
        code: "discovery_host_start_failed",
        message: "Discover host did not become ready.",
      },
    ).catch(() => undefined);
    await created?.runtime.close().catch(() => undefined);
    return;
  }
  const socketPath = join(bootstrap.sessionDirectory, "host.sock");
  const host = await createDiscoverSessionHost({
    socketPath,
    token: bootstrap.token,
    sessionId: bootstrap.sessionId,
    runtime: created.runtime,
  });
  await atomicJson(join(bootstrap.sessionDirectory, "host.json"), {
    schemaVersion: 1,
    socketPath,
    pid: process.pid,
  });
  await atomicJson(join(bootstrap.sessionDirectory, "ready.json"), created.initialResponse);

  const close = () => void host.close().finally(() => process.exit(0));
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, path);
}
