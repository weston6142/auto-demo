import { readdir, readFile, stat } from "node:fs/promises";
import {
  executeWalkthroughPlan,
  isWalkthroughPlan,
  type WalkthroughExecutionCaptureStartResult,
} from "@auto-demo/agent";
import {
  DEFAULT_BROWSER_VIEWPORT,
  type CaptureViewport,
  type ControllableBrowserCaptureAdapter,
  type ControllableCaptureStartResult,
} from "@auto-demo/capture";

type AgentExecuteCliResult = { exitCode: number; stdout: string; stderr: string };

type AgentExecuteCommandDependencies = {
  captureAdapter: ControllableBrowserCaptureAdapter;
  now: () => Date;
  interrupted: Promise<void>;
  sleep?: (durationMs: number) => Promise<void>;
};

type AgentExecuteParseError = {
  code:
    | "missing_plan_file"
    | "invalid_plan_json"
    | "missing_inputs_file"
    | "invalid_inputs_json"
    | "missing_capture_output"
    | "invalid_viewport"
    | "unknown_agent_argument";
  message: string;
};

export async function runAgentExecuteCommand(
  args: string[],
  dependencies: AgentExecuteCommandDependencies,
): Promise<AgentExecuteCliResult> {
  const parsed = parseAgentExecuteCommand(args);
  if (!parsed.ok) return failure(parsed.errors, parsed.json);

  const planResult = await readPlan(parsed.planPath);
  if (!planResult.ok) return failure(planResult.errors, true);
  const inputsResult = await readInputs(parsed.inputsPath);
  if (!inputsResult.ok) return failure(inputsResult.errors, true);
  const viewport =
    parsed.viewport ?? planResult.plan.launchProfile?.viewport ?? DEFAULT_BROWSER_VIEWPORT;

  const result = await executeWalkthroughPlan(
    {
      plan: planResult.plan,
      inputBindings: inputsResult.inputs,
      outputDir: parsed.outputDir,
      viewport,
    },
    {
      now: dependencies.now,
      sleep: dependencies.sleep ?? sleep,
      interrupted: dependencies.interrupted,
      outputDirectoryState,
      async startCapture(options) {
        const started = await dependencies.captureAdapter.start({
          source: { kind: "browser", url: options.sourceUrl },
          outputDir: options.outputDir,
          viewport: options.viewport,
          ...(options.launchProfile === undefined ? {} : { launchProfile: options.launchProfile }),
          startedAt: dependencies.now().toISOString(),
        });
        return adaptCaptureStartResult(started);
      },
    },
  );

  return {
    exitCode: result.ok ? 0 : result.interrupted ? 130 : 1,
    stdout: `${JSON.stringify(result, null, 2)}\n`,
    stderr: "",
  };
}

function parseAgentExecuteCommand(args: string[]):
  | {
      ok: true;
      planPath: string;
      inputsPath?: string;
      outputDir: string;
      viewport?: CaptureViewport;
    }
  | { ok: false; json: boolean; errors: AgentExecuteParseError[] } {
  let planPath: string | undefined;
  let inputsPath: string | undefined;
  let outputDir: string | undefined;
  let viewport: CaptureViewport | undefined;
  let json = false;
  const errors: AgentExecuteParseError[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (
      argument === "--plan" ||
      argument === "--inputs" ||
      argument === "--out" ||
      argument === "--viewport"
    ) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        errors.push({
          code: "unknown_agent_argument",
          message: `Missing value for agent execute argument: ${argument}`,
        });
        continue;
      }
      index += 1;
      if (argument === "--plan") planPath = value;
      if (argument === "--inputs") inputsPath = value;
      if (argument === "--out") outputDir = value;
      if (argument === "--viewport") {
        const match = /^(\d+)x(\d+)$/.exec(value);
        if (match === null || Number(match[1]) < 1 || Number(match[2]) < 1) {
          errors.push({
            code: "invalid_viewport",
            message: "Execute viewport must be WIDTHxHEIGHT.",
          });
        } else {
          viewport = { width: Number(match[1]), height: Number(match[2]) };
        }
      }
      continue;
    }
    errors.push({
      code: "unknown_agent_argument",
      message: `Unknown agent execute argument: ${argument}`,
    });
  }
  if (planPath === undefined) {
    errors.push({ code: "missing_plan_file", message: "Agent execute requires --plan <file>." });
  }
  if (outputDir === undefined) {
    errors.push({
      code: "missing_capture_output",
      message: "Agent execute requires --out <capture-directory>.",
    });
  }
  if (!json) {
    errors.push({
      code: "unknown_agent_argument",
      message: "Agent execute requires --json output.",
    });
  }
  if (errors.length > 0 || planPath === undefined || outputDir === undefined) {
    return { ok: false, json, errors };
  }
  return { ok: true, planPath, inputsPath, outputDir, viewport };
}

