import { expect, type Locator, type Page, test } from "@playwright/test";

// Double-clicking empty lane space selects one cell of the finest grid
// drawn, with Snap on or off, and the cell follows the zoom (#1196).

test.use({ viewport: { width: 1600, height: 1200 } });

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) {
    throw new Error("element is not visible");
  }
  return bounds;
}

// The spacing of the finest grid lines the lane draws, in pixels: the lane
// paints its strongest lines first, so the finest are the last layer.
function finestGridPx(lane: Locator) {
  return lane.evaluate((element) => {
    const sizes = getComputedStyle(element).backgroundSize.split(",");
    return Number.parseFloat(sizes[sizes.length - 1]);
  });
}

// Double-clicks `offsetX` into the lane and checks the selection is the
// grid cell under it.
async function expectCellAt(page: Page, lane: Locator, offsetX: number) {
  const laneBox = await box(lane);
  await page.mouse.dblclick(laneBox.x + offsetX, laneBox.y + 20);
  const selection = lane.locator(".timeline-selection");
  await expect(selection).toHaveCount(1);
  const cellPx = await finestGridPx(lane);
  const selectionBox = await box(selection);
  // Measured from the lane's padding edge, where the grid starts.
  const left = await selection.evaluate((element) =>
    Number.parseFloat((element as HTMLElement).style.left),
  );
  expect(selectionBox.width).toBeCloseTo(cellPx, 0);
  // It starts on the grid line at or before the click.
  expect(Math.abs(left / cellPx - Math.round(left / cellPx))).toBeLessThan(
    0.05,
  );
  expect(left).toBeLessThanOrEqual(offsetX + 1);
  expect(left + selectionBox.width).toBeGreaterThan(offsetX - 1);
  return cellPx;
}

test("double-clicking empty lane space selects one grid cell", async ({
  page,
}) => {
  await page.goto("/");
  const lane = page.locator('[data-timeline-lane-id="1"]');
  await expect(lane).toBeVisible();
  const snap = page.getByRole("button", { name: /^Snap (On|Off)$/ });

  await expect(snap).toHaveAccessibleName("Snap On");
  const zoomedOut = await expectCellAt(page, lane, 213);

  // Snap off still lines the cell up with the grid.
  await snap.click();
  await expect(snap).toHaveAccessibleName("Snap Off");
  await expectCellAt(page, lane, 377);

  // Zooming in makes the cell match the finer grid lines.
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  for (let step = 0; step < 4 && (await zoomIn.isEnabled()); step += 1) {
    await zoomIn.click();
  }
  const zoomedInPx = await expectCellAt(page, lane, 301);
  expect(zoomedInPx).not.toBeCloseTo(zoomedOut, 0);

  // The selection is the same as a dragged one: its edge resizes it.
  const selection = lane.locator(".timeline-selection");
  const before = await box(selection);
  const end = await box(
    page.getByRole("button", { name: "Resize selection end" }),
  );
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2 + 120, end.y + end.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await box(selection)).width)
    .toBeGreaterThan(before.width + 60);
});
