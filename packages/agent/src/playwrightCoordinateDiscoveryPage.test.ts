import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { PlaywrightCoordinateDiscoveryPage } from "./playwrightCoordinateDiscoveryPage.js";

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 320, height: 240 }, deviceScaleFactor: 1 });
});

afterAll(async () => {
  await browser.close();
});

async function fixture() {
  await page.setContent(`
    <main aria-label="Inventory">
      <form aria-label="Vehicle filters">
        <label>Make
          <select id="make">
            <option>Any make</option>
            <option>Kia</option>
          </select>
        </label>
        <button type="submit">Show matches</button>
      </form>
      <ol aria-label="Results">
        <li><article><span>Sponsored</span><a href="#ad">Ad vehicle</a></article></li>
        <li><article><a href="#organic">Organic vehicle</a></article></li>
      </ol>
      <div style="height: 600px"></div>
    </main>
  `);
}

describe("Playwright coordinate discovery page", () => {
  it("composes a cursor into an exact viewport PNG without changing page DOM", async () => {
    await fixture();
    const adapter = new PlaywrightCoordinateDiscoveryPage(page);
    const raw = await page.screenshot({ type: "png" });

    const frame = await adapter.captureFrame({
      id: "frame-1",
      pointer: { x: 64, y: 64 },
      grid: false,
    });

    expect(frame).toMatchObject({
      id: "frame-1",
      width: 320,
      height: 240,
      deviceScaleFactor: 1,
      pointer: { x: 64, y: 64 },
    });
    expect(frame.png.equals(raw)).toBe(false);
    expect(await page.locator("[data-autodemo-cursor]").count()).toBe(0);
  });

  it("maps a coordinate to public accessible, form, and structural evidence", async () => {
    await fixture();
    const adapter = new PlaywrightCoordinateDiscoveryPage(page);
    const select = page.getByLabel("Make");
    const selectBox = await select.boundingBox();
    if (selectBox === null) throw new Error("fixture select unavailable");

    const selectEvidence = await adapter.inspectPoint({
      x: Math.floor(selectBox.x + selectBox.width / 2),
      y: Math.floor(selectBox.y + selectBox.height / 2),
    });

    expect(selectEvidence).toMatchObject({
      target: {
        label: "Make",
        role: "combobox",
        occurrence: 1,
        disabled: false,
        form: {
          required: false,
          hasValue: true,
          validity: "valid",
          selectedOption: "Any make",
          options: [
            { label: "Any make", disabled: false, selected: true },
            { label: "Kia", disabled: false, selected: false },
          ],
        },
      },
      risk: { credential: false, sensitivePayment: false, upload: false },
    });

    await page.evaluate(() => {
      const select = document.querySelector("select")!;
      const box = select.getBoundingClientRect();
      select.style.pointerEvents = "none";
      const background = document.createElement("a");
      background.href = "#background";
      background.textContent = "Background promotion";
      Object.assign(background.style, {
        position: "fixed",
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        zIndex: "0",
      });
      document.body.append(background);
      const chevron = document.createElement("span");
      chevron.textContent = "⌄";
      Object.assign(chevron.style, {
        position: "fixed",
        left: `${box.right - 20}px`,
        top: `${box.top}px`,
        width: "20px",
        height: `${box.height}px`,
        background: "white",
        zIndex: "10",
      });
      select.closest("label")!.append(chevron);
    });
    const evidenceThroughChevron = await adapter.inspectPoint({
      x: Math.floor(selectBox.x + selectBox.width - 10),
      y: Math.floor(selectBox.y + selectBox.height / 2),
    });
    expect(evidenceThroughChevron).toMatchObject({
      target: { label: "Make", role: "combobox" },
    });

    const organic = page.getByRole("link", { name: "Organic vehicle" });
    const organicBox = await organic.boundingBox();
    if (organicBox === null) throw new Error("fixture link unavailable");
    const organicEvidence = await adapter.inspectPoint({
      x: Math.floor(organicBox.x + organicBox.width / 2),
      y: Math.floor(organicBox.y + organicBox.height / 2),
    });
    expect(organicEvidence?.target.structure).toEqual({
      container: { role: "list", label: "Results", occurrence: 1 },
      item: { role: "listitem", position: 1, promotion: "exclude-marked-promoted" },
    });
  });

  it("changes layout identity after scrolling and fails closed for uncapturable native UI", async () => {
    await fixture();
    const adapter = new PlaywrightCoordinateDiscoveryPage(page, {
      windowCapture: {
        async capture() {
          return undefined;
        },
      },
    });
    const before = await adapter.layoutIdentity();
    await page.evaluate(() => scrollTo(0, 200));
    expect(await adapter.layoutIdentity()).not.toBe(before);

    const box = await page.getByLabel("Make").boundingBox();
    if (box === null) throw new Error("fixture select unavailable");
    await page.evaluate(() => {
      const select = document.querySelector("select")!;
      const rect = select.getBoundingClientRect();
      select.style.pointerEvents = "none";
      const background = document.createElement("a");
      background.href = "#background";
      Object.assign(background.style, {
        position: "fixed",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        zIndex: "0",
      });
      document.body.append(background);
      const chevron = document.createElement("span");
      Object.assign(chevron.style, {
        position: "fixed",
        left: `${rect.right - 20}px`,
        top: `${rect.top}px`,
        width: "20px",
        height: `${rect.height}px`,
        background: "white",
        zIndex: "10",
      });
      select.closest("label")!.append(chevron);
    });
    await adapter.state();
    await adapter.execute({
      type: "click",
      x: Math.floor(box.x + box.width - 10),
      y: Math.floor(box.y + box.height / 2),
    });
    await expect(
      adapter.captureFrame({ id: "frame-2", pointer: { x: 10, y: 10 }, grid: false }),
    ).rejects.toThrow("native_window_capture_unavailable");
    await adapter.execute({ type: "keypress", keys: ["ESCAPE"] });
  });
});
