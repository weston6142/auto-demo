import { createServer, type Server } from "node:http";
import { loadProject, type ProjectValidationError } from "@auto-demo/project";

export type EditorPackageRole = "local-browser-editor";
export const editorPackageRole: EditorPackageRole = "local-browser-editor";

export type EditorProjectVariantSummary = {
  id: string;
  displayName: string;
  timeline: {
    startMs: number;
    endMs: number;
  };
  style: {
    background: "solid" | "transparent";
    frame: "browser" | "none";
  };
  exportIntent: {
    format: "mp4";
    quality: "demo" | "high";
    aspectRatio: "16:9" | "4:3" | "9:16";
  };
};

export type EditorProjectSummary = {
  name: string;
  projectDir: string;
  manifestPath: string;
  source: {
    url: string;
    status: "completed" | "failed" | "interrupted";
    durationMs: number;
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
    timeline: variant.timeline,
    style: {
      background: variant.style.background,
      frame: variant.style.frame,
    },
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

function editorHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Auto Demo Editor</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; color: #172033; background: #f8fafc; }
      main { max-width: 960px; margin: 0 auto; }
      h1 { font-size: 1.8rem; margin-bottom: 0.25rem; }
      .panel { border: 1px solid #d8dee8; background: #ffffff; border-radius: 8px; padding: 1rem; margin: 1rem 0; }
      .variant { border-top: 1px solid #e5e9f0; padding: 0.8rem 0; }
      .variant:first-child { border-top: 0; }
      code { background: #eef2f7; padding: 0.1rem 0.25rem; border-radius: 4px; }
      .error { color: #9f1239; }
    </style>
  </head>
  <body>
    <main>
      <h1>Auto Demo Editor</h1>
      <section id="app" class="panel">Loading project...</section>
    </main>
    <script>
      const app = document.querySelector("#app");
      const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\"": "&quot;", "'": "&#39;"
      })[char]);

      fetch("/api/project")
        .then((response) => response.json())
        .then((data) => {
          if (!data.ok) {
            app.innerHTML = "<h2>Project could not be loaded</h2><ul>" +
              data.errors.map((error) => "<li class=\\"error\\">" + escapeHtml(error.message) + "</li>").join("") +
              "</ul>";
            return;
          }

          const project = data.project;
          const variants = project.variants.length === 0
            ? "<p>" + escapeHtml(project.emptyVariantMessage) + "</p>"
            : project.variants.map((variant) => "<div class=\\"variant\\"><strong>" +
                escapeHtml(variant.displayName) + "</strong> <code>" + escapeHtml(variant.id) +
                "</code><br>Timeline: " + variant.timeline.startMs + "ms - " + variant.timeline.endMs +
                "ms<br>Style: " + escapeHtml(variant.style.frame) + " / " +
                escapeHtml(variant.style.background) + "<br>Export: " +
                escapeHtml(variant.exportIntent.format) + " " +
                escapeHtml(variant.exportIntent.aspectRatio) + "</div>").join("");

          app.innerHTML = "<h2>" + escapeHtml(project.name) + "</h2>" +
            "<p>Source: " + escapeHtml(project.source.url) + "</p>" +
            "<p>Status: " + escapeHtml(project.source.status) + " · Duration: " +
            project.source.durationMs + "ms · Viewport: " + project.source.viewport.width +
            "x" + project.source.viewport.height + "</p>" +
            "<p>Project: <code>" + escapeHtml(project.projectDir) + "</code></p>" +
            "<h3>Saved Variants</h3>" + variants;
        })
        .catch((error) => {
          app.innerHTML = "<h2>Project could not be loaded</h2><p class=\\"error\\">" +
            escapeHtml(error.message) + "</p>";
        });
    </script>
  </body>
</html>`;
}
