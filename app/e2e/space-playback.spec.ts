import { expect, type Locator, type Page, test } from "@playwright/test";

// Space toggles playback from any focus, and never opens a menu, presses a
// button or picks up a grip (#745). Text entry is the only exception, where
// Space types a space. Grips and buttons use Enter instead.

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

function headers(page: Page) {
  return page.locator("[data-layer-header-id]");
}

// By label, since an open dialog hides the transport from the
// accessibility tree.
function playButton(page: Page) {
  return page.locator('button[aria-label="Play timeline"]');
}

function pauseButton(page: Page) {
  return page.locator('button[aria-label="Pause playback"]');
}

function menuItem(page: Page, name: string) {
  return page.getByRole("menuitem", { name, exact: true });
}

function fileTrigger(page: Page) {
  return page
    .getByRole("menubar")
    .getByRole("menuitem", { name: "File", exact: true });
}

// A text clip on Layer 1, so there is something to play.
async function insertTextClip(page: Page) {
  const bounds = await lane(page, "1").boundingBox();
  if (!bounds) {
    throw new Error("Lane is not visible");
  }
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + 40, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 150, y);
  await page.mouse.move(bounds.x + 260, y);
  await page.mouse.up();
  await page.mouse.click(bounds.x + 150, bounds.y + 20, { button: "right" });
  await page
    .getByRole("menu", { name: "Selection actions" })
    .getByRole("menuitem", { name: "Insert Text Clip" })
    .click();
  const clip = lane(page, "1").locator(".clip-card--text");
  await expect(clip).toHaveCount(1);
  return clip;
}

// Space starts playback and Space again stops it, from `target`.
async function expectSpaceToggles(page: Page, target: Locator) {
  await target.focus();
  await expect(target).toBeFocused();
  await expect(playButton(page)).toBeVisible();
  await page.keyboard.press("Space");
  await expect(pauseButton(page)).toBeVisible();
  await expect(target).toBeFocused();
  await page.keyboard.press("Space");
  await expect(playButton(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await insertTextClip(page);
  await page.locator(".timeline-scroll").click({ position: { x: 5, y: 5 } });
});

test("Space toggles playback from buttons, sliders, grips and the menubar", async ({
  page,
}) => {
  const file = fileTrigger(page);
  await expectSpaceToggles(page, file);
  await expect(page.getByRole("menu")).toHaveCount(0);

  const scale = page
    .getByRole("tablist", { name: "Timeline scale" })
    .getByRole("button");
  const selected = await scale.evaluateAll((tabs) =>
    tabs.findIndex((tab) => tab.classList.contains("is-active")),
  );
  const other = scale.nth(selected === 0 ? 1 : 0);
  await expectSpaceToggles(page, other);
  await expect(other).not.toHaveClass(/is-active/);

  const zoom = page.getByRole("slider", { name: "Timeline zoom" });
  const zoomValue = await zoom.inputValue();
  await expectSpaceToggles(page, zoom);
  await expect(zoom).toHaveValue(zoomValue);

  const volume = page.getByRole("slider", { name: "Preview volume" });
  const volumeValue = await volume.inputValue();
  await expectSpaceToggles(page, volume);
  await expect(volume).toHaveValue(volumeValue);

  const grip = page.locator("[data-layer-grip]").first();
  await expectSpaceToggles(page, grip);
  await expect(grip).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".track-row--lifted")).toHaveCount(0);

  const count = await headers(page).count();
  const addLayer = page
    .locator(".track-placeholder--layer")
    .getByRole("button", { name: "Layer", exact: true });
  await expectSpaceToggles(page, addLayer);
  await expect(headers(page)).toHaveCount(count);
});

