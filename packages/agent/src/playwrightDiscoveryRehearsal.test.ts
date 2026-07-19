/// <reference lib="dom" />

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPlaywrightDiscoveryRehearsalController } from "./index.js";

let browser: Browser;
let context: BrowserContext;
let page: Page;

beforeEach(async () => {
  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  page = await context.newPage();
});

afterEach(async () => {
  await context.close();
  await browser.close();
});

async function openHtml(html: string, path = "/") {
  await page.route("https://example.test/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/html", body: html });
  });
  await page.goto(`https://example.test${path}`);
}

function allowOptions() {
  return {
    authorizer: {
      async authorize() {
        return { decision: "allow" as const, permit: { policy: "test" as const } };
      },
    },
    inputResolver: {
      async resolve() {
        return { ok: true as const, value: "Demo Person" };
      },
    },
  };
}

describe("createPlaywrightDiscoveryRehearsalController", () => {
  it("selects vehicle-search controls and records conditional observable form effects", async () => {
    await openHtml(`
      <title>Vehicle search</title>
      <label>Condition
        <select onchange="document.querySelector('output').textContent = this.selectedOptions[0].textContent">
          <option>Any</option>
          <option>New</option>
        </select>
      </label>
      <label>Make
        <select><option>Any</option><option>Kia</option></select>
      </label>
      <label>Model
        <select><option>Any</option><option>Sorento</option></select>
      </label>
      <label>Distance
        <select onchange="document.querySelector('#zip-label').hidden = this.value !== 'Nationwide'">
          <option>50 miles</option><option>Nationwide</option>
        </select>
      </label>
      <label id="zip-label" hidden>ZIP <input /></label>
      <output>Any</output>
    `);
    const controller = createPlaywrightDiscoveryRehearsalController(page, allowOptions());
    const started = await controller.start({
      id: "session-select",
      target: { kind: "browser", startUrl: "https://example.test/" },
      goal: "Select new vehicles",
      host: { name: "codex", version: "1.0.0" },
    });
    if (!started.ok || started.observation === undefined) throw new Error("start must succeed");
    const condition = started.observation.interactiveTargets.find(
      (target) => target.label === "Condition",
    );
    if (condition === undefined) throw new Error("condition target missing");

    const selected = await controller.perform({
      action: { kind: "select", targetId: condition.id, optionLabel: "New" },
      expectations: [],
      confidence: { level: "high", bases: ["exact-accessible-target"] },
    });

    expect(selected).toMatchObject({
      ok: true,
      attempt: {
        status: "succeeded",
        derivedExpectations: expect.arrayContaining([
          expect.objectContaining({ kind: "control-state", targetId: condition.id }),
        ]),
        outcome: { code: "action_completed" },
      },
      observation: {
        interactiveTargets: expect.arrayContaining([
          expect.objectContaining({
            id: condition.id,
            form: expect.objectContaining({ selectedOption: "New" }),
          }),
        ]),
      },
    });
    let latest = selected;
    for (const [label, optionLabel] of [
      ["Make", "Kia"],
      ["Model", "Sorento"],
      ["Distance", "Nationwide"],
    ] as const) {
      if (!latest.ok || latest.observation === undefined) throw new Error("observation missing");
      const target = latest.observation.interactiveTargets.find(
        (candidate) => candidate.label === label,
      );
      if (target === undefined) throw new Error(`${label} target missing`);
      latest = await controller.perform({
        action: { kind: "select", targetId: target.id, optionLabel },
        expectations: [],
        confidence: { level: "high", bases: ["exact-accessible-target"] },
      });
      expect(latest).toMatchObject({ ok: true, attempt: { status: "succeeded" } });
    }
    expect(latest).toMatchObject({
      observation: {
        interactiveTargets: expect.arrayContaining([
          expect.objectContaining({ label: "ZIP", role: "textbox" }),
        ]),
      },
    });
  });

  it("fails a state-changing action that has no declared or observable effect", async () => {
    await openHtml("<title>No-op</title><button>Continue</button>");
    const controller = createPlaywrightDiscoveryRehearsalController(page, allowOptions());
    const started = await controller.start({
      id: "session-no-op",
      target: { kind: "browser", startUrl: "https://example.test/" },
      goal: "Continue",
      host: { name: "codex", version: "1.0.0" },
    });
    if (!started.ok || started.observation === undefined) throw new Error("start must succeed");

    const clicked = await controller.perform({
      action: { kind: "click", targetId: started.observation.interactiveTargets[0]!.id },
      expectations: [],
      confidence: { level: "high", bases: ["exact-accessible-target"] },
    });

    expect(clicked).toMatchObject({
      ok: true,
      attempt: { status: "failed", outcome: { code: "action_no_observable_effect" } },
    });
  });

  it("acts on observed opaque targets without exposing runtime input values", async () => {
    await openHtml(`
      <title>Profile</title>
      <label>Name <input /></label>
      <button onclick="document.querySelector('output').textContent = 'Saved'">Save</button>
      <output>Not saved</output>
    `);
    const controller = createPlaywrightDiscoveryRehearsalController(page, allowOptions());
    const started = await controller.start({
      id: "session-1",
      target: { kind: "browser", startUrl: "https://example.test/" },
      goal: "Save a profile",
      host: { name: "codex", version: "1.0.0" },
    });
    if (!started.ok || started.observation === undefined) throw new Error("start must succeed");
    const inputId = started.observation.interactiveTargets.find(
      (target) => target.role === "textbox",
    )?.id;
    const saveId = started.observation.interactiveTargets.find(
      (target) => target.label === "Save",
    )?.id;
    if (inputId === undefined || saveId === undefined) throw new Error("targets missing");

    await controller.perform({
      action: {
        kind: "type",
        targetId: inputId,
        inputBinding: "demo-name",
        valueClass: "demo-data",
      },
      expectations: [],
      confidence: { level: "high", bases: ["exact-accessible-target"] },
    });
    const clicked = await controller.perform({
      action: { kind: "click", targetId: saveId },
      expectations: [
        {
          id: "expect-saved",
          kind: "visible-state",
          origin: "declared-before-action",
          publicCondition: "Saved",
        },
      ],
      confidence: { level: "high", bases: ["expected-visible-state-observed"] },
    });

    expect(clicked).toMatchObject({ ok: true, attempt: { status: "succeeded" } });
    expect(JSON.stringify(clicked)).not.toContain("Demo Person");
    expect(clicked).not.toHaveProperty("capture");
    expect(clicked).not.toHaveProperty("media");
    expect(await page.locator("output").textContent()).toBe("Saved");
  });

  it("navigates, returns through known history, refreshes, and rejects old targets", async () => {
    await page.route("https://example.test/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body:
          path === "/first"
            ? "<title>First</title><button>First action</button>"
            : "<title>Second</title><h1>Second page</h1>",
      });
    });
    await page.goto("https://example.test/first");
    const controller = createPlaywrightDiscoveryRehearsalController(page, allowOptions());
    const started = await controller.start({
      id: "session-1",
      target: { kind: "browser", startUrl: "https://example.test/first" },
      goal: "Visit second and return",
      host: { name: "codex", version: "1.0.0" },
    });
    if (!started.ok || started.observation === undefined) throw new Error("start must succeed");
    const oldTarget = started.observation.interactiveTargets[0]!.id;

    const navigated = await controller.perform({
      action: { kind: "navigate", url: "https://example.test/second" },
      expectations: [
        {
          id: "expect-second",
          kind: "navigation",
          origin: "declared-before-action",
          url: "https://example.test/second",
          match: "exact-url",
        },
      ],
      confidence: { level: "high", bases: ["expected-navigation-observed"] },
    });
    expect(navigated).toMatchObject({
      ok: true,
      attempt: { status: "succeeded" },
      observation: { page: { navigation: { canGoBack: true } } },
    });

    const returned = await controller.perform({
      action: { kind: "back" },
      expectations: [
        {
          id: "expect-first",
          kind: "navigation",
          origin: "declared-before-action",
          url: "https://example.test/first",
          match: "exact-url",
        },
      ],
      confidence: { level: "high", bases: ["expected-navigation-observed"] },
    });
    expect(returned).toMatchObject({
      ok: true,
      attempt: { status: "succeeded" },
      observation: { page: { url: "https://example.test/first" } },
    });

    const stale = await controller.perform({
      action: { kind: "click", targetId: oldTarget },
      expectations: [],
      confidence: { level: "medium", bases: ["exact-accessible-target"] },
    });
    expect(stale).toMatchObject({
      ok: false,
      errors: [{ code: "missing_discovery_reference", path: "action.targetId" }],
    });
    const refreshed = await controller.perform({
      action: { kind: "refresh" },
      expectations: [],
      confidence: { level: "high", bases: ["host-inference"] },
    });
    expect(refreshed).toMatchObject({ ok: true, attempt: { status: "succeeded" } });
  });

  it("rejects a removed target without acting on its replacement", async () => {
    await openHtml(`
      <title>Replacement</title>
      <button id="action" onclick="output.textContent='original'">Continue</button>
      <output id="output"></output>
    `);
    const controller = createPlaywrightDiscoveryRehearsalController(page, allowOptions());
    const started = await controller.start({
      id: "session-1",
      target: { kind: "browser", startUrl: "https://example.test/" },
      goal: "Avoid stale controls",
      host: { name: "codex", version: "1.0.0" },
    });
    if (!started.ok || started.observation === undefined) throw new Error("start must succeed");
    const oldTarget = started.observation.interactiveTargets[0]!.id;
    await page.evaluate(() => {
      document.querySelector("#action")?.remove();
      const replacement = document.createElement("button");
      replacement.id = "action";
      replacement.textContent = "Continue";
      replacement.onclick = () => {
        document.querySelector("output")!.textContent = "replacement";
      };
      document.body.prepend(replacement);
    });

    const result = await controller.perform({
      action: { kind: "click", targetId: oldTarget },
      expectations: [],
      confidence: { level: "medium", bases: ["exact-accessible-target"] },
    });

    expect(result).toMatchObject({
      ok: true,
      attempt: { status: "failed", outcome: { code: "target_stale" } },
    });
    expect(await page.locator("output").textContent()).toBe("");
  });

  it("waits and inspects bounded visible evidence", async () => {
    await openHtml(
      "<title>Wait</title><div role='status' id='status'>Waiting</div><script>setTimeout(() => document.querySelector('#status').textContent = 'Ready', 10)</script>",
    );
    const controller = createPlaywrightDiscoveryRehearsalController(page, allowOptions());
    await controller.start({
      id: "session-1",
      target: { kind: "browser", startUrl: "https://example.test/" },
      goal: "Wait for ready",
      host: { name: "codex", version: "1.0.0" },
    });

    const waited = await controller.perform({
      action: { kind: "wait", durationMs: 25 },
      expectations: [
        {
          id: "expect-ready",
          kind: "visible-state",
          origin: "declared-before-action",
          publicCondition: "Ready",
        },
      ],
      confidence: { level: "high", bases: ["expected-visible-state-observed"] },
    });
    expect(waited).toMatchObject({ ok: true, attempt: { status: "succeeded" } });
    const inspected = await controller.perform({
      action: { kind: "inspect" },
      expectations: [
        {
          id: "expect-ready-again",
          kind: "visible-state",
          origin: "declared-before-action",
          publicCondition: "Ready",
        },
      ],
      confidence: { level: "high", bases: ["expected-visible-state-observed"] },
    });
    expect(inspected).toMatchObject({ ok: true, attempt: { status: "succeeded" } });
  });

  it("acts on the selected duplicate target only", async () => {
    await openHtml(
      "<title>Duplicates</title><button onclick=\"output.textContent='first'\">Continue</button><button onclick=\"output.textContent='second'\">Continue</button><output id='output'></output>",
    );
    const controller = createPlaywrightDiscoveryRehearsalController(page, allowOptions());
    const started = await controller.start({
      id: "session-1",
      target: { kind: "browser", startUrl: "https://example.test/" },
      goal: "Choose second",
      host: { name: "codex", version: "1.0.0" },
    });
    if (!started.ok || started.observation === undefined) throw new Error("start must succeed");
    const second = started.observation.interactiveTargets.find(
      (target) => target.label === "Continue" && target.occurrence === 2,
    );
    if (second === undefined) throw new Error("second target missing");

    await controller.perform({
      action: { kind: "click", targetId: second.id },
      expectations: [],
      confidence: { level: "high", bases: ["exact-accessible-target"] },
    });

    expect(await page.locator("output").textContent()).toBe("second");
  });

  it("keeps a wrong branch outside the explicitly selected successful path", async () => {
    await page.route("https://example.test/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const body =
        path === "/start"
          ? "<title>Start</title><button onclick=\"location.href='/wrong'\">Wrong</button><button onclick=\"location.href='/success'\">Success</button>"
          : path === "/wrong"
            ? "<title>Wrong</title><h1>Wrong branch</h1>"
            : "<title>Success</title><h1>Success</h1>";
      await route.fulfill({ status: 200, contentType: "text/html", body });
    });
    await page.goto("https://example.test/start");
    let nextAttempt = 1;
    const controller = createPlaywrightDiscoveryRehearsalController(page, {
      ...allowOptions(),
      attemptIdGenerator: () => `attempt-${nextAttempt++}`,
    });
    const started = await controller.start({
      id: "session-1",
      target: { kind: "browser", startUrl: "https://example.test/start" },
      goal: "Reach success",
      host: { name: "codex", version: "1.0.0" },
    });
    if (!started.ok || started.observation === undefined) throw new Error("start must succeed");
    const wrongId = started.observation.interactiveTargets.find(
      (target) => target.label === "Wrong",
    )!.id;

    const wrong = await controller.perform({
      action: { kind: "click", targetId: wrongId },
      expectations: [],
      confidence: { level: "medium", bases: ["host-inference"] },
    });
    expect(wrong).toMatchObject({ ok: true, attempt: { id: "attempt-1" } });
    const returned = await controller.perform({
      action: { kind: "back" },
      expectations: [],
      confidence: { level: "high", bases: ["host-inference"] },
    });
    if (!returned.ok || returned.observation === undefined) throw new Error("back must succeed");
    const successId = returned.observation.interactiveTargets.find(
      (target) => target.label === "Success",
    )!.id;
    const success = await controller.perform({
      action: { kind: "click", targetId: successId },
      expectations: [],
      confidence: { level: "high", bases: ["exact-accessible-target"] },
    });
    const inspected = await controller.perform({
      action: { kind: "inspect" },
      expectations: [
        {
          id: "expect-success",
          kind: "visible-state",
          origin: "declared-before-action",
          publicCondition: "Success",
        },
      ],
      confidence: { level: "high", bases: ["expected-visible-state-observed"] },
    });
    if (
      !success.ok ||
      !inspected.ok ||
      success.attempt === undefined ||
      inspected.attempt === undefined
    ) {
      throw new Error("successful branch must be recorded");
    }
    const completed = await controller.stop({
      outcome: "complete",
      attemptIds: [success.attempt.id, inspected.attempt.id],
      source: "host-agent",
    });
    expect(completed).toMatchObject({
      ok: true,
      session: {
        status: "completed",
        selectedPath: { attemptIds: ["attempt-3", "attempt-4"] },
      },
    });
    if (!completed.ok) throw new Error("completion must succeed");
    expect(completed.session.selectedPath?.attemptIds).not.toContain("attempt-1");
  });

  it("fails terminally when the host closes the page", async () => {
    await openHtml("<title>Close</title><h1>Ready</h1>");
    const controller = createPlaywrightDiscoveryRehearsalController(page, allowOptions());
    await controller.start({
      id: "session-1",
      target: { kind: "browser", startUrl: "https://example.test/" },
      goal: "Inspect",
      host: { name: "codex", version: "1.0.0" },
    });
    await page.close();

    const result = await controller.perform({
      action: { kind: "inspect" },
      expectations: [],
      confidence: { level: "high", bases: ["host-inference"] },
    });

    expect(result).toMatchObject({
      ok: true,
      session: { status: "failed", terminal: { status: "failed" } },
    });
    if (!result.ok) throw new Error("browser loss must be recorded");
    expect(result.session.attempts.some((attempt) => attempt.status === "pending")).toBe(false);
  });

  it("fails terminally when the page closes before a target liveness check", async () => {
    await openHtml("<title>Close target</title><button>Continue</button>");
    const controller = createPlaywrightDiscoveryRehearsalController(page, allowOptions());
    const started = await controller.start({
      id: "session-1",
      target: { kind: "browser", startUrl: "https://example.test/" },
      goal: "Continue",
      host: { name: "codex", version: "1.0.0" },
    });
    if (!started.ok || started.observation === undefined) throw new Error("start must succeed");
    const targetId = started.observation.interactiveTargets[0]!.id;
    await page.close();

    const result = await controller.perform({
      action: { kind: "click", targetId },
      expectations: [],
      confidence: { level: "high", bases: ["exact-accessible-target"] },
    });

    expect(result).toMatchObject({
      ok: true,
      session: { status: "failed", terminal: { status: "failed" } },
      attempt: { status: "failed", outcome: { code: "browser_unavailable" } },
    });
  });
});
