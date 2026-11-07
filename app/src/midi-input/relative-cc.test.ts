import assert from "node:assert/strict";
import { test } from "node:test";
import { relativeCcReader, relativeSteps } from "./relative-cc.ts";

const cc = (value: number, controller = 74, channel = 1) => ({
  type: "cc" as const,
  channel,
  controller,
  value,
});

function readAll(values: number[], read = relativeCcReader()) {
  return values.map((value) => read(cc(value)));
}

test("relative values step either way in both formats", () => {
  assert.equal(relativeSteps(1), 1);
  assert.equal(relativeSteps(5), 5);
  assert.equal(relativeSteps(127), -1);
  assert.equal(relativeSteps(120), -8);
  assert.equal(relativeSteps(65), -1);
  assert.equal(relativeSteps(72), -8);
});

test("a two's complement encoder steps instead of slamming between the ends (#1644)", () => {
  assert.deepEqual(readAll([1, 1, 1, 127, 127]), [
    undefined,
    { by: 2 / 127 },
    { by: 1 / 127 },
    { by: -1 / 127 },
    { by: -1 / 127 },
  ]);
  // Turned down first, then back.
  assert.deepEqual(readAll([127, 1]), [undefined, { by: 0 }]);
});

test("a sign and magnitude encoder steps", () => {
  assert.deepEqual(readAll([65, 65, 1]), [
    undefined,
    { by: -2 / 127 },
    { by: 1 / 127 },
  ]);
});

test("a knob or fader reads as a position", () => {
  // Mid-range, the first message is a position.
  assert.deepEqual(readAll([40, 41, 127, 1, 1]), [
    { to: 40 / 127 },
    { to: 41 / 127 },
    { to: 1 },
    { to: 1 / 127 },
    { to: 1 / 127 },
  ]);
  // At either end it waits for a value only a position sends, or a run of
  // values with no sign of an encoder.
  assert.deepEqual(readAll([1, 2, 3, 4]), [
    undefined,
    undefined,
    { to: 3 / 127 },
    { to: 4 / 127 },
  ]);
  assert.deepEqual(readAll([127, 126, 0]), [undefined, undefined, { to: 0 }]);
  assert.deepEqual(readAll([66, 67, 68]), [
    undefined,
    undefined,
    { to: 68 / 127 },
  ]);
});

test("each control on each channel is read on its own", () => {
  const read = relativeCcReader();
  read(cc(1));
  assert.deepEqual(read(cc(50, 75)), { to: 50 / 127 });
  assert.equal(read(cc(1, 74, 2)), undefined);
  assert.deepEqual(read(cc(1)), { by: 2 / 127 });
  assert.deepEqual(read(cc(1, 74, 2)), { by: 2 / 127 });
});
