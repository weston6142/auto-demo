import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDiscoverSessionHost, type DiscoverHostRuntime } from "./discoverHost.js";
import { sendDiscoverHostRequest } from "./discoverProtocol.js";

const directories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("discover session host", () => {
  it("routes lifecycle requests to one owned runtime and closes it once", async () => {
    const directory = await mkdtemp(join(tmpdir(), "discover-host-"));
    directories.push(directory);
    const calls: unknown[] = [];
    const runtime: DiscoverHostRuntime = {
      async observe() {
        calls.push("observe");
        return { ok: true, frame: { id: "frame-2" } };
      },
      async act(actions) {
        calls.push({ act: actions });
        return { ok: true, executedActions: 1 };
      },
      async status() {
        calls.push("status");
        return { ok: true, status: "discovering" };
      },
      async finish() {
        calls.push("finish");
        return { ok: true, status: "review_required" };
      },
      async abandon() {
        calls.push("abandon");
        return { ok: true, status: "abandoned" };
      },
      async close() {
        calls.push("close");
      },
    };
    const socketPath = join(directory, "host.sock");
    const host = await createDiscoverSessionHost({
      socketPath,
      token: "private-token",
      sessionId: "discovery-123",
      runtime,
    });

    await sendDiscoverHostRequest({
      socketPath,
      token: "private-token",
      request: { command: "observe", sessionId: "discovery-123" },
    });
    await sendDiscoverHostRequest({
      socketPath,
      token: "private-token",
      request: {
        command: "act",
        sessionId: "discovery-123",
        payload: { actions: { frameId: "frame-1", actions: [] } },
      },
    });
    await sendDiscoverHostRequest({
      socketPath,
      token: "private-token",
      request: { command: "finish", sessionId: "discovery-123" },
    });
    await host.close();
    await host.close();

    expect(calls).toEqual([
      "observe",
      { act: { frameId: "frame-1", actions: [] } },
      "finish",
      "close",
    ]);
  });

  it("rejects a mismatched session and malformed action payload", async () => {
    const directory = await mkdtemp(join(tmpdir(), "discover-host-"));
    directories.push(directory);
    let calls = 0;
    const runtime: DiscoverHostRuntime = {
      async observe() {
        calls += 1;
        return { ok: true };
      },
      async act() {
        calls += 1;
        return { ok: true };
      },
      async status() {
        calls += 1;
        return { ok: true };
      },
      async finish() {
        calls += 1;
        return { ok: true };
      },
      async abandon() {
        calls += 1;
        return { ok: true };
      },
      async close() {},
    };
    const socketPath = join(directory, "host.sock");
    const host = await createDiscoverSessionHost({
      socketPath,
      token: "private-token",
      sessionId: "discovery-123",
      runtime,
    });

    const wrongSession = await sendDiscoverHostRequest({
      socketPath,
      token: "private-token",
      request: { command: "status", sessionId: "discovery-999" },
    });
    const badAct = await sendDiscoverHostRequest({
      socketPath,
      token: "private-token",
      request: { command: "act", sessionId: "discovery-123", payload: {} },
    });

    expect(wrongSession).toMatchObject({ ok: false, code: "discover_session_mismatch" });
    expect(badAct).toMatchObject({ ok: false, code: "discover_invalid_request" });
    expect(calls).toBe(0);
    await host.close();
  });
});
