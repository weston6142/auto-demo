/// <reference lib="dom" />

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authorizeDiscoveryPolicyAction,
  validateDiscoveryPolicy,
  type DiscoveryPolicy,
  type DiscoveryPolicyPermit,
  type ValidatedDiscoveryPolicy,
} from "./discoveryPolicy.js";
import { installPlaywrightDiscoveryPolicyGuard } from "./playwrightDiscoveryPolicyGuard.js";

let browser: Browser;
let context: BrowserContext;
let page: Page;
let mutationCount: number;
let otherOriginRequestCount: number;
let hostRequestUrls: string[];

beforeEach(async () => {
  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  page = await context.newPage();
  mutationCount = 0;
  otherOriginRequestCount = 0;
  hostRequestUrls = [];
  await page.route("https://example.test/**", hostRoute);
  await page.route("https://other.test/**", async (route) => {
    otherOriginRequestCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, PROPFIND, OPTIONS",
      },
      body: "escaped",
    });
  });
  await page.goto("https://example.test/start");
});

afterEach(async () => {
  await context.close();
  await browser.close();
});

async function hostRoute(route: Route) {
  const request = route.request();
  hostRequestUrls.push(request.url());
  const path = new URL(request.url()).pathname;
  if (path === "/download") {
    await route.fulfill({
      status: 200,
      contentType: "text/plain",
      headers: { "content-disposition": 'attachment; filename="secret-name.txt"' },
      body: "download body",
    });
    return;
  }
  if (path === "/redirect-out") {
    await route.fulfill({ status: 302, headers: { location: "https://other.test/escaped" } });
    return;
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
    mutationCount += 1;
    await route.fulfill({ status: 204, body: "" });
    return;
  }
  await route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `
      <title>Host route</title>
      <a href="/download" download>Download</a>
      <a href="https://other.test/popup" target="_blank">Popup</a>
      <h1>${path}</h1>
    `,
  });
}

function validatedPolicy(input: DiscoveryPolicy): ValidatedDiscoveryPolicy {
  const result = validateDiscoveryPolicy(input, page.url());
  if (!result.ok) throw new Error("policy fixture must validate");
  return result.policy;
}

function permit(policy: ValidatedDiscoveryPolicy): DiscoveryPolicyPermit {
  const result = authorizeDiscoveryPolicyAction({
    policy,
    observationUrl: page.url(),
    action: { kind: "inspect" },
  });
  if (result.decision !== "allow") throw new Error("permit fixture must be allowed");
  return result.permit;
}

