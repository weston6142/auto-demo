import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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

async function createValidProject(): Promise<string> {
  const projectDir = join(tmpdir(), `auto-demo-cli-generate-${randomUUID()}`);
  await mkdir(join(projectDir, "raw"), { recursive: true });
  await mkdir(join(projectDir, "metadata"), { recursive: true });
  await mkdir(join(projectDir, "variants"), { recursive: true });
  await mkdir(join(projectDir, "previews"), { recursive: true });
  await mkdir(join(projectDir, "exports"), { recursive: true });
  await writeFile(join(projectDir, "raw", "capture.webm"), "video");
  await writeFile(join(projectDir, "metadata", "capture.manifest.json"), "{}\n");
  await writeFile(
    join(projectDir, "metadata", "events.jsonl"),
    `${JSON.stringify({
      id: "event-1",
      sequence: 1,
      type: "click",
      timestampMs: 2000,
      viewport: { width: 1280, height: 720 },
      data: { x: 960, y: 360 },
    })}\n`,
  );
  await writeFile(
    join(projectDir, "autodemo.project.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        name: "Checkout flow demo",
        createdAt: "2026-07-04T12:00:00.000Z",
        updatedAt: "2026-07-04T12:00:00.000Z",
        sourceCapture: {
          kind: "browser",
          status: "completed",
          source: { kind: "browser", url: "https://example.com/checkout" },
          viewport: { width: 1280, height: 720 },
          timing: {
            startedAt: "2026-07-04T12:00:00.000Z",
            endedAt: "2026-07-04T12:00:06.000Z",
            durationMs: 6000,
          },
          adapter: { kind: "browser", backend: "playwright" },
          tools: { capturePackage: "0.0.0", playwright: "1.61.1" },
          manifestPath: "metadata/capture.manifest.json",
        },
        media: {
          primary: { kind: "viewport", path: "raw/capture.webm", contentType: "video/webm" },
        },
        metadata: {
          events: { path: "metadata/events.jsonl", contentType: "application/x-ndjson" },
        },
        variants: [],
        previews: [],
        exports: [],
      },
      null,
      2,
    )}\n`,
  );
  return projectDir;
}

describe("runCli", () => {
  it("prints help with a zero exit code", () => {
    const result = runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: autodemo <command>");
    expect(result.stderr).toBe("");
  });

  it("fails clearly for planned but unimplemented non-capture commands", () => {
    const result = runCli(["export"]);

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "autodemo export is not implemented yet.\n",
    });
  });

  it("prints help and fails for unknown commands", () => {
    const result = runCli(["wat"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Usage: autodemo <command>");
    expect(result.stderr).toBe("Unknown command: wat\n");
  });
});

describe("runCliAsync generate", () => {
  it("prints a dry-run baseline summary as JSON", async () => {
    const projectDir = await createValidProject();

    const result = await runCliAsync(["generate", "--project", projectDir, "--dry-run", "--json"]);
    const output = JSON.parse(result.stdout) as {
      ok: boolean;
      project: { projectDir: string; name: string };
      variants: Array<{ id: string; save: { mode: string; saved: boolean } }>;
    };

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(output.ok).toBe(true);
    expect(output.project).toMatchObject({ projectDir, name: "Checkout flow demo" });
    expect(output.variants).toEqual([
      expect.objectContaining({
        id: "baseline-polish",
        save: { mode: "dry-run", saved: false },
      }),
    ]);
  });

  it("returns a structured JSON error when project input is missing", async () => {
    const result = await runCliAsync(["generate", "--dry-run", "--json"]);
    const output = JSON.parse(result.stdout) as { ok: boolean; errors: Array<{ code: string }> };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(output.ok).toBe(false);
    expect(output.errors).toEqual([{ code: "missing_project_path", message: expect.any(String) }]);
  });

  it("returns structured JSON errors for unsupported options", async () => {
    const projectDir = await createValidProject();

    const result = await runCliAsync([
      "generate",
      "--project",
      projectDir,
      "--dry-run",
      "--json",
      "--style",
      "cinematic",
    ]);
    const output = JSON.parse(result.stdout) as { ok: boolean; errors: Array<{ code: string }> };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(output.ok).toBe(false);
    expect(output.errors).toEqual([{ code: "unsupported_style", message: expect.any(String) }]);
  });

  it("requires JSON output for the first generate contract", async () => {
    const projectDir = await createValidProject();

    const result = await runCliAsync(["generate", "--project", projectDir, "--dry-run"]);

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "autodemo generate currently requires --json output.\n",
    });
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

  it("prints the diagnostic bundle path when a started capture cannot stop cleanly", async () => {
    const result = await runCliAsync(
      ["capture", "--url", "https://example.com", "--out", "demo-capture", "--", "npm", "test"],
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
                async stop() {
                  return {
                    ok: false,
                    code: "capture_stop_failed",
                    message: "Browser capture stop failed.",
                    outputDir: options.outputDir,
                    manifestPath: `${options.outputDir}/capture.manifest.json`,
                  };
                },
              },
            };
          },
        },
      },
    );

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Browser capture stop failed.\nCapture bundle: demo-capture/capture.manifest.json\n",
    });
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
