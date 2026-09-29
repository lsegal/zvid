import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type FilmstripLayout,
  getClipFilmstripTiles,
  getFilmstripDecodeSize,
  getFilmstripRange,
  getFilmstripSampleStepSeconds,
  getFilmstripTileWidthPx,
  getSourceSpanFilmstripClip,
} from "./clip-filmstrip.ts";
import { createClipWarp, warpSourceTime } from "./clip-warp.ts";

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

describe("getFilmstripDecodeSize", () => {
  it("decodes frames at the tile's own landscape shape", () => {
    assert.deepEqual(getFilmstripDecodeSize(75, 42, 1), {
      width: 75,
      height: 42,
    });
    assert.deepEqual(getFilmstripDecodeSize(96, 54, 1), {
      width: 96,
      height: 54,
    });
  });

  it("scales by the device pixel ratio to stay sharp", () => {
    assert.deepEqual(getFilmstripDecodeSize(75, 42, 2), {
      width: 150,
      height: 84,
    });
    assert.deepEqual(getFilmstripDecodeSize(75, 42, 1.5), {
      width: 113,
      height: 63,
    });
  });

  it("keeps the pixel ratio within bounds", () => {
    assert.deepEqual(getFilmstripDecodeSize(75, 42, 0.5), {
      width: 75,
      height: 42,
    });
    assert.deepEqual(getFilmstripDecodeSize(75, 42, 8), {
      width: 225,
      height: 126,
    });
    assert.deepEqual(getFilmstripDecodeSize(75, 42, Number.NaN), {
      width: 75,
      height: 42,
    });
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
    assert.deepEqual(
      getFilmstripRange(1030, 800),
      getFilmstripRange(1100, 800),
    );
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

describe("getSourceSpanFilmstripClip", () => {
  const layout: Omit<FilmstripLayout, "clip"> = {
    mediaDurationSeconds: 1000,
    clipLeftPx: 0,
    clipWidthPx: 400,
    tileWidthPx: 80,
    secondsPerPx: 0.1,
    range: { startPx: 0, endPx: 10_000 },
  };

  it("samples the span from its start towards its end", () => {
    const tiles = getClipFilmstripTiles({
      ...layout,
      clip: getSourceSpanFilmstripClip({
        trimStartSeconds: 100,
        durationSeconds: 40,
      }),
    });
    assert.deepEqual(
      tiles.map((tile) => tile.timeSeconds),
      [100, 104, 112, 120, 128],
    );
  });

  it("keeps samples inside the span and the media", () => {
    const spanEnd = getClipFilmstripTiles({
      ...layout,
      clip: getSourceSpanFilmstripClip({
        trimStartSeconds: 0,
        durationSeconds: 20,
      }),
    });
    assert.deepEqual(
      spanEnd.map((tile) => tile.timeSeconds),
      [0, 8, 16, 20, 20],
    );
    const mediaEnd = getClipFilmstripTiles({
      ...layout,
      mediaDurationSeconds: 18,
      clip: getSourceSpanFilmstripClip({
        trimStartSeconds: 0,
        durationSeconds: 40,
      }),
    });
    assert.deepEqual(
      mediaEnd.map((tile) => tile.timeSeconds),
      [0, 8, 16, 18, 18],
    );
  });
});

describe("getClipFilmstripTiles with a warp", () => {
  const bpm = 120;
  // The source plays at 0.5× until linear second 2, source second 1, then
  // at 2×.
  const warp = createClipWarp(
    [
      { beatTime: 0, secTime: 0 },
      { beatTime: 4, secTime: 1 },
      { beatTime: 8, secTime: 5 },
    ],
    0,
    0,
    bpm,
  );
  assert.ok(warp);
  // One tile covers 1 s, so linear samples fall on whole seconds.
  const layout: FilmstripLayout = {
    clip: {
      trimStartSeconds: 0,
      sourceWindowStartSeconds: 0,
      sourceWindowEndSeconds: 1000,
      warp,
    },
    mediaDurationSeconds: 1000,
    clipLeftPx: 0,
    clipWidthPx: 400,
    tileWidthPx: 80,
    secondsPerPx: 1 / 80,
    range: { startPx: 0, endPx: 10_000 },
    bpm,
  };

  it("samples each tile at the frame the player draws under it", () => {
    const tiles = getClipFilmstripTiles(layout);
    assert.deepEqual(
      tiles.map((tile) => tile.timeSeconds),
      [0, 0.5, 1, 3, 5],
    );
    for (const tile of tiles) {
      const linearSeconds = tile.leftPx * layout.secondsPerPx;
      assert.equal(
        tile.timeSeconds,
        warpSourceTime(warp, linearSeconds, bpm).seconds,
      );
    }
  });

  it("keeps the window in linear time and the media bound in warped time", () => {
    const windowEnd = getClipFilmstripTiles({
      ...layout,
      clip: { ...layout.clip, sourceWindowEndSeconds: 3 },
    });
    assert.deepEqual(
      windowEnd.map((tile) => tile.timeSeconds),
      [0, 0.5, 1, 3, 3],
    );
    const mediaEnd = getClipFilmstripTiles({
      ...layout,
      mediaDurationSeconds: 4,
    });
    assert.deepEqual(
      mediaEnd.map((tile) => tile.timeSeconds),
      [0, 0.5, 1, 3, 4],
    );
  });

  it("maps a warped source span's tiles through its warp", () => {
    const tiles = getClipFilmstripTiles({
      ...layout,
      clip: getSourceSpanFilmstripClip({
        trimStartSeconds: 0,
        durationSeconds: 5,
        warp,
      }),
    });
    assert.deepEqual(
      tiles.map((tile) => tile.timeSeconds),
      [0, 0.5, 1, 3, 5],
    );
  });

  it("keeps unwarped clips linear", () => {
    const tiles = getClipFilmstripTiles({
      ...layout,
      clip: { ...layout.clip, warp: undefined },
    });
    assert.deepEqual(
      tiles.map((tile) => tile.timeSeconds),
      [0, 1, 2, 3, 4],
    );
  });
});
