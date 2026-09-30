import { expect, type Locator, type Page, test } from "@playwright/test";

// Reordering layers from the grip left of each header's number (#478).
// Default layers: "1" is Layer 1, "5" is Layer 2 and "6" is Layer 3.

function header(page: Page, id: string) {
  return page.locator(`[data-layer-header-id="${id}"]`);
}

function grip(page: Page, id: string) {
  return page.locator(`[data-layer-grip="${id}"]`);
}

function names(page: Page) {
  return page.locator("[data-layer-header-id] .track-label__select > span");
}

function numbers(page: Page) {
  return page.locator("[data-layer-header-id] .track-label__index");
}

function status(page: Page) {
  return page.locator(".layer-reorder-status");
}

async function openLayerMenu(page: Page, id: string) {
  const target = header(page, id);
  await target.scrollIntoViewIfNeeded();
  await target.click({ button: "right" });
  await expect(
    page.getByRole("menu", { name: "Layer header actions" }),
  ).toBeVisible();
}

function menuItem(page: Page, name: string) {
  return page.getByRole("menuitem", { name, exact: true });
}

async function center(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Not visible");
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Adds Layer 4 below Layer 3, with a text clip and an effect of its own.
async function addLayer4(page: Page) {
  await openLayerMenu(page, "6");
  await menuItem(page, "Insert layer below").click();
  await expect(names(page)).toHaveText([
    "Layer 1",
    "Layer 2",
    "Layer 3",
    "Layer 4",
  ]);
  const id = await page
    .locator("[data-layer-header-id]")
    .nth(3)
    .getAttribute("data-layer-header-id");
  if (!id) {
    throw new Error("Layer 4 has no id");
  }

  await openLayerMenu(page, id);
  await menuItem(page, "Insert text at playhead").click();
  await expect(
    page.locator(`[data-timeline-lane-id="${id}"] .clip-card--text`),
  ).toHaveCount(1);

  await openLayerMenu(page, id);
  await menuItem(page, "Add FX").hover();
  const submenu = page.getByRole("menu", { name: "Add FX" });
  await submenu.getByRole("menuitem").first().click();
  await expect(submenu).toBeHidden();
  await expect(header(page, id).locator(".track-label__fx")).toBeEnabled();
  return id;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(header(page, "1")).toBeVisible();
});

test("each layer header has a grip left of its number", async ({ page }) => {
  for (const id of ["1", "5", "6"]) {
    const handle = await grip(page, id).boundingBox();
    const number = await header(page, id)
      .locator(".track-label__index")
      .boundingBox();
    expect(handle && number && handle.x + handle.width <= number.x).toBe(true);
  }
  await expect(grip(page, "5")).toHaveAccessibleName("Reorder Layer 2");
});

test("dragging Layer 4 above Layer 1 carries its clips and effects, in one undo step", async ({
  page,
}) => {
  const id = await addLayer4(page);
  const from = await center(grip(page, id));
  const ruler = await page.locator(".ruler-row").boundingBox();
  if (!ruler) {
    throw new Error("No ruler");
  }

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y - 10, { steps: 2 });
  const row = page.locator(`[data-layer-row-id="${id}"]`);
  await expect(row).toHaveClass(/track-row--lifted/);
  // Up past Layer 1, scrolling the list as it goes.
  await page.mouse.move(from.x, ruler.y + ruler.height + 4, { steps: 12 });
  await expect(status(page)).toHaveText("Layer 4, position 1 of 4");
  await expect(page.locator(".layer-drop-indicator")).toBeVisible();
  await page.mouse.up();

  await expect(names(page)).toHaveText([
    "Layer 4",
    "Layer 1",
    "Layer 2",
    "Layer 3",
  ]);
  await expect(numbers(page)).toHaveText(["1", "2", "3", "4"]);
  await expect(row).not.toHaveClass(/track-row--lifted/);
  // Same layer id, so its clip and effects came with it; it stays selected.
  await expect(
    page.locator(`[data-timeline-lane-id="${id}"] .clip-card--text`),
  ).toHaveCount(1);
  await expect(header(page, id).locator(".track-label__fx")).toBeEnabled();
  await expect(page.locator(".fx-panel__toggle")).toHaveText("Layer 4 Effects");

  await page.keyboard.press("ControlOrMeta+z");
  await expect(names(page)).toHaveText([
    "Layer 1",
    "Layer 2",
    "Layer 3",
    "Layer 4",
  ]);
  await expect(
    page.locator(`[data-timeline-lane-id="${id}"] .clip-card--text`),
  ).toHaveCount(1);
});

