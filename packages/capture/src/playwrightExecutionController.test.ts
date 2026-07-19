import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import {
  createPlaywrightExecutionController,
  PlaywrightExecutionControllerError,
} from "./playwrightExecutionController.js";

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});

afterAll(async () => {
  await browser.close();
});

describe("createPlaywrightExecutionController", () => {
  it("asserts the current sanitized navigation destination", async () => {
    await page.route("https://example.com/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Results</h1>" });
    });
    await page.goto("https://example.com/results?view=private#section");
    const controller = createPlaywrightExecutionController(page, { timeoutMs: 1_000 });

    await expect(
      controller.assertNavigation({
        url: "https://example.com/results?other=value#different",
        match: "exact-url",
      }),
    ).resolves.toBeUndefined();
    await expect(
      controller.assertNavigation({
        url: "https://example.com/results",
        match: "same-origin-path",
      }),
    ).resolves.toBeUndefined();
    await expect(
      controller.assertNavigation({
        url: "https://example.com/other",
        match: "same-origin-path",
      }),
    ).rejects.toMatchObject({ code: "assertion_failed" });
    await page.unroute("https://example.com/**");
  });

  it("clicks, types, and asserts through accessible targets", async () => {
    await page.setContent(`
      <button onclick="this.dataset.clicked='true'">Get started</button>
      <label>Search <input /></label>
      <h2>Results</h2>
    `);
    const controller = createPlaywrightExecutionController(page, { timeoutMs: 1_000 });

    await controller.click({ label: "Get started", role: "button" });
    await controller.type({ label: "Search" }, "launch demo", { delayMs: 1 });
    await controller.assertVisible({ label: "Results" });

    expect(await page.locator("button").getAttribute("data-clicked")).toBe("true");
    expect(await page.getByLabel("Search").inputValue()).toBe("launch demo");
  });

  it("selects a native option and verifies public control state", async () => {
    await page.setContent(`
      <label>Condition
        <select required>
          <option value="any-private">Any</option>
          <option value="new-private">New</option>
        </select>
      </label>
    `);
    const controller = createPlaywrightExecutionController(page, { timeoutMs: 1_000 });

    await controller.select({ label: "Condition", role: "combobox" }, "New");
    await controller.assertControlState({
      target: { label: "Condition", role: "combobox" },
      state: { selectedOption: "New", hasValue: true, validity: "valid" },
    });

    expect(await page.getByLabel("Condition").inputValue()).toBe("new-private");
  });

  it("rejects missing, disabled, and ambiguous public option labels", async () => {
    await page.setContent(`
      <label>Condition
        <select>
          <option disabled>Used</option>
          <option>New</option>
          <option>New</option>
        </select>
      </label>
    `);
    const controller = createPlaywrightExecutionController(page, { timeoutMs: 1_000 });

    for (const label of ["Missing", "Used", "New"]) {
      await expect(
        controller.select({ label: "Condition", role: "combobox" }, label),
      ).rejects.toMatchObject({ code: "action_failed" });
    }
  });

  it("fails rather than guessing when targets are missing or ambiguous", async () => {
    await page.setContent(`<button>Choose</button><button>Choose</button>`);
    const controller = createPlaywrightExecutionController(page, { timeoutMs: 100 });

    await expect(controller.click({ label: "Missing" })).rejects.toMatchObject({
      code: "target_not_found",
    });
    await expect(controller.click({ label: "Choose", role: "button" })).rejects.toMatchObject({
      code: "ambiguous_target",
    });
    await expect(
      controller.click({ label: "Choose", role: "button", occurrence: 2 }),
    ).resolves.toBeUndefined();
  });

  it("waits a bounded time for a delayed accessible target", async () => {
    await page.setContent(`<main id="app"></main>`);
    await page.evaluate(`
      window.setTimeout(() => {
        const button = document.createElement("button");
        button.textContent = "Continue";
        button.onclick = () => { button.dataset.clicked = "true"; };
        document.querySelector("#app")?.append(button);
      }, 100);
    `);
    const controller = createPlaywrightExecutionController(page, { timeoutMs: 1_000 });

    await controller.click({ label: "Continue", role: "button" });

    expect(await page.getByRole("button", { name: "Continue" }).getAttribute("data-clicked")).toBe(
      "true",
    );
  });

  it("waits for a quiet candidate window before rejecting delayed ambiguity", async () => {
    await page.setContent(`<main id="app"></main>`);
    await page.evaluate(`
      window.setTimeout(() => {
        const first = document.createElement("button");
        first.textContent = "Choose";
        document.querySelector("#app")?.append(first);
      }, 50);
      window.setTimeout(() => {
        const second = document.createElement("button");
        second.textContent = "Choose";
        document.querySelector("#app")?.append(second);
      }, 125);
    `);
    const controller = createPlaywrightExecutionController(page, { timeoutMs: 500 });

    await expect(controller.click({ label: "Choose", role: "button" })).rejects.toMatchObject({
      code: "ambiguous_target",
    });
  });

  it("settles on a ready page without requiring the whole DOM to stop changing", async () => {
    await page.setContent(`<main id="app">0</main>`);
    await page.evaluate(`
      let count = 0;
      const timer = window.setInterval(() => {
        document.querySelector("#app").textContent = String(++count);
        if (count >= 50) window.clearInterval(timer);
      }, 10);
    `);
    const controller = createPlaywrightExecutionController(page, { timeoutMs: 300 });

    await expect(controller.waitForSettled()).resolves.toBeUndefined();
  });

  it("rejects unsafe navigation without exposing the URL secret", async () => {
    const controller = createPlaywrightExecutionController(page, { timeoutMs: 100 });
    let error: unknown;
    try {
      await controller.navigate("https://example.com/?token=private-value");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(PlaywrightExecutionControllerError);
    expect(error).toMatchObject({ code: "navigation_failed" });
    expect(JSON.stringify(error)).not.toContain("private-value");
  });
});
