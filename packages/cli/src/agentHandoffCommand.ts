import { readFile, stat } from "node:fs/promises";
import { generateBaselinePolishVariant } from "@auto-demo/polish";
import { createProjectFromCaptureBundle, savePolishVariant } from "@auto-demo/project";

export type AgentHandoffCliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type AgentHandoffCommandDependencies = {
  now: () => Date;
  createProject?: typeof createProjectFromCaptureBundle;
  generateBaseline?: typeof generateBaselinePolishVariant;
  saveVariant?: typeof savePolishVariant;
  isFile?: (path: string) => Promise<boolean>;
};

type ParsedAgentHandoffCommand = {
  executionPath: string;
  projectDir: string;
  name: string;
};

type SuccessfulExecution = {
  outputDir: string;
  capture: Record<string, unknown>;
};

type CompleteExecution = {
  capture: {
    outputDir: string;
    manifestPath: string;
    mediaPath: string;
    metadataPath: string;
  };
};

export async function runAgentHandoffCommand(
  args: string[],
  dependencies: AgentHandoffCommandDependencies,
): Promise<AgentHandoffCliResult> {
  const parsed = parseAgentHandoffCommand(args);
  if (!parsed.ok) return jsonFailure(parsed.errors);

  let rawExecution: string;
  try {
    rawExecution = await readFile(parsed.command.executionPath, "utf8");
  } catch {
    return jsonFailure([
      { code: "missing_execution_file", message: "Agent handoff execution file was not found." },
    ]);
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(rawExecution);
  } catch {
    return jsonFailure([
      { code: "invalid_execution_json", message: "Agent handoff requires valid execution JSON." },
    ]);
  }

  const successful = successfulExecution(decoded);
  if (successful === undefined) {
    return jsonFailure([
      {
        code: "invalid_execution_result",
        message: "Agent handoff requires a completed successful execution result.",
      },
    ]);
  }

  const execution = completeExecution(successful);
  if (execution === undefined) {
    return jsonFailure([
      {
        code: "missing_capture_artifact",
        message: "Agent handoff requires completed capture manifest, media, and metadata files.",
      },
    ]);
  }

  const isFile = dependencies.isFile ?? regularFile;
  for (const path of [
    execution.capture.manifestPath,
    execution.capture.mediaPath,
    execution.capture.metadataPath,
  ]) {
    if (!(await isFile(path))) {
      return jsonFailure([
        {
          code: "missing_capture_artifact",
          message: "Agent handoff requires completed capture manifest, media, and metadata files.",
        },
      ]);
    }
  }

  const createProject = dependencies.createProject ?? createProjectFromCaptureBundle;
  let imported: Awaited<ReturnType<typeof createProjectFromCaptureBundle>>;
  try {
    imported = await createProject({
      captureBundlePath: execution.capture.outputDir,
      projectDir: parsed.command.projectDir,
      name: parsed.command.name,
      now: dependencies.now,
    });
  } catch {
    return jsonFailure([
      {
        code: "invalid_project_input",
        message: "The capture could not be imported into the requested project directory.",
      },
    ]);
  }
  if (!imported.ok) {
    return jsonFailure(
      imported.errors.map((error) => ({
        code:
          error.code === "project_directory_not_empty" ? "project_directory_collision" : error.code,
        message: error.message,
      })),
    );
  }

  const generateBaseline = dependencies.generateBaseline ?? generateBaselinePolishVariant;
  const saveVariant = dependencies.saveVariant ?? savePolishVariant;
  let generated: Awaited<ReturnType<typeof generateBaselinePolishVariant>>;
  let saved: Awaited<ReturnType<typeof savePolishVariant>>;
  try {
    generated = await generateBaseline(imported.project);
    saved = await saveVariant(imported.project, generated.variant, {
      now: dependencies.now(),
    });
  } catch {
    return jsonFailure([
      {
        code: "generation_failed",
        message: "The baseline variant could not be generated and saved.",
      },
    ]);
  }
  if (!saved.ok) {
    return jsonFailure(
      saved.errors.map((error) => ({ code: "generation_failed", message: error.message })),
    );
  }

  return {
    exitCode: 0,
    stdout: `${JSON.stringify(
      {
        ok: true,
        execution: {
          captureDir: execution.capture.outputDir,
          manifestPath: execution.capture.manifestPath,
        },
        project: {
          projectDir: imported.project.projectDir,
          manifestPath: saved.manifestPath,
          name: saved.manifest.name,
        },
        variant: {
          id: generated.variant.id,
          path: `variants/${generated.variant.id}.json`,
        },
        warnings: generated.warnings,
        nextSteps: {
          editor: {
            command: "npm",
            args: ["run", "autodemo", "--", "open", "--project", imported.project.projectDir],
          },
          export: {
            command: "npm",
            args: [
              "run",
              "autodemo",
              "--",
              "export",
              "--project",
              imported.project.projectDir,
              "--variant",
              generated.variant.id,
              "--json",
            ],
          },
        },
      },
      null,
      2,
    )}\n`,
    stderr: "",
  };
}

