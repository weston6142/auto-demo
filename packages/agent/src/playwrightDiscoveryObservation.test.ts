/// <reference lib="dom" />

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPlaywrightDiscoveryObservationExtractor } from "./index.js";
import { PlaywrightDiscoveryObservationPage } from "./playwrightDiscoveryPage.js";

let browser: Browser;
let context: BrowserContext;
let page: Page;

beforeEach(async () => {
  browser = await chromium.launch({
    headless: process.env.AUTODEMO_BROWSER_TEST_MODE !== "headed",
  });
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

describe("createPlaywrightDiscoveryObservationExtractor", () => {
  it("describes visible semantic controls and meaningful page state", async () => {
    await openHtml(`
      <title>Checkout</title>
      <h1>Your cart</h1>
      <p>Review the selected items.</p>
      <button>Checkout</button>
      <button hidden>Hidden action</button>
      <div inert><button>Inert action</button></div>
    `);
    const result = await createPlaywrightDiscoveryObservationExtractor(page).observe();
    expect(result).toMatchObject({
      ok: true,
      observation: {
        page: {
          url: "https://example.test/",
          title: "Checkout",
          viewport: { width: 1280, height: 720 },
          navigation: { canGoBack: false },
        },
        visibleStates: expect.arrayContaining([
          expect.objectContaining({ kind: "text", summary: "Your cart" }),
          expect.objectContaining({ kind: "text", summary: "Review the selected items." }),
        ]),
        interactiveTargets: [
          expect.objectContaining({ label: "Checkout", role: "button", disabled: false }),
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain("Hidden action");
    expect(JSON.stringify(result)).not.toContain("Inert action");
  });

  it("uses the public value of native button inputs as their accessible label", async () => {
    await openHtml(`
      <title>Vehicle search</title>
      <form>
        <input type="submit" value="Show 10,000+ matches">
        <input type="button" value="Clear filters">
        <label>ZIP <input type="text" value="19138-private-value"></label>
      </form>
    `);

    const result = await createPlaywrightDiscoveryObservationExtractor(page).observe();

    expect(result).toMatchObject({
      ok: true,
      observation: {
        interactiveTargets: expect.arrayContaining([
          expect.objectContaining({
            label: "Show 10,000+ matches",
            role: "button",
            actionRisk: "potentially-mutating",
          }),
          expect.objectContaining({ label: "Clear filters", role: "button" }),
          expect.objectContaining({ label: "ZIP", role: "textbox" }),
        ]),
      },
    });
    expect(JSON.stringify(result)).not.toContain("19138-private-value");
  });

  it("keeps ids attached to duplicate elements across reorder and replacement", async () => {
    await openHtml(`
      <title>Duplicates</title>
      <button data-testid="first">Continue</button>
      <button data-testid="second">Continue</button>
    `);
    const extractor = createPlaywrightDiscoveryObservationExtractor(page);
    const first = await extractor.observe();
    if (!first.ok) throw new Error("first observation must succeed");
    const firstTargets = first.observation.interactiveTargets;
    expect(firstTargets.map((target) => target.occurrence)).toEqual([1, 2]);
    expect(new Set(firstTargets.map((target) => target.id)).size).toBe(2);

    await page.evaluate(() => {
      const firstElement = document.querySelector('[data-testid="first"]');
      const secondElement = document.querySelector('[data-testid="second"]');
      if (firstElement === null || secondElement === null) throw new Error("fixture missing");
      document.body.insertBefore(secondElement, firstElement);
    });
    const second = await extractor.observe();
    if (!second.ok) throw new Error("second observation must succeed");
    const secondTargets = second.observation.interactiveTargets;
    expect(secondTargets.map((target) => target.occurrence)).toEqual([1, 2]);
    expect(secondTargets.map((target) => target.id)).toEqual([
      firstTargets[1]?.id,
      firstTargets[0]?.id,
    ]);

    const removedId = firstTargets[0]?.id;
    if (removedId === undefined) throw new Error("fixture target missing");
    await page.evaluate(() => document.querySelector('[data-testid="first"]')?.remove());
    expect(await extractor.hasLiveTarget(removedId)).toBe(false);
    await page.evaluate(() => {
      const recreated = document.createElement("button");
      recreated.dataset.testid = "first";
      recreated.textContent = "Continue";
      document.body.append(recreated);
    });
    const third = await extractor.observe();
    if (!third.ok) throw new Error("third observation must succeed");
    const retainedId = firstTargets[1]?.id;
    const recreatedId = third.observation.interactiveTargets.find(
      (target) => target.id !== retainedId,
    )?.id;
    expect(recreatedId).toBeDefined();
    expect(recreatedId).not.toBe(removedId);
  });

  it("includes open shadow controls and excludes iframe controls", async () => {
    await openHtml(`
      <title>Surfaces</title>
      <div id="shadow-host"></div>
      <div id="inert-shadow-host" inert></div>
      <iframe srcdoc="<button>Frame action</button>"></iframe>
      <script>
        document.querySelector('#shadow-host').attachShadow({ mode: 'open' }).innerHTML =
          '<button>Shadow action</button>';
        document.querySelector('#inert-shadow-host').attachShadow({ mode: 'open' }).innerHTML =
          '<button>Inert shadow action</button>';
      </script>
    `);
    const result = await createPlaywrightDiscoveryObservationExtractor(page).observe();
    expect(result).toMatchObject({
      ok: true,
      observation: {
        interactiveTargets: expect.arrayContaining([
          expect.objectContaining({ label: "Shadow action", role: "button" }),
        ]),
      },
    });
    expect(JSON.stringify(result)).not.toContain("Frame action");
    expect(JSON.stringify(result)).not.toContain("Inert shadow action");
  });

  it("emits nested visible context leaf-first without duplicating container text", async () => {
    await openHtml(`
      <title>Nested context</title>
      <p>Alpha <span>Beta</span></p>
    `);
    const result = await createPlaywrightDiscoveryObservationExtractor(page).observe();
    if (!result.ok) throw new Error("nested observation must succeed");
    const summaries = result.observation.visibleStates.map((state) => state.summary);
    expect(summaries).toEqual(expect.arrayContaining(["Alpha", "Beta"]));
    expect(summaries).not.toContain("Alpha Beta");
  });

  it("orders semantic controls before deduplicated fallback targets", async () => {
    await openHtml(`
      <title>Fallbacks</title>
      <button>Primary action</button>
      <div tabindex="0">Focusable card</div>
      <div style="cursor: pointer">Pointer card <span style="cursor: pointer">Nested detail</span></div>
    `);
    const result = await createPlaywrightDiscoveryObservationExtractor(page).observe();
    expect(result).toMatchObject({
      ok: true,
      observation: {
        interactiveTargets: [
          expect.objectContaining({ label: "Primary action", role: "button" }),
          expect.objectContaining({ label: "Focusable card" }),
          expect.objectContaining({ label: expect.stringContaining("Pointer card") }),
        ],
      },
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "fallback_targets_included", count: 2 }),
      ]),
    });
    if (!result.ok) throw new Error("fallback observation must succeed");
    expect(result.observation.interactiveTargets).toHaveLength(3);
  });

  it("uses destination, accessible-name precedence, and effective disabled semantics", async () => {
    await openHtml(`
      <title>Accessibility</title>
      <a>No destination</a>
      <a href="/next">Real link</a>
      <span id="labelled-name">Labelled by wins</span>
      <button aria-label="ARIA label" aria-labelledby="labelled-name">Button text</button>
      <label>Native label <input aria-label="ARIA wins"></label>
      <fieldset disabled><button>Disabled by fieldset</button></fieldset>
      <div role="button" aria-disabled="true">ARIA disabled</div>
    `);
    const result = await createPlaywrightDiscoveryObservationExtractor(page).observe();
    if (!result.ok) throw new Error("accessibility observation must succeed");
    const targets = result.observation.interactiveTargets;
    expect(targets.map((target) => target.label)).not.toContain("No destination");
    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Real link", role: "link", disabled: false }),
        expect.objectContaining({ label: "Labelled by wins", role: "button" }),
        expect.objectContaining({ label: "ARIA wins", role: "textbox" }),
        expect.objectContaining({ label: "Disabled by fieldset", disabled: true }),
        expect.objectContaining({ label: "ARIA disabled", disabled: true }),
      ]),
    );
  });

  it("reports credential metadata and mutation risk without exposing values or secrets", async () => {
    await openHtml(`
      <title>Sign in</title>
      <form>
        <label>Password <input type="password" autocomplete="current-password" value="password-value-secret"></label>
        <button type="submit">Sign in</button>
      </form>
      <p>token=abcdefghijklmnopqrstuvwx1234</p>
    `);
    const result = await createPlaywrightDiscoveryObservationExtractor(page).observe();
    expect(result).toMatchObject({
      ok: true,
      observation: {
        interactiveTargets: expect.arrayContaining([
          expect.objectContaining({ label: "Password", role: "textbox" }),
          expect.objectContaining({
            label: "Sign in",
            role: "button",
            actionRisk: "potentially-mutating",
          }),
        ]),
        visibleStates: expect.arrayContaining([
          expect.objectContaining({ summary: expect.stringContaining("[redacted-secret]") }),
        ]),
      },
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "credential_target_present", count: 1 }),
        expect.objectContaining({ code: "content_redacted" }),
      ]),
    });
    expect(JSON.stringify(result)).not.toContain("password-value-secret");
    expect(JSON.stringify(result)).not.toContain("abcdefghijklmnopqrstuvwx1234");
    if (!result.ok) throw new Error("credential observation must succeed");
    expect(result.observation.visibleStates.map((state) => state.summary)).not.toContain(
      "Password",
    );
  });

  it("exposes bounded public native form state without exposing control values", async () => {
    await openHtml(`
      <title>Vehicle search</title>
      <form>
        <label>Condition
          <select required>
            <option value="any-secret-value">Any</option>
            <option value="new-secret-value" selected>New</option>
          </select>
        </label>
        <label>Make
          <select>
            <option value="kia-secret-value" selected>Kia</option>
            <option value="disabled-secret-value" disabled>Other</option>
          </select>
        </label>
        <label>Private choice
          <select>
            <option value="private-native-value" selected>token=private-option-value</option>
          </select>
        </label>
        <label><input type="radio" name="distance" checked value="nationwide-secret-value"> Nationwide</label>
        <label>ZIP <input value="30301-secret-value"></label>
      </form>
    `);

    const result = await createPlaywrightDiscoveryObservationExtractor(page).observe();
    if (!result.ok) throw new Error("form observation must succeed");

    expect(result.observation.interactiveTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Condition",
          role: "combobox",
          form: {
            required: true,
            hasValue: true,
            validity: "valid",
            selectedOption: "New",
            options: [
              { label: "Any", disabled: false, selected: false },
              { label: "New", disabled: false, selected: true },
            ],
          },
        }),
        expect.objectContaining({
          label: "Make",
          role: "combobox",
          form: expect.objectContaining({
            selectedOption: "Kia",
            options: [
              { label: "Kia", disabled: false, selected: true },
              { label: "Other", disabled: true, selected: false },
            ],
          }),
        }),
        expect.objectContaining({
          label: "Nationwide",
          role: "radio",
          form: expect.objectContaining({ checked: true, hasValue: true }),
        }),
        expect.objectContaining({
          label: "ZIP",
          role: "textbox",
          form: expect.objectContaining({ hasValue: true }),
        }),
        expect.objectContaining({
          label: "Private choice",
          role: "combobox",
          form: expect.not.objectContaining({ selectedOption: expect.anything() }),
        }),
      ]),
    );
    expect(JSON.stringify(result)).not.toMatch(
      /any-secret-value|new-secret-value|kia-secret-value|disabled-secret-value|nationwide-secret-value|30301-secret-value|private-option-value|\[redacted-secret\]/,
    );
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "content_redacted" })]),
    );
  });

  it("classifies payment and upload controls only in the runtime snapshot", async () => {
    await openHtml(`
      <label>Card number <input autocomplete="cc-number"></label>
      <label>Receipt <input type="file"></label>
    `);

    const snapshot = await new PlaywrightDiscoveryObservationPage(page).collectSnapshot();
    expect(snapshot.interactiveTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Card number", sensitivePayment: true, upload: false }),
        expect.objectContaining({ label: "Receipt", sensitivePayment: false, upload: true }),
      ]),
    );

    const result = await createPlaywrightDiscoveryObservationExtractor(page).observe();
    if (!result.ok) throw new Error("observation must succeed");
    for (const target of result.observation.interactiveTargets) {
      expect(target).not.toHaveProperty("sensitivePayment");
      expect(target).not.toHaveProperty("upload");
    }
  });

  it("never reads editable values into labels or visible context", async () => {
    await openHtml(`
      <title>Safe forms</title>
      <label for="notes">Notes label</label>
      <textarea id="notes">textarea-value-secret</textarea>
      <label for="choice">Choice label</label>
      <select id="choice"><option value="select-value-secret" selected>Visible choice</option></select>
      <div contenteditable aria-label="Editable label">editable-value-secret</div>
      <textarea>unlabelled-textarea-secret</textarea>
      <select><option>unlabelled-select-secret</option></select>
      <div contenteditable>unlabelled-editable-secret</div>
      <button aria-labelledby="notes">Unsafe labelled-by reference</button>
      <h2>Safe heading <textarea>heading-control-secret</textarea></h2>
      <div role="status">Ready <select><option>status-control-secret</option></select></div>
    `);
    const result = await createPlaywrightDiscoveryObservationExtractor(page).observe();
    expect(result).toMatchObject({
      ok: true,
      observation: {
        interactiveTargets: expect.arrayContaining([
          expect.objectContaining({ label: "Notes label", role: "textbox" }),
          expect.objectContaining({ label: "Choice label", role: "combobox" }),
          expect.objectContaining({ label: "Editable label", role: "textbox" }),
        ]),
        visibleStates: expect.arrayContaining([
          expect.objectContaining({ summary: "Safe heading" }),
          expect.objectContaining({ summary: "Ready" }),
        ]),
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /textarea-value-secret|select-value-secret|editable-value-secret|unlabelled-|control-secret/,
    );
  });

  it("excludes hidden and non-content descendants from visible summaries", async () => {
    await openHtml(`
      <title>Visible content only</title>
      <h1>
        Visible heading
        <span hidden>hidden-descendant-secret</span>
        <span inert>inert-descendant-secret</span>
        <span aria-hidden="true">aria-hidden-descendant-secret</span>
        <span style="display: none">non-rendered-descendant-secret</span>
        <script>globalThis.scriptDescendantSecret = 'script-descendant-secret'</script>
        <style>.unused { --secret: style-descendant-secret; }</style>
        <template>template-descendant-secret</template>
      </h1>
      <span id="accessible-name" hidden>Hidden accessible label</span>
      <button aria-labelledby="accessible-name">Fallback text</button>
    `);
    const result = await createPlaywrightDiscoveryObservationExtractor(page).observe();
    expect(result).toMatchObject({
      ok: true,
      observation: {
        visibleStates: expect.arrayContaining([
          expect.objectContaining({ summary: "Visible heading" }),
        ]),
        interactiveTargets: [
          expect.objectContaining({ label: "Hidden accessible label", role: "button" }),
        ],
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /hidden-descendant-secret|inert-descendant-secret|aria-hidden-descendant-secret|non-rendered-descendant-secret|script-descendant-secret|style-descendant-secret|template-descendant-secret/,
    );
  });

  it("extracts text through bounded node walking instead of aggregate DOM text getters", async () => {
    await openHtml(`
      <title>Bounded text</title>
      <button id="action">Safe action</button>
      <h1 id="heading">${"x".repeat(3_000)}</h1>
      <script>
        for (const id of ['action', 'heading']) {
          const element = document.getElementById(id);
          Object.defineProperty(element, 'innerText', { get() { throw new Error('innerText-read'); } });
          Object.defineProperty(element, 'textContent', { get() { throw new Error('textContent-read'); } });
        }
        Object.defineProperty(Text.prototype, 'data', { get() { throw new Error('text-data-read'); } });
      </script>
    `);
    const result = await createPlaywrightDiscoveryObservationExtractor(page).observe();
    expect(result).toMatchObject({
      ok: true,
      observation: {
        interactiveTargets: [expect.objectContaining({ label: "Safe action" })],
      },
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "content_redacted", count: expect.any(Number) }),
      ]),
    });
    expect(JSON.stringify(result)).not.toMatch(/innerText-read|textContent-read|text-data-read/);
  });

  it("applies deterministic target and visible-state limits", async () => {
    const controls = Array.from(
      { length: 301 },
      (_, index) => `<button>Control ${index}</button>`,
    ).join("");
    const states = Array.from({ length: 151 }, (_, index) => `<p>State ${index}</p>`).join("");
    await openHtml(`<title>Limits</title>${controls}${states}`);
    const result = await createPlaywrightDiscoveryObservationExtractor(page).observe();
    expect(result).toMatchObject({
      ok: true,
      observation: { interactiveTargets: { length: 100 }, visibleStates: { length: 50 } },
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "interactive_targets_truncated", count: 201 }),
        expect.objectContaining({ code: "visible_states_truncated", count: 101 }),
      ]),
    });
    if (!result.ok) throw new Error("limited observation must succeed");
    expect(result.observation.interactiveTargets[0]?.label).toBe("Control 0");
    expect(result.observation.visibleStates[0]?.summary).toBe("State 0");
    expect(JSON.stringify(result)).not.toContain("Control 100");
    expect(JSON.stringify(result)).not.toContain("State 50");
    expect(JSON.stringify(result)).not.toContain("State 150");
  });

  it("keeps viewport form controls and reserves capacity for custom targets", async () => {
    const offscreenLinks = Array.from(
      { length: 120 },
      (_, index) => `<a href="/vehicle-${index}">Vehicle ${index}</a>`,
    ).join("");
    const customTargets = Array.from(
      { length: 25 },
      (_, index) => `<div tabindex="0">Custom filter ${index}</div>`,
    ).join("");
    await openHtml(`
      <title>Ranked controls</title>
      <div style="position:absolute;top:2000px">${offscreenLinks}</div>
      <form aria-label="Vehicle filters" style="position:fixed;top:0;left:0">
        <label>Condition <select><option>New</option></select></label>
        <label>Distance <select><option>Nationwide</option></select></label>
        ${customTargets}
      </form>
    `);
    const extractor = createPlaywrightDiscoveryObservationExtractor(page);
    const first = await extractor.observe();
    const second = await extractor.observe();
    if (!first.ok || !second.ok) throw new Error("ranked observations must succeed");

    const labels = first.observation.interactiveTargets.map((target) => target.label);
    expect(first.observation.interactiveTargets).toHaveLength(100);
    expect(labels).toEqual(expect.arrayContaining(["Condition", "Distance"]));
    expect(
      labels.filter((label) => label.startsWith("Custom filter ")).length,
    ).toBeGreaterThanOrEqual(20);
    expect(first.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "interactive_targets_truncated", count: 47 }),
        expect.objectContaining({ code: "fallback_targets_included", count: 25 }),
      ]),
    );
    expect(second.observation.interactiveTargets.map((target) => target.label)).toEqual(labels);
  });

  it("exposes sanitized repeated-item position without pinning promotion text", async () => {
    await openHtml(`
      <title>Vehicle inventory</title>
      <ul aria-label="Vehicle results">
        <li><span>Sponsored</span><a href="/sponsored">Promoted Sorento</a></li>
        <li><a href="/first">2026 Kia Sorento A</a></li>
        <li><a href="/second">2026 Kia Sorento B</a></li>
      </ul>
      <ul aria-label="Vehicle results">
        <li><a href="/other">Other inventory</a></li>
      </ul>
      <div hidden>token=private-value</div>
    `);

    const result = await createPlaywrightDiscoveryObservationExtractor(page).observe();
    if (!result.ok) throw new Error("structural observation must succeed");
    const byLabel = new Map(
      result.observation.interactiveTargets.map((target) => [target.label, target]),
    );

    expect(byLabel.get("2026 Kia Sorento A")?.structure).toEqual({
      container: { role: "list", label: "Vehicle results", occurrence: 1 },
      item: {
        role: "listitem",
        position: 1,
        promotion: "exclude-marked-promoted",
      },
    });
    expect(byLabel.get("2026 Kia Sorento B")?.structure?.item).toMatchObject({
      position: 2,
      promotion: "exclude-marked-promoted",
    });
    expect(byLabel.get("Promoted Sorento")?.structure).toEqual({
      container: { role: "list", label: "Vehicle results", occurrence: 1 },
      item: { role: "listitem", position: 1 },
    });
    expect(byLabel.get("Other inventory")?.structure?.container).toEqual({
      role: "list",
      label: "Vehicle results",
      occurrence: 2,
    });
    expect(JSON.stringify(result)).not.toMatch(/private-value|selector|outerHTML/);
  });

  it("does not turn changing content into an unlabeled container identity", async () => {
    await openHtml(`<main><a href="/story">Read story</a></main>`);

    const result = await createPlaywrightDiscoveryObservationExtractor(page).observe();
    if (!result.ok) throw new Error("unlabeled main observation must succeed");

    expect(
      result.observation.interactiveTargets.find((target) => target.label === "Read story")
        ?.structure?.container,
    ).toEqual({ role: "main", occurrence: 1 });
  });

  it("computes visible omissions after priority ancestors suppress descendants", async () => {
    const descendants = Array.from(
      { length: 101 },
      (_, index) => `<span>Heading detail ${index}</span>`,
    ).join("");
    await openHtml(`<title>Priority ancestor</title><h1>${descendants}</h1>`);
    const result = await createPlaywrightDiscoveryObservationExtractor(page).observe();
    expect(result).toMatchObject({
      ok: true,
      observation: { visibleStates: [expect.objectContaining({ kind: "text" })] },
    });
    if (!result.ok) throw new Error("priority ancestor observation must succeed");
    expect(result.diagnostics).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "visible_states_truncated" })]),
    );
  });

  it("deduplicates visible summaries before applying candidate caps", async () => {
    const repeated = Array.from({ length: 101 }, () => "<p>Repeated state</p>").join("");
    await openHtml(`<title>Unique capacity</title>${repeated}<p>Unique state</p>`);
    const result = await createPlaywrightDiscoveryObservationExtractor(page).observe();
    expect(result).toMatchObject({
      ok: true,
      observation: {
        visibleStates: [
          expect.objectContaining({ summary: "Repeated state" }),
          expect.objectContaining({ summary: "Unique state" }),
        ],
      },
    });
    if (!result.ok) throw new Error("unique capacity observation must succeed");
    expect(result.diagnostics).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "visible_states_truncated" })]),
    );
  });

  it("deduplicates by the eventual public summary before applying candidate caps", async () => {
    const commonPrefix = "A".repeat(500);
    const publicDuplicates = Array.from(
      { length: 101 },
      (_, index) => `<p>${commonPrefix} private-suffix-${index}</p>`,
    ).join("");
    await openHtml(`<title>Public capacity</title>${publicDuplicates}<p>Unique public state</p>`);
    const result = await createPlaywrightDiscoveryObservationExtractor(page).observe();
    expect(result).toMatchObject({
      ok: true,
      observation: {
        visibleStates: [
          expect.objectContaining({ summary: commonPrefix }),
          expect.objectContaining({ summary: "Unique public state" }),
        ],
      },
    });
  });

  it("persists real viewport PNG bytes behind a safe artifact reference", async () => {
    await openHtml(
      "<title>Screenshot</title><details open><summary>Filters</summary><button autofocus>Capture me</button></details>",
    );
    await page.locator("button").focus();
    const stored: Uint8Array[] = [];
    const extractor = createPlaywrightDiscoveryObservationExtractor(page, {
      artifactSink: {
        async write(input) {
          stored.push(input.bytes);
          return { path: "artifacts/page.png" };
        },
      },
    });
    const result = await extractor.observe();
    expect(stored[0]?.byteLength).toBeGreaterThan(0);
    expect(result).toMatchObject({
      ok: true,
      observation: {
        artifacts: [
          {
            kind: "screenshot",
            path: "artifacts/page.png",
            mediaType: "image/png",
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain("bytes");
    expect(await page.locator("details").getAttribute("open")).not.toBeNull();
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Capture me");
  });

  it("fails closed instead of capturing page-only pixels while a native select owns focus", async () => {
    await openHtml(
      "<title>Native select</title><label>Make<select><option>Kia</option><option>Mazda</option></select></label>",
    );
    await page.locator("select").focus();
    let writes = 0;
    const result = await createPlaywrightDiscoveryObservationExtractor(page, {
      artifactSink: {
        async write() {
          writes += 1;
          return { path: "artifacts/native-select.png" };
        },
      },
    }).observe();

    expect(writes).toBe(0);
    expect(result).toMatchObject({
      ok: true,
      observation: { artifacts: [] },
      diagnostics: [expect.objectContaining({ code: "visual_state_unavailable" })],
    });
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("SELECT");
  });

  it("invalidates prior-document targets and reports navigation and closure", async () => {
    await page.route("https://example.test/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body:
          path === "/first"
            ? "<title>First</title><button>First action</button>"
            : "<title>Second</title><button>Second action</button>",
      });
    });
    await page.goto("https://example.test/first");
    const extractor = createPlaywrightDiscoveryObservationExtractor(page);
    const first = await extractor.observe();
    if (!first.ok) throw new Error("first page observation must succeed");
    const firstId = first.observation.interactiveTargets[0]?.id;
    if (firstId === undefined) throw new Error("first page target missing");

    await page.goto("https://example.test/second");
    const second = await extractor.observe();
    expect(second).toMatchObject({
      ok: true,
      observation: {
        page: { url: "https://example.test/second", navigation: { canGoBack: true } },
        interactiveTargets: [expect.objectContaining({ label: "Second action" })],
      },
    });
    if (!second.ok) throw new Error("second page observation must succeed");
    expect(second.observation.interactiveTargets[0]?.id).not.toBe(firstId);
    expect(await extractor.hasLiveTarget(firstId)).toBe(false);

    await page.goBack();
    const returned = await extractor.observe();
    expect(returned).toMatchObject({
      ok: true,
      observation: {
        page: { url: "https://example.test/first", navigation: { canGoBack: false } },
      },
    });

    await page.evaluate(() => location.replace("/second"));
    await page.waitForURL("https://example.test/second");
    const replaced = await extractor.observe();
    expect(replaced).toMatchObject({
      ok: true,
      observation: {
        page: { url: "https://example.test/second", navigation: { canGoBack: false } },
      },
    });

    await page.close();
    await expect(extractor.observe()).resolves.toEqual({
      ok: false,
      errors: [
        { code: "browser_unavailable", message: "Discovery observation browser is unavailable." },
      ],
    });
  });
});
