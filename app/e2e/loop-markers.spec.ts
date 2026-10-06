import { expect, type Page, test } from "@playwright/test";

// The loop region in the ruler's loop strip: L locks a playback selection
// into it, it resizes from its edges, moves from its middle and deletes on
// a double-click, and the strip's right-click menu places its markers.

async function stripGeometry(page: Page) {
  const view = await page.locator(".timeline-scroll").boundingBox();
  const strip = await page.locator(".ruler-loop-strip").boundingBox();
  if (!view || !strip) {
    throw new Error("loop strip is not visible");
  }
  return { view, strip, y: strip.y + strip.height / 2 };
}

async function drag(page: Page, fromX: number, toX: number, y: number) {
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  await page.mouse.move(toX, y, { steps: 10 });
  await page.mouse.up();
}

async function loopEnds(page: Page) {
  const region = page.locator(".ruler-loop-region");
  return {
    startQ: Number(await region.getAttribute("data-start-q")),
    endQ: Number(await region.getAttribute("data-end-q")),
  };
}

async function center(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  if (!box) {
    throw new Error(`${selector} is not visible`);
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator('[data-timeline-lane-id="1"]')).toBeVisible();
});

test("L locks the selection into a loop that resizes, moves and deletes", async ({
  page,
}) => {
  const region = page.locator(".ruler-loop-region");
  const { view, y } = await stripGeometry(page);

  // L with no playback selection does nothing.
  await page.keyboard.press("l");
  await expect(region).toHaveCount(0);

  await drag(page, view.x + view.width * 0.3, view.x + view.width * 0.5, y);
  const selection = page.locator(".ruler-loop-strip__selection");
  const selectedStartQ = Number(await selection.getAttribute("data-start-q"));
  const selectedEndQ = Number(await selection.getAttribute("data-end-q"));

  await page.keyboard.press("l");
  await expect(region).toBeVisible();
  await expect(selection).toHaveCount(0);
  await expect(page.locator(".ruler-playback-selection")).toHaveCount(0);
  await expect(page.locator(".ruler-loop-region__marker--in")).toBeVisible();
  await expect(page.locator(".ruler-loop-region__marker--out")).toBeVisible();
  expect(await loopEnds(page)).toEqual({
    startQ: selectedStartQ,
    endQ: selectedEndQ,
  });

  // Only the hovered handle shows, with the clip trim cursor.
  const endHandle = ".ruler-loop-region__handle--end";
  const handleOpacity = (selector: string) =>
    page
      .locator(selector)
      .evaluate((element) => Number(getComputedStyle(element).opacity));
  const end = await center(page, endHandle);
  await page.mouse.move(end.x, end.y);
  await expect.poll(() => handleOpacity(endHandle)).toBeGreaterThan(0);
  expect(await handleOpacity(".ruler-loop-region__handle--start")).toBe(0);
  expect(
    await page
      .locator(endHandle)
      .evaluate((element) => getComputedStyle(element).cursor),
  ).toBe("ew-resize");

  // Dragging the out marker's handle resizes only that end.
  await drag(page, end.x, end.x + view.width * 0.1, end.y);
  const resized = await loopEnds(page);
  expect(resized.startQ).toBe(selectedStartQ);
  expect(resized.endQ).toBeGreaterThan(selectedEndQ);

  // Dragging the in marker's handle past the out marker stops short of it.
  const start = await center(page, ".ruler-loop-region__handle--start");
  await drag(page, start.x, start.x + view.width * 0.5, start.y);
  const clamped = await loopEnds(page);
  expect(clamped.startQ).toBeLessThan(clamped.endQ);
  expect(clamped.endQ).toBe(resized.endQ);

  // Put the in marker back, then drag the middle: the loop keeps its length.
  const narrowStart = await center(page, ".ruler-loop-region__handle--start");
  await drag(page, narrowStart.x, start.x, narrowStart.y);
  const beforeMove = await loopEnds(page);
  const body = await center(page, ".ruler-loop-region__body");
  await drag(page, body.x, body.x - view.width * 0.1, body.y);
  const moved = await loopEnds(page);
  expect(moved.startQ).toBeLessThan(beforeMove.startQ);
  expect(moved.endQ - moved.startQ).toBeCloseTo(
    beforeMove.endQ - beforeMove.startQ,
    6,
  );

  const movedBody = await center(page, ".ruler-loop-region__body");
  await page.mouse.dblclick(movedBody.x, movedBody.y);
  await expect(region).toHaveCount(0);
});

