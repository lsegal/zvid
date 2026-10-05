import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Double-clicking a layer, source track or Audio row handle outside its name
// collapses the row to 24px, with a 16px clip 4px down and no frames, and
// double-clicking it again expands it back (#1057). The name still renames.
// Collapsing keeps the handle's and clips' font sizes and doesn't move the
// index or name sideways (#1073).

const COLLAPSED_HEIGHT = 24;
const COLLAPSED_CLIP_HEIGHT = 16;
const COLLAPSED_CLIP_INSET = 4;
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

// Double-clicks a row's label just right of its name, where nothing else is.
async function doubleClickBesideName(page: Page, label: Locator) {
  const name = await label.locator(".track-label__select").boundingBox();
  if (!name) {
    throw new Error("Name is not visible");
  }
  await page.mouse.dblclick(name.x + name.width + 6, name.y + name.height / 2);
}

// Where a row's handle puts its grip, index (layers only) and name, and the
// font sizes of its name, index and clip label.
async function labelLayout(label: Locator, clipText: Locator) {
  const parts = {
    grip: label.locator(".track-label__grip"),
    index: label.locator(".track-label__index"),
    name: label.locator(".track-label__select > span"),
  };
  const layout: Record<string, number | string> = {
    clipFontSize: await fontSize(clipText),
  };
  for (const [part, locator] of Object.entries(parts)) {
    if ((await locator.count()) === 0) {
      continue;
    }
    const box = await locator.boundingBox();
    if (!box) {
      throw new Error(`${part} is not visible`);
    }
    layout[`${part}Left`] = box.x;
    if (part !== "grip") {
      layout[`${part}FontSize`] = await fontSize(locator);
    }
  }
  return layout;
}

function fontSize(locator: Locator) {
  return locator.evaluate((node) => getComputedStyle(node).fontSize);
}

// Collapsing kept the expanded font sizes and x positions (to within half a
// pixel), and the name fits the 24px row.
async function expectSameLayout(
  label: Locator,
  clipText: Locator,
  expanded: Awaited<ReturnType<typeof labelLayout>>,
) {
  const collapsed = await labelLayout(label, clipText);
  expect(Object.keys(collapsed)).toEqual(Object.keys(expanded));
  for (const [key, value] of Object.entries(expanded)) {
    if (typeof value === "number") {
      expect(Math.abs(Number(collapsed[key]) - value), key).toBeLessThan(0.5);
    } else {
      expect(collapsed[key], key).toBe(value);
    }
  }
  const name = label.locator(".track-label__select > span");
  expect(
    await name.evaluate((node) => node.scrollHeight <= node.clientHeight),
  ).toBe(true);
}

// Images drawn in a row: its frames and thumbnails.
function thumbnails(row: Locator) {
  return row.locator(
    ".clip-card__tile, .clip-card__thumb, .source-span__tile, .source-span__thumb",
  );
}

test.use({ viewport: { width: 1600, height: 1200 } });

