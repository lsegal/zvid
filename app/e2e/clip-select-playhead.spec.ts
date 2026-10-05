import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { addLayers } from "./layers.ts";

// Selecting a clip only selects it; the playhead stays where it was. A
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
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
}

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

// The playhead's position within the lane, independent of scroll.
function playheadX(page: Page) {
  return page.evaluate(() => {
    const marker = document.querySelector(
      ".timeline-playhead-marker",
    ) as HTMLElement;
    const content = document.querySelector(
      '[data-timeline-lane-id="1"]',
    ) as HTMLElement;
    return (
      marker.getBoundingClientRect().left - content.getBoundingClientRect().left
    );
  });
}

// The docked Audio row footer (#809) leaves less room for layers to scroll
// in; the default session's layers no longer all fit without scrolling.
test.use({ viewport: { width: 1600, height: 1200 } });

test("selecting a clip leaves the playhead where it was", async ({ page }) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await addLayers(page, 1);
  await dropVideoIntoNewSourceTrack(page);
  await page.locator(".source-span").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy to layer" }).hover();
  await page.getByRole("menuitem", { name: "Layer 1" }).click();
  const clip = lane(page, "1").locator(".clip-card");
  await expect(clip).toHaveCount(1);
  // Keep the lanes clear of the sticky ruler.
  await clip.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const clipBox = await clip.boundingBox();
  const emptyLane = await lane(page, "2").boundingBox();
  if (!clipBox || !emptyLane) {
    throw new Error("clip is not visible");
  }

  // Park the playhead mid-clip from an empty lane, with nothing selected.
  await page.mouse.click(clipBox.x + clipBox.width / 2, emptyLane.y + 20);
  await page.keyboard.press("Escape");
  await expect(clip).not.toHaveClass(/clip-card--selected/);
  const parked = await playheadX(page);
  expect(parked).toBeGreaterThan(clipBox.width / 4);

  // Stopped: clicking the clip selects it without seeking.
  await clip.locator(".clip-card__body").click();
  await expect(clip).toHaveClass(/clip-card--selected/);
  expect(await playheadX(page)).toBeCloseTo(parked, 0);

  // Clicking the source track's label selects the track without seeking.
  await page.locator(".track-label--source").click();
  await expect(
    page.locator(".track-label--source .track-label__select"),
  ).toHaveAttribute("aria-current", "true");
  await expect(clip).not.toHaveClass(/clip-card--selected/);
  expect(await playheadX(page)).toBeCloseTo(parked, 0);

  // And so does clicking a source clip.
  await page.locator(".source-span").click();
  await expect(page.locator(".source-span")).toHaveClass(
    /source-span--selected/,
  );
  expect(await playheadX(page)).toBeCloseTo(parked, 0);
});
