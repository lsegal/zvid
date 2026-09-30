// The shader passes reference WebGL types.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { params, uniformValues } from "../../pass-test-utils.ts";
import { pass } from "./pass.ts";

describe("Pixelate pass", () => {
  it("feeds Pixelate its amount, intensities, surface size and impulses", () => {
    const values = uniformValues(
      pass,
      params({ _NumPixels: 0.83, _LowIntensity: 1, _HighIntensity: 1.5 }),
    );

    assert.deepEqual(values.uRes, [1080, 1920]);
    assert.ok(Math.abs(values.uNum[0] - 0.83) < 1e-9);
    assert.deepEqual(values.uLow, [1]);
    assert.deepEqual(values.uHigh, [1]);
    assert.deepEqual(values.uImpulseLow, [0.7]);
    assert.deepEqual(values.uImpulseHigh, [0.9]);
  });
});
