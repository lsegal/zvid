import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// The source clip menu has the layer clip menu's Jump to start, Cut, Copy,
// Paste, Duplicate, Split at playhead and Delete, acting within the source
// track, then Copy to layer (#699). Mod+E never splits a source clip. A
// four-second test pattern at 120 BPM spans eight quarters.
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

function menuItem(page: Page, name: string | RegExp) {
  return page.getByRole("menuitem", { name });
}

// Scrolling closes an open menu, so bring the target into view (and let its
// scroll event fire) before right-clicking it.
async function rightClick(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator
    .page()
    .evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  await locator.click({ button: "right" });
}

async function openMenu(page: Page, span: Locator) {
  await rightClick(span);
  await expect(menuItem(page, /^Copy to layer/)).toBeVisible();
}

// Each span's left edge and width, in timeline pixels.
async function layout(page: Page) {
  return spans(page).evaluateAll((elements) =>
    elements
      .map((element) => ({
        left: Number.parseFloat((element as HTMLElement).style.left),
        width: element.getBoundingClientRect().width,
      }))
      .sort((a, b) => a.left - b.left),
  );
}

// The playhead's left edge within the lane, independent of scroll.
async function playheadX(page: Page) {
  return page.evaluate(() => {
    const marker = document.querySelector(
      ".timeline-playhead-marker",
    ) as HTMLElement;
    const content = document.querySelector(
      "[data-timeline-lane-id]",
    ) as HTMLElement;
    return (
      marker.getBoundingClientRect().left - content.getBoundingClientRect().left
    );
  });
}

// A click on empty Layer 3 under `fraction` of the span seeks there.
async function seekInto(page: Page, span: Locator, fraction: number) {
  // A paste scrolls the timeline, which can leave the span under the sticky
  // layer labels, so scroll back first.
  await page.locator(".timeline-scroll").evaluate((element) => {
    element.scrollLeft = 0;
  });
  const [spanBox, laneBox] = await Promise.all([
    span.boundingBox(),
    lane(page, "6").boundingBox(),
  ]);
  if (!spanBox || !laneBox) {
    throw new Error("timeline is not visible");
  }
  await page.mouse.click(spanBox.x + spanBox.width * fraction, laneBox.y + 20);
}

test.use({ viewport: { width: 1600, height: 1200 } });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await dropVideoIntoNewSourceTrack(page);
});

test("lists the layer clip items, then Copy to layer, with no Split hint", async ({
  page,
}) => {
  await openMenu(page, spans(page).first());
  const menu = page.getByRole("menu").first();
  const labels = await menu.getByRole("menuitem").allTextContents();
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
    "Copy to layer",
  ]);
  await expect(menuItem(page, /^Split at playhead/)).not.toContainText(/\+E/);
  await expect(menuItem(page, /^Cut/)).toContainText(/\+X/);
  await expect(menuItem(page, /^Duplicate/)).toContainText(/\+D/);
  // The playhead sits at the clip's start, so Split cannot apply.
  await expect(menuItem(page, /^Split at playhead/)).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});

test("Jump to start moves the playhead to the source clip's start", async ({
  page,
}) => {
  const span = spans(page).first();
  const [{ left }] = await layout(page);
  await seekInto(page, span, 0.5);
  await expect.poll(() => playheadX(page)).toBeGreaterThan(left + 40);

  await openMenu(page, span);
  await menuItem(page, /^Jump to start/).click();
  await expect(span).toHaveClass(/source-span--selected/);
  await expect
    .poll(async () => Math.abs((await playheadX(page)) - left))
    .toBeLessThan(3);
});

test("Split at playhead splits it, while Mod+E never does", async ({
  page,
}) => {
  const span = spans(page).first();
  const [{ left, width }] = await layout(page);
  await seekInto(page, span, 0.5);

  // Mod+E with only the source clip selected does nothing.
  await span.click();
  await expect(span).toHaveClass(/source-span--selected/);
  await page.keyboard.press("ControlOrMeta+e");
  await expect(spans(page)).toHaveCount(1);

  await openMenu(page, span);
  await menuItem(page, /^Split at playhead/).click();
  await expect(spans(page)).toHaveCount(2);
  const pieces = await layout(page);
  expect(pieces[0].left).toBeCloseTo(left, 0);
  expect(pieces[1].left).toBeCloseTo(left + width / 2, -1);
  expect(pieces[0].width + pieces[1].width).toBeCloseTo(width, -1);

  // Undo puts it back in one step.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(spans(page)).toHaveCount(1);
});

test("the Edit menu offers no Split for a selected source clip", async ({
  page,
}) => {
  const span = spans(page).first();
  await seekInto(page, span, 0.5);
  await span.click();
  await expect(span).toHaveClass(/source-span--selected/);
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await expect(menuItem(page, /^Copy(?! to)/)).toBeVisible();
  await expect(menuItem(page, /^Clip:/)).toHaveCount(0);
  await expect(menuItem(page, /^Split at playhead/)).toHaveCount(0);
});

test("Duplicate inserts a copy right after it; Delete removes it", async ({
  page,
}) => {
  const [{ left, width }] = await layout(page);
  await openMenu(page, spans(page).first());
  await menuItem(page, /^Duplicate/).click();
  await expect(spans(page)).toHaveCount(2);
  const [first, copy] = await layout(page);
  expect(first.left).toBeCloseTo(left, 0);
  expect(copy.left).toBeCloseTo(left + width, -1);

  await openMenu(page, spans(page).last());
  await menuItem(page, /^Delete/).click();
  await expect(spans(page)).toHaveCount(1);
});

