import { describe, expect, it } from "vitest";
import { runCli, runCliAsync } from "./index.js";

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
                    output: {
                      outputDir: options.outputDir,
                      manifestPath: `${options.outputDir}/capture.manifest.json`,
                    },
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
                    output: {
                      outputDir: options.outputDir,
                      manifestPath: `${options.outputDir}/capture.manifest.json`,
                    },
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
                    output: {
                      outputDir: options.outputDir,
                      manifestPath: `${options.outputDir}/capture.manifest.json`,
                    },
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
