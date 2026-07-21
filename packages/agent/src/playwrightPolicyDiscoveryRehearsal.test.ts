/// <reference lib="dom" />

import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DiscoveryPolicyControllerError,
  createPolicyEnforcedPlaywrightDiscoveryRehearsalController,
} from "./playwrightPolicyDiscoveryRehearsal.js";
import type {
  DiscoveryRehearsalActionInput,
  DiscoveryRehearsalResult,
} from "./discoveryRehearsal.js";

let browser: Browser;
let context: BrowserContext;
let page: Page;
let mutationCount: number;
let otherOriginMutationCount: number;
let slowNavigationStarted: Promise<void>;
let releaseSlowNavigation: () => void;
let markSlowNavigationStarted: () => void;
let slowNavigationRelease: Promise<void>;

beforeEach(async () => {
  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  page = await context.newPage();
  mutationCount = 0;
  otherOriginMutationCount = 0;
  let markStarted!: () => void;
  let finishSlowNavigation!: () => void;
  slowNavigationStarted = new Promise((resolve) => {
    markStarted = resolve;
  });
  markSlowNavigationStarted = markStarted;
  slowNavigationRelease = new Promise<void>((resolve) => {
    finishSlowNavigation = resolve;
  });
  releaseSlowNavigation = finishSlowNavigation;
  await page.route("https://example.test/**", hostRoute);
  await page.route("https://other.test/**", async (route) => {
    if (route.request().method() === "POST") otherOriginMutationCount += 1;
    await route.fulfill({ status: 204, body: "" });
  });
  await page.goto("https://example.test/start");
});

afterEach(async () => {
  await context.close();
  await browser.close();
});

async function hostRoute(route: Route) {
  const request = route.request();
  if (new URL(request.url()).pathname === "/download") {
    await route.fulfill({
      status: 200,
      contentType: "text/plain",
      headers: { "content-disposition": 'attachment; filename="private-report.txt"' },
      body: "report",
    });
    return;
  }
  if (new URL(request.url()).pathname === "/slow-page") {
    markSlowNavigationStarted();
    await slowNavigationRelease;
  }
  if (request.method() === "POST") {
    mutationCount += 1;
    await route.fulfill({ status: 204, body: "" });
    return;
  }
  await route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `
      <title>Discovery policy fixture</title>
      <label>Name <input /></label>
      <label>Password <input type="password" autocomplete="current-password" /></label>
      <label>Card number <input autocomplete="cc-number" /></label>
      <label>Receipt <input type="file" /></label>
      <label>Condition
        <select onpointerdown="this.dataset.pointerFocused='true'">
          <option>Any</option>
          <option>New</option>
        </select>
      </label>
      <button onclick="document.querySelector('output').textContent='Previewed'">Preview</button>
      <button onclick="fetch('/mutate?view=request-value', { method: 'POST', body: 'private-body-value', headers: { 'x-private': 'private-header-value' } }).then(() => { document.querySelector('output').textContent='Saved' }).catch(() => undefined)">Check availability</button>
      <form onsubmit="event.preventDefault(); fetch('/mutate', { method: 'POST' }).then(() => { document.querySelector('output').textContent='Saved' })">
        <button type="submit">Save</button>
      </form>
      <button onclick="fetch('https://other.test/mutate', { method: 'POST' })">External action</button>
      <button onclick="const link = document.createElement('a'); link.href = '/download'; link.download = ''; link.click()">Download report</button>
      <button onclick="new WebSocket('wss://socket.example.test/private'); document.querySelector('output').textContent='Socket opened'">Open socket</button>
      <button onclick="location.href='about:blank'">Leave browser scope</button>
      <output>Idle</output>
      <script>
        document.addEventListener('pointermove', () => {
          document.body.dataset.pointerMoves = String(Number(document.body.dataset.pointerMoves || '0') + 1)
        })
      </script>
    `,
  });
}

