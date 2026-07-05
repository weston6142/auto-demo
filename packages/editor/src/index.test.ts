import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
  options: {
    fetch?: (
      input: string,
      init?: { method?: string; body?: string },
    ) => Promise<{
      json: () => Promise<unknown>;
    }>;
  } = {},
): Promise<{ evaluate: <T>(script: string) => T }> {
  const server = await startEditorServer({ projectPath: project.projectDir });
  servers.push(server);
  const html = await fetch(server.url).then((response) => response.text());
  const scriptMatch = html.match(/<script>\n([\s\S]*)\n {4}<\/script>/);
  expect(scriptMatch).not.toBeNull();

  const elements = new Map<string, { value: string; addEventListener: () => undefined }>();
  const createElement = (value = "") => ({
    value,
    addEventListener: () => undefined,
  });
  const app = {
    html: "",
    get innerHTML() {
      return this.html;
    },
    set innerHTML(value: string) {
      this.html = value;
      const copyId = value.match(/id="copy-id" value="([^"]*)"/);
      const copyDisplayName = value.match(/id="copy-display-name" value="([^"]*)"/);
      if (copyId) elements.set("#copy-id", createElement(copyId[1]));
      if (copyDisplayName) elements.set("#copy-display-name", createElement(copyDisplayName[1]));
    },
  };
  const context = vm.createContext({
    app,
    document: {
      querySelector: (selector: string) => {
        if (selector === "#app") return app;
        const element = elements.get(selector) ?? createElement();
        elements.set(selector, element);
        return element;
      },
      querySelectorAll: () => [],
    },
    fetch:
      options.fetch ??
      (() =>
        Promise.resolve({
          json: () => Promise.resolve({ ok: true, project }),
        })),
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
    expect(html).toContain("Save Changes");
    expect(html).toContain("Save As Copy");
    expect(html).toContain("Copy ID");
    expect(html).toContain("Copy Display Name");
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

  it("updates an existing variant through POST /api/variants and reloads it from the project API", async () => {
    const projectDir = await createEditorProject();
    const server = await startEditorServer({ projectPath: projectDir });
    servers.push(server);
    const editedVariant = {
      ...(baselineVariant() as Record<string, unknown>),
      displayName: "Saved Browser Edit",
      style: {
        ...((baselineVariant() as Record<string, unknown>).style as Record<string, unknown>),
        backgroundColor: "#123456",
      },
    };

    const saveResponse = await fetch(new URL("/api/variants", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "update", variant: editedVariant }),
    });
    const saveBody = await saveResponse.json();
    const projectBody = (await fetch(new URL("/api/project", server.url)).then((response) =>
      response.json(),
    )) as { project: { variants: unknown[] } };

    expect(saveResponse.status).toBe(200);
    expect(saveBody).toMatchObject({
      ok: true,
      mode: "update",
      variantId: "baseline-polish",
      variantPath: "variants/baseline-polish.json",
      validation: { ok: true },
      message: "Saved baseline-polish.",
    });
    expect(projectBody.project.variants).toEqual([editedVariant]);
    expect(
      JSON.parse(await readFile(join(projectDir, "variants", "baseline-polish.json"), "utf8")),
    ).toEqual(editedVariant);
  });

  it("saves a named copy through POST /api/variants without changing the source variant", async () => {
    const projectDir = await createEditorProject();
    const server = await startEditorServer({ projectPath: projectDir });
    servers.push(server);
    const sourceVariant = baselineVariant();

    const response = await fetch(new URL("/api/variants", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "copy",
        variant: sourceVariant,
        copyId: "browser-copy",
        displayName: "Browser Copy",
      }),
    });
    const body = await response.json();
    const projectBody = (await fetch(new URL("/api/project", server.url)).then((projectResponse) =>
      projectResponse.json(),
    )) as { project: { variants: unknown[] } };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      mode: "copy",
      variantId: "browser-copy",
      variantPath: "variants/browser-copy.json",
      validation: { ok: true },
      message: "Saved browser-copy.",
    });
    expect(projectBody.project.variants).toEqual([
      sourceVariant,
      {
        ...(sourceVariant as Record<string, unknown>),
        id: "browser-copy",
        displayName: "Browser Copy",
      },
    ]);
  });

  it.each([
    ["text/plain", "{", 415, "POST /api/variants accepts application/json requests only."],
    ["application/json", "{", 400, "POST /api/variants request body must be valid JSON."],
    [
      "application/json",
      JSON.stringify({ mode: "rename", variant: baselineVariant() }),
      400,
      "POST /api/variants mode must be update or copy.",
    ],
    [
      "application/json",
      JSON.stringify({ mode: "update", variant: { id: "missing-fields" } }),
      422,
      "Auto Demo project variant display name is invalid.",
    ],
  ])(
    "returns a stable error for invalid variant save request %#",
    async (contentType, body, status, message) => {
      const projectDir = await createEditorProject();
      const server = await startEditorServer({ projectPath: projectDir });
      servers.push(server);

      const response = await fetch(new URL("/api/variants", server.url), {
        method: "POST",
        headers: { "content-type": contentType },
        body,
      });

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        errors: expect.arrayContaining([{ message }]),
      });
    },
  );

  it("returns a stable error for duplicate copy ids and missing update targets", async () => {
    const projectDir = await createEditorProject();
    const server = await startEditorServer({ projectPath: projectDir });
    servers.push(server);

    const duplicate = await fetch(new URL("/api/variants", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "copy",
        variant: baselineVariant(),
        copyId: "baseline-polish",
        displayName: "Duplicate",
      }),
    });
    const missingUpdate = await fetch(new URL("/api/variants", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "update",
        variant: { ...(baselineVariant() as Record<string, unknown>), id: "missing-variant" },
      }),
    });

    expect(duplicate.status).toBe(422);
    await expect(duplicate.json()).resolves.toEqual({
      ok: false,
      errors: [{ message: "Saved Auto Demo project variant copy id already exists." }],
    });
    expect(missingUpdate.status).toBe(422);
    await expect(missingUpdate.json()).resolves.toEqual({
      ok: false,
      errors: [{ message: "Saved Auto Demo project variant cannot update a missing variant." }],
    });
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

  it("posts update saves and refreshes the project from the public API", async () => {
    const projectDir = await createEditorProject();
    const project = await loadEditorProject(projectDir);
    expect(project.ok).toBe(true);
    if (!project.ok) return;
    const calls: Array<{ input: string; method: string; body?: unknown }> = [];
    const refreshedProject: EditorProjectSummary = {
      ...project.project,
      variants: [
        {
          ...project.project.variants[0],
          displayName: "Saved Browser Edit",
          style: { ...project.project.variants[0].style, backgroundColor: "#123456" },
        },
      ],
    };
    let projectFetchCount = 0;
    const editor = await runEditorScript(project.project, {
      fetch: async (input, init) => {
        calls.push({
          input,
          method: init?.method ?? "GET",
          body: init?.body === undefined ? undefined : JSON.parse(init.body),
        });
        if (init?.method === "POST") {
          return {
            json: () =>
              Promise.resolve({
                ok: true,
                mode: "update",
                variantId: "baseline-polish",
                message: "Saved baseline-polish.",
              }),
          };
        }
        projectFetchCount += 1;
        return {
          json: () =>
            Promise.resolve({
              ok: true,
              project: projectFetchCount === 1 ? project.project : refreshedProject,
            }),
        };
      },
    });

    editor.evaluate('update("style.backgroundColor", "#123456")');
    await editor.evaluate<Promise<void>>('saveVariant("update")');

    expect(calls).toContainEqual({
      input: "/api/variants",
      method: "POST",
      body: {
        mode: "update",
        variant: {
          ...project.project.variants[0],
          style: { ...project.project.variants[0].style, backgroundColor: "#123456" },
        },
      },
    });
    expect(calls.at(-1)).toMatchObject({ input: "/api/project", method: "GET" });
    expect(editor.evaluate<string>("draft.displayName")).toBe("Saved Browser Edit");
    expect(editor.evaluate<string>("saveStatus")).toBe("Saved baseline-polish.");
  });

  it("posts named-copy saves and selects the refreshed copy", async () => {
    const projectDir = await createEditorProject();
    const project = await loadEditorProject(projectDir);
    expect(project.ok).toBe(true);
    if (!project.ok) return;
    const copyVariant = {
      ...project.project.variants[0],
      id: "browser-copy",
      displayName: "Browser Copy",
    };
    const calls: Array<{ input: string; method: string; body?: unknown }> = [];
    const editor = await runEditorScript(project.project, {
      fetch: async (input, init) => {
        calls.push({
          input,
          method: init?.method ?? "GET",
          body: init?.body === undefined ? undefined : JSON.parse(init.body),
        });
        if (init?.method === "POST") {
          return {
            json: () =>
              Promise.resolve({
                ok: true,
                mode: "copy",
                variantId: "browser-copy",
                message: "Saved browser-copy.",
              }),
          };
        }
        return {
          json: () =>
            Promise.resolve({
              ok: true,
              project: { ...project.project, variants: [project.project.variants[0], copyVariant] },
            }),
        };
      },
    });

    await editor.evaluate<Promise<void>>(
      'saveVariant("copy", { copyId: "browser-copy", displayName: "Browser Copy" })',
    );

    expect(calls).toContainEqual({
      input: "/api/variants",
      method: "POST",
      body: {
        mode: "copy",
        variant: project.project.variants[0],
        copyId: "browser-copy",
        displayName: "Browser Copy",
      },
    });
    expect(editor.evaluate<string>("draft.id")).toBe("browser-copy");
    expect(editor.evaluate<string>("saveStatus")).toBe("Saved browser-copy.");
  });

  it("posts current copy form values when saving a copy", async () => {
    const projectDir = await createEditorProject();
    const project = await loadEditorProject(projectDir);
    expect(project.ok).toBe(true);
    if (!project.ok) return;
    const calls: Array<{ input: string; method: string; body?: unknown }> = [];
    const editor = await runEditorScript(project.project, {
      fetch: async (input, init) => {
        calls.push({
          input,
          method: init?.method ?? "GET",
          body: init?.body === undefined ? undefined : JSON.parse(init.body),
        });
        if (init?.method === "POST") {
          return {
            json: () =>
              Promise.resolve({
                ok: true,
                mode: "copy",
                variantId: "custom-copy",
                message: "Saved custom-copy.",
              }),
          };
        }
        return {
          json: () =>
            Promise.resolve({
              ok: true,
              project: {
                ...project.project,
                variants: [
                  project.project.variants[0],
                  {
                    ...project.project.variants[0],
                    id: "custom-copy",
                    displayName: "Custom Copy",
                  },
                ],
              },
            }),
        };
      },
    });

    editor.evaluate('document.querySelector("#copy-id").value = "custom-copy"');
    editor.evaluate('document.querySelector("#copy-display-name").value = "Custom Copy"');
    await editor.evaluate<Promise<void>>('saveVariant("copy")');

    expect(calls).toContainEqual({
      input: "/api/variants",
      method: "POST",
      body: {
        mode: "copy",
        variant: project.project.variants[0],
        copyId: "custom-copy",
        displayName: "Custom Copy",
      },
    });
  });

  it("preserves current copy form values across ordinary draft edits", async () => {
    const projectDir = await createEditorProject();
    const project = await loadEditorProject(projectDir);
    expect(project.ok).toBe(true);
    if (!project.ok) return;
    const calls: Array<{ input: string; method: string; body?: unknown }> = [];
    const editor = await runEditorScript(project.project, {
      fetch: async (input, init) => {
        calls.push({
          input,
          method: init?.method ?? "GET",
          body: init?.body === undefined ? undefined : JSON.parse(init.body),
        });
        if (init?.method === "POST") {
          return {
            json: () =>
              Promise.resolve({
                ok: true,
                mode: "copy",
                variantId: "custom-copy",
                message: "Saved custom-copy.",
              }),
          };
        }
        return {
          json: () =>
            Promise.resolve({
              ok: true,
              project: {
                ...project.project,
                variants: [
                  project.project.variants[0],
                  {
                    ...project.project.variants[0],
                    id: "custom-copy",
                    displayName: "Custom Copy",
                    style: { ...project.project.variants[0].style, backgroundColor: "#123456" },
                  },
                ],
              },
            }),
        };
      },
    });

    editor.evaluate('document.querySelector("#copy-id").value = "custom-copy"');
    editor.evaluate('document.querySelector("#copy-display-name").value = "Custom Copy"');
    editor.evaluate('update("style.backgroundColor", "#123456")');
    await editor.evaluate<Promise<void>>('saveVariant("copy")');

    expect(calls).toContainEqual({
      input: "/api/variants",
      method: "POST",
      body: {
        mode: "copy",
        variant: {
          ...project.project.variants[0],
          style: { ...project.project.variants[0].style, backgroundColor: "#123456" },
        },
        copyId: "custom-copy",
        displayName: "Custom Copy",
      },
    });
  });
});
