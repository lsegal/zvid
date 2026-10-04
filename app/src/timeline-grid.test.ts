import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  divisionQuarters,
  GRID_COARSEST,
  GRID_FINEST,
  GRID_MAX_PX,
  GRID_MIN_PX,
  getBarStep,
  getGridLayers,
  getRulerBars,
  RULER_LABEL_MIN_PX,
  resolveAdaptiveDivision,
} from "./timeline-grid.ts";

const FOUR_FOUR = { numerator: 4, denominator: 4 };
const SIX_EIGHT = { numerator: 6, denominator: 8 };

function snap(valueQ: number, snapUnit: number) {
  return Math.round(valueQ / snapUnit) * snapUnit;
}

describe("resolveAdaptiveDivision", () => {
  it("picks the division for the zoom from a quarter note", () => {
    assert.equal(resolveAdaptiveDivision(12), 4);
    assert.equal(resolveAdaptiveDivision(28), 8);
    assert.equal(resolveAdaptiveDivision(50), 16);
    assert.equal(resolveAdaptiveDivision(100), 32);
    assert.equal(resolveAdaptiveDivision(3), 2);
    assert.equal(resolveAdaptiveDivision(1.5), 1);
  });

  it("keeps grid lines between the thresholds when not clamped", () => {
    for (let quarterPx = 0.2; quarterPx < 200; quarterPx *= 1.07) {
      const division = resolveAdaptiveDivision(quarterPx);
      const spacingPx = divisionQuarters(division) * quarterPx;
      if (division !== GRID_FINEST) {
        assert.ok(spacingPx <= GRID_MAX_PX, `${quarterPx}px: ${spacingPx}`);
      }
      if (division !== GRID_COARSEST) {
        assert.ok(spacingPx >= GRID_MIN_PX, `${quarterPx}px: ${spacingPx}`);
      }
    }
  });

  it("never goes finer than 1/32 or coarser than 1/1", () => {
    assert.equal(resolveAdaptiveDivision(10_000), GRID_FINEST);
    assert.equal(resolveAdaptiveDivision(10_000, 1), GRID_FINEST);
    assert.equal(resolveAdaptiveDivision(0.01), GRID_COARSEST);
    assert.equal(resolveAdaptiveDivision(0.01, 32), GRID_COARSEST);
  });

  it("keeps the previous division while it stays within the thresholds", () => {
    // Both 1/4 (12px) and 1/8 (6px) fit at 12px per quarter.
    assert.equal(resolveAdaptiveDivision(12, 4), 4);
    assert.equal(resolveAdaptiveDivision(12, 8), 8);
  });

  it("does not flicker when zooming back and forth across a threshold", () => {
    // 1/4 switches to 1/8 just above 20px per quarter...
    const finer = resolveAdaptiveDivision(20.5, 4);
    assert.equal(finer, 8);
    // ...and stays there when zooming back just below it.
    assert.equal(resolveAdaptiveDivision(19.5, finer), 8);
    assert.equal(resolveAdaptiveDivision(20.5, finer), 8);
    // It only returns to 1/4 once 1/8 lines would be under 5px apart.
    assert.equal(resolveAdaptiveDivision(10.5, finer), 8);
    assert.equal(resolveAdaptiveDivision(9.5, finer), 4);
  });

  it("keeps the previous division for an invalid zoom", () => {
    assert.equal(resolveAdaptiveDivision(0, 16), 16);
    assert.equal(resolveAdaptiveDivision(Number.NaN, 16), 16);
  });
});

describe("adaptive snapping", () => {
  it("snaps to the adaptive division", () => {
    assert.equal(divisionQuarters(16), 0.25);
    assert.equal(divisionQuarters(1), 4);
  });

  it("adds finer snap points when zooming in and removes them zooming out", () => {
    const zoomedIn = resolveAdaptiveDivision(41);
    assert.equal(zoomedIn, 16);
    assert.ok(divisionQuarters(zoomedIn) * 41 > GRID_MIN_PX);
    assert.equal(snap(1.3, divisionQuarters(zoomedIn)), 1.25);

    const zoomedOut = resolveAdaptiveDivision(4, zoomedIn);
    assert.equal(zoomedOut, 2);
    assert.equal(snap(1.3, divisionQuarters(zoomedOut)), 2);
  });
});

