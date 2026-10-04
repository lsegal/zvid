import { describe, it } from "node:test";
import { BLACK, type Vec2 } from "../type.ts";
import { assertColor, BLUE, colorAt, RED } from "../type-test-utils.ts";
import { transitionType } from "./checkerboard.ts";

// Count 8 across 1080 px makes 135 px squares.
function cell(column: number, row: number, x = 0.5): Vec2 {
  return [((column + x) * 135) / 1080, ((row + 0.5) * 135) / 1920];
}

describe("Checkerboard transition", () => {
  it("starts on A and ends on B", () => {
    for (let column = 0; column < 8; column++) {
      for (const row of [0, 5, 13]) {
        assertColor(colorAt(transitionType, cell(column, row), 0), RED);
        assertColor(colorAt(transitionType, cell(column, row), 1), BLUE);
      }
    }
  });

  it("flips one color first, left to right, then the other", () => {
    // Halfway, the first color's left squares have turned over...
    assertColor(colorAt(transitionType, cell(0, 0), 0.5), BLUE);
    assertColor(colorAt(transitionType, cell(1, 1), 0.5), BLUE);
    // ...its right squares are on edge, showing black around them...
    assertColor(colorAt(transitionType, cell(6, 0, 0.5), 0.5), BLUE);
    assertColor(colorAt(transitionType, cell(6, 0, 0.05), 0.5), BLACK);
    // ...and the other color has barely started.
    assertColor(colorAt(transitionType, cell(1, 0), 0.5), RED);
    assertColor(colorAt(transitionType, cell(7, 0), 0.5), RED);
  });

  it("makes Count squares across", () => {
    const four = { count: 4 };
    // 270 px squares: x 0.3 is in the second column, the other color.
    assertColor(colorAt(transitionType, [0.1, 0.05], 0.3, four), BLUE);
    assertColor(colorAt(transitionType, [0.375, 0.05], 0.3, four), RED);
  });
});
