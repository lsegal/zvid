import { expect, type Page, test } from "@playwright/test";

// Scrubbing the playhead from the ruler left past 00:00:00, over the track
// label column, stops the playhead at 0 and never scrolls the timeline
// right.

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

// Records every timeline scroll position from now on.
async function watchScroll(page: Page) {
  await page.evaluate(() => {
    const scroll = document.querySelector(".timeline-scroll") as HTMLElement;
    const record: number[] = [scroll.scrollLeft];
    (window as unknown as { scrolls: number[] }).scrolls = record;
    scroll.addEventListener("scroll", () => record.push(scroll.scrollLeft));
  });
}

function scrolls(page: Page) {
  return page.evaluate(
    () => (window as unknown as { scrolls: number[] }).scrolls,
  );
}

async function scrubToLabels(page: Page) {
  const view = await page.locator(".timeline-scroll").boundingBox();
  const ruler = await page.locator(".ruler-row__content").boundingBox();
  if (!view || !ruler) {
    throw new Error("ruler is not visible");
  }
  const y = ruler.y + ruler.height / 2;
  const from = view.x + view.width * 0.6;
  await page.mouse.move(from, y);
  await page.mouse.down();
  // Past the start of the lanes, then across the label column to the
  // timeline's left edge.
  await page.mouse.move(view.x + 2, y, { steps: 30 });
  await page.mouse.up();
}

function expectNeverIncreases(values: number[]) {
  for (let i = 1; i < values.length; i++) {
    expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
  }
}

function timecode(page: Page) {
  return page.locator(".timeline-toolbar__display > span").nth(1);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
});

test("scrubbing left past 00:00:00 leaves the view at the start", async ({
  page,
}) => {
  expect(
    await page.locator(".timeline-scroll").evaluate((el) => el.scrollLeft),
  ).toBe(0);
  await watchScroll(page);
  await scrubToLabels(page);

  const positions = await scrolls(page);
  expectNeverIncreases(positions);
  expect(positions.at(-1)).toBe(0);
  await expect(timecode(page)).toHaveText("00:00:00");
});

test("scrubbing left past 00:00:00 from a scrolled view only scrolls left", async ({
  page,
}) => {
  // Scrolled by less than the label column, so a drag to the timeline's left
  // edge carries the playhead past 00:00:00.
  const scrollLeft = await page
    .locator(".timeline-scroll")
    .evaluate((el) => {
      const content = el.querySelector(".ruler-row__content") as HTMLElement;
      const labelWidth =
        content.getBoundingClientRect().left - el.getBoundingClientRect().left;
      el.scrollLeft = Math.floor(labelWidth / 2);
      return el.scrollLeft;
    });
  expect(scrollLeft).toBeGreaterThan(0);
  await watchScroll(page);
  await scrubToLabels(page);

  const positions = await scrolls(page);
  expectNeverIncreases(positions);
  expect(positions.at(-1)).toBe(0);
  await expect(timecode(page)).toHaveText("00:00:00");
});