const SESSION_INPUT = {
  id: "session-1",
  target: { kind: "browser" as const, startUrl: "https://example.test/start" },
  goal: "Explore the fixture",
  host: { name: "codex", version: "1.0.0" },
};

const EXCLUSIVE_NETWORK = { chromiumNetworkInstrumentation: "exclusive" as const };

const click = (targetId: string): DiscoveryRehearsalActionInput => ({
  action: { kind: "click", targetId },
  expectations: [],
  confidence: { level: "high", bases: ["exact-accessible-target"] },
});

const type = (targetId: string): DiscoveryRehearsalActionInput => ({
  action: { kind: "type", targetId, inputBinding: "demo-value", valueClass: "demo-data" },
  expectations: [],
  confidence: { level: "high", bases: ["exact-accessible-target"] },
});

const select = (targetId: string, optionLabel: string): DiscoveryRehearsalActionInput => ({
  action: { kind: "select", targetId, optionLabel },
  expectations: [],
  confidence: { level: "high", bases: ["exact-accessible-target"] },
});

function targetId(result: DiscoveryRehearsalResult, label: string): string {
  if (!result.ok || result.observation === undefined) throw new Error("observation missing");
  const id = result.observation.interactiveTargets.find((target) => target.label === label)?.id;
  if (id === undefined) throw new Error(`target missing: ${label}`);
  return id;
}

