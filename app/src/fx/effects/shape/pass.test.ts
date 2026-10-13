// The shader passes reference WebGL types.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTEXT, params, uniformValues } from "../../pass-test-utils.ts";
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
    assert.deepEqual(uniformValues(pass, shape("Hexagon")).uShape, [0]);
  });

  it("draws a Custom shape whose SVG isn't loaded as the whole box", () => {
    const custom = shape("Custom:missing.svg");
    const values = uniformValues(pass, custom);
    assert.deepEqual(values.uShape, [4]);
    assert.deepEqual(values.uCustom, [0]);
    assert.equal(pass.isIdentity?.(custom), true);
  });

  it("samples a Custom shape's mask alpha at the shape's own position", () => {
    // Unscaled: the chain rewrites only texture2D calls to its input's
    // corner of a pooled target.
    assert.match(
      pass.fragmentSource,
      /texture2DProj\(uMask, vec3\(p, 1\.0\)\)\.a/,
    );
  });

  it("skips a Rectangle, which leaves the layer as it is", () => {
    assert.equal(pass.isIdentity?.(shape("Rectangle")), true);
    assert.equal(pass.isIdentity?.(shape("Oval")), false);
  });

  it("fills the shape until it has a Stroke", () => {
    const values = uniformValues(pass, shape("Oval"));
    assert.deepEqual(values.uStroke, [0]);
    assert.deepEqual(values.uDrawn, [1]);
    assert.deepEqual(values.uDisplay, [1, 1]);
  });

  it("feeds the outline in pixels as the shape is shown", () => {
    const outline = params({
      Shape: "Oval",
      StrokeWidth: 10,
      DashLength: 30,
      DashGap: 20,
      DashOffset: -5,
      StrokeDrawn: 0.25,
    });
    // A 1080 by 1920 picture is at the 1080p reference size.
    const values = uniformValues(pass, outline, {
      ...CONTEXT,
      displayScale: [0.5, 0.25],
    });
    assert.deepEqual(values.uStroke, [10]);
    assert.deepEqual(values.uDash, [30, 20, -5]);
    assert.deepEqual(values.uDrawn, [0.25]);
    assert.deepEqual(values.uDisplay, [0.5, 0.25]);
    // Half the output's size, half the pixels.
    const half = uniformValues(pass, outline, {
      ...CONTEXT,
      resolution: [540, 960],
    });
    assert.deepEqual(half.uStroke, [5]);
    assert.deepEqual(half.uDash, [15, 10, -2.5]);
    // A quarter-size frame of the same output, shown four times larger.
    const shrunk = uniformValues(pass, outline, {
      ...CONTEXT,
      resolution: [270, 480],
      pixelScale: 0.25,
      frameScale: 0.25,
      displayScale: [2, 1],
    });
    assert.deepEqual(shrunk.uStroke, [10]);
    assert.deepEqual(shrunk.uDash, [30, 20, -5]);
    assert.deepEqual(shrunk.uDisplay, [2, 1]);
  });

  it("never outlines a Custom shape", () => {
    const values = uniformValues(
      pass,
      params({ Shape: "Custom:missing.svg", StrokeWidth: 10 }),
    );
    assert.deepEqual(values.uStroke, [0]);
  });

  it("outlines a Rectangle, so it no longer leaves the layer as it is", () => {
    assert.equal(
      pass.isIdentity?.(params({ Shape: "Rectangle", StrokeWidth: 4 })),
      false,
    );
    assert.equal(
      pass.isIdentity?.(params({ Shape: "Rectangle", StrokeWidth: 0 })),
      true,
    );
  });

  it("compiles every shape's function into the shader", () => {
    for (const [index] of SHAPES.entries()) {
      assert.match(pass.fragmentSource, new RegExp(`float shape${index}\\(`));
      assert.match(
        pass.fragmentSource,
        new RegExp(`vec2 shapeOutline${index}\\(`),
      );
    }
  });
});
