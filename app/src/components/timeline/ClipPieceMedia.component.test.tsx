import { beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { setViewport } from "../../component-test/viewport.ts";
import { ClipPieceMedia } from "./ClipPieceMedia";
import {
  projectWithMedia,
  TimelineHarness,
  testPatternVideo,
} from "./timeline-harness";
import { mouse, nextFrames, redo, undo } from "./timeline-harness-input";

// A layer clip made from a source track selection shows a window of that
// track, piece by piece (ClipPieceMedia), not the source clip it was made
// from: editing the source clip under it changes the pieces and filmstrip it
// shows straight away, and trimming, moving or deleting the source clip
// leaves the layer clip in place showing nothing there (#932, #936). Undo
// and redo follow. A four-second test pattern at 120 BPM spans eight
// quarters. What the preview shows through all this stays in the
// layer-clip-source-edit and layer-clip-source-refresh e2e specs.

function query(selector: string, root: ParentNode = document) {
  return root.querySelector(selector) as HTMLElement;
}

const layer = () => query('[data-timeline-lane-id="1"]');
const span = () => query(".source-span");
const clip = () => query(".clip-card", layer());
const box = (element: Element) => element.getBoundingClientRect();

// Where on the timeline `bounds` starts and ends.
function reach(bounds: DOMRect) {
  return [bounds.x, bounds.x + bounds.width];
}

// The fraction of the clip's width each of its parts that show a source
// clip covers, as [from, to] pairs rounded to tenths.
function pieceRanges() {
  const clipBox = box(clip());
  return [...clip().querySelectorAll(".clip-card__piece")].map((piece) => {
    const pieceBox = box(piece);
    return [
      pieceBox.x - clipBox.x,
      pieceBox.x + pieceBox.width - clipBox.x,
    ].map((px) => Math.round((px / clipBox.width) * 10) / 10);
  });
}

// Where each piece sits in the clip, in quarters.
function pieces(quarterPx: number) {
  return [...clip().querySelectorAll<HTMLElement>(".clip-card__piece")].map(
    (piece) => [
      Math.round(piece.offsetLeft / quarterPx),
      Math.round(piece.offsetWidth / quarterPx),
    ],
  );
}

// The thumbnails the clip's filmstrip tiles show, each downsampled to an
// 8×8 grid of RGB values.
async function tiles() {
  const urls = [
    ...clip().querySelectorAll<HTMLElement>(".clip-card__tile"),
  ].map((tile) => /url\("?(.*?)"?\)/.exec(tile.style.backgroundImage)?.[1]);
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
}

type Tiles = Awaited<ReturnType<typeof tiles>>;

// The mean per-channel difference between two samples, 0-255.
function difference(a: number[], b: number[]) {
  let sum = 0;
  for (const [index, value] of a.entries()) {
    sum += Math.abs(value - b[index]);
  }
  return sum / a.length;
}

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
async function loadedTiles() {
  let current: Tiles = [];
  await expect
    .poll(
      async () => {
        current = await tiles();
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

async function expectTiles(expected: Tiles) {
  await expect
    .poll(async () => sameTiles(await tiles(), expected), { timeout: 15_000 })
    .toBe(true);
}

// Drags `handle` horizontally by `deltaPx` with Shift held, so it moves by
// exact quarters.
async function dragBy(handle: Element, deltaPx: number) {
  const bounds = box(handle);
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await mouse.move(x, y, { shift: true });
  await mouse.down({ shift: true });
  await mouse.move(x + deltaPx, y, { steps: 8, shift: true });
  await mouse.up({ shift: true });
}

// The video in a source track, with Layer 1 in view and the timeline
// scrolled to its start, and a layer clip over quarters 2 to 6 of the source
// clip, media seconds 1 to 3, made from a selection there. Returns the
// source clip's box and the width of a quarter.
async function layerClipOverSourceClip() {
  await render(
    <TimelineHarness project={projectWithMedia([testPatternVideo()])} />,
  );
  await expect.poll(() => span()).toBeTruthy();
  layer().scrollIntoView({ block: "center" });
  query(".timeline-scroll").scrollLeft = 0;
  await nextFrames();

  const spanBox = box(span());
  const quarterPx = spanBox.width / 8;
  const y = box(layer()).y + 20;
  await mouse.move(spanBox.x + 2 * quarterPx, y);
  await mouse.down();
  await mouse.move(spanBox.x + 6 * quarterPx, y, { steps: 6 });
  await mouse.up();
  await expect.poll(() => query(".timeline-selection", layer())).toBeTruthy();
  await userEvent.keyboard("1");
  await expect
    .poll(() => layer().querySelectorAll(".clip-card"))
    .toHaveLength(1);
  return { spanBox, quarterPx };
}

describe(ClipPieceMedia, { timeout: 90_000 }, () => {
  beforeEach(async () => {
    localStorage.clear();
    await setViewport({ width: 1600, height: 1200 });
  });

  test("a layer clip keeps its window as its source clip is trimmed, moved and deleted", async () => {
    const { spanBox, quarterPx } = await layerClipOverSourceClip();
    const clipBox = box(clip());
    await expect.poll(pieceRanges).toEqual([[0, 1]]);

    // Trimming the source clip to quarters 0 to 4 leaves the layer clip over
    // 2 to 6, showing the source on its first half and nothing on its
    // second.
    await dragBy(query(".source-span__handle--end", span()), -4 * quarterPx);
    await expect.poll(() => box(span()).width).toBeCloseTo(4 * quarterPx, 0);
    expect(layer().querySelectorAll(".clip-card")).toHaveLength(1);
    expect(reach(box(clip()))).toEqual(reach(clipBox));
    await expect.poll(pieceRanges).toEqual([[0, 0.5]]);

    // Undo fills it again.
    await undo();
    await expect.poll(pieceRanges).toEqual([[0, 1]]);

    // Moving the source clip six quarters later leaves nothing under the
    // layer clip; moving it back fills it again, with no relinking.
    await dragBy(query(".source-span__body", span()), 6 * quarterPx);
    await expect
      .poll(() => box(span()).x - spanBox.x)
      .toBeCloseTo(6 * quarterPx, 0);
    expect(layer().querySelectorAll(".clip-card")).toHaveLength(1);
    await expect.poll(pieceRanges).toEqual([]);
    await dragBy(query(".source-span__body", span()), -6 * quarterPx);
    await expect.poll(() => box(span()).x - spanBox.x).toBeCloseTo(0, 0);
    await expect.poll(pieceRanges).toEqual([[0, 1]]);

    // Deleting the source clip leaves the layer clip in place, showing
    // nothing; undo brings the source clip back and fills it again.
    await page.elementLocator(query(".source-span__body", span())).click();
    await userEvent.keyboard("{Delete}");
    await expect
      .poll(() => document.querySelectorAll(".source-span"))
      .toHaveLength(0);
    expect(layer().querySelectorAll(".clip-card")).toHaveLength(1);
    expect(reach(box(clip()))).toEqual(reach(clipBox));
    await expect.poll(pieceRanges).toEqual([]);
    await undo();
    await expect
      .poll(() => document.querySelectorAll(".source-span"))
      .toHaveLength(1);
    expect(layer().querySelectorAll(".clip-card")).toHaveLength(1);
    await expect.poll(pieceRanges).toEqual([[0, 1]]);
  });

  test("a layer clip's filmstrip follows edits to its source clip", async () => {
    const { spanBox, quarterPx } = await layerClipOverSourceClip();
    await expect.poll(() => pieces(quarterPx)).toEqual([[0, 4]]);
    const originalTiles = await loadedTiles();

    // Moving the source clip two quarters later shows its media a second
    // earlier through the whole layer clip.
    await dragBy(query(".source-span__body", span()), 2 * quarterPx);
    await expect
      .poll(() => box(span()).x - spanBox.x)
      .toBeCloseTo(2 * quarterPx, 0);
    await expect.poll(() => pieces(quarterPx)).toEqual([[0, 4]]);
    await expect
      .poll(async () => sameTiles(await loadedTiles(), originalTiles), {
        timeout: 15_000,
      })
      .toBe(false);
    const movedTiles = await loadedTiles();

    // Undo puts back the filmstrip; redo the moved one.
    await undo();
    await expect.poll(() => box(span()).x - spanBox.x).toBeCloseTo(0, 0);
    await expectTiles(originalTiles);
    await redo();
    await expect
      .poll(() => box(span()).x - spanBox.x)
      .toBeCloseTo(2 * quarterPx, 0);
    await expectTiles(movedTiles);
    await undo();
    await expectTiles(originalTiles);

    // Trimming the source clip's start to quarter 4 leaves the layer clip's
    // first half over nothing.
    await dragBy(query(".source-span__handle--start", span()), 4 * quarterPx);
    await expect
      .poll(() => box(span()).x - spanBox.x)
      .toBeCloseTo(4 * quarterPx, 0);
    await expect.poll(() => pieces(quarterPx)).toEqual([[2, 2]]);
    await undo();
    await expect.poll(() => pieces(quarterPx)).toEqual([[0, 4]]);
    await expectTiles(originalTiles);

    // Trimming its end to quarter 4 leaves the layer clip's second half over
    // nothing.
    await dragBy(query(".source-span__handle--end", span()), -4 * quarterPx);
    await expect.poll(() => box(span()).width).toBeCloseTo(4 * quarterPx, 0);
    await expect.poll(() => pieces(quarterPx)).toEqual([[0, 2]]);
    await undo();
    await expect.poll(() => pieces(quarterPx)).toEqual([[0, 4]]);
    await expectTiles(originalTiles);

    // Deleting the source clip leaves the layer clip in place, showing
    // nothing; undo brings back what it showed.
    await page.elementLocator(query(".source-span__body", span())).click();
    await userEvent.keyboard("{Delete}");
    await expect
      .poll(() => document.querySelectorAll(".source-span"))
      .toHaveLength(0);
    expect(layer().querySelectorAll(".clip-card")).toHaveLength(1);
    expect(clip().querySelectorAll(".clip-card__piece")).toHaveLength(0);
    await undo();
    await expect
      .poll(() => document.querySelectorAll(".source-span"))
      .toHaveLength(1);
    await expect.poll(() => pieces(quarterPx)).toEqual([[0, 4]]);
    await expectTiles(originalTiles);
  });
});
