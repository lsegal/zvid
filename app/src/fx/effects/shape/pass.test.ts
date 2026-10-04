// The shader passes reference WebGL types.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTEXT, uniformValues } from "../../pass-test-utils.ts";
import { pass } from "./pass.ts";
import { SHAPES } from "./shapes/index.ts";

const shape = (value: string) => [{ key: "Shape", value }];

describe("Shape pass", () => {
  it("feeds the shape's index and surface size", () => {
    const values = uniformValues(pass, shape("Star"));
    assert.deepEqual(values.uRes, [1080, 1920]);
    assert.deepEqual(values.uShape, [2]);
    assert.deepEqual(values.uFlip, [0]);
  });

  it("flips a bottom-up picture so shapes stay upright", () => {
    const values = uniformValues(pass, shape("Arrow"), {
      ...CONTEXT,
      bottomUp: true,
    });
    assert.deepEqual(values.uFlip, [1]);
  });

  it("draws an unknown shape as a Rectangle", () => {
    assert.deepEqual(uniformValues(pass, shape("Custom")).uShape, [0]);
  });

  it("skips a Rectangle, which leaves the layer as it is", () => {
    assert.equal(pass.isIdentity?.(shape("Rectangle")), true);
    assert.equal(pass.isIdentity?.(shape("Oval")), false);
  });

  it("compiles every shape's function into the shader", () => {
    for (const [index] of SHAPES.entries()) {
      assert.match(pass.fragmentSource, new RegExp(`float shape${index}\\(`));
    }
  });
});