describe("installPlaywrightDiscoveryPolicyGuard", () => {
  it("retains and consumes an idle policy violation exactly once", async () => {
    const policy = validatedPolicy({ mode: "safe", allowedOrigins: ["https://example.test"] });
    const guard = await installPlaywrightDiscoveryPolicyGuard(page, policy);

    await page.evaluate(() => fetch("/mutate", { method: "POST" }).catch(() => undefined));
    await page.waitForTimeout(50);

    expect(guard.checkForViolation()).toEqual({
      code: "network_request_blocked",
      summary: "Discovery blocked classified network activity.",
      blockedNetworkEvidence: {
        classifications: [
          {
            requestClass: "xhr-fetch",
            methodCategory: "potential-side-effect",
            originRelation: "same-origin",
            scope: "subresource",
            blockedRequestCount: 1,
          },
        ],
        totalBlockedRequestCount: 1,
      },
    });
    expect(guard.checkForViolation()).toBeUndefined();
    expect(mutationCount).toBe(0);
    await guard.dispose();
  });

  it("blocks and classifies potential network side effects in safe mode", async () => {
    const policy = validatedPolicy({ mode: "safe", allowedOrigins: ["https://example.test"] });
    const guard = await installPlaywrightDiscoveryPolicyGuard(page, policy);
    guard.arm(permit(policy));

    await page.evaluate(() => fetch("/mutate", { method: "POST" }).catch(() => undefined));

    expect(await guard.finishAction()).toEqual({
      code: "network_request_blocked",
      summary: "Discovery blocked classified network activity.",
      blockedNetworkEvidence: {
        classifications: [
          {
            requestClass: "xhr-fetch",
            methodCategory: "potential-side-effect",
            originRelation: "same-origin",
            scope: "subresource",
            blockedRequestCount: 1,
          },
        ],
        totalBlockedRequestCount: 1,
      },
    });
    expect(mutationCount).toBe(0);
    await guard.dispose();
  });

  it.each(["PUT", "PATCH", "DELETE"])("blocks %s requests in safe mode", async (method) => {
    const policy = validatedPolicy({ mode: "safe", allowedOrigins: ["https://example.test"] });
    const guard = await installPlaywrightDiscoveryPolicyGuard(page, policy);
    guard.arm(permit(policy));

    await page.evaluate((requestMethod) => {
      return fetch("/mutate", { method: requestMethod }).catch(() => undefined);
    }, method);

    expect(await guard.finishAction()).toMatchObject({
      code: "network_request_blocked",
      blockedNetworkEvidence: {
        classifications: [{ methodCategory: "potential-side-effect" }],
      },
    });
    expect(mutationCount).toBe(0);
    await guard.dispose();
  });

  it("bypasses service workers so their mutations still reach enforcement", async () => {
    let serverMutationCount = 0;
    const server = createServer((request, response) => {
      if (request.url === "/sw.js") {
        response.writeHead(200, { "content-type": "application/javascript" });
        response.end(`self.addEventListener("fetch", event => {
          if (new URL(event.request.url).pathname === "/sw-mutate") {
            event.respondWith(new Response("handled by worker"));
          }
        });`);
        return;
      }
      if (request.method === "POST") serverMutationCount += 1;
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<title>Service worker fixture</title>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      await page.goto(origin);
      await page.evaluate(async () => {
        await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
      });
      await page.reload();
      expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
      const policy = validatedPolicy({ mode: "safe", allowedOrigins: [origin] });
      const guard = await installPlaywrightDiscoveryPolicyGuard(page, policy);
      guard.arm(permit(policy));

      await page.evaluate(() => fetch("/sw-mutate", { method: "POST" }).catch(() => undefined));

      expect(await guard.finishAction()).toMatchObject({ code: "network_request_blocked" });
      expect(serverMutationCount).toBe(0);
      await guard.dispose();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error))),
      );
    }
  });

  it("allows scoped mutations only with an active disposable permit", async () => {
    const policy = validatedPolicy({
      mode: "disposable",
      acknowledgement: "environment-is-disposable",
      allowedOrigins: ["https://example.test"],
    });
    const guard = await installPlaywrightDiscoveryPolicyGuard(page, policy);
    guard.arm(permit(policy));

    await page.evaluate(() => fetch("/mutate", { method: "POST" }));

    expect(await guard.finishAction()).toBeUndefined();
    expect(mutationCount).toBe(1);

    await page.evaluate(() => fetch("/background", { method: "POST" }).catch(() => undefined));
    expect(mutationCount).toBe(1);
    await guard.dispose();
  });

  it("allows classified public-browse background traffic without a disposable permit", async () => {
    const policy = validatedPolicy({
      mode: "public-browse",
      allowedOrigins: ["https://example.test"],
    });
    const guard = await installPlaywrightDiscoveryPolicyGuard(page, policy);
    guard.arm(permit(policy));

    await page.evaluate(async () => {
      await fetch("/search", { method: "POST" }).catch(() => undefined);
      navigator.sendBeacon("https://other.test/analytics", "bounded-public-event");
    });

    expect(await guard.finishAction()).toBeUndefined();
    expect(mutationCount).toBe(1);
    expect(otherOriginRequestCount).toBe(1);

    await page.evaluate(() => fetch("/background", { method: "POST" }));
    await page.waitForTimeout(50);
    expect(guard.checkForViolation()).toBeUndefined();
    expect(mutationCount).toBe(2);
    await guard.dispose();
  });

  it("blocks cross-origin XHR and unknown methods in public-browse mode", async () => {
    const policy = validatedPolicy({
      mode: "public-browse",
      allowedOrigins: ["https://example.test", "https://other.test"],
    });
    const guard = await installPlaywrightDiscoveryPolicyGuard(page, policy);
    guard.arm(permit(policy));

    await page.evaluate(async () => {
      await Promise.all([
        fetch("https://other.test/search", { method: "POST" }).catch(() => undefined),
        fetch("/unknown", { method: "PROPFIND" }).catch(() => undefined),
      ]);
    });

    expect(await guard.finishAction()).toMatchObject({
      code: "network_request_blocked",
      blockedNetworkEvidence: {
        totalBlockedRequestCount: 2,
        classifications: expect.arrayContaining([
          expect.objectContaining({
            requestClass: "xhr-fetch",
            methodCategory: "potential-side-effect",
            originRelation: "cross-origin",
          }),
          expect.objectContaining({
            requestClass: "xhr-fetch",
            methodCategory: "other",
            originRelation: "same-origin",
          }),
        ]),
      },
    });
    expect(mutationCount).toBe(0);
    expect(otherOriginRequestCount).toBe(0);
    await guard.dispose();
  });

  it("fails closed for unknown methods in disposable mode", async () => {
    const policy = validatedPolicy({
      mode: "disposable",
      acknowledgement: "environment-is-disposable",
      allowedOrigins: ["https://example.test"],
    });
    const guard = await installPlaywrightDiscoveryPolicyGuard(page, policy);
    guard.arm(permit(policy));

    await page.evaluate(() => fetch("/unknown", { method: "PROPFIND" }).catch(() => undefined));

    expect(await guard.finishAction()).toMatchObject({
      code: "network_request_blocked",
      blockedNetworkEvidence: {
        classifications: [
          {
            requestClass: "xhr-fetch",
            methodCategory: "other",
            originRelation: "same-origin",
            scope: "subresource",
            blockedRequestCount: 1,
          },
        ],
      },
    });
    expect(mutationCount).toBe(0);
    await guard.dispose();
  });

  it("classifies beacon and top-level document requests", async () => {
    const policy = validatedPolicy({ mode: "safe", allowedOrigins: ["https://example.test"] });
    const guard = await installPlaywrightDiscoveryPolicyGuard(page, policy);
    guard.arm(permit(policy));

    await page.evaluate(() => navigator.sendBeacon("/beacon", "private-beacon-body"));
    await page.evaluate(() => {
      const form = document.createElement("form");
      form.method = "POST";
      form.action = "/form-submit";
      document.body.append(form);
      form.submit();
    });

    const violation = await guard.finishAction();
    expect(violation).toMatchObject({
      code: "network_request_blocked",
      blockedNetworkEvidence: {
        totalBlockedRequestCount: 2,
        classifications: expect.arrayContaining([
          {
            requestClass: "beacon",
            methodCategory: "potential-side-effect",
            originRelation: "same-origin",
            scope: "subresource",
            blockedRequestCount: 1,
          },
          {
            requestClass: "document-navigation",
            methodCategory: "potential-side-effect",
            originRelation: "same-origin",
            scope: "top-level",
            blockedRequestCount: 1,
          },
        ]),
      },
    });
    expect(JSON.stringify(violation)).not.toContain("private-beacon-body");
    expect(mutationCount).toBe(0);
    await guard.dispose();
  });

  it("aggregates repeated classifications without retaining request details", async () => {
    const policy = validatedPolicy({
      mode: "safe",
      allowedOrigins: ["https://example.test", "https://other.test"],
    });
    const guard = await installPlaywrightDiscoveryPolicyGuard(page, policy);
    guard.arm(permit(policy));

    await page.evaluate(async () => {
      await Promise.all([
        fetch("/mutate/a", { method: "POST", body: "first-body" }).catch(() => undefined),
        fetch("/mutate/b", { method: "POST", body: "second-body" }).catch(() => undefined),
        fetch("https://other.test/mutate/c", {
          method: "POST",
          body: "third-body",
        }).catch(() => undefined),
      ]);
    });

    const violation = await guard.finishAction();
    expect(violation).toMatchObject({
      code: "network_request_blocked",
      blockedNetworkEvidence: {
        totalBlockedRequestCount: 3,
        classifications: expect.arrayContaining([
          {
            requestClass: "xhr-fetch",
            methodCategory: "potential-side-effect",
            originRelation: "same-origin",
            scope: "subresource",
            blockedRequestCount: 2,
          },
          {
            requestClass: "xhr-fetch",
            methodCategory: "potential-side-effect",
            originRelation: "cross-origin",
            scope: "subresource",
            blockedRequestCount: 1,
          },
        ]),
      },
    });
    expect(JSON.stringify(violation)).not.toMatch(/first-body|second-body|third-body/);
    expect(mutationCount).toBe(0);
    expect(otherOriginRequestCount).toBe(0);
    await guard.dispose();
  });

  it("bounds distinct classified network evidence while preserving totals", async () => {
    const policy = validatedPolicy({
      mode: "safe",
      allowedOrigins: ["https://example.test", "https://other.test"],
    });
    const guard = await installPlaywrightDiscoveryPolicyGuard(page, policy);
    guard.arm(permit(policy));

    await page.evaluate(async () => {
      await fetch("/post", { method: "POST" }).catch(() => undefined);
      await fetch("https://other.test/post", { method: "POST" }).catch(() => undefined);
      await fetch("/custom", { method: "PROPFIND" }).catch(() => undefined);
      await fetch("https://other.test/custom", { method: "PROPFIND" }).catch(() => undefined);
      navigator.sendBeacon("/beacon", "same");
      navigator.sendBeacon("https://other.test/beacon", "cross");
    });
    await page.evaluate(() => {
      for (const [action, target] of [
        ["/frame-same", "policy-frame-same"],
        ["https://other.test/frame-cross", "policy-frame-cross"],
      ] as const) {
        const frame = document.createElement("iframe");
        frame.name = target;
        document.body.append(frame);
        const form = document.createElement("form");
        form.method = "POST";
        form.action = action;
        form.target = target;
        document.body.append(form);
        form.submit();
      }
      for (const action of ["/top-same", "https://other.test/top-cross"]) {
        const form = document.createElement("form");
        form.method = "POST";
        form.action = action;
        document.body.append(form);
        form.submit();
      }
    });

    const violation = await guard.finishAction();
    expect(violation).toMatchObject({
      code: "network_request_blocked",
      blockedNetworkEvidence: {
        totalBlockedRequestCount: 9,
        omittedClassificationCount: 1,
      },
    });
    expect(violation?.blockedNetworkEvidence?.classifications).toHaveLength(8);
    await guard.dispose();
  });

  it.each(["safe", "public-browse"] as const)(
    "blocks top-level navigation outside the exact origin scope in %s mode",
    async (mode) => {
      const policy = validatedPolicy({ mode, allowedOrigins: ["https://example.test"] });
      const guard = await installPlaywrightDiscoveryPolicyGuard(page, policy);
      guard.arm(permit(policy));

      await page.goto("https://other.test/escape").catch(() => undefined);

      expect(await guard.finishAction()).toEqual({
        code: "origin_not_allowed",
        summary: "Discovery blocked an origin outside the approved scope.",
      });
      expect(page.url()).toBe("https://example.test/");
      await guard.dispose();
    },
  );

  it.each(["safe", "public-browse"] as const)(
    "restores an unsafe page without retaining or replaying the prior raw URL in %s mode",
    async (mode) => {
      const secretUrl = "https://example.test/private?marker=do-not-retain-this-value#fragment";
      await page.goto(secretUrl);
      const policy = validatedPolicy({ mode, allowedOrigins: ["https://example.test"] });
      const guard = await installPlaywrightDiscoveryPolicyGuard(page, policy);
      guard.arm(permit(policy));
      hostRequestUrls = [];

      await page.goto("about:blank").catch(() => undefined);

      expect(await guard.finishAction()).toEqual({
        code: "unsafe_navigation_blocked",
        summary: "Discovery blocked unsafe navigation.",
      });
      expect(hostRequestUrls.some((url) => url.includes("do-not-retain-this-value"))).toBe(false);
      expect(page.url()).toBe("https://example.test/");
      await guard.dispose();
    },
  );

  it("blocks every redirect hop before an allowed navigation escapes scope", async () => {
    const policy = validatedPolicy({ mode: "safe", allowedOrigins: ["https://example.test"] });
    const guard = await installPlaywrightDiscoveryPolicyGuard(page, policy);
    guard.arm(permit(policy));

    await page.goto("https://example.test/redirect-out").catch(() => undefined);

    expect(await guard.finishAction()).toEqual({
      code: "origin_not_allowed",
      summary: "Discovery blocked an origin outside the approved scope.",
    });
    expect(otherOriginRequestCount).toBe(0);
    await guard.dispose();
  });

  it("reports credential-bearing subresource requests as sanitized violations", async () => {
    const policy = validatedPolicy({ mode: "safe", allowedOrigins: ["https://example.test"] });
    const guard = await installPlaywrightDiscoveryPolicyGuard(page, policy);
    guard.arm(permit(policy));

    const rawUrl = "https://example.test/private?token=do-not-record-this-value";
    await page.evaluate((url) => fetch(url).catch(() => undefined), rawUrl);

    const violation = await guard.finishAction();
    expect(violation).toEqual({
      code: "unsafe_navigation_blocked",
      summary: "Discovery blocked unsafe navigation.",
    });
    expect(JSON.stringify(violation)).not.toContain(rawUrl);
    await guard.dispose();
  });

  it("blocks a popup's first navigation request", async () => {
    const policy = validatedPolicy({ mode: "safe", allowedOrigins: ["https://example.test"] });
    const guard = await installPlaywrightDiscoveryPolicyGuard(page, policy);
    guard.arm(permit(policy));

    await page.getByRole("link", { name: "Popup" }).click();

    expect(await guard.finishAction()).toEqual({
      code: "unsafe_navigation_blocked",
      summary: "Discovery blocked unsafe navigation.",
    });
    expect(otherOriginRequestCount).toBe(0);
    await guard.dispose();
  });

  it("quarantines an about:blank popup before it can mutate through a subresource", async () => {
    const policy = validatedPolicy({ mode: "safe", allowedOrigins: ["https://example.test"] });
    const guard = await installPlaywrightDiscoveryPolicyGuard(page, policy);
    guard.arm(permit(policy));

    await page.evaluate(() => {
      const popup = window.open("about:blank");
      void popup?.fetch("/mutate", { method: "POST" }).catch(() => undefined);
    });

    expect(await guard.finishAction()).toEqual({
      code: "unsafe_navigation_blocked",
      summary: "Discovery blocked unsafe navigation.",
    });
    expect(mutationCount).toBe(0);
    await guard.dispose();
  });

  it.each(["safe", "public-browse"] as const)(
    "cancels downloads without exposing the filename in %s mode",
    async (mode) => {
      const policy = validatedPolicy({ mode, allowedOrigins: ["https://example.test"] });
      const guard = await installPlaywrightDiscoveryPolicyGuard(page, policy);
      guard.arm(permit(policy));

      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("link", { name: "Download" }).click();
      const download = await downloadPromise;

      expect(await download.failure()).toBe("canceled");
      const violation = await guard.finishAction();
      expect(violation).toEqual({
        code: "download_blocked",
        summary: "Discovery blocked a download.",
      });
      expect(JSON.stringify(violation)).not.toContain("secret-name.txt");
      await guard.dispose();
    },
  );

  it.each(["safe", "public-browse"] as const)(
    "closes WebSockets and reports a fixed violation in %s mode",
    async (mode) => {
      const policy = validatedPolicy({ mode, allowedOrigins: ["https://example.test"] });
      const guard = await installPlaywrightDiscoveryPolicyGuard(page, policy);
      guard.arm(permit(policy));

      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            const socket = new WebSocket("wss://socket.example.test/private");
            socket.addEventListener("close", () => resolve());
            socket.addEventListener("error", () => resolve());
          }),
      );

      expect(await guard.finishAction()).toEqual({
        code: "websocket_blocked",
        summary: "Discovery blocked a WebSocket connection.",
      });
      await guard.dispose();
    },
  );

  it("consumes permits once and removes only removable policy hooks", async () => {
    const policy = validatedPolicy({ mode: "safe", allowedOrigins: ["https://example.test"] });
    const actionPermit = permit(policy);
    const guard = await installPlaywrightDiscoveryPolicyGuard(page, policy);
    guard.arm(actionPermit);
    expect(await guard.finishAction()).toBeUndefined();
    expect(() => guard.arm(actionPermit)).toThrowError(/already been consumed/i);

    await guard.dispose();
    expect(page.isClosed()).toBe(false);
    await page.evaluate(() => fetch("/after-dispose", { method: "POST" }));
    expect(mutationCount).toBe(1);
    await page.goto("https://example.test/host-route-still-active");
    expect(await page.title()).toBe("Host route");
  });

  it("reports cleanup failure and can retry unfinished cleanup", async () => {
    const policy = validatedPolicy({ mode: "safe", allowedOrigins: ["https://example.test"] });
    const guard = await installPlaywrightDiscoveryPolicyGuard(page, policy);
    const originalUnroute = context.unroute.bind(context);
    let failOnce = true;
    context.unroute = async (...args) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("injected cleanup failure");
      }
      return originalUnroute(...args);
    };

    await expect(guard.dispose()).rejects.toMatchObject({ code: "policy_guard_unavailable" });
    await expect(guard.dispose()).resolves.toBeUndefined();
  });

  it("fails closed on quiescence timeout and remains cleanable", async () => {
    const sampleDownloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download" }).click();
    const sampleDownload = await sampleDownloadPromise;
    await sampleDownload.cancel();
    const prototype = Object.getPrototypeOf(sampleDownload) as {
      cancel: () => Promise<void>;
    };
    const originalCancel = prototype.cancel;
    prototype.cancel = () => new Promise<void>(() => undefined);

    const policy = validatedPolicy({ mode: "safe", allowedOrigins: ["https://example.test"] });
    const guard = await installPlaywrightDiscoveryPolicyGuard(page, policy);
    try {
      guard.arm(permit(policy));
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("link", { name: "Download" }).click();
      await downloadPromise;
      const startedAt = Date.now();

      expect(await guard.finishAction()).toEqual({
        code: "policy_guard_unavailable",
        summary: "Discovery policy enforcement is unavailable.",
      });
      expect(Date.now() - startedAt).toBeLessThan(900);
      expect(() => guard.arm(permit(policy))).toThrowError(/unavailable/i);
      await expect(guard.dispose()).resolves.toBeUndefined();
    } finally {
      prototype.cancel = originalCancel;
    }
  });

  it("rejects a context that is not isolated to the rehearsal page", async () => {
    const secondPage = await context.newPage();
    const policy = validatedPolicy({ mode: "safe", allowedOrigins: ["https://example.test"] });

    await expect(installPlaywrightDiscoveryPolicyGuard(page, policy)).rejects.toMatchObject({
      code: "policy_guard_unavailable",
    });
    await secondPage.close();
  });
});
