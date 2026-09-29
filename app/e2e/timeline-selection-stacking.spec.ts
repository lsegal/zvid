import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// The timeline range selection renders before a lane's clips but paints over
// them, so a range on a layer that already has clips stays visible, while
// clicks still reach the clips underneath. A four-second test pattern at 120
// BPM spans eight quarters.
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

test("a range selection paints over the clips it overlaps", async ({
  page,
}) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await dropVideoIntoNewSourceTrack(page);

  await page.locator(".source-span").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy to layer" }).hover();
  await page.getByRole("menuitem", { name: "Layer 1" }).click();
  const clip = lane(page, "1").locator(".clip-card");
  await expect(clip).toHaveCount(1);
  // A lone clip always counts as selected, so add a second one to tell a
  // click on the first apart.
  await page.locator(".source-span").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy to layer" }).hover();
  await page.getByRole("menuitem", { name: "Layer 2" }).click();
  const other = lane(page, "5").locator(".clip-card");
  await expect(other).toHaveClass(/clip-card--selected/);
  await clip.evaluate((element) => element.scrollIntoView({ block: "center" }));

  // Drag from the empty lane after the clip back across it.
  const clipBox = await clip.boundingBox();
  const laneBox = await lane(page, "1").boundingBox();
  if (!clipBox || !laneBox) {
    throw new Error("clip or lane is not visible");
  }
  const y = laneBox.y + laneBox.height / 2;
  const fromX = clipBox.x + clipBox.width + 60;
  const toX = clipBox.x + clipBox.width / 3;
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  await page.mouse.move((fromX + toX) / 2, y);
  await page.mouse.move(toX, y);
  await page.mouse.up();

  const selection = lane(page, "1").locator(".timeline-selection");
  await expect(selection).toHaveCount(1);
  const selectionBox = await selection.boundingBox();
  if (!selectionBox) {
    throw new Error("selection is not visible");
  }
  expect(selectionBox.x).toBeLessThan(clipBox.x + clipBox.width);

  // The selection stacks above the clip card, which is isolated at auto.
  const [selectionZ, clipZ, playheadZ] = await Promise.all([
    selection.evaluate((element) => getComputedStyle(element).zIndex),
    clip.evaluate((element) => getComputedStyle(element).zIndex),
    page
      .locator(".timeline-playhead")
      .evaluate((element) => getComputedStyle(element).zIndex),
  ]);
  expect(clipZ).toBe("auto");
  expect(Number(selectionZ)).toBeGreaterThan(0);
  expect(Number(selectionZ)).toBeLessThan(Number(playheadZ));

  // The clip under the selection still takes the click.
  await page.mouse.click(
    (selectionBox.x + clipBox.x + clipBox.width) / 2,
    clipBox.y + clipBox.height / 2,
  );
  await expect(clip).toHaveClass(/clip-card--selected/);
  await expect(other).not.toHaveClass(/clip-card--selected/);
});
