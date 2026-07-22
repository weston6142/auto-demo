/// <reference lib="dom" />

import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDiscoverSessionHost, type DiscoverSessionHost } from "./discoverHost.js";
import { createFileDiscoverCommandBackend } from "./discoverBackend.js";
import {
  createPlaywrightDiscoverRuntime,
  readDiscoverBootstrap,
} from "./playwrightDiscoverRuntime.js";
import { runCliAsync, type CliDependencies } from "./index.js";

const tempDirectories: string[] = [];
const hosts: DiscoverSessionHost[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error === undefined ? resolve() : reject(error))),
          ),
      ),
  );
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("coordinate discovery CLI acceptance", () => {
  it("turns screenshot coordinates into a replay-validated semantic review", async () => {
    const origin = await startFixture();
    const workflowDirectory = await mkdtemp(join(tmpdir(), "coordinate-discovery-acceptance-"));
    tempDirectories.push(workflowDirectory);
    const backend = createFileDiscoverCommandBackend({
      workflowDirectory,
      idGenerator: () => "coordinate-acceptance",
      tokenGenerator: () => "coordinate-acceptance-private-token",
      pollIntervalMs: 1,
      startupTimeoutMs: 10_000,
      async launch(bootstrapPath) {
        const bootstrap = await readDiscoverBootstrap(bootstrapPath);
        const created = await createPlaywrightDiscoverRuntime(bootstrap, {
          async createWindowCapture(page) {
            const cachedViewport = await page.screenshot({ type: "png" });
            return {
              async capture() {
                return cachedViewport;
              },
            };
          },
        });
        if (!created.initialResponse.ok) {
          await writeFile(
            join(bootstrap.sessionDirectory, "ready.json"),
            JSON.stringify(created.initialResponse),
          );
          return;
        }
        const socketPath = join(bootstrap.sessionDirectory, "host.sock");
        const host = await createDiscoverSessionHost({
          socketPath,
          token: bootstrap.token,
          sessionId: bootstrap.sessionId,
          runtime: created.runtime,
        });
        hosts.push(host);
        await writeFile(
          join(bootstrap.sessionDirectory, "host.json"),
          JSON.stringify({ schemaVersion: 1, socketPath, pid: process.pid }),
        );
        await writeFile(
          join(bootstrap.sessionDirectory, "ready.json"),
          JSON.stringify(created.initialResponse),
        );
      },
    });
    const dependencies = { discoverCommandBackend: backend } as CliDependencies;

    const started = await command(
      [
        "discover",
        "start",
        "--url",
        `${origin}/search`,
        "--goal",
        "Select New, Kia, Sorento, and All miles, then open the first organic result",
        "--risk",
        "yolo",
        "--grid",
        "--json",
      ],
      dependencies,
    );
    expect(started).toMatchObject({ ok: true, sessionId: "coordinate-acceptance" });
    let frameId = frame(started);
    expect(
      await command(
        ["discover", "status", "--session", "coordinate-acceptance", "--json"],
        dependencies,
      ),
    ).toMatchObject({ ok: true, status: "discovering" });

    frameId = frame(
      await act(workflowDirectory, dependencies, frameId, [{ type: "click", x: 780, y: 110 }]),
      frameId,
    );
    frameId = frame(
      await act(workflowDirectory, dependencies, frameId, [
        { type: "keypress", keys: ["n", "n", "ENTER"] },
      ]),
      frameId,
    );
    frameId = frame(
      await act(workflowDirectory, dependencies, frameId, [{ type: "click", x: 470, y: 180 }]),
      frameId,
    );
    frameId = frame(
      await act(workflowDirectory, dependencies, frameId, [
        { type: "scroll", x: 470, y: 240, deltaY: 180 },
      ]),
      frameId,
    );
    frameId = frame(
      await act(workflowDirectory, dependencies, frameId, [{ type: "click", x: 470, y: 270 }]),
      frameId,
    );
    frameId = frame(
      await act(workflowDirectory, dependencies, frameId, [{ type: "click", x: 780, y: 220 }]),
      frameId,
    );
    frameId = frame(
      await act(workflowDirectory, dependencies, frameId, [
        { type: "keypress", keys: ["s", "ENTER"] },
      ]),
      frameId,
    );
    frameId = frame(
      await act(workflowDirectory, dependencies, frameId, [{ type: "click", x: 470, y: 290 }]),
      frameId,
    );
    frameId = frame(
      await act(workflowDirectory, dependencies, frameId, [
        { type: "keypress", keys: ["a", "ENTER"] },
      ]),
      frameId,
    );
    frameId = frame(
      await act(workflowDirectory, dependencies, frameId, [{ type: "click", x: 640, y: 370 }]),
      frameId,
    );
    frameId = frame(
      await act(workflowDirectory, dependencies, frameId, [{ type: "click", x: 500, y: 205 }]),
      frameId,
    );

    const status = await command(
      ["discover", "status", "--session", "coordinate-acceptance", "--json"],
      dependencies,
    );
    expect(status).toMatchObject({ ok: true, status: "discovering" });
    expect(frame(status)).toBe(frameId);

    const finished = await command(
      ["discover", "finish", "--session", "coordinate-acceptance", "--json"],
      dependencies,
    );
    if (finished.ok !== true) throw new Error(`finish failed: ${JSON.stringify(finished)}`);
    expect(finished).toMatchObject({
      ok: true,
      phase: "review_required",
      replayAttempts: 1,
      review: { blockers: [], approval: { eligible: true } },
    });
    const serialized = JSON.stringify(finished);
    expect(serialized).toContain('"optionLabel":"New"');
    expect(serialized).toContain('"optionLabel":"Sorento"');
    expect(serialized).toContain('"optionLabel":"All miles"');
    expect(serialized).toContain('"promotion":"exclude-marked-promoted"');
    expect(serialized).not.toMatch(/"[xy]":/);
    await expect(
      readFile(
        join(workflowDirectory, "coordinate-acceptance", "plan.replay-validated.json"),
        "utf8",
      ),
    ).resolves.toContain('"state": "validated"');
  }, 45_000);
});

