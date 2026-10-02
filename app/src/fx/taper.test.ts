import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { taperPosition, taperValue } from "./taper.ts";

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

describe("knob taper", () => {
  it("spreads a linear range evenly", () => {
    close(taperPosition(5, 0, 10), 0.5);
    close(taperValue(0.25, -10, 10), -5);
    close(taperPosition(20, 0, 10), 1);
  });

  it("spreads a log range by ratio: each decade takes the same travel", () => {
    close(taperPosition(200, 20, 20_000, "log"), 1 / 3);
    close(taperPosition(2000, 20, 20_000, "log"), 2 / 3);
    close(taperValue(0.5, 20, 20_000, "log"), 20 * Math.sqrt(1000));
    close(
      taperValue(taperPosition(440, 20, 20_000, "log"), 20, 20_000, "log"),
      440,
    );
  });

  it("clamps to the range", () => {
    close(taperPosition(1, 20, 20_000, "log"), 0);
    close(taperValue(2, 20, 20_000, "log"), 20_000);
  });

  it("falls back to linear for a range a log taper cannot span", () => {
    close(taperPosition(5, 0, 10, "log"), 0.5);
    close(taperValue(0.5, -1, 1, "log"), 0);
  });
});
