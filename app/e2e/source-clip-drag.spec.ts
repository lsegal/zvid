import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Source clips move by dragging their body and trim by dragging an edge, and
// overwrite the clips they land on in their own source track the way clips
// do on a layer. A four-second test pattern at 120 BPM spans eight quarters.
// Shift is held while dragging so the drags skip snapping and move by exact
// quarters at any zoom.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

async function videoTransfer(page: Page, count: number) {
  const base64 = (await readFile(VIDEO)).toString("base64");
  return page.evaluateHandle(
    ({ data, count }) => {
      const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      for (let index = 0; index < count; index += 1) {
        transfer.items.add(
          new File([bytes], `test-pattern-${index}.mp4`, { type: "video/mp4" }),
        );
      }
      return transfer;
    },
    { data: base64, count },
  );
}

async function dropVideos(page: Page, target: string, count: number) {
  const dataTransfer = await videoTransfer(page, count);
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(target, type, { dataTransfer });
  }
}

const header = '[aria-label="Source track drop area"]';
const tracks = '[data-source-track-drop-target="track"]';

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) {
    throw new Error("element is not visible");
  }
  return bounds;
}

// Where a span sits in its track, in quarters.
async function layout(span: Locator, quarterPx: number) {
  return span.evaluate((element, px) => {
    const style = (element as HTMLElement).style;
    return {
      startQ: Math.round((Number.parseFloat(style.left) / px) * 100) / 100,
      durationQ: Math.round((Number.parseFloat(style.width) / px) * 100) / 100,
    };
  }, quarterPx);
}

// Drags `handle` horizontally by `deltaPx` with Shift held.
async function dragBy(page: Page, handle: Locator, deltaPx: number) {
  await handle.scrollIntoViewIfNeeded();
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

// Opens the app with one source track holding `count` back-to-back clips and
// returns the timeline's quarter width.
async function openWithSpans(page: Page, count: number) {
  await page.goto("/");
  await dropVideos(page, header, count);
  await expect(page.locator(tracks)).toHaveCount(1);
  const spans = page.locator(`${tracks} .source-span`);
  await expect(spans).toHaveCount(count, { timeout: 30_000 });
  return (await box(spans.first())).width / 8;
}

test("source clips move and trim from either edge, looping their media, with undo", async ({
  page,
}) => {
  const quarterPx = await openWithSpans(page, 1);
  const span = page.locator(".source-span");
  await expect
    .poll(() => layout(span, quarterPx))
    .toEqual({
      startQ: 0,
      durationQ: 8,
    });

  // A press released without moving changes nothing.
  await span.click();
  expect(await layout(span, quarterPx)).toEqual({ startQ: 0, durationQ: 8 });

  // Move it 4 quarters later, then undo the one step.
  await dragBy(page, span.locator(".source-span__body"), 4 * quarterPx);
  await expect
    .poll(() => layout(span, quarterPx))
    .toEqual({
      startQ: 4,
      durationQ: 8,
    });
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(() => layout(span, quarterPx))
    .toEqual({
      startQ: 0,
      durationQ: 8,
    });
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect
    .poll(() => layout(span, quarterPx))
    .toEqual({
      startQ: 4,
      durationQ: 8,
    });

  // Trim 2 quarters off the end, then 2 off the start.
  await span.hover();
  await dragBy(page, span.locator(".source-span__handle--end"), -2 * quarterPx);
  await expect
    .poll(() => layout(span, quarterPx))
    .toEqual({
      startQ: 4,
      durationQ: 6,
    });
  await span.hover();
  await dragBy(
    page,
    span.locator(".source-span__handle--start"),
    2 * quarterPx,
  );
  await expect
    .poll(() => layout(span, quarterPx))
    .toEqual({
      startQ: 6,
      durationQ: 4,
    });

  // The start stops at the media's first frame, but the end runs on past
  // its last, looping the media, with a marker where it loops.
  await span.hover();
  await dragBy(
    page,
    span.locator(".source-span__handle--start"),
    -5 * quarterPx,
  );
  await expect
    .poll(() => layout(span, quarterPx))
    .toEqual({
      startQ: 4,
      durationQ: 6,
    });
  await span.hover();
  await expect(span.locator(".media-loop-markers__marker")).toHaveCount(0);
  await dragBy(page, span.locator(".source-span__handle--end"), 6 * quarterPx);
  await expect
    .poll(() => layout(span, quarterPx))
    .toEqual({
      startQ: 4,
      durationQ: 12,
    });
  const marker = span.locator(".media-loop-markers__marker");
  await expect(marker).toHaveCount(1);
  expect(
    Number.parseFloat(await marker.evaluate((element) => element.style.left)) /
      quarterPx,
  ).toBeCloseTo(8, 1);

  // Moving never goes before the start of the timeline.
  await dragBy(page, span.locator(".source-span__body"), -10 * quarterPx);
  await expect
    .poll(() => layout(span, quarterPx))
    .toEqual({
      startQ: 0,
      durationQ: 12,
    });
});

test("a source clip dragged over another in its track trims it like a layer, and other tracks are unaffected", async ({
  page,
}) => {
  const quarterPx = await openWithSpans(page, 2);
  // A second source track with its own clip under the same time range,
  // dropped on the new-track row shown while media is dragged over tracks.
  const dataTransfer = await videoTransfer(page, 1);
  for (const type of ["dragenter", "dragover"]) {
    await page.dispatchEvent(tracks, type, { dataTransfer });
  }
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(".track-row--source-drop", type, { dataTransfer });
  }
  await expect(page.locator(tracks)).toHaveCount(2, { timeout: 30_000 });
  const first = page.locator(tracks).nth(0).locator(".source-span");
  await expect(first).toHaveCount(2);
  const other = page.locator(tracks).nth(1).locator(".source-span");
  await expect(other).toHaveCount(1, { timeout: 30_000 });

  const [left, right] = [first.nth(0), first.nth(1)];
  await expect
    .poll(() => layout(right, quarterPx))
    .toEqual({
      startQ: 8,
      durationQ: 8,
    });

  // The right clip moved 4 quarters back trims the left one to what it
  // leaves uncovered.
  await dragBy(page, right.locator(".source-span__body"), -4 * quarterPx);
  await expect
    .poll(() => layout(right, quarterPx))
    .toEqual({
      startQ: 4,
      durationQ: 8,
    });
  await expect
    .poll(() => layout(left, quarterPx))
    .toEqual({
      startQ: 0,
      durationQ: 4,
    });
  expect(await layout(other, quarterPx)).toEqual({ startQ: 0, durationQ: 8 });

  // Moved over all that is left of the left clip, it removes it.
  await dragBy(page, right.locator(".source-span__body"), -4 * quarterPx);
  await expect(first).toHaveCount(1);
  await expect
    .poll(() => layout(first, quarterPx))
    .toEqual({
      startQ: 0,
      durationQ: 8,
    });
  expect(await layout(other, quarterPx)).toEqual({ startQ: 0, durationQ: 8 });

  // Undo brings back the trimmed clip, then its original length.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(first).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(() => layout(first.nth(0), quarterPx))
    .toEqual({
      startQ: 0,
      durationQ: 8,
    });
  await expect
    .poll(() => layout(first.nth(1), quarterPx))
    .toEqual({
      startQ: 8,
      durationQ: 8,
    });
});
