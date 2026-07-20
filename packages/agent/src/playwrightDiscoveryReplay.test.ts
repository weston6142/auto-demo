import { createServer, type Server } from "node:http";
import type { BrowserLaunchProfileV1 } from "@auto-demo/browser-profile";
import { afterEach, describe, expect, it } from "vitest";
import { DiscoveryReplayBrowserError } from "./discoveryReplay.js";
import { createPlaywrightDiscoveryReplayBrowserFactory } from "./playwrightDiscoveryReplay.js";

const servers: Server[] = [];
const browsers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(browsers.splice(0).map((browser) => browser.close()));
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

async function fixture(
  html: string,
  nextHtml = "<!doctype html><h1>Finished</h1>",
): Promise<string> {
  const server = createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "https://example.com/" });
      response.end();
      return;
    }
    if (request.url === "/next") {
      response.end(nextHtml);
      return;
    }
    response.end(html);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fixture unavailable");
  return `http://127.0.0.1:${address.port}`;
}

describe("createPlaywrightDiscoveryReplayBrowserFactory", () => {
  it("uses the explicit profile viewport instead of the legacy replay default", async () => {
    const origin = await fixture(
      "<!doctype html><h1></h1><script>document.querySelector('h1').textContent = innerWidth + 'x' + innerHeight</script>",
    );
    const launchProfile: BrowserLaunchProfileV1 = {
      schemaVersion: 1,
      browser: "chromium",
      channel: "bundled",
      headless: true,
      viewport: { width: 640, height: 360 },
    };
    const browser = await createPlaywrightDiscoveryReplayBrowserFactory().create({
      policy: { mode: "safe", allowedOrigins: [origin] },
      attempt: 1,
      launchProfile,
    });
    browsers.push(browser);

    await browser.open(origin);
    await expect(
      browser.assertVisible({ kind: "visible-state", condition: "640x360", role: "heading" }),
    ).resolves.toBeUndefined();
  });

  it("reports a Cloudflare challenge separately from a policy violation", async () => {
    const origin = await fixture(
      "<!doctype html><title>Just a moment...</title><main>Performing security verification. This website uses a security service to protect itself.</main>",
    );
    const browser = await createPlaywrightDiscoveryReplayBrowserFactory().create({
      policy: { mode: "safe", allowedOrigins: [origin] },
      attempt: 1,
    });
    browsers.push(browser);

    await expect(browser.open(origin)).rejects.toMatchObject({
      code: "anti_bot_challenge",
      challenge: { provider: "cloudflare" },
    });
  });

  it("reports a challenge reached by a later replay navigation", async () => {
    const origin = await fixture(
      "<!doctype html><a href='/next'>Continue</a>",
      "<!doctype html><title>Just a moment...</title><main>Performing security verification. This website uses a security service to protect itself.</main>",
    );
    const browser = await createPlaywrightDiscoveryReplayBrowserFactory().create({
      policy: { mode: "safe", allowedOrigins: [origin] },
      attempt: 1,
    });
    browsers.push(browser);

    await browser.open(origin);
    await expect(browser.navigate(`${origin}/next`)).rejects.toMatchObject({
      code: "anti_bot_challenge",
      challenge: { provider: "cloudflare" },
    });
  });

  it("matches accessible targets and replays safe actions in an isolated page", async () => {
    const origin = await fixture(`<!doctype html>
      <label>Name <input aria-label="Demo name"></label>
      <a href="/next">Continue</a>`);
    const browser = await createPlaywrightDiscoveryReplayBrowserFactory().create({
      policy: { mode: "safe", allowedOrigins: [origin] },
      attempt: 1,
    });
    browsers.push(browser);

    await browser.open(origin);
    const input = await browser.findMatches({ kind: "accessible", label: "Demo name" });
    expect(input).toHaveLength(1);
    await browser.type(input[0]!, "Ada");
    const link = await browser.findMatches({
      kind: "accessible",
      label: "Continue",
      role: "link",
    });
    await browser.click(link[0]!);
    await browser.waitForSettled();

    await expect(browser.inspectPage()).resolves.toEqual({ url: `${origin}/next` });
    await expect(
      browser.assertNavigation({ kind: "navigation", url: `${origin}/next`, match: "exact-url" }),
    ).resolves.toBeUndefined();
    await expect(
      browser.assertNavigation({
        kind: "navigation",
        url: `${origin}/next?ignored=yes`,
        match: "same-origin-path",
      }),
    ).resolves.toBeUndefined();
    await expect(
      browser.assertVisible({ kind: "visible-state", condition: "Finished", role: "heading" }),
    ).resolves.toBeUndefined();
  });

  it("selects native options by public label and verifies bounded control state", async () => {
    const origin = await fixture(`<!doctype html>
      <label>Condition
        <select required>
          <option value="any-private">Any</option>
          <option value="new-private">New</option>
        </select>
      </label>`);
    const browser = await createPlaywrightDiscoveryReplayBrowserFactory().create({
      policy: { mode: "safe", allowedOrigins: [origin] },
      attempt: 1,
    });
    browsers.push(browser);

    await browser.open(origin);
    const matches = await browser.findMatches({
      kind: "accessible",
      label: "Condition",
      role: "combobox",
    });
    await browser.select(matches[0]!, "New");
    await browser.waitForSettled();

    await expect(
      browser.assertControlState({
        kind: "control-state",
        target: { kind: "accessible", label: "Condition", role: "combobox" },
        state: { selectedOption: "New", hasValue: true, validity: "valid" },
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects missing, disabled, and ambiguous public option labels", async () => {
    const origin = await fixture(`<!doctype html>
      <label>Condition
        <select>
          <option disabled>Used</option>
          <option>New</option>
          <option>New</option>
        </select>
      </label>`);
    const browser = await createPlaywrightDiscoveryReplayBrowserFactory().create({
      policy: { mode: "safe", allowedOrigins: [origin] },
      attempt: 1,
    });
    browsers.push(browser);
    await browser.open(origin);
    const matches = await browser.findMatches({
      kind: "accessible",
      label: "Condition",
      role: "combobox",
    });

    for (const label of ["Missing", "Used", "New"]) {
      await expect(browser.select(matches[0]!, label)).rejects.toMatchObject({
        code: "action_failed",
      });
    }
  });

  it("blocks replay from typing credential fields", async () => {
    const origin = await fixture(`<!doctype html><input type="password" aria-label="Password">`);
    const browser = await createPlaywrightDiscoveryReplayBrowserFactory().create({
      policy: { mode: "safe", allowedOrigins: [origin] },
      attempt: 1,
    });
    browsers.push(browser);
    await browser.open(origin);
    const matches = await browser.findMatches({ kind: "accessible", label: "Password" });

    await expect(browser.type(matches[0]!, "not-a-secret")).rejects.toMatchObject({
      code: "policy_blocked",
    });
  });

  it("blocks navigation outside the exact approved origins", async () => {
    const origin = await fixture("<!doctype html><h1>Safe</h1>");
    const browser = await createPlaywrightDiscoveryReplayBrowserFactory().create({
      policy: { mode: "safe", allowedOrigins: [origin] },
      attempt: 1,
    });
    browsers.push(browser);
    await browser.open(origin);

    await expect(browser.navigate("https://example.com/")).rejects.toBeInstanceOf(
      DiscoveryReplayBrowserError,
    );
    await expect(browser.inspectPage()).resolves.toEqual({ url: `${origin}/` });
  });

  it("rejects credential-like initial URLs before navigation", async () => {
    const origin = await fixture("<!doctype html><h1>Safe</h1>");
    const browser = await createPlaywrightDiscoveryReplayBrowserFactory().create({
      policy: { mode: "safe", allowedOrigins: [origin] },
      attempt: 1,
    });
    browsers.push(browser);

    await expect(browser.open(`${origin}/?token=private`)).rejects.toMatchObject({
      code: "policy_blocked",
    });
  });

  it("rejects initial redirects outside the approved origins", async () => {
    const origin = await fixture("<!doctype html><h1>Safe</h1>");
    const browser = await createPlaywrightDiscoveryReplayBrowserFactory().create({
      policy: { mode: "safe", allowedOrigins: [origin] },
      attempt: 1,
    });
    browsers.push(browser);

    await expect(browser.open(`${origin}/redirect`)).rejects.toMatchObject({
      code: "policy_blocked",
    });
  });

  it("fails initial navigation when the page attempts a mutation", async () => {
    let mutations = 0;
    const origin = await fixture(
      "<!doctype html><script>fetch('/mutate', { method: 'POST' }).catch(() => {})</script>",
    );
    servers.at(-1)!.on("request", (request) => {
      if (request.url === "/mutate" && request.method === "POST") mutations += 1;
    });
    const browser = await createPlaywrightDiscoveryReplayBrowserFactory().create({
      policy: { mode: "safe", allowedOrigins: [origin] },
      attempt: 1,
    });
    browsers.push(browser);

    await expect(browser.open(origin)).rejects.toMatchObject({ code: "policy_blocked" });
    expect(mutations).toBe(0);
  });

  it("allows classified same-origin public-browse traffic during bootstrap", async () => {
    let requests = 0;
    const origin = await fixture(
      "<!doctype html><h1>Search</h1><script>fetch('/search', { method: 'POST' }).catch(() => {})</script>",
    );
    servers.at(-1)!.on("request", (request) => {
      if (request.url === "/search" && request.method === "POST") requests += 1;
    });
    const browser = await createPlaywrightDiscoveryReplayBrowserFactory().create({
      policy: { mode: "public-browse", allowedOrigins: [origin] },
      attempt: 1,
    });
    browsers.push(browser);

    await expect(browser.open(origin)).resolves.toBeUndefined();
    expect(requests).toBe(1);
  });

  it("allows same-origin search traffic and blocks cross-origin XHR at action time", async () => {
    let sameOriginRequests = 0;
    let crossOriginRequests = 0;
    const otherOrigin = await fixture("<!doctype html><h1>Other</h1>");
    servers.at(-1)!.on("request", (request) => {
      if (request.url === "/search" && request.method === "POST") crossOriginRequests += 1;
    });
    const origin = await fixture(`<!doctype html>
      <button onclick="fetch('/search', { method: 'POST' })">Search</button>
      <button onclick="fetch('${otherOrigin}/search', { method: 'POST' })">External search</button>`);
    servers.at(-1)!.on("request", (request) => {
      if (request.url === "/search" && request.method === "POST") sameOriginRequests += 1;
    });
    const browser = await createPlaywrightDiscoveryReplayBrowserFactory().create({
      policy: { mode: "public-browse", allowedOrigins: [origin, otherOrigin] },
      attempt: 1,
    });
    browsers.push(browser);
    await browser.open(origin);

    const search = await browser.findMatches({
      kind: "accessible",
      label: "Search",
      role: "button",
    });
    await expect(browser.click(search[0]!)).resolves.toBeUndefined();
    expect(sameOriginRequests).toBe(1);

    const external = await browser.findMatches({
      kind: "accessible",
      label: "External search",
      role: "button",
    });
    await expect(browser.click(external[0]!)).rejects.toMatchObject({ code: "policy_blocked" });
    expect(crossOriginRequests).toBe(0);
  });

  it("fails initial navigation when the page opens a popup", async () => {
    const origin = await fixture("<!doctype html><script>window.open('/next')</script>");
    const browser = await createPlaywrightDiscoveryReplayBrowserFactory().create({
      policy: { mode: "safe", allowedOrigins: [origin] },
      attempt: 1,
    });
    browsers.push(browser);

    await expect(browser.open(origin)).rejects.toMatchObject({ code: "policy_blocked" });
  });

  it("fails initial navigation when the page opens a WebSocket", async () => {
    const origin = await fixture(
      "<!doctype html><script>new WebSocket(`ws://${location.host}/socket`)</script>",
    );
    const browser = await createPlaywrightDiscoveryReplayBrowserFactory().create({
      policy: { mode: "safe", allowedOrigins: [origin] },
      attempt: 1,
    });
    browsers.push(browser);

    await expect(browser.open(origin)).rejects.toMatchObject({ code: "policy_blocked" });
  });

  it("does not install Auto Demo bootstrap enforcement for yolo replay", async () => {
    const origin = await fixture(
      "<!doctype html><h1>Loaded</h1><script>new WebSocket(`ws://${location.host}/socket`)</script>",
    );
    const browser = await createPlaywrightDiscoveryReplayBrowserFactory().create({
      policy: { mode: "yolo" },
      attempt: 1,
    });
    browsers.push(browser);

    await expect(browser.open(origin)).resolves.toBeUndefined();
    await expect(
      browser.assertVisible({ kind: "visible-state", condition: "Loaded", role: "heading" }),
    ).resolves.toBeUndefined();
  });

  it("blocks a WebSocket opened by a replay action", async () => {
    const origin = await fixture(
      '<!doctype html><button onclick="new WebSocket(`ws://${location.host}/socket`)">Connect</button>',
    );
    const browser = await createPlaywrightDiscoveryReplayBrowserFactory().create({
      policy: { mode: "safe", allowedOrigins: [origin] },
      attempt: 1,
    });
    browsers.push(browser);
    await browser.open(origin);
    const matches = await browser.findMatches({
      kind: "accessible",
      label: "Connect",
      role: "button",
    });

    await expect(browser.click(matches[0]!)).rejects.toMatchObject({ code: "policy_blocked" });
  });

  it("does not apply Auto Demo action enforcement during yolo replay", async () => {
    const origin = await fixture(
      '<!doctype html><button onclick="new WebSocket(`ws://${location.host}/socket`)">Connect</button>',
    );
    const browser = await createPlaywrightDiscoveryReplayBrowserFactory().create({
      policy: { mode: "yolo" },
      attempt: 1,
    });
    browsers.push(browser);
    await browser.open(origin);
    const matches = await browser.findMatches({
      kind: "accessible",
      label: "Connect",
      role: "button",
    });

    await expect(browser.click(matches[0]!)).resolves.toBeUndefined();
  });

  it("fails initial navigation when the page starts a download", async () => {
    const origin = await fixture(
      "<!doctype html><a id='download' download href='/file'>file</a><script>download.click()</script>",
    );
    const browser = await createPlaywrightDiscoveryReplayBrowserFactory().create({
      policy: { mode: "safe", allowedOrigins: [origin] },
      attempt: 1,
    });
    browsers.push(browser);

    await expect(browser.open(origin)).rejects.toMatchObject({ code: "policy_blocked" });
  });

  it("allows an acknowledged disposable form mutation but blocks it in safe mode", async () => {
    let mutations = 0;
    const origin = await fixture(
      "<!doctype html><form method='post' action='/mutate'><button>Save demo</button></form>",
    );
    servers.at(-1)!.on("request", (request) => {
      if (request.url === "/mutate" && request.method === "POST") mutations += 1;
    });
    const factory = createPlaywrightDiscoveryReplayBrowserFactory();
    const safe = await factory.create({
      policy: { mode: "safe", allowedOrigins: [origin] },
      attempt: 1,
    });
    const disposable = await factory.create({
      policy: {
        mode: "disposable",
        acknowledgement: "environment-is-disposable",
        allowedOrigins: [origin],
      },
      attempt: 2,
    });
    browsers.push(safe, disposable);
    await safe.open(origin);
    await disposable.open(origin);
    const safeMatch = await safe.findMatches({
      kind: "accessible",
      label: "Save demo",
      role: "button",
    });
    const disposableMatch = await disposable.findMatches({
      kind: "accessible",
      label: "Save demo",
      role: "button",
    });

    const safeBlock = await safe.click(safeMatch[0]!).catch((error: unknown) => error);
    expect(safeBlock).toMatchObject({ code: "policy_blocked" });
    expect(JSON.stringify(safeBlock)).not.toContain("/mutate");
    await expect(disposable.click(disposableMatch[0]!)).resolves.toBeUndefined();
    expect(mutations).toBe(1);
  });

  it("fails closed for unknown methods with a disposable replay policy", async () => {
    let requests = 0;
    const origin = await fixture(
      "<!doctype html><button onclick=\"fetch('/unknown', { method: 'PROPFIND' })\">Probe</button>",
    );
    servers.at(-1)!.on("request", (request) => {
      if (request.url === "/unknown") requests += 1;
    });
    const browser = await createPlaywrightDiscoveryReplayBrowserFactory().create({
      policy: {
        mode: "disposable",
        acknowledgement: "environment-is-disposable",
        allowedOrigins: [origin],
      },
      attempt: 1,
    });
    browsers.push(browser);
    await browser.open(origin);
    const matches = await browser.findMatches({
      kind: "accessible",
      label: "Probe",
      role: "button",
    });

    await expect(browser.click(matches[0]!)).rejects.toMatchObject({ code: "policy_blocked" });
    expect(requests).toBe(0);
  });

  it("reports policy violations triggered while replay is waiting", async () => {
    let mutations = 0;
    const origin = await fixture(
      "<!doctype html><script>setTimeout(() => fetch('/mutate', { method: 'POST' }), 300)</script>",
    );
    servers.at(-1)!.on("request", (request) => {
      if (request.url === "/mutate" && request.method === "POST") mutations += 1;
    });
    const browser = await createPlaywrightDiscoveryReplayBrowserFactory().create({
      policy: { mode: "safe", allowedOrigins: [origin] },
      attempt: 1,
    });
    browsers.push(browser);
    await browser.open(origin);

    await expect(browser.wait(500)).rejects.toMatchObject({ code: "policy_blocked" });
    expect(mutations).toBe(0);
  });

  it("starts every replay attempt in a fresh browser context", async () => {
    const origin = await fixture(
      "<!doctype html><h1 id='count'></h1><script>localStorage.count = String(Number(localStorage.count || 0) + 1); document.querySelector('#count').textContent = localStorage.count</script>",
    );
    const factory = createPlaywrightDiscoveryReplayBrowserFactory();
    const first = await factory.create({
      policy: { mode: "safe", allowedOrigins: [origin] },
      attempt: 1,
    });
    const second = await factory.create({
      policy: { mode: "safe", allowedOrigins: [origin] },
      attempt: 2,
    });
    browsers.push(first, second);
    await first.open(origin);
    await second.open(origin);

    await expect(
      first.assertVisible({ kind: "visible-state", condition: "1", role: "heading" }),
    ).resolves.toBeUndefined();
    await expect(
      second.assertVisible({ kind: "visible-state", condition: "1", role: "heading" }),
    ).resolves.toBeUndefined();
  });

  it("supports the discovery target occurrence boundary", async () => {
    const origin = await fixture(
      `<!doctype html>${Array.from({ length: 100 }, () => "<button>Choice</button>").join("")}`,
    );
    const browser = await createPlaywrightDiscoveryReplayBrowserFactory().create({
      policy: { mode: "safe", allowedOrigins: [origin] },
      attempt: 1,
    });
    browsers.push(browser);
    await browser.open(origin);

    await expect(
      browser.findMatches({ kind: "accessible", label: "Choice", role: "button" }),
    ).resolves.toHaveLength(100);
  });

  it("resolves structural position after promoted insertion and label changes", async () => {
    const origin = await fixture(`<!doctype html>
      <ul aria-label="Vehicle results">
        <li>Sponsored <a href="/sponsored">Sponsored vehicle</a></li>
        <li><a href="/next">Renamed first vehicle</a></li>
        <li><a href="/other">Renamed second vehicle</a></li>
      </ul>`);
    const browser = await createPlaywrightDiscoveryReplayBrowserFactory().create({
      policy: { mode: "safe", allowedOrigins: [origin] },
      attempt: 1,
    });
    browsers.push(browser);
    await browser.open(origin);

    const matches = await browser.findMatches({
      kind: "accessible",
      label: "2026 Kia Sorento A",
      role: "link",
      structure: {
        container: { role: "list", label: "Vehicle results", occurrence: 1 },
        item: {
          role: "listitem",
          position: 1,
          promotion: "exclude-marked-promoted",
        },
      },
    });

    expect(matches).toHaveLength(1);
    await browser.click(matches[0]!);
    await browser.waitForSettled();
    await expect(browser.inspectPage()).resolves.toEqual({ url: `${origin}/next` });
  });

  it("does not fall back to a stale label when structural context is unavailable", async () => {
    const origin = await fixture(`<!doctype html>
      <a href="/next">2026 Kia Sorento A</a>
      <ul aria-label="Other results"><li><a href="/other">Other vehicle</a></li></ul>`);
    const browser = await createPlaywrightDiscoveryReplayBrowserFactory().create({
      policy: { mode: "safe", allowedOrigins: [origin] },
      attempt: 1,
    });
    browsers.push(browser);
    await browser.open(origin);

    await expect(
      browser.findMatches({
        kind: "accessible",
        label: "2026 Kia Sorento A",
        role: "link",
        structure: {
          container: { role: "list", label: "Vehicle results", occurrence: 1 },
          item: {
            role: "listitem",
            position: 1,
            promotion: "exclude-marked-promoted",
          },
        },
      }),
    ).resolves.toEqual([]);
  });

  it("fails boundedly for missing structural positions and ambiguous descendants", async () => {
    const origin = await fixture(`<!doctype html>
      <ul aria-label="Vehicle results"><li><a href="/one">One</a><a href="/two">Two</a></li></ul>`);
    const browser = await createPlaywrightDiscoveryReplayBrowserFactory().create({
      policy: { mode: "safe", allowedOrigins: [origin] },
      attempt: 1,
    });
    browsers.push(browser);
    await browser.open(origin);
    const target = {
      kind: "accessible" as const,
      label: "Stale",
      role: "link",
      structure: {
        container: { role: "list" as const, label: "Vehicle results", occurrence: 1 },
        item: { role: "listitem" as const, position: 1 },
      },
    };

    await expect(browser.findMatches(target)).resolves.toHaveLength(2);
    target.structure.item.position = 2;
    await expect(browser.findMatches(target)).resolves.toEqual([]);
  });

  it("ignores items owned by nested repeated containers", async () => {
    const origin = await fixture(`<!doctype html>
      <ul aria-label="Vehicle results">
        <li><a href="/first">First outer</a></li>
        <li><ul aria-label="Nested"><li><a href="/nested">Nested result</a></li></ul></li>
        <li><a href="/target">Target outer</a></li>
      </ul>`);
    const browser = await createPlaywrightDiscoveryReplayBrowserFactory().create({
      policy: { mode: "safe", allowedOrigins: [origin] },
      attempt: 1,
    });
    browsers.push(browser);
    await browser.open(origin);

    const matches = await browser.findMatches({
      kind: "accessible",
      label: "Old target",
      role: "link",
      structure: {
        container: { role: "list", label: "Vehicle results", occurrence: 1 },
        item: { role: "listitem", position: 3 },
      },
    });
    expect(matches).toHaveLength(1);
    await browser.click(matches[0]!);
    await browser.waitForSettled();
    await expect(browser.inspectPage()).resolves.toEqual({ url: `${origin}/target` });
  });

  it("rejects unbounded factory options", () => {
    expect(() =>
      createPlaywrightDiscoveryReplayBrowserFactory({ actionTimeoutMs: 0 }),
    ).toThrowError(DiscoveryReplayBrowserError);
    expect(() =>
      createPlaywrightDiscoveryReplayBrowserFactory({ stabilityDurationMs: 60_001 }),
    ).toThrowError(DiscoveryReplayBrowserError);
    expect(() =>
      createPlaywrightDiscoveryReplayBrowserFactory({ viewport: { width: 0, height: 720 } }),
    ).toThrowError(DiscoveryReplayBrowserError);
  });
});
