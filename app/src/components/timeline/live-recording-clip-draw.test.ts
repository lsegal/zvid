import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LiveFrame } from "../../recording/live-take-monitor.ts";
import {
  type DrawContext,
  LiveClipPainter,
  tileFrame,
  visibleTileRange,
  waveformColumn,
} from "./live-recording-clip-draw.ts";

// Records what a canvas is asked to draw.
function fakeContext() {
  const calls = {
    fills: [] as number[],
    clears: [] as [number, number][],
    images: [] as [unknown, number][],
  };
  const context = {
    fillStyle: "",
    fillRect: (x: number) => {
      calls.fills.push(x);
    },
    clearRect: (x: number, _y: number, width: number) => {
      calls.clears.push([x, width]);
    },
    drawImage: (image: unknown, x: number) => {
      calls.images.push([image, x]);
    },
  } as unknown as DrawContext;
  return { context, calls };
}

const frame = (atSeconds: number): LiveFrame => ({
  atSeconds,
  image: { atSeconds } as unknown as CanvasImageSource,
});

describe("live clip windowing", () => {
  it("lists the tiles overlapping the visible slice", () => {
    assert.deepEqual(visibleTileRange(0, 250, 100), { first: 0, end: 3 });
    assert.deepEqual(visibleTileRange(1050, 1200, 100), { first: 10, end: 12 });
    assert.deepEqual(visibleTileRange(100, 100, 100), { first: 0, end: 0 });
  });

  it("reads a column's peaks and knows when they are all in", () => {
    // 10 pixels a second and a peak every 0.05 s: two peaks a column.
    const peaks = [0.1, 0.4, 0.2, 0.3, 0.9];
    assert.deepEqual(waveformColumn(peaks, 0.05, 10, 0), {
      peak: 0.4,
      complete: true,
    });
    assert.deepEqual(waveformColumn(peaks, 0.05, 10, 2), {
      peak: 0.9,
      complete: false,
    });
  });

  it("settles a tile once a later frame is grabbed", () => {
    const frames = [frame(0), frame(1)];
    assert.equal(tileFrame(frames, 0, 50, 100).complete, true);
    // Tile 2 starts at 1 s: frame 1 shows it, but a later one may replace it.
    assert.deepEqual(tileFrame(frames, 2, 50, 100), {
      frame: frames[1],
      complete: false,
    });
  });
});

describe("live clip painter", () => {
  const wave = (peaks: number[]) => ({
    peaks,
    peakIntervalSeconds: 0.05,
    heightPx: 32,
  });

  it("draws only the visible slice of a long take", () => {
    const { context, calls } = fakeContext();
    const peaks = Array.from({ length: 2000 }, () => 0.5);
    // 20 pixels a second: 100 s is 2000 px, but only 300 px are on screen.
    new LiveClipPainter().paintWaveform(
      context,
      { startPx: 1000, widthPx: 300, clipWidthPx: 2000, pxPerSecond: 20 },
      wave(peaks),
    );
    assert.equal(calls.fills.length, 300);
    assert.equal(Math.min(...calls.fills), 0);
    assert.equal(Math.max(...calls.fills), 299);
  });

  it("draws only new columns as the take grows", () => {
    const { context, calls } = fakeContext();
    const painter = new LiveClipPainter();
    const peaks = Array.from({ length: 40 }, () => 0.5);
    const view = { startPx: 0, widthPx: 300, pxPerSecond: 10 };
    painter.paintWaveform(context, { ...view, clipWidthPx: 20 }, wave(peaks));
    assert.equal(calls.fills.length, 20);

    calls.fills.length = 0;
    peaks.push(...Array.from({ length: 20 }, () => 0.5));
    painter.paintWaveform(context, { ...view, clipWidthPx: 30 }, wave(peaks));
    assert.deepEqual(calls.fills, [20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
  });

  it("redraws columns whose peaks were still coming", () => {
    const { context, calls } = fakeContext();
    const painter = new LiveClipPainter();
    const peaks = [0.5, 0.5, 0.5];
    const view = { startPx: 0, widthPx: 300, pxPerSecond: 10 };
    painter.paintWaveform(context, { ...view, clipWidthPx: 2 }, wave(peaks));
    calls.fills.length = 0;
    painter.paintWaveform(context, { ...view, clipWidthPx: 2 }, wave(peaks));
    // Column 0 is settled; column 1 lacks its second peak.
    assert.deepEqual(calls.fills, [1]);
  });

  it("redraws everything after scrolling or zooming", () => {
    const { context, calls } = fakeContext();
    const painter = new LiveClipPainter();
    const peaks = Array.from({ length: 100 }, () => 0.5);
    const view = { startPx: 0, widthPx: 300, clipWidthPx: 50, pxPerSecond: 10 };
    painter.paintWaveform(context, view, wave(peaks));
    calls.fills.length = 0;
    painter.paintWaveform(
      context,
      { ...view, pxPerSecond: 5, clipWidthPx: 25 },
      wave(peaks),
    );
    assert.equal(calls.fills.length, 25);
    assert.deepEqual(calls.clears[calls.clears.length - 26], [0, 300]);
  });

  it("draws only the visible tiles, then only unsettled ones", () => {
    const { context, calls } = fakeContext();
    const painter = new LiveClipPainter();
    // 100 pixels a second with 50 px tiles: two tiles a second.
    const frames = Array.from({ length: 60 }, (_, index) => frame(index));
    const strip = { frames, tileWidthPx: 50, heightPx: 56 };
    const view = {
      startPx: 2000,
      widthPx: 200,
      clipWidthPx: 6000,
      pxPerSecond: 100,
    };
    painter.paintFilmstrip(context, view, strip);
    assert.deepEqual(
      calls.images.map(([, x]) => x),
      [0, 50, 100, 150],
    );
    calls.images.length = 0;
    painter.paintFilmstrip(context, view, strip);
    assert.equal(calls.images.length, 0);
  });
});
