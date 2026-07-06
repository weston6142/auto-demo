#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  runAgentWorkflow,
  type AgentWorkflowError,
  type AgentWorkflowSaveTarget,
} from "@auto-demo/agent";
import {
  createPlaywrightBrowserCaptureAdapter,
  DEFAULT_BROWSER_VIEWPORT,
  validateCaptureBundle,
  type BrowserCaptureAdapter,
  type BrowserCaptureOptions,
  type CaptureChildCommand,
  type CaptureSession,
  type CaptureStopReason,
  type CaptureViewport,
} from "@auto-demo/capture";
import {
  generateHeadlessVariants,
  type HeadlessVariantGenerationError,
  type HeadlessVariantGenerationResult,
} from "@auto-demo/polish";
import {
  startEditorServer,
  type EditorServer,
  type StartEditorServerOptions,
} from "@auto-demo/editor";
import {
  renderSavedVariant as renderSavedVariantDefault,
  type RenderError,
  type RenderSavedVariantInput,
  type RenderSavedVariantResult,
} from "@auto-demo/render";

export type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

/** Dependencies that let tests or future integrations run capture without the default backend/process hooks. */
export type CliDependencies = {
  browserCaptureAdapter: BrowserCaptureAdapter;
  createInterruptWatcher?: () => InterruptWatcher;
  now: () => Date;
  runChildCommand: (command: CaptureChildCommand) => Promise<ChildCommandResult>;
  startEditorServer?: (options: StartEditorServerOptions) => Promise<EditorServer>;
  renderSavedVariant?: (input: RenderSavedVariantInput) => Promise<RenderSavedVariantResult>;
};

export type ChildCommandResult = {
  exitCode: number;
};

type InterruptWatcher = {
  interrupted: Promise<void>;
  dispose: () => void;
};

type ParsedCaptureCommand =
  | {
      ok: true;
      options: BrowserCaptureOptions;
    }
  | {
      ok: false;
      message: string;
    };

type ParsedGenerateCommand = {
  projectPath?: string;
  dryRun: boolean;
  json: boolean;
  count?: number;
  style?: string;
  styles?: string[];
  sourceVariantId?: string;
  save: boolean;
  mode?: string;
  selectedVariantId?: string;
  errors: HeadlessVariantGenerationError[];
};

type ParsedOpenCommand =
  | {
      ok: true;
      options: StartEditorServerOptions;
    }
  | {
      ok: false;
      message: string;
    };

type ParsedAgentCommand =
  | {
      ok: true;
      help: true;
    }
  | {
      ok: true;
      help: false;
      projectPath: string;
      json: true;
      variantId?: string;
      generate?: "baseline";
      save?: AgentWorkflowSaveTarget;
      sourceVariantId?: string;
      openEditor: boolean;
      host?: string;
      port?: number;
    }
  | {
      ok: false;
      json: boolean;
      stderr?: string;
      errors: AgentWorkflowError[];
    };

type ParsedExportCommand =
  | {
      ok: true;
      help: true;
    }
  | {
      ok: true;
      help: false;
      projectPath: string;
      variantId?: string;
      preset?: string;
      json: true;
    }
  | {
      ok: false;
      json: boolean;
      stderr?: string;
      errors: RenderError[];
    };

const plannedCommands = new Set(["init", "capture"]);

/** Runs synchronous CLI commands. Use `runCliAsync` for async commands. */
export function runCli(args: string[]): CliResult {
  const [command] = args;

  if (command === undefined || command === "--help" || command === "-h") {
    return {
      exitCode: 0,
      stdout: helpText(),
      stderr: "",
    };
  }

  if (command === "capture") {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "autodemo capture requires async execution.\n",
    };
  }

  if (command === "validate") {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "autodemo validate requires async execution.\n",
    };
  }

  if (command === "generate") {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "autodemo generate requires async execution.\n",
    };
  }

  if (command === "open") {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "autodemo open requires async execution.\n",
    };
  }

  if (command === "agent") {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "autodemo agent requires async execution.\n",
    };
  }

  if (command === "export") {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "autodemo export requires async execution.\n",
    };
  }

  if (plannedCommands.has(command)) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `autodemo ${command} is not implemented yet.\n`,
    };
  }

  return {
    exitCode: 1,
    stdout: helpText(),
    stderr: `Unknown command: ${command}\n`,
  };
}