async function command(
  args: string[],
  dependencies: CliDependencies,
): Promise<Record<string, unknown>> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`command timed out: ${args.slice(0, 2).join(" ")}`)),
      8_000,
    );
  });
  const result = await Promise.race([runCliAsync(args, dependencies), timedOut]).finally(() =>
    clearTimeout(timeout),
  );
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

async function act(
  workflowDirectory: string,
  dependencies: CliDependencies,
  frameId: string,
  actions: unknown[],
): Promise<Record<string, unknown>> {
  const path = join(workflowDirectory, `actions-${crypto.randomUUID()}.json`);
  await writeFile(path, JSON.stringify({ frameId, actions }));
  const result = await command(
    ["discover", "act", "--session", "coordinate-acceptance", "--actions-file", path, "--json"],
    dependencies,
  ).catch((error: unknown) => {
    throw new Error(`action command failed ${JSON.stringify(actions)}`, { cause: error });
  });
  if (result.ok !== true) throw new Error(`action response failed: ${JSON.stringify(result)}`);
  return result;
}

function frame(result: Record<string, unknown>, unchangedFrameId?: string): string {
  const value = (result.frame as Record<string, unknown> | undefined)?.id;
  if (
    value === undefined &&
    result.ok === true &&
    result.boundary === "unchanged" &&
    unchangedFrameId !== undefined
  ) {
    return unchangedFrameId;
  }
  if (typeof value !== "string") throw new Error(`fresh frame missing: ${JSON.stringify(result)}`);
  return value;
}

async function startFixture(): Promise<string> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://fixture.invalid");
    response.setHeader("content-type", "text/html; charset=utf-8");
    if (url.pathname === "/vehicle/organic-1") {
      response.end("<!doctype html><title>Organic vehicle</title><h1>First organic vehicle</h1>");
      return;
    }
    if (url.pathname !== "/search") {
      response.statusCode = 404;
      response.end("Not found");
      return;
    }
    response.end(`<!doctype html>
      <html><head><title>Vehicle search</title><style>
        * { box-sizing: border-box } body { margin: 0; font: 16px system-ui; background: #eef2f6 }
        #panel { position: fixed; left: 340px; top: 20px; width: 600px; height: 410px; padding: 18px; background: white }
        #panel.shifted { transform: translateY(40px) } h1 { margin: 0 }
        .control { position: absolute; width: 260px; height: 40px }
        #name { left: 0; top: 70px } #condition { left: 310px; top: 70px }
        #make { left: 0; top: 140px } #model { left: 310px; top: 140px }
        #distance { left: 0; top: 210px } #zip { left: 310px; top: 210px }
        #search { left: 170px; top: 290px }
        #make-menu { position: absolute; left: 0; top: 184px; width: 260px; height: 82px; overflow-y: auto; background: white; z-index: 3; border: 1px solid #555 }
        #make-menu button { display: block; width: 100%; height: 36px }
        #results { position: fixed; left: 390px; top: 70px; width: 500px; background: white; padding: 20px }
        #results li { height: 80px; padding: 15px }
      </style></head><body>
        <main id="panel"><h1>Find a vehicle</h1><form onsubmit="event.preventDefault()">
          <input id="name" class="control" aria-label="Search name">
          <select id="condition" class="control" aria-label="Condition"><option>Any condition</option><option>New &amp; certified</option><option>New</option></select>
          <button id="make" class="control" type="button" aria-expanded="false" onclick="toggleMake()">Make</button>
          <div id="make-menu" role="listbox" aria-label="Makes" hidden>
            <button type="button" onclick="chooseMake('Audi')">Audi</button><button type="button" onclick="chooseMake('Ford')">Ford</button><button type="button" onclick="chooseMake('Honda')">Honda</button><button type="button" onclick="chooseMake('Kia')">Kia</button>
          </div>
          <select id="model" class="control" aria-label="Model"><option>All models</option><option>Sorento</option></select>
          <select id="distance" class="control" aria-label="Distance"><option>25 miles</option><option>All miles</option></select>
          <input id="zip" class="control" aria-label="ZIP code">
          <button id="search" class="control" type="button" onclick="showResults()">Search</button>
        </form></main>
        <ul id="results" aria-label="Vehicle results" hidden>
          <li>Sponsored <a href="/vehicle/sponsored">Sponsored vehicle</a></li>
          <li><a href="/vehicle/organic-1">Organic vehicle</a></li>
          <li><a href="/vehicle/organic-2">Organic vehicle</a></li>
        </ul>
        <script>
          function toggleMake() { const menu = document.querySelector('#make-menu'); menu.hidden = !menu.hidden; document.querySelector('#make').setAttribute('aria-expanded', String(!menu.hidden)) }
          function chooseMake(value) { document.querySelector('#make').textContent = value; document.querySelector('#make-menu').hidden = true; document.querySelector('#panel').classList.add('shifted') }
          function showResults() { document.querySelector('#panel').hidden = true; document.querySelector('#results').hidden = false }
        </script>
      </body></html>`);
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fixture address missing");
  return `http://127.0.0.1:${address.port}`;
}
