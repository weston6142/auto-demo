import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWalkthroughPlan, type WalkthroughPlan } from "@auto-demo/agent";
import { runCliAsync, type CliDependencies } from "./index.js";

function dependencies(): CliDependencies {
  return {
    browserCaptureAdapter: {
      kind: "browser",
      async start() {
        throw new Error("capture should not start during review workflow tests");
      },
    },
    createValidationRunner: () => ({
      async open() {},
      async navigate() {},
      async inspectPage() {
        return { url: "https://example.com/signup", title: "Signup", authWall: false };
      },
      async findMatches(step) {
        return [{ id: `${step.id}-match`, label: step.public.summary }];
      },
      async click() {},
      async type() {},
      async waitForIdle() {},
      async close() {},
    }),
    now: () => new Date("2026-07-10T15:00:00.000Z"),
    async runChildCommand() {
      return { exitCode: 0 };
    },
  };
}

function createPlan(mode: "validate-first" | "best-guess", script: string): WalkthroughPlan {
  const result = createWalkthroughPlan({
    targetUrl: "https://example.com/signup",
    script,
    mode,
  });
  if (!result.ok) throw new Error("test plan should be valid");
  return result.plan;
}

function readyPlan(): WalkthroughPlan {
  const plan = createPlan("validate-first", "Click Get started.");
  plan.state = "validated";
  plan.validation = {
    status: "ready",
    validatedAt: "2026-07-10T14:00:00.000Z",
    mode: "dry-run",
    checks: [
      {
        id: "check-1",
        stepId: "step-1",
        action: "click",
        status: "passed",
        summary: "Validated: Click Get started.",
      },
    ],
    blockers: [],
  };
  return plan;
}

async function jsonFile(directory: string, name: string, value: unknown): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

describe("agent walkthrough review commands", () => {
  it("reviews, refines, and approves plan artifacts as JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "auto-demo-agent-review-"));
    const readyPath = await jsonFile(directory, "ready.json", readyPlan());
    const blockedPath = await jsonFile(
      directory,
      "blocked.json",
      createPlan("validate-first", "Pick the best option."),
    );
    const refinementsPath = await jsonFile(directory, "refinements.json", [
      {
        kind: "replace-step",
        stepId: "step-1",
        replacement: {
          action: "click",
          resolution: "resolved",
          sourceText: "Click Get started.",
          public: { summary: "Click Get started." },
        },
      },
    ]);

    const review = await runCliAsync(
      ["agent", "review", "--plan", readyPath, "--json"],
      dependencies(),
    );
    const refine = await runCliAsync(
      ["agent", "refine", "--plan", blockedPath, "--refinements", refinementsPath, "--json"],
      dependencies(),
    );
    const approve = await runCliAsync(
      ["agent", "approve", "--plan", readyPath, "--json"],
      dependencies(),
    );

    expect(review.exitCode).toBe(0);
    expect(JSON.parse(review.stdout)).toMatchObject({
      ok: true,
      review: { state: "validated", approval: { eligible: true } },
    });
    expect(refine.exitCode).toBe(0);
    expect(JSON.parse(refine.stdout)).toMatchObject({
      ok: true,
      plan: { state: "validated", validation: { status: "ready" } },
    });
    expect(approve.exitCode).toBe(0);
    expect(JSON.parse(approve.stdout)).toMatchObject({
      ok: true,
      plan: {
        state: "approved",
        approvals: { approved: true, basis: "validated" },
      },
    });
  });

  it("requires explicit best-guess bypass on approval", async () => {
    const directory = await mkdtemp(join(tmpdir(), "auto-demo-agent-review-"));
    const planPath = await jsonFile(
      directory,
      "best-guess.json",
      createPlan("best-guess", "Type hunter2 into the search field."),
    );

    const rejected = await runCliAsync(
      ["agent", "approve", "--plan", planPath, "--json"],
      dependencies(),
    );
    const approved = await runCliAsync(
      ["agent", "approve", "--plan", planPath, "--allow-best-guess-bypass", "--json"],
      dependencies(),
    );

    expect(rejected.exitCode).toBe(1);
    expect(JSON.parse(rejected.stdout)).toMatchObject({
      ok: false,
      errors: [{ code: "best_guess_bypass_required" }],
    });
    expect(approved.exitCode).toBe(0);
    expect(JSON.parse(approved.stdout)).toMatchObject({
      ok: true,
      plan: {
        source: { script: "Type [redacted] into the search field." },
        approvals: { basis: "best-guess-bypass" },
      },
    });
    expect(approved.stdout).not.toContain("hunter2");
  });

  it("returns stable errors for missing, malformed, and conflicting inputs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "auto-demo-agent-review-"));
    const malformed = join(directory, "malformed.json");
    const invalidRefinements = await jsonFile(directory, "refinements.json", { kind: "replace" });
    await writeFile(malformed, "not json\n");

    const missing = await runCliAsync(
      ["agent", "review", "--plan", join(directory, "missing.json"), "--json"],
      dependencies(),
    );
    const invalidJson = await runCliAsync(
      ["agent", "review", "--plan", malformed, "--json"],
      dependencies(),
    );
    const invalidChanges = await runCliAsync(
      ["agent", "refine", "--plan", malformed, "--refinements", invalidRefinements, "--json"],
      dependencies(),
    );
    const noJson = await runCliAsync(["agent", "review", "--plan", malformed], dependencies());

    expect(JSON.parse(missing.stdout)).toMatchObject({
      ok: false,
      errors: [{ code: "missing_plan_file" }],
    });
    expect(JSON.parse(invalidJson.stdout)).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_plan_json" }],
    });
    expect(JSON.parse(invalidChanges.stdout)).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_plan_json" }],
    });
    expect(noJson).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "autodemo agent review currently requires --json output.\n",
    });
  });

  it("lists the review workflow in agent help", async () => {
    const result = await runCliAsync(["agent", "--help"], dependencies());
    const rootHelp = await runCliAsync(["--help"], dependencies());

    expect(result.stdout).toContain("autodemo agent review --plan <plan-json-file> --json");
    expect(result.stdout).toContain(
      "autodemo agent refine --plan <plan-json-file> --refinements <refinements-json-file> --json",
    );
    expect(result.stdout).toContain("autodemo agent approve --plan <plan-json-file> --json");
    expect(rootHelp.stdout).toContain("autodemo agent review --plan <plan-json-file> --json");
  });
});
