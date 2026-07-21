/// <reference lib="dom" />

import { createNaturalInputDriver, type NaturalInputDriver } from "@auto-demo/browser-input";
import type { ElementHandle, Locator, Page } from "playwright";

type PointerTarget = Locator | ElementHandle<Element>;

const drivers = new WeakMap<Page, NaturalInputDriver>();

function naturalInput(page: Page): NaturalInputDriver {
  const existing = drivers.get(page);
  if (existing !== undefined) return existing;
  const driver = createNaturalInputDriver(
    {
      move: (point) => page.mouse.move(point.x, point.y),
      down: (button) => page.mouse.down({ button }),
      up: (button) => page.mouse.up({ button }),
      wheel: (deltaX, deltaY) => page.mouse.wheel(deltaX, deltaY),
      keypress: (key) => page.keyboard.press(key),
      type: (text) => page.keyboard.type(text),
      wait: (durationMs) => page.waitForTimeout(durationMs),
    },
    { pointer: { x: 0, y: 0 } },
  );
  drivers.set(page, driver);
  return driver;
}

export async function clickWithVisiblePointer(page: Page, target: PointerTarget): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box === null || box.width <= 0 || box.height <= 0) throw new Error("target unavailable");
  const center = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
  await naturalInput(page).click(center);
}

export async function typeWithVisiblePointer(
  page: Page,
  target: PointerTarget,
  value: string,
  options: { delayMs?: number } = {},
): Promise<void> {
  await clickWithVisiblePointer(page, target);
  const driver = naturalInput(page);
  await driver.keypress(["ControlOrMeta+A", "Backspace"]);
  if ((options.delayMs ?? 0) <= 0) {
    await driver.type(value);
    return;
  }
  for (const character of Array.from(value)) {
    await driver.type(character);
    await page.waitForTimeout(options.delayMs!);
  }
}

export async function selectWithVisiblePointer(
  page: Page,
  target: PointerTarget,
  optionLabel: string,
): Promise<void> {
  const evaluatable = target as Locator;
  const optionState = await evaluatable.evaluate((node, label) => {
    if (!(node instanceof HTMLSelectElement)) return undefined;
    const enabled = Array.from(node.options).filter((option) => !option.disabled);
    const matches = enabled.filter(
      (option) => option.textContent?.replace(/\s+/g, " ").trim() === label,
    ).length;
    return { matches, cycleLimit: enabled.length };
  }, optionLabel);
  const cycleKey = Array.from(optionLabel.trim())[0];
  if (optionState === undefined || optionState.matches < 1 || cycleKey === undefined) {
    throw new Error("option unavailable");
  }

  await clickWithVisiblePointer(page, target);
  for (let attempt = 0; attempt < optionState.cycleLimit; attempt += 1) {
    await naturalInput(page).type(cycleKey);
    const selectedLabel = await evaluatable.evaluate((node) =>
      node instanceof HTMLSelectElement
        ? node.selectedOptions[0]?.textContent?.replace(/\s+/g, " ").trim()
        : undefined,
    );
    if (selectedLabel !== optionLabel) continue;
    await naturalInput(page).keypress(["Enter"]);
    return;
  }
  throw new Error("option unavailable");
}
