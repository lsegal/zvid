import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Editing a source clip under a layer clip changes the layer clip's
// filmstrip and the preview frame straight away, with nothing else to
// refresh them: moving it shifts the frames the layer clip shows, trimming
// it leaves a gap the layer clip shows nothing over, and deleting it leaves
// the layer clip showing nothing at all. Undo and redo follow too (#936).
// A four-second test pattern at 120 BPM spans eight quarters.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

test.use({ viewport: { width: 1600, height: 1200 } });
test.describe.configure({ timeout: 120_000 });

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

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) {
    throw new Error("element is not visible");
  }
  return bounds;
}

// Where each piece of the layer clip's filmstrip sits in the clip, in
// quarters.
function pieces(clip: Locator, quarterPx: number) {
  return clip.evaluate((element, quarter) => {
    return Array.from(
      element.querySelectorAll<HTMLElement>(".clip-card__piece"),
    ).map((piece) => [
      Math.round(piece.offsetLeft / quarter),
      Math.round(piece.offsetWidth / quarter),
    ]);
  }, quarterPx);
}

// The thumbnails the layer clip's filmstrip tiles show, each downsampled to
// an 8×8 grid of RGB values.
function tiles(clip: Locator) {
  return clip.evaluate(async (element) => {
    const urls = Array.from(
      element.querySelectorAll<HTMLElement>(".clip-card__tile"),
    ).map((tile) => /url\("?(.*?)"?\)/.exec(tile.style.backgroundImage)?.[1]);
    return Promise.all(
      urls.map(async (url) => {
        if (!url) return [];
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 8;
        canvas.height = 8;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("no 2D context");
        context.drawImage(image, 0, 0, 8, 8);
        return Array.from(context.getImageData(0, 0, 8, 8).data).filter(
          (_, index) => index % 4 !== 3,
        );
      }),
    );
  });
}

type Tiles = Awaited<ReturnType<typeof tiles>>;

// Whether two filmstrips show the same thumbnails.
function sameTiles(a: Tiles, b: Tiles) {
  return (
    a.length === b.length &&
    a.every(
      (tile, index) =>
        tile.length > 0 &&
        tile.length === b[index].length &&
        difference(tile, b[index]) < 3,
    )
  );
}

// Waits until every tile of a filmstrip of at least two tiles shows its own
// thumbnail, rather than the clip's first frame they all show until theirs
// loads, and returns them.
async function loadedTiles(clip: Locator) {
  let current: Tiles = [];
  await expect
    .poll(
      async () => {
        current = await tiles(clip);
        return (
          current.length > 1 &&
          current.every(
            (tile, index) =>
              tile.length > 0 &&
              (index === 0 || difference(tile, current[index - 1]) > 3),
          )
        );
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  return current;
}

async function expectTiles(clip: Locator, expected: Tiles) {
  await expect
    .poll(async () => sameTiles(await tiles(clip), expected), {
      timeout: 15_000,
    })
    .toBe(true);
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

test("a layer clip's filmstrip and preview follow edits to its source clip", async ({
  page,
}) => {
  await page.goto("/");
  const layer = page.locator('[data-timeline-lane-id="1"]');
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
  await expect.poll(() => pieces(clip, quarterPx)).toEqual([[0, 4]]);
  const originalTiles = await loadedTiles(clip);

  // The playhead at quarter 3, a quarter into the clip.
  const ruler = await box(page.locator(".ruler-row"));
  await page.mouse.click(spanBox.x + 3 * quarterPx, ruler.y + ruler.height / 2);
  await expect(page.locator(".preview-placeholder")).toHaveCount(0, {
    timeout: 30_000,
  });
  const originalFrame = await settledPreview(page);

  // Moving the source clip two quarters later shows its media a second
  // earlier through the whole layer clip.
  await dragBy(page, span.locator(".source-span__body"), 2 * quarterPx);
  await expect
    .poll(async () => (await box(span)).x - spanBox.x)
    .toBeCloseTo(2 * quarterPx, 0);
  await expect.poll(() => pieces(clip, quarterPx)).toEqual([[0, 4]]);
  await expect
    .poll(async () => sameTiles(await loadedTiles(clip), originalTiles), {
      timeout: 15_000,
    })
    .toBe(false);
  await expectPreviewChange(page, originalFrame);
  const movedTiles = await loadedTiles(clip);
  const movedFrame = await settledPreview(page);

  // Undo puts back the filmstrip and frame; redo the moved ones.
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => (await box(span)).x - spanBox.x)
    .toBeCloseTo(0, 0);
  await expectTiles(clip, originalTiles);
  await expectPreview(page, originalFrame);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect
    .poll(async () => (await box(span)).x - spanBox.x)
    .toBeCloseTo(2 * quarterPx, 0);
  await expectTiles(clip, movedTiles);
  await expectPreview(page, movedFrame);
  await page.keyboard.press("ControlOrMeta+z");
  await expectTiles(clip, originalTiles);
  await expectPreview(page, originalFrame);

  // Trimming the source clip's start to quarter 4 leaves the layer clip's
  // first half, and the playhead, over nothing.
  await dragBy(
    page,
    span.locator(".source-span__handle--start"),
    4 * quarterPx,
  );
  await expect
    .poll(async () => (await box(span)).x - spanBox.x)
    .toBeCloseTo(4 * quarterPx, 0);
  await expect.poll(() => pieces(clip, quarterPx)).toEqual([[2, 2]]);
  await expectPreviewChange(page, originalFrame);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => pieces(clip, quarterPx)).toEqual([[0, 4]]);
  await expectTiles(clip, originalTiles);
  await expectPreview(page, originalFrame);

  // Trimming its end to quarter 4 leaves the layer clip's second half over
  // nothing; the playhead still shows the same frame.
  await dragBy(page, span.locator(".source-span__handle--end"), -4 * quarterPx);
  await expect
    .poll(async () => (await box(span)).width)
    .toBeCloseTo(4 * quarterPx, 0);
  await expect.poll(() => pieces(clip, quarterPx)).toEqual([[0, 2]]);
  await expectPreview(page, originalFrame);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => pieces(clip, quarterPx)).toEqual([[0, 4]]);
  await expectTiles(clip, originalTiles);

  // Deleting the source clip leaves the layer clip in place, showing
  // nothing; undo brings back what it showed.
  await span.locator(".source-span__body").click();
  await page.keyboard.press("Delete");
  await expect(span).toHaveCount(0);
  await expect(clip).toHaveCount(1);
  await expect(clip.locator(".clip-card__piece")).toHaveCount(0);
  await expectPreviewChange(page, originalFrame);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(span).toHaveCount(1);
  await expect.poll(() => pieces(clip, quarterPx)).toEqual([[0, 4]]);
  await expectTiles(clip, originalTiles);
  await expectPreview(page, originalFrame);
});
