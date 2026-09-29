import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  divisionQuarters,
  formatDivision,
  GRID_COARSEST,
  GRID_FINEST,
  GRID_MAX_PX,
  GRID_MIN_PX,
  type GridDivision,
  getGridLayers,
  getGridUnit,
  getSnapUnit,
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

describe("getSnapUnit", () => {
  it("snaps to the adaptive division in auto mode", () => {
    assert.equal(getSnapUnit("auto", FOUR_FOUR, 16), 0.25);
    assert.equal(getSnapUnit("auto", FOUR_FOUR, 1), 4);
  });

  it("keeps the fixed modes on their unit", () => {
    assert.equal(getSnapUnit("bar", FOUR_FOUR, 32), 4);
    assert.equal(getSnapUnit("beat", FOUR_FOUR, 32), 1);
    assert.equal(getSnapUnit("half", FOUR_FOUR, 32), 0.5);
    assert.equal(getSnapUnit("quarter", FOUR_FOUR, 32), 0.25);
    assert.equal(getSnapUnit("bar", SIX_EIGHT, 1), 3);
    assert.equal(getSnapUnit("beat", SIX_EIGHT, 1), 0.5);
  });

  it("adds finer snap points when zooming in and removes them zooming out", () => {
    const zoomedIn = resolveAdaptiveDivision(41);
    assert.equal(zoomedIn, 16);
    assert.ok(divisionQuarters(zoomedIn) * 41 > GRID_MIN_PX);
    const inUnit = getSnapUnit("auto", FOUR_FOUR, zoomedIn);
    assert.equal(snap(1.3, inUnit), 1.25);

    const zoomedOut = resolveAdaptiveDivision(4, zoomedIn);
    assert.equal(zoomedOut, 2);
    const outUnit = getSnapUnit("auto", FOUR_FOUR, zoomedOut);
    assert.equal(snap(1.3, outUnit), 2);
  });

  it("snaps a fixed mode to its unit whatever the zoom", () => {
    for (const quarterPx of [1, 12, 28, 200]) {
      const division = resolveAdaptiveDivision(quarterPx);
      assert.equal(snap(1.3, getSnapUnit("beat", FOUR_FOUR, division)), 1);
    }
  });
});

describe("getGridUnit", () => {
  it("follows the adaptive division", () => {
    assert.equal(getGridUnit(0.125, 16), 0.125);
    assert.equal(getGridUnit(0.25, 16), 0.25);
  });

  it("never draws coarser than the snap unit", () => {
    assert.equal(getGridUnit(0.25, 2), 0.25);
    assert.equal(getGridUnit(1, 1), 1);
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

describe("formatDivision", () => {
  it("formats a note value", () => {
    const divisions: GridDivision[] = [1, 16];
    assert.deepEqual(divisions.map(formatDivision), ["1/1", "1/16"]);
  });
});
