import { lstat, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDiscoverHostServer, sendDiscoverHostRequest } from "./discoverProtocol.js";

const directories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("discover host protocol", () => {
  it("serves one authenticated bounded JSON request per connection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "discover-protocol-"));
    directories.push(directory);
    const socketPath = join(directory, "host.sock");
    const received: unknown[] = [];
    const server = await createDiscoverHostServer({
      socketPath,
      token: "private-token",
      async handle(request) {
        received.push(request);
        return { ok: true, status: "discovering" };
      },
    });

    const response = await sendDiscoverHostRequest({
      socketPath,
      token: "private-token",
      request: { command: "status", sessionId: "discovery-123" },
    });

    expect(response).toEqual({ ok: true, status: "discovering" });
    expect(received).toEqual([{ command: "status", sessionId: "discovery-123" }]);
    expect((await lstat(socketPath)).mode & 0o777).toBe(0o600);
    await server.close();
  });

  it("keeps the response side open while a browser action is in flight", async () => {
    const directory = await mkdtemp(join(tmpdir(), "discover-protocol-"));
    directories.push(directory);
    const socketPath = join(directory, "host.sock");
    const server = await createDiscoverHostServer({
      socketPath,
      token: "private-token",
      async handle() {
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        return { ok: true, executedActions: 1 };
      },
    });

    await expect(
      sendDiscoverHostRequest({
        socketPath,
        token: "private-token",
        request: { command: "act", sessionId: "discovery-123" },
      }),
    ).resolves.toEqual({ ok: true, executedActions: 1 });
    await server.close();
  });

  it("rejects an invalid token before invoking the session handler", async () => {
    const directory = await mkdtemp(join(tmpdir(), "discover-protocol-"));
    directories.push(directory);
    const socketPath = join(directory, "host.sock");
    let calls = 0;
    const server = await createDiscoverHostServer({
      socketPath,
      token: "private-token",
      async handle() {
        calls += 1;
        return { ok: true };
      },
    });

    await expect(
      sendDiscoverHostRequest({
        socketPath,
        token: "wrong-token",
        request: { command: "status", sessionId: "discovery-123" },
      }),
    ).resolves.toEqual({
      ok: false,
      code: "discover_authentication_failed",
      message: "Discover host request was rejected.",
    });
    expect(calls).toBe(0);
    await server.close();
  });

  it("fails closed when a request exceeds the protocol size bound", async () => {
    const directory = await mkdtemp(join(tmpdir(), "discover-protocol-"));
    directories.push(directory);
    const socketPath = join(directory, "host.sock");
    const server = await createDiscoverHostServer({
      socketPath,
      token: "private-token",
      async handle() {
        throw new Error("oversized request must not execute");
      },
    });

    await expect(
      sendDiscoverHostRequest({
        socketPath,
        token: "private-token",
        request: {
          command: "act",
          sessionId: "discovery-123",
          payload: "x".repeat(300_000),
        },
      }),
    ).resolves.toMatchObject({ ok: false, code: "discover_request_too_large" });
    await server.close();
  });
});
