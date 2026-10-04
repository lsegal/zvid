// The shader passes reference WebGL types.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTEXT, params, uniformValues } from "../../pass-test-utils.ts";
import { glitchClock, pass } from "./pass.ts";

describe("Analog Glitch pass", () => {
  it("seeds Analog Glitch from the playhead time only", () => {
    const parameters = params({ _LowMod: 0.2, _HighMod: 0.2 });
    const first = uniformValues(pass, parameters);
    const again = uniformValues(pass, parameters);

    assert.deepEqual(first, again);
    // 2.5 s is frame 60 of the 24 Hz counter and 7.5 rad into the roll.
    assert.deepEqual(first.uFrame, [60]);
    assert.ok(Math.abs(first.uRoll[0] - (7.5 - 2 * Math.PI)) < 1e-9);
    assert.doesNotMatch(pass.fragmentSource, /random|uTime/i);
  });

  it("wraps its clock on the CPU so it stays precise on long timelines", () => {
    // Ten hours in, the shader still gets small values.
    for (const time of [0, 1.5, 36_000.123, -3]) {
      const { frame, roll } = glitchClock(time);
      assert.ok(
        Number.isInteger(frame) && frame >= 0 && frame < 1024,
        `${time}`,
      );
      assert.ok(roll >= 0 && roll < 2 * Math.PI, `${time}`);
    }
    // The counter wraps as the shader's mod() did, and the roll keeps the
    // same sine.
    assert.equal(
      glitchClock(36_000.123).frame,
      Math.floor(36_000.123 * 24) % 1024,
    );
    assert.ok(
      Math.abs(
        Math.sin(glitchClock(36_000.123).roll) - Math.sin(36_000.123 * 3),
      ) < 1e-6,
    );
    assert.equal(glitchClock(-3).frame, 1024 - 72);
  });

  it("reverses the Analog Glitch roll on a bottom-up texture", () => {
    const parameters = params({ _LowMod: 0.2 });
    assert.deepEqual(uniformValues(pass, parameters).uDown, [1]);
    assert.deepEqual(
      uniformValues(pass, parameters, {
        ...CONTEXT,
        bottomUp: true,
      }).uDown,
      [-1],
    );
  });
});
