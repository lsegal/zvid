import { expect, type Page, test } from "@playwright/test";

// The record arm button on each source track handle (#854), right of its FX
// switch: clicking it arms or disarms the track, several tracks can be
// armed at once, and removing a track disarms it.

function rows(page: Page) {
  return page.locator(".track-row--source[data-source-track-id]");
}

function arm(page: Page, index: number) {
  return rows(page).nth(index).locator(".track-label__arm");
}

function addTrack(page: Page) {
  return page
    .locator(".track-row--source-drop")
    .getByRole("button", { name: "Track", exact: true });
}

async function addTracks(page: Page, count: number) {
  for (let index = 0; index < count; index++) {
    await addTrack(page).click();
  }
  await expect(rows(page)).toHaveCount(count);
}

async function trackName(page: Page, index: number) {
  return (
    (await rows(page)
      .nth(index)
      .locator("[data-source-track-label-id] > span")
      .textContent()) ?? ""
  );
}

test.use({ viewport: { width: 1600, height: 1200 } });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
});

test("the arm button sits right of FX and toggles the track's armed state", async ({
  page,
}) => {
  // The second track added is selected.
  await addTracks(page, 2);
  const name = await trackName(page, 0);
  const label = rows(page).nth(0).locator(".track-label--source");
  const fx = label.locator(".track-label__fx");
  const button = arm(page, 0);

  // Right after FX, the last control in the handle.
  const order = await label.evaluate((element) =>
    [...element.querySelectorAll("button")].map((item) => item.className),
  );
  expect(order.at(-2)).toContain("track-label__fx");
  expect(order.at(-1)).toBe("track-label__arm");
  const fxBox = await fx.boundingBox();
  const armBox = await button.boundingBox();
  expect(armBox?.x).toBeGreaterThan((fxBox?.x ?? 0) + (fxBox?.width ?? 0) - 1);

  await page.mouse.move(0, 0);
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(button).toHaveAccessibleName(`Arm ${name} for recording`);
  await expect(button).toHaveAttribute("title", `Arm ${name} for recording`);
  const dot = button.locator(".track-label__arm-dot");
  await expect(dot).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  await button.click();
  await page.mouse.move(0, 0);
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(button).toHaveAccessibleName(`Disarm ${name}`);
  await expect(button).toHaveAttribute("title", `Disarm ${name}`);
  await expect(dot).toHaveCSS("background-color", "rgb(255, 92, 92)");
  // Arming leaves the selection alone.
  await expect(
    rows(page).nth(0).locator("[data-source-track-label-id]"),
  ).not.toHaveAttribute("aria-current", "true");
  await expect(
    rows(page).nth(1).locator("[data-source-track-label-id]"),
  ).toHaveAttribute("aria-current", "true");

  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
});

test("several tracks can be armed at once, and removing one disarms it", async ({
  page,
}) => {
  await addTracks(page, 3);
  await arm(page, 0).click();
  await arm(page, 2).click();
  await expect(arm(page, 0)).toHaveAttribute("aria-pressed", "true");
  await expect(arm(page, 1)).toHaveAttribute("aria-pressed", "false");
  await expect(arm(page, 2)).toHaveAttribute("aria-pressed", "true");

  // Deleting the first track disarms it: undo brings it back disarmed,
  // while the other armed track stays armed.
  await rows(page)
    .nth(0)
    .locator(".track-label--source")
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(arm(page, 1)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(rows(page)).toHaveCount(3);
  await expect(arm(page, 0)).toHaveAttribute("aria-pressed", "false");
  await expect(arm(page, 2)).toHaveAttribute("aria-pressed", "true");
});

test("the arm button fits a narrow handle without covering the track name", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("zvid-label-width", "120");
  });
  await page.reload();
  await expect(
    page.locator(".timeline-canvas.timeline-canvas--narrow-labels"),
  ).toBeVisible();
  await addTracks(page, 1);
  const label = rows(page).nth(0).locator(".track-label--source");
  const name = label.locator("[data-source-track-label-id]");
  const fx = label.locator(".track-label__fx");
  const button = arm(page, 0);
  const [labelBox, nameBox, fxBox, armBox] = await Promise.all(
    [label, name, fx, button].map((item) => item.boundingBox()),
  );
  if (!labelBox || !nameBox || !fxBox || !armBox) {
    throw new Error("The track handle is not visible");
  }
  expect(armBox.x + armBox.width).toBeLessThanOrEqual(
    labelBox.x + labelBox.width,
  );
  expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(fxBox.x);
  expect(fxBox.x + fxBox.width).toBeLessThanOrEqual(armBox.x + 1);
  expect(nameBox.width).toBeGreaterThan(16);
});
