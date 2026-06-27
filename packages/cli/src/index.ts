#!/usr/bin/env node

export type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
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
  const result = runCli(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
