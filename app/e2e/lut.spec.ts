// Whole app: File › Import Media, and reopening from Sessions brings the LUT's file back from the media cache.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

// The LUT effect (#1135): a .cube file imported as media grades a layer
// through a 3D lookup table. The picker, the import's checks and the
// rendering are covered in src/fx/effects/lut/lut.component.test.tsx.

type Rgba = [number, number, number, number];

// Every color to pure red, so the default gray fill visibly changes.
const RED_CUBE = ["LUT_3D_SIZE 2", ...Array(8).fill("1 0 0"), ""].join("\n");

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
  await seekToFill(page, laneId);
  await expect(fill).toHaveClass(/clip-card--selected/);
}

// Moves the playhead to the middle of the fill clip on layer `laneId`.
async function seekToFill(page: Page, laneId: string) {
  const clip = await lane(page, laneId)
    .locator(".clip-card--fill")
    .boundingBox();
  const ruler = await page.locator(".ruler-row").boundingBox();
  if (!clip || !ruler) {
    throw new Error("The clip or ruler is not visible");
  }
  await page.mouse.click(clip.x + clip.width / 2, ruler.y + ruler.height / 2);
}

async function addLut(page: Page) {
  await page.locator('[data-layer-header-id="1"]').click();
  await page.getByRole("button", { name: "Add device to this layer" }).click();
  await page
    .getByRole("menu")
    .getByRole("group", { name: "Video" })
    .getByRole("menuitem", { name: "Color", exact: true })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^LUT/ }).click();
}

async function importMedia(page: Page, path: string) {
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  const choosing = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Import Media" }).click();
  await (await choosing).setFiles(path);
}

// The preview's color left of center, clear of the Transform overlay's
// handles, read from a screenshot so the WebGL canvas needn't keep its
// drawing buffer.
async function previewColor(page: Page) {
  const png = await page
    .locator(".composition-player__canvas")
    .screenshot({ animations: "disabled" });
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No 2D context");
    context.drawImage(image, 0, 0);
    return Array.from(
      context.getImageData(
        Math.floor(image.width * 0.3),
        Math.floor(image.height / 2),
        1,
        1,
      ).data,
    );
  }, png.toString("base64")) as Promise<Rgba>;
}

const isRed = ([red, green, blue]: Rgba) =>
  red > 240 && green < 15 && blue < 15;

test("an imported .cube grades the layer through LUT and survives a save and reopen", async ({
  page,
}) => {
  const folder = mkdtempSync(join(tmpdir(), "zvid-lut-"));
  try {
    const cubePath = join(folder, "red.cube");
    writeFileSync(cubePath, RED_CUBE);
    const badPath = join(folder, "broken.cube");
    writeFileSync(badPath, "LUT_3D_SIZE 2\n0 0 0\n");

    await page.goto("/");
    await insertFillAtStart(page, "1");
    await addLut(page);
    const device = page.locator('.fx-chain section[aria-label="LUT"]');
    await expect(device).toHaveCount(1);
    const trigger = device.getByRole("button", { name: /^LUT: / });

    // A malformed file is turned away with the reason.
    await importMedia(page, badPath);
    await expect(
      page.getByText(
        /Skipped broken\.cube \(Not a valid \.cube LUT: .*8 points/,
      ),
    ).toBeVisible();

    // Importing only a LUT adds it to the media and keeps the timeline.
    await importMedia(page, cubePath);
    await expect(page.getByText("Imported 1 media file.")).toBeVisible();
    await expect(lane(page, "1").locator(".clip-card--fill")).toHaveCount(1);
    await expect(page.locator(".track-label--source")).toHaveCount(0);

    await trigger.click();
    await page.getByRole("menuitemcheckbox", { name: "red.cube" }).click();
    await expect(trigger).toHaveAccessibleName("LUT: red.cube");

    await page.mouse.move(0, 0);
    await expect.poll(async () => isRed(await previewColor(page))).toBe(true);

    // Saved, closed and reopened from Sessions, it still has the LUT picked
    // and grading from its media.
    await page.keyboard.press("ControlOrMeta+s");
    await expect(
      page.getByText("Saved Untitled Session to Sessions."),
    ).toBeVisible();
    await page.getByRole("menuitem", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: "New Session" }).click();
    await expect(page.locator(".clip-card--fill")).toHaveCount(0);
    await page.getByRole("button", { name: "Sessions", exact: true }).click();
    await page
      .getByRole("complementary", { name: "Sessions" })
      .getByRole("list", { name: "Sessions" })
      .getByRole("button")
      .filter({ hasText: "Untitled Session" })
      .click();
    await expect(page.getByText("Opened Untitled Session.")).toBeVisible();
    await seekToFill(page, "1");
    await page.locator('[data-layer-header-id="1"]').click();
    await expect(
      page
        .locator('.fx-chain section[aria-label="LUT"]')
        .getByRole("button", { name: /^LUT: / }),
    ).toHaveAccessibleName("LUT: red.cube");
    await page.mouse.move(0, 0);
    await expect.poll(async () => isRed(await previewColor(page))).toBe(true);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
