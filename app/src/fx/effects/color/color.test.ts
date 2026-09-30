import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FillEffect } from "../../../fill-paint.ts";
import { resolveFillPaint } from "./color.ts";

const RED = { r: 255, g: 0, b: 0, a: 1 };

function colorEffect(
  trackId: string,
  values: Record<string, string>,
  enabled = true,
): FillEffect {
  return {
    trackId,
    effectName: "Color",
    enabled,
    parameters: Object.entries(values).map(([key, value]) => ({
      key,
      value,
      numericValue: key === "Opacity" ? Number(value) : undefined,
    })),
  };
}

describe("resolveFillPaint", () => {
  it("paints neutral gray when the layer has no Color effect", () => {
    const paint = resolveFillPaint([], "1");
    assert.equal(paint.kind, "solid");
    assert.deepEqual(paint.kind === "solid" && paint.color, {
      r: 128,
      g: 128,
      b: 128,
      a: 1,
    });
  });

  it("uses the color in Solid mode and the gradient in Gradient mode", () => {
    const values = {
      Mode: "Solid",
      Color: "rgba(255,0,0,1)",
      Gradient: "radial-gradient(circle, #f00 0%, #00f 100%)",
      Opacity: "0.5",
    };
    const solid = resolveFillPaint([colorEffect("1", values)], "1");
    assert.deepEqual(solid, { kind: "solid", color: RED, opacity: 0.5 });

    const gradient = resolveFillPaint(
      [colorEffect("1", { ...values, Mode: "Gradient" })],
      "1",
    );
    assert.equal(gradient.kind, "radial");
    assert.equal(gradient.opacity, 0.5);
  });

  it("reads only the layer's own enabled Color effect", () => {
    const effects = [
      colorEffect("2", { Mode: "Solid", Color: "#00f" }),
      colorEffect("1", { Mode: "Solid", Color: "#00f" }, false),
    ];
    const paint = resolveFillPaint(effects, "1");
    assert.equal(paint.kind === "solid" && paint.color.r, 128);
  });
});