describe("getGridLayers", () => {
  it("draws divisions, beats and bars when finer than a beat", () => {
    assert.deepEqual(getGridLayers(0.25, FOUR_FOUR), [
      { spacingQ: 0.25, weight: "division" },
      { spacingQ: 1, weight: "beat" },
      { spacingQ: 4, weight: "bar" },
    ]);
  });

  it("draws no separate division layer on the beat", () => {
    assert.deepEqual(getGridLayers(1, FOUR_FOUR), [
      { spacingQ: 1, weight: "beat" },
      { spacingQ: 4, weight: "bar" },
    ]);
  });

  it("drops beat lines when the grid is coarser than a beat", () => {
    assert.deepEqual(getGridLayers(2, FOUR_FOUR), [
      { spacingQ: 2, weight: "division" },
      { spacingQ: 4, weight: "bar" },
    ]);
    assert.deepEqual(getGridLayers(4, FOUR_FOUR), [
      { spacingQ: 4, weight: "bar" },
    ]);
  });

  it("uses the time signature's beat and bar", () => {
    assert.deepEqual(getGridLayers(0.25, SIX_EIGHT), [
      { spacingQ: 0.25, weight: "division" },
      { spacingQ: 0.5, weight: "beat" },
      { spacingQ: 3, weight: "bar" },
    ]);
  });
});

describe("getGridLayers thinning", () => {
  // A quarter at 25% zoom.
  const quarterPx = 28 * 0.25;

  it("keeps every layer when its lines are far enough apart", () => {
    assert.deepEqual(
      getGridLayers(0.25, FOUR_FOUR, 100),
      getGridLayers(0.25, FOUR_FOUR),
    );
  });

  it("drops layers whose lines would be closer than GRID_MIN_PX", () => {
    // A fixed 1/4-beat snap at 25%: divisions 1.75px apart are not drawn,
    // beats 7px apart still are.
    assert.deepEqual(getGridLayers(0.25, FOUR_FOUR, quarterPx), [
      { spacingQ: 1, weight: "beat" },
      { spacingQ: 4, weight: "bar" },
    ]);
    assert.deepEqual(getGridLayers(0.25, SIX_EIGHT, quarterPx), [
      { spacingQ: 3, weight: "bar" },
    ]);
  });

  it("thins bar lines to multiples of bars", () => {
    assert.deepEqual(getGridLayers(4, FOUR_FOUR, 1), [
      { spacingQ: 8, weight: "bar" },
    ]);
    assert.deepEqual(getGridLayers(4, FOUR_FOUR, 0.3), [
      { spacingQ: 32, weight: "bar" },
    ]);
  });

  it("never draws lines closer than GRID_MIN_PX", () => {
    for (const px of [0.2, 1, quarterPx, 10, 84]) {
      for (const unit of [0.125, 0.25, 0.5, 1, 4]) {
        for (const layer of getGridLayers(unit, SIX_EIGHT, px)) {
          assert.ok(layer.spacingQ * px >= GRID_MIN_PX);
        }
      }
    }
  });
});

describe("getBarStep", () => {
  it("is one bar when a bar spans the minimum", () => {
    assert.equal(getBarStep(40, 40), 1);
    assert.equal(getBarStep(112, 40), 1);
  });

  it("doubles until the step spans the minimum", () => {
    assert.equal(getBarStep(21, 40), 2);
    assert.equal(getBarStep(21, RULER_LABEL_MIN_PX.timecode), 4);
    assert.equal(getBarStep(3, 40), 16);
  });

  it("falls back to every bar for an invalid width", () => {
    assert.equal(getBarStep(0, 40), 1);
    assert.equal(getBarStep(Number.NaN, 40), 1);
  });
});

describe("getRulerBars", () => {
  const indexes = (bars: Array<{ index: number }>) =>
    bars.map((bar) => bar.index);

  it("gives the bars from the start of the range to just past its end", () => {
    // 4/4 bars of 100px over 100 bars, the range in the middle.
    const bars = getRulerBars(4, 400, 25, 1050, 1420);
    assert.deepEqual(indexes(bars), [10, 11, 12, 13, 14, 15]);
    assert.deepEqual(bars[0], { index: 10, quarter: 40 });
  });

  it("stops at the timeline's ends", () => {
    assert.deepEqual(indexes(getRulerBars(4, 16, 25, 0, 10_000)), [0, 1, 2, 3]);
  });

  it("gives every bar before the view is measured", () => {
    assert.equal(getRulerBars(4, 400, 25, 0, 0).length, 100);
  });
});
