import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type FillPaint,
  formatFillPaintCss,
  parseCssColor,
  parseCssGradient,
  rasterizeFillPaint,
} from "./fill-paint.ts";

const RED = { r: 255, g: 0, b: 0, a: 1 };
const BLUE = { r: 0, g: 0, b: 255, a: 1 };

// RGBA bytes of the pixel at (`x`, `y`), counted from the top left.
function pixelAt(
  raster: ReturnType<typeof rasterizeFillPaint>,
  x: number,
  y: number,
) {
  const offset = (y * raster.width + x) * 4;
  return Array.from(raster.pixels.slice(offset, offset + 4));
}

function assertNear(actual: number[], expected: number[], tolerance = 8) {
  for (const [index, value] of expected.entries()) {
    assert.ok(
      Math.abs(actual[index] - value) <= tolerance,
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

describe("parseCssColor", () => {
  it("reads hex colours with and without alpha", () => {
    assert.deepEqual(parseCssColor("#f00"), RED);
    assert.deepEqual(parseCssColor("#0000ff"), BLUE);
    assert.deepEqual(parseCssColor("#ff000080"), {
      ...RED,
      a: 128 / 255,
    });
  });

  it("reads rgb() and rgba() in the picker's spacing", () => {
    assert.deepEqual(parseCssColor("rgba(255,0,0,1)"), RED);
    assert.deepEqual(parseCssColor("rgba(0, 0, 255, 0.5)"), {
      ...BLUE,
      a: 0.5,
    });
    assert.deepEqual(parseCssColor("rgb(255 0 0)"), RED);
  });

  it("rejects anything else", () => {
    assert.equal(parseCssColor("tomato"), undefined);
    assert.equal(parseCssColor(""), undefined);
    assert.equal(parseCssColor("rgba(1,2)"), undefined);
  });
});

describe("parseCssGradient", () => {
  it("reads the picker's linear gradients", () => {
    assert.deepEqual(
      parseCssGradient(
        "linear-gradient(90deg, rgba(255,0,0,1) 0%, rgba(0,0,255,1) 100%)",
      ),
      {
        kind: "linear",
        angleDeg: 90,
        stops: [
          { offset: 0, color: RED },
          { offset: 1, color: BLUE },
        ],
      },
    );
  });

  it("reads radial gradients and skips their shape", () => {
    assert.deepEqual(
      parseCssGradient(
        "radial-gradient(circle, rgba(255, 0, 0, 1) 0%, rgba(0, 0, 255, 1) 100%)",
      ),
      {
        kind: "radial",
        stops: [
          { offset: 0, color: RED },
          { offset: 1, color: BLUE },
        ],
      },
    );
  });

  it("defaults the angle and spreads stops without positions", () => {
    const gradient = parseCssGradient("linear-gradient(#f00, #0f0, #00f)");
    assert.equal(gradient?.kind, "linear");
    assert.equal(gradient?.kind === "linear" && gradient.angleDeg, 180);
    assert.deepEqual(
      gradient?.stops.map((stop) => stop.offset),
      [0, 0.5, 1],
    );
  });

  it("reads side keywords", () => {
    const gradient = parseCssGradient("linear-gradient(to right, red, blue)");
    // Named colours are not supported, so the stops fail to parse.
    assert.equal(gradient, undefined);
    const sided = parseCssGradient("linear-gradient(to left, #f00, #00f)");
    assert.equal(sided?.kind === "linear" && sided.angleDeg, 270);
  });

  it("rejects non-gradients", () => {
    assert.equal(parseCssGradient("rgba(0,0,0,1)"), undefined);
    assert.equal(parseCssGradient("conic-gradient(#f00, #00f)"), undefined);
  });
});

describe("rasterizeFillPaint", () => {
  it("fills every pixel with a solid colour and its opacity", () => {
    const raster = rasterizeFillPaint(
      { kind: "solid", color: RED, opacity: 0.5 },
      4,
      3,
    );
    assert.equal(raster.pixels.length, 4 * 3 * 4);
    for (const [x, y] of [
      [0, 0],
      [3, 2],
      [2, 1],
    ]) {
      assert.deepEqual(pixelAt(raster, x, y), [255, 0, 0, 128]);
    }
  });

  const stops = [
    { offset: 0, color: RED },
    { offset: 1, color: BLUE },
  ];

  it("runs a 90° linear gradient from left to right", () => {
    const paint: FillPaint = {
      kind: "linear",
      angleDeg: 90,
      stops,
      opacity: 1,
    };
    const raster = rasterizeFillPaint(paint, 100, 20);
    assertNear(pixelAt(raster, 0, 10), [255, 0, 0, 255]);
    assertNear(pixelAt(raster, 99, 10), [0, 0, 255, 255]);
    assertNear(pixelAt(raster, 50, 0), [128, 0, 128, 255]);
    // A horizontal gradient is the same down each column.
    assert.deepEqual(pixelAt(raster, 20, 0), pixelAt(raster, 20, 19));
  });

  it("runs a 0° linear gradient from bottom to top", () => {
    const paint: FillPaint = { kind: "linear", angleDeg: 0, stops, opacity: 1 };
    const raster = rasterizeFillPaint(paint, 20, 100);
    assertNear(pixelAt(raster, 10, 99), [255, 0, 0, 255]);
    assertNear(pixelAt(raster, 10, 0), [0, 0, 255, 255]);
    assertNear(pixelAt(raster, 0, 50), [128, 0, 128, 255]);
    assert.deepEqual(pixelAt(raster, 0, 30), pixelAt(raster, 19, 30));
  });

  it("runs a radial gradient from the centre to the corners", () => {
    const paint: FillPaint = { kind: "radial", stops, opacity: 1 };
    const raster = rasterizeFillPaint(paint, 101, 101);
    assertNear(pixelAt(raster, 50, 50), [255, 0, 0, 255]);
    assertNear(pixelAt(raster, 0, 0), [0, 0, 255, 255]);
    assertNear(pixelAt(raster, 100, 100), [0, 0, 255, 255]);
    // Points at the same distance from the centre match.
    assert.deepEqual(pixelAt(raster, 20, 50), pixelAt(raster, 50, 80));
  });
});

describe("formatFillPaintCss", () => {
  it("formats solids and gradients with the paint's opacity", () => {
    assert.equal(
      formatFillPaintCss({ kind: "solid", color: RED, opacity: 0.5 }),
      "rgba(255,0,0,0.5)",
    );
    assert.equal(
      formatFillPaintCss({
        kind: "linear",
        angleDeg: 45,
        opacity: 1,
        stops: [
          { offset: 0, color: RED },
          { offset: 1, color: BLUE },
        ],
      }),
      "linear-gradient(45deg, rgba(255,0,0,1) 0%, rgba(0,0,255,1) 100%)",
    );
  });
});