/** Runs the CLI, including browser capture and capture bundle validation. */
export async function runCliAsync(
  args: string[],
  dependencies: CliDependencies = defaultDependencies(),
): Promise<CliResult> {
  const [command, ...rest] = args;

  if (command === "validate") {
    return await runValidateCommand(rest);
  }

  if (command === "generate") {
    return await runGenerateCommand(rest);
  }

  if (command === "open") {
    return await runOpenCommand(rest, dependencies);
  }

  if (command === "agent") {
    return await runAgentCommand(rest, dependencies);
  }

  if (command === "export") {
    return await runExportCommand(rest, dependencies);
  }

  if (command !== "capture") {
    return runCli(args);
  }

  if (hasCaptureHelpFlag(rest)) {
    return {
      exitCode: 0,
      stdout: captureHelpText(),
      stderr: "",
    };
  }

  const parsed = parseCaptureCommand(rest, dependencies.now);
  if (!parsed.ok) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${parsed.message}\n`,
    };
  }

  const result = await dependencies.browserCaptureAdapter.start(parsed.options);
  if (!result.ok) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${result.message}\n`,
    };
  }

  const interruptWatcher =
    dependencies.createInterruptWatcher === undefined
      ? createSigintInterruptWatcher()
      : dependencies.createInterruptWatcher();
  let childResult: ChildCommandResult;
  try {
    const lifecycleResult =
      parsed.options.childCommand === undefined
        ? await waitForManualInterrupt(interruptWatcher)
        : await waitForChildCommandOrInterrupt(
            dependencies.runChildCommand(parsed.options.childCommand),
            interruptWatcher,
          );

    if (lifecycleResult.kind === "interrupted") {
      return await stopCaptureSession(result.session, "interrupted", 130, "Capture interrupted.\n");
    }

    childResult = lifecycleResult.childResult;
  } catch (error) {
    await result.session.stop("failed");
    throw error;
  } finally {
    interruptWatcher.dispose();
  }

  const stopReason = childResult.exitCode === 0 ? "completed" : "failed";
  return await stopCaptureSession(
    result.session,
    stopReason,
    childResult.exitCode,
    childResult.exitCode === 0 ? "" : `Child command exited with code ${childResult.exitCode}.\n`,
  );
}

async function runAgentCommand(args: string[], dependencies: CliDependencies): Promise<CliResult> {
  const parsed = parseAgentCommand(args);
  if (parsed.ok && parsed.help) {
    return {
      exitCode: 0,
      stdout: agentHelpText(),
      stderr: "",
    };
  }

  if (!parsed.ok) {
    if (!parsed.json && parsed.stderr !== undefined) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `${parsed.stderr}\n`,
      };
    }

    return {
      exitCode: 1,
      stdout: `${JSON.stringify(agentParseFailure(parsed.errors), null, 2)}\n`,
      stderr: "",
    };
  }

  const result = await runAgentWorkflow(
    {
      projectPath: parsed.projectPath,
      json: true,
      variantId: parsed.variantId,
      generate: parsed.generate,
      save: parsed.save,
      sourceVariantId: parsed.sourceVariantId,
      openEditor: parsed.openEditor,
      editor: {
        host: parsed.host,
        port: parsed.port,
      },
    },
    {
      async startEditorServer(options) {
        const startServer = dependencies.startEditorServer ?? startEditorServer;
        return await startServer({
          projectPath: options.projectPath,
          host: options.host ?? "127.0.0.1",
          port: options.port ?? 0,
        });
      },
    },
  );

  return {
    exitCode: result.ok ? 0 : 1,
    stdout: `${JSON.stringify(result, null, 2)}\n`,
    stderr: "",
  };
}

