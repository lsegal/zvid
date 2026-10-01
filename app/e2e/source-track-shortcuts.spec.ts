import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// Delete, Mod+D and the context-menu key act on the selected source track
// (#660), like they do on a selected clip.
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

function layerClips(page: Page) {
  return page.locator('[data-timeline-lane-id="1"] .clip-card');
}

function menuItem(page: Page, name: string) {
  return page.getByRole("menuitem", { name, exact: true });
}

async function selectTrack(page: Page, index: number) {
  const label = rows(page).nth(index).locator(".track-label__select");
  await label.scrollIntoViewIfNeeded();
  await label.click();
  await expect(rows(page).nth(index)).toHaveClass(/track-row--selected/);
}

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

test("Mod+D duplicates the selected source track, in one undo step", async ({
  page,
}) => {
  await selectTrack(page, 0);
  await page.keyboard.press("ControlOrMeta+d");
  await expect(names(page)).toHaveText(["test-pattern", "test-pattern copy"]);
  await expect(rows(page).nth(1).locator(".source-span")).toHaveCount(1);
  await expect(layerClips(page)).toHaveCount(1);
  // The selection follows the track to its duplicate.
  await expect(rows(page).nth(1)).toHaveClass(/track-row--selected/);
  await expect(rows(page).nth(0)).not.toHaveClass(/track-row--selected/);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(names(page)).toHaveText(["test-pattern"]);
});

test("Delete and Backspace delete the selected source track with its layer clips", async ({
  page,
}) => {
  await selectTrack(page, 0);
  await page.keyboard.press("ControlOrMeta+d");
  await expect(names(page)).toHaveText(["test-pattern", "test-pattern copy"]);

  // The copy has no layer clips of its own; the selection moves to the
  // track that takes its place.
  await page.keyboard.press("Delete");
  await expect(names(page)).toHaveText(["test-pattern"]);
  await expect(layerClips(page)).toHaveCount(1);
  await expect(rows(page).nth(0)).toHaveClass(/track-row--selected/);

  // The original takes its layer clip along.
  await page.keyboard.press("Backspace");
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator(".source-span")).toHaveCount(0);
  await expect(layerClips(page)).toHaveCount(0);

  // Undo brings both back in one step.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(names(page)).toHaveText(["test-pattern"]);
  await expect(page.locator(".source-span")).toHaveCount(1);
  await expect(layerClips(page)).toHaveCount(1);
});

test("Delete leaves the source track alone while a source clip on it is selected", async ({
  page,
}) => {
  await page.locator(".source-span").click();
  await expect(page.locator(".source-span")).toHaveClass(
    /source-span--selected/,
  );
  await page.keyboard.press("Delete");
  await page.keyboard.press("ControlOrMeta+d");
  await expect(names(page)).toHaveText(["test-pattern"]);
  await expect(layerClips(page)).toHaveCount(1);
});

test("a selected layer clip keeps Delete and Mod+D", async ({ page }) => {
  await selectTrack(page, 0);
  const clip = layerClips(page).first();
  await clip.scrollIntoViewIfNeeded();
  await clip.locator(".clip-card__body").click();
  await expect(clip).toHaveClass(/clip-card--selected/);

  await page.keyboard.press("ControlOrMeta+d");
  await expect(layerClips(page)).toHaveCount(2);
  await expect(names(page)).toHaveText(["test-pattern"]);
  await page.keyboard.press("Delete");
  await expect(layerClips(page)).toHaveCount(1);
  await expect(names(page)).toHaveText(["test-pattern"]);
});

test("the context-menu key opens the selected source track's menu", async ({
  page,
}) => {
  const menu = page.getByRole("menu", { name: "Source track actions" });
  await selectTrack(page, 0);
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  );
  await page.keyboard.press("Shift+F10");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  await page.keyboard.press("ContextMenu");
  await expect(menu).toBeVisible();
  await menuItem(page, "Duplicate").click();
  await expect(names(page)).toHaveText(["test-pattern", "test-pattern copy"]);
});
