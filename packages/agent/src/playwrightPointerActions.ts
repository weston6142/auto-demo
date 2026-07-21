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
    await page.keyboard.type(cycleKey);
    const selectedLabel = await evaluatable.evaluate((node) =>
      node instanceof HTMLSelectElement
        ? node.selectedOptions[0]?.textContent?.replace(/\s+/g, " ").trim()
        : undefined,
    );
    if (selectedLabel !== optionLabel) continue;
    await page.keyboard.press("Enter");
    return;
  }
  throw new Error("option unavailable");
}
