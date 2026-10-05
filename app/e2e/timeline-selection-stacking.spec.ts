import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { addLayers } from "./layers.ts";

// The timeline range selection renders before a lane's clips but paints over
// them, so a range on a layer that already has clips stays visible. Clicks
// inside it keep it; the clips take clicks outside it. A four-second test
// pattern at 120 BPM spans eight quarters.
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

// The selected clip's neutral ring and stacking, read from computed style.
function ringOf(clip: Locator) {
  return clip.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
      zIndex: style.zIndex,
    };
  });
}

const RING = "solid 2px rgb(244, 246, 255)";

test("a range selection paints over the clips it overlaps", async ({
  page,
}) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await addLayers(page, 1);
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
  const other = lane(page, "2").locator(".clip-card");
  await expect(other).toHaveClass(/clip-card--selected/);
  const otherRing = await ringOf(other);
  expect(otherRing.outline).toBe(RING);
  expect((await ringOf(clip)).outline).toMatch(/^none /);
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

  // The selection stacks above the clip card, which is isolated at the loop
  // overlay's depth.
  const [selectionZ, clipZ, playheadZ] = await Promise.all([
    selection.evaluate((element) => getComputedStyle(element).zIndex),
    clip.evaluate((element) => getComputedStyle(element).zIndex),
    page
      .locator(".timeline-playhead")
      .evaluate((element) => getComputedStyle(element).zIndex),
  ]);
  expect(Number(clipZ)).toBeGreaterThan(0);
  expect(Number(clipZ)).toBeLessThan(Number(selectionZ));
  expect(Number(selectionZ)).toBeLessThan(Number(playheadZ));
  // The selected clip rises above its neighbors but stays under the range.
  expect(Number(otherRing.zIndex)).toBeGreaterThan(Number(clipZ));
  expect(Number(otherRing.zIndex)).toBeLessThan(Number(selectionZ));

  // A click inside the selection keeps it rather than reaching the clip
  // under it (#918).
  await page.mouse.click(
    (selectionBox.x + clipBox.x + clipBox.width) / 2,
    clipBox.y + clipBox.height / 2,
  );
  await expect(selection).toHaveCount(1);
  await expect(clip).not.toHaveClass(/clip-card--selected/);

  // The part of the clip outside it takes the click and clears it.
  await page.mouse.click(
    (clipBox.x + selectionBox.x) / 2,
    clipBox.y + clipBox.height / 2,
  );
  await expect(selection).toHaveCount(0);
  await expect(clip).toHaveClass(/clip-card--selected/);
  await expect(other).not.toHaveClass(/clip-card--selected/);
  expect((await ringOf(clip)).outline).toBe(RING);
  expect((await ringOf(other)).outline).toMatch(/^none /);
});