describe("createPolicyEnforcedPlaywrightDiscoveryRehearsalController", () => {
  it("moves the pointer before clicking and focusing native selects", async () => {
    const controller = await createPolicyEnforcedPlaywrightDiscoveryRehearsalController(page, {
      ...EXCLUSIVE_NETWORK,
      policy: { mode: "safe", allowedOrigins: ["https://example.test"] },
      inputResolver: {
        async resolve() {
          return { ok: true as const, value: "Demo Person" };
        },
      },
    });
    const started = await controller.start(SESSION_INPUT);

    const previewed = await controller.perform(click(targetId(started, "Preview")));
    const selected = await controller.perform(select(targetId(previewed, "Condition"), "New"));

    expect(selected).toMatchObject({ ok: true, attempt: { status: "succeeded" } });
    expect(Number(await page.locator("body").getAttribute("data-pointer-moves"))).toBeGreaterThan(
      2,
    );
    expect(await page.getByLabel("Condition").getAttribute("data-pointer-focused")).toBe("true");
    expect(await page.getByLabel("Condition").inputValue()).toBe("New");
    await controller.dispose();
  });

  it("allows ordinary safe interactions and blocks destructive actions", async () => {
    const controller = await createPolicyEnforcedPlaywrightDiscoveryRehearsalController(page, {
      ...EXCLUSIVE_NETWORK,
      policy: { mode: "safe", allowedOrigins: ["https://example.test"] },
      inputResolver: {
        async resolve() {
          return { ok: true as const, value: "Demo Person" };
        },
      },
    });
    const started = await controller.start(SESSION_INPUT);

    const previewed = await controller.perform(click(targetId(started, "Preview")));
    expect(previewed).toMatchObject({ ok: true, attempt: { status: "succeeded" } });
    expect(await page.locator("output").textContent()).toBe("Previewed");

    const blocked = await controller.perform(click(targetId(previewed, "Save")));
    expect(blocked).toMatchObject({
      ok: true,
      attempt: { status: "blocked", outcome: { code: "destructive_action_blocked" } },
    });
    expect(mutationCount).toBe(0);
    expect(JSON.stringify(blocked)).not.toContain('"mode":"safe"');
    await controller.dispose();
  });

  it("allows scoped disposable mutations and fails out-of-scope mutations", async () => {
    const controller = await createPolicyEnforcedPlaywrightDiscoveryRehearsalController(page, {
      ...EXCLUSIVE_NETWORK,
      policy: {
        mode: "disposable",
        acknowledgement: "environment-is-disposable",
        allowedOrigins: ["https://example.test"],
      },
      inputResolver: {
        async resolve() {
          return { ok: true as const, value: "Demo Person" };
        },
      },
    });
    const started = await controller.start(SESSION_INPUT);

    const submitted = await controller.perform(click(targetId(started, "Save")));
    expect(submitted).toMatchObject({ ok: true, attempt: { status: "succeeded" } });
    expect(mutationCount).toBe(1);

    const escaped = await controller.perform(click(targetId(submitted, "External action")));
    expect(escaped).toMatchObject({
      ok: true,
      attempt: { status: "failed", outcome: { code: "network_request_blocked" } },
    });
    expect(otherOriginMutationCount).toBe(0);
    await controller.dispose();
  });

  it("allows a public search action and its same-origin background request", async () => {
    const controller = await createPolicyEnforcedPlaywrightDiscoveryRehearsalController(page, {
      ...EXCLUSIVE_NETWORK,
      policy: { mode: "public-browse", allowedOrigins: ["https://example.test"] },
      inputResolver: {
        async resolve() {
          return { ok: true as const, value: "Demo" };
        },
      },
    });
    const started = await controller.start(SESSION_INPUT);

    const searched = await controller.perform(click(targetId(started, "Check availability")));

    expect(searched).toMatchObject({ ok: true, attempt: { status: "succeeded" } });
    expect(mutationCount).toBe(1);
    expect(await page.locator("output").textContent()).toBe("Saved");
    await controller.dispose();
  });

  it("reports when a classified network block prevents a declared visible effect", async () => {
    const controller = await createPolicyEnforcedPlaywrightDiscoveryRehearsalController(page, {
      ...EXCLUSIVE_NETWORK,
      policy: { mode: "safe", allowedOrigins: ["https://example.test"] },
      inputResolver: {
        async resolve() {
          return { ok: true as const, value: "Demo" };
        },
      },
    });
    const started = await controller.start(SESSION_INPUT);

    const blocked = await controller.perform({
      ...click(targetId(started, "Check availability")),
      expectations: [
        {
          id: "expect-saved",
          kind: "visible-state",
          origin: "declared-before-action",
          publicCondition: "Saved",
        },
      ],
    });

    expect(blocked).toMatchObject({
      ok: true,
      attempt: { status: "failed", outcome: { code: "network_request_blocked" } },
      diagnostics: expect.arrayContaining([
        {
          code: "network_requests_blocked",
          totalBlockedRequestCount: 1,
          classifications: [
            {
              requestClass: "xhr-fetch",
              methodCategory: "potential-side-effect",
              originRelation: "same-origin",
              scope: "subresource",
              blockedRequestCount: 1,
            },
          ],
          expectedVisibleEffectPrevented: true,
        },
      ]),
    });
    expect(mutationCount).toBe(0);
    expect(JSON.stringify(blocked)).not.toMatch(
      /request-value|private-body-value|private-header-value/,
    );
    await controller.dispose();
  });

  it("does not claim a visible effect was prevented when none was declared", async () => {
    const controller = await createPolicyEnforcedPlaywrightDiscoveryRehearsalController(page, {
      ...EXCLUSIVE_NETWORK,
      policy: { mode: "safe", allowedOrigins: ["https://example.test"] },
      inputResolver: {
        async resolve() {
          return { ok: true as const, value: "Demo" };
        },
      },
    });
    const started = await controller.start(SESSION_INPUT);

    const blocked = await controller.perform(click(targetId(started, "Check availability")));

    expect(blocked).toMatchObject({
      ok: true,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: "network_requests_blocked",
          totalBlockedRequestCount: 1,
          expectedVisibleEffectPrevented: false,
        }),
      ]),
    });
    expect(mutationCount).toBe(0);
    await controller.dispose();
  });

  it("blocks credential, payment, upload, and secret-like runtime input", async () => {
    let resolutions = 0;
    let resolvedValue = "Demo Person";
    const controller = await createPolicyEnforcedPlaywrightDiscoveryRehearsalController(page, {
      ...EXCLUSIVE_NETWORK,
      policy: {
        mode: "disposable",
        acknowledgement: "environment-is-disposable",
        allowedOrigins: ["https://example.test"],
      },
      inputResolver: {
        async resolve() {
          resolutions += 1;
          return { ok: true as const, value: resolvedValue };
        },
      },
    });
    const started = await controller.start(SESSION_INPUT);

    const credential = await controller.perform(type(targetId(started, "Password")));
    expect(credential).toMatchObject({
      ok: true,
      attempt: { status: "blocked", outcome: { code: "credential_action_blocked" } },
    });
    const payment = await controller.perform(type(targetId(started, "Card number")));
    expect(payment).toMatchObject({
      ok: true,
      attempt: { status: "blocked", outcome: { code: "sensitive_input_blocked" } },
    });
    const upload = await controller.perform(click(targetId(started, "Receipt")));
    expect(upload).toMatchObject({
      ok: true,
      attempt: { status: "blocked", outcome: { code: "upload_blocked" } },
    });
    expect(resolutions).toBe(0);

    resolvedValue = "sk-example123456789";
    const secret = await controller.perform(type(targetId(started, "Name")));
    expect(secret).toMatchObject({
      ok: true,
      attempt: { status: "failed", outcome: { code: "sensitive_input_blocked" } },
    });
    expect(resolutions).toBe(1);
    expect(await page.getByRole("textbox", { name: "Name" }).inputValue()).toBe("");
    expect(JSON.stringify(secret)).not.toContain(resolvedValue);
    await controller.dispose();
  });

  it("records controller-level download and WebSocket violations", async () => {
    const controller = await createPolicyEnforcedPlaywrightDiscoveryRehearsalController(page, {
      ...EXCLUSIVE_NETWORK,
      policy: { mode: "safe", allowedOrigins: ["https://example.test"] },
      inputResolver: {
        async resolve() {
          return { ok: true as const, value: "Demo" };
        },
      },
    });
    const started = await controller.start(SESSION_INPUT);

    const download = await controller.perform(click(targetId(started, "Download report")));
    expect(download).toMatchObject({
      ok: true,
      attempt: { status: "failed", outcome: { code: "download_blocked" } },
    });
    expect(JSON.stringify(download)).not.toContain("private-report.txt");

    const webSocket = await controller.perform(click(targetId(download, "Open socket")));
    expect(webSocket).toMatchObject({
      ok: true,
      attempt: { status: "failed", outcome: { code: "websocket_blocked" } },
    });
    await controller.dispose();
  });

  it("does not install Auto Demo WebSocket enforcement for yolo rehearsal", async () => {
    const controller = await createPolicyEnforcedPlaywrightDiscoveryRehearsalController(page, {
      ...EXCLUSIVE_NETWORK,
      policy: { mode: "yolo" },
      inputResolver: {
        async resolve() {
          return { ok: true as const, value: "Demo" };
        },
      },
    });
    const started = await controller.start(SESSION_INPUT);
    expect(started).toMatchObject({ ok: true });

    const socket = await controller.perform(click(targetId(started, "Open socket")));

    expect(socket).toMatchObject({ ok: true, attempt: { status: "succeeded" } });
    await controller.dispose();
    await controller.dispose();
    expect(page.isClosed()).toBe(false);
  });

  it("fails and restores a click-triggered non-network navigation", async () => {
    const controller = await createPolicyEnforcedPlaywrightDiscoveryRehearsalController(page, {
      ...EXCLUSIVE_NETWORK,
      policy: { mode: "safe", allowedOrigins: ["https://example.test"] },
      inputResolver: {
        async resolve() {
          return { ok: true as const, value: "Demo" };
        },
      },
    });
    const started = await controller.start(SESSION_INPUT);

    const escaped = await controller.perform(click(targetId(started, "Leave browser scope")));

    expect(escaped).toMatchObject({
      ok: true,
      attempt: { status: "failed", outcome: { code: "unsafe_navigation_blocked" } },
    });
    expect(page.url()).toBe("https://example.test/");
    await controller.dispose();
  });

  it("rejects invalid scope before creating a controller", async () => {
    await expect(
      createPolicyEnforcedPlaywrightDiscoveryRehearsalController(page, {
        ...EXCLUSIVE_NETWORK,
        policy: { mode: "safe", allowedOrigins: ["https://other.test"] },
        inputResolver: {
          async resolve() {
            return { ok: true as const, value: "Demo" };
          },
        },
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<DiscoveryPolicyControllerError>>({
        code: "origin_not_allowed",
      }),
    );
  });

  it("revalidates page scope at start before recording a session", async () => {
    const controller = await createPolicyEnforcedPlaywrightDiscoveryRehearsalController(page, {
      ...EXCLUSIVE_NETWORK,
      policy: { mode: "safe", allowedOrigins: ["https://example.test"] },
      inputResolver: {
        async resolve() {
          return { ok: true as const, value: "Demo" };
        },
      },
    });
    await page.goto("about:blank");

    expect(await controller.start(SESSION_INPUT)).toMatchObject({
      ok: false,
      errors: [{ code: "origin_not_allowed" }],
    });
    expect(controller.getSession()).toBeUndefined();
    await controller.dispose();
  });

  it("waits for an in-flight action before removing policy enforcement", async () => {
    const controller = await createPolicyEnforcedPlaywrightDiscoveryRehearsalController(page, {
      ...EXCLUSIVE_NETWORK,
      policy: { mode: "safe", allowedOrigins: ["https://example.test"] },
      inputResolver: {
        async resolve() {
          return { ok: true as const, value: "Demo" };
        },
      },
    });
    await controller.start(SESSION_INPUT);
    const performing = controller.perform({
      action: { kind: "navigate", url: "https://example.test/slow-page" },
      expectations: [],
      confidence: { level: "high", bases: ["exact-accessible-target"] },
    });
    await slowNavigationStarted;

    let disposalFinished = false;
    const disposing = controller.dispose().then(() => {
      disposalFinished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(disposalFinished).toBe(false);
    releaseSlowNavigation();
    await performing;
    await disposing;
  });

  it("cleans removable guards at stop and leaves the host page open", async () => {
    const controller = await createPolicyEnforcedPlaywrightDiscoveryRehearsalController(page, {
      ...EXCLUSIVE_NETWORK,
      policy: { mode: "safe", allowedOrigins: ["https://example.test"] },
      inputResolver: {
        async resolve() {
          return { ok: true as const, value: "Demo" };
        },
      },
    });
    await controller.start(SESSION_INPUT);
    const stopped = await controller.stop({
      outcome: "abandon",
      reason: { code: "done", summary: "Done." },
    });
    expect(stopped).toMatchObject({ ok: true, session: { status: "abandoned" } });
    expect(page.isClosed()).toBe(false);

    await page.evaluate(() => fetch("/after-stop", { method: "POST" }));
    expect(mutationCount).toBe(1);
  });

  it("disposes idempotently and rejects later operations", async () => {
    const controller = await createPolicyEnforcedPlaywrightDiscoveryRehearsalController(page, {
      ...EXCLUSIVE_NETWORK,
      policy: { mode: "safe", allowedOrigins: ["https://example.test"] },
      inputResolver: {
        async resolve() {
          return { ok: true as const, value: "Demo" };
        },
      },
    });
    await controller.dispose();
    await controller.dispose();

    expect(await controller.start(SESSION_INPUT)).toMatchObject({
      ok: false,
      errors: [{ code: "discovery_policy_controller_disposed" }],
    });
    expect(page.isClosed()).toBe(false);
  });
});
