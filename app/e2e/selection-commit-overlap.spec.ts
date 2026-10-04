import { expect, type Locator, type Page, test } from "@playwright/test";

// Committing a selection over clips on a layer carves out its range, as
// pasting or moving a clip there does: a clip it partly covers is trimmed and
// a clip it covers is removed (#916).

test.use({ viewport: { width: 1600, height: 1200 } });
test.describe.configure({ timeout: 90_000 });

// A 440 Hz tone as a 16-bit mono WAV.
function toneWav(seconds: number) {
  const sampleRate = 8000;
  const frames = Math.round(seconds * sampleRate);
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(frames * 2, 40);
  for (let index = 0; index < frames; index++) {
    const sample = Math.sin((2 * Math.PI * 440 * index) / sampleRate);
    wav.writeInt16LE(Math.round(sample * 10_000), 44 + index * 2);
  }
  return wav.toString("base64");
}

// Drops an eight-second tone into a new source track.
async function dropTone(page: Page) {
  const base64 = toneWav(8);
  const dataTransfer = await page.evaluateHandle((base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "tone.wav", { type: "audio/wav" }));
    return transfer;
  }, base64);
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent('[aria-label="Source track drop area"]', type, {
      dataTransfer,
    });
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
}

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

// The [left, right] edges of each element, in page pixels, left to right.
function edges(locator: Locator) {
  return locator.evaluateAll((elements) =>
    elements
      .map((element) => element.getBoundingClientRect())
      .map((rect) => [rect.left, rect.right])
      .toSorted((a, b) => a[0] - b[0]),
  );
}

// Drags a selection on `layer` from `fromX` to `toX` and commits it to
// source track 1. Returns the selection's [left, right] edges.
async function commitSelection(layer: Locator, fromX: number, toX: number) {
  const page = layer.page();
  const bounds = await layer.boundingBox();
  if (!bounds) {
    throw new Error("The layer is not visible");
  }
  const y = bounds.y + 20;
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  await page.mouse.move(toX, y, { steps: 6 });
  await page.mouse.up();
  const selection = layer.locator(".timeline-selection");
  await expect(selection).toBeVisible();
  const [selected] = await edges(selection);
  await page.keyboard.press("1");
  await expect(selection).toHaveCount(0);
  return selected;
}

test("committing a selection trims or removes the clips it covers", async ({
  page,
}) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await dropTone(page);

  // Layer 1 centered vertically, at the song start, so it lines up with the
  // source clip below it.
  const layer = lane(page, "1");
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
  const [[spanLeft, spanRight]] = await edges(page.locator(".source-span"));
  const at = (fraction: number) => spanLeft + (spanRight - spanLeft) * fraction;
  const clips = layer.locator(".clip-card");

  const first = await commitSelection(layer, at(0.1), at(0.6));
  await expect(clips).toHaveCount(1);

  // Dragged right to left from empty space, over the first clip's end: the
  // first clip keeps the part before the new one.
  const second = await commitSelection(layer, at(0.9), at(0.4));
  expect(second[0]).toBeLessThan(first[1] - 10);
  await expect(clips).toHaveCount(2);
  const trimmed = await edges(clips);
  expect(Math.abs(trimmed[0][0] - first[0])).toBeLessThan(2);
  expect(Math.abs(trimmed[0][1] - second[0])).toBeLessThan(2);
  expect(Math.abs(trimmed[1][0] - second[0])).toBeLessThan(2);
  expect(Math.abs(trimmed[1][1] - second[1])).toBeLessThan(2);

  // A selection over both removes them.
  const third = await commitSelection(layer, at(0.98), at(0.02));
  await expect(clips).toHaveCount(1);
  const [only] = await edges(clips);
  expect(Math.abs(only[0] - third[0])).toBeLessThan(2);
  expect(Math.abs(only[1] - third[1])).toBeLessThan(2);
});
