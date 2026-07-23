import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { DiscoverCommandBackend, DiscoverStartInput } from "./discoverCommand.js";
import { isTrustedDiscoverHostSocketPath } from "./discoverHostSocket.js";
import { sendDiscoverHostRequest } from "./discoverProtocol.js";

export type DiscoverHostBootstrap = {
  schemaVersion: 1;
  sessionId: string;
  sessionDirectory: string;
  token: string;
  start: DiscoverStartInput;
};

export type FileDiscoverBackendOptions = {
  workflowDirectory: string;
  launch(bootstrapPath: string): Promise<void>;
  idGenerator?: () => string;
  tokenGenerator?: () => string;
  pollIntervalMs?: number;
  startupTimeoutMs?: number;
};

export function createFileDiscoverCommandBackend(
  options: FileDiscoverBackendOptions,
): DiscoverCommandBackend {
  const idGenerator = options.idGenerator ?? (() => `discovery-${randomUUID()}`);
  const tokenGenerator = options.tokenGenerator ?? (() => randomBytes(32).toString("hex"));
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  const startupTimeoutMs = options.startupTimeoutMs ?? 5_000;

  return {
    async start(start) {
      const sessionId = idGenerator();
      if (!isSafeId(sessionId)) return startFailure();
      const sessionDirectory = resolve(options.workflowDirectory, sessionId);
      if (sessionDirectory !== join(resolve(options.workflowDirectory), sessionId)) {
        return startFailure();
      }
      const token = tokenGenerator();
      if (!/^[a-z0-9-]{8,128}$/i.test(token)) return startFailure();
      const bootstrapPath = join(sessionDirectory, "bootstrap.json");
      try {
        await mkdir(resolve(options.workflowDirectory), { recursive: true });
        await mkdir(sessionDirectory, { recursive: false });
        await writeFile(join(sessionDirectory, ".host-token"), token, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        const bootstrap: DiscoverHostBootstrap = {
          schemaVersion: 1,
          sessionId,
          sessionDirectory,
          token,
          start,
        };
        await writeFile(bootstrapPath, `${JSON.stringify(bootstrap)}\n`, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        await options.launch(bootstrapPath);
        const readyPath = join(sessionDirectory, "ready.json");
        const deadline = Date.now() + startupTimeoutMs;
        while (Date.now() <= deadline) {
          const ready = await readJson(readyPath);
          if (isResponse(ready)) {
            await unlink(bootstrapPath).catch(() => undefined);
            return ready;
          }
          await wait(pollIntervalMs);
        }
      } catch {
        // A bounded public startup failure is returned below.
      }
      await unlink(bootstrapPath).catch(() => undefined);
      return startFailure();
    },

    async request(sessionId, command, payload) {
      if (!isSafeId(sessionId)) return unavailable();
      const sessionDirectory = resolve(options.workflowDirectory, sessionId);
      if (sessionDirectory !== join(resolve(options.workflowDirectory), sessionId)) {
        return unavailable();
      }
      try {
        const tokenPath = join(sessionDirectory, ".host-token");
        const tokenMetadata = await lstat(tokenPath);
        if (!tokenMetadata.isFile() || tokenMetadata.isSymbolicLink()) return unavailable();
        const token = await readFile(tokenPath, "utf8");
        const host = await readJson(join(sessionDirectory, "host.json"));
        if (
          !isRecord(host) ||
          host.schemaVersion !== 1 ||
          typeof host.socketPath !== "string" ||
          typeof host.pid !== "number" ||
          !Number.isInteger(host.pid) ||
          host.pid < 1 ||
          !(await isTrustedDiscoverHostSocketPath(host.socketPath))
        ) {
          return unavailable();
        }
        return await sendDiscoverHostRequest({
          socketPath: host.socketPath,
          token,
          request: { command, sessionId, ...(payload === undefined ? {} : { payload }) },
        });
      } catch {
        return unavailable();
      }
    },
  };
}

export async function launchDetachedDiscoverHost(bootstrapPath: string): Promise<void> {
  const entryPath = process.argv[1];
  if (entryPath === undefined) throw new Error("discover host entry unavailable");
  const log = await open(join(dirname(bootstrapPath), "host.log"), "a", 0o600);
  try {
    const child = spawn(
      process.execPath,
      [entryPath, "__discover-host", "--bootstrap", bootstrapPath],
      {
        detached: true,
        stdio: ["ignore", log.fd, log.fd],
      },
    );
    child.unref();
  } finally {
    await log.close();
  }
}

async function readJson(path: string): Promise<unknown> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 256_000)
      return undefined;
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

function isResponse(value: unknown): value is Record<string, unknown> & { ok: boolean } {
  return isRecord(value) && typeof value.ok === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,127}$/i.test(value);
}

function startFailure() {
  return {
    ok: false as const,
    code: "discovery_host_start_failed",
    message: "Discover host did not become ready.",
  };
}

function unavailable() {
  return {
    ok: false as const,
    code: "discovery_host_unavailable",
    message: "Discover host is unavailable.",
  };
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, durationMs));
}
