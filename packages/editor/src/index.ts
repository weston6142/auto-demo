import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, normalize, relative, sep } from "node:path";
import {
  loadProject,
  upsertSavedVariant,
  type ProjectValidationError,
  type ProjectVariant,
  type ProjectVariantCallout,
  type ProjectVariantCaption,
  type ProjectVariantClickDecision,
  type ProjectVariantCursorDecision,
  type ProjectVariantExportIntent,
  type ProjectVariantSource,
  type ProjectVariantStyle,
  type ProjectVariantTimeline,
  type ProjectVariantViewportDecision,
} from "@auto-demo/project";

export type EditorPackageRole = "local-browser-editor";
export const editorPackageRole: EditorPackageRole = "local-browser-editor";

export type EditorProjectVariantSummary = {
  id: string;
  displayName: string;
  source: ProjectVariantSource;
  timeline: ProjectVariantTimeline;
  viewport: ProjectVariantViewportDecision;
  cursor: ProjectVariantCursorDecision;
  clicks: ProjectVariantClickDecision;
  captions: ProjectVariantCaption[];
  callouts: ProjectVariantCallout[];
  style: ProjectVariantStyle;
  exportIntent: ProjectVariantExportIntent;
};

export type EditorProjectSummary = {
  name: string;
  projectDir: string;
  manifestPath: string;
  source: {
    url: string;
    status: "completed" | "failed" | "interrupted";
    durationMs: number;
    mediaPath: string;
    eventsPath: string;
    viewport: {
      width: number;
      height: number;
    };
  };
  variants: EditorProjectVariantSummary[];
  emptyVariantMessage?: string;
};

export type EditorProjectLoadResult =
  | {
      ok: true;
      project: EditorProjectSummary;
    }
  | {
      ok: false;
      projectPath: string;
      errors: ProjectValidationError[];
    };

export type StartEditorServerOptions = {
  projectPath: string;
  host?: string;
  port?: number;
};

export type EditorServer = {
  url: string;
  close: () => Promise<void>;
};

const EMPTY_VARIANT_MESSAGE =
  "No saved variants found. Run autodemo generate --project <project> --json --save all to create variants for review.";

export async function loadEditorProject(projectPath: string): Promise<EditorProjectLoadResult> {
  const loaded = await loadProject(projectPath);
  if (!loaded.ok) {
    return {
      ok: false,
      projectPath,
      errors: loaded.errors,
    };
  }

  const variants = loaded.manifest.variants.map((variant) => ({
    id: variant.id,
    displayName: variant.displayName,
    source: variant.source,
    timeline: variant.timeline,
    viewport: variant.viewport,
    cursor: variant.cursor,
    clicks: variant.clicks,
    captions: variant.captions,
    callouts: variant.callouts,
    style: variant.style,
    exportIntent: variant.exportIntent,
  }));

  return {
    ok: true,
    project: {
      name: loaded.manifest.name,
      projectDir: loaded.projectDir,
      manifestPath: loaded.manifestPath,
      source: {
        url: loaded.manifest.sourceCapture.source.url,
        status: loaded.manifest.sourceCapture.status,
        durationMs: loaded.manifest.sourceCapture.timing.durationMs,
        mediaPath: loaded.manifest.media.primary.path,
        eventsPath: loaded.manifest.metadata.events.path,
        viewport: loaded.manifest.sourceCapture.viewport,
      },
      variants,
      ...(variants.length === 0 ? { emptyVariantMessage: EMPTY_VARIANT_MESSAGE } : {}),
    },
  };
}

export async function startEditorServer(options: StartEditorServerOptions): Promise<EditorServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${host}`);

    if (request.method === "POST" && requestUrl.pathname === "/api/variants") {
      try {
        await handleVariantSave(request, response, options.projectPath);
      } catch {
        writeJson(response, 500, {
          ok: false,
          errors: [{ message: "Variant save failed." }],
        });
      }
      return;
    }

    if (request.method !== "GET") {
      response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
      response.end("Method not allowed\n");
      return;
    }

    if (requestUrl.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(editorHtml());
      return;
    }

    if (requestUrl.pathname === "/api/project") {
      const project = await loadEditorProject(options.projectPath);
      response.writeHead(project.ok ? 200 : 422, {
        "content-type": "application/json; charset=utf-8",
      });
      response.end(`${JSON.stringify(project)}\n`);
      return;
    }

    if (requestUrl.pathname.startsWith("/project-file/")) {
      const file = await resolveProjectFile(options.projectPath, requestUrl.pathname);
      if (file === null) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found\n");
        return;
      }

      streamProjectFile(request.headers.range, file, response);
      return;
    }

    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found\n");
  });

  await listen(server, port, host);
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    await closeServer(server);
    throw new Error("Editor server did not expose a local address.");
  }

  return {
    url: `http://${host}:${address.port}/`,
    close: () => closeServer(server),
  };
}

