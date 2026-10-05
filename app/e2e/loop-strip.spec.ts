import { expect, type Page, test } from "@playwright/test";

// The loop strip along the bottom of the ruler: dragging there highlights a
// playback selection without moving the playhead, a click clears it, and the
// ruler above it still scrubs.

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

function timecode(page: Page) {
  return page.locator(".timeline-toolbar__display > span").nth(1);
}

async function geometry(page: Page) {
  const view = await page.locator(".timeline-scroll").boundingBox();
  const ruler = await page.locator(".ruler-row__content").boundingBox();
  const strip = await page.locator(".ruler-loop-strip").boundingBox();
  if (!view || !ruler || !strip) {
    throw new Error("ruler is not visible");
  }
  return { view, ruler, strip };
}

async function drag(page: Page, fromX: number, toX: number, y: number) {
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  await page.mouse.move(toX, y, { steps: 10 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
});

test("the loop strip sits along the ruler's bottom with its own look", async ({
  page,
}) => {
  const { ruler, strip } = await geometry(page);
  expect(strip.y + strip.height).toBeCloseTo(ruler.y + ruler.height, 0);
  expect(strip.height).toBeGreaterThan(4);
  expect(strip.height).toBeLessThanOrEqual(ruler.height * 0.25);
  // The full width inside the ruler content's 1px left border.
  expect(strip.width).toBeGreaterThanOrEqual(ruler.width - 1);

  const styles = await page.evaluate(() => {
    const style = (selector: string) =>
      getComputedStyle(document.querySelector(selector) as HTMLElement);
    const content = style(".ruler-row__content");
    const loopStrip = style(".ruler-loop-strip");
    return {
      contentCursor: content.cursor,
      stripCursor: loopStrip.cursor,
      contentBackground: content.backgroundColor,
      stripBackground: loopStrip.backgroundColor,
    };
  });
  expect(styles.stripCursor).not.toBe(styles.contentCursor);
  expect(styles.stripBackground).not.toBe(styles.contentBackground);
});

test("dragging in the loop strip highlights a range and keeps the playhead", async ({
  page,
}) => {
  const before = await timecode(page).textContent();
  const marker = page.locator(".timeline-playhead-marker");
  const markerBefore = await marker.boundingBox();
  const { view, strip } = await geometry(page);
  const y = strip.y + strip.height / 2;
  const fromX = view.x + view.width * 0.7;
  const toX = view.x + view.width * 0.45;

  // Right to left: the selection still runs start to end.
  await drag(page, fromX, toX, y);

  const selection = page.locator(".ruler-loop-strip__selection");
  await expect(selection).toBeVisible();
  await expect(page.locator(".ruler-playback-selection")).toBeVisible();
  const startQ = Number(await selection.getAttribute("data-start-q"));
  const endQ = Number(await selection.getAttribute("data-end-q"));
  expect(endQ).toBeGreaterThan(startQ);
  const box = await selection.boundingBox();
  expect(box?.x).toBeGreaterThan(toX - 40);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThan(fromX + 40);

  await expect(timecode(page)).toHaveText(before ?? "");
  expect((await marker.boundingBox())?.x).toBe(markerBefore?.x);
});

test("a click in the loop strip clears the selection", async ({ page }) => {
  const { view, strip } = await geometry(page);
  const y = strip.y + strip.height / 2;
  await drag(page, view.x + view.width * 0.4, view.x + view.width * 0.6, y);
  await expect(page.locator(".ruler-loop-strip__selection")).toBeVisible();

  await page.mouse.click(view.x + view.width * 0.8, y);
  await expect(page.locator(".ruler-loop-strip__selection")).toHaveCount(0);
  await expect(page.locator(".ruler-playback-selection")).toHaveCount(0);
});

test("dragging in the ruler above the strip still scrubs", async ({ page }) => {
  const before = await timecode(page).textContent();
  const { view, ruler } = await geometry(page);
  const y = ruler.y + ruler.height * 0.3;
  await drag(page, view.x + view.width * 0.4, view.x + view.width * 0.6, y);

  await expect(timecode(page)).not.toHaveText(before ?? "");
  await expect(page.locator(".ruler-loop-strip__selection")).toHaveCount(0);
});