async function runExportCommand(args: string[], dependencies: CliDependencies): Promise<CliResult> {
  const parsed = parseExportCommand(args);
  if (parsed.ok && parsed.help) {
    return {
      exitCode: 0,
      stdout: exportHelpText(),
      stderr: "",
    };
  }

  if (!parsed.ok) {
    if (!parsed.json && parsed.stderr !== undefined) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `${parsed.stderr}\n`,
      };
    }

    return {
      exitCode: 1,
      stdout: `${JSON.stringify(exportParseFailure(parsed.errors), null, 2)}\n`,
      stderr: "",
    };
  }

  const renderSavedVariant = dependencies.renderSavedVariant ?? renderSavedVariantDefault;
  const result = await renderSavedVariant({
    projectPath: parsed.projectPath,
    variantId: parsed.variantId,
    preset: parsed.preset,
    now: dependencies.now,
  });

  return {
    exitCode: result.ok ? 0 : 1,
    stdout: `${JSON.stringify(result, null, 2)}\n`,
    stderr: "",
  };
}

async function runOpenCommand(args: string[], dependencies: CliDependencies): Promise<CliResult> {
  const parsed = parseOpenCommand(args);
  if (!parsed.ok) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${parsed.message}\n`,
    };
  }

  const startServer = dependencies.startEditorServer ?? startEditorServer;
  const server = await startServer(parsed.options);
  return {
    exitCode: 0,
    stdout: `Auto Demo editor: ${server.url}\n`,
    stderr: "",
  };
}

async function runValidateCommand(args: string[]): Promise<CliResult> {
  const [target, ...extra] = args;
  if (target === undefined || target.trim().length === 0 || extra.length > 0) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "autodemo validate requires <capture-dir-or-manifest>.\n",
    };
  }

  const result = await validateCaptureBundle(target);
  if (!result.ok) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Capture bundle invalid:\n${result.errors.map((error) => `- ${error}`).join("\n")}\n`,
    };
  }

  return {
    exitCode: 0,
    stdout: `Capture bundle valid: ${result.manifestPath}\n`,
    stderr: "",
  };
}

async function runGenerateCommand(args: string[]): Promise<CliResult> {
  const parsed = parseGenerateCommand(args);

  if (!parsed.json) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "autodemo generate currently requires --json output.\n",
    };
  }

  if (parsed.errors.length > 0) {
    const result = generateParseFailure(parsed);
    return {
      exitCode: 1,
      stdout: `${JSON.stringify(result, null, 2)}\n`,
      stderr: "",
    };
  }

  const result = await generateHeadlessVariants({
    projectPath: parsed.projectPath ?? "",
    dryRun: parsed.dryRun,
    json: parsed.json,
    count: parsed.count,
    style: parsed.style,
    styles: parsed.styles,
    sourceVariantId: parsed.sourceVariantId,
    save: parsed.save,
    mode: parsed.mode,
    selectedVariantId: parsed.selectedVariantId,
  });

  return {
    exitCode: result.ok ? 0 : 1,
    stdout: `${JSON.stringify(result, null, 2)}\n`,
    stderr: "",
  };
}

