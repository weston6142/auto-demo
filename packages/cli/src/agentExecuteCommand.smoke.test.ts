import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveWalkthroughPlan, type WalkthroughPlan } from "@auto-demo/agent";
import { loadProject } from "@auto-demo/project";
import { afterEach, describe, expect, it } from "vitest";
import { runCliAsync } from "./index.js";
import {
  legacyWalkthroughPlanFixture,
  resolved,
  type LegacyStepFixture,
} from "./walkthroughTestFixtures.js";

let server: Server | undefined;

afterEach(async () => {
  if (server === undefined) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  server = undefined;
});

async function serveFixture(): Promise<string> {
  server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`
      <!doctype html>
      <html>
        <body>
          <button onclick="document.querySelector('h2').hidden=false">Get started</button>
          <label>Search <input /></label>
          <h2 hidden>Results</h2>
        </body>
      </html>
    `);
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected TCP server");
  return `http://127.0.0.1:${address.port}`;
}

function approvePlan(targetUrl: string, steps: LegacyStepFixture[]): WalkthroughPlan {
  const script = steps.map((step) => step.sourceText).join(" ");
  const plan = legacyWalkthroughPlanFixture({ targetUrl, script, steps, mode: "best-guess" });
  const approved = approveWalkthroughPlan(plan, { allowBestGuessBypass: true });
  if (!approved.ok) throw new Error("test plan should approve");
  return approved.plan;
}

async function writeExecutionFiles(
  root: string,
  plan: WalkthroughPlan,
): Promise<{ planPath: string; inputsPath: string }> {
  const planPath = join(root, "approved-plan.json");
  const inputsPath = join(root, "inputs.json");
  await writeFile(planPath, `${JSON.stringify({ ok: true, plan }, null, 2)}\n`);
  await writeFile(inputsPath, `${JSON.stringify({ "step-3": "launch demo private" }, null, 2)}\n`);
  return { planPath, inputsPath };
}

describe("autodemo agent execute smoke", () => {
  it("executes an approved plan into a valid completed capture bundle", async () => {
    const targetUrl = await serveFixture();
    const root = await mkdtemp(join(tmpdir(), "auto-demo-execute-smoke-"));
    const captureDir = join(root, "capture");
    const plan = approvePlan(targetUrl, [
      resolved("navigate", `Go to ${targetUrl}.`, { navigationUrl: targetUrl }),
      {
        ...resolved("click", "Click Get started."),
        targetHint: { kind: "accessible", label: "Get started", role: "button" },
      },
      {
        ...resolved("type", "Type [redacted] into Search."),
        targetHint: { kind: "accessible", label: "Search" },
      },
      resolved("wait", "Wait 100 ms.", { waitDurationMs: 100 }),
      {
        ...resolved("assert", "Verify Results."),
        targetHint: { kind: "accessible", label: "Results" },
      },
    ]);
    const files = await writeExecutionFiles(root, plan);

    const result = await runCliAsync([
      "agent",
      "execute",
      "--plan",
      files.planPath,
      "--inputs",
      files.inputsPath,
      "--out",
      captureDir,
      "--viewport",
      "640x360",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      ok: true,
      plan: { state: "executed", execution: { status: "completed", pacingProfile: "natural-v1" } },
    });
    expect((await stat(output.capture.mediaPath)).size).toBeGreaterThan(0);
    const manifest = JSON.parse(await readFile(output.capture.manifestPath, "utf8"));
    expect(manifest.status).toBe("completed");
    const metadata = await readFile(output.capture.metadataPath, "utf8");
    expect(metadata).not.toContain("launch demo private");
    expect(result.stdout).not.toContain("launch demo private");

    const executionPath = join(root, "execution.json");
    const projectDir = join(root, "project");
    await writeFile(executionPath, result.stdout);
    const handoff = await runCliAsync([
      "agent",
      "handoff",
      "--execution",
      executionPath,
      "--project",
      projectDir,
      "--name",
      "Playwright Smoke Demo",
      "--json",
    ]);
    expect(handoff.exitCode).toBe(0);
    const loaded = await loadProject(projectDir);
    expect(loaded.ok).toBe(true);
    expect(loaded.ok && loaded.manifest.sourceCapture.status).toBe("completed");
    expect(loaded.ok && loaded.manifest.variants[0]?.id).toBe("baseline-polish");
    expect((await stat(join(projectDir, "variants", "baseline-polish.json"))).size).toBeGreaterThan(
      0,
    );
  }, 30_000);

  it("preserves a failed bundle after a mid-script target failure", async () => {
    const targetUrl = await serveFixture();
    const root = await mkdtemp(join(tmpdir(), "auto-demo-execute-failure-"));
    const captureDir = join(root, "capture");
    const plan = approvePlan(targetUrl, [
      resolved("navigate", `Go to ${targetUrl}.`, { navigationUrl: targetUrl }),
      {
        ...resolved("click", "Click Get started."),
        targetHint: { kind: "accessible", label: "Get started", role: "button" },
      },
      {
        ...resolved("click", "Click Missing."),
        targetHint: { kind: "accessible", label: "Missing", role: "button" },
      },
      {
        ...resolved("assert", "Verify Results."),
        targetHint: { kind: "accessible", label: "Results" },
      },
    ]);
    const planPath = join(root, "approved-plan.json");
    await writeFile(planPath, `${JSON.stringify({ ok: true, plan }, null, 2)}\n`);

    const result = await runCliAsync([
      "agent",
      "execute",
      "--plan",
      planPath,
      "--out",
      captureDir,
      "--viewport",
      "640x360",
      "--json",
    ]);

    expect(result.exitCode).toBe(1);
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      ok: false,
      phase: "execution",
      plan: { state: "approved", execution: { status: "failed" } },
      errors: [{ code: "target_not_found", stepId: "step-3" }],
    });
    expect(output.steps.map((step: { status: string }) => step.status)).toEqual([
      "completed",
      "completed",
      "failed",
      "skipped",
    ]);
    const manifest = JSON.parse(await readFile(output.capture.manifestPath, "utf8"));
    expect(manifest.status).toBe("failed");
    expect((await stat(output.capture.mediaPath)).size).toBeGreaterThan(0);
  }, 30_000);
});
