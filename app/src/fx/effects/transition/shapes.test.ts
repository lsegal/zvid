import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BOX, CIRCLE, DIAMOND, HEART, STAR, sweep } from "./shapes.ts";
import type { Vec2 } from "./type.ts";

function polar(radius: number, degreesFromUp: number): Vec2 {
  const angle = (degreesFromUp * Math.PI) / 180;
  return [radius * Math.sin(angle), radius * Math.cos(angle)];
}

function near(actual: number, expected: number, tolerance = 1e-3) {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `expected ${expected}, got ${actual}`,
  );
}

describe("iris shapes", () => {
  it("puts the outline of each unit shape where it belongs", () => {
    near(CIRCLE.gauge(polar(1, 37)), 1);
    near(BOX.gauge([1, 1]), 1);
    near(BOX.gauge([0.5, -1]), 1);
    near(DIAMOND.gauge([0.5, 0.5]), 1);
    near(DIAMOND.gauge([0, -1]), 1);
  });

  it("draws a star with a point up and inner corners between points", () => {
    near(STAR.gauge(polar(1, 0)), 1);
    near(STAR.gauge(polar(1, 72)), 1);
    near(STAR.gauge(polar(0.45, 36)), 1);
    // At the same distance, a point is inside and the gap beside it is not.
    assert.ok(STAR.gauge(polar(0.8, 0)) < 1);
    assert.ok(STAR.gauge(polar(0.8, 36)) > 1);
  });

  it("draws a heart with its lobes up and its tip down", () => {
    near(HEART.gauge([0, 1]), 1, 1e-3);
    near(HEART.gauge([0, -1]), 1, 1e-3);
    // The lobes reach farther out than the dip between them.
    assert.ok(HEART.gauge(polar(1.2, 40)) < 1);
    assert.ok(HEART.gauge(polar(1.2, 0)) > 1);
  });

  it("keeps every shape at least its minimum radius from the center", () => {
    for (const shape of [CIRCLE, BOX, DIAMOND, STAR, HEART]) {
      for (let degrees = 0; degrees < 360; degrees += 3) {
        assert.ok(shape.gauge(polar(shape.minRadius, degrees)) <= 1 + 1e-3);
      }
    }
  });
});

describe("sweep", () => {
  it("shows none of B at the start and all of it at the end", () => {
    for (const t of [0, 0.5, 1]) {
      assert.equal(sweep(t, 0, 0.2), 0);
      assert.equal(sweep(t, 1, 0.2), 1);
    }
  });

  it("softens the edge over its width", () => {
    const middle = sweep(0.5, 0.5, 0.2);
    assert.ok(middle > 0 && middle < 1);
    assert.equal(sweep(0.1, 0.5, 0.2), 1);
    assert.equal(sweep(0.9, 0.5, 0.2), 0);
  });
});
