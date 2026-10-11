// Whole app: File › Import Media reads the SVG and hands it to Shape ▸ Custom through the project's media.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

// Shape ▸ Custom (#1008): an SVG imported as media masks a layer to its
// opaque area. The picker, the masking and the rendering are covered in
// src/fx/effects/shape/shape-custom.component.test.tsx.

// Opaque in its left half only, in red: the mask is the alpha, not the
// color. Its square viewBox is stretched over whatever box it masks.
const LEFT_HALF_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
  '<rect x="0" y="0" width="5" height="10" fill="#f00"/></svg>';

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

// Inserts a fill clip on layer `laneId`, selected, and moves the playhead
// to its middle, where it is fully drawn.
async function insertFillAtStart(page: Page, laneId: string) {
  const bounds = await lane(page, laneId).boundingBox();
  if (!bounds) {
    throw new Error("Lane is not visible");
  }
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + 40, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 150, y);
  await page.mouse.move(bounds.x + 260, y);
  await page.mouse.up();
  await page.mouse.click(bounds.x + 150, y, { button: "right" });
  await page
    .getByRole("menu", { name: "Selection actions" })
    .getByRole("menuitem", { name: "Insert Fill Clip" })
    .click();
  const fill = lane(page, laneId).locator(".clip-card--fill");
  await expect(fill).toHaveClass(/clip-card--selected/);
  const clip = await fill.boundingBox();
  const ruler = await page.locator(".ruler-row").boundingBox();
  if (!clip || !ruler) {
    throw new Error("The clip or ruler is not visible");
  }
  await page.mouse.click(clip.x + clip.width / 2, ruler.y + ruler.height / 2);
  await expect(fill).toHaveClass(/clip-card--selected/);
}

async function addShape(page: Page) {
  await page.locator('[data-layer-header-id="1"]').click();
  await page.getByRole("button", { name: "Add device to this layer" }).click();
  await page
    .getByRole("menu")
    .getByRole("group", { name: "Video" })
    .getByRole("menuitem", { name: "Transform", exact: true })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Shape/ }).click();
}

test("an SVG imported from File › Import Media is offered by Shape ▸ Custom", async ({
  page,
}) => {
  const folder = mkdtempSync(join(tmpdir(), "zvid-shape-custom-"));
  try {
    const svgPath = join(folder, "half.svg");
    writeFileSync(svgPath, LEFT_HALF_SVG);

    await page.goto("/");
    await insertFillAtStart(page, "1");
    await addShape(page);
    const shape = page.locator('.fx-chain section[aria-label="Shape"]');
    await expect(shape).toHaveCount(1);
    const trigger = shape.getByRole("button", { name: /^Shape: / });

    // Importing only an SVG adds it to the media and keeps the timeline.
    await page.getByRole("menuitem", { name: "File", exact: true }).click();
    const choosing = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "Import Media" }).click();
    await (await choosing).setFiles(svgPath);
    await expect(page.getByText("Imported 1 media file.")).toBeVisible();
    await expect(lane(page, "1").locator(".clip-card--fill")).toHaveCount(1);
    await expect(page.locator(".track-label--source")).toHaveCount(0);

    await trigger.click();
    await page
      .locator(".fx-shape__grid")
      .getByRole("option")
      .filter({ hasText: "Custom" })
      .click();
    await page
      .getByRole("listbox", { name: "SVG media" })
      .getByRole("option", { name: "half.svg" })
      .click();
    await expect(trigger).toHaveAccessibleName("Shape: Custom");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
