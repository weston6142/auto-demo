import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProject } from "@auto-demo/project";
import { describe, expect, it } from "vitest";
import { runAgentHandoffCommand } from "./agentHandoffCommand.js";

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function writeCompletedCapture(captureDir: string): Promise<{
  manifestPath: string;
  mediaPath: string;
  metadataPath: string;
}> {
  const manifestPath = join(captureDir, "capture.manifest.json");
  const mediaPath = join(captureDir, "media", "viewport.webm");
  const metadataPath = join(captureDir, "metadata", "events.jsonl");
  await mkdir(join(captureDir, "media"), { recursive: true });
  await mkdir(join(captureDir, "metadata"), { recursive: true });
  await writeFile(mediaPath, "video-bytes");
  await writeFile(
    metadataPath,
    `${JSON.stringify({ type: "navigation", timestampMs: 250 })}\n${JSON.stringify({
      type: "click",
      timestampMs: 1_250,
      data: { x: 640, y: 360 },
    })}\n`,
  );
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        status: "completed",
        source: { kind: "browser", url: "https://example.com/checkout" },
        adapter: { kind: "browser", backend: "playwright" },
        tools: { capturePackage: "0.0.0", playwright: "1.61.1" },
        viewport: { width: 1280, height: 720 },
        startedAt: "2026-07-11T12:00:00.000Z",
        endedAt: "2026-07-11T12:00:02.500Z",
        durationMs: 2_500,
        artifacts: { media: "media/viewport.webm", events: "metadata/events.jsonl" },
        childCommand: null,
        error: null,
      },
      null,
      2,
    )}\n`,
  );
  return { manifestPath, mediaPath, metadataPath };
}

async function writeSuccessfulExecution(
  executionPath: string,
  captureDir: string,
): Promise<string> {
  const capture = await writeCompletedCapture(captureDir);
  const text = `${JSON.stringify(
    {
      ok: true,
      phase: "completed",
      plan: {
        state: "executed",
        execution: { status: "completed" },
      },
      capture: {
        outputDir: captureDir,
        ...capture,
      },
    },
    null,
    2,
  )}\n`;
  await writeFile(executionPath, text);
  return text;
}

describe("autodemo agent handoff", () => {
  it("creates a project with a saved baseline and structured next steps", async () => {
    const root = await mkdtemp(join(tmpdir(), "auto-demo-agent-handoff-"));
    const captureDir = join(root, "capture");
    const executionPath = join(root, "execution.json");
    const projectDir = join(root, "project");
    const executionText = await writeSuccessfulExecution(executionPath, captureDir);

    const result = await runAgentHandoffCommand(
      ["--execution", executionPath, "--project", projectDir, "--name", "Checkout Demo", "--json"],
      { now: () => new Date("2026-07-11T12:00:00.000Z") },
    );

    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      execution: {
        captureDir,
        manifestPath: join(captureDir, "capture.manifest.json"),
      },
      project: { projectDir, name: "Checkout Demo" },
      variant: { id: "baseline-polish", path: "variants/baseline-polish.json" },
      nextSteps: {
        editor: {
          command: "npm",
          args: ["run", "autodemo", "--", "open", "--project", projectDir],
        },
        export: {
          command: "npm",
          args: [
            "run",
            "autodemo",
            "--",
            "export",
            "--project",
            projectDir,
            "--variant",
            "baseline-polish",
            "--json",
          ],
        },
      },
    });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const loaded = await loadProject(projectDir);
    expect(loaded.ok && loaded.manifest.variants.map((variant) => variant.id)).toEqual([
      "baseline-polish",
    ]);
    expect(await readFile(join(projectDir, "variants", "baseline-polish.json"), "utf8")).toContain(
      '"id": "baseline-polish"',
    );
    expect(await readFile(executionPath, "utf8")).toBe(executionText);
  });

  it("rejects malformed and unsuccessful execution evidence before project creation", async () => {
    const root = await mkdtemp(join(tmpdir(), "auto-demo-agent-handoff-invalid-"));
    const projectDir = join(root, "project");
    const malformedPath = join(root, "malformed.json");
    await writeFile(malformedPath, "{bad json");

    const malformed = await runAgentHandoffCommand(
      ["--execution", malformedPath, "--project", projectDir, "--name", "Invalid Demo", "--json"],
      { now: () => new Date("2026-07-11T12:00:00.000Z") },
    );
    expect(JSON.parse(malformed.stdout)).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_execution_json" }],
    });

    const failedPath = join(root, "failed.json");
    await writeFile(failedPath, JSON.stringify({ ok: false, phase: "execution" }));
    const failed = await runAgentHandoffCommand(
      ["--execution", failedPath, "--project", projectDir, "--name", "Failed Demo", "--json"],
      { now: () => new Date("2026-07-11T12:00:00.000Z") },
    );
    expect(JSON.parse(failed.stdout)).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_execution_result" }],
    });
    expect(await pathExists(projectDir)).toBe(false);
  });

  it("reports a missing execution result file separately from malformed JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "auto-demo-agent-handoff-missing-execution-"));
    const result = await runAgentHandoffCommand(
      [
        "--execution",
        join(root, "missing.json"),
        "--project",
        join(root, "project"),
        "--name",
        "Missing Execution Demo",
        "--json",
      ],
      { now: () => new Date("2026-07-11T12:00:00.000Z") },
    );

    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      errors: [{ code: "missing_execution_file" }],
    });
  });

  it("distinguishes missing capture artifacts from a present invalid bundle", async () => {
    const root = await mkdtemp(join(tmpdir(), "auto-demo-agent-handoff-artifacts-"));
    const captureDir = join(root, "capture");
    const executionPath = join(root, "execution.json");
    await writeSuccessfulExecution(executionPath, captureDir);
    await rm(join(captureDir, "media", "viewport.webm"));

    const missing = await runAgentHandoffCommand(
      [
        "--execution",
        executionPath,
        "--project",
        join(root, "missing-project"),
        "--name",
        "Missing Artifact Demo",
        "--json",
      ],
      { now: () => new Date("2026-07-11T12:00:00.000Z") },
    );
    expect(JSON.parse(missing.stdout)).toMatchObject({
      ok: false,
      errors: [{ code: "missing_capture_artifact" }],
    });

    const decodedWithoutMetadata = JSON.parse(await readFile(executionPath, "utf8"));
    delete decodedWithoutMetadata.capture.metadataPath;
    await writeFile(executionPath, JSON.stringify(decodedWithoutMetadata));
    const missingPath = await runAgentHandoffCommand(
      [
        "--execution",
        executionPath,
        "--project",
        join(root, "missing-path-project"),
        "--name",
        "Missing Artifact Path Demo",
        "--json",
      ],
      { now: () => new Date("2026-07-11T12:00:00.000Z") },
    );
    expect(JSON.parse(missingPath.stdout)).toMatchObject({
      ok: false,
      errors: [{ code: "missing_capture_artifact" }],
    });

    await writeSuccessfulExecution(executionPath, captureDir);
    await writeFile(join(captureDir, "media", "viewport.webm"), "video-bytes");
    await writeFile(join(captureDir, "capture.manifest.json"), "{}");
    const invalid = await runAgentHandoffCommand(
      [
        "--execution",
        executionPath,
        "--project",
        join(root, "invalid-project"),
        "--name",
        "Invalid Capture Demo",
        "--json",
      ],
      { now: () => new Date("2026-07-11T12:00:00.000Z") },
    );
    expect(JSON.parse(invalid.stdout)).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_capture_bundle" }],
    });
  });

  it("preserves a non-empty project directory on collision", async () => {
    const root = await mkdtemp(join(tmpdir(), "auto-demo-agent-handoff-collision-"));
    const captureDir = join(root, "capture");
    const executionPath = join(root, "execution.json");
    const projectDir = join(root, "project");
    const sentinelPath = join(projectDir, "keep.txt");
    await writeSuccessfulExecution(executionPath, captureDir);
    await mkdir(projectDir);
    await writeFile(sentinelPath, "keep-me");

    const result = await runAgentHandoffCommand(
      ["--execution", executionPath, "--project", projectDir, "--name", "Collision Demo", "--json"],
      { now: () => new Date("2026-07-11T12:00:00.000Z") },
    );

    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      errors: [{ code: "project_directory_collision" }],
    });
    expect(await readFile(sentinelPath, "utf8")).toBe("keep-me");
  });

  it("reports generation failure and preserves the imported project", async () => {
    const root = await mkdtemp(join(tmpdir(), "auto-demo-agent-handoff-generation-"));
    const captureDir = join(root, "capture");
    const executionPath = join(root, "execution.json");
    const projectDir = join(root, "project");
    await writeSuccessfulExecution(executionPath, captureDir);

    const result = await runAgentHandoffCommand(
      [
        "--execution",
        executionPath,
        "--project",
        projectDir,
        "--name",
        "Generation Failure Demo",
        "--json",
      ],
      {
        now: () => new Date("2026-07-11T12:00:00.000Z"),
        async saveVariant(project) {
          return {
            ok: false,
            projectDir: project.projectDir,
            manifestPath: project.manifestPath,
            errors: [
              {
                code: "invalid_project_manifest",
                message: "Generated baseline could not be saved.",
              },
            ],
          };
        },
      },
    );

    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      errors: [{ code: "generation_failed" }],
    });
    const imported = await loadProject(projectDir);
    expect(imported.ok).toBe(true);
    expect(imported.ok && imported.manifest.variants).toEqual([]);
  });

  it("sanitizes unexpected generation failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "auto-demo-agent-handoff-generation-throw-"));
    const captureDir = join(root, "capture");
    const executionPath = join(root, "execution.json");
    await writeSuccessfulExecution(executionPath, captureDir);

    const result = await runAgentHandoffCommand(
      [
        "--execution",
        executionPath,
        "--project",
        join(root, "project"),
        "--name",
        "Generation Throw Demo",
        "--json",
      ],
      {
        now: () => new Date("2026-07-11T12:00:00.000Z"),
        async generateBaseline() {
          throw new Error("private event payload");
        },
      },
    );

    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      errors: [{ code: "generation_failed" }],
    });
    expect(result.stdout).not.toContain("private event payload");
  });

  it("sanitizes unexpected project import failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "auto-demo-agent-handoff-import-throw-"));
    const captureDir = join(root, "capture");
    const executionPath = join(root, "execution.json");
    await writeSuccessfulExecution(executionPath, captureDir);

    const result = await runAgentHandoffCommand(
      [
        "--execution",
        executionPath,
        "--project",
        join(root, "project"),
        "--name",
        "Import Throw Demo",
        "--json",
      ],
      {
        now: () => new Date("2026-07-11T12:00:00.000Z"),
        async createProject() {
          throw new Error("private filesystem path");
        },
      },
    );

    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_project_input" }],
    });
    expect(result.stdout).not.toContain("private filesystem path");
  });

  it("returns structured argument errors without reading files", async () => {
    const result = await runAgentHandoffCommand(["--unknown", "value", "--json"], {
      now: () => new Date("2026-07-11T12:00:00.000Z"),
    });

    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        expect.objectContaining({ code: "unknown_agent_argument" }),
        expect.objectContaining({ code: "missing_execution_file" }),
        expect.objectContaining({ code: "invalid_project_input" }),
      ]),
    });
  });
});