function parseAgentHandoffCommand(
  args: string[],
):
  | { ok: true; command: ParsedAgentHandoffCommand }
  | { ok: false; errors: Array<{ code: string; message: string }> } {
  let executionPath: string | undefined;
  let projectDir: string | undefined;
  let name: string | undefined;
  let json = false;
  const errors: Array<{ code: string; message: string }> = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--execution" || argument === "--project" || argument === "--name") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        errors.push({
          code: "unknown_agent_argument",
          message: `Missing value for agent handoff argument: ${argument}`,
        });
        continue;
      }
      index += 1;
      if (argument === "--execution") executionPath = value;
      if (argument === "--project") projectDir = value;
      if (argument === "--name") name = value;
      continue;
    }
    errors.push({
      code: "unknown_agent_argument",
      message: `Unknown agent handoff argument: ${argument}`,
    });
  }
  if (!json) {
    errors.push({
      code: "unknown_agent_argument",
      message: "Agent handoff requires --json output.",
    });
  }
  if (executionPath === undefined) {
    errors.push({
      code: "missing_execution_file",
      message: "Agent handoff requires --execution <execution-result-json-file>.",
    });
  }
  if (projectDir === undefined || projectDir.trim().length === 0) {
    errors.push({
      code: "invalid_project_input",
      message: "Agent handoff requires --project <new-project-directory>.",
    });
  }
  if (name === undefined || name.trim().length === 0) {
    errors.push({
      code: "invalid_project_input",
      message: "Agent handoff requires --name <project-name>.",
    });
  }
  if (
    errors.length > 0 ||
    executionPath === undefined ||
    projectDir === undefined ||
    name === undefined
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    command: { executionPath, projectDir, name: name.trim() },
  };
}

function successfulExecution(value: unknown): SuccessfulExecution | undefined {
  if (!isRecord(value) || value.ok !== true || value.phase !== "completed") return undefined;
  if (!isRecord(value.plan) || value.plan.state !== "executed") return undefined;
  if (!isRecord(value.plan.execution) || value.plan.execution.status !== "completed") {
    return undefined;
  }
  if (!isRecord(value.capture)) return undefined;
  const { outputDir } = value.capture;
  if (!isNonEmptyString(outputDir)) return undefined;
  return { outputDir, capture: value.capture };
}

function completeExecution(value: SuccessfulExecution): CompleteExecution | undefined {
  const { manifestPath, mediaPath, metadataPath } = value.capture;
  if (
    !isNonEmptyString(manifestPath) ||
    !isNonEmptyString(mediaPath) ||
    !isNonEmptyString(metadataPath)
  ) {
    return undefined;
  }
  return {
    capture: {
      outputDir: value.outputDir,
      manifestPath,
      mediaPath,
      metadataPath,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function regularFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function jsonFailure(errors: Array<{ code: string; message: string }>): AgentHandoffCliResult {
  return {
    exitCode: 1,
    stdout: `${JSON.stringify({ ok: false, errors }, null, 2)}\n`,
    stderr: "",
  };
}
