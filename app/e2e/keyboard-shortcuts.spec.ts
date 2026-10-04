import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// The keyboard shortcuts work after loading the app, and after a press on the
// timeline takes the focus off a text field or slider that had it. The
// timeline cancels the browser's default for its presses, which used to leave
// the focus, and so every shortcut key, in that field (#926).
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Element is not visible");
  }
  return box;
}

// By label, since an open dialog hides the transport from the
// accessibility tree.
function playButton(page: Page) {
  return page.locator('button[aria-label="Play timeline"]');
}

function pauseButton(page: Page) {
  return page.locator('button[aria-label="Pause playback"]');
}

function textField(page: Page) {
  return page
    .locator('section[aria-label="Text"]')
    .getByRole("textbox", { name: "Text" });
}

// The playhead's left edge within the lanes, independent of scroll.
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

async function drawSelection(target: Locator, fromX: number, toX: number) {
  const page = target.page();
  const bounds = await boxOf(target);
  const y = bounds.y + 20;
  await page.mouse.move(bounds.x + fromX, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + toX, y, { steps: 4 });
  await page.mouse.up();
  const selection = target.locator(".timeline-selection");
  await expect(selection).toBeVisible();
  return selection;
}

// A text clip on Layer 1, so there is something to play. It stays selected,
// with its Text effect open in the FX panel.
async function insertTextClip(page: Page) {
  await drawSelection(lane(page, "1"), 40, 260);
  const bounds = await boxOf(lane(page, "1"));
  await page.mouse.click(bounds.x + 150, bounds.y + 20, { button: "right" });
  await page
    .getByRole("menu", { name: "Selection actions" })
    .getByRole("menuitem", { name: "Insert Text Clip" })
    .click();
  const clip = lane(page, "1").locator(".clip-card--text");
  await expect(clip).toHaveCount(1);
  return clip;
}

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

// Home and End jump the playhead, the arrows step it, and Space plays and
// stops.
async function expectTransportShortcuts(page: Page) {
  await page.keyboard.press("End");
  await expect.poll(() => playheadX(page)).toBeGreaterThan(100);
  const end = await playheadX(page);
  await page.keyboard.press("Shift+ArrowLeft");
  await expect.poll(() => playheadX(page)).toBeLessThan(end);
  await page.keyboard.press("Home");
  await expect.poll(() => playheadX(page)).toBeLessThan(5);

  await expect(playButton(page)).toBeVisible();
  await page.keyboard.press("Space");
  await expect(pauseButton(page)).toBeVisible();
  await page.keyboard.press("Space");
  await expect(playButton(page)).toBeVisible();
}

// The docked Audio row leaves less room for layers; the default session's
// layers all fit at this size.
test.use({ viewport: { width: 1600, height: 1200 } });

// Default layers: "1" is Layer 1, "5" is Layer 2 and "6" is Layer 3.
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(lane(page, "6")).toBeVisible();
  await page.locator(".timeline-scroll").evaluate((element) => {
    element.scrollLeft = 0;
  });
});

test("shortcuts work after loading the app", async ({ page }) => {
  const clip = await insertTextClip(page);
  await page.locator(".timeline-scroll").click({ position: { x: 5, y: 5 } });
  await expectTransportShortcuts(page);

  // Escape drops a drawn selection, then deselects the clip.
  const selection = await drawSelection(lane(page, "5"), 40, 200);
  await page.keyboard.press("Escape");
  await expect(selection).toHaveCount(0);
  await clip.click();
  await expect(clip).toHaveClass(/clip-card--selected/);
  await page.keyboard.press("Escape");
  await expect(clip).not.toHaveClass(/clip-card--selected/);
});

// A press on lane space would deselect the clip and close its Text field,
// so the ruler, which keeps the clip selected, presses outside it.
test("a press on the ruler takes the focus off a text field", async ({
  page,
}) => {
  const clip = await insertTextClip(page);
  const text = textField(page);
  await text.fill("Title");
  await expect(text).toBeFocused();

  const ruler = await boxOf(page.locator(".ruler-row"));
  await page.mouse.click(ruler.x + 400, ruler.y + ruler.height / 2);
  await expect(text).not.toBeFocused();
  await expect(clip).toHaveClass(/clip-card--selected/);
  await expectTransportShortcuts(page);
  await expect(text).toHaveValue("Title");
  await expect(clip.locator("strong")).toHaveText("Title");

  await page.keyboard.press("Escape");
  await expect(clip).not.toHaveClass(/clip-card--selected/);
});

test("a press on a lane takes the focus off the zoom slider", async ({
  page,
}) => {
  await insertTextClip(page);
  const zoom = page.getByRole("slider", { name: "Timeline zoom" });
  await zoom.focus();
  await expect(zoom).toBeFocused();
  const zoomValue = await zoom.inputValue();

  const layer3 = await boxOf(lane(page, "6"));
  await page.mouse.click(layer3.x + 500, layer3.y + 20);
  await expect(zoom).not.toBeFocused();
  await expectTransportShortcuts(page);
  await expect(zoom).toHaveValue(zoomValue);
});

test("a number key commits a selection drawn with the zoom slider focused", async ({
  page,
}) => {
  await dropVideoIntoNewSourceTrack(page);
  const zoom = page.getByRole("slider", { name: "Timeline zoom" });
  await zoom.focus();
  await expect(zoom).toBeFocused();

  const selection = await drawSelection(lane(page, "5"), 40, 200);
  await expect(zoom).not.toBeFocused();
  await page.keyboard.press("1");
  await expect(selection).toHaveCount(0);
  await expect(lane(page, "5").locator(".clip-card")).toHaveCount(1);
});
