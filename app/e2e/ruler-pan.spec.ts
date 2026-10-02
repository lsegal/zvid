import { expect, type Page, test } from "@playwright/test";

// Hand-grab panning on the timeline ruler: the right and middle buttons pan
// the timeline, a right-drag up or down zooms around the pointer, the left
// button only scrubs the playhead, and the browser's context menu never
// opens there.

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

async function timelineState(page: Page) {
  return page.evaluate(() => {
    const zoom = document.querySelector(
      'input[aria-label="Timeline zoom"]',
    ) as HTMLInputElement;
    const scroll = document.querySelector(".timeline-scroll") as HTMLElement;
    const marker = document.querySelector(
      ".timeline-playhead-marker",
    ) as HTMLElement;
    const content = document.querySelector(
      ".ruler-row__content",
    ) as HTMLElement;
    return {
      zoom: Number(zoom.dataset.zoom),
      contentLeft: content.getBoundingClientRect().left,
      scrollLeft: scroll.scrollLeft,
      maxScrollLeft: scroll.scrollWidth - scroll.clientWidth,
      // The playhead's position within the timeline, independent of scroll.
      playheadX:
        marker.getBoundingClientRect().left -
        content.getBoundingClientRect().left,
    };
  });
}

// A point on the visible part of the ruler, which is wider than the view.
async function rulerPoint(page: Page) {
  const view = await page.locator(".timeline-scroll").boundingBox();
  const ruler = await page.locator(".ruler-row__content").boundingBox();
  if (!view || !ruler) {
    throw new Error("ruler is not visible");
  }
  return { x: view.x + view.width * 0.6, y: ruler.y + ruler.height / 2 };
}

// Records whether each contextmenu event reaching the window was canceled,
// which is what keeps the browser's own menu closed.
async function watchContextMenus(page: Page) {
  await page.evaluate(() => {
    const record: boolean[] = [];
    (window as unknown as { contextMenus: boolean[] }).contextMenus = record;
    window.addEventListener("contextmenu", (event) =>
      record.push(event.defaultPrevented),
    );
  });
}

function contextMenus(page: Page) {
  return page.evaluate(
    () => (window as unknown as { contextMenus: boolean[] }).contextMenus,
  );
}

// The timeline time at viewport x, in pixels at 100% zoom.
function timeAt(state: { zoom: number; contentLeft: number }, x: number) {
  return (x - state.contentLeft) / state.zoom;
}

async function drag(
  page: Page,
  button: "left" | "right" | "middle",
  from: { x: number; y: number },
  dx: number,
  dy = 0,
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 12 });
  await page.mouse.up({ button });
}

function undoItem(page: Page) {
  return page.getByRole("menuitem", { name: /^Undo/ });
}

async function expectUndoDisabled(page: Page, disabled: boolean) {
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  // Radix leaves aria-disabled off enabled items.
  const undo = expect(undoItem(page));
  await (disabled ? undo : undo.not).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
}

test.beforeEach(async ({ page }) => {
  // No momentum, so the pan lands exactly where the pointer let go.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await watchContextMenus(page);
});

