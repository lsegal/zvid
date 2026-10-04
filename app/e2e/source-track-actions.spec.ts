import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Duplicating, deleting and reordering source tracks like layers (#654), from
// the label's menu and its grip, and renaming them (#663).
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

async function dropVideoIntoNewSourceTrack(page: Page) {
  const base64 = (await readFile(VIDEO)).toString("base64");
  const dataTransfer = await page.evaluateHandle((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([bytes], "test-pattern.mp4", { type: "video/mp4" }),
    );
    return transfer;
  }, base64);
  const target = '[data-source-track-drop-target="new-track"]';
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(target, type, { dataTransfer });
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
}

function rows(page: Page) {
  return page.locator(".track-row--source[data-source-track-id]");
}

function names(page: Page) {
  return page.locator("[data-source-track-label-id] > span");
}

function keys(page: Page) {
  return page.locator("[data-source-track-label-id] > small");
}

function label(page: Page, index: number) {
  return rows(page).nth(index).locator(".track-label--source");
}

function grip(page: Page, index: number) {
  return rows(page).nth(index).locator("[data-source-track-grip]");
}

function layerClips(page: Page) {
  return page.locator('[data-timeline-lane-id="1"] .clip-card');
}

async function openMenu(page: Page, index: number) {
  const target = label(page, index);
  await target.scrollIntoViewIfNeeded();
  await target.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Source track actions" });
  await expect(menu).toBeVisible();
  return menu;
}

function menuItem(page: Page, name: string) {
  return page.getByRole("menuitem", { name, exact: true });
}

async function center(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Not visible");
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// The docked Audio row footer (#809) leaves less room for rows to scroll in;
// the default session's rows no longer all fit without scrolling.
test.use({ viewport: { width: 1600, height: 1200 } });

// One source track, "test-pattern", with a clip cut from it on Layer 1.
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-timeline-lane-id="1"]')).toBeVisible();
  await dropVideoIntoNewSourceTrack(page);
  await page.locator(".source-span").click({ button: "right" });
  await menuItem(page, "Copy to layer").hover();
  await menuItem(page, "Layer 1").click();
  await expect(layerClips(page)).toHaveCount(1);
  await expect(names(page)).toHaveText(["test-pattern"]);
});

test("Rename… renames a source track and its clips, in one undo step", async ({
  page,
}) => {
  const spanLabel = page.locator(".source-span__body > span");
  const clipLabel = layerClips(page).locator(".clip-card__text > strong");
  await expect(spanLabel).toHaveText("test-pattern");
  await expect(clipLabel).toHaveText("test-pattern");

  // Escape cancels and puts focus back on the label.
  await openMenu(page, 0);
  await menuItem(page, "Rename…").click();
  const input = page.getByRole("textbox", { name: "Source track name" });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("test-pattern");
  await input.fill("Ignored");
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(names(page)).toHaveText(["test-pattern"]);
  await expect(page.locator("[data-source-track-label-id]")).toBeFocused();

  // An empty name keeps the old one.
  await openMenu(page, 0);
  await menuItem(page, "Rename…").click();
  await input.fill("   ");
  await input.press("Enter");
  await expect(names(page)).toHaveText(["test-pattern"]);

  // Enter saves the trimmed name on the track, its span and its layer clip.
  await openMenu(page, 0);
  await menuItem(page, "Rename…").click();
  await input.fill("  Wide shot ");
  await input.press("Enter");
  await expect(names(page)).toHaveText(["Wide shot"]);
  await expect(spanLabel).toHaveText("Wide shot");
  await expect(clipLabel).toHaveText("Wide shot");
  await expect(page.locator("[data-source-track-label-id]")).toBeFocused();
  await expect(grip(page, 0)).toHaveAccessibleName("Reorder Wide shot");

  await page.keyboard.press("ControlOrMeta+z");
  await expect(names(page)).toHaveText(["test-pattern"]);
  await expect(spanLabel).toHaveText("test-pattern");
  await expect(clipLabel).toHaveText("test-pattern");
});

test("the menu duplicates a source track below it, spans and all", async ({
  page,
}) => {
  await openMenu(page, 0);
  // The only track cannot move.
  await expect(menuItem(page, "Move up")).toBeDisabled();
  await expect(menuItem(page, "Move down")).toBeDisabled();
  await menuItem(page, "Duplicate").click();

  await expect(names(page)).toHaveText(["test-pattern", "test-pattern copy"]);
  await expect(keys(page)).toHaveText([/key 1$/, /key 2$/]);
  await expect(rows(page).nth(1).locator(".source-span")).toHaveCount(1);
  // The layer clips stay as they were.
  await expect(layerClips(page)).toHaveCount(1);
  // In a color of its own.
  const stripes = await rows(page)
    .locator(".track-label__stripe")
    .evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).backgroundColor),
    );
  expect(stripes[0]).not.toBe(stripes[1]);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(names(page)).toHaveText(["test-pattern"]);
});

