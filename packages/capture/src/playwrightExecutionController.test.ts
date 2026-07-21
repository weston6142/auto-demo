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
  const firstEligibleResult = {
    container: { role: "list" as const, label: "Vehicle results", occurrence: 1 },
    item: {
      role: "listitem" as const,
      position: 1,
      promotion: "exclude-marked-promoted" as const,
    },
  };

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
      <script>
        document.addEventListener('pointermove', () => {
          document.body.dataset.pointerMoves = String(Number(document.body.dataset.pointerMoves || '0') + 1)
        })
      </script>
    `);
    const controller = createPlaywrightExecutionController(page, { timeoutMs: 1_000 });

    await controller.click({ label: "Get started", role: "button" });
    await controller.type({ label: "Search" }, "launch demo", { delayMs: 1 });
    await controller.assertVisible({ label: "Results" });

    expect(await page.locator("button").getAttribute("data-clicked")).toBe("true");
    expect(await page.getByLabel("Search").inputValue()).toBe("launch demo");
    expect(Number(await page.locator("body").getAttribute("data-pointer-moves"))).toBeGreaterThan(
      2,
    );
  });

  it("selects a native option and verifies public control state", async () => {
    await page.setContent(`
      <label>Condition
        <select required onpointerdown="this.dataset.pointerFocused='true'">
          <option value="any-private">Any</option>
          <option value="certified-private">New &amp; certified</option>
          <option value="new-private">New</option>
          <option value="second-new-private">New</option>
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
    expect(await page.getByLabel("Condition").getAttribute("data-pointer-focused")).toBe("true");
  });

  it("uses structural position authoritatively for recording actions and assertions", async () => {
    await page.setContent(`
      <button onclick="this.dataset.clicked='outside'">2026 Kia Sorento A</button>
      <ul aria-label="Vehicle results">
        <li>Sponsored <button onclick="this.dataset.clicked='sponsored'">Paid result</button></li>
        <li>
          <button onclick="this.dataset.clicked='eligible'">Renamed first result</button>
          <label>Condition <select><option>Used</option><option>New</option></select></label>
        </li>
        <li><button>Renamed second result</button></li>
      </ul>
    `);
    const controller = createPlaywrightExecutionController(page, { timeoutMs: 1_000 });

    await controller.click({
      label: "2026 Kia Sorento A",
      role: "button",
      structure: firstEligibleResult,
    });
    await controller.select(
      { label: "Old condition label", role: "combobox", structure: firstEligibleResult },
      "New",
    );
    await controller.assertControlState({
      target: { label: "Old condition label", role: "combobox", structure: firstEligibleResult },
      state: { selectedOption: "New" },
    });

    expect(
      await page.getByRole("button", { name: "Renamed first result" }).getAttribute("data-clicked"),
    ).toBe("eligible");
    expect(
      await page.getByRole("button", { name: "2026 Kia Sorento A" }).getAttribute("data-clicked"),
    ).toBeNull();
  });

  it("fails safely when authoritative structural targets cannot select one descendant", async () => {
    const controller = createPlaywrightExecutionController(page, { timeoutMs: 100 });

    await page.setContent(`<button>Stale label</button><main aria-label="Other"></main>`);
    await expect(
      controller.click({ label: "Stale label", role: "button", structure: firstEligibleResult }),
    ).rejects.toMatchObject({ code: "target_not_found" });

    await page.setContent(`
      <ul aria-label="Vehicle results"><li><button>One</button><button>Two</button></li></ul>
    `);
    await expect(
      controller.click({ label: "Stale label", role: "button", structure: firstEligibleResult }),
    ).rejects.toMatchObject({ code: "ambiguous_target" });

    await page.setContent(`
      <ul aria-label="Vehicle results"><li><span>Sponsored</span><button>Paid only</button></li></ul>
    `);
    await expect(
      controller.click({ label: "Stale label", role: "button", structure: firstEligibleResult }),
    ).rejects.toMatchObject({ code: "target_not_found" });
  });

  it("keeps recording positions local to the selected repeated container", async () => {
    await page.setContent(`
      <ul aria-label="Vehicle results">
        <li><button>One</button></li>
        <li><ul aria-label="Nested"><li><button>Nested</button></li></ul></li>
        <li><button onclick="this.dataset.clicked='target'">Target</button></li>
      </ul>
    `);
    const controller = createPlaywrightExecutionController(page, { timeoutMs: 1_000 });

    await controller.click({
      label: "Old target",
      role: "button",
      structure: {
        container: { role: "list", label: "Vehicle results", occurrence: 1 },
        item: { role: "listitem", position: 3 },
      },
    });

    expect(await page.getByRole("button", { name: "Target" }).getAttribute("data-clicked")).toBe(
      "target",
    );
  });

  it("rejects missing and disabled public option labels", async () => {
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

    for (const label of ["Missing", "Used"]) {
      await expect(
        controller.select({ label: "Condition", role: "combobox" }, label),
      ).rejects.toMatchObject({ code: "action_failed" });
    }
    await expect(
      controller.select({ label: "Condition", role: "combobox" }, "New"),
    ).resolves.toBeUndefined();
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
