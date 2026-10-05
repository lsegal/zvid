import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { addLayers } from "./layers.ts";

// Layer lanes leave 11px above and below their 44px clips (#917), and the
// track labels and the selection box stay aligned with them.

const LANE_HEIGHT = 66;
const CLIP_INSET = 11;
const CLIP_HEIGHT = 44;
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

async function box(page: Page, selector: string) {
  const bounds = await page.locator(selector).first().boundingBox();
  if (!bounds) {
    throw new Error(`${selector} is not visible`);
  }
  return bounds;
}

test.use({ viewport: { width: 1600, height: 1200 } });

test("layer lanes are compact, with clips, labels and selections aligned", async ({
  page,
}) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await addLayers(page, 1);
  await dropVideoIntoNewSourceTrack(page);
  await page.locator(".source-span").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy to layer" }).hover();
  await page.getByRole("menuitem", { name: "Layer 1" }).click();
  const clipLane = lane(page, "1");
  await expect(clipLane.locator(".clip-card")).toHaveCount(1);

  const laneBox = await clipLane.boundingBox();
  const clipBox = await clipLane.locator(".clip-card").first().boundingBox();
  const labelBox = await clipLane
    .locator("..")
    .locator(".track-label")
    .boundingBox();
  if (!laneBox || !clipBox || !labelBox) {
    throw new Error("Lane is not visible");
  }
  // The lane's bottom border sits inside its border box.
  expect(laneBox.height).toBe(LANE_HEIGHT);
  expect(clipBox.height).toBe(CLIP_HEIGHT);
  // Its layout offset, since a selected clip is lifted 1px by a transform.
  expect(
    await clipLane
      .locator(".clip-card")
      .evaluate((clip) => (clip as HTMLElement).offsetTop),
  ).toBe(CLIP_INSET);
  expect(labelBox.y).toBe(laneBox.y);
  expect(labelBox.height).toBe(laneBox.height);

  // A pending selection is drawn 2px outside the clip's top and bottom.
  const target = lane(page, "2");
  const bounds = await target.boundingBox();
  if (!bounds) {
    throw new Error("Lane is not visible");
  }
  const y = bounds.y + 20;
  await page.mouse.move(bounds.x + 120, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 260, y, { steps: 4 });
  await page.mouse.up();
  const selection = await box(page, ".timeline-selection");
  expect(selection.y - bounds.y).toBe(CLIP_INSET - 2);
  expect(selection.height).toBe(CLIP_HEIGHT + 4);
});
