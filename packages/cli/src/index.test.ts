import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeCaptureManifest, type CaptureOutput } from "@auto-demo/capture";
import { runCli, runCliAsync } from "./index.js";

function fakeCaptureOutput(outputDir: string): CaptureOutput {
  return {
    outputDir,
    manifestPath: `${outputDir}/capture.manifest.json`,
    media: {
      kind: "viewport",
      path: `${outputDir}/media/viewport.webm`,
      contentType: "video/webm",
    },
    metadata: {
      kind: "events",
      path: `${outputDir}/metadata/events.jsonl`,
      contentType: "application/x-ndjson",
    },
    timing: {
      startedAt: "2026-06-28T12:00:00.000Z",
      endedAt: "2026-06-28T12:00:02.500Z",
      durationMs: 2500,
    },
  };
}

async function createValidCaptureBundle(): Promise<string> {
  const outputDir = join(tmpdir(), "auto-demo-cli-validate");
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(join(outputDir, "media"), { recursive: true });
  await mkdir(join(outputDir, "metadata"), { recursive: true });
  await writeFile(join(outputDir, "media", "viewport.webm"), "video");
  await writeFile(join(outputDir, "metadata", "events.jsonl"), "{}\n");
  await writeCaptureManifest({
    outputDir,
    status: "completed",
    source: { kind: "browser", url: "https://example.com/demo" },
    adapter: { kind: "browser", backend: "playwright" },
    viewport: { width: 1280, height: 720 },
    timing: {
      startedAt: "2026-06-29T12:00:00.000Z",
      endedAt: "2026-06-29T12:00:02.500Z",
      durationMs: 2500,
    },
    artifacts: {
      media: join(outputDir, "media", "viewport.webm"),
      events: join(outputDir, "metadata", "events.jsonl"),
    },
    childCommand: null,
    error: null,
  });
  return outputDir;
}

describe("runCli", () => {
  it("prints help with a zero exit code", () => {
    const result = runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: autodemo <command>");
    expect(result.stderr).toBe("");
  });

  it("fails clearly for planned but unimplemented non-capture commands", () => {
    const result = runCli(["generate"]);

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "autodemo generate is not implemented yet.\n",
    });
  });

  it("prints help and fails for unknown commands", () => {
    const result = runCli(["wat"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Usage: autodemo <command>");
    expect(result.stderr).toBe("Unknown command: wat\n");
  });
});