test("Move up and Move down reorder source tracks, and the keys follow", async ({
  page,
}) => {
  await openMenu(page, 0);
  await menuItem(page, "Duplicate").click();
  await expect(names(page)).toHaveText(["test-pattern", "test-pattern copy"]);

  await openMenu(page, 1);
  await expect(menuItem(page, "Move down")).toBeDisabled();
  await menuItem(page, "Move up").click();
  await expect(names(page)).toHaveText(["test-pattern copy", "test-pattern"]);
  await expect(keys(page)).toHaveText([/key 1$/, /key 2$/]);

  await openMenu(page, 0);
  await menuItem(page, "Move down").click();
  await expect(names(page)).toHaveText(["test-pattern", "test-pattern copy"]);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(names(page)).toHaveText(["test-pattern copy", "test-pattern"]);
});

test("Delete removes a source track with its spans and the layer clips cut from them", async ({
  page,
}) => {
  await openMenu(page, 0);
  await menuItem(page, "Duplicate").click();
  await expect(names(page)).toHaveText(["test-pattern", "test-pattern copy"]);

  // The copy has no layer clips of its own.
  await openMenu(page, 1);
  await menuItem(page, "Delete").click();
  await expect(names(page)).toHaveText(["test-pattern"]);
  await expect(layerClips(page)).toHaveCount(1);

  // The original takes its layer clip along, and the last track can go.
  await openMenu(page, 0);
  await menuItem(page, "Delete").click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator(".source-span")).toHaveCount(0);
  await expect(layerClips(page)).toHaveCount(0);

  // Undo brings both back in one step.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(names(page)).toHaveText(["test-pattern"]);
  await expect(page.locator(".source-span")).toHaveCount(1);
  await expect(layerClips(page)).toHaveCount(1);
});

test("dragging a source track's grip reorders it, in one undo step", async ({
  page,
}) => {
  await openMenu(page, 0);
  await menuItem(page, "Duplicate").click();
  await expect(names(page)).toHaveText(["test-pattern", "test-pattern copy"]);
  await expect(grip(page, 1)).toHaveAccessibleName("Reorder test-pattern copy");

  // Scrolled to the end, so the grip is clear of the bottom edge, where a
  // drag scrolls the timeline under the pointer.
  await page.locator(".timeline-scroll").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const from = await center(grip(page, 1));
  const to = await center(label(page, 0));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y - 10, { steps: 2 });
  await expect(rows(page).nth(1)).toHaveClass(/track-row--lifted/);
  await page.mouse.move(from.x, to.y - 20, { steps: 8 });
  await expect(
    page.locator(".source-track-list .layer-reorder-status"),
  ).toHaveText("test-pattern copy, position 1 of 2");
  await expect(
    page.locator(".source-track-list .layer-drop-indicator"),
  ).toBeVisible();
  await page.mouse.up();

  await expect(names(page)).toHaveText(["test-pattern copy", "test-pattern"]);
  await expect(page.locator(".track-row--lifted")).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(names(page)).toHaveText(["test-pattern", "test-pattern copy"]);
});

test("a source track's grip picks it up and drops it from the keyboard", async ({
  page,
}) => {
  await openMenu(page, 0);
  await menuItem(page, "Duplicate").click();
  await expect(names(page)).toHaveText(["test-pattern", "test-pattern copy"]);

  await grip(page, 0).focus();
  await page.keyboard.press("Enter");
  const status = page.locator(".source-track-list .layer-reorder-status");
  await expect(status).toContainText("Picked up test-pattern, position 1 of 2");
  await page.keyboard.press("ArrowDown");
  await expect(status).toHaveText("test-pattern, position 2 of 2");
  await page.keyboard.press("Enter");
  await expect(status).toHaveText("Dropped test-pattern, position 2 of 2");
  await expect(names(page)).toHaveText(["test-pattern copy", "test-pattern"]);

  // Escape puts it back.
  await grip(page, 0).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(status).toHaveText("Canceled moving test-pattern copy");
  await expect(names(page)).toHaveText(["test-pattern copy", "test-pattern"]);
});
