import { expect, type Page, test } from "@playwright/test";

// A left-click on empty lane space seeks and clears the selection; only a
// drag past a few pixels selects a range.

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

// The playhead's position within the lane, independent of scroll.
function playheadX(page: Page, id: string) {
  return page.evaluate((laneId) => {
    const marker = document.querySelector(
      ".timeline-playhead-marker",
    ) as HTMLElement;
    const content = document.querySelector(
      `[data-timeline-lane-id="${laneId}"]`,
    ) as HTMLElement;
    return (
      marker.getBoundingClientRect().left -
      content.getBoundingClientRect().left
    );
  }, id);
}

test("clicking empty lane space seeks without selecting, and dragging selects", async ({
  page,
}) => {
  await page.goto("/");
  const target = lane(page, "2");
  await expect(target).toBeVisible();
  const bounds = await target.boundingBox();
  if (!bounds) {
    throw new Error("Lane is not visible");
  }
  const y = bounds.y + 20;
  const selection = page.locator(".timeline-selection");

  // A plain click leaves no selection and moves the playhead there.
  const before = await playheadX(page, "2");
  await page.mouse.click(bounds.x + 200, y);
  await expect(selection).toHaveCount(0);
  await expect(target.locator("..")).toHaveClass(/track-row--selected/);
  await expect.poll(() => playheadX(page, "2")).not.toBeCloseTo(before, 0);
  expect(Math.abs((await playheadX(page, "2")) - 200)).toBeLessThan(40);

  // Jitter under the threshold is still a click.
  await page.mouse.move(bounds.x + 120, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 122, y);
  await expect(selection).toHaveCount(0);
  await page.mouse.move(bounds.x + 118, y);
  await page.mouse.up();
  await expect(selection).toHaveCount(0);

  // A drag past the threshold selects from the anchor to the pointer.
  await page.mouse.move(bounds.x + 40, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 150, y, { steps: 4 });
  await page.mouse.move(bounds.x + 260, y, { steps: 4 });
  await page.mouse.up();
  await expect(selection).toHaveCount(1);
  const box = await selection.boundingBox();
  expect(box?.width).toBeGreaterThan(150);

  // Clicking elsewhere clears it.
  await page.mouse.click(bounds.x + 400, y);
  await expect(selection).toHaveCount(0);
});