function parseAgentCommand(args: string[]): ParsedAgentCommand {
  const [subcommand, ...rest] = args;
  if (subcommand === "--help" || subcommand === "-h") {
    return { ok: true, help: true };
  }

  if (subcommand !== "run") {
    return {
      ok: false,
      json: rest.includes("--json"),
      errors: [
        {
          code: "unsupported_agent_command",
          message: "Unsupported autodemo agent command. Use autodemo agent run.",
        },
      ],
    };
  }

  if (rest.includes("--help") || rest.includes("-h")) {
    return { ok: true, help: true };
  }

  let projectPath = "";
  let json = false;
  let variantId: string | undefined;
  let generate: "baseline" | undefined;
  let save: AgentWorkflowSaveTarget | undefined;
  let sourceVariantId: string | undefined;
  let openEditor = false;
  let host: string | undefined;
  let port: number | undefined;
  const errors: AgentWorkflowError[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    if (arg === "--project") {
      const value = parseAgentOptionValue(rest, index, arg, errors);
      if (value !== undefined) {
        projectPath = value;
        index += 1;
      }
      continue;
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--variant") {
      const value = parseAgentOptionValue(rest, index, arg, errors);
      if (value !== undefined) {
        variantId = value;
        index += 1;
      }
      continue;
    }

    if (arg === "--generate") {
      const value = parseAgentOptionValue(rest, index, arg, errors);
      if (value === "baseline") {
        generate = "baseline";
      } else if (value !== undefined) {
        errors.push({
          code: "unsupported_generation",
          message: "autodemo agent run supports only --generate baseline.",
        });
      }
      if (value !== undefined) {
        index += 1;
      }
      continue;
    }

    if (arg === "--save") {
      const value = parseAgentOptionValue(rest, index, arg, errors);
      if (value !== undefined) {
        if (isSupportedAgentSaveTarget(value)) {
          save = value;
        } else {
          errors.push({
            code: "unsupported_generation",
            message: "autodemo agent run supports only --save baseline-polish or --save all.",
          });
        }
        index += 1;
      }
      continue;
    }

    if (arg === "--source-variant") {
      const value = parseAgentOptionValue(rest, index, arg, errors);
      if (value !== undefined) {
        sourceVariantId = value;
        index += 1;
      }
      continue;
    }

    if (arg === "--open-editor" || arg === "--no-browser") {
      openEditor = arg === "--open-editor" ? true : openEditor;
      continue;
    }

    if (arg === "--host") {
      const value = parseAgentOptionValue(rest, index, arg, errors);
      if (value !== undefined) {
        host = value;
        index += 1;
      }
      continue;
    }

    if (arg === "--port") {
      const value = parseAgentOptionValue(rest, index, arg, errors);
      const parsedPort = parseOpenPort(value);
      if (value !== undefined && parsedPort === undefined) {
        errors.push({
          code: "unknown_agent_argument",
          message: "autodemo agent run --port must be an integer from 0 to 65535.",
        });
      } else {
        port = parsedPort;
      }
      if (value !== undefined) {
        index += 1;
      }
      continue;
    }

    errors.push({
      code: "unknown_agent_argument",
      message: `Unknown agent argument: ${arg}`,
    });
  }

  if (!json) {
    return {
      ok: false,
      json: false,
      stderr: "autodemo agent run currently requires --json output.",
      errors,
    };
  }

  if (projectPath.trim().length === 0) {
    errors.push({
      code: "missing_project_path",
      message: "autodemo agent run requires --project <project-dir-or-manifest>.",
    });
  }

  if (save !== undefined && generate === undefined) {
    errors.push({
      code: "unsupported_generation",
      message: "autodemo agent run requires --generate baseline when --save is used.",
    });
  }

  if (sourceVariantId !== undefined && generate === undefined) {
    errors.push({
      code: "unsupported_generation",
      message: "autodemo agent run requires --generate baseline when --source-variant is used.",
    });
  }

  if (errors.length > 0) {
    return { ok: false, json, errors };
  }

  return {
    ok: true,
    help: false,
    projectPath,
    json: true,
    variantId,
    generate,
    save,
    sourceVariantId,
    openEditor,
    host,
    port,
  };
}

function parseAgentOptionValue(
  args: string[],
  index: number,
  option: string,
  errors: AgentWorkflowError[],
): string | undefined {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    errors.push({
      code: "unknown_agent_argument",
      message: `Missing value for agent argument: ${option}`,
    });
    return undefined;
  }

  return value;
}

function isSupportedAgentSaveTarget(value: string): value is AgentWorkflowSaveTarget {
  return value === "baseline-polish" || value === "all";
}

function agentParseFailure(errors: AgentWorkflowError[]): {
  ok: false;
  project: { projectPath: string };
  errors: AgentWorkflowError[];
} {
  return {
    ok: false,
    project: { projectPath: "" },
    errors,
  };
}