test("Space closes an open menu and toggles playback without picking an item", async ({
  page,
}) => {
  await fileTrigger(page).click();
  const fileMenu = page.getByRole("menu");
  await expect(fileMenu).toBeVisible();
  await expect(playButton(page)).toBeVisible();
  await page.keyboard.press("Space");
  await expect(fileMenu).toHaveCount(0);
  await expect(pauseButton(page)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Space");
  await expect(playButton(page)).toBeVisible();

  // The layer header's own context menu too.
  const header = page.locator('[data-layer-header-id="1"]');
  await header.click({ button: "right" });
  const layerMenu = page.getByRole("menu", { name: "Layer header actions" });
  await expect(layerMenu).toBeVisible();
  const count = await headers(page).count();
  await page.keyboard.press("Space");
  await expect(layerMenu).toHaveCount(0);
  await expect(pauseButton(page)).toBeVisible();
  await page.keyboard.press("Space");
  await expect(playButton(page)).toBeVisible();
  await expect(headers(page)).toHaveCount(count);
});

test("Space toggles playback inside an open dialog without pressing its button", async ({
  page,
}) => {
  await fileTrigger(page).click();
  await menuItem(page, "Session Settings…").click();
  const dialog = page.getByRole("dialog", { name: "Session Settings" });
  await expect(dialog).toBeVisible();
  const button = dialog.getByRole("button").first();
  await button.focus();
  await expect(playButton(page)).toBeVisible();
  await page.keyboard.press("Space");
  await expect(pauseButton(page)).toBeVisible();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Space");
  await expect(playButton(page)).toBeVisible();
  await expect(dialog).toBeVisible();
});

test("Space types a space in a layer rename field and the text clip editor", async ({
  page,
}) => {
  await page.locator('[data-layer-header-id="1"]').click({ button: "right" });
  await menuItem(page, "Rename…").click();
  const name = page.getByRole("textbox", { name: "Layer name" });
  await expect(name).toBeFocused();
  await name.fill("Drum");
  await page.keyboard.press("Space");
  await page.keyboard.type("loop");
  await expect(name).toHaveValue("Drum loop");
  await expect(playButton(page)).toBeVisible();
  await name.press("Escape");

  // Double-clicking the text clip in the preview edits it on the canvas.
  const clip = lane(page, "1").locator(".clip-card--text");
  await clip.locator(".clip-card__body").dblclick();
  const editor = page.getByTestId("preview-text-editor").getByRole("textbox");
  await expect(editor).toBeFocused();
  await page.keyboard.type("a");
  await page.keyboard.press("Space");
  await page.keyboard.type("b");
  await expect(editor).toHaveValue("a b");
  await expect(playButton(page)).toBeVisible();
});

test("Space toggles playback after a timeline press leaves a text field", async ({
  page,
}) => {
  // Lane, clip and ruler presses prevent their default, which used to leave
  // focus in the text clip's FX Text box so Space kept typing there (#924).
  const clip = lane(page, "1").locator(".clip-card--text");
  const text = page.locator(".fx-text").getByRole("textbox");
  const laneBounds = await lane(page, "1").boundingBox();
  const rulerBounds = await page.locator(".ruler-row__content").boundingBox();
  if (!laneBounds || !rulerBounds) {
    throw new Error("Timeline is not visible");
  }
  const presses: [string, () => Promise<void>][] = [
    ["clip", () => clip.locator(".clip-card__body").click()],
    [
      "lane",
      () =>
        page.mouse.click(
          laneBounds.x + 20,
          laneBounds.y + laneBounds.height / 2,
        ),
    ],
    [
      "ruler",
      () =>
        page.mouse.click(
          laneBounds.x + 60,
          rulerBounds.y + rulerBounds.height / 2,
        ),
    ],
  ];

  for (const [name, press] of presses) {
    await clip.locator(".clip-card__body").click();
    await text.fill(`Hello ${name}`);
    await expect(text).toBeFocused();
    await press();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName))
      .not.toBe("TEXTAREA");
    await expect(playButton(page)).toBeVisible();
    await page.keyboard.press("Space");
    await expect(pauseButton(page)).toBeVisible();
    await page.keyboard.press("Space");
    await expect(playButton(page)).toBeVisible();
  }

  // Leaving the field committed what was typed, without a stray space.
  await clip.locator(".clip-card__body").click();
  await expect(text).toHaveValue("Hello ruler");
});

test("Enter picks up a grip and presses [ + Layer ]", async ({ page }) => {
  const grip = page.locator("[data-layer-grip]").first();
  await grip.focus();
  await page.keyboard.press("Enter");
  await expect(grip).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".layer-reorder-status")).toContainText(
    "Picked up",
  );
  await page.keyboard.press("Escape");
  await expect(grip).toHaveAttribute("aria-pressed", "false");

  const count = await headers(page).count();
  const addLayer = page
    .locator(".track-placeholder--layer")
    .getByRole("button", { name: "Layer", exact: true });
  await addLayer.focus();
  await page.keyboard.press("Enter");
  await expect(headers(page)).toHaveCount(count + 1);
});