test("the loop strip menu places markers, locks a selection and deletes the loop", async ({
  page,
}) => {
  const region = page.locator(".ruler-loop-region");
  // An item's name ends with its shortcut, if it has one.
  const menuItem = (name: string) =>
    page.getByRole("menuitem", { name: new RegExp(`^${name}( |$)`) });
  const { view, y } = await stripGeometry(page);
  const timecode = page.locator(".timeline-toolbar__display > span").nth(1);
  const timecodeBefore = await timecode.textContent();

  await page.mouse.click(view.x + view.width * 0.6, y, { button: "right" });
  await expect(page.getByRole("menu", { name: "Loop actions" })).toBeVisible();
  await expect(menuItem("Create loop in marker")).toBeVisible();
  await expect(menuItem("Create loop out marker")).toBeVisible();
  await expect(menuItem("Create loop area")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(menuItem("Delete loop")).toHaveAttribute(
    "aria-disabled",
    "true",
  );

  // An out marker alone starts the loop at the timeline start.
  await menuItem("Create loop out marker").click();
  await expect(region).toBeVisible();
  const outOnly = await loopEnds(page);
  expect(outOnly.startQ).toBe(0);
  expect(outOnly.endQ).toBeGreaterThan(0);

  // An in marker moves the start and keeps the end.
  await page.mouse.click(view.x + view.width * 0.4, y, { button: "right" });
  await menuItem("Create loop in marker").click();
  const placed = await loopEnds(page);
  expect(placed.startQ).toBeGreaterThan(0);
  expect(placed.endQ).toBe(outOnly.endQ);

  // Create loop area does what L does.
  await drag(page, view.x + view.width * 0.7, view.x + view.width * 0.85, y);
  const selection = page.locator(".ruler-loop-strip__selection");
  const selectedStartQ = Number(await selection.getAttribute("data-start-q"));
  await page.mouse.click(view.x + view.width * 0.75, y, { button: "right" });
  await menuItem("Create loop area").click();
  await expect(selection).toHaveCount(0);
  expect((await loopEnds(page)).startQ).toBe(selectedStartQ);

  await page.mouse.click(view.x + view.width * 0.2, y, { button: "right" });
  await menuItem("Delete loop").click();
  await expect(region).toHaveCount(0);
  // Choosing items never scrubs the ruler under them.
  await expect(timecode).toHaveText(timecodeBefore ?? "");
});

test("Create loop in and out marker always make a full loop at the click", async ({
  page,
}) => {
  const region = page.locator(".ruler-loop-region");
  const menuItem = (name: string) =>
    page.getByRole("menuitem", { name: new RegExp(`^${name}( |$)`) });
  const { view, strip, y } = await stripGeometry(page);
  // The visible part of the strip, right of the layer headers.
  const left = strip.x;
  const right = view.x + view.width;
  const at = (fraction: number) => left + (right - left) * fraction;
  const place = async (x: number, name: string) => {
    await page.mouse.click(x, y, { button: "right" });
    await menuItem(name).click();
    await expect(region).toBeVisible();
    const ends = await loopEnds(page);
    const box = await region.boundingBox();
    if (!box) {
      throw new Error("loop brace is not visible");
    }
    return { ...ends, box };
  };

  const outOnly = await place(
    view.x + view.width * 0.5,
    "Create loop out marker",
  );
  expect(outOnly.startQ).toBe(0);
  expect(outOnly.endQ).toBeGreaterThan(0);
  const quarterPx = outOnly.box.width / outOnly.endQ;
  const snapPx = quarterPx;

  // An in marker just before the out marker starts a full loop instead of
  // shrinking to a sliver against the out marker.
  const outX = outOnly.box.x + outOnly.box.width;
  const justBefore = await place(
    outX - quarterPx * 0.3,
    "Create loop in marker",
  );
  expect(justBefore.box.x + justBefore.box.width).toBeGreaterThanOrEqual(
    right - 1,
  );

  // An in marker past the out marker starts a loop at the click instead of
  // shrinking to a sliver at the out marker. The blank session's content
  // ends at bar 2, so the loop runs on to the timeline end.
  const inX = at(0.75);
  const pastOut = await place(inX, "Create loop in marker");
  expect(pastOut.startQ).toBeGreaterThan(outOnly.endQ);
  expect(Math.abs(pastOut.box.x - inX)).toBeLessThan(snapPx);
  expect(pastOut.box.x + pastOut.box.width).toBeGreaterThanOrEqual(right - 1);

  // An out marker before the in marker runs the loop from the timeline start.
  const beforeInX = at(0.25);
  const beforeIn = await place(beforeInX, "Create loop out marker");
  expect(beforeIn.startQ).toBe(0);
  expect(beforeIn.endQ).toBeLessThan(pastOut.startQ);
  expect(Math.abs(beforeIn.box.x - left)).toBeLessThan(1);
  expect(
    Math.abs(beforeIn.box.x + beforeIn.box.width - beforeInX),
  ).toBeLessThan(snapPx);

  // With no loop, an in marker before the content end runs to it.
  await page.mouse.click(at(0.5), y, { button: "right" });
  await menuItem("Delete loop").click();
  await expect(region).toHaveCount(0);
  const beforeEnd = await place(
    strip.x + quarterPx * 1.1,
    "Create loop in marker",
  );
  expect(beforeEnd.startQ).toBe(1);
  expect(beforeEnd.endQ).toBe(4);
  expect(beforeEnd.box.width).toBeCloseTo(3 * quarterPx, 0);
});
