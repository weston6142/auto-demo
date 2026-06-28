#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  createUnsupportedBrowserCaptureAdapter,
  DEFAULT_BROWSER_VIEWPORT,
  type BrowserCaptureAdapter,
  type BrowserCaptureOptions,
  type CaptureChildCommand,
  type CaptureViewport,
} from "@auto-demo/capture";

export type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CliDependencies = {
  browserCaptureAdapter: BrowserCaptureAdapter;
  now: () => Date;
  runChildCommand: (command: CaptureChildCommand) => Promise<ChildCommandResult>;
};

export type ChildCommandResult = {
  exitCode: number;
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

const plannedCommands = new Set(["init", "capture", "generate", "export", "open", "validate"]);

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

export async function runCliAsync(
  args: string[],
  dependencies: CliDependencies = defaultDependencies(),
): Promise<CliResult> {
  const [command, ...rest] = args;

  if (command !== "capture") {
    return runCli(args);
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

  let childResult: ChildCommandResult;
  try {
    childResult =
      parsed.options.childCommand === undefined
        ? { exitCode: 0 }
        : await dependencies.runChildCommand(parsed.options.childCommand);
  } catch (error) {
    await result.session.stop("failed");
    throw error;
  }

  const stopReason = childResult.exitCode === 0 ? "completed" : "failed";
  const stopResult = await result.session.stop(stopReason);
  if (!stopResult.ok) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${stopResult.message}\n`,
    };
  }

  return {
    exitCode: childResult.exitCode,
    stdout: `Capture bundle: ${stopResult.output.manifestPath}\n`,
    stderr:
      childResult.exitCode === 0 ? "" : `Child command exited with code ${childResult.exitCode}.\n`,
  };
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
    browserCaptureAdapter: createUnsupportedBrowserCaptureAdapter(),
    now: () => new Date(),
    runChildCommand: runChildCommandWithInheritedStdio,
  };
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
    "  validate   Validate an Auto Demo project",
    "",
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runCliAsync(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
