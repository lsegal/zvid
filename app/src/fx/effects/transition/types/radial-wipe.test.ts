import { describe, it } from "node:test";
import {
  assertColor,
  BLUE,
  CENTER,
  CORNERS,
  colorAt,
  RED,
} from "../type-test-utils.ts";
import { transitionType } from "./radial-wipe.ts";

describe("Radial Wipe transition", () => {
  it("starts on A and ends on B from every origin", () => {
    for (const origin of [
      [0.5, 0.5],
      [0, 0],
      [1, 1],
    ] as const) {
      for (const uv of [CENTER, ...CORNERS]) {
        assertColor(
          colorAt(transitionType, uv, 0, { origin, softness: 0.5 }),
          RED,
        );
        assertColor(
          colorAt(transitionType, uv, 1, { origin, softness: 0.5 }),
          BLUE,
        );
      }
    }
  });

  it("spreads from the center", () => {
    assertColor(colorAt(transitionType, CENTER, 0.5), BLUE);
    for (const uv of CORNERS) {
      assertColor(colorAt(transitionType, uv, 0.5), RED);
    }
  });

  it("spreads from a corner", () => {
    const bottomLeft = { origin: [0, 0] as const };
    assertColor(colorAt(transitionType, [0.05, 0.05], 0.5, bottomLeft), BLUE);
    assertColor(colorAt(transitionType, [0.95, 0.95], 0.5, bottomLeft), RED);
  });
});
