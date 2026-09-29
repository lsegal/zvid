import { expect, type Page, test } from "@playwright/test";

// Hand-grab panning on the timeline ruler: the right and middle buttons pan
// the timeline, the left button scrubs the playhead, and the browser's
// context menu never opens there.

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

async function timelineState(page: Page) {
  return page.evaluate(() => {
    const scroll = document.querySelector(".timeline-scroll") as HTMLElement;
    const marker = document.querySelector(
      ".timeline-playhead-marker",
    ) as HTMLElement;
    const content = document.querySelector(
      ".ruler-row__content",
    ) as HTMLElement;
    return {
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

// Records whether each contextmenu event reaching the window was cancelled,
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

async function drag(
  page: Page,
  button: "left" | "right" | "middle",
  from: { x: number; y: number },
  dx: number,
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  await page.mouse.move(from.x + dx, from.y, { steps: 12 });
  await page.mouse.up({ button });
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
