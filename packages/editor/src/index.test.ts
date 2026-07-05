import { randomUUID } from "node:crypto";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadEditorProject,
  startEditorServer,
  type EditorProjectSummary,
  type EditorServer,
} from "./index.js";

const servers: EditorServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function createEditorProject(options: { variants?: unknown[] } = {}): Promise<string> {
  const projectDir = join(tmpdir(), `auto-demo-editor-${randomUUID()}`);
  const variants = options.variants ?? [baselineVariant()];

  await mkdir(join(projectDir, "raw"), { recursive: true });
  await mkdir(join(projectDir, "metadata"), { recursive: true });
  await mkdir(join(projectDir, "variants"), { recursive: true });
  await mkdir(join(projectDir, "previews"), { recursive: true });
  await mkdir(join(projectDir, "exports"), { recursive: true });
  await writeFile(join(projectDir, "raw", "capture.webm"), "video");
  await writeFile(join(projectDir, "metadata", "capture.manifest.json"), "{}\n");
  await writeFile(join(projectDir, "metadata", "events.jsonl"), "{}\n");

  for (const variant of variants) {
    if (isVariantWithId(variant)) {
      await writeFile(
        join(projectDir, "variants", `${variant.id}.json`),
        `${JSON.stringify(variant, null, 2)}\n`,
      );
    }
  }

  await writeFile(
    join(projectDir, "autodemo.project.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        name: "Checkout flow demo",
        createdAt: "2026-07-04T12:00:00.000Z",
        updatedAt: "2026-07-04T12:00:00.000Z",
        sourceCapture: {
          kind: "browser",
          status: "completed",
          source: { kind: "browser", url: "https://example.com/checkout" },
          viewport: { width: 1280, height: 720 },
          timing: {
            startedAt: "2026-07-04T12:00:00.000Z",
            endedAt: "2026-07-04T12:00:06.000Z",
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
        variants,
        previews: [],
        exports: [],
      },
      null,
      2,
    )}\n`,
  );

  return projectDir;
}

function baselineVariant(): unknown {
  return {
    id: "baseline-polish",
    displayName: "Baseline Polish",
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
}

async function runEditorScript(
  project: EditorProjectSummary,
): Promise<{ evaluate: <T>(script: string) => T }> {
  const server = await startEditorServer({ projectPath: project.projectDir });
  servers.push(server);
  const html = await fetch(server.url).then((response) => response.text());
  const scriptMatch = html.match(/<script>\n([\s\S]*)\n {4}<\/script>/);
  expect(scriptMatch).not.toBeNull();

  const app = { innerHTML: "" };
  const element = {
    value: "",
    addEventListener: () => undefined,
  };
  const context = vm.createContext({
    app,
    document: {
      querySelector: (selector: string) => (selector === "#app" ? app : { ...element }),
      querySelectorAll: () => [],
    },
    fetch: () =>
      Promise.resolve({
        json: () => Promise.resolve({ ok: true, project }),
      }),
  });

  vm.runInContext(scriptMatch?.[1] ?? "", context);
  await new Promise((resolve) => setTimeout(resolve, 0));

  return {
    evaluate: <T>(script: string) => vm.runInContext(script, context) as T,
  };
}

function isVariantWithId(value: unknown): value is { id: string } {
  return (
    typeof value === "object" && value !== null && "id" in value && typeof value.id === "string"
  );
}

describe("loadEditorProject", () => {
  it("returns an operator-facing project summary with saved variants", async () => {
    const projectDir = await createEditorProject();

    const result = await loadEditorProject(projectDir);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project).toMatchObject({
        name: "Checkout flow demo",
        projectDir,
        source: {
          url: "https://example.com/checkout",
          status: "completed",
          durationMs: 6000,
          viewport: { width: 1280, height: 720 },
        },
        variants: [
          {
            id: "baseline-polish",
            displayName: "Baseline Polish",
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
          },
        ],
      });
    }
  });

  it("returns an empty variant state without treating the project as invalid", async () => {
    const projectDir = await createEditorProject({ variants: [] });

    const result = await loadEditorProject(projectDir);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project.variants).toEqual([]);
      expect(result.project.emptyVariantMessage).toBe(
        "No saved variants found. Run autodemo generate --project <project> --json --save all to create variants for review.",
      );
    }
  });

  it("returns operator-readable project validation errors", async () => {
    const projectDir = join(tmpdir(), `auto-demo-editor-missing-${randomUUID()}`);
    await rm(projectDir, { recursive: true, force: true });

    const result = await loadEditorProject(projectDir);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.projectPath).toBe(projectDir);
      expect(result.errors).toEqual([
        {
          code: "missing_project_manifest",
          message: "Auto Demo project manifest is missing.",
        },
      ]);
    }
  });
});

describe("startEditorServer", () => {
  it("serves the editor shell and loaded project JSON", async () => {
    const projectDir = await createEditorProject();
    const server = await startEditorServer({ projectPath: projectDir });
    servers.push(server);

    const html = await fetch(server.url).then((response) => response.text());
    const project = await fetch(new URL("/api/project", server.url)).then((response) =>
      response.json(),
    );
    const media = await fetch(new URL("/project-file/raw/capture.webm", server.url));

    expect(html).toContain("Auto Demo Editor");
    expect(html).toContain("Approximate Preview");
    expect(html).toContain("Trim");
    expect(html).toContain("Viewport");
    expect(html).toContain("Captions");
    expect(html).toContain("Callouts");
    expect(html).toContain("Cursor");
    expect(html).toContain("Clicks");
    expect(html).toContain("Style");
    expect(html).toContain("Reset Changes");
    expect(html).toContain("Edited Variant JSON");
    expect(html).not.toContain("Named Preset");
    expect(project).toMatchObject({
      ok: true,
      project: {
        name: "Checkout flow demo",
        variants: [
          {
            id: "baseline-polish",
            viewport: { mode: "contain", focus: { x: 0.75, y: 0.5 }, zoom: 1.35 },
            cursor: { visible: true, emphasis: "spotlight" },
            clicks: { emphasis: "ring" },
            style: { backgroundColor: "#0f172a", padding: 48, cornerRadius: 16 },
          },
        ],
      },
    });
    expect(media.status).toBe(200);
    expect(media.headers.get("content-type")).toBe("video/webm");
    expect(await media.text()).toBe("video");
  });

  it("does not serve whitelisted project files through symlinks", async () => {
    const projectDir = await createEditorProject();
    const secretPath = join(tmpdir(), `auto-demo-editor-secret-${randomUUID()}.txt`);
    await writeFile(secretPath, "outside-project");
    await rm(join(projectDir, "raw", "capture.webm"));
    await symlink(secretPath, join(projectDir, "raw", "capture.webm"));
    const server = await startEditorServer({ projectPath: projectDir });
    servers.push(server);

    const response = await fetch(new URL("/project-file/raw/capture.webm", server.url));

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("outside-project");
  });

  it("serves video range requests as partial project file responses", async () => {
    const projectDir = await createEditorProject();
    await writeFile(join(projectDir, "raw", "capture.webm"), "video-bytes");
    const server = await startEditorServer({ projectPath: projectDir });
    servers.push(server);

    const response = await fetch(new URL("/project-file/raw/capture.webm", server.url), {
      headers: { range: "bytes=1-3" },
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 1-3/11");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(await response.text()).toBe("ide");
  });

  it("returns 404 for unknown routes", async () => {
    const projectDir = await createEditorProject();
    const server = await startEditorServer({ projectPath: projectDir });
    servers.push(server);

    const response = await fetch(new URL("/missing", server.url));

    expect(response.status).toBe(404);
  });

  it("returns 404 for malformed project file URLs", async () => {
    const projectDir = await createEditorProject();
    const server = await startEditorServer({ projectPath: projectDir });
    servers.push(server);

    const response = await fetch(new URL("/project-file/%", server.url));

    expect(response.status).toBe(404);
  });

  it("keeps timed text inside the draft timeline after trim edits", async () => {
    const variant = {
      ...(baselineVariant() as Record<string, unknown>),
      captions: [{ id: "caption-1", text: "Checkout", startMs: 1600, endMs: 2200 }],
      callouts: [
        {
          id: "callout-1",
          text: "Submit",
          startMs: 1700,
          endMs: 2300,
          anchor: { x: 0.4, y: 0.5 },
        },
      ],
    };
    const projectDir = await createEditorProject({ variants: [variant] });
    const project = await loadEditorProject(projectDir);
    expect(project.ok).toBe(true);
    if (!project.ok) return;
    const editor = await runEditorScript(project.project);

    editor.evaluate('update("timeline.startMs", 2600)');
    const draft = editor.evaluate<{
      timeline: { startMs: number; endMs: number };
      captions: Array<{ startMs: number; endMs: number }>;
      callouts: Array<{ startMs: number; endMs: number }>;
    }>("draft");

    expect(draft.timeline).toEqual({ startMs: 2600, endMs: 2750 });
    expect(draft.captions.map(({ startMs, endMs }) => ({ startMs, endMs }))).toEqual([
      { startMs: 2600, endMs: 2601 },
    ]);
    expect(draft.callouts.map(({ startMs, endMs }) => ({ startMs, endMs }))).toEqual([
      { startMs: 2600, endMs: 2601 },
    ]);
  });

  it("adds captions and callouts with unused draft ids", async () => {
    const variant = {
      ...(baselineVariant() as Record<string, unknown>),
      captions: [
        { id: "caption-1", text: "One", startMs: 1600, endMs: 1800 },
        { id: "caption-2", text: "Two", startMs: 1900, endMs: 2100 },
      ],
      callouts: [
        {
          id: "callout-1",
          text: "One",
          startMs: 1600,
          endMs: 1800,
          anchor: { x: 0.4, y: 0.5 },
        },
        {
          id: "callout-2",
          text: "Two",
          startMs: 1900,
          endMs: 2100,
          anchor: { x: 0.6, y: 0.5 },
        },
      ],
    };
    const projectDir = await createEditorProject({ variants: [variant] });
    const project = await loadEditorProject(projectDir);
    expect(project.ok).toBe(true);
    if (!project.ok) return;
    const editor = await runEditorScript(project.project);

    editor.evaluate(
      'removeText("captions", 0); addCaption(); removeText("callouts", 0); addCallout()',
    );
    const draft = editor.evaluate<{
      captions: Array<{ id: string }>;
      callouts: Array<{ id: string }>;
    }>("draft");

    expect(draft.captions.map((caption) => caption.id)).toEqual(["caption-2", "caption-3"]);
    expect(draft.callouts.map((callout) => callout.id)).toEqual(["callout-2", "callout-3"]);
  });

  it("ignores invalid draft background colors", async () => {
    const projectDir = await createEditorProject();
    const project = await loadEditorProject(projectDir);
    expect(project.ok).toBe(true);
    if (!project.ok) return;
    const editor = await runEditorScript(project.project);

    editor.evaluate('update("style.backgroundColor", "blue")');
    const backgroundColor = editor.evaluate<string>("draft.style.backgroundColor");

    expect(backgroundColor).toBe("#0f172a");
  });
});
