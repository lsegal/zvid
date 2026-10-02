import { expect, type Locator, type Page, test } from "@playwright/test";

// The timeline position under the pointer is measured from where clips
// start, inside the timeline scroller's border and the content's left border,
// so an unsnapped scrub or selection lands right under the pointer (#696).

// A taller viewport than the default: the docked Audio row footer (#809)
// takes a fixed slice of the panel, so the default layers need more room to
// all fit without scrolling.
test.use({ viewport: { width: 1280, height: 900 } });

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

// The client x where `content`'s timeline starts, inside its left border.
function originX(content: Locator) {
  return content.evaluate(
    (element) => element.getBoundingClientRect().left + element.clientLeft,
  );
}

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) {
    throw new Error("element is not visible");
  }
  return bounds;
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(lane(page, "5")).toBeVisible();
});

test("clicking the ruler puts the playhead under the pointer", async ({
  page,
}) => {
  const ruler = page.locator(".ruler-row__content");
  const pointerX = (await originX(ruler)) + 160;
  const rulerBox = await box(ruler);
  await page.mouse.click(pointerX, rulerBox.y + rulerBox.height / 2);

  // The playhead's right edge marks its position.
  const marker = page.locator(".timeline-playhead-marker");
  await expect
    .poll(async () => {
      const markerBox = await box(marker);
      return Math.abs(markerBox.x + markerBox.width - pointerX);
    })
    .toBeLessThan(0.5);
});

test("an unsnapped lane selection starts and ends under the pointer", async ({
  page,
}) => {
  const target = lane(page, "5");
  const origin = await originX(target);
  const y = (await box(target)).y + 20;
  const fromX = origin + 40.5;
  const toX = origin + 260.5;

  await page.keyboard.down("Shift");
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  await page.mouse.move(origin + 150, y, { steps: 4 });
  await page.mouse.move(toX, y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Shift");

  const selection = page.locator(".timeline-selection");
  await expect(selection).toHaveCount(1);
  const selectionBox = await box(selection);
  expect(Math.abs(selectionBox.x - fromX)).toBeLessThan(0.5);
  expect(Math.abs(selectionBox.x + selectionBox.width - toX)).toBeLessThan(0.5);
});
