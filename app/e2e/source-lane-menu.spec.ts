import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Empty space in a source track's timeline row has the layer lane menu's
// entries (#960): Paste goes into the track, and the entries that need a
// clip act on the track's selected source clip. A four-second test pattern
// at 120 BPM spans eight quarters.
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
  await expect(spans(page)).toHaveCount(1, { timeout: 30_000 });
}

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

function spans(page: Page) {
  return page.locator(".source-span");
}

function sourceLane(page: Page) {
  return page.locator(".track-row__content--source").first();
}

function menu(page: Page) {
  return page.getByRole("menu", { name: "Source track timeline actions" });
}

function menuItem(page: Page, name: string | RegExp) {
  return page.getByRole("menuitem", { name });
}

// Each span's left edge, in timeline pixels.
async function lefts(page: Page) {
  return spans(page).evaluateAll((elements) =>
    elements
      .map((element) => Number.parseFloat((element as HTMLElement).style.left))
      .sort((a, b) => a - b),
  );
}

// Waits two frames, so a scroll's event fires before the next action.
async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

// Right-clicks the source track `offsetX` pixels past the first span's
// right edge, in empty space.
async function rightClickEmpty(page: Page, offsetX: number) {
  const span = spans(page).first();
  await span.scrollIntoViewIfNeeded();
  await settle(page);
  const [spanBox, laneBox] = await Promise.all([
    span.boundingBox(),
    sourceLane(page).boundingBox(),
  ]);
  if (!spanBox || !laneBox) {
    throw new Error("source track is not visible");
  }
  await page.mouse.click(
    spanBox.x + spanBox.width + offsetX,
    laneBox.y + laneBox.height / 2,
    { button: "right" },
  );
  await expect(menu(page)).toBeVisible();
}

// A click on empty Layer 3 `offsetX` pixels past the span's right edge
// seeks there.
async function seekPast(page: Page, span: Locator, offsetX: number) {
  const [spanBox, laneBox] = await Promise.all([
    span.boundingBox(),
    lane(page, "6").boundingBox(),
  ]);
  if (!spanBox || !laneBox) {
    throw new Error("timeline is not visible");
  }
  await page.mouse.click(spanBox.x + spanBox.width + offsetX, laneBox.y + 20);
}

function disabled(item: Locator) {
  return expect(item).toHaveAttribute("aria-disabled", "true");
}

function enabled(item: Locator) {
  return expect(item).not.toHaveAttribute("aria-disabled", "true");
}

test.use({ viewport: { width: 1600, height: 1200 } });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await dropVideoIntoNewSourceTrack(page);
});

test("lists the layer lane menu's entries and pastes a copied source clip", async ({
  page,
}) => {
  const span = spans(page).first();
  await span.click();
  await page.keyboard.press("ControlOrMeta+c");
  const [left] = await lefts(page);
  const width = (await span.boundingBox())?.width ?? 0;
  await seekPast(page, span, 100);

  await rightClickEmpty(page, 200);
  const labels = await menu(page).getByRole("menuitem").allTextContents();
  expect(
    labels.map((label) => label.replace(/(Ctrl|Cmd|⌘).*|Del$/, "")),
  ).toEqual([
    "Jump to start",
    "Cut",
    "Copy",
    "Paste",
    "Duplicate",
    "Split at playhead",
    "Delete",
  ]);
  await enabled(menuItem(page, /^Paste/));

  await menuItem(page, /^Paste/).click();
  await expect(spans(page)).toHaveCount(2);
  const pasted = await lefts(page);
  expect(pasted[0]).toBeCloseTo(left, 0);
  expect(pasted[1]).toBeCloseTo(left + width + 100, -1);

  // Undo takes the paste back in one step.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(spans(page)).toHaveCount(1);
});

test("without a selected source clip, only Paste is available", async ({
  page,
}) => {
  await rightClickEmpty(page, 200);
  for (const name of [
    /^Jump to start/,
    /^Cut/,
    /^Copy/,
    /^Duplicate/,
    /^Split at playhead/,
    /^Delete/,
  ]) {
    await disabled(menuItem(page, name));
  }
  // Nothing has been copied yet.
  await disabled(menuItem(page, /^Paste/));
});

test("acts on the track's selected source clip", async ({ page }) => {
  const span = spans(page).first();
  await span.click();
  await expect(span).toHaveClass(/source-span--selected/);

  await rightClickEmpty(page, 200);
  await menuItem(page, /^Duplicate/).click();
  await expect(spans(page)).toHaveCount(2);

  // Duplicate selects the copy, which Delete then removes.
  await rightClickEmpty(page, 600);
  await menuItem(page, /^Delete/).click();
  await expect(spans(page)).toHaveCount(1);
});

test("grays out Paste while the clipboard holds layer content", async ({
  page,
}) => {
  await page.locator('[data-layer-header-id="1"]').click({ button: "right" });
  await menuItem(page, "Insert text at playhead").click();
  const clip = lane(page, "1").locator(".clip-card").first();
  await clip.locator(".clip-card__body").click();
  await expect(clip).toHaveClass(/clip-card--selected/);
  await page.keyboard.press("ControlOrMeta+c");

  await rightClickEmpty(page, 200);
  await disabled(menuItem(page, /^Paste/));
});

test("respects the source track lock", async ({ page }) => {
  const span = spans(page).first();
  await span.click();
  await page.keyboard.press("ControlOrMeta+c");
  await page.getByRole("button", { name: "Lock source tracks" }).click();
  await span.click();

  await rightClickEmpty(page, 200);
  for (const name of [/^Cut/, /^Paste/, /^Duplicate/, /^Delete/]) {
    await disabled(menuItem(page, name));
  }
  await enabled(menuItem(page, /^Copy/));
});

test("the context-menu key opens it on the selected source clip's track", async ({
  page,
}) => {
  const span = spans(page).first();
  await span.click();
  await expect(span).toHaveClass(/source-span--selected/);
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  );

  await page.keyboard.press("Shift+F10");
  await expect(menu(page)).toBeVisible();
  await expect(menu(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toBeHidden();

  await page.keyboard.press("ContextMenu");
  await expect(menu(page)).toBeVisible();
  await menuItem(page, /^Duplicate/).click();
  await expect(spans(page)).toHaveCount(2);
});
