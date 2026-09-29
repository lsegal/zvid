import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Arrangement clip trim handles stay hidden until the clip is hovered,
// selected or trimmed, but keep their hit area. A four-second test pattern at
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

test("trim handles appear on hover, selection and trim, and grab while hidden", async ({
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
  const start = clip.locator(".clip-card__handle--start");
  const end = clip.locator(".clip-card__handle--end");
  const body = clip.locator(".clip-card__body");

  // A lone clip always counts as selected, so select a second one to leave
  // this one idle.
  await page.locator(".source-span").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy to layer" }).hover();
  await page.getByRole("menuitem", { name: "Layer 2" }).click();
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

  // The trimmed clip is selected, so the handles stay visible.
  await expect(clip).toHaveClass(/clip-card--selected/);
  await expectOpacity(start, "1");
});

test("trim handles appear without a fade when motion is reduced", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await dropVideoIntoNewSourceTrack(page);
  await page.locator(".source-span").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy to layer" }).hover();
  await page.getByRole("menuitem", { name: "Layer 1" }).click();

  const handle = lane(page, "1").locator(".clip-card__handle--start");
  expect(
    await handle.evaluate(
      (element) => getComputedStyle(element).transitionDuration,
    ),
  ).toBe("0s");
});