async function readPlan(
  path: string,
): Promise<
  | { ok: true; plan: Parameters<typeof executeWalkthroughPlan>[0]["plan"] }
  | { ok: false; errors: AgentExecuteParseError[] }
> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return {
      ok: false,
      errors: [{ code: "missing_plan_file", message: "Agent execute plan file was not found." }],
    };
  }
  try {
    const decoded: unknown = JSON.parse(raw);
    const candidate =
      typeof decoded === "object" && decoded !== null && "plan" in decoded
        ? (decoded as { plan?: unknown }).plan
        : decoded;
    if (!isWalkthroughPlan(candidate)) throw new Error("invalid");
    return { ok: true, plan: candidate };
  } catch {
    return {
      ok: false,
      errors: [
        { code: "invalid_plan_json", message: "Agent execute requires a valid plan JSON file." },
      ],
    };
  }
}

async function readInputs(
  path: string | undefined,
): Promise<
  { ok: true; inputs: Record<string, unknown> } | { ok: false; errors: AgentExecuteParseError[] }
> {
  if (path === undefined) return { ok: true, inputs: {} };
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return {
      ok: false,
      errors: [
        { code: "missing_inputs_file", message: "Agent execute inputs file was not found." },
      ],
    };
  }
  try {
    const decoded: unknown = JSON.parse(raw);
    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded))
      throw new Error("invalid");
    return { ok: true, inputs: decoded as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      errors: [
        { code: "invalid_inputs_json", message: "Agent execute inputs must be a JSON object." },
      ],
    };
  }
}

function adaptCaptureStartResult(
  started: ControllableCaptureStartResult,
): WalkthroughExecutionCaptureStartResult {
  if (!started.ok) {
    if (started.code === "anti_bot_challenge") {
      return {
        ok: false,
        code: "anti_bot_challenge",
        outputDir: started.outputDir,
        manifestPath: started.manifestPath,
        ...(started.diagnostic === undefined ? {} : { diagnostic: started.diagnostic }),
      };
    }
    return {
      ok: false,
      code: "capture_setup_failed",
      outputDir: started.outputDir,
      manifestPath: started.manifestPath,
    };
  }
  return {
    ok: true,
    session: {
      browser: started.session.browser,
      outputDir: started.session.outputDir,
      manifestPath: started.session.manifestPath,
      async stop(reason) {
        const stopped = await started.session.stop(reason);
        if (!stopped.ok) {
          return {
            ok: false,
            code: "capture_stop_failed",
            outputDir: stopped.outputDir,
            manifestPath: stopped.manifestPath,
          };
        }
        return {
          ok: true,
          output: {
            outputDir: stopped.output.outputDir,
            manifestPath: stopped.output.manifestPath,
            mediaPath: stopped.output.media.path,
            metadataPath: stopped.output.metadata.path,
            ...stopped.output.timing,
          },
        };
      },
    },
  };
}

async function outputDirectoryState(path: string): Promise<"missing" | "empty" | "non-empty"> {
  try {
    const details = await stat(path);
    if (!details.isDirectory()) return "non-empty";
    return (await readdir(path)).length === 0 ? "empty" : "non-empty";
  } catch {
    return "missing";
  }
}

async function sleep(durationMs: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
}

function failure(errors: AgentExecuteParseError[], json: boolean): AgentExecuteCliResult {
  if (!json) {
    return { exitCode: 1, stdout: "", stderr: "autodemo agent execute requires --json output.\n" };
  }
  return { exitCode: 1, stdout: `${JSON.stringify({ ok: false, errors }, null, 2)}\n`, stderr: "" };
}
