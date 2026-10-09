import { expect, type Locator, type Page, test } from "@playwright/test";
import { addLayers } from "./layers.ts";

// FX devices move between the Global, Layer and Clip stacks by dragging
// their title bar, from the keyboard and from their context menu, but only
// onto stacks their effect is designed for. A clip's content device stays at
// the front of the Clip stack.

test.use({ viewport: { width: 1920, height: 1080 } });

function device(page: Page, group: string, name: string) {
  return page.locator(
    `.fx-chain :is(section[data-fx-group="${group}"], [data-fx-group="${group}"] > section)[aria-label="${name}"]`,
  );
}

// Selects a new text clip on Layer 2, so the chain reads
// GLOBAL [Order] | LAYER [Layout, ...] | CLIP [Text], and adds the effects
// named to the layer.
async function openTextClip(page: Page, effects: string[]) {
  await page.goto("/");
  await addLayers(page, 1);
  const header = page.locator('[data-layer-header-id="2"]');
  for (const effect of effects) {
    await header.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Add FX", exact: true }).hover();
    await page
      .getByRole("menu", { name: "Add FX" })
      .getByRole("menuitem", { name: new RegExp(`^${effect}`) })
      .click();
    await expect(device(page, "layer", effect)).toHaveCount(1);
  }
  await header.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Insert text at playhead" }).click();
  await expect(device(page, "clip", "Text")).toHaveCount(1);
  // Fold the devices so every stack fits in view.
  for (const name of ["Order", "Layout", "Text", ...effects]) {
    await page
      .locator(
        `.fx-chain section[aria-label="${name}"] .fx-device-panel__title`,
      )
      .first()
      .dblclick({ position: { x: 4, y: 4 } });
  }
  await expect(page.locator(".fx-device-panel--collapsed")).toHaveCount(
    3 + effects.length,
  );
}

// A device with its attached Animation section: one panel of its stack.
function unit(page: Page, group: string, name: string) {
  return page.locator(
    `.fx-chain :is(section[data-fx-group="${group}"][aria-label="${name}"], [data-fx-group="${group}"]:has(> section[aria-label="${name}"]))`,
  );
}

async function center(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("not visible");
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Presses on `from` and moves to `to`, then reports whether the insertion
// marker showed before letting go.
async function drag(page: Page, from: Locator, to: { x: number; y: number }) {
  const start = await center(from);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  // Let the marker render.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const marker = await page.locator(".fx-chain__marker").count();
  await page.mouse.up();
  return marker > 0;
}

// Just right of a panel, inside its stack.
async function rightOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("not visible");
  }
  return { x: box.x + box.width + 2, y: box.y + box.height / 2 };
}

test("dragging a device moves it to another stack and undo restores it", async ({
  page,
}) => {
  await openTextClip(page, ["Colorize"]);

  // Layer → Clip, after the clip's Text.
  expect(
    await drag(
      page,
      device(page, "layer", "Colorize"),
      await rightOf(unit(page, "clip", "Text")),
    ),
  ).toBe(true);
  await expect(device(page, "clip", "Colorize")).toHaveCount(1);
  await expect(device(page, "layer", "Colorize")).toHaveCount(0);
  await expect(page.locator(".fx-chain__status")).toHaveText(
    "Moved Colorize to position 2 of 2 in Clip",
  );

  // Clip → Global, after the Order.
  expect(
    await drag(
      page,
      device(page, "clip", "Colorize"),
      await rightOf(unit(page, "global", "Order")),
    ),
  ).toBe(true);
  await expect(device(page, "global", "Colorize")).toHaveCount(1);
  await expect(device(page, "clip", "Colorize")).toHaveCount(0);

  // Each move is one undo step.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(device(page, "clip", "Colorize")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(device(page, "layer", "Colorize")).toHaveCount(1);
});

test("a device can't be dropped on a stack it isn't designed for, or ahead of the clip's Text", async ({
  page,
}) => {
  await openTextClip(page, ["Transform", "Colorize"]);
  const order = unit(page, "global", "Order");
  const text = device(page, "clip", "Text");

  // Transform never goes on the Global stack.
  expect(
    await drag(page, device(page, "layer", "Transform"), await rightOf(order)),
  ).toBe(false);
  await expect(device(page, "layer", "Transform")).toHaveCount(1);
  await expect(device(page, "global", "Transform")).toHaveCount(0);

  // Nothing goes ahead of the clip's Text.
  const textBox = await text.boundingBox();
  expect(
    await drag(page, device(page, "layer", "Colorize"), {
      x: (textBox?.x ?? 0) + 2,
      y: (textBox?.y ?? 0) + 10,
    }),
  ).toBe(false);
  await expect(device(page, "layer", "Colorize")).toHaveCount(1);

  // The Text itself doesn't drag.
  expect(await drag(page, text, await rightOf(order))).toBe(false);
  await expect(text).toHaveCount(1);
  await expect(page.locator(".fx-chain [data-fx-group='clip']")).toHaveCount(1);
});

test("the keyboard and context menu move a device to another stack", async ({
  page,
}) => {
  await openTextClip(page, ["Transform"]);

  // Alt+Shift+Right sends the layer's Transform to the start of the Clip
  // stack, after the Text.
  await device(page, "layer", "Transform")
    .getByRole("button", { name: "Expand Transform" })
    .press("Alt+Shift+ArrowRight");
  await expect(device(page, "clip", "Transform")).toHaveCount(1);
  await expect(page.locator(".fx-chain__status")).toHaveText(
    "Moved Transform to position 2 of 2 in Clip",
  );

  // Transform can't go on the Global stack, so its menu won't offer it, and
  // Alt+Shift+Left skips over Global to the layer.
  await device(page, "clip", "Transform").click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Transform actions" });
  await menu.getByRole("menuitem", { name: "Move", exact: true }).hover();
  const move = page.getByRole("menu", { name: "Move" });
  await expect(
    move.getByRole("menuitem", { name: "to Global" }),
  ).toBeDisabled();
  await move.getByRole("menuitem", { name: "to Layer" }).click();
  await expect(device(page, "layer", "Transform")).toHaveCount(1);
  await expect(page.locator(".fx-chain__status")).toHaveText(
    "Moved Transform to position 2 of 2 in Layer 2",
  );

  // The Text has no move actions.
  await device(page, "clip", "Text").click({ button: "right" });
  const textMenu = page.getByRole("menu", { name: "Text actions" });
  await textMenu.getByRole("menuitem", { name: "Move", exact: true }).hover();
  for (const name of ["Left", "Right", "to Global", "to Layer", "to Clip"]) {
    await expect(move.getByRole("menuitem", { name })).toBeDisabled();
  }
});