describe("runCliAsync capture", () => {
  it("prints capture help with a zero exit code", async () => {
    const result = await runCliAsync(["capture", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: autodemo capture --url <url> --out <capture-dir>");
    expect(result.stdout).toContain("--viewport <width>x<height>");
    expect(result.stdout).toContain("-- [walkthrough command...]");
    expect(result.stderr).toBe("");
  });

  it("requires --url", async () => {
    const result = await runCliAsync(["capture", "--out", "demo-capture"]);

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "autodemo capture requires --url <url>.\n",
    });
  });

  it("requires --out", async () => {
    const result = await runCliAsync(["capture", "--url", "https://example.com"]);

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "autodemo capture requires --out <capture-dir>.\n",
    });
  });

  it("rejects invalid viewport values", async () => {
    const result = await runCliAsync([
      "capture",
      "--url",
      "https://example.com",
      "--out",
      "demo-capture",
      "--viewport",
      "wide",
    ]);

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "autodemo capture --viewport must use <width>x<height>, for example 1280x720.\n",
    });
  });

  it("passes capture options to the browser adapter", async () => {
    const starts: unknown[] = [];
    const childCommands: unknown[] = [];

    const result = await runCliAsync(
      [
        "capture",
        "--url",
        "https://example.com",
        "--out",
        "demo-capture",
        "--viewport",
        "1440x900",
        "--",
        "npm",
        "run",
        "demo:walkthrough",
      ],
      {
        now: () => new Date("2026-06-28T12:00:00.000Z"),
        async runChildCommand(command) {
          childCommands.push(command);
          return { exitCode: 0 };
        },
        browserCaptureAdapter: {
          kind: "browser",
          async start(options) {
            starts.push(options);
            return {
              ok: true,
              outputDir: options.outputDir,
              manifestPath: `${options.outputDir}/capture.manifest.json`,
              session: {
                outputDir: options.outputDir,
                manifestPath: `${options.outputDir}/capture.manifest.json`,
                async stop() {
                  return {
                    ok: true,
                    output: fakeCaptureOutput(options.outputDir),
                  };
                },
              },
            };
          },
        },
      },
    );

    expect(result).toEqual({
      exitCode: 0,
      stdout: "Capture bundle: demo-capture/capture.manifest.json\n",
      stderr: "",
    });
    expect(starts).toEqual([
      {
        source: { kind: "browser", url: "https://example.com" },
        outputDir: "demo-capture",
        viewport: { width: 1440, height: 900 },
        startedAt: "2026-06-28T12:00:00.000Z",
        childCommand: {
          command: "npm",
          args: ["run", "demo:walkthrough"],
        },
      },
    ]);
    expect(childCommands).toEqual([{ command: "npm", args: ["run", "demo:walkthrough"] }]);
  });

  it("stops the capture after the child command completes", async () => {
    const events: string[] = [];

    const result = await runCliAsync(
      ["capture", "--url", "https://example.com", "--out", "demo-capture", "--", "npm", "test"],
      {
        now: () => new Date("2026-06-28T12:00:00.000Z"),
        async runChildCommand() {
          events.push("child");
          return { exitCode: 0 };
        },
        browserCaptureAdapter: {
          kind: "browser",
          async start(options) {
            events.push("start");
            return {
              ok: true,
              outputDir: options.outputDir,
              manifestPath: `${options.outputDir}/capture.manifest.json`,
              session: {
                outputDir: options.outputDir,
                manifestPath: `${options.outputDir}/capture.manifest.json`,
                async stop(reason) {
                  events.push(`stop:${reason}`);
                  return {
                    ok: true,
                    output: fakeCaptureOutput(options.outputDir),
                  };
                },
              },
            };
          },
        },
      },
    );

    expect(result).toEqual({
      exitCode: 0,
      stdout: "Capture bundle: demo-capture/capture.manifest.json\n",
      stderr: "",
    });
    expect(events).toEqual(["start", "child", "stop:completed"]);
  });

  it("stops a started capture as failed when the child command fails", async () => {
    const stopReasons: string[] = [];

    const result = await runCliAsync(
      ["capture", "--url", "https://example.com", "--out", "demo-capture", "--", "npm", "test"],
      {
        now: () => new Date("2026-06-28T12:00:00.000Z"),
        async runChildCommand() {
          return { exitCode: 7 };
        },
        browserCaptureAdapter: {
          kind: "browser",
          async start(options) {
            return {
              ok: true,
              outputDir: options.outputDir,
              manifestPath: `${options.outputDir}/capture.manifest.json`,
              session: {
                outputDir: options.outputDir,
                manifestPath: `${options.outputDir}/capture.manifest.json`,
                async stop(reason) {
                  stopReasons.push(reason);
                  return {
                    ok: true,
                    output: fakeCaptureOutput(options.outputDir),
                  };
                },
              },
            };
          },
        },
      },
    );

    expect(result).toEqual({
      exitCode: 7,
      stdout: "Capture bundle: demo-capture/capture.manifest.json\n",
      stderr: "Child command exited with code 7.\n",
    });
    expect(stopReasons).toEqual(["failed"]);
  });

  it("stops a started capture as failed when the child command throws", async () => {
    const stopReasons: string[] = [];

    await expect(
      runCliAsync(
        ["capture", "--url", "https://example.com", "--out", "demo-capture", "--", "npm", "test"],
        {
          now: () => new Date("2026-06-28T12:00:00.000Z"),
          async runChildCommand() {
            throw new Error("spawn failed");
          },
          browserCaptureAdapter: {
            kind: "browser",
            async start(options) {
              return {
                ok: true,
                outputDir: options.outputDir,
                manifestPath: `${options.outputDir}/capture.manifest.json`,
                session: {
                  outputDir: options.outputDir,
                  manifestPath: `${options.outputDir}/capture.manifest.json`,
                  async stop(reason) {
                    stopReasons.push(reason);
                    return {
                      ok: true,
                      output: fakeCaptureOutput(options.outputDir),
                    };
                  },
                },
              };
            },
          },
        },
      ),
    ).rejects.toThrow("spawn failed");
    expect(stopReasons).toEqual(["failed"]);
  });

  it("keeps manual capture running until interrupted", async () => {
    const stopReasons: string[] = [];

    const runPromise = runCliAsync(
      ["capture", "--url", "https://example.com", "--out", "demo-capture"],
      {
        now: () => new Date("2026-06-28T12:00:00.000Z"),
        async runChildCommand() {
          return { exitCode: 0 };
        },
        browserCaptureAdapter: {
          kind: "browser",
          async start(options) {
            return {
              ok: true,
              outputDir: options.outputDir,
              manifestPath: `${options.outputDir}/capture.manifest.json`,
              session: {
                outputDir: options.outputDir,
                manifestPath: `${options.outputDir}/capture.manifest.json`,
                async stop(reason) {
                  stopReasons.push(reason);
                  return {
                    ok: true,
                    output: fakeCaptureOutput(options.outputDir),
                  };
                },
              },
            };
          },
        },
      },
    );

    const earlyOutcome = await Promise.race([
      runPromise,
      new Promise<"waiting">((resolve) => {
        setImmediate(() => resolve("waiting"));
      }),
    ]);

    expect(earlyOutcome).toBe("waiting");

    process.emit("SIGINT", "SIGINT");

    await expect(runPromise).resolves.toEqual({
      exitCode: 130,
      stdout: "Capture bundle: demo-capture/capture.manifest.json\n",
      stderr: "Capture interrupted.\n",
    });
    expect(stopReasons).toEqual(["interrupted"]);
  });

  it("stops a running child capture as interrupted on SIGINT", async () => {
    const stopReasons: string[] = [];
    let finishChild: ((result: { exitCode: number }) => void) | undefined;

    const runPromise = runCliAsync(
      ["capture", "--url", "https://example.com", "--out", "demo-capture", "--", "npm", "test"],
      {
        now: () => new Date("2026-06-28T12:00:00.000Z"),
        async runChildCommand() {
          return await new Promise((resolve) => {
            finishChild = resolve;
          });
        },
        browserCaptureAdapter: {
          kind: "browser",
          async start(options) {
            return {
              ok: true,
              outputDir: options.outputDir,
              manifestPath: `${options.outputDir}/capture.manifest.json`,
              session: {
                outputDir: options.outputDir,
                manifestPath: `${options.outputDir}/capture.manifest.json`,
                async stop(reason) {
                  stopReasons.push(reason);
                  return {
                    ok: true,
                    output: fakeCaptureOutput(options.outputDir),
                  };
                },
              },
            };
          },
        },
      },
    );

    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    process.emit("SIGINT", "SIGINT");

    const outcome = await Promise.race([
      runPromise,
      new Promise<"not-interrupted">((resolve) => {
        setImmediate(() => resolve("not-interrupted"));
      }),
    ]);
    finishChild?.({ exitCode: 0 });

    expect(outcome).toEqual({
      exitCode: 130,
      stdout: "Capture bundle: demo-capture/capture.manifest.json\n",
      stderr: "Capture interrupted.\n",
    });
    expect(stopReasons).toEqual(["interrupted"]);
  });

  it("uses the default viewport and no child command when omitted", async () => {
    const starts: unknown[] = [];

    const result = await runCliAsync(
      ["capture", "--url", "https://example.com", "--out", "demo-capture"],
      {
        now: () => new Date("2026-06-28T12:00:00.000Z"),
        async runChildCommand() {
          return { exitCode: 0 };
        },
        browserCaptureAdapter: {
          kind: "browser",
          async start(options) {
            starts.push(options);
            return {
              ok: false,
              code: "capture_not_implemented",
              message: "Browser capture is not implemented yet.",
              outputDir: options.outputDir,
              manifestPath: `${options.outputDir}/capture.manifest.json`,
            };
          },
        },
      },
    );

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Browser capture is not implemented yet.\n",
    });
    expect(starts).toEqual([
      {
        source: { kind: "browser", url: "https://example.com" },
        outputDir: "demo-capture",
        viewport: { width: 1280, height: 720 },
        startedAt: "2026-06-28T12:00:00.000Z",
      },
    ]);
  });
});

describe("runCliAsync validate", () => {
  it("requires a capture bundle path", async () => {
    const result = await runCliAsync(["validate"]);

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "autodemo validate requires <capture-dir-or-manifest>.\n",
    });
  });

  it("reports a valid capture bundle", async () => {
    const outputDir = await createValidCaptureBundle();

    const result = await runCliAsync(["validate", outputDir]);

    expect(result).toEqual({
      exitCode: 0,
      stdout: `Capture bundle valid: ${join(outputDir, "capture.manifest.json")}\n`,
      stderr: "",
    });
  });

  it("reports validation errors for an invalid capture bundle", async () => {
    const outputDir = await createValidCaptureBundle();
    await rm(join(outputDir, "media", "viewport.webm"));

    const result = await runCliAsync(["validate", join(outputDir, "capture.manifest.json")]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Capture bundle invalid:");
    expect(result.stderr).toContain("Missing media artifact: media/viewport.webm");
  });
});
