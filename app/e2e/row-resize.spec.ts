import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { addLayers } from "./layers.ts";

// Dragging the separator along the bottom of a layer, source track or Audio
// row handle resizes that row alone, between the 44px collapsed form and 4x
// its default height (#1058). Dragged to the minimum it collapses, and
// double-clicking its handle then expands it to the dragged height.

const COLLAPSED_HEIGHT = 44;
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

// A video in a source track, copied to Layer 1, both showing frames.
async function addVideoClips(page: Page) {
  await page.goto("/");
  await expect(page.locator('[data-timeline-lane-id="1"]')).toBeVisible();
  await dropVideoIntoNewSourceTrack(page);
  await page.locator(".source-span").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy to layer" }).hover();
  await page.getByRole("menuitem", { name: "Layer 1" }).click();
  await expect(layerRow(page).locator(".clip-card")).toHaveCount(1);
  await expect(layerRow(page).locator(".clip-card__tile").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    sourceRow(page).locator(".source-span__tile").first(),
  ).toBeVisible();
}

function layerRow(page: Page) {
  return page.locator('[data-layer-row-id="1"]');
}

function sourceRow(page: Page) {
  return page.locator(".track-row--source[data-source-track-id]").first();
}

async function height(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Not visible");
  }
  return box.height;
}

// Images drawn in a row: its frames and thumbnails.
function thumbnails(row: Locator) {
  return row.locator(
    ".clip-card__tile, .clip-card__thumb, .source-span__tile, .source-span__thumb",
  );
}

// Drags a row's separator by dy pixels, right of its grip.
async function dragSeparator(page: Page, row: Locator, dy: number) {
  const separator = row.locator(".row-resize-handle");
  await separator.scrollIntoViewIfNeeded();
  const box = await separator.boundingBox();
  if (!box) {
    throw new Error("Separator is not visible");
  }
  const x = box.x + box.width * 0.6;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy, { steps: 8 });
  await page.mouse.up();
}

test.use({ viewport: { width: 1600, height: 1200 } });

test("dragging a layer's separator resizes only that lane", async ({
  page,
}) => {
  await addVideoClips(page);
  await addLayers(page, 1);
  const row = layerRow(page);
  const label = row.locator(".track-label");
  const separator = row.locator(".row-resize-handle");
  const nextRow = page.locator('[data-layer-row-id="2"]');
  await expect(separator).toHaveCSS("cursor", "row-resize");
  expect(await height(row)).toBe(66);
  const clipHeight = await height(row.locator(".clip-card"));
  const nextTop = (await nextRow.boundingBox())?.y ?? 0;

  await dragSeparator(page, row, 40);
  expect(await height(row)).toBe(106);
  expect(await height(label)).toBe(106);
  expect(await height(row.locator(".clip-card"))).toBeGreaterThan(clipHeight);
  // The rows below move down and keep their height.
  expect(await height(nextRow)).toBe(66);
  expect((await nextRow.boundingBox())?.y).toBe(nextTop + 40);
  await expect(separator).toHaveAttribute("aria-valuenow", "106");

  // No taller than 4x the default.
  await dragSeparator(page, row, 600);
  expect(await height(row)).toBe(264);
  await dragSeparator(page, row, -164);
  expect(await height(row)).toBe(100);

  // Shorter than the default, the handle fits the row.
  await dragSeparator(page, row, -50);
  expect(await height(row)).toBe(50);
  expect(await height(label)).toBe(50);
  await expect(row).toHaveClass(/track-row--short/);
  await expect(row).not.toHaveClass(/track-row--collapsed/);

  // Dragged to the minimum, it collapses, without frames.
  await dragSeparator(page, row, -100);
  await expect(row).toHaveClass(/track-row--collapsed/);
  expect(await height(row)).toBe(COLLAPSED_HEIGHT);
  await expect(thumbnails(row)).toHaveCount(0);
  expect(await height(nextRow)).toBe(66);

  // Double-clicking the handle expands it to the height it was dragged from,
  // and collapses it again.
  await label.locator(".track-label__index").dblclick();
  await expect(row).not.toHaveClass(/track-row--collapsed/);
  expect(await height(row)).toBe(50);
  await label.locator(".track-label__index").dblclick();
  expect(await height(row)).toBe(COLLAPSED_HEIGHT);
  await label.locator(".track-label__index").dblclick();
  expect(await height(row)).toBe(50);
});

