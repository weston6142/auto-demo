import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compileDiscoverySessionToWalkthroughPlan,
  createPlaywrightDiscoveryReplayBrowserFactory,
  createPolicyEnforcedPlaywrightDiscoveryRehearsalController,
  createWalkthroughPlan,
  reviewWalkthroughPlan,
  validateDiscoverySession,
  verifyWalkthroughPlanApproval,
  type WalkthroughPlan,
  type WalkthroughPlanReview,
} from "./index.js";

const agentRoot =
  basename(process.cwd()) === "agent" ? process.cwd() : join(process.cwd(), "packages", "agent");
const repoRoot = basename(process.cwd()) === "agent" ? dirname(dirname(agentRoot)) : process.cwd();

async function readAgentDoc(relativePath: string): Promise<string> {
  return await readFile(join(agentRoot, relativePath), "utf8");
}

async function readRootDoc(relativePath: string): Promise<string> {
  return await readFile(join(repoRoot, relativePath), "utf8");
}

function normalizeWhitespace(markdown: string): string {
  return markdown.replace(/\s+/g, " ");
}

function jsonBlock(markdown: string, marker: string): unknown {
  const markerIndex = markdown.indexOf(marker);
  expect(markerIndex).toBeGreaterThanOrEqual(0);
  const blockStart = markdown.indexOf("```json", markerIndex);
  expect(blockStart).toBeGreaterThanOrEqual(0);
  const jsonStart = markdown.indexOf("\n", blockStart) + 1;
  const blockEnd = markdown.indexOf("```", jsonStart);
  expect(blockEnd).toBeGreaterThan(jsonStart);
  return JSON.parse(markdown.slice(jsonStart, blockEnd));
}

function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const nextHeading = markdown.indexOf("\n## ", start + heading.length);
  return markdown.slice(start, nextHeading === -1 ? undefined : nextHeading);
}

