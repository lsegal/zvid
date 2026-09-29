import { expect, type Locator, type Page, test } from "@playwright/test";

// Right-click menus on layer headers and the Audio row, driven in the real
// app. Default layers: "1" is Layer 1, "5" is Layer 2 and "6" is Layer 3.

function header(page: Page, id: string) {
  return page.locator(`[data-layer-header-id="${id}"]`);
}

function headers(page: Page) {
  return page.locator("[data-layer-header-id]");
}

// Scrolling closes an open menu, so bring the target into view (and let its
// scroll event fire) before right-clicking it.
async function rightClick(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator
    .page()
    .evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  await locator.click({ button: "right" });
}

function menuItem(page: Page, name: string) {
  return page.getByRole("menuitem", { name, exact: true });
}

async function openLayerMenu(page: Page, id: string) {
  await rightClick(header(page, id));
  const menu = page.getByRole("menu", { name: "Layer header actions" });
  await expect(menu).toBeVisible();
  return menu;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(header(page, "1")).toBeVisible();
});

test("Insert text at playhead adds a text clip on the layer", async ({
  page,
}) => {
  await openLayerMenu(page, "5");
  await menuItem(page, "Insert text at playhead").click();
  const text = page.locator('[data-timeline-lane-id="5"] .clip-card--text');
  await expect(text).toHaveCount(1);
  await expect(text).toHaveClass(/clip-card--selected/);
  await expect(page.locator('section[aria-label="Text"]')).toBeVisible();
});

test("right-clicking a layer header selects it and lists the layer actions", async ({
  page,
}) => {
  const menu = await openLayerMenu(page, "5");
  await expect(page.locator(".fx-panel__toggle")).toHaveText("Layer 2 Effects");
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Rename…",
    "Duplicate",
    "Delete",
    /^(Enable|Disable) FX$/,
    "Add FX",
    "Insert text at playhead",
    "Insert layer above",
    "Insert layer below",
    "Move up",
    "Move down",
  ]);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // The top layer cannot move up, the bottom one cannot move down.
  await openLayerMenu(page, "1");
  await expect(menuItem(page, "Move up")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Escape");
  await openLayerMenu(page, "6");
  await expect(menuItem(page, "Move down")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Escape");

  // Shift+F10 on the focused layer header opens the same menu.
  await header(page, "6").locator(".track-label__select").focus();
  await page.keyboard.press("Shift+F10");
  await expect(
    page.getByRole("menu", { name: "Layer header actions" }),
  ).toBeVisible();
});

test("layer actions reorder, insert, duplicate, rename and delete, each undoable", async ({
  page,
}) => {
  const undo = () => page.keyboard.press("ControlOrMeta+z");
  const names = headers(page).locator(".track-label__select > span");
  const numbers = headers(page).locator(".track-label__index");
  await expect(names).toHaveText(["Layer 1", "Layer 2", "Layer 3"]);

  // Move up: the numbers follow the new order.
  await openLayerMenu(page, "5");
  await menuItem(page, "Move up").click();
  await expect(names).toHaveText(["Layer 2", "Layer 1", "Layer 3"]);
  await expect(numbers).toHaveText(["1", "2", "3"]);
  await undo();
  await expect(names).toHaveText(["Layer 1", "Layer 2", "Layer 3"]);

  await openLayerMenu(page, "5");
  await menuItem(page, "Insert layer above").click();
  await expect(names).toHaveText(["Layer 1", "Layer 4", "Layer 2", "Layer 3"]);
  await undo();
  await expect(names).toHaveText(["Layer 1", "Layer 2", "Layer 3"]);

  await openLayerMenu(page, "5");
  await menuItem(page, "Duplicate").click();
  await expect(names).toHaveText([
    "Layer 1",
    "Layer 2",
    "Layer 2 copy",
    "Layer 3",
  ]);
  await undo();
  await expect(names).toHaveText(["Layer 1", "Layer 2", "Layer 3"]);

  // Rename: Escape cancels, Enter saves.
  await openLayerMenu(page, "5");
  await menuItem(page, "Rename…").click();
  const input = page.getByRole("textbox", { name: "Layer name" });
  await expect(input).toBeFocused();
  await input.fill("Ignored");
  await input.press("Escape");
  await expect(names).toHaveText(["Layer 1", "Layer 2", "Layer 3"]);
  await openLayerMenu(page, "5");
  await menuItem(page, "Rename…").click();
  await expect(input).toBeFocused();
  await input.fill("Drums");
  await input.press("Enter");
  await expect(names).toHaveText(["Layer 1", "Drums", "Layer 3"]);
  await undo();
  await expect(names).toHaveText(["Layer 1", "Layer 2", "Layer 3"]);

  await openLayerMenu(page, "1");
  await menuItem(page, "Delete").click();
  await expect(names).toHaveText(["Layer 2", "Layer 3"]);
  await undo();
  await expect(names).toHaveText(["Layer 1", "Layer 2", "Layer 3"]);
});

test("Add FX adds to the layer and the FX toggle follows it", async ({
  page,
}) => {
  await openLayerMenu(page, "6");
  await menuItem(page, "Add FX").hover();
  const submenu = page.getByRole("menu", { name: "Add FX" });
  await expect(submenu).toBeVisible();
  const first = submenu.getByRole("menuitem").first();
  const effectName = (await first.textContent()) ?? "";
  await first.click();
  await expect(submenu).toBeHidden();
  await expect(page.locator(".fx-panel__toggle")).toHaveText("Layer 3 Effects");
  await expect(page.locator(".fx-panel")).toContainText(effectName);

  await openLayerMenu(page, "6");
  await menuItem(page, "Disable FX").click();
  await openLayerMenu(page, "6");
  await expect(menuItem(page, "Enable FX")).toBeVisible();
});

test("the Audio row offers to import main audio", async ({ page }) => {
  const audioRow = page.locator("[data-main-audio-drop-target]");
  await rightClick(audioRow.locator(".track-label"));
  const menu = page.getByRole("menu", { name: "Main audio actions" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText(["Import main audio…"]);

  const chooser = page.waitForEvent("filechooser");
  await menuItem(page, "Import main audio…").click();
  await chooser;
  await expect(menu).toBeHidden();
});
