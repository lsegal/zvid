import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// The top-bar Edit menu mirrors the clip, layer and Audio row right-click
// menus under Edit ▸ Clip, Edit ▸ Layer and Edit ▸ Audio.
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

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

async function openEditMenu(page: Page) {
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const menu = page.getByRole("menu").first();
  await expect(menu).toBeVisible();
  return menu;
}

// Hovers a submenu trigger and returns the submenu it opens.
async function openSubmenu(page: Page, name: string | RegExp) {
  await page.getByRole("menuitem", { name }).hover();
  const submenu = page.getByRole("menu").nth(1);
  await expect(submenu).toBeVisible();
  return submenu;
}

// Default layers: "1" is Layer 1, "5" is Layer 2 and "6" is Layer 3.
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
});

test("Edit shows Clip and Layer only for a selection, and Audio always", async ({
  page,
}) => {
  const menu = await openEditMenu(page);
  await expect(menu.getByRole("menuitem")).toHaveText([
    /^Undo/,
    /^Redo/,
    /^Cut/,
    /^Copy/,
    /^Paste/,
    "Insert Fill Layer",
    "Audio",
  ]);
  for (const name of ["Cut", "Copy", "Paste", "Insert Fill Layer"]) {
    await expect(
      page.getByRole("menuitem", { name: new RegExp(`^${name}`) }),
    ).toHaveAttribute("aria-disabled", "true");
  }

  const audio = await openSubmenu(page, "Audio");
  await expect(audio.getByRole("menuitem")).toHaveText(["Import main audio…"]);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // Clicking a layer header selects the layer.
  await page
    .locator(".track-label--lane")
    .filter({ hasText: "Layer 2" })
    .locator(".track-label__index")
    .click();
  await openEditMenu(page);
  const layer = await openSubmenu(page, "Layer: Layer 2");
  await expect(layer.getByRole("menuitem")).toHaveText([
    "Rename…",
    "Duplicate",
    "Delete",
    /^(Enable|Disable) FX$/,
    "Add FX",
    "Insert layer above",
    "Insert layer below",
    "Move up",
    "Move down",
  ]);
  await expect(page.getByRole("menuitem", { name: /^Clip:/ })).toHaveCount(0);

  // Same action as the header's right-click menu: a new layer above.
  await page.getByRole("menuitem", { name: "Insert layer above" }).click();
  await expect(
    page.locator(".track-label--lane").filter({ hasText: "Layer 4" }),
  ).toBeVisible();
});

test("Edit ▸ Clip runs the clip actions on the selected clip", async ({
  page,
}) => {
  await dropVideoIntoNewSourceTrack(page);
  await page.locator(".source-span").click({ modifiers: ["ControlOrMeta"] });
  const clip = page.locator(".clip-card");
  await expect(clip).toHaveCount(1);
  await clip.click();
  await expect(clip).toHaveClass(/clip-card--selected/);

  await openEditMenu(page);
  const clipMenu = await openSubmenu(page, /^Clip: /);
  await expect(clipMenu.getByRole("menuitem")).toHaveText([
    /^Duplicate/,
    /^Split at playhead/,
    /^Delete/,
  ]);
  await expect(
    page.getByRole("menuitem", { name: /^Split at playhead/ }),
  ).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("menuitem", { name: /^Layer: / })).toBeVisible();

  await page.getByRole("menuitem", { name: /^Duplicate/ }).click();
  await expect(page.locator(".clip-card")).toHaveCount(2);

  // Copy, then Paste at the playhead on the selected layer.
  await openEditMenu(page);
  await page.getByRole("menuitem", { name: /^Copy/ }).click();
  await page
    .locator(".track-label--lane")
    .filter({ hasText: "Layer 2" })
    .locator(".track-label__index")
    .click();
  await openEditMenu(page);
  await expect(page.getByRole("menuitem", { name: /^Clip: / })).toHaveCount(0);
  await page.getByRole("menuitem", { name: /^Paste/ }).click();
  const pasted = lane(page, "5").locator(".clip-card");
  await expect(pasted).toHaveCount(1);
  await expect(pasted).toHaveClass(/clip-card--selected/);

  await openEditMenu(page);
  await openSubmenu(page, /^Clip: /);
  await page.getByRole("menuitem", { name: /^Delete/ }).click();
  await expect(pasted).toHaveCount(0);
});
