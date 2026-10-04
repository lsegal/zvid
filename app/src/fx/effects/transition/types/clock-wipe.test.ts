import { describe, it } from "node:test";
import {
  assertColor,
  BLUE,
  CORNERS,
  colorAt,
  RED,
} from "../type-test-utils.ts";
import { transitionType } from "./clock-wipe.ts";

describe("Clock Wipe transition", () => {
  it("starts on A and ends on B", () => {
    for (const uv of CORNERS) {
      assertColor(colorAt(transitionType, uv, 0), RED);
      assertColor(colorAt(transitionType, uv, 1), BLUE);
    }
  });

  it("sweeps clockwise from twelve o'clock", () => {
    // Halfway, the hand points to six: the right half is B, the left is A.
    assertColor(colorAt(transitionType, [0.9, 0.5], 0.5), BLUE);
    assertColor(colorAt(transitionType, [0.5, 0.9], 0.5), BLUE);
    assertColor(colorAt(transitionType, [0.1, 0.5], 0.5), RED);
    assertColor(colorAt(transitionType, [0.1, 0.9], 0.5), RED);
    // A quarter in, it has passed three but not six.
    assertColor(colorAt(transitionType, [0.9, 0.6], 0.3), BLUE);
    assertColor(colorAt(transitionType, [0.6, 0.1], 0.3), RED);
  });
});
