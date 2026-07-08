import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createWalkthroughPlan,
  runAgentWorkflow,
  type AgentWorkflowGenerationResult,
} from "./index.js";

async function createValidProject(
  options: {
    variantId?: string;
    displayName?: string;
    includeVariant?: boolean;
  } = {},
): Promise<string> {
  const projectDir = join(tmpdir(), `auto-demo-agent-${randomUUID()}`);
  const variantId = options.variantId ?? "baseline-polish";
  const includeVariant = options.includeVariant ?? true;
  const variant = {
    id: variantId,
    displayName: options.displayName ?? "Baseline Polish",
    source: { mediaPath: "raw/capture.webm", eventsPath: "metadata/events.jsonl" },
    timeline: { startMs: 1500, endMs: 2750 },
    viewport: { mode: "contain", focus: { x: 0.75, y: 0.5 }, zoom: 1.35 },
    cursor: { visible: true, emphasis: "spotlight" },
    clicks: { emphasis: "ring" },
    captions: [],
    callouts: [],
    style: {
      background: "solid",
      backgroundColor: "#0f172a",
      frame: "browser",
      padding: 48,
      cornerRadius: 16,
    },
    exportIntent: { format: "mp4", quality: "demo", aspectRatio: "16:9" },
  };

  await rm(projectDir, { recursive: true, force: true });
  await mkdir(join(projectDir, "raw"), { recursive: true });
  await mkdir(join(projectDir, "metadata"), { recursive: true });
  await mkdir(join(projectDir, "variants"), { recursive: true });
  await mkdir(join(projectDir, "previews"), { recursive: true });
  await mkdir(join(projectDir, "exports"), { recursive: true });
  await writeFile(join(projectDir, "raw", "capture.webm"), "video");
  await writeFile(join(projectDir, "metadata", "capture.manifest.json"), "{}\n");
  await writeFile(
    join(projectDir, "metadata", "events.jsonl"),
    `${JSON.stringify({
      id: "event-1",
      sequence: 1,
      type: "click",
      timestampMs: 2000,
      viewport: { width: 1280, height: 720 },
      data: { x: 960, y: 360 },
    })}\n`,
  );
  await writeFile(
    join(projectDir, "autodemo.project.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        name: "Checkout flow demo",
        createdAt: "2026-07-05T12:00:00.000Z",
        updatedAt: "2026-07-05T12:00:00.000Z",
        sourceCapture: {
          kind: "browser",
          status: "completed",
          source: { kind: "browser", url: "https://example.com/checkout" },
          viewport: { width: 1280, height: 720 },
          timing: {
            startedAt: "2026-07-05T12:00:00.000Z",
            endedAt: "2026-07-05T12:00:06.000Z",
            durationMs: 6000,
          },
          adapter: { kind: "browser", backend: "playwright" },
          tools: { capturePackage: "0.0.0", playwright: "1.61.1" },
          manifestPath: "metadata/capture.manifest.json",
        },
        media: {
          primary: { kind: "viewport", path: "raw/capture.webm", contentType: "video/webm" },
        },
        metadata: {
          events: { path: "metadata/events.jsonl", contentType: "application/x-ndjson" },
        },
        variants: includeVariant ? [variant] : [],
        previews: [],
        exports: [],
      },
      null,
      2,
    )}\n`,
  );

  if (includeVariant) {
    await writeFile(
      join(projectDir, "variants", `${variantId}.json`),
      `${JSON.stringify(variant, null, 2)}\n`,
    );
  }

  return projectDir;
}

describe("runAgentWorkflow", () => {
  it("selects the first saved variant and emits a handoff summary", async () => {
    const projectDir = await createValidProject();

    const result = await runAgentWorkflow({ projectPath: projectDir, json: true });

    expect(result).toMatchObject({
      ok: true,
      project: {
        projectPath: projectDir,
        manifestPath: join(projectDir, "autodemo.project.json"),
        name: "Checkout flow demo",
      },
      variant: {
        id: "baseline-polish",
        path: "variants/baseline-polish.json",
        source: "selected",
      },
      warnings: [],
      nextSteps: ["open-editor", "export-variant"],
    });
    expect(result.ok && result.artifacts).toEqual([
      { kind: "project-manifest", path: join(projectDir, "autodemo.project.json") },
      { kind: "variant", path: "variants/baseline-polish.json" },
    ]);
  });

  it("selects a requested saved variant", async () => {
    const projectDir = await createValidProject({
      variantId: "browser-copy",
      displayName: "Browser Copy",
    });

    const result = await runAgentWorkflow({
      projectPath: projectDir,
      json: true,
      variantId: "browser-copy",
    });

    expect(result.ok && result.variant).toMatchObject({
      id: "browser-copy",
      path: "variants/browser-copy.json",
      source: "selected",
    });
  });

  it("reports a stable error when no saved variant exists", async () => {
    const projectDir = await createValidProject({ includeVariant: false });

    const result = await runAgentWorkflow({ projectPath: projectDir, json: true });

    expect(result).toMatchObject({
      ok: false,
      project: { projectPath: projectDir },
      errors: [{ code: "missing_variant", message: expect.any(String) }],
    });
  });

  it("reports a stable error when the requested variant is absent", async () => {
    const projectDir = await createValidProject();

    const result = await runAgentWorkflow({
      projectPath: projectDir,
      json: true,
      variantId: "missing-variant",
    });

    expect(result).toMatchObject({
      ok: false,
      project: { projectPath: projectDir },
      errors: [{ code: "variant_not_found", message: expect.any(String) }],
    });
  });

  it("uses the first generated saved variant as the handoff variant", async () => {
    const projectDir = await createValidProject();

    const result = await runAgentWorkflow(
      {
        projectPath: projectDir,
        json: true,
        generate: "baseline",
        save: "all",
      },
      {
        async generateHeadlessVariants() {
          return {
            ok: true,
            project: {
              projectDir,
              manifestPath: join(projectDir, "autodemo.project.json"),
              name: "Checkout flow demo",
            },
            requested: {
              count: 1,
              styles: ["baseline"],
              dryRun: false,
              sourceVariantId: "baseline-polish",
            },
            variants: [],
            summary: {
              mode: "all",
              saved: [{ id: "generated-baseline", path: "variants/generated-baseline.json" }],
              skipped: [],
              validation: { ok: true, manifestPath: join(projectDir, "autodemo.project.json") },
              nextSteps: ["open-editor", "export-variant"],
            },
            errors: [],
          } satisfies AgentWorkflowGenerationResult;
        },
        async loadProject(path) {
          const loaded = await import("@auto-demo/project").then((project) =>
            project.loadProject(path),
          );
          if (!loaded.ok) {
            return loaded;
          }
          return {
            ...loaded,
            manifest: {
              ...loaded.manifest,
              variants: [
                ...loaded.manifest.variants,
                {
                  ...loaded.manifest.variants[0],
                  id: "generated-baseline",
                  displayName: "Generated Baseline",
                },
              ],
            },
          };
        },
      },
    );

    expect(result.ok && result.variant).toMatchObject({
      id: "generated-baseline",
      path: "variants/generated-baseline.json",
      source: "generated",
    });
    expect(result.ok && result.warnings).toEqual([]);
  });

  it("includes the local editor URL when editor handoff is requested", async () => {
    const projectDir = await createValidProject();

    const result = await runAgentWorkflow(
      { projectPath: projectDir, json: true, openEditor: true },
      {
        async startEditorServer() {
          return {
            url: "http://127.0.0.1:4321/",
            async close() {},
          };
        },
      },
    );

    expect(result.ok && result.editor).toEqual({
      opened: true,
      lifecycle: "long-lived-local-server",
      url: "http://127.0.0.1:4321/",
    });
  });

  it("rejects custom agent save ids for the baseline-only contract", async () => {
    const projectDir = await createValidProject();

    const result = await runAgentWorkflow({
      projectPath: projectDir,
      json: true,
      generate: "baseline",
      save: "custom-id",
    });

    expect(result).toMatchObject({
      ok: false,
      project: { projectPath: projectDir },
      errors: [
        {
          code: "unsupported_generation",
          message: "autodemo agent run supports only --save baseline-polish or --save all.",
        },
      ],
    });
  });
});

describe("createWalkthroughPlan", () => {
  it("creates a draft walkthrough plan for a simple click-through script", () => {
    const result = createWalkthroughPlan({
      targetUrl: "https://example.com/signup",
      script:
        "Go to https://example.com/signup. Click Get started. Verify the pricing page appears.",
      mode: "validate-first",
    });

    expect(result).toMatchObject({
      ok: true,
      plan: {
        target: { kind: "browser", url: "https://example.com/signup" },
        mode: "validate-first",
        state: "draft",
        approvals: { required: true, approved: false },
        execution: { status: "not-started" },
        questions: [],
      },
    });
    expect(result.ok && result.plan.steps.map((step) => step.action)).toEqual([
      "navigate",
      "click",
      "assert",
    ]);
  });

  it("keeps ambiguous script text as an unresolved user question", () => {
    const result = createWalkthroughPlan({
      targetUrl: "https://example.com",
      script: "Open the dashboard. Pick the best option.",
      mode: "validate-first",
    });

    expect(result.ok && result.plan.state).toBe("needs-clarification");
    expect(result.ok && result.plan.questions).toEqual([
      {
        id: "question-2",
        stepId: "step-2",
        prompt: "Clarify how to perform: Pick the best option.",
        reason: "unrecognized_step",
      },
    ]);
  });

  it("redacts typed values from public action details", () => {
    const result = createWalkthroughPlan({
      targetUrl: "https://example.com/login",
      script: "Type hunter2 into the password field.",
      mode: "best-guess",
    });

    expect(result.ok && result.plan.steps[0]).toMatchObject({
      action: "type",
      resolution: "resolved",
      public: { summary: "Type [redacted] into the password field." },
    });
    expect(result.ok && result.plan.steps[0]?.sourceText).toBe(
      "Type [redacted] into the password field.",
    );
  });

  it("returns stable errors for invalid intake input", () => {
    const result = createWalkthroughPlan({
      targetUrl: "not a url",
      script: "   ",
      mode: "fast" as "validate-first",
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "invalid_target_url",
          message: "Walkthrough plan target URL must be an absolute http(s) URL.",
        },
        {
          code: "missing_script",
          message: "Walkthrough plan requires non-empty script text.",
        },
        {
          code: "unsupported_plan_mode",
          message: "Walkthrough plan mode must be validate-first or best-guess.",
        },
      ],
    });
  });
});
