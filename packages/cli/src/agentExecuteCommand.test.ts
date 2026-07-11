import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveWalkthroughPlan, createWalkthroughPlan } from "@auto-demo/agent";
import type { ControllableBrowserCaptureAdapter } from "@auto-demo/capture";
import { describe, expect, it } from "vitest";
import { runCliAsync, type CliDependencies } from "./index.js";

async function approvedPlanFile(root: string): Promise<{ path: string; text: string }> {
  const created = createWalkthroughPlan({
    targetUrl: "https://example.com/start",
    script: "Type launch demo into Search. Verify Results.",
    mode: "best-guess",
  });
  if (!created.ok) throw new Error("test plan should be valid");
  created.plan.steps[0].targetHint = { kind: "accessible", label: "Search" };
  created.plan.steps[1].targetHint = { kind: "accessible", label: "Results" };
  const approved = approveWalkthroughPlan(created.plan, { allowBestGuessBypass: true });
  if (!approved.ok) throw new Error("test plan should approve");
  const text = `${JSON.stringify({ ok: true, plan: approved.plan }, null, 2)}\n`;
  const path = join(root, "approved-plan.json");
  await writeFile(path, text);
  return { path, text };
}

function captureAdapter(): ControllableBrowserCaptureAdapter {
  return {
    kind: "browser",
    async start(options) {
      return {
        ok: true,
        outputDir: options.outputDir,
        manifestPath: join(options.outputDir, "capture.manifest.json"),
        session: {
          outputDir: options.outputDir,
          manifestPath: join(options.outputDir, "capture.manifest.json"),
          browser: {
            async navigate() {},
            async click() {},
            async type() {},
            async assertVisible() {},
            async waitForSettled() {},
          },
          async stop() {
            return {
              ok: true,
              output: {
                outputDir: options.outputDir,
                manifestPath: join(options.outputDir, "capture.manifest.json"),
                media: {
                  kind: "viewport",
                  path: join(options.outputDir, "media", "viewport.webm"),
                  contentType: "video/webm",
                },
                metadata: {
                  kind: "events",
                  path: join(options.outputDir, "metadata", "events.jsonl"),
                  contentType: "application/x-ndjson",
                },
                timing: {
                  startedAt: "2026-07-10T17:00:00.000Z",
                  endedAt: "2026-07-10T17:00:03.000Z",
                  durationMs: 3_000,
                },
              },
            };
          },
        },
      };
    },
  };
}

function dependencies(adapter: ControllableBrowserCaptureAdapter): CliDependencies {
  return {
    browserCaptureAdapter: adapter,
    browserExecutionCaptureAdapter: adapter,
    now: () => new Date("2026-07-10T17:00:00.000Z"),
    async sleep() {},
    async runChildCommand() {
      return { exitCode: 0 };
    },
  };
}

describe("autodemo agent execute", () => {
  it("executes immutable plan and input files and returns JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "auto-demo-agent-execute-"));
    const plan = await approvedPlanFile(root);
    const inputsPath = join(root, "inputs.json");
    const inputsText = `${JSON.stringify({ "step-1": "launch demo private" }, null, 2)}\n`;
    await writeFile(inputsPath, inputsText);

    const result = await runCliAsync(
      [
        "agent",
        "execute",
        "--plan",
        plan.path,
        "--inputs",
        inputsPath,
        "--out",
        join(root, "capture"),
        "--viewport",
        "1280x720",
        "--json",
      ],
      dependencies(captureAdapter()),
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      plan: { state: "executed", execution: { status: "completed" } },
    });
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("launch demo private");
    expect(await readFile(plan.path, "utf8")).toBe(plan.text);
    expect(await readFile(inputsPath, "utf8")).toBe(inputsText);
  });

  it("returns stable JSON for missing required execute arguments", async () => {
    const result = await runCliAsync(
      ["agent", "execute", "--json"],
      dependencies(captureAdapter()),
    );

    expect(result).toMatchObject({ exitCode: 1, stderr: "" });
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        expect.objectContaining({ code: "missing_plan_file" }),
        expect.objectContaining({ code: "missing_capture_output" }),
      ]),
    });
  });

  it("returns stable JSON when the capture dependency throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "auto-demo-agent-execute-error-"));
    const plan = await approvedPlanFile(root);
    const inputsPath = join(root, "inputs.json");
    await writeFile(inputsPath, JSON.stringify({ "step-1": "runtime private value" }));
    const throwingAdapter: ControllableBrowserCaptureAdapter = {
      kind: "browser",
      async start() {
        throw new Error("private adapter exception detail");
      },
    };

    const result = await runCliAsync(
      [
        "agent",
        "execute",
        "--plan",
        plan.path,
        "--inputs",
        inputsPath,
        "--out",
        join(root, "capture"),
        "--json",
      ],
      dependencies(throwingAdapter),
    );

    expect(result).toMatchObject({ exitCode: 1, stderr: "" });
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      phase: "capture-setup",
      errors: [{ code: "capture_setup_failed" }],
    });
    expect(result.stdout).not.toContain("private adapter exception detail");
  });
});
