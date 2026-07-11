import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  approveWalkthroughPlan,
  createWalkthroughPlan,
  type WalkthroughPlan,
} from "@auto-demo/agent";
import { afterEach, describe, expect, it } from "vitest";
import { runCliAsync } from "./index.js";

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

function approvePlan(targetUrl: string, script: string): WalkthroughPlan {
  const created = createWalkthroughPlan({ targetUrl, script, mode: "best-guess" });
  if (!created.ok) throw new Error("test plan should be valid");
  for (const step of created.plan.steps) {
    if (step.action === "click" && step.public.summary.includes("Get started")) {
      step.targetHint = { kind: "accessible", label: "Get started", role: "button" };
    }
    if (step.action === "click" && step.public.summary.includes("Missing")) {
      step.targetHint = { kind: "accessible", label: "Missing", role: "button" };
    }
    if (step.action === "type") step.targetHint = { kind: "accessible", label: "Search" };
    if (step.action === "assert") step.targetHint = { kind: "accessible", label: "Results" };
  }
  const approved = approveWalkthroughPlan(created.plan, { allowBestGuessBypass: true });
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
    const plan = approvePlan(
      targetUrl,
      `Go to ${targetUrl}. Click Get started. Type launch demo into Search. Wait 100 ms. Verify Results.`,
    );
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
  }, 30_000);

  it("preserves a failed bundle after a mid-script target failure", async () => {
    const targetUrl = await serveFixture();
    const root = await mkdtemp(join(tmpdir(), "auto-demo-execute-failure-"));
    const captureDir = join(root, "capture");
    const plan = approvePlan(
      targetUrl,
      `Go to ${targetUrl}. Click Get started. Click Missing. Verify Results.`,
    );
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
