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

async function createValidProject(
  options: { sourceVariantId?: string; sourceVariantDisplayName?: string } = {},
): Promise<string> {
  const projectDir = join(tmpdir(), `auto-demo-cli-generate-${randomUUID()}`);
  const sourceVariantId = options.sourceVariantId ?? "baseline-polish";
  const baselineVariant = {
    id: sourceVariantId,
    displayName: options.sourceVariantDisplayName ?? "Baseline Polish",
    source: { mediaPath: "raw/capture.webm", eventsPath: "metadata/events.jsonl" },
    timeline: { startMs: 1500, endMs: 2750 },
    viewport: { mode: "contain", focus: { x: 0.75, y: 0.5 }, zoom: 1.35 },
    cursor: { visible: true, emphasis: "spotlight" },
    clicks: { emphasis: "ring" },
    captions: [],
    callouts: [],
    style: {
      background: "solid",
      backgroundColor: "#0f172a",
      frame: "browser",
      padding: 48,
      cornerRadius: 16,
    },
    exportIntent: { format: "mp4", quality: "demo", aspectRatio: "16:9" },
  };
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
        variants: [baselineVariant],
        previews: [],
        exports: [],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(projectDir, "variants", `${sourceVariantId}.json`),
    `${JSON.stringify(baselineVariant, null, 2)}\n`,
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

  it("reports that open requires async execution", () => {
    const result = runCli(["open"]);

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "autodemo open requires async execution.\n",
    });
  });

  it("prints help and fails for unknown commands", () => {
    const result = runCli(["wat"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Usage: autodemo <command>");
    expect(result.stderr).toBe("Unknown command: wat\n");
  });
});

describe("runCliAsync open", () => {
  it("starts the local editor and prints its URL", async () => {
    const projectDir = await createValidProject();
    const started: unknown[] = [];

    const result = await runCliAsync(["open", "--project", projectDir, "--no-browser"], {
      now: () => new Date("2026-07-04T12:00:00.000Z"),
      async runChildCommand() {
        return { exitCode: 0 };
      },
      browserCaptureAdapter: {
        kind: "browser",
        async start() {
          throw new Error("capture should not start for open");
        },
      },
      async startEditorServer(options) {
        started.push(options);
        return {
          url: "http://127.0.0.1:4321/",
          async close() {},
        };
      },
    });

    expect(result).toEqual({
      exitCode: 0,
      stdout: "Auto Demo editor: http://127.0.0.1:4321/\n",
      stderr: "",
    });
    expect(started).toEqual([
      {
        projectPath: projectDir,
        host: "127.0.0.1",
        port: 0,
      },
    ]);
  });

  it("requires a project path", async () => {
    const result = await runCliAsync(["open", "--no-browser"]);

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "autodemo open requires --project <project-dir-or-manifest>.\n",
    });
  });

  it("rejects unknown open arguments", async () => {
    const result = await runCliAsync(["open", "--project", "demo", "--wat"]);

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Unknown autodemo open option: --wat\n",
    });
  });

  it("rejects invalid port values", async () => {
    const result = await runCliAsync(["open", "--project", "demo", "--port", "wide"]);

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "autodemo open --port must be an integer from 0 to 65535.\n",
    });
  });
});

