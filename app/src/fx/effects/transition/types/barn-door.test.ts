import { describe, it } from "node:test";
import { assertColor, BLUE, colorAt, RED } from "../type-test-utils.ts";
import { transitionType } from "./barn-door.ts";

describe("Barn Door transition", () => {
  it("starts on A and ends on B", () => {
    for (const vertical of [false, true]) {
      for (const uv of [
        [0.5, 0.5],
        [0.02, 0.98],
      ] as const) {
        assertColor(colorAt(transitionType, uv, 0, { vertical }), RED);
        assertColor(colorAt(transitionType, uv, 1, { vertical }), BLUE);
      }
    }
  });

  it("opens from the middle out to the sides when Horizontal", () => {
    assertColor(colorAt(transitionType, [0.5, 0.1], 0.5), BLUE);
    assertColor(colorAt(transitionType, [0.05, 0.5], 0.5), RED);
    assertColor(colorAt(transitionType, [0.95, 0.5], 0.5), RED);
  });

  it("opens from the middle to the top and bottom when Vertical", () => {
    const vertical = { vertical: true };
    assertColor(colorAt(transitionType, [0.1, 0.5], 0.5, vertical), BLUE);
    assertColor(colorAt(transitionType, [0.5, 0.05], 0.5, vertical), RED);
    assertColor(colorAt(transitionType, [0.5, 0.95], 0.5, vertical), RED);
  });
});
