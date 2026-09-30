import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  layerDropIndex,
  layerLandingTop,
  layerReorderAnnouncements,
  layerRowShift,
  stepLayerIndex,
} from "./layer-reorder.ts";

// Five 72px rows, stacked from 0.
const rows = [0, 1, 2, 3, 4].map((index) => ({ top: index * 72, height: 72 }));

describe("layerDropIndex", () => {
  it("stays put until the dragged row crosses a neighbor's middle", () => {
    assert.equal(layerDropIndex(rows, 3, 3 * 72 + 36), 3);
    assert.equal(layerDropIndex(rows, 3, 2 * 72 + 37), 3);
    assert.equal(layerDropIndex(rows, 3, 2 * 72 + 35), 2);
    assert.equal(layerDropIndex(rows, 3, 4 * 72 + 37), 4);
  });

  it("clamps to the ends of the list", () => {
    assert.equal(layerDropIndex(rows, 3, -500), 0);
    assert.equal(layerDropIndex(rows, 0, 5000), 4);
  });
});

describe("layerRowShift", () => {
  it("moves the rows a layer passes on its way up down by its height", () => {
    // Layer 4 (index 3) hovering at the top.
    assert.deepEqual(
      [0, 1, 2, 3, 4].map((index) => layerRowShift(rows, index, 3, 0)),
      [72, 72, 72, 0, 0],
    );
  });

  it("moves the rows a layer passes on its way down up by its height", () => {
    assert.deepEqual(
      [0, 1, 2, 3, 4].map((index) => layerRowShift(rows, index, 1, 3)),
      [0, 0, -72, -72, 0],
    );
  });

  it("leaves every row alone while the layer is still in place", () => {
    assert.deepEqual(
      [0, 1, 2, 3, 4].map((index) => layerRowShift(rows, index, 2, 2)),
      [0, 0, 0, 0, 0],
    );
  });
});

describe("layerLandingTop", () => {
  it("lands where the target row starts, allowing for uneven heights", () => {
    const uneven = [
      { top: 0, height: 72 },
      { top: 72, height: 100 },
      { top: 172, height: 72 },
    ];
    assert.equal(layerLandingTop(uneven, 2, 0), 0);
    assert.equal(layerLandingTop(uneven, 0, 1), 100);
    assert.equal(layerLandingTop(uneven, 1, 2), 144);
    assert.equal(layerLandingTop(uneven, 1, 1), 72);
  });
});

describe("stepLayerIndex", () => {
  it("steps within the list", () => {
    assert.equal(stepLayerIndex(3, -1, 5), 2);
    assert.equal(stepLayerIndex(0, -1, 5), 0);
    assert.equal(stepLayerIndex(4, 1, 5), 4);
  });
});

describe("layerReorderAnnouncements", () => {
  it("names the layer and its one-based position", () => {
    assert.equal(
      layerReorderAnnouncements.position("Layer 4", 1, 5),
      "Layer 4, position 2 of 5",
    );
    assert.match(
      layerReorderAnnouncements.pickedUp("Layer 4", 3, 5),
      /^Picked up Layer 4, position 4 of 5\./,
    );
    assert.equal(
      layerReorderAnnouncements.dropped("Layer 4", 0, 5),
      "Dropped Layer 4, position 1 of 5",
    );
    assert.equal(
      layerReorderAnnouncements.canceled("Layer 4"),
      "Canceled moving Layer 4",
    );
  });
});
