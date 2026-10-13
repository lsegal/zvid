import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findShape, SHAPES } from "./index.ts";

const along = (name: string, x: number, y: number, width = 200, height = 100) =>
  findShape(name).outline?.along(x, y, width, height) ?? [Number.NaN, 0];

const close = (actual: number, expected: number, tolerance = 0.01) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

describe("Shape outlines", () => {
  it("measures every shape but Custom", () => {
    assert.deepEqual(
      SHAPES.filter((shape) => shape.outline).map((shape) => shape.name),
      ["Rectangle", "Oval", "Star", "Arrow"],
    );
  });

  it("runs a Rectangle's edge clockwise from the top's middle, in pixels", () => {
    assert.deepEqual(along("Rectangle", 0.5, 0), [0, 600]);
    assert.deepEqual(along("Rectangle", 1, 0), [100, 600]);
    assert.deepEqual(along("Rectangle", 1, 0.5), [150, 600]);
    assert.deepEqual(along("Rectangle", 0.5, 1), [300, 600]);
    assert.deepEqual(along("Rectangle", 0, 0.5), [450, 600]);
    // A point inside lies along at the edge nearest it.
    assert.deepEqual(along("Rectangle", 0.75, 0.05), [50, 600]);
  });

  it("runs a circle's edge clockwise from its top", () => {
    const circumference = Math.PI * 100;
    const [top, total] = along("Oval", 0.5, 0, 100, 100);
    close(top, 0);
    close(total, circumference);
    close(along("Oval", 1, 0.5, 100, 100)[0], circumference / 4);
    close(along("Oval", 0.5, 1, 100, 100)[0], circumference / 2);
    close(along("Oval", 0, 0.5, 100, 100)[0], (circumference * 3) / 4);
    // Inside the edge, at the same angle.
    close(along("Oval", 0.9, 0.5, 100, 100)[0], circumference / 4);
  });

  it("measures a stretched oval's edge in pixels", () => {
    // Ramanujan's approximation of an ellipse's perimeter.
    const a = 100;
    const b = 50;
    const h = (a - b) ** 2 / (a + b) ** 2;
    const perimeter =
      Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
    const [right, total] = along("Oval", 1, 0.5);
    close(total, perimeter, 0.1);
    close(right, perimeter / 4, 0.1);
  });

  it("runs a Star's edge clockwise from its top point", () => {
    const [top, total] = along("Star", 0.5, 0, 100, 100);
    close(top, 0);
    // The left half mirrors the right, so mirrored points sum to the whole.
    const [rightPoint] = along("Star", 1, 0.382, 100, 100);
    const [leftPoint] = along("Star", 0, 0.382, 100, 100);
    close(rightPoint + leftPoint, total, 0.5);
    assert.ok(rightPoint < total / 2);
  });

  it("runs an Arrow's edge clockwise from its shaft's top-left corner", () => {
    const [start, total] = along("Arrow", 0, 0.3, 100, 100);
    close(start, 0);
    // Shaft 60 + head step 30 + two slants of hypot(40, 50) + step 30 +
    // shaft 60 + tail 40.
    close(total, 60 + 30 + 2 * Math.hypot(40, 50) + 30 + 60 + 40);
    close(along("Arrow", 1, 0.5, 100, 100)[0], 90 + Math.hypot(40, 50));
  });
});
