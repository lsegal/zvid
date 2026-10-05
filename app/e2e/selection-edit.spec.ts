import { expect, type Locator, type Page, test } from "@playwright/test";
import { addLayers } from "./layers.ts";

// A drawn range selection moves when its body is dragged, onto another
// layer too, and resizes from either edge handle. A click inside it keeps
// it; a click anywhere else in the timeline clears it (#918).

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Element is not visible");
  }
  return box;
}

// Drags from the center of `from` by `dx` to `toY`, past the click
// threshold.
async function dragBy(page: Page, from: Locator, dx: number, toY?: number) {
  const box = await boxOf(from);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, (y + (toY ?? y)) / 2, { steps: 4 });
  await page.mouse.move(x + dx, toY ?? y, { steps: 4 });
  await page.mouse.up();
}

// Draws a selection on the lane from `fromX` to `toX` past its left edge.
async function drawSelection(target: Locator, fromX: number, toX: number) {
  const page = target.page();
  const bounds = await boxOf(target);
  const y = bounds.y + 20;
  await page.mouse.move(bounds.x + fromX, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + toX, y, { steps: 4 });
  await page.mouse.up();
  const selection = target.locator(".timeline-selection");
  await expect(selection).toBeVisible();
  return selection;
}

// The docked Audio row leaves less room for layers; all three layers fit at
// this size.
test.use({ viewport: { width: 1600, height: 1200 } });

// Layers: "1" is Layer 1, and addLayers adds "2" (Layer 2) and "3" (Layer 3).
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await addLayers(page);
  await expect(lane(page, "3")).toBeVisible();
  await page.locator(".timeline-scroll").evaluate((element) => {
    element.scrollLeft = 0;
  });
});

test("dragging a selection moves it in time and onto another layer", async ({
  page,
}) => {
  const selection = await drawSelection(lane(page, "2"), 40, 280);
  const before = await boxOf(selection);
  await expect(selection).toContainText("Press 1-9 to commit");

  // Along its own layer.
  await dragBy(page, selection, 120);
  await expect
    .poll(async () => (await boxOf(selection)).x - before.x)
    .toBeGreaterThan(80);
  const moved = await boxOf(selection);
  expect(moved.width).toBeCloseTo(before.width, 0);

  // Onto Layer 3.
  const target = await boxOf(lane(page, "3"));
  await dragBy(page, selection, 0, target.y + target.height / 2);
  const onLayer3 = lane(page, "3").locator(".timeline-selection");
  await expect(onLayer3).toHaveCount(1);
  await expect(lane(page, "2").locator(".timeline-selection")).toHaveCount(0);
  const landed = await boxOf(onLayer3);
  expect(landed.x).toBeCloseTo(moved.x, 0);
  expect(landed.width).toBeCloseTo(before.width, 0);
  await expect(onLayer3).toContainText("Press 1-9 to commit");

  // Its menu still opens on a right-click inside it.
  await page.mouse.click(
    landed.x + landed.width / 2,
    landed.y + landed.height / 2,
    { button: "right" },
  );
  await expect(
    page.getByRole("menu", { name: "Selection actions" }),
  ).toBeVisible();
  await expect(onLayer3).toBeVisible();
});

test("dragging an edge handle resizes the selection from that edge", async ({
  page,
}) => {
  const selection = await drawSelection(lane(page, "2"), 200, 440);
  const before = await boxOf(selection);
  const right = before.x + before.width;

  // The end handle moves the end and keeps the start.
  await dragBy(
    page,
    selection.locator(".timeline-selection__handle--end"),
    120,
  );
  await expect
    .poll(async () => (await boxOf(selection)).width - before.width)
    .toBeGreaterThan(80);
  const widened = await boxOf(selection);
  expect(widened.x).toBeCloseTo(before.x, 0);

  // The start handle moves the start and keeps the end.
  await dragBy(
    page,
    selection.locator(".timeline-selection__handle--start"),
    -120,
  );
  await expect
    .poll(async () => before.x - (await boxOf(selection)).x)
    .toBeGreaterThan(80);
  const resized = await boxOf(selection);
  expect(resized.x + resized.width).toBeCloseTo(widened.x + widened.width, 0);
  expect(widened.x + widened.width).toBeGreaterThan(right);

  // Dragging the start past the end leaves the shortest selection.
  await dragBy(
    page,
    selection.locator(".timeline-selection__handle--start"),
    800,
  );
  await expect(selection).toHaveCount(1);
  const shortest = await boxOf(selection);
  expect(shortest.width).toBeLessThan(40);
  expect(shortest.x + shortest.width).toBeCloseTo(resized.x + resized.width, 0);
});

test("a click inside the selection keeps it and a click outside clears it", async ({
  page,
}) => {
  const selection = await drawSelection(lane(page, "2"), 40, 280);
  const before = await boxOf(selection);

  // A click, or a press with jitter under the drag threshold, keeps it in
  // place.
  await page.mouse.click(before.x + before.width / 2, before.y + 10);
  await expect(selection).toHaveCount(1);
  const x = before.x + before.width / 2;
  await page.mouse.move(x, before.y + 10);
  await page.mouse.down();
  await page.mouse.move(x + 2, before.y + 10);
  await page.mouse.up();
  const after = await boxOf(selection);
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.width).toBeCloseTo(before.width, 0);

  // A click on the same layer outside it clears it.
  const laneBox = await boxOf(lane(page, "2"));
  await page.mouse.click(laneBox.x + 500, laneBox.y + 20);
  await expect(page.locator(".timeline-selection")).toHaveCount(0);

  // So does a click on another layer.
  await drawSelection(lane(page, "2"), 40, 280);
  const otherLane = await boxOf(lane(page, "3"));
  await page.mouse.click(otherLane.x + 100, otherLane.y + 20);
  await expect(page.locator(".timeline-selection")).toHaveCount(0);

  // And a click on the ruler.
  await drawSelection(lane(page, "2"), 40, 280);
  const ruler = await boxOf(page.locator(".ruler-row__content"));
  await page.mouse.click(ruler.x + 500, ruler.y + ruler.height / 2);
  await expect(page.locator(".timeline-selection")).toHaveCount(0);

  // Escape still clears it.
  await drawSelection(lane(page, "2"), 40, 280);
  await page.keyboard.press("Escape");
  await expect(page.locator(".timeline-selection")).toHaveCount(0);
});
