import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isRecordQuantize,
  quantizeFloorQ,
  quantizeQ,
  RECORD_QUANTIZE_VALUES,
  recordQuantizeLabel,
} from "./midi-quantize.ts";

test("offers Off and straight and triplet values from 1/4 to 1/32", () => {
  assert.deepEqual(RECORD_QUANTIZE_VALUES.map(recordQuantizeLabel), [
    "Off",
    "1/4",
    "1/4T",
    "1/8",
    "1/8T",
    "1/16",
    "1/16T",
    "1/32",
    "1/32T",
  ]);
  assert.equal(isRecordQuantize("1/8T"), true);
  assert.equal(isRecordQuantize("1/64"), false);
});

test("snaps to the nearest line of each grid", () => {
  const cases = [
    ["1/4", 1],
    ["1/4T", 2 / 3],
    ["1/8", 1 / 2],
    ["1/8T", 1 / 3],
    ["1/16", 1 / 4],
    ["1/16T", 1 / 6],
    ["1/32", 1 / 8],
    ["1/32T", 1 / 12],
  ] as const;
  for (const [quantize, stepQ] of cases) {
    // A little after the fifth line of the grid lands on it, and a little
    // before lands on it too.
    assert.ok(
      Math.abs(quantizeQ(5 * stepQ + 0.01, quantize) - 5 * stepQ) < 1e-9,
    );
    assert.ok(
      Math.abs(quantizeQ(5 * stepQ - 0.01, quantize) - 5 * stepQ) < 1e-9,
    );
  }
});

test("Off leaves quarters as played", () => {
  assert.equal(quantizeQ(1.2345, "off"), 1.2345);
  assert.equal(quantizeFloorQ(1.2345, "off"), 1.2345);
});

test("flooring keeps a quarter already on the grid", () => {
  assert.equal(quantizeFloorQ(1.3, "1/4"), 1);
  assert.equal(quantizeFloorQ(2, "1/4"), 2);
  assert.ok(Math.abs(quantizeFloorQ(1, "1/8T") - 1) < 1e-9);
  assert.ok(Math.abs(quantizeFloorQ(1.4, "1/8T") - 4 / 3) < 1e-9);
});
