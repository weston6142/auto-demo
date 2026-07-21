/// <reference lib="dom" />

import type { ElementHandle, Locator, Page } from "playwright";

type PointerTarget = Locator | ElementHandle<Element>;

const POINTER_MOVE_STEPS = 6;

export async function clickWithVisiblePointer(page: Page, target: PointerTarget): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box === null || box.width <= 0 || box.height <= 0) throw new Error("target unavailable");
  const approach = {
    x: box.x + box.width * 0.35,
    y: box.y + box.height * 0.35,
  };
  const center = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
  await page.mouse.move(approach.x, approach.y, { steps: POINTER_MOVE_STEPS });
  await page.mouse.move(center.x, center.y, { steps: POINTER_MOVE_STEPS });
  await target.click();
}

export async function selectWithVisiblePointer(
  page: Page,
  target: PointerTarget,
  optionLabel: string,
): Promise<void> {
  const evaluatable = target as Locator;
  const matches = await evaluatable.evaluate((node, label) => {
    if (!(node instanceof HTMLSelectElement)) return undefined;
    const enabled = Array.from(node.options).filter((option) => !option.disabled);
    return enabled.filter((option) => option.textContent?.replace(/\s+/g, " ").trim() === label)
      .length;
  }, optionLabel);
  if (matches !== 1) throw new Error("option unavailable");

  await clickWithVisiblePointer(page, target);
  await page.keyboard.type(optionLabel);
  await page.keyboard.press("Enter");
  const selectedLabel = await evaluatable.evaluate((node) =>
    node instanceof HTMLSelectElement
      ? node.selectedOptions[0]?.textContent?.replace(/\s+/g, " ").trim()
      : undefined,
  );
  if (selectedLabel !== optionLabel) throw new Error("option unavailable");
}
