import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { DiscoveryReplayBrowserError } from "./discoveryReplay.js";
import { createPlaywrightDiscoveryReplayBrowserFactory } from "./playwrightDiscoveryReplay.js";

const servers: Server[] = [];
const browsers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(browsers.splice(0).map((browser) => browser.close()));
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

async function fixture(html: string): Promise<string> {
  const server = createServer((request, response) => {
    if (request.url === "/next") {
      response.end("<!doctype html><h1>Finished</h1>");
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
      browser.assertVisible({ kind: "visible-state", condition: "Finished", role: "heading" }),
    ).resolves.toBeUndefined();
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

  it("starts every replay attempt in a fresh browser context", async () => {
    const origin = await fixture("<!doctype html><script>localStorage.count = String(Number(localStorage.count || 0) + 1)</script>");
    const factory = createPlaywrightDiscoveryReplayBrowserFactory();
    const first = await factory.create({ policy: { mode: "safe", allowedOrigins: [origin] }, attempt: 1 });
    const second = await factory.create({ policy: { mode: "safe", allowedOrigins: [origin] }, attempt: 2 });
    browsers.push(first, second);
    await first.open(origin);
    await second.open(origin);

    await expect(first.assertVisible({ kind: "visible-state", condition: "missing" })).rejects.toMatchObject({ code: "visible_state_mismatch" });
    await expect(second.inspectPage()).resolves.toEqual({ url: `${origin}/` });
  });
});