describe("agent wrapper documentation", () => {
  it("documents deterministic discovery replay and bounded repair ownership", async () => {
    const agentReadme = normalizeWhitespace(await readAgentDoc("README.md"));
    const rootReadme = normalizeWhitespace(await readRootDoc("README.md"));
    const combined = `${agentReadme} ${rootReadme}`;

    expect(typeof createPlaywrightDiscoveryReplayBrowserFactory).toBe("function");
    for (const expected of [
      "replayAndRepairDiscoveryPlan",
      "createPlaywrightDiscoveryReplayBrowserFactory",
      "fresh isolated browser context",
      "at most two repair sessions",
      "runtime-only input bindings",
      "hard policy boundaries are never repaired around",
      "reviewable and unapproved",
      "WES-189",
    ]) {
      expect(combined).toContain(expected);
    }
  });

  it("documents discovery compilation and its replay lifecycle boundary", async () => {
    const agentReadme = normalizeWhitespace(await readAgentDoc("README.md"));
    const rootReadme = normalizeWhitespace(await readRootDoc("README.md"));

    expect(typeof compileDiscoverySessionToWalkthroughPlan).toBe("function");
    expect(agentReadme).toContain("compileDiscoverySessionToWalkthroughPlan");
    expect(agentReadme).toContain("draft and unapproved");
    expect(agentReadme).toContain("does not carry disposable-environment authority");
    expect(rootReadme).toContain("WES-189 owns the host workflow and approval handoff");
  });

  it("documents the WES-183 discovery contract without claiming a live workflow", async () => {
    const agentReadme = normalizeWhitespace(await readAgentDoc("README.md"));
    const rootReadme = normalizeWhitespace(await readRootDoc("README.md"));
    const combined = `${agentReadme} ${rootReadme}`;

    for (const required of [
      "DiscoverySessionV1",
      "createDiscoverySession()",
      "recordDiscoveryObservation()",
      "beginDiscoveryAttempt()",
      "finishDiscoveryAttempt()",
      "selectDiscoveryPath()",
      "completeDiscoverySession()",
      "runtime-only input bindings",
      "completed, failed, and abandoned sessions are terminal",
      "WES-187",
      "WES-188",
    ]) {
      expect(combined).toContain(required);
    }
    expect(combined).toContain("does not yet expose a discovery CLI");
    expect(combined).not.toContain("autodemo agent discover");
  });

  it("publishes portable discovery session fixtures", async () => {
    const completed = JSON.parse(await readAgentDoc("fixtures/discovery-session-completed.json"));
    const explored = JSON.parse(
      await readAgentDoc("fixtures/discovery-session-with-abandoned-attempts.json"),
    );

    expect(validateDiscoverySession(completed)).toMatchObject({
      ok: true,
      session: { status: "completed", selectedPath: { attemptIds: expect.any(Array) } },
    });
    expect(validateDiscoverySession(explored)).toMatchObject({
      ok: true,
      session: { status: "completed" },
    });
    expect(
      explored.attempts.some((attempt: { status: string }) => attempt.status === "failed"),
    ).toBe(true);
    expect(explored.selectedPath.attemptIds).not.toContain("attempt-abandoned");
  });

  it("documents the structured browser observation API and safety boundaries", async () => {
    const agentReadme = normalizeWhitespace(await readAgentDoc("README.md"));

    for (const expected of [
      "createPlaywrightDiscoveryObservationExtractor",
      "recordDiscoveryObservation",
      "hasLiveTarget",
      "optional artifact sink",
      "never returns form values",
      "WES-185 owns browser actions",
    ]) {
      expect(agentReadme).toContain(expected);
    }
  });

  it("documents host-owned discovery rehearsal actions and downstream policy", async () => {
    const agentReadme = normalizeWhitespace(await readAgentDoc("README.md"));
    const rootReadme = normalizeWhitespace(await readRootDoc("README.md"));
    const combined = `${agentReadme} ${rootReadme}`;

    for (const expected of [
      "createPlaywrightDiscoveryRehearsalController",
      "existing Playwright page",
      "required authorizer",
      "runtime-only input resolver",
      "explicit retryOfAttemptId",
      "complete or abandon explicitly",
      "does not launch or close the browser",
      "does not start final media capture",
      "WES-186",
      "WES-187",
    ]) {
      expect(combined).toContain(expected);
    }
    expect(combined).not.toContain("autodemo agent discover");
  });

  it("documents the policy-enforced safe and disposable discovery workflow", async () => {
    const agentReadme = normalizeWhitespace(await readAgentDoc("README.md"));

    expect(typeof createPolicyEnforcedPlaywrightDiscoveryRehearsalController).toBe("function");
    for (const expected of [
      "createPolicyEnforcedPlaywrightDiscoveryRehearsalController",
      'chromiumNetworkInstrumentation: "exclusive"',
      "environment-is-disposable",
      "exact allowed origins",
      "isolated Chromium rehearsal context",
      "credential and payment inputs",
      "downloads, uploads, and WebSockets",
      "never carries into final capture",
    ]) {
      expect(agentReadme).toContain(expected);
    }
  });

  it("publishes policy-bounded Codex YOLO discovery through explicit approval", async () => {
    const skill = await readAgentDoc("skills/codex-auto-demo/SKILL.md");
    const discovery = section(skill, "## Goal-Driven YOLO Discovery");
    const transcript = await readAgentDoc("fixtures/codex-yolo-discovery-approval.md");
    const combined = normalizeWhitespace(`${discovery} ${transcript}`);

    for (const required of [
      "natural-language goal",
      "createPolicyEnforcedPlaywrightDiscoveryRehearsalController",
      "safe exact-origin",
      "environment-is-disposable",
      "structured action",
      "compileDiscoverySessionToWalkthroughPlan",
      "replayAndRepairDiscoveryPlan",
      "at most two",
      "hard policy boundary",
      "explicit approval",
      "agent execute",
      "agent handoff",
      "never carries into final capture",
    ]) {
      expect(combined).toContain(required);
    }

    expect(discovery).not.toContain("--allow-best-guess-bypass");
    expect(discovery).not.toContain("autodemo agent discover");
    expect(jsonBlock(transcript, "Replay asks Codex for a bounded repair")).toMatchObject({
      ok: false,
      phase: "replay",
      attempts: [{ status: "failed", failure: { repairability: "repairable" } }],
    });
    expect(jsonBlock(transcript, "Codex presents the replay-validated plan")).toMatchObject({
      ok: true,
      plan: {
        state: "validated",
        validation: { mode: "discovery-replay", status: "ready" },
        approvals: { required: true, approved: false },
      },
    });
    expect(jsonBlock(transcript, "Approval command returns")).toMatchObject({
      ok: true,
      plan: { state: "approved", approvals: { approved: true, basis: "validated" } },
    });
    expect(jsonBlock(transcript, "Handoff command returns")).toMatchObject({
      ok: true,
      project: { manifestPath: "projects/profile-demo/autodemo.project.json" },
      variant: { id: "baseline-polish" },
    });
  });

  it("publishes Codex instructions for the WES-160 workflow contract", async () => {
    const skill = await readAgentDoc("skills/codex-auto-demo/SKILL.md");

    expect(skill).toContain("npm run autodemo -- <subcommand...>");
    expect(skill).toContain("npm --workspace @auto-demo/cli run autodemo -- <subcommand...>");
    expect(skill).toContain("autodemo agent run --project <project-dir-or-manifest> --json");
    expect(skill).toContain("--variant <variant-id>");
    expect(skill).toContain("--generate baseline");
    expect(skill).toContain("--save baseline-polish");
    expect(skill).toContain("--save all");
    expect(skill).toContain("--open-editor");
    expect(skill).toContain("Do not inspect or rewrite Auto Demo project internals");
    expect(skill).toContain("MP4 export");
  });

  it("documents the repo-root clean-checkout wrapper in agent-facing docs", async () => {
    const rootAgents = await readRootDoc("AGENTS.md");
    const agentReadme = await readAgentDoc("README.md");
    const skill = await readAgentDoc("skills/codex-auto-demo/SKILL.md");
    const parity = await readAgentDoc("claude-wrapper-parity.md");
    const combined = [rootAgents, agentReadme, skill, parity].join("\n");

    expect(combined).toContain("npm run autodemo -- <subcommand...>");
    expect(combined).toContain("npm --workspace @auto-demo/cli run autodemo -- <subcommand...>");
    expect(combined).not.toContain("before the WES-164 repo-root wrapper lands");
  });

  it("includes a happy-path Codex transcript with parseable JSON output", async () => {
    const transcript = await readAgentDoc("fixtures/codex-happy-path.md");
    const output = jsonBlock(transcript, "Codex reads the JSON handoff");

    expect(output).toMatchObject({
      ok: true,
      project: {
        manifestPath: "projects/checkout/autodemo.project.json",
      },
      variant: {
        id: "baseline-polish",
        path: "variants/baseline-polish.json",
      },
      nextSteps: ["open-editor", "export-variant"],
    });
  });

  it("includes an invalid-project failure example with a stable error code", async () => {
    const transcript = await readAgentDoc("fixtures/codex-invalid-project.md");
    const output = jsonBlock(transcript, "Codex reads the JSON failure");

    expect(output).toMatchObject({
      ok: false,
      errors: [
        {
          code: "invalid_project",
        },
      ],
    });
  });

  it("documents Claude wrapper parity requirements and follow-up deferrals", async () => {
    const parity = await readAgentDoc("claude-wrapper-parity.md");

    for (const required of [
      "Invocation Instructions",
      "Required Inputs",
      "Command Sequence",
      "Expected Artifacts",
      "Failure Handling",
      "Out Of Scope",
      "MCP transport",
      "marketplace distribution",
      "final export implementation",
    ]) {
      expect(parity).toContain(required);
    }
  });

  it("documents the MVP MCP decision and future trigger criteria", async () => {
    const rootReadme = await readRootDoc("README.md");
    const agentReadme = await readAgentDoc("README.md");
    const normalizedRootReadme = normalizeWhitespace(rootReadme);
    const normalizedAgentReadme = normalizeWhitespace(agentReadme);
    const combined = `${normalizedRootReadme} ${normalizedAgentReadme}`;

    expect(combined).toContain("MCP is deferred from the MVP");
    expect(combined).toContain("CLI plus Codex wrapper");

    for (const futureTrigger of [
      "persistent project/session discovery",
      "editor handoff lifecycle",
      "artifact inspection",
      "host requires MCP",
    ]) {
      expect(combined).toContain(futureTrigger);
    }

    for (const futureCapability of [
      "project discovery and validation",
      "agent workflow run",
      "local editor launch handoff",
      "stable non-secret error responses",
    ]) {
      expect(normalizedAgentReadme).toContain(futureCapability);
    }

    expect(combined).toContain("does not introduce a new project schema");
    expect(combined).toContain("hosted services");
    expect(combined).toContain("final MP4 export");
  });

  it("publishes walkthrough plan fixtures for simple and ambiguous scripts", async () => {
    const simple = JSON.parse(await readAgentDoc("fixtures/walkthrough-plan-simple.json")) as {
      ok: boolean;
      plan: {
        state: string;
        target: { url: string };
        mode: "validate-first" | "best-guess";
        source: { script: string };
        steps: Array<{ action: string }>;
        questions: unknown[];
      };
    };
    const ambiguous = JSON.parse(
      await readAgentDoc("fixtures/walkthrough-plan-ambiguous.json"),
    ) as {
      ok: boolean;
      plan: {
        state: string;
        target: { url: string };
        mode: "validate-first" | "best-guess";
        source: { script: string };
        steps: Array<{ action: string }>;
        questions: unknown[];
      };
    };

    expect(simple).toEqual(
      createWalkthroughPlan({
        targetUrl: simple.plan.target.url,
        script: simple.plan.source.script,
        mode: simple.plan.mode,
      }),
    );
    expect(ambiguous).toEqual(
      createWalkthroughPlan({
        targetUrl: ambiguous.plan.target.url,
        script: ambiguous.plan.source.script,
        mode: ambiguous.plan.mode,
      }),
    );

    expect(simple.ok).toBe(true);
    expect(simple.plan.state).toBe("draft");
    expect(simple.plan.steps.map((step) => step.action)).toEqual(["navigate", "click", "assert"]);
    expect(simple.plan.questions).toEqual([]);

    expect(ambiguous.ok).toBe(true);
    expect(ambiguous.plan.state).toBe("needs-clarification");
    expect(ambiguous.plan.steps.map((step) => step.action)).toContain("question");
    expect(ambiguous.plan.questions.length).toBeGreaterThan(0);
  });

  it("documents only structured error codes emitted by walkthrough plan intake", async () => {
    const agentReadme = await readAgentDoc("README.md");
    const planIntake = section(agentReadme, "## Walkthrough Plan Intake");

    for (const code of [
      "missing_target_url",
      "invalid_target_url",
      "missing_script",
      "unsupported_plan_mode",
      "unknown_agent_argument",
    ]) {
      expect(planIntake).toContain(code);
    }
    expect(planIntake).not.toContain("unsupported_agent_output");
  });

  it("documents validate mode blockers and WES-177 handoff", async () => {
    const agentReadme = await readAgentDoc("README.md");
    const validateMode = section(agentReadme, "## Walkthrough Validate Mode");

    for (const required of [
      "npm run autodemo -- agent validate --plan <plan-json-file> --json",
      "npm run autodemo -- agent validate --url <target-url> --script <script-text> --json",
      "multiple_matching_elements",
      "missing_element",
      "unresolved_plan_question",
      "typed value redacted",
      "WES-177",
    ]) {
      expect(validateMode).toContain(required);
    }
  });

  it("documents conversational refinement and explicit plan approval", async () => {
    const skill = await readAgentDoc("skills/codex-auto-demo/SKILL.md");
    const parity = await readAgentDoc("claude-wrapper-parity.md");
    const approvalFixture = await readAgentDoc("fixtures/codex-walkthrough-review-approval.md");
    const refinementFixture = await readAgentDoc("fixtures/codex-walkthrough-refinement.md");

    for (const required of [
      "autodemo agent review --plan <plan-json-file> --json",
      "autodemo agent refine --plan <plan-json-file> --refinements <refinements-json-file> --json",
      "autodemo agent approve --plan <plan-json-file> --json",
      "Ask for explicit approval",
      "Do not edit walkthrough plan JSON directly",
      "--allow-best-guess-bypass",
    ]) {
      expect(skill).toContain(required);
    }
    expect(parity).toContain("review, refinement, and approval");
    expect(parity).toContain("explicit user confirmation");

    const approvalArtifact = jsonBlock(approvalFixture, "Approved plan artifact") as {
      ok: true;
      plan: WalkthroughPlan;
    };
    expect(approvalArtifact).toMatchObject({
      ok: true,
      plan: {
        state: "approved",
        approvals: { approved: true, basis: "validated" },
      },
    });
    expect(verifyWalkthroughPlanApproval(approvalArtifact.plan)).toEqual({ ok: true });

    const refinementArtifact = jsonBlock(refinementFixture, "Revalidated plan artifact") as {
      ok: true;
      plan: WalkthroughPlan;
      review: WalkthroughPlanReview;
    };
    expect(refinementArtifact).toMatchObject({
      ok: true,
      plan: { state: "validated", validation: { status: "ready" } },
    });
    expect(reviewWalkthroughPlan(refinementArtifact.plan)).toEqual({
      ok: true,
      review: refinementArtifact.review,
    });
  });

  it("documents approved walkthrough execution through project handoff", async () => {
    const rootReadme = await readRootDoc("README.md");
    const agentReadme = await readAgentDoc("README.md");
    const skill = await readAgentDoc("skills/codex-auto-demo/SKILL.md");
    const parity = await readAgentDoc("claude-wrapper-parity.md");
    const executionFixture = await readAgentDoc("fixtures/codex-walkthrough-execution.md");
    const combined = [rootReadme, agentReadme, skill, parity, executionFixture].join("\n");

    for (const required of [
      "autodemo agent execute --plan <approved-plan-json-file>",
      "--inputs <runtime-inputs-json-file>",
      "--out <capture-directory>",
      "natural-v1",
      "non-secret demo data",
      "failed capture bundle",
      "autodemo agent handoff --execution <execution-result-json-file>",
      "--project <new-project-directory>",
      "--name <project-name>",
      "baseline-polish",
      "does not overwrite",
      "resume",
      "autodemo open --project",
      "autodemo export --project",
    ]) {
      expect(combined).toContain(required);
    }
    expect(combined).not.toContain("execute --allow-unapproved");
    expect(combined).not.toContain("WES-180 owns project import");

    expect(jsonBlock(executionFixture, "Successful execution result")).toMatchObject({
      ok: true,
      plan: { state: "executed", execution: { status: "completed" } },
    });
    expect(jsonBlock(executionFixture, "Failed execution result")).toMatchObject({
      ok: false,
      plan: { state: "approved", execution: { status: "failed" } },
    });
  });
});
