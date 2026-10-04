import { describe, it } from "node:test";
import { assertColor, BLUE, colorAt, RED } from "../type-test-utils.ts";
import { transitionType } from "./blinds.ts";

describe("Blinds transition", () => {
  it("starts on A and ends on B", () => {
    for (const vertical of [false, true]) {
      for (const uv of [
        [0.3, 0.1],
        [0.7, 0.95],
      ] as const) {
        assertColor(colorAt(transitionType, uv, 0, { vertical }), RED);
        assertColor(colorAt(transitionType, uv, 1, { vertical }), BLUE);
      }
    }
  });

  it("closes B over each horizontal slat from its top", () => {
    for (let slat = 0; slat < 8; slat++) {
      const top = colorAt(transitionType, [0.5, (slat + 0.9) / 8], 0.5);
      const bottom = colorAt(transitionType, [0.5, (slat + 0.1) / 8], 0.5);
      assertColor(top, BLUE, `slat ${slat} top`);
      assertColor(bottom, RED, `slat ${slat} bottom`);
    }
  });

  it("closes B over each vertical slat from its left, Count of them", () => {
    for (let slat = 0; slat < 4; slat++) {
      const options = { vertical: true, count: 4 };
      const left = colorAt(
        transitionType,
        [(slat + 0.1) / 4, 0.5],
        0.5,
        options,
      );
      const right = colorAt(
        transitionType,
        [(slat + 0.9) / 4, 0.5],
        0.5,
        options,
      );
      assertColor(left, BLUE, `slat ${slat} left`);
      assertColor(right, RED, `slat ${slat} right`);
    }
  });
});
