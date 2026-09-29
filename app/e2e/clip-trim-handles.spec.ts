import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Arrangement clip trim handles stay hidden until the clip is hovered,
// focused or trimmed, but keep their hit area. Selection alone shows only the
// outline, and only a clip the user selected looks or acts selected. A four-second test pattern at
// 120 BPM spans eight quarters.
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

async function expectOpacity(locator: Locator, opacity: string) {
  await expect
    .poll(() =>
      locator.evaluate((element) => getComputedStyle(element).opacity),
    )
    .toBe(opacity);
}

async function center(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("element is not visible");
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

async function copySpanToLayer(page: Page, layer: string) {
  await page.locator(".source-span").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy to layer" }).hover();
  await page.getByRole("menuitem", { name: layer }).click();
}

test("trim handles appear on hover and trim, and grab while hidden", async ({
  page,
}) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await dropVideoIntoNewSourceTrack(page);

  await copySpanToLayer(page, "Layer 1");
  const clip = lane(page, "1").locator(".clip-card");
  await expect(clip).toHaveCount(1);
  const start = clip.locator(".clip-card__handle--start");
  const end = clip.locator(".clip-card__handle--end");
  const body = clip.locator(".clip-card__body");

  // Select a second clip to leave this one idle.
  await copySpanToLayer(page, "Layer 2");
  const other = lane(page, "5").locator(".clip-card");
  await other.locator(".clip-card__body").click();
  await expect(other).toHaveClass(/clip-card--selected/);
  // Keep the clip clear of the sticky ruler.
  await clip.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await page.mouse.move(5, 5);
  await expect(clip).not.toHaveClass(/clip-card--selected/);
  await expectOpacity(start, "0");
  await expectOpacity(end, "0");

  // The body runs edge to edge under the handles.
  const clipBox = await clip.boundingBox();
  const bodyBox = await body.boundingBox();
  expect(bodyBox?.width).toBeGreaterThan((clipBox?.width ?? 0) - 4);

  // Hidden handles keep their hit area on the clip's edges.
  const endCenter = await center(end);
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.className,
      endCenter,
    ),
  ).toBe("clip-card__handle clip-card__handle--end");

  await clip.hover();
  await expectOpacity(start, "1");
  await expectOpacity(end, "1");
  await page.mouse.move(5, 5);
  await expectOpacity(end, "0");

  // Trimming keeps them shown even with the pointer off the clip.
  const widthBefore = clipBox?.width ?? 0;
  await page.mouse.move(endCenter.x, endCenter.y);
  await page.mouse.down();
  await page.mouse.move(endCenter.x - 60, endCenter.y + 200, { steps: 6 });
  await expect(clip).toHaveClass(/clip-card--trimming/);
  await expectOpacity(end, "1");
  await page.mouse.up();
  await expect(clip).not.toHaveClass(/clip-card--trimming/);
  await expect
    .poll(async () => (await clip.boundingBox())?.width ?? 0)
    .toBeLessThan(widthBefore - 20);

  // The trimmed clip is selected, but selection alone keeps them hidden.
  await expect(clip).toHaveClass(/clip-card--selected/);
  await page.mouse.move(5, 5);
  await expectOpacity(start, "0");
  await expectOpacity(end, "0");
});

test("no clip looks or acts selected unless the user selected it", async ({
  page,
}) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await dropVideoIntoNewSourceTrack(page);
  await copySpanToLayer(page, "Layer 1");
  await copySpanToLayer(page, "Layer 2");
  const clips = page.locator(".clip-card");
  await expect(clips).toHaveCount(2);
  const clip = lane(page, "1").locator(".clip-card");
  const other = lane(page, "5").locator(".clip-card");

  // Esc clears the selection, leaving no clip highlighted.
  await clip.locator(".clip-card__body").click();
  await expect(clip).toHaveClass(/clip-card--selected/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".clip-card--selected")).toHaveCount(0);

  // With nothing selected, edit keys touch no clip.
  await page.keyboard.press("Delete");
  await page.keyboard.press("ControlOrMeta+x");
  await page.keyboard.press("ControlOrMeta+e");
  await page.keyboard.press("ControlOrMeta+d");
  await expect(clips).toHaveCount(2);
  await expect(page.locator(".clip-card--selected")).toHaveCount(0);

  // Starting a range on another layer clears the selection too.
  await other.locator(".clip-card__body").click();
  await expect(other).toHaveClass(/clip-card--selected/);
  const laneBox = await lane(page, "1").boundingBox();
  const clipBox = await clip.boundingBox();
  if (!laneBox || !clipBox) {
    throw new Error("lane is not visible");
  }
  const y = laneBox.y + laneBox.height / 2;
  const x = clipBox.x + clipBox.width + 40;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator(".clip-card--selected")).toHaveCount(0);
  await page.mouse.move(5, 5);
  for (const card of [clip, other]) {
    await expectOpacity(card.locator(".clip-card__handle--start"), "0");
  }
  await page.keyboard.press("Escape");
  await page.keyboard.press("Delete");
  await expect(clips).toHaveCount(2);
});

test("trim handles appear without a fade when motion is reduced", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await dropVideoIntoNewSourceTrack(page);
  await copySpanToLayer(page, "Layer 1");

  const handle = lane(page, "1").locator(".clip-card__handle--start");
  expect(
    await handle.evaluate(
      (element) => getComputedStyle(element).transitionDuration,
    ),
  ).toBe("0s");
});
