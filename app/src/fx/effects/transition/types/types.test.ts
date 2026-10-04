import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findTransitionType, TRANSITION_TYPES } from "../registry.ts";
import {
  type Rgba,
  TRANSPARENT,
  type TransitionInput,
  type Vec2,
} from "../type.ts";

// Comp A is red and comp B blue, opaque inside the picture.
const RED: Rgba = [1, 0, 0, 1];
const BLUE: Rgba = [0, 0, 1, 1];
const inside = ([x, y]: Vec2) => x >= 0 && y >= 0 && x <= 1 && y <= 1;

function input(direction: Vec2 = [-1, 0], softness = 0): TransitionInput {
  return {
    a: (uv) => (inside(uv) ? RED : TRANSPARENT),
    b: (uv) => (inside(uv) ? BLUE : TRANSPARENT),
    direction,
    softness,
    irisIn: false,
    vertical: false,
    count: 8,
    origin: [0.5, 0.5],
    resolution: [320, 180],
  };
}

function render(name: string, uv: Vec2, p: number, settings = input()) {
  const type = findTransitionType(name);
  assert.equal(type.name, name);
  return type.render(settings, uv, p).map((value) => +value.toFixed(6));
}

// Points across the picture, in from its edges.
const POINTS: Vec2[] = [0.05, 0.3, 0.5, 0.7, 0.95].flatMap((x) =>
  [0.05, 0.5, 0.95].map((y): Vec2 => [x, y]),
);

describe("Transition types", () => {
  it("show comp A at the start and comp B at the end", () => {
    for (const type of TRANSITION_TYPES) {
      for (const uv of POINTS) {
        assert.deepEqual(render(type.name, uv, 0), RED, `${type.name} ${uv}`);
        assert.deepEqual(render(type.name, uv, 1), BLUE, `${type.name} ${uv}`);
      }
    }
  });

  it("Fade is black halfway", () => {
    for (const uv of POINTS) {
      assert.deepEqual(render("Fade", uv, 0.5), [0, 0, 0, 1]);
    }
    assert.deepEqual(render("Fade", [0.5, 0.5], 0.25), [0.5, 0, 0, 1]);
  });

  it("Dissolve is an even mix halfway", () => {
    assert.deepEqual(render("Dissolve", [0.3, 0.5], 0.5), [0.5, 0, 0.5, 1]);
  });

  it("Dissolve (Noise) shows A in some pixels and B in others halfway", () => {
    const colors = new Set<string>();
    for (let x = 0; x < 32; x += 1) {
      for (let y = 0; y < 8; y += 1) {
        colors.add(
          render("Dissolve (Noise)", [(x + 0.5) / 320, (y + 0.5) / 180], 0.5)
            .map(String)
            .join(),
        );
      }
    }
    assert.deepEqual([...colors].sort(), [BLUE.join(), RED.join()].sort());
  });

  it("Push moves both comps edge to edge", () => {
    // Moving left, A is in the left half and B in the right.
    assert.deepEqual(render("Push", [0.25, 0.5], 0.5), RED);
    assert.deepEqual(render("Push", [0.75, 0.5], 0.5), BLUE);
    // Moving up, B comes in from the bottom.
    const up = input([0, 1]);
    assert.deepEqual(render("Push", [0.5, 0.75], 0.5, up), RED);
    assert.deepEqual(render("Push", [0.5, 0.25], 0.5, up), BLUE);
  });

  it("Swipe leaves a gap between A and B following it", () => {
    assert.deepEqual(render("Swipe", [0.1, 0.5], 0.5), RED);
    assert.deepEqual(render("Swipe", [0.5, 0.5], 0.5), [0, 0, 0, 0]);
    assert.deepEqual(render("Swipe", [0.9, 0.5], 0.5), BLUE);
  });

  it("Reveal slides A away over a still B", () => {
    assert.deepEqual(render("Reveal", [0.25, 0.5], 0.5), RED);
    assert.deepEqual(render("Reveal", [0.75, 0.5], 0.5), BLUE);
    const right = input([1, 0]);
    assert.deepEqual(render("Reveal", [0.25, 0.5], 0.5, right), BLUE);
    assert.deepEqual(render("Reveal", [0.75, 0.5], 0.5, right), RED);
  });

  it("Cover slides B in over a still A", () => {
    assert.deepEqual(render("Cover", [0.25, 0.5], 0.5), RED);
    assert.deepEqual(render("Cover", [0.75, 0.5], 0.5), BLUE);
    const down = input([0, -1]);
    assert.deepEqual(render("Cover", [0.5, 0.75], 0.5, down), BLUE);
    assert.deepEqual(render("Cover", [0.5, 0.25], 0.5, down), RED);
  });

  it("Wipe sweeps a hard or soft edge across", () => {
    assert.deepEqual(render("Wipe", [0.25, 0.5], 0.5), RED);
    assert.deepEqual(render("Wipe", [0.75, 0.5], 0.5), BLUE);
    // A soft edge blends A and B around the edge.
    const soft = render("Wipe", [0.5, 0.5], 0.5, input([-1, 0], 1));
    assert.ok(soft[0] > 0 && soft[2] > 0, `${soft}`);
  });

  it("Zoom shrinks A out as B grows in, both half faded", () => {
    assert.deepEqual(render("Zoom", [0.5, 0.5], 0.5), [0.5, 0, 0.25, 0.75]);
    // Neither covers the corners yet.
    assert.deepEqual(render("Zoom", [0.05, 0.5], 0.5), [0, 0, 0, 0]);
  });
});
