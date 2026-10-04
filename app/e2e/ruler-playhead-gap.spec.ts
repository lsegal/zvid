import { expect, type Page, test } from "@playwright/test";

// The playhead is two lines: the marker in the ruler and the line through
// the layers below it. They must meet at the ruler's bottom edge with no
// gap, also when the header label cell makes the ruler row taller (#938).

test.use({ viewport: { width: 1600, height: 1200 } });

// Seeks by clicking empty space in layer lane 5, 300px into it.
async function seek(page: Page) {
  const lane = page.locator('[data-timeline-lane-id="5"]');
  const bounds = await lane.boundingBox();
  if (!bounds) {
    throw new Error("Lane is not visible");
  }
  await page.mouse.click(bounds.x + 300, bounds.y + 20);
}

// Where the ruler marker ends, where the ruler row ends, and the first y
// below the ruler at which the layers' playhead line paints topmost. The
// line ignores pointer events, so turn them on to let elementFromPoint see
// it.
async function playheadJoin(page: Page) {
  await page.addStyleTag({
    content: ".timeline-playhead { pointer-events: auto !important; }",
  });
  return page.evaluate(() => {
    const marker = document.querySelector(
      ".timeline-playhead-marker",
    ) as HTMLElement;
    const line = document.querySelector(".timeline-playhead") as HTMLElement;
    const row = document.querySelector(".ruler-row") as HTMLElement;
    const markerBox = marker.getBoundingClientRect();
    const lineBox = line.getBoundingClientRect();
    const rowBottom = row.getBoundingClientRect().bottom;
    const x = lineBox.left + lineBox.width / 2;
    let lineTop = Number.NaN;
    for (let y = Math.floor(rowBottom); y < rowBottom + 80; y += 1) {
      if (document.elementFromPoint(x, y)?.closest(".timeline-playhead")) {
        lineTop = y;
        break;
      }
    }
    return {
      markerX: markerBox.left + markerBox.width / 2,
      lineX: x,
      markerBottom: markerBox.bottom,
      rowBottom,
      lineTop,
    };
  });
}

async function expectContinuousPlayhead(page: Page) {
  const join = await playheadJoin(page);
  expect(join.markerX).toBeCloseTo(join.lineX, 0);
  expect(join.markerBottom).toBeCloseTo(join.rowBottom, 0);
  expect(join.lineTop - join.markerBottom).toBeLessThanOrEqual(1);
  return join;
}

test("the ruler marker meets the playhead line", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ruler-row")).toBeVisible();
  await seek(page);

  await expectContinuousPlayhead(page);
});

test("the ruler marker meets the playhead line under a header status line", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".ruler-row")).toBeVisible();
  const before = await page
    .locator(".ruler-row")
    .evaluate((row) => row.getBoundingClientRect().height);

  // Stand in for the offline/sync status, plus a second line so the label
  // cell sets the row's height.
  await page.locator(".ruler-row .track-label--header > div").evaluate((cell) => {
    const status = document.createElement("button");
    status.className = "track-label__offline";
    status.type = "button";
    status.textContent = "2 offline media files";
    cell.append(status, document.createElement("br"), "Syncing");
  });
  const after = await page
    .locator(".ruler-row")
    .evaluate((row) => row.getBoundingClientRect().height);
  expect(after).toBeGreaterThan(before);

  await seek(page);
  await expectContinuousPlayhead(page);
});