test("the separator leaves the grip, selection and rename alone", async ({
  page,
}) => {
  await page.goto("/");
  await addLayers(page, 1);
  const row = page.locator('[data-layer-row-id="2"]');
  const label = row.locator(".track-label");
  await label.locator(".track-label__index").dblclick();
  await expect(row).toHaveClass(/track-row--collapsed/);

  // The collapsed grip reaches the separator, and stays on top of it.
  const grip = label.locator(".track-label__grip");
  const gripBox = await grip.boundingBox();
  if (!gripBox) {
    throw new Error("Grip is not visible");
  }
  const topAtGripBottom = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.className,
    [gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height - 1],
  );
  expect(topAtGripBottom).toContain("track-label__grip");

  // Resizing doesn't select the row; clicking its label still does.
  await layerRow(page).locator(".track-label__index").click();
  await expect(row).not.toHaveClass(/track-row--selected/);
  await dragSeparator(page, row, 10);
  expect(await height(row)).toBe(54);
  await expect(row).not.toHaveClass(/track-row--selected/);
  await label.locator(".track-label__index").click();
  await expect(row).toHaveClass(/track-row--selected/);

  // Dragging the grip still reorders the layers.
  const firstRow = page.locator(".track-row[data-layer-row-id]").first();
  await expect(firstRow).toHaveAttribute("data-layer-row-id", "1");
  const target = await layerRow(page).boundingBox();
  if (!target) {
    throw new Error("Layer 1 is not visible");
  }
  await grip.hover();
  await page.mouse.down();
  await page.mouse.move(target.x + 20, target.y + 4, { steps: 10 });
  await page.mouse.up();
  await expect(firstRow).toHaveAttribute("data-layer-row-id", "2");
  expect(await height(row)).toBe(54);

  // The name still renames.
  await label.locator(".track-label__select").dblclick();
  await expect(
    label.getByRole("textbox", { name: "Layer name" }),
  ).toBeFocused();
});

test("dragging a source track's separator resizes only that track", async ({
  page,
}) => {
  await addVideoClips(page);
  const row = sourceRow(page);
  const span = row.locator(".source-span");
  expect(await height(row)).toBe(82);
  const spanHeight = await height(span);

  await dragSeparator(page, row, 50);
  expect(await height(row)).toBe(132);
  expect(await height(span)).toBeGreaterThan(spanHeight);
  expect(await height(layerRow(page))).toBe(66);

  // Within the viewport, which the pointer can't leave.
  await dragSeparator(page, row, 300);
  expect(await height(row)).toBe(328);

  await dragSeparator(page, row, -400);
  await expect(row).toHaveClass(/track-row--collapsed/);
  expect(await height(row)).toBe(COLLAPSED_HEIGHT);
  await expect(thumbnails(row)).toHaveCount(0);
  await expect(
    layerRow(page).locator(".clip-card__tile").first(),
  ).toBeVisible();

  await row.locator(".track-label__stripe").dblclick();
  expect(await height(row)).toBe(328);
});

test("dragging the Audio row's separator resizes and collapses it", async ({
  page,
}) => {
  await page.goto("/");
  const row = page.locator("[data-audio-row]");
  const toggle = row.locator(".audio-row__toggle");
  expect(await height(row)).toBe(78);

  await dragSeparator(page, row, 30);
  expect(await height(row)).toBe(108);
  await dragSeparator(page, row, -60);
  expect(await height(row)).toBe(48);
  expect(await height(row.locator(".track-label"))).toBe(48);

  await dragSeparator(page, row, -100);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(await height(row)).toBe(COLLAPSED_HEIGHT);

  // The toggle expands it to the height it was dragged from.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(await height(row)).toBe(48);

  // Dragging a collapsed row expands it.
  await toggle.click();
  await dragSeparator(page, row, 40);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(await height(row)).toBe(84);
});
