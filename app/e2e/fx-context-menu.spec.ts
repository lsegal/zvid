import { expect, type Page, test } from "@playwright/test";

// The device menus' Cut, Copy, Move to another stack, and the stacks' own
// menus with Paste and Clear All. Each action is one undo step.

function device(page: Page, group: string, name: string) {
  return page.locator(
    `.fx-chain :is(section[data-fx-group="${group}"], [data-fx-group="${group}"] > section)[aria-label="${name}"]`,
  );
}

async function openDeviceMenu(page: Page, group: string, name: string) {
  await device(page, group, name)
    .locator(".fx-device-panel__title")
    .click({ button: "right" });
  return page.getByRole("menu", { name: `${name} actions` });
}

async function openStackMenu(page: Page, addLabel: string, stack: string) {
  await page.getByRole("button", { name: addLabel }).click({ button: "right" });
  return page.getByRole("menu", { name: `${stack} stack actions` });
}

function item(page: Page, name: string) {
  return page.getByRole("menuitem", { name, exact: true });
}

// Layer 1 with a Transform on its own stack, and a selected text clip on it.
async function setUp(page: Page) {
  await page.goto("/");
  const header = page.locator('[data-layer-header-id="1"]');
  await header.click();
  await page.getByRole("button", { name: "Add device to this layer" }).click();
  await item(page, "Transform").press("ArrowRight");
  await page
    .getByRole("menu")
    .last()
    .getByRole("menuitem", { name: /^Transform/ })
    .click();
  await expect(device(page, "layer", "Transform")).toHaveCount(1);

  await header.click({ button: "right" });
  await item(page, "Insert text at playhead").click();
  await expect(device(page, "clip", "Text")).toHaveCount(1);
}

test("a device's menu moves it to another stack where allowed", async ({
  page,
}) => {
  await setUp(page);

  const menu = await openDeviceMenu(page, "layer", "Transform");
  for (const name of ["Cut", "Copy", "Duplicate", /^Delete/, "Move"]) {
    await expect(
      menu.getByRole("menuitem", { name, exact: true }),
    ).toBeEnabled();
  }
  await item(page, "Move").hover();
  const move = page.getByRole("menu", { name: "Move" });
  // Transform places one layer, so it can't sit on the Global stack.
  await expect(
    move.getByRole("menuitem", { name: "to Global" }),
  ).toBeDisabled();
  await expect(move.getByRole("menuitem", { name: "to Layer" })).toBeDisabled();
  await move.getByRole("menuitem", { name: "to Clip" }).click();

  await expect(device(page, "layer", "Transform")).toHaveCount(0);
  await expect(device(page, "clip", "Transform")).toHaveCount(1);
  await expect(page.locator(".fx-chain__status")).toHaveText(
    "Moved Transform to position 2 of 2 in Clip",
  );

  await openDeviceMenu(page, "clip", "Transform");
  await item(page, "Move").hover();
  await move.getByRole("menuitem", { name: "to Layer" }).click();
  await expect(device(page, "layer", "Transform")).toHaveCount(1);
  await expect(device(page, "clip", "Transform")).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(device(page, "clip", "Transform")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(device(page, "layer", "Transform")).toHaveCount(1);
  await expect(device(page, "clip", "Transform")).toHaveCount(0);
});

test("the clip's content device stays on its stack", async ({ page }) => {
  await setUp(page);

  const menu = await openDeviceMenu(page, "clip", "Text");
  await expect(menu.getByRole("menuitem", { name: "Cut" })).toBeDisabled();
  await expect(menu.getByRole("menuitem", { name: "Copy" })).toBeEnabled();
  await expect(menu.getByRole("menuitem", { name: /^Delete/ })).toBeDisabled();
  await item(page, "Move").hover();
  const move = page.getByRole("menu", { name: "Move" });
  for (const name of ["to Global", "to Layer", "to Clip"]) {
    await expect(move.getByRole("menuitem", { name })).toBeDisabled();
  }
});

test("copy and cut paste onto the right-clicked stack only", async ({
  page,
}) => {
  await setUp(page);

  await openDeviceMenu(page, "layer", "Transform");
  await item(page, "Copy").click();
  await expect(page.locator(".fx-chain__status")).toHaveText(
    "Copied Transform",
  );

  // Transform isn't designed for the Global stack.
  const global = await openStackMenu(page, "Add device to Global", "Global");
  await expect(global.getByRole("menuitem", { name: "Paste" })).toBeDisabled();
  await page.keyboard.press("Escape");

  await openStackMenu(page, "Add device to this clip", "Clip");
  await item(page, "Paste").click();
  await expect(device(page, "clip", "Transform")).toHaveCount(1);
  await expect(device(page, "layer", "Transform")).toHaveCount(1);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(device(page, "clip", "Transform")).toHaveCount(0);

  await openDeviceMenu(page, "layer", "Transform");
  await item(page, "Cut").click();
  await expect(device(page, "layer", "Transform")).toHaveCount(0);

  await openStackMenu(page, "Add device to this clip", "Clip");
  await item(page, "Paste").click();
  await expect(device(page, "clip", "Transform")).toHaveCount(1);
  await expect(device(page, "layer", "Transform")).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(device(page, "layer", "Transform")).toHaveCount(1);
  await expect(device(page, "clip", "Transform")).toHaveCount(0);
});

test("Clear All keeps Global, Layout and the clip's content", async ({
  page,
}) => {
  await setUp(page);
  await openDeviceMenu(page, "layer", "Transform");
  await item(page, "Copy").click();
  await openStackMenu(page, "Add device to this clip", "Clip");
  await item(page, "Paste").click();
  await expect(device(page, "clip", "Transform")).toHaveCount(1);

  await openStackMenu(page, "Add device to this layer", "Layer");
  await item(page, "Clear All").click();
  await expect(device(page, "layer", "Transform")).toHaveCount(0);
  await expect(device(page, "clip", "Transform")).toHaveCount(0);
  await expect(device(page, "layer", "Layout")).toHaveCount(1);
  await expect(device(page, "clip", "Text")).toHaveCount(1);
  await expect(device(page, "global", "Order")).toHaveCount(1);
  await expect(page.locator(".fx-chain__status")).toHaveText(
    "Cleared 2 devices",
  );

  const menu = await openStackMenu(page, "Add device to this clip", "Clip");
  await expect(
    menu.getByRole("menuitem", { name: "Clear All" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");

  await page.keyboard.press("ControlOrMeta+z");
  await expect(device(page, "layer", "Transform")).toHaveCount(1);
  await expect(device(page, "clip", "Transform")).toHaveCount(1);
});