function parseGenerateCommand(args: string[]): ParsedGenerateCommand {
  let projectPath: string | undefined;
  let dryRun = false;
  let json = false;
  let count: number | undefined;
  let style: string | undefined;
  let styles: string[] | undefined;
  let sourceVariantId: string | undefined;
  let save = false;
  let saveSeen = false;
  let mode: string | undefined;
  let selectedVariantId: string | undefined;
  const errors: HeadlessVariantGenerationError[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--project") {
      const value = parseGenerateOptionValue(args, index, arg, errors);
      if (value !== undefined) {
        projectPath = value;
        index += 1;
      }
      continue;
    }

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--count") {
      const value = parseGenerateOptionValue(args, index, arg, errors);
      if (value !== undefined) {
        count = parseGenerateCount(value);
        index += 1;
      }
      continue;
    }

    if (arg === "--style") {
      const value = parseGenerateOptionValue(args, index, arg, errors);
      if (value !== undefined) {
        style = value;
        index += 1;
      }
      continue;
    }

    if (arg === "--styles") {
      const value = parseGenerateOptionValue(args, index, arg, errors);
      if (value !== undefined) {
        styles = parseGenerateStyles(value);
        index += 1;
      }
      continue;
    }

    if (arg === "--source-variant") {
      const value = parseGenerateOptionValue(args, index, arg, errors);
      if (value !== undefined) {
        sourceVariantId = value;
        index += 1;
      }
      continue;
    }

    if (arg === "--save") {
      const value = parseGenerateOptionValue(args, index, arg, errors);
      if (value !== undefined) {
        if (saveSeen) {
          errors.push({
            code: "unknown_generate_argument",
            message: "Generate argument --save may only be used once.",
          });
        } else {
          saveSeen = true;
          save = true;
          if (value === "all") {
            mode = "all";
          } else {
            selectedVariantId = value;
          }
        }
        index += 1;
      }
      continue;
    }

    errors.push({
      code: "unknown_generate_argument",
      message: `Unknown generate argument: ${arg}`,
    });
  }

  return {
    projectPath,
    dryRun,
    json,
    count,
    style,
    styles,
    sourceVariantId,
    save,
    mode,
    selectedVariantId,
    errors,
  };
}

function parseGenerateOptionValue(
  args: string[],
  index: number,
  option: string,
  errors: HeadlessVariantGenerationError[],
): string | undefined {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    errors.push({
      code: "unknown_generate_argument",
      message: `Missing value for generate argument: ${option}`,
    });
    return undefined;
  }

  return value;
}

function parseGenerateCount(value: string | undefined): number {
  if (value === "1") {
    return 1;
  }

  if (value !== undefined && /^-?\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    return value === String(parsed) ? parsed : 0;
  }

  return 0;
}

function parseGenerateStyles(value: string): string[] {
  return value.split(",").map((style) => style.trim());
}

function generateParseFailure(parsed: ParsedGenerateCommand): HeadlessVariantGenerationResult {
  const styles =
    parsed.styles !== undefined
      ? parsed.styles
      : parsed.style !== undefined
        ? [parsed.style]
        : ["baseline"];

  return {
    ok: false,
    project: {
      projectPath: parsed.projectPath ?? "",
    },
    requested: {
      count: parsed.count ?? styles.length,
      styles,
      dryRun: parsed.dryRun,
      sourceVariantId: parsed.sourceVariantId ?? "baseline-polish",
    },
    variants: [],
    errors: parsed.errors,
  };
}

function parseExportCommand(args: string[]): ParsedExportCommand {
  if (args.includes("--help") || args.includes("-h")) {
    return { ok: true, help: true };
  }

  let projectPath = "";
  let variantId: string | undefined;
  let preset: string | undefined;
  let json = false;
  const errors: RenderError[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--project") {
      const value = parseExportOptionValue(args, index, arg, errors);
      if (value !== undefined) {
        projectPath = value;
        index += 1;
      }
      continue;
    }

    if (arg === "--variant") {
      const value = parseExportOptionValue(args, index, arg, errors);
      if (value !== undefined) {
        variantId = value;
        index += 1;
      }
      continue;
    }

    if (arg === "--preset") {
      const value = parseExportOptionValue(args, index, arg, errors);
      if (value !== undefined) {
        preset = value;
        if (value !== "mp4-demo") {
          errors.push({
            code: "unsupported_preset",
            message: "autodemo export supports only --preset mp4-demo.",
          });
        }
        index += 1;
      }
      continue;
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    errors.push({
      code: "invalid_export_request",
      message: `Unknown autodemo export option: ${arg}`,
    });
  }

  if (!json) {
    return {
      ok: false,
      json,
      stderr: "autodemo export currently requires --json output.",
      errors,
    };
  }

  if (projectPath.trim().length === 0) {
    errors.push({
      code: "invalid_export_request",
      message: "autodemo export requires --project <project-dir-or-manifest>.",
    });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      json,
      errors,
    };
  }

  return {
    ok: true,
    help: false,
    projectPath,
    variantId,
    preset,
    json: true,
  };
}

function parseExportOptionValue(
  args: string[],
  index: number,
  option: string,
  errors: RenderError[],
): string | undefined {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--") || value.trim().length === 0) {
    errors.push({
      code: "invalid_export_request",
      message: `autodemo export ${option} requires a value.`,
    });
    return undefined;
  }

  return value;
}