test("holding a drag near the top edge scrolls, and Escape cancels it", async ({
  page,
}) => {
  const scroller = page.locator(".timeline-scroll");
  const from = await center(grip(page, "6"));
  expect(
    await scroller.evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
  const ruler = await page.locator(".ruler-row").boundingBox();
  if (!ruler) {
    throw new Error("No ruler");
  }

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Just below the sticky ruler: the list scrolls up under the pointer.
  await page.mouse.move(from.x, ruler.y + ruler.height + 4, { steps: 10 });
  await expect(status(page)).toHaveText("Layer 3, position 1 of 3");
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBe(0);
  await page.keyboard.press("Escape");
  await expect(status(page)).toHaveText("Canceled moving Layer 3");
  await page.mouse.up();
  await expect(names(page)).toHaveText(["Layer 1", "Layer 2", "Layer 3"]);
  await expect(page.locator(".track-row--lifted")).toHaveCount(0);
  await expect(page.locator(".layer-drop-indicator")).toBeHidden();
});

test("the keyboard picks a layer up, moves it and drops it", async ({
  page,
}) => {
  await grip(page, "6").focus();
  await page.keyboard.press("Space");
  await expect(status(page)).toContainText(
    "Picked up Layer 3, position 3 of 3",
  );
  await expect(grip(page, "6")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-layer-row-id="6"]')).toHaveClass(
    /track-row--lifted/,
  );
  await page.keyboard.press("ArrowUp");
  await expect(status(page)).toHaveText("Layer 3, position 2 of 3");
  await page.keyboard.press("ArrowUp");
  await expect(status(page)).toHaveText("Layer 3, position 1 of 3");
  // Still in place until dropped.
  await expect(names(page)).toHaveText(["Layer 1", "Layer 2", "Layer 3"]);
  await page.keyboard.press("Enter");
  await expect(status(page)).toHaveText("Dropped Layer 3, position 1 of 3");
  await expect(names(page)).toHaveText(["Layer 3", "Layer 1", "Layer 2"]);
  await expect(grip(page, "6")).toBeFocused();
  await expect(grip(page, "6")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".fx-panel__toggle")).toHaveText("Layer 3 Effects");

  // Escape puts it back where it was.
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(status(page)).toHaveText("Canceled moving Layer 3");
  await expect(names(page)).toHaveText(["Layer 3", "Layer 1", "Layer 2"]);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(names(page)).toHaveText(["Layer 1", "Layer 2", "Layer 3"]);
});

test("clicking the header outside the grip still selects the layer", async ({
  page,
}) => {
  await header(page, "6").locator(".track-label__index").click();
  await expect(page.locator(".fx-panel__toggle")).toHaveText("Layer 3 Effects");
  // A click on the grip without dragging selects too, and moves nothing.
  await grip(page, "5").click();
  await expect(page.locator(".fx-panel__toggle")).toHaveText("Layer 2 Effects");
  await expect(names(page)).toHaveText(["Layer 1", "Layer 2", "Layer 3"]);
  await expect(page.locator(".track-row--lifted")).toHaveCount(0);
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true });

  test("a long press on the grip picks the layer up", async ({ page }) => {
    const client = await page.context().newCDPSession(page);
    const touch = (
      type: "touchStart" | "touchMove" | "touchEnd",
      x: number,
      y: number,
    ) =>
      client.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x, y }],
      });
    const from = await center(grip(page, "5"));
    const row = await page.locator('[data-layer-row-id="5"]').boundingBox();
    if (!row) {
      throw new Error("No row");
    }

    // A quick touch that moves off is not a drag.
    await touch("touchStart", from.x, from.y);
    await touch("touchMove", from.x, from.y + 30);
    await touch("touchEnd", from.x, from.y + 30);
    await expect(page.locator(".track-row--lifted")).toHaveCount(0);

    await touch("touchStart", from.x, from.y);
    await expect(page.locator('[data-layer-row-id="5"]')).toHaveClass(
      /track-row--lifted/,
    );
    for (let step = 1; step <= 8; step += 1) {
      await touch("touchMove", from.x, from.y + (row.height * step) / 8 + 4);
    }
    await expect(status(page)).toHaveText("Layer 2, position 3 of 3");
    await touch("touchEnd", from.x, from.y + row.height + 4);
    await expect(names(page)).toHaveText(["Layer 1", "Layer 3", "Layer 2"]);
  });
});
