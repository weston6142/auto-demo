import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDiscoverCommand, type DiscoverCommandBackend } from "./discoverCommand.js";

const directories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function backend(): DiscoverCommandBackend & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async start(input) {
      calls.push({ command: "start", input });
      return {
        ok: true,
        sessionId: "discovery-123",
        frame: {
          id: "frame-1",
          screenshotPath: "workflow/discovery-123/frames/frame-1.png",
          width: 1280,
          height: 720,
          deviceScaleFactor: 1,
          pointer: { x: 64, y: 64 },
        },
      };
    },
    async request(sessionId, command, payload) {
      calls.push({ command, sessionId, payload });
      return {
        ok: true,
        sessionId,
        status: command === "finish" ? "review_required" : "discovering",
      };
    },
  };
}

describe("discover CLI command", () => {
  it("starts a headed provider-neutral discovery session", async () => {
    const active = backend();
    const result = await runDiscoverCommand(
      [
        "start",
        "--url",
        "https://example.test/",
        "--goal",
        "Open the first organic result",
        "--risk",
        "yolo",
        "--json",
      ],
      active,
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, sessionId: "discovery-123" });
    expect(active.calls).toEqual([
      {
        command: "start",
        input: {
          url: "https://example.test/",
          goal: "Open the first organic result",
          risk: "yolo",
          allowedOrigins: [],
          grid: false,
        },
      },
    ]);
  });

  it("passes action-file JSON without provider translation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "discover-command-"));
    directories.push(directory);
    const actionsPath = join(directory, "actions.json");
    const actions = {
      frameId: "frame-1",
      actions: [{ type: "click", x: 420, y: 245 }],
    };
    await writeFile(actionsPath, JSON.stringify(actions));
    const active = backend();

    const result = await runDiscoverCommand(
      ["act", "--session", "discovery-123", "--actions-file", actionsPath, "--json"],
      active,
    );

    expect(result.exitCode).toBe(0);
    expect(active.calls).toEqual([
      { command: "act", sessionId: "discovery-123", payload: { actions } },
    ]);
  });

  it.each(["observe", "status", "finish", "abandon"])(
    "routes the %s lifecycle command to the existing session",
    async (command) => {
      const active = backend();
      const result = await runDiscoverCommand(
        [command, "--session", "discovery-123", "--json"],
        active,
      );
      expect(result.exitCode).toBe(0);
      expect(active.calls).toEqual([{ command, sessionId: "discovery-123", payload: undefined }]);
    },
  );

  it("requires JSON and rejects unknown arguments without calling the backend", async () => {
    const active = backend();
    const noJson = await runDiscoverCommand(["status", "--session", "discovery-123"], active);
    const unknown = await runDiscoverCommand(
      ["status", "--session", "discovery-123", "--provider", "codex", "--json"],
      active,
    );

    expect(noJson).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("requires --json"),
    });
    expect(JSON.parse(unknown.stdout)).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_discover_command" }],
    });
    expect(active.calls).toHaveLength(0);
  });
});