describe("runCliAsync agent", () => {
  it("prints a selected variant handoff summary as JSON", async () => {
    const projectDir = await createValidProject();

    const result = await runCliAsync(["agent", "run", "--project", projectDir, "--json"]);
    const output = JSON.parse(result.stdout) as {
      ok: boolean;
      variant: { id: string; path: string; source: string };
      artifacts: Array<{ kind: string; path: string }>;
      nextSteps: string[];
    };

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(output.ok).toBe(true);
    expect(output.variant).toEqual({
      id: "baseline-polish",
      path: "variants/baseline-polish.json",
      source: "selected",
    });
    expect(output.artifacts).toContainEqual({
      kind: "variant",
      path: "variants/baseline-polish.json",
    });
    expect(output.nextSteps).toEqual(["open-editor", "export-variant"]);
  });

  it("prints generated save-all handoff summary as JSON", async () => {
    const projectDir = await createValidProject({
      sourceVariantId: "source-baseline",
      sourceVariantDisplayName: "Source Baseline",
    });

    const result = await runCliAsync([
      "agent",
      "run",
      "--project",
      projectDir,
      "--json",
      "--generate",
      "baseline",
      "--source-variant",
      "source-baseline",
      "--save",
      "all",
    ]);
    const output = JSON.parse(result.stdout) as {
      ok: boolean;
      variant: { id: string; path: string; source: string };
    };

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(output.ok).toBe(true);
    expect(output.variant).toEqual({
      id: "baseline-polish",
      path: "variants/baseline-polish.json",
      source: "generated",
    });
  });

  it("includes the local editor URL in the handoff summary", async () => {
    const projectDir = await createValidProject();

    const result = await runCliAsync(
      ["agent", "run", "--project", projectDir, "--json", "--open-editor"],
      {
        now: () => new Date("2026-07-05T12:00:00.000Z"),
        async runChildCommand() {
          return { exitCode: 0 };
        },
        browserCaptureAdapter: {
          kind: "browser",
          async start() {
            throw new Error("capture should not start for agent workflow");
          },
        },
        async startEditorServer() {
          return {
            url: "http://127.0.0.1:4321/",
            async close() {},
          };
        },
      },
    );
    const output = JSON.parse(result.stdout) as {
      ok: boolean;
      editor: { opened: boolean; url: string };
    };

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(output.ok).toBe(true);
    expect(output.editor).toEqual({ opened: true, url: "http://127.0.0.1:4321/" });
  });

  it("returns structured JSON errors for missing project input", async () => {
    const result = await runCliAsync(["agent", "run", "--json"]);
    const output = JSON.parse(result.stdout) as { ok: boolean; errors: Array<{ code: string }> };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(output.ok).toBe(false);
    expect(output.errors).toEqual([{ code: "missing_project_path", message: expect.any(String) }]);
  });

  it("requires JSON output for the first agent workflow contract", async () => {
    const projectDir = await createValidProject();

    const result = await runCliAsync(["agent", "run", "--project", projectDir]);

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "autodemo agent run currently requires --json output.\n",
    });
  });

  it("returns structured JSON errors for unsupported agent options", async () => {
    const projectDir = await createValidProject();

    for (const args of [
      ["agent", "wat", "--project", projectDir, "--json"],
      ["agent", "run", "--project", projectDir, "--json", "--wat"],
      ["agent", "run", "--project", projectDir, "--json", "--generate", "cinematic"],
      ["agent", "run", "--project", projectDir, "--json", "--save", "all"],
    ]) {
      const result = await runCliAsync(args);
      const output = JSON.parse(result.stdout) as { ok: boolean; errors: Array<{ code: string }> };

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(output.ok).toBe(false);
      expect(output.errors.length).toBeGreaterThan(0);
    }
  });
});

