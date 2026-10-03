import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// A layer clip made from a source track selection shows what that track
// holds in its range now: moving the source clip away leaves it showing
// nothing, rather than the frames it was made with, and deleting the source
// clip removes it, with undo (#869). A four-second test pattern at 120 BPM
// spans eight quarters.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

test.use({ viewport: { width: 1600, height: 1200 } });
test.describe.configure({ timeout: 90_000 });

async function addSourceVideo(page: Page) {
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

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) {
    throw new Error("element is not visible");
  }
  return bounds;
}

// The preview's pixels, downsampled to a 16×16 grid of RGB values.
async function previewPixels(page: Page) {
  const shot = await page
    .locator(".preview-monitor canvas")
    .first()
    .screenshot();
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2D context");
    context.drawImage(image, 0, 0, 16, 16);
    return Array.from(context.getImageData(0, 0, 16, 16).data).filter(
      (_, index) => index % 4 !== 3,
    );
  }, shot.toString("base64"));
}

// The mean per-channel difference between two samples, 0-255.
function difference(a: number[], b: number[]) {
  let sum = 0;
  for (const [index, value] of a.entries()) {
    sum += Math.abs(value - b[index]);
  }
  return sum / a.length;
}

// Waits for the preview to settle on a frame no more than 2 apart from the
// last two samples, and returns it.
async function settledPreview(page: Page) {
  let previous = await previewPixels(page);
  let current = previous;
  await expect
    .poll(
      async () => {
        previous = current;
        current = await previewPixels(page);
        return difference(previous, current);
      },
      { timeout: 15_000 },
    )
    .toBeLessThan(2);
  return current;
}

async function expectPreview(page: Page, expected: number[]) {
  await expect
    .poll(async () => difference(expected, await previewPixels(page)), {
      timeout: 15_000,
    })
    .toBeLessThan(4);
}

async function expectPreviewChange(page: Page, before: number[]) {
  await expect
    .poll(async () => difference(before, await previewPixels(page)), {
      timeout: 15_000,
    })
    .toBeGreaterThan(6);
}

// Drags `handle` horizontally by `deltaPx` with Shift held, so it moves by
// exact quarters.
async function dragBy(page: Page, handle: Locator, deltaPx: number) {
  const bounds = await box(handle);
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.keyboard.down("Shift");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaPx, y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
}

test("a layer clip follows its source clip being moved and is removed with it", async ({
  page,
}) => {
  await page.goto("/");
  const layer = lane(page, "1");
  await expect(layer).toBeVisible();
  await addSourceVideo(page);
  await layer.evaluate(
    (element) =>
      new Promise((resolve) => {
        element.scrollIntoView({ block: "center" });
        const scroller = element.closest(".timeline-scroll");
        if (scroller) {
          scroller.scrollLeft = 0;
        }
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );

  // A layer clip over quarters 2 to 6 of the source clip, media seconds 1
  // to 3.
  const span = page.locator(".source-span");
  const spanBox = await box(span);
  const quarterPx = spanBox.width / 8;
  const layerBox = await box(layer);
  const y = layerBox.y + 20;
  await page.mouse.move(spanBox.x + 2 * quarterPx, y);
  await page.mouse.down();
  await page.mouse.move(spanBox.x + 6 * quarterPx, y, { steps: 6 });
  await page.mouse.up();
  await expect(layer.locator(".timeline-selection")).toBeVisible();
  await page.keyboard.press("1");
  const clip = layer.locator(".clip-card");
  await expect(clip).toHaveCount(1);

  // The playhead in the middle of the clip, showing the source's second 2.
  const clipBox = await box(clip);
  const ruler = await box(page.locator(".ruler-row"));
  await page.mouse.click(
    clipBox.x + clipBox.width / 2,
    ruler.y + ruler.height / 2,
  );
  await expect(page.locator(".preview-placeholder")).toHaveCount(0, {
    timeout: 30_000,
  });
  const before = await settledPreview(page);

  // Moving the source clip six quarters later leaves nothing on its track
  // under the layer clip, which now shows nothing either.
  await dragBy(page, span.locator(".source-span__body"), 6 * quarterPx);
  await expect
    .poll(async () => (await box(span)).x - spanBox.x)
    .toBeCloseTo(6 * quarterPx, 0);
  await expect(clip).toHaveCount(1);
  await expectPreviewChange(page, before);

  // Undo puts the source clip and what the layer clip shows back.
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => (await box(span)).x - spanBox.x)
    .toBeCloseTo(0, 0);
  await expectPreview(page, before);

  // Deleting the source clip removes the layer clip made from it; undo
  // brings both back.
  await span.locator(".source-span__body").click();
  await page.keyboard.press("Delete");
  await expect(span).toHaveCount(0);
  await expect(clip).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(span).toHaveCount(1);
  await expect(clip).toHaveCount(1);
});
