import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type FilmstripLayout,
  getClipFilmstripTiles,
  getFilmstripRange,
  getFilmstripSampleStepSeconds,
  getFilmstripTileWidthPx,
} from "./clip-filmstrip.ts";

describe("getFilmstripTileWidthPx", () => {
  it("follows the source aspect", () => {
    assert.equal(getFilmstripTileWidthPx(42, 1920, 1080), 75);
    assert.equal(getFilmstripTileWidthPx(42, 1080, 1080), 42);
  });

  it("assumes 16:9 when the size is unknown", () => {
    assert.equal(getFilmstripTileWidthPx(42), 75);
    assert.equal(getFilmstripTileWidthPx(42, 0, 0), 75);
  });

  it("keeps tiles within sensible widths", () => {
    assert.equal(getFilmstripTileWidthPx(42, 1080, 1920), 24);
    assert.equal(getFilmstripTileWidthPx(42, 4000, 1000), 96);
  });
});

describe("getFilmstripRange", () => {
  it("widens the visible range by a block and snaps it to blocks", () => {
    assert.deepEqual(getFilmstripRange(0, 800), { startPx: 0, endPx: 1536 });
    assert.deepEqual(getFilmstripRange(1100, 800), {
      startPx: 512,
      endPx: 2560,
    });
  });

  it("does not change for small scrolls", () => {
    assert.deepEqual(getFilmstripRange(1030, 800), getFilmstripRange(1100, 800));
  });

  it("is empty before the timeline has a width", () => {
    assert.deepEqual(getFilmstripRange(0, 0), { startPx: 0, endPx: 0 });
  });
});

describe("getFilmstripSampleStepSeconds", () => {
  it("uses the largest power of two within one tile", () => {
    assert.equal(getFilmstripSampleStepSeconds(3), 2);
    assert.equal(getFilmstripSampleStepSeconds(4), 4);
    assert.equal(getFilmstripSampleStepSeconds(0.3), 0.25);
  });

  it("never goes below one frame", () => {
    assert.equal(getFilmstripSampleStepSeconds(0.01), 1 / 30);
    assert.equal(getFilmstripSampleStepSeconds(0), 1 / 30);
  });
});

describe("getClipFilmstripTiles", () => {
  // One pixel is 0.1 s and a tile covers 8 s, so samples snap to 8 s.
  const layout: FilmstripLayout = {
    clip: {
      trimStartSeconds: 0,
      sourceWindowStartSeconds: 0,
      sourceWindowEndSeconds: 1000,
    },
    mediaDurationSeconds: 1000,
    clipLeftPx: 0,
    clipWidthPx: 400,
    tileWidthPx: 80,
    secondsPerPx: 0.1,
    range: { startPx: 0, endPx: 10_000 },
  };

  it("tiles the whole clip, sampling under each tile's left edge", () => {
    const tiles = getClipFilmstripTiles(layout);
    assert.deepEqual(
      tiles.map((tile) => [tile.index, tile.leftPx, tile.widthPx]),
      [
        [0, 0, 80],
        [1, 80, 80],
        [2, 160, 80],
        [3, 240, 80],
        [4, 320, 80],
      ],
    );
    assert.deepEqual(
      tiles.map((tile) => tile.timeSeconds),
      [0, 8, 16, 24, 32],
    );
  });

  it("cuts the last tile off at the clip's end", () => {
    const tiles = getClipFilmstripTiles({ ...layout, clipWidthPx: 200 });
    assert.deepEqual(
      tiles.map((tile) => tile.widthPx),
      [80, 80, 40],
    );
  });

  it("starts from the clip's in-point", () => {
    const tiles = getClipFilmstripTiles({
      ...layout,
      clip: { ...layout.clip, trimStartSeconds: 100 },
    });
    assert.deepEqual(
      tiles.map((tile) => tile.timeSeconds),
      [100, 104, 112, 120, 128],
    );
  });

  it("shows more tiles when zoomed in", () => {
    const zoomedIn = getClipFilmstripTiles({
      ...layout,
      clipWidthPx: 800,
      secondsPerPx: 0.05,
    });
    assert.equal(zoomedIn.length, 10);
  });

  it("only lays out tiles in the range", () => {
    const tiles = getClipFilmstripTiles({
      ...layout,
      clipLeftPx: 1000,
      range: { startPx: 1100, endPx: 1250 },
    });
    assert.deepEqual(
      tiles.map((tile) => tile.index),
      [1, 2, 3],
    );
    assert.deepEqual(
      getClipFilmstripTiles({ ...layout, range: { startPx: 500, endPx: 900 } }),
      [],
    );
  });

  it("keeps samples inside the source window and the media", () => {
    const tiles = getClipFilmstripTiles({
      ...layout,
      clip: { ...layout.clip, sourceWindowEndSeconds: 20 },
    });
    assert.deepEqual(
      tiles.map((tile) => tile.timeSeconds),
      [0, 8, 16, 20, 20],
    );
  });

  it("reuses sample times across small zoom changes", () => {
    const before = getClipFilmstripTiles(layout);
    const zoomedOut = getClipFilmstripTiles({
      ...layout,
      clipWidthPx: 380,
      secondsPerPx: 0.105,
    });
    assert.deepEqual(
      zoomedOut.map((tile) => tile.timeSeconds),
      before.map((tile) => tile.timeSeconds),
    );
  });
});