describe("runCliAsync generate", () => {
  it("prints selected save summary as JSON", async () => {
    const projectDir = await createValidProject({
      sourceVariantId: "source-baseline",
      sourceVariantDisplayName: "Source Baseline",
    });

    const result = await runCliAsync([
      "generate",
      "--project",
      projectDir,
      "--json",
      "--source-variant",
      "source-baseline",
      "--save",
      "baseline-polish",
    ]);
    const output = JSON.parse(result.stdout) as {
      ok: boolean;
      summary: {
        mode: string;
        saved: Array<{ id: string; path: string }>;
        validation: { ok: boolean };
      };
    };

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(output.ok).toBe(true);
    expect(output.summary).toMatchObject({
      mode: "selected",
      saved: [{ id: "baseline-polish", path: "variants/baseline-polish.json" }],
      validation: { ok: true },
    });
  });

  it("prints save-all summary as JSON", async () => {
    const projectDir = await createValidProject({
      sourceVariantId: "source-baseline",
      sourceVariantDisplayName: "Source Baseline",
    });

    const result = await runCliAsync([
      "generate",
      "--project",
      projectDir,
      "--json",
      "--source-variant",
      "source-baseline",
      "--save",
      "all",
    ]);
    const output = JSON.parse(result.stdout) as {
      ok: boolean;
      summary: { mode: string; saved: Array<{ id: string; path: string }> };
    };

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(output.ok).toBe(true);
    expect(output.summary.mode).toBe("all");
    expect(output.summary.saved).toEqual([
      { id: "baseline-polish", path: "variants/baseline-polish.json" },
    ]);
  });

  it("returns a structured duplicate error when the generated variant already exists", async () => {
    const projectDir = await createValidProject();

    const result = await runCliAsync([
      "generate",
      "--project",
      projectDir,
      "--json",
      "--save",
      "baseline-polish",
    ]);
    const output = JSON.parse(result.stdout) as { ok: boolean; errors: Array<{ code: string }> };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(output.ok).toBe(false);
    expect(output.errors).toContainEqual({
      code: "duplicate_variant_id",
      message: expect.any(String),
    });
  });

  it("returns a structured JSON error when dry-run is combined with save", async () => {
    const projectDir = await createValidProject();

    const result = await runCliAsync([
      "generate",
      "--project",
      projectDir,
      "--dry-run",
      "--json",
      "--save",
      "baseline-polish",
    ]);
    const output = JSON.parse(result.stdout) as { ok: boolean; errors: Array<{ code: string }> };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(output.ok).toBe(false);
    expect(output.errors).toContainEqual({
      code: "unsupported_save_mode",
      message: expect.any(String),
    });
  });

  it("returns structured JSON errors for repeated save arguments", async () => {
    const projectDir = await createValidProject({
      sourceVariantId: "source-baseline",
      sourceVariantDisplayName: "Source Baseline",
    });

    const result = await runCliAsync([
      "generate",
      "--project",
      projectDir,
      "--json",
      "--source-variant",
      "source-baseline",
      "--save",
      "all",
      "--save",
      "baseline-polish",
    ]);
    const output = JSON.parse(result.stdout) as { ok: boolean; errors: Array<{ code: string }> };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(output.ok).toBe(false);
    expect(output.errors).toContainEqual({
      code: "unknown_generate_argument",
      message: expect.any(String),
    });
  });

  it("prints a dry-run baseline summary as JSON", async () => {
    const projectDir = await createValidProject();

    const result = await runCliAsync(["generate", "--project", projectDir, "--dry-run", "--json"]);
    const output = JSON.parse(result.stdout) as {
      ok: boolean;
      project: { projectDir: string; name: string };
      requested: { styles: string[]; sourceVariantId: string };
      variants: Array<{
        id: string;
        metadata: { presetKey: string; sourceVariantId: string };
        save: { mode: string; saved: boolean };
      }>;
    };

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(output.ok).toBe(true);
    expect(output.project).toMatchObject({ projectDir, name: "Checkout flow demo" });
    expect(output.requested).toMatchObject({
      styles: ["baseline"],
      sourceVariantId: "baseline-polish",
    });
    expect(output.variants).toEqual([
      expect.objectContaining({
        id: "baseline-polish",
        metadata: expect.objectContaining({
          presetKey: "baseline",
          sourceVariantId: "baseline-polish",
        }),
        save: { mode: "dry-run", saved: false },
      }),
    ]);
  });

  it("prints a dry-run baseline batch summary as JSON", async () => {
    const projectDir = await createValidProject();

    const result = await runCliAsync([
      "generate",
      "--project",
      projectDir,
      "--dry-run",
      "--json",
      "--styles",
      "baseline",
      "--source-variant",
      "baseline-polish",
    ]);
    const output = JSON.parse(result.stdout) as {
      ok: boolean;
      requested: { styles: string[]; sourceVariantId: string };
      variants: Array<{ metadata: { presetKey: string; sourceVariantId: string } }>;
    };

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(output.ok).toBe(true);
    expect(output.requested).toMatchObject({
      styles: ["baseline"],
      sourceVariantId: "baseline-polish",
    });
    expect(output.variants).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          presetKey: "baseline",
          sourceVariantId: "baseline-polish",
        }),
      }),
    ]);
  });

  it("returns structured JSON errors for duplicate generated styles", async () => {
    const projectDir = await createValidProject();

    const result = await runCliAsync([
      "generate",
      "--project",
      projectDir,
      "--dry-run",
      "--json",
      "--styles",
      "baseline,baseline",
    ]);
    const output = JSON.parse(result.stdout) as { ok: boolean; errors: Array<{ code: string }> };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(output.ok).toBe(false);
    expect(output.errors).toContainEqual({
      code: "duplicate_style",
      message: expect.any(String),
    });
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

  it("returns structured JSON errors for missing generate option values", async () => {
    const projectDir = await createValidProject();

    for (const args of [
      ["generate", "--project", "--dry-run", "--json"],
      ["generate", "--project", projectDir, "--dry-run", "--json", "--count"],
      ["generate", "--project", projectDir, "--dry-run", "--json", "--style"],
      ["generate", "--project", projectDir, "--dry-run", "--json", "--style", "--count", "1"],
    ]) {
      const result = await runCliAsync(args);
      const output = JSON.parse(result.stdout) as { ok: boolean; errors: Array<{ code: string }> };

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(output.ok).toBe(false);
      expect(output.errors).toContainEqual({
        code: "unknown_generate_argument",
        message: expect.any(String),
      });
    }
  });

  it("returns structured JSON errors for unsupported generate mode arguments", async () => {
    const projectDir = await createValidProject();

    const result = await runCliAsync([
      "generate",
      "--project",
      projectDir,
      "--json",
      "--mode",
      "dry-run",
    ]);
    const output = JSON.parse(result.stdout) as { ok: boolean; errors: Array<{ code: string }> };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(output.ok).toBe(false);
    expect(output.errors).toContainEqual({
      code: "unknown_generate_argument",
      message: expect.any(String),
    });
  });

  it("returns structured JSON errors for unknown generate arguments", async () => {
    const projectDir = await createValidProject();

    const result = await runCliAsync([
      "generate",
      "--project",
      projectDir,
      "--dry-run",
      "--json",
      "--savee",
      "extra",
    ]);
    const output = JSON.parse(result.stdout) as { ok: boolean; errors: Array<{ code: string }> };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(output.ok).toBe(false);
    expect(output.errors).toEqual([
      { code: "unknown_generate_argument", message: expect.any(String) },
      { code: "unknown_generate_argument", message: expect.any(String) },
    ]);
  });

  it("rejects partially numeric generate counts", async () => {
    const projectDir = await createValidProject();

    for (const count of ["1abc", "1.5", "01"]) {
      const result = await runCliAsync([
        "generate",
        "--project",
        projectDir,
        "--dry-run",
        "--json",
        "--count",
        count,
      ]);
      const output = JSON.parse(result.stdout) as { ok: boolean; errors: Array<{ code: string }> };

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(output.ok).toBe(false);
      expect(output.errors).toEqual([
        { code: "unsupported_variant_count", message: expect.any(String) },
      ]);
    }
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

  it("keeps the non-JSON stderr requirement when generate arguments are unknown", async () => {
    const projectDir = await createValidProject();

    const result = await runCliAsync(["generate", "--project", projectDir, "--dry-run", "--savee"]);

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