test("right-dragging the ruler pans the timeline without moving the playhead", async ({
  page,
}) => {
  const before = await timelineState(page);
  expect(before.maxScrollLeft).toBeGreaterThan(200);

  const from = await rulerPoint(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(from.x - 100, from.y, { steps: 6 });
  await expect(page.locator(".ruler-row")).toHaveClass(/is-grab-panning/);
  await expect(page.locator(".ruler-row")).toHaveCSS("cursor", "grabbing");
  await page.mouse.move(from.x - 200, from.y, { steps: 6 });
  await page.mouse.up({ button: "right" });

  const after = await timelineState(page);
  expect(after.scrollLeft).toBe(before.scrollLeft + 200);
  expect(after.playheadX).toBeCloseTo(before.playheadX, 0);
  await expect(page.locator(".ruler-row")).not.toHaveClass(/is-grab-panning/);
  expect(await contextMenus(page)).not.toContain(false);

  // Dragging back the other way pans back.
  await drag(page, "right", from, 150);
  expect((await timelineState(page)).scrollLeft).toBe(after.scrollLeft - 150);
});

test("a right-click on the ruler without a drag does nothing and shows no browser menu", async ({
  page,
}) => {
  const before = await timelineState(page);
  const from = await rulerPoint(page);
  await page.mouse.click(from.x, from.y, { button: "right" });

  const after = await timelineState(page);
  expect(after.scrollLeft).toBe(before.scrollLeft);
  expect(after.playheadX).toBeCloseTo(before.playheadX, 0);
  const menus = await contextMenus(page);
  expect(menus.length).toBeGreaterThan(0);
  expect(menus).not.toContain(false);
});

test("middle-dragging the ruler pans too", async ({ page }) => {
  const before = await timelineState(page);
  await drag(page, "middle", await rulerPoint(page), -180);

  const after = await timelineState(page);
  expect(after.scrollLeft).toBe(before.scrollLeft + 180);
  expect(after.playheadX).toBeCloseTo(before.playheadX, 0);
});

test("left-dragging the ruler still scrubs the playhead", async ({ page }) => {
  const before = await timelineState(page);
  const from = await rulerPoint(page);
  await drag(page, "left", from, -120);

  const after = await timelineState(page);
  expect(after.scrollLeft).toBe(before.scrollLeft);
  expect(after.playheadX).not.toBeCloseTo(before.playheadX, 0);
});

test("left-dragging the ruler up or down scrubs without zooming", async ({
  page,
}) => {
  const before = await timelineState(page);
  const from = await rulerPoint(page);
  await drag(page, "left", from, -80, -150);

  let after = await timelineState(page);
  expect(after.zoom).toBe(before.zoom);
  expect(after.scrollLeft).toBe(before.scrollLeft);
  expect(after.playheadX).not.toBeCloseTo(before.playheadX, 0);

  await drag(page, "left", from, 40, 150);
  after = await timelineState(page);
  expect(after.zoom).toBe(before.zoom);
});

test("right-dragging the ruler up zooms in around the pointer without moving the playhead", async ({
  page,
}) => {
  await expectUndoDisabled(page, true);
  const before = await timelineState(page);
  const from = await rulerPoint(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(from.x, from.y - 60, { steps: 6 });
  await expect(page.locator(".ruler-row")).toHaveClass(/is-grab-panning/);
  await page.mouse.move(from.x, from.y - 100, { steps: 6 });
  await page.mouse.up({ button: "right" });

  const after = await timelineState(page);
  // 75px past the 25px threshold scales by e^0.004 per pixel.
  expect(after.zoom).toBeCloseTo(before.zoom * Math.exp(75 * 0.004), 2);
  expect(timeAt(after, from.x)).toBeCloseTo(timeAt(before, from.x), 0);
  expect(after.playheadX / after.zoom).toBeCloseTo(
    before.playheadX / before.zoom,
    0,
  );
  expect(await contextMenus(page)).not.toContain(false);

  // The whole drag is one undo step.
  await expectUndoDisabled(page, false);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await timelineState(page)).zoom).toBe(before.zoom);
  await expectUndoDisabled(page, true);
});

test("a diagonal right-drag pans and zooms at once, keeping the grabbed time under the pointer", async ({
  page,
}) => {
  const before = await timelineState(page);
  const from = await rulerPoint(page);
  const grabbed = timeAt(before, from.x);
  await drag(page, "right", from, -120, 80);

  const after = await timelineState(page);
  // 55px past the threshold downward zooms out.
  expect(after.zoom).toBeCloseTo(before.zoom * Math.exp(-55 * 0.004), 2);
  expect(timeAt(after, from.x - 120)).toBeCloseTo(grabbed, 0);
  expect(after.playheadX / after.zoom).toBeCloseTo(
    before.playheadX / before.zoom,
    0,
  );
});

test("a right-drag within the vertical threshold only pans", async ({
  page,
}) => {
  const before = await timelineState(page);
  await drag(page, "right", await rulerPoint(page), -150, 20);

  const after = await timelineState(page);
  expect(after.zoom).toBe(before.zoom);
  expect(after.scrollLeft).toBe(before.scrollLeft + 150);
});

test("middle-dragging the ruler up or down doesn't zoom", async ({ page }) => {
  const before = await timelineState(page);
  await drag(page, "middle", await rulerPoint(page), -100, -150);

  const after = await timelineState(page);
  expect(after.zoom).toBe(before.zoom);
  expect(after.scrollLeft).toBe(before.scrollLeft + 100);
});

test("releasing a right-drag over a lane opens no menu", async ({ page }) => {
  const from = await rulerPoint(page);
  const target = await lane(page, "1").boundingBox();
  if (!target) {
    throw new Error("lane is not visible");
  }
  await drag(page, "right", from, -150, target.y + target.height / 2 - from.y);

  await expect(page.getByRole("menu")).toHaveCount(0);
  expect(await contextMenus(page)).not.toContain(false);

  // The next right-click on the lane opens its menu as usual.
  await lane(page, "1").click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
});
