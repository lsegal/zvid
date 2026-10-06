import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  editLoopRegion,
  loopRegionPx,
  placeLoopMarker,
} from "./loop-region.ts";

const bounds = { minimumQ: 1, totalQuarters: 64 };
const markerBounds = { ...bounds, contentEndQ: 16 };
const snapToQuarter = (valueQ: number) => Math.round(valueQ);
const noSnap = (valueQ: number) => valueQ;

describe("placeLoopMarker", () => {
  it("starts a loop at an in marker that runs to the content end", () => {
    assert.deepEqual(placeLoopMarker(null, "in", 4, markerBounds), {
      startQ: 4,
      endQ: 16,
    });
  });

  it("starts a loop at an out marker that runs from the timeline start", () => {
    assert.deepEqual(placeLoopMarker(null, "out", 12, markerBounds), {
      startQ: 0,
      endQ: 12,
    });
  });

  it("moves one end of an existing loop", () => {
    const region = { startQ: 4, endQ: 8 };
    assert.deepEqual(placeLoopMarker(region, "in", 2, markerBounds), {
      startQ: 2,
      endQ: 8,
    });
    assert.deepEqual(placeLoopMarker(region, "out", 20, markerBounds), {
      startQ: 4,
      endQ: 20,
    });
  });

  it("starts a fresh loop at a marker placed on or past the other end", () => {
    const region = { startQ: 4, endQ: 8 };
    // An in marker past the out marker runs to the content end.
    assert.deepEqual(placeLoopMarker(region, "in", 12, markerBounds), {
      startQ: 12,
      endQ: 16,
    });
    assert.deepEqual(placeLoopMarker(region, "in", 8, markerBounds), {
      startQ: 8,
      endQ: 16,
    });
    // An out marker before the in marker starts at the timeline start.
    assert.deepEqual(placeLoopMarker(region, "out", 2, markerBounds), {
      startQ: 0,
      endQ: 2,
    });
    assert.deepEqual(placeLoopMarker(region, "out", 4, markerBounds), {
      startQ: 0,
      endQ: 4,
    });
  });

  it("never leaves a loop shorter than the minimum at the other end", () => {
    // The out marker just after the click is too close to keep.
    assert.deepEqual(
      placeLoopMarker({ startQ: 0, endQ: 12.5 }, "in", 12, markerBounds),
      { startQ: 12, endQ: 16 },
    );
    assert.deepEqual(
      placeLoopMarker({ startQ: 11.5, endQ: 16 }, "out", 12, markerBounds),
      { startQ: 0, endQ: 12 },
    );
  });

  it("runs a lone in marker on or past the content end to the timeline end", () => {
    assert.deepEqual(placeLoopMarker(null, "in", 30, markerBounds), {
      startQ: 30,
      endQ: 64,
    });
    assert.deepEqual(placeLoopMarker(null, "in", 16, markerBounds), {
      startQ: 16,
      endQ: 64,
    });
    assert.deepEqual(
      placeLoopMarker(null, "in", 3, { ...markerBounds, contentEndQ: 0 }),
      { startQ: 3, endQ: 64 },
    );
  });

  it("keeps a loop at least the minimum long", () => {
    assert.deepEqual(placeLoopMarker(null, "out", 0, markerBounds), {
      startQ: 0,
      endQ: 1,
    });
    assert.deepEqual(placeLoopMarker(null, "in", 64, markerBounds), {
      startQ: 63,
      endQ: 64,
    });
  });

  it("keeps both markers within the timeline", () => {
    assert.deepEqual(placeLoopMarker(null, "out", 80, markerBounds), {
      startQ: 0,
      endQ: 64,
    });
    assert.deepEqual(placeLoopMarker(null, "in", -4, markerBounds), {
      startQ: 0,
      endQ: 16,
    });
  });
});

describe("editLoopRegion", () => {
  const region = { startQ: 4, endQ: 8 };

  it("moves the whole loop and keeps its length", () => {
    assert.deepEqual(
      editLoopRegion(region, "move", 2.4, snapToQuarter, bounds),
      { startQ: 6, endQ: 10 },
    );
    assert.deepEqual(editLoopRegion(region, "move", -10, noSnap, bounds), {
      startQ: 0,
      endQ: 4,
    });
    assert.deepEqual(editLoopRegion(region, "move", 100, noSnap, bounds), {
      startQ: 60,
      endQ: 64,
    });
  });

  it("resizes either end, snapped", () => {
    assert.deepEqual(
      editLoopRegion(region, "resize-start", -1.7, snapToQuarter, bounds),
      { startQ: 2, endQ: 8 },
    );
    assert.deepEqual(
      editLoopRegion(region, "resize-end", 3.2, snapToQuarter, bounds),
      { startQ: 4, endQ: 11 },
    );
  });

  it("never lets the in marker pass the out marker", () => {
    assert.deepEqual(
      editLoopRegion(region, "resize-start", 10, noSnap, bounds),
      { startQ: 7, endQ: 8 },
    );
    assert.deepEqual(
      editLoopRegion(region, "resize-end", -10, noSnap, bounds),
      {
        startQ: 4,
        endQ: 5,
      },
    );
  });
});

describe("loopRegionPx", () => {
  it("places the loop's ends at their quarters times the zoom", () => {
    assert.deepEqual(loopRegionPx({ startQ: 4, endQ: 10 }, 24), {
      startPx: 96,
      endPx: 240,
    });
    assert.deepEqual(loopRegionPx({ startQ: 0.5, endQ: 2 }, 48), {
      startPx: 24,
      endPx: 96,
    });
  });
});