type VariantSaveRequest =
  | {
      mode: "update";
      variant: ProjectVariant;
    }
  | {
      mode: "copy";
      variant: ProjectVariant;
      copyId: string;
      displayName: string;
    };

async function handleVariantSave(
  request: IncomingMessage,
  response: ServerResponse,
  projectPath: string,
): Promise<void> {
  if (!isJsonRequest(request.headers["content-type"])) {
    writeJson(response, 415, {
      ok: false,
      errors: [{ message: "POST /api/variants accepts application/json requests only." }],
    });
    return;
  }

  const parsed = await readJsonRequest(request);
  if (!parsed.ok) {
    writeJson(response, 400, {
      ok: false,
      errors: [{ message: "POST /api/variants request body must be valid JSON." }],
    });
    return;
  }

  const saveRequest = normalizeVariantSaveRequest(parsed.value);
  if (!saveRequest.ok) {
    writeJson(response, 400, { ok: false, errors: [{ message: saveRequest.message }] });
    return;
  }

  const loaded = await loadProject(projectPath);
  if (!loaded.ok) {
    writeJson(response, 422, {
      ok: false,
      errors: loaded.errors.map(({ message }) => ({ message })),
    });
    return;
  }

  const saved = await upsertSavedVariant(loaded, saveRequest.request);
  if (!saved.ok) {
    writeJson(response, 422, {
      ok: false,
      errors: saved.errors.map(({ message }) => ({ message })),
    });
    return;
  }

  const reloaded = await loadEditorProject(projectPath);
  const variantId =
    saveRequest.request.mode === "copy"
      ? saveRequest.request.copyId
      : saveRequest.request.variant.id;

  writeJson(response, 200, {
    ok: true,
    mode: saveRequest.request.mode,
    variantId,
    variantPath: `variants/${variantId}.json`,
    validation: { ok: reloaded.ok },
    message: `Saved ${variantId}.`,
  });
}

function isJsonRequest(contentType: string | string[] | undefined): boolean {
  const value = Array.isArray(contentType) ? contentType[0] : contentType;
  return value?.toLowerCase().split(";")[0]?.trim() === "application/json";
}

function readJsonRequest(
  request: IncomingMessage,
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  return new Promise((resolve) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve({ ok: true, value: JSON.parse(body) as unknown });
      } catch {
        resolve({ ok: false });
      }
    });
    request.on("error", () => resolve({ ok: false }));
  });
}

