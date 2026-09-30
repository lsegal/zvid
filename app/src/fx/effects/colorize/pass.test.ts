// The shader passes reference WebGL types.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { params, uniformValues } from "../../pass-test-utils.ts";
import { pass } from "./pass.ts";

describe("Colorize pass", () => {
  it("rotates the hue by Hue Shift alone", () => {
    assert.match(pass.fragmentSource, /float a = 6\.2831853 \* uHueOffset;/);
    assert.deepEqual(
      uniformValues(pass, params({ _HueOffset: 0.25, _Reactivity: 1 })),
      { uHueOffset: [0.25] },
    );
  });
});
