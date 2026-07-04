#!/usr/bin/env node

import { spawn } from "node:child_process";
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

const plannedCommands = new Set(["init", "capture", "export", "open"]);

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

function parseGenerateCommand(args: string[]): ParsedGenerateCommand {
  let projectPath: string | undefined;
  let dryRun = false;
  let json = false;
  let count: number | undefined;
  let style: string | undefined;
  let styles: string[] | undefined;
  let sourceVariantId: string | undefined;
  let save = false;
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
        save = true;
        if (value === "all") {
          mode = "all";
        } else {
          selectedVariantId = value;
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

function defaultDependencies(): CliDependencies {
  return {
    browserCaptureAdapter: createPlaywrightBrowserCaptureAdapter(),
    createInterruptWatcher: createSigintInterruptWatcher,
    now: () => new Date(),
    runChildCommand: runChildCommandWithInheritedStdio,
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
    "  export     Render selected variants",
    "  open       Open the local editor",
    "  validate   Validate a capture bundle",
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
