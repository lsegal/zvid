import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SHAPE, findShape, SHAPES, shapeIndex } from "./index.ts";

const inside = (name: string, x: number, y: number) =>
  findShape(name).distance(x, y) < 0;

// A point on the edge sits between an inside point just before it and an
// outside point just past it.
function assertEdge(
  name: string,
  from: [number, number],
  edge: [number, number],
) {
  const shape = findShape(name);
  const step = 0.01;
  const dx = edge[0] - from[0];
  const dy = edge[1] - from[1];
  const length = Math.hypot(dx, dy);
  const before = shape.distance(
    edge[0] - (dx / length) * step,
    edge[1] - (dy / length) * step,
  );
  const after = shape.distance(
    edge[0] + (dx / length) * step,
    edge[1] + (dy / length) * step,
  );
  assert.ok(before < 0, `${name} inside before ${edge}`);
  assert.ok(after > 0, `${name} outside past ${edge}`);
  assert.ok(Math.abs(shape.distance(...edge)) < 1e-6, `${name} edge ${edge}`);
}

describe("Shape registry", () => {
  it("lists Rectangle, Oval, Star, Arrow and Custom", () => {
    assert.deepEqual(
      SHAPES.map((shape) => shape.name),
      ["Rectangle", "Oval", "Star", "Arrow", "Custom"],
    );
  });

  it("finds shapes by name, falling back to the default", () => {
    assert.equal(findShape("oval").name, "Oval");
    assert.equal(findShape(" Star ").name, "Star");
    assert.equal(findShape("Hexagon"), DEFAULT_SHAPE);
    assert.equal(findShape(undefined), DEFAULT_SHAPE);
    assert.equal(shapeIndex("Arrow"), 3);
  });

  it("gives every shape a preview path", () => {
    for (const shape of SHAPES) {
      assert.match(shape.previewPath, /^M[\d. ]+.*Z$/);
    }
  });
});

describe("Rectangle", () => {
  it("fills the whole box", () => {
    assert.ok(inside("Rectangle", 0.5, 0.5));
    assert.ok(inside("Rectangle", 0.01, 0.99));
    assert.ok(!inside("Rectangle", -0.01, 0.5));
    assert.ok(!inside("Rectangle", 0.5, 1.01));
    assertEdge("Rectangle", [0.5, 0.5], [1, 0.5]);
    assertEdge("Rectangle", [0.5, 0.5], [0.5, 0]);
  });
});

describe("Oval", () => {
  it("is the ellipse inscribed in the box", () => {
    assert.ok(inside("Oval", 0.5, 0.5));
    assert.ok(inside("Oval", 0.02, 0.5));
    // The box's corners are outside the ellipse.
    assert.ok(!inside("Oval", 0.05, 0.05));
    assert.ok(!inside("Oval", 0.95, 0.95));
    assertEdge("Oval", [0.5, 0.5], [0, 0.5]);
    assertEdge("Oval", [0.5, 0.5], [0.5, 1]);
    const diagonal = 0.5 + 0.5 * Math.SQRT1_2;
    assertEdge("Oval", [0.5, 0.5], [diagonal, diagonal]);
  });
});

describe("Star", () => {
  it("points up and touches every edge of the box", () => {
    assert.ok(inside("Star", 0.5, 0.5));
    // Its points reach the top, left, right and bottom edges.
    assertEdge("Star", [0.5, 0.5], [0.5, 0]);
    assert.ok(inside("Star", 0.06, 0.4));
    assert.ok(inside("Star", 0.94, 0.4));
    assert.ok(inside("Star", 0.22, 0.95));
    assert.ok(inside("Star", 0.78, 0.95));
  });

  it("leaves the gaps between its points clear", () => {
    assert.ok(!inside("Star", 0.05, 0.05));
    assert.ok(!inside("Star", 0.95, 0.05));
    // Between the two bottom points.
    assert.ok(!inside("Star", 0.5, 0.95));
    assert.ok(!inside("Star", 0.05, 0.8));
  });
});

describe("Arrow", () => {
  it("points right with a shaft and a head", () => {
    // Shaft.
    assert.ok(inside("Arrow", 0.1, 0.5));
    assert.ok(!inside("Arrow", 0.1, 0.2));
    assertEdge("Arrow", [0.1, 0.5], [0.1, 0.3]);
    assertEdge("Arrow", [0.3, 0.5], [0, 0.5]);
    // Head.
    assert.ok(inside("Arrow", 0.62, 0.1));
    assert.ok(inside("Arrow", 0.95, 0.5));
    assert.ok(!inside("Arrow", 0.95, 0.2));
    assertEdge("Arrow", [0.8, 0.5], [1, 0.5]);
  });
});