function parseOpenCommand(args: string[]): ParsedOpenCommand {
  let projectPath: string | undefined;
  let host = "127.0.0.1";
  let port = 0;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--project") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return {
          ok: false,
          message: "autodemo open requires --project <project-dir-or-manifest>.",
        };
      }
      projectPath = value;
      index += 1;
      continue;
    }

    if (arg === "--host") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, message: "autodemo open --host requires a value." };
      }
      host = value;
      index += 1;
      continue;
    }

    if (arg === "--port") {
      const parsedPort = parseOpenPort(args[index + 1]);
      if (parsedPort === undefined) {
        return {
          ok: false,
          message: "autodemo open --port must be an integer from 0 to 65535.",
        };
      }
      port = parsedPort;
      index += 1;
      continue;
    }

    if (arg === "--no-browser") {
      continue;
    }

    return { ok: false, message: `Unknown autodemo open option: ${arg}` };
  }

  if (projectPath === undefined || projectPath.trim().length === 0) {
    return { ok: false, message: "autodemo open requires --project <project-dir-or-manifest>." };
  }

  return {
    ok: true,
    options: {
      projectPath,
      host,
      port,
    },
  };
}

function parseOpenPort(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (String(parsed) !== value || parsed < 0 || parsed > 65535) {
    return undefined;
  }

  return parsed;
}

async function waitForManualInterrupt(
  interruptWatcher: InterruptWatcher,
): Promise<{ kind: "interrupted" }> {
  await interruptWatcher.interrupted;
  return { kind: "interrupted" };
}

async function waitForChildCommandOrInterrupt(
  childCommand: Promise<ChildCommandResult>,
  interruptWatcher: InterruptWatcher,
): Promise<
  | {
      kind: "child";
      childResult: ChildCommandResult;
    }
  | {
      kind: "interrupted";
    }
> {
  return await Promise.race([
    childCommand.then((childResult) => ({ kind: "child", childResult }) as const),
    interruptWatcher.interrupted.then(() => ({ kind: "interrupted" }) as const),
  ]);
}

