import { readFile } from "node:fs/promises";
import {
  approveWalkthroughPlan,
  isWalkthroughPlan,
  refineWalkthroughPlan,
  reviewWalkthroughPlan,
  type WalkthroughPlan,
  type WalkthroughPlanRefinement,
  type WalkthroughValidationBrowserRunner,
} from "@auto-demo/agent";

export type AgentReviewCommand = "review" | "refine" | "approve";

export type AgentReviewCommandDependencies = {
  now: () => Date;
  createValidationRunner: () => WalkthroughValidationBrowserRunner;
};

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type CommandError = { code: string; message: string };

type ParsedCommand =
  | {
      ok: true;
      planPath: string;
      refinementsPath?: string;
      allowBestGuessBypass: boolean;
    }
  | { ok: false; json: boolean; errors: CommandError[] };

export async function runAgentReviewCommand(
  command: AgentReviewCommand,
  args: string[],
  dependencies: AgentReviewCommandDependencies,
): Promise<CommandResult> {
  const parsed = parseCommand(command, args);
  if (!parsed.ok) {
    if (!parsed.json) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `autodemo agent ${command} currently requires --json output.\n`,
      };
    }
    return jsonFailure(parsed.errors);
  }

  const planResult = await readPlanFile(parsed.planPath);
  if (!planResult.ok) return jsonFailure(planResult.errors);

  if (command === "review") {
    return jsonResult(reviewWalkthroughPlan(planResult.plan));
  }
  if (command === "approve") {
    return jsonResult(
      approveWalkthroughPlan(planResult.plan, {
        now: dependencies.now,
        allowBestGuessBypass: parsed.allowBestGuessBypass,
      }),
    );
  }

  const refinementsResult = await readRefinementsFile(parsed.refinementsPath ?? "");
  if (!refinementsResult.ok) return jsonFailure(refinementsResult.errors);
  const result = await refineWalkthroughPlan(
    planResult.plan,
    refinementsResult.refinements,
    { now: dependencies.now },
    { browser: dependencies.createValidationRunner() },
  );
  return jsonResult(result);
}

function parseCommand(command: AgentReviewCommand, args: string[]): ParsedCommand {
  let json = false;
  let planPath: string | undefined;
  let refinementsPath: string | undefined;
  let allowBestGuessBypass = false;
  const errors: CommandError[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--allow-best-guess-bypass" && command === "approve") {
      allowBestGuessBypass = true;
      continue;
    }
    if (arg === "--plan" || (arg === "--refinements" && command === "refine")) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        errors.push({
          code: "unknown_agent_argument",
          message: `Missing value for agent ${command} argument: ${arg}`,
        });
      } else {
        if (arg === "--plan") planPath = value;
        if (arg === "--refinements") refinementsPath = value;
        index += 1;
      }
      continue;
    }
    errors.push({
      code: "unknown_agent_argument",
      message: `Unknown agent ${command} argument: ${arg}`,
    });
  }

  if (!json) return { ok: false, json: false, errors };
  if (planPath === undefined) {
    errors.push({
      code: "missing_review_input",
      message: `autodemo agent ${command} requires --plan <plan-json-file>.`,
    });
  }
  if (command === "refine" && refinementsPath === undefined) {
    errors.push({
      code: "missing_refinements_input",
      message: "autodemo agent refine requires --refinements <refinements-json-file>.",
    });
  }
  if (errors.length > 0 || planPath === undefined) {
    return { ok: false, json: true, errors };
  }
  return { ok: true, planPath, refinementsPath, allowBestGuessBypass };
}

async function readPlanFile(
  path: string,
): Promise<{ ok: true; plan: WalkthroughPlan } | { ok: false; errors: CommandError[] }> {
  const parsed = await readJsonFile(path, "plan");
  if (!parsed.ok) return parsed;
  const plan =
    typeof parsed.value === "object" && parsed.value !== null && "plan" in parsed.value
      ? (parsed.value as { plan?: unknown }).plan
      : parsed.value;
  if (!isWalkthroughPlan(plan)) {
    return {
      ok: false,
      errors: [
        {
          code: "invalid_plan",
          message: "Walkthrough review plan file must contain a walkthrough plan.",
        },
      ],
    };
  }
  return { ok: true, plan };
}

async function readRefinementsFile(
  path: string,
): Promise<
  { ok: true; refinements: WalkthroughPlanRefinement[] } | { ok: false; errors: CommandError[] }
> {
  const parsed = await readJsonFile(path, "refinements");
  if (!parsed.ok) return parsed;
  if (!Array.isArray(parsed.value)) {
    return {
      ok: false,
      errors: [
        {
          code: "invalid_refinements_json",
          message: "Walkthrough refinements file must contain a JSON array.",
        },
      ],
    };
  }
  return { ok: true, refinements: parsed.value as WalkthroughPlanRefinement[] };
}

async function readJsonFile(
  path: string,
  kind: "plan" | "refinements",
): Promise<{ ok: true; value: unknown } | { ok: false; errors: CommandError[] }> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return {
      ok: false,
      errors: [
        {
          code: kind === "plan" ? "missing_plan_file" : "missing_refinements_file",
          message: `Walkthrough ${kind} file was not found.`,
        },
      ],
    };
  }
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return {
      ok: false,
      errors: [
        {
          code: kind === "plan" ? "invalid_plan_json" : "invalid_refinements_json",
          message: `Walkthrough ${kind} file must contain JSON.`,
        },
      ],
    };
  }
}

function jsonResult(result: { ok: boolean }): CommandResult {
  return {
    exitCode: result.ok ? 0 : 1,
    stdout: `${JSON.stringify(result, null, 2)}\n`,
    stderr: "",
  };
}

function jsonFailure(errors: CommandError[]): CommandResult {
  return {
    exitCode: 1,
    stdout: `${JSON.stringify({ ok: false, errors }, null, 2)}\n`,
    stderr: "",
  };
}
