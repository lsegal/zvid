// The shader passes reference WebGL types.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTEXT, params, uniformValues } from "../../pass-test-utils.ts";
import { pass } from "./pass.ts";

describe("Analog Glitch pass", () => {
  it("seeds Analog Glitch from the playhead time only", () => {
    const parameters = params({ _LowMod: 0.2, _HighMod: 0.2 });
    const first = uniformValues(pass, parameters);
    const again = uniformValues(pass, parameters);

    assert.deepEqual(first, again);
    assert.deepEqual(first.uTime, [2.5]);
    assert.doesNotMatch(pass.fragmentSource, /random/i);
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
