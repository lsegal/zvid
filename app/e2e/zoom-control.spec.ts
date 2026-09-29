import { expect, type Page, test } from "@playwright/test";

// The transport bar's zoom control: the -/+ buttons step along a ladder from
// 25% to 300%, and the ruler thins its labels when zoomed far out.

function readout(page: Page) {
  return page.locator(".zoom-control__readout");
}

async function stepUntilDisabled(page: Page, name: "Zoom in" | "Zoom out") {
  const button = page.getByRole("button", { name, exact: true });
  const seen: string[] = [];
  while (await button.isEnabled()) {
    await button.click();
    seen.push((await readout(page).textContent()) ?? "");
  }
  return seen;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-timeline-lane-id="1"]')).toBeVisible();
  await expect(readout(page)).toHaveText("100%");
});

test("the zoom buttons step along the ladder to 25% and 300%", async ({
  page,
}) => {
  expect(await stepUntilDisabled(page, "Zoom out")).toEqual([
    "80%",
    "67%",
    "50%",
    "33%",
    "25%",
  ]);
  expect(await stepUntilDisabled(page, "Zoom in")).toEqual([
    "33%",
    "50%",
    "67%",
    "80%",
    "100%",
    "125%",
    "150%",
    "200%",
    "250%",
    "300%",
  ]);
});

test("the slider reaches both ends of the range", async ({ page }) => {
  const slider = page.getByRole("slider", { name: "Timeline zoom" });
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(readout(page)).toHaveText("25%");
  await page.keyboard.press("End");
  await expect(readout(page)).toHaveText("300%");
});

test("the ruler labels fewer bars at 25%", async ({ page }) => {
  const labels = page.locator(".ruler-marker span");
  const labelled = async () =>
    (await labels.allTextContents()).slice(0, 4).map(Number);
  expect(await labelled()).toEqual([1, 2, 3, 4]);

  await stepUntilDisabled(page, "Zoom out");
  // A 4/4 bar is 28px at 25%, so every 2nd bar keeps its number.
  expect(await labelled()).toEqual([1, 3, 5, 7]);
});
