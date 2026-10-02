import { expect, type Page, test } from "@playwright/test";

// The placeholder rows that end the layers and the source tracks: their
// [ + Layer ] and [ + Track ] buttons replace the toolbar's layer count and
// Create Layer button.

const MAX_LAYERS_MESSAGE = "You already have the maximum of 9 layers.";
const tracks = '[data-source-track-drop-target="track"]';

function headers(page: Page) {
  return page.locator("[data-layer-header-id]");
}

function addLayer(page: Page) {
  return page
    .locator(".track-placeholder--layer")
    .getByRole("button", { name: "Layer", exact: true });
}

function addTrack(page: Page) {
  return page
    .locator(".track-row--source-drop")
    .getByRole("button", { name: "Track", exact: true });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(headers(page).first()).toBeVisible();
});

test("the toolbar has no layer count or Create Layer button", async ({
  page,
}) => {
  const toolbar = page.locator(".timeline-toolbar");
  await expect(toolbar).toBeVisible();
  await expect(toolbar).not.toContainText(/Layers \d+\/9/);
  await expect(toolbar).not.toContainText("Create Layer");
  await expect(toolbar).not.toContainText("Max Layers");
});

test("[ + Layer ] ends the layers, adds a layer and selects it", async ({
  page,
}) => {
  const placeholder = page.locator(".track-placeholder--layer");
  // The placeholder is the last row, as tall as a layer row.
  const isLast = await placeholder.evaluate(
    (row) =>
      [...(row.parentElement?.querySelectorAll(".track-row") ?? [])].at(-1) ===
      row,
  );
  expect(isLast).toBe(true);
  const layerBox = await page
    .locator("[data-layer-row-id]")
    .last()
    .boundingBox();
  const placeholderBox = await placeholder.boundingBox();
  expect(placeholderBox?.height).toBe(layerBox?.height);

  const count = await headers(page).count();
  await addLayer(page).click();
  await expect(headers(page)).toHaveCount(count + 1);
  const added = headers(page).last();
  await expect(added).toContainText(`Layer ${count + 1}`);
  await expect(added.locator(".track-label__select")).toHaveAttribute(
    "aria-current",
    "true",
  );

  // One undo step removes it.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(headers(page)).toHaveCount(count);
});

test("[ + Layer ] works from the keyboard", async ({ page }) => {
  const count = await headers(page).count();
  await addLayer(page).focus();
  await page.keyboard.press("Enter");
  await expect(headers(page)).toHaveCount(count + 1);
  // Space is left to playback and does not press it (#745).
  await addLayer(page).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Enter");
  await expect(headers(page)).toHaveCount(count + 2);
});

test("[ + Layer ] is disabled with the max message at 9 layers", async ({
  page,
}) => {
  const button = addLayer(page);
  while ((await headers(page).count()) < 9) {
    const count = await headers(page).count();
    await button.click();
    await expect(headers(page)).toHaveCount(count + 1);
  }
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute("title", MAX_LAYERS_MESSAGE);
});

test("[ + Track ] adds an empty source track and selects it", async ({
  page,
}) => {
  await expect(page.locator(tracks)).toHaveCount(0);
  await addTrack(page).click();
  await expect(page.locator(tracks)).toHaveCount(1);
  const added = page.locator(tracks).first();
  await expect(added).toContainText("Source Track 1");
  await expect(added).toHaveClass(/track-row--selected/);
  await expect(added.locator(".source-span")).toHaveCount(0);

  // The placeholder stays the last row, and adds the next track.
  await addTrack(page).click();
  await expect(page.locator(tracks)).toHaveCount(2);
  await expect(page.locator(tracks).nth(1)).toContainText("Source Track 2");
  await expect(page.locator(tracks).nth(1)).toHaveClass(/track-row--selected/);
  await expect(page.locator(tracks).first()).not.toHaveClass(
    /track-row--selected/,
  );

  // One undo step removes each.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(tracks)).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(tracks)).toHaveCount(0);
});

test("[ + Track ] stays enabled while source tracks are locked", async ({
  page,
}) => {
  await addTrack(page).click();
  await expect(page.locator(tracks)).toHaveCount(1);
  await page
    .getByRole("button", { name: "Lock source tracks", exact: true })
    .click();
  await expect(page.locator(".source-tracks--locked")).toHaveCount(1);
  await expect(addTrack(page)).toBeEnabled();
  await addTrack(page).click();
  await expect(page.locator(tracks)).toHaveCount(2);
});
