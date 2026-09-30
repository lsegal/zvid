// The shader passes reference WebGL types.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pass } from "./pass.ts";

describe("Colorize pass", () => {
  it("scales the Colorize hue swing by impulse times reactivity", () => {
    assert.match(
      pass.fragmentSource,
      /uReactivity \* \(uImpulseLow \* 0\.5 \+ uImpulseHigh \* 0\.5\)/,
    );
  });
});
