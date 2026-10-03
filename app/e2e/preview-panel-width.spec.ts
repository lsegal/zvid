import { expect, type Page, test } from "@playwright/test";

// The preview panel widens as far as the window allows: the only limit is the
// timeline area past the layer headers, which keeps at least 50px.
const TIMELINE_MIN_WIDTH = 50;

function previewHandle(page: Page) {
  return page.getByRole("separator", { name: "Resize preview panel" });
}

function labelHandle(page: Page) {
  return page.getByRole("separator", { name: "Resize track labels" });
}

// The visible timeline area: the scroller's width minus the layer headers.
function timelineAreaWidth(page: Page) {
  return page.evaluate(() => {
    const scroll = document.querySelector<HTMLElement>(".timeline-scroll");
    const labels = document.querySelector<HTMLElement>(
      '[aria-label="Resize track labels"]',
    );
    return (
      (scroll?.clientWidth ?? 0) -
      Number(labels?.getAttribute("aria-valuenow") ?? 0)
    );
  });
}

async function dragPreviewHandleLeft(page: Page, distance: number) {
  const box = await previewHandle(page).boundingBox();
  if (!box) {
    throw new Error("preview resize handle is not visible");
  }
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - distance, y, { steps: 10 });
  await page.mouse.up();
}

test("the preview widens until the timeline area is 50px", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await expect(previewHandle(page)).toBeVisible();

  // Past the old fixed 560px cap.
  await dragPreviewHandleLeft(page, 2000);
  const maxWidth = Number(
    await previewHandle(page).getAttribute("aria-valuemax"),
  );
  expect(maxWidth).toBeGreaterThan(560);
  await expect(previewHandle(page)).toHaveAttribute(
    "aria-valuenow",
    String(maxWidth),
  );
  const area = await timelineAreaWidth(page);
  expect(area).toBeGreaterThanOrEqual(TIMELINE_MIN_WIDTH - 1);
  expect(area).toBeLessThanOrEqual(TIMELINE_MIN_WIDTH + 1);

  // End reaches the same maximum from the keyboard.
  await previewHandle(page).focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("End");
  await expect(previewHandle(page)).toHaveAttribute(
    "aria-valuenow",
    String(maxWidth),
  );

  // Wider layer headers take their width back from the preview.
  await labelHandle(page).focus();
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press("ArrowRight");
  }
  await expect
    .poll(async () =>
      Number(await previewHandle(page).getAttribute("aria-valuemax")),
    )
    .toBeLessThan(maxWidth);
  expect(await timelineAreaWidth(page)).toBeGreaterThanOrEqual(
    TIMELINE_MIN_WIDTH - 1,
  );
});

test("a narrower window shrinks the preview but keeps the saved width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await dragPreviewHandleLeft(page, 2000);
  const savedWidth = Number(
    await previewHandle(page).getAttribute("aria-valuenow"),
  );

  await page.setViewportSize({ width: 1100, height: 900 });
  await expect
    .poll(async () =>
      Number(await previewHandle(page).getAttribute("aria-valuenow")),
    )
    .toBeLessThan(savedWidth);
  expect(await timelineAreaWidth(page)).toBeGreaterThanOrEqual(
    TIMELINE_MIN_WIDTH - 1,
  );
  expect(
    await page.evaluate(() => localStorage.getItem("zvid-preview-width")),
  ).toBe(String(savedWidth));

  // Back in the larger window, the saved width is used again.
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(previewHandle(page)).toHaveAttribute(
    "aria-valuenow",
    String(savedWidth),
  );
});