test("double-clicking a layer's header collapses and expands its lane", async ({
  page,
}) => {
  await addVideoClips(page);
  const row = layerRow(page);
  const label = row.locator(".track-label");
  const clipText = row.locator(".clip-card__text strong");
  const expandedHeight = await height(row);
  expect(expandedHeight).toBe(66);
  const expandedLayout = await labelLayout(label, clipText);

  await label.locator(".track-label__index").dblclick();
  await expect(row).toHaveClass(/track-row--collapsed/);
  await expectSameLayout(label, clipText, expandedLayout);
  expect(await height(row)).toBe(COLLAPSED_HEIGHT);
  expect(await height(label)).toBe(COLLAPSED_HEIGHT);
  const clip = row.locator(".clip-card");
  expect(await height(clip)).toBe(COLLAPSED_CLIP_HEIGHT);
  expect(await clip.evaluate((node) => (node as HTMLElement).offsetTop)).toBe(
    COLLAPSED_CLIP_INSET,
  );
  await expect(thumbnails(row)).toHaveCount(0);
  await expect(clip.locator(".clip-card__text strong")).toBeVisible();
  // Grip, index and name stay; the summary and switches hide.
  await expect(label.locator(".track-label__grip")).toBeVisible();
  await expect(label.locator(".track-label__index")).toBeVisible();
  await expect(label.locator(".track-label__select > span")).toBeVisible();
  await expect(label.locator("small")).toBeHidden();
  await expect(label.locator(".track-label__fx")).toBeHidden();
  // Other rows keep their height and frames.
  expect(await height(page.locator('[data-layer-row-id="5"]'))).toBe(66);
  await expect(
    sourceRow(page).locator(".source-span__tile").first(),
  ).toBeVisible();

  await doubleClickBesideName(page, label);
  await expect(row).not.toHaveClass(/track-row--collapsed/);
  expect(await height(row)).toBe(expandedHeight);
  await expect(row.locator(".clip-card__tile").first()).toBeVisible();

  // The name still renames, without collapsing the row.
  await label.locator(".track-label__select").dblclick();
  await expect(
    label.getByRole("textbox", { name: "Layer name" }),
  ).toBeFocused();
  expect(await height(row)).toBe(expandedHeight);
});

test("double-clicking a source track's label collapses and expands it", async ({
  page,
}) => {
  await addVideoClips(page);
  const row = sourceRow(page);
  const label = row.locator(".track-label");
  const clipText = row.locator(".source-span__body span");
  const expandedHeight = await height(row);
  const expandedLayout = await labelLayout(label, clipText);

  await doubleClickBesideName(page, label);
  await expect(row).toHaveClass(/track-row--collapsed/);
  expect(await height(row)).toBe(COLLAPSED_HEIGHT);
  await expectSameLayout(label, clipText, expandedLayout);
  const span = row.locator(".source-span");
  expect(await height(span)).toBe(COLLAPSED_CLIP_HEIGHT);
  expect(await span.evaluate((node) => (node as HTMLElement).offsetTop)).toBe(
    COLLAPSED_CLIP_INSET,
  );
  await expect(thumbnails(row)).toHaveCount(0);
  await expect(label.locator("small")).toBeHidden();
  await expect(label.locator(".track-label__arm")).toBeHidden();
  // The layer showing the same media keeps its frames.
  await expect(
    layerRow(page).locator(".clip-card__tile").first(),
  ).toBeVisible();

  // The switches do nothing new.
  await label.locator(".track-label__grip").dblclick();
  await expect(row).toHaveClass(/track-row--collapsed/);

  await doubleClickBesideName(page, label);
  await expect(row).not.toHaveClass(/track-row--collapsed/);
  expect(await height(row)).toBe(expandedHeight);
  await expect(row.locator(".source-span__tile").first()).toBeVisible();

  await label.locator(".track-label__select").dblclick();
  await expect(
    label.getByRole("textbox", { name: "Source track name" }),
  ).toBeFocused();
  expect(await height(row)).toBe(expandedHeight);
});

test("double-clicking the Audio row's label collapses and expands it", async ({
  page,
}) => {
  await page.goto("/");
  const row = page.locator("[data-audio-row]");
  const label = row.locator(".track-label");
  const toggle = row.locator(".audio-row__toggle");
  const expandedHeight = await height(row);

  // Its label's padding, left of the toggle. The docked row moves as it
  // collapses and expands.
  const doubleClickPadding = async () => {
    const box = await label.boundingBox();
    if (!box) {
      throw new Error("Audio row is not visible");
    }
    await page.mouse.dblclick(box.x + 6, box.y + box.height / 2);
  };
  await doubleClickPadding();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(await height(row)).toBe(COLLAPSED_HEIGHT);
  await doubleClickPadding();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(await height(row)).toBe(expandedHeight);

  // A double-click on the toggle toggles once, though the row moves out
  // from under its second click.
  await toggle.dblclick();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.dblclick();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(await height(row)).toBe(expandedHeight);

  // The Refresh button does nothing new.
  await row.getByRole("button", { name: "Recompute audio" }).dblclick();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
});