test("Mod+D and Delete act on the selected source clip", async ({ page }) => {
  const span = spans(page).first();
  await span.click();
  await page.keyboard.press("ControlOrMeta+d");
  await expect(spans(page)).toHaveCount(2);
  // The copy is selected; Delete removes it.
  await expect(spans(page).last()).toHaveClass(/source-span--selected/);
  await page.keyboard.press("Delete");
  await expect(spans(page)).toHaveCount(1);
});

test("Copy pastes onto a layer and into the source track", async ({ page }) => {
  const span = spans(page).first();
  const [{ left, width }] = await layout(page);
  await openMenu(page, span);
  await menuItem(page, /^Copy(?! to)/).click();

  // Onto a layer, from its menu.
  await lane(page, "5").scrollIntoViewIfNeeded();
  await lane(page, "5").click({ button: "right", position: { x: 400, y: 20 } });
  await menuItem(page, /^Paste/).click();
  await expect(lane(page, "5").locator(".clip-card")).toHaveCount(1);

  // Into the source track at the playhead, overwriting the rest of the clip.
  await seekInto(page, span, 0.5);
  await openMenu(page, span);
  await menuItem(page, /^Paste/).click();
  await expect(spans(page)).toHaveCount(2);
  const [kept, pasted] = await layout(page);
  expect(kept.left).toBeCloseTo(left, 0);
  expect(kept.width).toBeCloseTo(width / 2, -1);
  expect(pasted.left).toBeCloseTo(left + width / 2, -1);
  expect(pasted.width).toBeCloseTo(width, -1);
});

test("Cut removes it, and Paste puts it back into the source track", async ({
  page,
}) => {
  const [{ left }] = await layout(page);
  await openMenu(page, spans(page).first());
  await menuItem(page, /^Duplicate/).click();
  await expect(spans(page)).toHaveCount(2);

  await openMenu(page, spans(page).last());
  await menuItem(page, /^Cut/).click();
  await expect(spans(page)).toHaveCount(1);

  // The playhead is at the start, so it pastes over the remaining clip.
  await openMenu(page, spans(page).first());
  await menuItem(page, /^Paste/).click();
  await expect(spans(page)).toHaveCount(1);
  await expect(spans(page).first()).toHaveClass(/source-span--selected/);
  expect((await layout(page))[0].left).toBeCloseTo(left, 0);
});

test("Mod+V pastes a copied source clip at the playhead, undone in one step", async ({
  page,
}) => {
  const span = spans(page).first();
  const [{ left, width }] = await layout(page);
  await span.click();
  await page.keyboard.press("ControlOrMeta+c");

  // Past the clip, into empty space; seeking leaves the clip selected.
  await seekInto(page, span, 1.5);
  await span.click();
  await page.keyboard.press("ControlOrMeta+v");
  await expect(spans(page)).toHaveCount(2);
  const [kept, pasted] = await layout(page);
  expect(kept).toEqual({ left, width });
  expect(pasted.left).toBeCloseTo(left + width * 1.5, -1);
  expect(pasted.width).toBeCloseTo(width, 0);
  await expect(spans(page).last()).toHaveClass(/source-span--selected/);
  await expect(page.locator(".clip-card")).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(spans(page)).toHaveCount(1);
  expect(await layout(page)).toEqual([{ left, width }]);
});

test("after Cut, Mod+V and Edit > Paste go back into the source track", async ({
  page,
}) => {
  const [{ left, width }] = await layout(page);
  await spans(page).first().click();
  await page.keyboard.press("ControlOrMeta+x");
  await expect(spans(page)).toHaveCount(0);

  // The source track stays selected, so the paste lands there, not on a
  // layer.
  await page.keyboard.press("ControlOrMeta+v");
  await expect(spans(page)).toHaveCount(1);
  expect(await layout(page)).toEqual([{ left, width }]);
  await expect(spans(page).first()).toHaveClass(/source-span--selected/);
  await expect(page.locator(".clip-card")).toHaveCount(0);

  await spans(page).first().click();
  await page.keyboard.press("ControlOrMeta+x");
  await expect(spans(page)).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await menuItem(page, /^Paste/).click();
  await expect(spans(page)).toHaveCount(1);
  expect(await layout(page)).toEqual([{ left, width }]);
  await expect(page.locator(".clip-card")).toHaveCount(0);
});

test("locked source tracks disable the editing items", async ({ page }) => {
  await page.locator(".source-header__lock").click();
  await openMenu(page, spans(page).first());
  for (const name of [
    /^Cut/,
    /^Paste/,
    /^Duplicate/,
    /^Split at playhead/,
    /^Delete/,
  ]) {
    const item = menuItem(page, name);
    await expect(item).toHaveAttribute("aria-disabled", "true");
    await expect(item).toHaveAttribute("title", "Source tracks are locked");
  }
  for (const name of [/^Jump to start/, /^Copy(?! to)/, /^Copy to layer/]) {
    await expect(menuItem(page, name)).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
  }

  // Their shortcuts leave the clip alone too.
  await page.keyboard.press("Escape");
  await spans(page).first().click();
  await page.keyboard.press("ControlOrMeta+d");
  await page.keyboard.press("Delete");
  await expect(spans(page)).toHaveCount(1);
});