function normalizeVariantSaveRequest(
  value: unknown,
): { ok: true; request: VariantSaveRequest } | { ok: false; message: string } {
  if (!isRecord(value) || (value.mode !== "update" && value.mode !== "copy")) {
    return { ok: false, message: "POST /api/variants mode must be update or copy." };
  }

  if (!isRecord(value.variant)) {
    return { ok: false, message: "Auto Demo project variant is invalid." };
  }

  if (value.mode === "update") {
    return { ok: true, request: { mode: "update", variant: value.variant as ProjectVariant } };
  }

  if (typeof value.copyId !== "string" || typeof value.displayName !== "string") {
    return { ok: false, message: "POST /api/variants copy requires copyId and displayName." };
  }

  return {
    ok: true,
    request: {
      mode: "copy",
      variant: value.variant as ProjectVariant,
      copyId: value.copyId,
      displayName: value.displayName,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(value)}\n`);
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }
      reject(error);
    });
  });
}

type ResolvedProjectFile = {
  path: string;
  absolutePath: string;
  size: number;
};

async function resolveProjectFile(
  projectPath: string,
  requestPath: string,
): Promise<ResolvedProjectFile | null> {
  const project = await loadEditorProject(projectPath);
  if (!project.ok) {
    return null;
  }

  try {
    const relativePath = decodeURIComponent(requestPath.slice("/project-file/".length));
    const normalized = normalize(relativePath);
    if (normalized.startsWith("..") || normalized.includes(`${sep}..${sep}`)) {
      return null;
    }

    const allowedPaths = new Set([
      project.project.source.mediaPath,
      project.project.source.eventsPath,
      ...project.project.variants.flatMap((variant) => [
        variant.source.mediaPath,
        variant.source.eventsPath,
      ]),
    ]);
    if (!allowedPaths.has(normalized)) {
      return null;
    }

    const projectRoot = await realpath(project.project.projectDir);
    const absolutePath = await realpath(join(project.project.projectDir, normalized));
    const relativeToRoot = relative(projectRoot, absolutePath);
    if (relativeToRoot === "" || relativeToRoot.startsWith("..") || isAbsolute(relativeToRoot)) {
      return null;
    }

    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      return null;
    }

    return {
      path: normalized,
      absolutePath,
      size: fileStat.size,
    };
  } catch {
    return null;
  }
}

function streamProjectFile(
  rangeHeader: string | undefined,
  file: ResolvedProjectFile,
  response: ServerResponse,
): void {
  const contentType = contentTypeForProjectFile(file.path);
  const range = parseByteRange(rangeHeader, file.size);

  if (rangeHeader !== undefined && range === null) {
    response.writeHead(416, {
      "content-range": `bytes */${file.size}`,
      "content-type": "text/plain; charset=utf-8",
    });
    response.end("Range not satisfiable\n");
    return;
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? Math.max(0, file.size - 1);
  const contentLength = file.size === 0 ? 0 : end - start + 1;
  const headers: Record<string, string> = {
    "accept-ranges": "bytes",
    "content-length": String(contentLength),
    "content-type": contentType,
  };

  if (range === null || file.size === 0) {
    response.writeHead(200, headers);
  } else {
    response.writeHead(206, {
      ...headers,
      "content-range": `bytes ${start}-${end}/${file.size}`,
    });
  }

  const stream = createReadStream(file.absolutePath, file.size === 0 ? {} : { start, end });
  stream.on("error", () => {
    if (!response.headersSent) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found\n");
      return;
    }
    response.destroy();
  });
  stream.pipe(response);
}

function parseByteRange(
  rangeHeader: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (rangeHeader === undefined) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (match === null) {
    return null;
  }

  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") {
    return null;
  }

  if (rawStart === "") {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0 || size === 0) {
      return null;
    }
    return {
      start: Math.max(0, size - suffixLength),
      end: size - 1,
    };
  }

  const start = Number(rawStart);
  const requestedEnd = rawEnd === "" ? size - 1 : Number(rawEnd);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= size
  ) {
    return null;
  }

  return {
    start,
    end: Math.min(requestedEnd, size - 1),
  };
}

function contentTypeForProjectFile(path: string): string {
  if (path.endsWith(".webm")) {
    return "video/webm";
  }
  if (path.endsWith(".jsonl")) {
    return "application/x-ndjson; charset=utf-8";
  }
  return "application/octet-stream";
}

function editorHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Auto Demo Editor</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body { font-family: Inter, ui-sans-serif, system-ui, sans-serif; margin: 0; color: #1c2434; background: #f6f7f9; }
      main { max-width: 1180px; margin: 0 auto; padding: 1.5rem; }
      h1 { font-size: 1.6rem; margin: 0 0 0.25rem; }
      h2 { font-size: 1.1rem; margin: 0 0 0.75rem; }
      h3 { font-size: 0.92rem; margin: 0 0 0.6rem; }
      label { display: grid; gap: 0.3rem; font-size: 0.78rem; font-weight: 650; color: #475569; }
      input, select, textarea { width: 100%; border: 1px solid #cbd5e1; border-radius: 6px; padding: 0.45rem 0.55rem; font: inherit; background: #ffffff; color: #172033; }
      textarea { min-height: 4.5rem; resize: vertical; }
      button { border: 1px solid #1f6f68; border-radius: 6px; padding: 0.48rem 0.7rem; font: inherit; font-weight: 650; color: #ffffff; background: #1f6f68; cursor: pointer; }
      button.secondary { color: #1f6f68; background: #ffffff; }
      code, pre { background: #edf1f5; border-radius: 6px; }
      code { padding: 0.1rem 0.25rem; }
      pre { overflow: auto; padding: 0.75rem; max-height: 22rem; }
      .panel { border: 1px solid #d8dee8; background: #ffffff; border-radius: 8px; padding: 1rem; margin: 1rem 0; }
      .layout { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr); gap: 1rem; align-items: start; }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.7rem; }
      .stack { display: grid; gap: 0.7rem; }
      .muted { color: #64748b; }
      .error { color: #9f1239; }
      .preview { background: #111827; border-radius: 8px; padding: 0.75rem; color: #ffffff; }
      video { width: 100%; aspect-ratio: 16 / 9; background: #020617; border-radius: 6px; display: block; }
      .timeline { position: relative; height: 0.8rem; margin-top: 0.7rem; border-radius: 99px; background: #475569; overflow: hidden; }
      .trim { position: absolute; top: 0; bottom: 0; border-radius: 99px; background: #3dd6c6; }
      .overlay { margin-top: 0.7rem; padding: 0.6rem; border: 1px solid #334155; border-radius: 6px; background: #1f2937; }
      .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
      .text-row { display: grid; grid-template-columns: 1fr 7rem 7rem auto; gap: 0.5rem; align-items: end; }
      .callout-row { grid-template-columns: 1fr 5.5rem 5.5rem 5.5rem 5.5rem auto; }
      @media (max-width: 820px) {
        main { padding: 1rem; }
        .layout, .grid, .text-row, .callout-row { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Auto Demo Editor</h1>
      <p class="muted">Approximate browser review for schema-backed variant finishing.</p>
      <section id="app" class="panel">Loading project...</section>
    </main>
    <script>
      const app = document.querySelector("#app");
      const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\"": "&quot;", "'": "&#39;"
      })[char]);
      const clone = (value) => JSON.parse(JSON.stringify(value));
      const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));
      const isHexColor = (value) => /^#[0-9a-fA-F]{6}$/.test(String(value));
      const nextSlug = (prefix, entries) => {
        const ids = new Set(entries.map((entry) => entry.id));
        let index = entries.length + 1;
        while (ids.has(prefix + "-" + String(index))) index += 1;
        return prefix + "-" + String(index);
      };
      let project = null;
      let originalVariant = null;
      let draft = null;
      let saveStatus = "";

      function mediaUrl(path) {
        return "/project-file/" + String(path).split("/").map(encodeURIComponent).join("/");
      }

      function update(path, value) {
        const parts = path.split(".");
        let target = draft;
        for (const part of parts.slice(0, -1)) target = target[part];
        target[parts[parts.length - 1]] = value;
        normalizeDraft();
        renderEditor();
      }

      function normalizeDraft() {
        const duration = project.source.durationMs;
        draft.timeline.startMs = Math.round(clamp(draft.timeline.startMs, 0, Math.max(0, duration - 1)));
        draft.timeline.endMs = Math.round(clamp(draft.timeline.endMs, draft.timeline.startMs + 1, duration));
        draft.captions.forEach(normalizeTextRange);
        draft.callouts.forEach(normalizeTextRange);
        draft.viewport.focus.x = clamp(draft.viewport.focus.x, 0, 1);
        draft.viewport.focus.y = clamp(draft.viewport.focus.y, 0, 1);
        draft.viewport.zoom = clamp(draft.viewport.zoom, 1, 4);
        draft.style.padding = Math.round(clamp(draft.style.padding, 0, 256));
        draft.style.cornerRadius = Math.round(clamp(draft.style.cornerRadius, 0, 64));
        if (!isHexColor(draft.style.backgroundColor)) {
          draft.style.backgroundColor = isHexColor(originalVariant.style.backgroundColor)
            ? originalVariant.style.backgroundColor
            : "#000000";
        }
      }

      function normalizeTextRange(entry) {
        entry.startMs = Math.round(clamp(entry.startMs, draft.timeline.startMs, draft.timeline.endMs - 1));
        entry.endMs = Math.round(clamp(entry.endMs, entry.startMs + 1, draft.timeline.endMs));
      }

      function resetDraft() {
        draft = clone(originalVariant);
        saveStatus = "";
        renderEditor();
      }

      function selectVariant(id) {
        originalVariant = project.variants.find((variant) => variant.id === id) || project.variants[0];
        draft = clone(originalVariant);
        saveStatus = "";
        renderEditor();
      }

      function addCaption() {
        draft.captions.push({
          id: nextSlug("caption", draft.captions),
          text: "New caption",
          startMs: draft.timeline.startMs,
          endMs: Math.min(draft.timeline.endMs, draft.timeline.startMs + 1000)
        });
        renderEditor();
      }

      function addCallout() {
        draft.callouts.push({
          id: nextSlug("callout", draft.callouts),
          text: "New callout",
          startMs: draft.timeline.startMs,
          endMs: Math.min(draft.timeline.endMs, draft.timeline.startMs + 1000),
          anchor: { x: 0.5, y: 0.5 }
        });
        renderEditor();
      }

      function updateText(kind, index, field, value) {
        const entry = draft[kind][index];
        entry[field] = field === "startMs" || field === "endMs" ? Math.round(Number(value)) : value;
        normalizeTextRange(entry);
        renderEditor();
      }

      function updateCalloutAnchor(index, field, value) {
        draft.callouts[index].anchor[field] = clamp(value, 0, 1);
        renderEditor();
      }

      function removeText(kind, index) {
        draft[kind].splice(index, 1);
        renderEditor();
      }

      async function refreshProject(selectedVariantId) {
        const data = await fetch("/api/project").then((response) => response.json());
        if (!data.ok) {
          app.innerHTML = "<h2>Project could not be loaded</h2><ul>" +
            data.errors.map((error) => "<li class=\\"error\\">" + escapeHtml(error.message) + "</li>").join("") +
            "</ul>";
          return;
        }

        project = data.project;
        if (project.variants.length === 0) {
          app.innerHTML = "<h2>" + escapeHtml(project.name) + "</h2><p>" +
            escapeHtml(project.emptyVariantMessage) + "</p>";
          return;
        }

        selectVariant(selectedVariantId || project.variants[0].id);
      }

      async function saveVariant(mode, copyOptions) {
        saveStatus = "Saving...";
        renderEditor();
        const copyId = copyOptions?.copyId ?? document.querySelector("#copy-id").value;
        const displayName = copyOptions?.displayName ?? document.querySelector("#copy-display-name").value;
        const payload = mode === "copy"
          ? { mode, variant: draft, copyId, displayName }
          : { mode: "update", variant: draft };
        const response = await fetch("/api/variants", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!result.ok) {
          saveStatus = result.errors.map((error) => error.message).join(" ");
          renderEditor();
          return;
        }

        saveStatus = result.message;
        await refreshProject(result.variantId);
        saveStatus = result.message;
        renderEditor();
      }

      function textRows(kind) {
        const rows = draft[kind].map((entry, index) => {
          const anchor = kind === "callouts"
            ? "<label>X<input type=\\"number\\" min=\\"0\\" max=\\"1\\" step=\\"0.01\\" value=\\"" + entry.anchor.x + "\\" data-callout-anchor=\\"" + index + ":x\\"></label>" +
              "<label>Y<input type=\\"number\\" min=\\"0\\" max=\\"1\\" step=\\"0.01\\" value=\\"" + entry.anchor.y + "\\" data-callout-anchor=\\"" + index + ":y\\"></label>"
            : "";
          return "<div class=\\"text-row " + (kind === "callouts" ? "callout-row" : "") + "\\">" +
            "<label>Text<input value=\\"" + escapeHtml(entry.text) + "\\" data-text=\\"" + kind + ":" + index + ":text\\"></label>" +
            "<label>Start<input type=\\"number\\" value=\\"" + entry.startMs + "\\" data-text=\\"" + kind + ":" + index + ":startMs\\"></label>" +
            "<label>End<input type=\\"number\\" value=\\"" + entry.endMs + "\\" data-text=\\"" + kind + ":" + index + ":endMs\\"></label>" +
            anchor +
            "<button class=\\"secondary\\" data-remove-text=\\"" + kind + ":" + index + "\\">Remove</button>" +
            "</div>";
        }).join("");
        return rows || "<p class=\\"muted\\">No " + kind + " yet.</p>";
      }

      function renderEditor() {
        const duration = project.source.durationMs || 1;
        const left = (draft.timeline.startMs / duration) * 100;
        const width = ((draft.timeline.endMs - draft.timeline.startMs) / duration) * 100;
        const variantOptions = project.variants.map((variant) =>
          "<option value=\\"" + escapeHtml(variant.id) + "\\"" + (variant.id === draft.id ? " selected" : "") + ">" +
          escapeHtml(variant.displayName) + "</option>"
        ).join("");

        app.innerHTML =
          "<div class=\\"layout\\">" +
            "<section class=\\"stack\\">" +
              "<div><h2>" + escapeHtml(project.name) + "</h2>" +
              "<p class=\\"muted\\">Source: " + escapeHtml(project.source.url) + " · Duration: " + project.source.durationMs + "ms · Viewport: " + project.source.viewport.width + "x" + project.source.viewport.height + "</p></div>" +
              "<label>Variant<select id=\\"variant-select\\">" + variantOptions + "</select></label>" +
              "<div class=\\"preview\\"><h2>Approximate Preview</h2>" +
                "<video controls src=\\"" + escapeHtml(mediaUrl(draft.source.mediaPath)) + "\\"></video>" +
                "<div class=\\"timeline\\"><span class=\\"trim\\" style=\\"left:" + left + "%;width:" + width + "%\\"></span></div>" +
                "<div class=\\"overlay\\">Viewport " + escapeHtml(draft.viewport.mode) + " · focus " + draft.viewport.focus.x.toFixed(2) + ", " + draft.viewport.focus.y.toFixed(2) + " · zoom " + draft.viewport.zoom.toFixed(2) + "<br>" +
                "Cursor " + (draft.cursor.visible ? "visible" : "hidden") + " / " + escapeHtml(draft.cursor.emphasis) + " · Clicks " + escapeHtml(draft.clicks.emphasis) + "</div>" +
              "</div>" +
              "<section><h2>Edited Variant JSON</h2><pre>" + escapeHtml(JSON.stringify(draft, null, 2)) + "</pre></section>" +
            "</section>" +
            "<section class=\\"stack\\">" +
              "<section class=\\"panel\\"><h3>Save</h3><div class=\\"actions\\">" +
                "<button id=\\"save-update\\">Save Changes</button>" +
                "<button class=\\"secondary\\" id=\\"reset\\">Reset Changes</button>" +
              "</div><div class=\\"grid\\">" +
                "<label>Copy ID<input id=\\"copy-id\\" value=\\"" + escapeHtml(draft.id + "-copy") + "\\"></label>" +
                "<label>Copy Display Name<input id=\\"copy-display-name\\" value=\\"" + escapeHtml(draft.displayName + " Copy") + "\\"></label>" +
              "</div><div class=\\"actions\\"><button class=\\"secondary\\" id=\\"save-copy\\">Save As Copy</button>" +
                "<span class=\\"" + (saveStatus.startsWith("Saved ") || saveStatus === "" || saveStatus === "Saving..." ? "muted" : "error") + "\\">" + escapeHtml(saveStatus) + "</span></div></section>" +
              "<section class=\\"panel\\"><h3>Trim</h3><div class=\\"grid\\">" +
                "<label>Start ms<input type=\\"number\\" min=\\"0\\" max=\\"" + project.source.durationMs + "\\" value=\\"" + draft.timeline.startMs + "\\" data-update=\\"timeline.startMs\\"></label>" +
                "<label>End ms<input type=\\"number\\" min=\\"1\\" max=\\"" + project.source.durationMs + "\\" value=\\"" + draft.timeline.endMs + "\\" data-update=\\"timeline.endMs\\"></label>" +
              "</div></section>" +
              "<section class=\\"panel\\"><h3>Viewport</h3><div class=\\"grid\\">" +
                "<label>Mode<select data-update=\\"viewport.mode\\"><option value=\\"contain\\">contain</option><option value=\\"cover\\">cover</option></select></label>" +
                "<label>Zoom<input type=\\"number\\" min=\\"1\\" max=\\"4\\" step=\\"0.05\\" value=\\"" + draft.viewport.zoom + "\\" data-update=\\"viewport.zoom\\"></label>" +
                "<label>Focus X<input type=\\"number\\" min=\\"0\\" max=\\"1\\" step=\\"0.01\\" value=\\"" + draft.viewport.focus.x + "\\" data-update=\\"viewport.focus.x\\"></label>" +
                "<label>Focus Y<input type=\\"number\\" min=\\"0\\" max=\\"1\\" step=\\"0.01\\" value=\\"" + draft.viewport.focus.y + "\\" data-update=\\"viewport.focus.y\\"></label>" +
              "</div></section>" +
              "<section class=\\"panel\\"><h3>Captions</h3><div class=\\"stack\\">" + textRows("captions") + "<button id=\\"add-caption\\">Add Caption</button></div></section>" +
              "<section class=\\"panel\\"><h3>Callouts</h3><div class=\\"stack\\">" + textRows("callouts") + "<button id=\\"add-callout\\">Add Callout</button></div></section>" +
              "<section class=\\"panel\\"><h3>Cursor</h3><div class=\\"grid\\">" +
                "<label>Visible<select data-update=\\"cursor.visible\\"><option value=\\"true\\">visible</option><option value=\\"false\\">hidden</option></select></label>" +
                "<label>Emphasis<select data-update=\\"cursor.emphasis\\"><option value=\\"none\\">none</option><option value=\\"spotlight\\">spotlight</option><option value=\\"hide-idle\\">hide-idle</option></select></label>" +
              "</div></section>" +
              "<section class=\\"panel\\"><h3>Clicks</h3><label>Emphasis<select data-update=\\"clicks.emphasis\\"><option value=\\"none\\">none</option><option value=\\"ring\\">ring</option><option value=\\"pulse\\">pulse</option></select></label></section>" +
              "<section class=\\"panel\\"><h3>Style</h3><div class=\\"grid\\">" +
                "<label>Background<select data-update=\\"style.background\\"><option value=\\"solid\\">solid</option><option value=\\"transparent\\">transparent</option></select></label>" +
                "<label>Background color<input type=\\"color\\" value=\\"" + escapeHtml(draft.style.backgroundColor) + "\\" data-update=\\"style.backgroundColor\\"></label>" +
                "<label>Frame<select data-update=\\"style.frame\\"><option value=\\"browser\\">browser</option><option value=\\"none\\">none</option></select></label>" +
                "<label>Padding<input type=\\"number\\" min=\\"0\\" max=\\"256\\" value=\\"" + draft.style.padding + "\\" data-update=\\"style.padding\\"></label>" +
                "<label>Corner radius<input type=\\"number\\" min=\\"0\\" max=\\"64\\" value=\\"" + draft.style.cornerRadius + "\\" data-update=\\"style.cornerRadius\\"></label>" +
              "</div><p class=\\"muted\\">Export intent: " + escapeHtml(draft.exportIntent.format) + " " + escapeHtml(draft.exportIntent.aspectRatio) + " " + escapeHtml(draft.exportIntent.quality) + "</p></section>" +
            "</section>" +
          "</div>";

        document.querySelector("[data-update='viewport.mode']").value = draft.viewport.mode;
        document.querySelector("[data-update='cursor.visible']").value = String(draft.cursor.visible);
        document.querySelector("[data-update='cursor.emphasis']").value = draft.cursor.emphasis;
        document.querySelector("[data-update='clicks.emphasis']").value = draft.clicks.emphasis;
        document.querySelector("[data-update='style.background']").value = draft.style.background;
        document.querySelector("[data-update='style.frame']").value = draft.style.frame;

        document.querySelector("#variant-select").addEventListener("change", (event) => selectVariant(event.target.value));
        document.querySelector("#reset").addEventListener("click", resetDraft);
        document.querySelector("#save-update").addEventListener("click", () => saveVariant("update"));
        document.querySelector("#save-copy").addEventListener("click", () => saveVariant("copy"));
        document.querySelector("#add-caption").addEventListener("click", addCaption);
        document.querySelector("#add-callout").addEventListener("click", addCallout);
        document.querySelectorAll("[data-update]").forEach((input) => input.addEventListener("change", (event) => {
          const path = event.target.getAttribute("data-update");
          const value = event.target.value === "true" ? true : event.target.value === "false" ? false : event.target.value;
          update(path, event.target.type === "number" ? Number(value) : value);
        }));
        document.querySelectorAll("[data-text]").forEach((input) => input.addEventListener("change", (event) => {
          const [kind, index, field] = event.target.getAttribute("data-text").split(":");
          updateText(kind, Number(index), field, event.target.value);
        }));
        document.querySelectorAll("[data-callout-anchor]").forEach((input) => input.addEventListener("change", (event) => {
          const [index, field] = event.target.getAttribute("data-callout-anchor").split(":");
          updateCalloutAnchor(Number(index), field, event.target.value);
        }));
        document.querySelectorAll("[data-remove-text]").forEach((button) => button.addEventListener("click", (event) => {
          const [kind, index] = event.target.getAttribute("data-remove-text").split(":");
          removeText(kind, Number(index));
        }));
      }

      refreshProject()
        .catch((error) => {
          app.innerHTML = "<h2>Project could not be loaded</h2><p class=\\"error\\">" +
            escapeHtml(error.message) + "</p>";
        });
    </script>
  </body>
</html>`;
}
