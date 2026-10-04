import { describe, it } from "node:test";
import type { Vec2 } from "../type.ts";
import { assertColor, BLUE, colorAt, RED } from "../type-test-utils.ts";
import { transitionType } from "./split.ts";

// Comp A shaded by where it is sampled, to see which part of it moved.
const shadedA = { a: (uv: Vec2) => [uv[0], uv[1], 0, 1] as const };

describe("Split transition", () => {
  it("starts on A and ends on B", () => {
    for (const vertical of [false, true]) {
      for (const uv of [
        [0.3, 0.2],
        [0.7, 0.8],
      ] as const) {
        assertColor(colorAt(transitionType, uv, 0, { vertical }), RED);
        assertColor(colorAt(transitionType, uv, 1, { vertical }), BLUE);
      }
    }
  });

  it("slides the halves out to the sides when Horizontal", () => {
    assertColor(colorAt(transitionType, [0.5, 0.5], 0.5), BLUE);
    assertColor(colorAt(transitionType, [0.3, 0.5], 0.5), BLUE);
    // The left half has moved a quarter of the picture left.
    assertColor(
      colorAt(transitionType, [0.1, 0.5], 0.5, shadedA),
      [0.35, 0.5, 0, 1],
    );
    assertColor(
      colorAt(transitionType, [0.9, 0.5], 0.5, shadedA),
      [0.65, 0.5, 0, 1],
    );
  });

  it("slides the halves to the top and bottom when Vertical", () => {
    const vertical = { ...shadedA, vertical: true };
    assertColor(colorAt(transitionType, [0.5, 0.5], 0.5, vertical), BLUE);
    assertColor(
      colorAt(transitionType, [0.5, 0.1], 0.5, vertical),
      [0.5, 0.35, 0, 1],
    );
    assertColor(
      colorAt(transitionType, [0.5, 0.9], 0.5, vertical),
      [0.5, 0.65, 0, 1],
    );
  });
});
