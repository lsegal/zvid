// Needs real transport playback; the rest is PreviewTextEditor.component.test.
import { expect, type Page, test } from "@playwright/test";
import { addLayers } from "./layers.ts";

// The docked Audio row footer (#809) leaves less room for layers to scroll
// in; these tests' layers fit without scrolling at this size.
test.use({ viewport: { width: 1600, height: 1200 } });

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

// Adds Layer 2 ("2") to seek from, then a text clip on Layer 1.
async function insertTextClip(page: Page) {
  await addLayers(page, 1);
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
  // Seek onto the clip from an empty layer so the preview shows it, then
  // select it. Selecting alone leaves the playhead where it is.
  const clipBox = await clip.boundingBox();
  const emptyLane = await lane(page, "2").boundingBox();
  if (!clipBox || !emptyLane) {
    throw new Error("Text clip is not visible");
  }
  await page.mouse.click(clipBox.x + clipBox.width / 2, emptyLane.y + 20);
  await clip.locator(".clip-card__body").click();
  return clip;
}

// The center of the letterboxed video, in page coordinates.
async function videoCenter(page: Page) {
  return page.locator(".composition-player__canvas").evaluate((canvas) => {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    };
  });
}

// Whether the selected layer's resize handles, rotation handle and origin
// marker are shown.
async function expectTransformHandles(page: Page, shown: boolean) {
  await expect(page.locator("[data-transform-handle]")).toHaveCount(
    shown ? 8 : 0,
  );
  await expect(page.getByTestId("preview-rotation-handle")).toHaveCount(
    shown ? 1 : 0,
  );
  await expect(page.getByTestId("preview-transform-origin")).toHaveCount(
    shown ? 1 : 0,
  );
}

test("starting playback ends text editing and brings the handles back", async ({
  page,
}) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  const clip = await insertTextClip(page);
  const editor = page.getByTestId("preview-text-editor");
  const input = editor.getByRole("textbox");
  const center = await videoCenter(page);

  await page.mouse.click(center.x, center.y);
  await expectTransformHandles(page, true);
  await page.mouse.dblclick(center.x, center.y);
  await expect(input).toBeFocused();
  await expectTransformHandles(page, false);

  await page.getByRole("button", { name: "Play timeline" }).click();
  await expect(editor).toHaveCount(0);
  // Where a pause lands depends on the runner's speed, and a ruler click
  // while playing resumes playback once released. So let playback run to the
  // end of the clip and stop, then click the ruler to move the playhead back
  // onto the clip, which keeps the selection.
  const play = page.getByRole("button", { name: "Play timeline" });
  await expect(play).toBeVisible({ timeout: 15_000 });
  const clipBox = await clip.boundingBox();
  const ruler = await page.locator(".ruler-row__content").boundingBox();
  if (!clipBox || !ruler) {
    throw new Error("Text clip is not visible");
  }
  await page.mouse.click(
    clipBox.x + clipBox.width / 2,
    ruler.y + ruler.height / 2,
  );
  await expect(play).toBeVisible();
  await expect(editor).toHaveCount(0);
  await expectTransformHandles(page, true);
});