async function stopCaptureSession(
  session: CaptureSession,
  reason: CaptureStopReason,
  exitCode: number,
  stderr: string,
): Promise<CliResult> {
  const stopResult = await session.stop(reason);
  if (!stopResult.ok) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${stopResult.message}\nCapture bundle: ${stopResult.manifestPath}\n`,
    };
  }

  return {
    exitCode,
    stdout: `Capture bundle: ${stopResult.output.manifestPath}\n`,
    stderr,
  };
}

function hasCaptureHelpFlag(args: string[]): boolean {
  for (const arg of args) {
    if (arg === "--") {
      return false;
    }

    if (arg === "--help" || arg === "-h") {
      return true;
    }
  }

  return false;
}

function parseCaptureCommand(args: string[], now: () => Date): ParsedCaptureCommand {
  let url: string | undefined;
  let outputDir: string | undefined;
  let viewport: CaptureViewport = { ...DEFAULT_BROWSER_VIEWPORT };
  let childCommand: CaptureChildCommand | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      const childParts = args.slice(index + 1);
      if (childParts.length > 0) {
        const [command, ...commandArgs] = childParts;
        childCommand = { command, args: commandArgs };
      }
      break;
    }

    if (arg === "--url") {
      url = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--out") {
      outputDir = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--viewport") {
      const parsedViewport = parseViewport(args[index + 1]);
      if (parsedViewport === undefined) {
        return {
          ok: false,
          message: "autodemo capture --viewport must use <width>x<height>, for example 1280x720.",
        };
      }
      viewport = parsedViewport;
      index += 1;
      continue;
    }

    return {
      ok: false,
      message: `Unknown autodemo capture option: ${arg}`,
    };
  }

  if (url === undefined || url.trim().length === 0) {
    return { ok: false, message: "autodemo capture requires --url <url>." };
  }

  if (outputDir === undefined || outputDir.trim().length === 0) {
    return { ok: false, message: "autodemo capture requires --out <capture-dir>." };
  }

  const options: BrowserCaptureOptions = {
    source: { kind: "browser", url },
    outputDir,
    viewport,
    startedAt: now().toISOString(),
  };

  if (childCommand !== undefined) {
    options.childCommand = childCommand;
  }

  return {
    ok: true,
    options,
  };
}

function parseViewport(input: string | undefined): CaptureViewport | undefined {
  if (input === undefined) {
    return undefined;
  }

  const match = /^(?<width>[1-9]\d*)x(?<height>[1-9]\d*)$/.exec(input);
  if (match?.groups === undefined) {
    return undefined;
  }

  return {
    width: Number.parseInt(match.groups.width, 10),
    height: Number.parseInt(match.groups.height, 10),
  };
}

function exportParseFailure(errors: RenderError[]): RenderSavedVariantResult {
  return {
    ok: false,
    errors,
  };
}

function defaultDependencies(): CliDependencies {
  return {
    browserCaptureAdapter: createPlaywrightBrowserCaptureAdapter(),
    createInterruptWatcher: createSigintInterruptWatcher,
    now: () => new Date(),
    runChildCommand: runChildCommandWithInheritedStdio,
    startEditorServer,
    renderSavedVariant: renderSavedVariantDefault,
  };
}

function createSigintInterruptWatcher(): InterruptWatcher {
  let dispose = () => {};
  const interrupted = new Promise<void>((resolve) => {
    const onSigint = () => {
      resolve();
    };
    process.once("SIGINT", onSigint);
    dispose = () => {
      process.off("SIGINT", onSigint);
    };
  });

  return { interrupted, dispose };
}

async function runChildCommandWithInheritedStdio(
  command: CaptureChildCommand,
): Promise<ChildCommandResult> {
  return await new Promise((resolve) => {
    const child = spawn(command.command, command.args, { stdio: "inherit" });

    child.on("error", () => {
      resolve({ exitCode: 1 });
    });

    child.on("exit", (code) => {
      resolve({ exitCode: code ?? 1 });
    });
  });
}

function helpText(): string {
  return [
    "Usage: autodemo <command>",
    "",
    "Commands:",
    "  init       Prepare an Auto Demo project context",
    "  capture    Record a browser-first walkthrough",
    "  generate   Generate polished variants",
    "  agent      Run the agent-facing workflow handoff",
    "  export     Render selected variants",
    "  open       Open the local editor",
    "  validate   Validate a capture bundle",
    "",
  ].join("\n");
}

function agentHelpText(): string {
  return [
    "Usage: autodemo agent run --project <project-dir-or-manifest> --json",
    "",
    "Options:",
    "  --variant <variant-id>       Select an existing saved variant",
    "  --generate baseline          Generate the MVP baseline variant",
    "  --source-variant <id>        Source variant for baseline generation",
    "  --save <baseline-polish|all> Save generated baseline output",
    "  --open-editor                Include local editor URL and keep server alive",
    "  --host <host>                Editor bind host when --open-editor is used",
    "  --port <port>                Editor port when --open-editor is used",
    "  --no-browser                 Accepted for compatibility; no browser auto-launch",
    "",
    "Exit codes:",
    "  0  Agent handoff summary written as JSON",
    "  1  Expected validation, generation, or handoff failure",
    "",
  ].join("\n");
}

function exportHelpText(): string {
  return [
    "Usage: autodemo export --project <project-dir-or-manifest> [--variant <variant-id>] [--preset mp4-demo] --json",
    "",
    "Options:",
    "  --project <path>       Auto Demo project directory or autodemo.project.json path",
    "  --variant <id>         Saved variant id to render",
    "  --preset mp4-demo      MVP MP4 export preset",
    "  --json                 Print machine-readable render result",
    "  -h, --help             Show export help",
    "",
  ].join("\n");
}

function captureHelpText(): string {
  return [
    "Usage: autodemo capture --url <url> --out <capture-dir> [--viewport <width>x<height>] [--] [walkthrough command...]",
    "",
    "Options:",
    "  --url <url>                  Browser URL to capture",
    "  --out <capture-dir>          Capture bundle output directory",
    "  --viewport <width>x<height>  Browser viewport size (default: 1280x720)",
    "  -h, --help                   Show capture help",
    "",
    "Child command:",
    "  -- [walkthrough command...]  Optional command to run while capture is active",
    "",
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runCliAsync(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
