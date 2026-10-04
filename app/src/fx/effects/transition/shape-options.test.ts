import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTransitionSettings } from "./transition.ts";

function settings(values: Record<string, string>) {
  return parseTransitionSettings(
    Object.entries(values).map(([key, value]) => ({ key, value })),
    0.5,
  );
}

describe("Transition shape options", () => {
  it("defaults to Iris Out, Horizontal, 8 and Center", () => {
    const parsed = settings({ Type: "Iris" });
    assert.equal(parsed.irisIn, false);
    assert.equal(parsed.vertical, false);
    assert.equal(parsed.count, 8);
    assert.deepEqual(parsed.origin, [0.5, 0.5]);
  });

  it("reads Iris, Orientation and Origin case-insensitively", () => {
    const parsed = settings({
      Iris: "in",
      Orientation: "VERTICAL",
      Origin: "top right",
    });
    assert.equal(parsed.irisIn, true);
    assert.equal(parsed.vertical, true);
    assert.deepEqual(parsed.origin, [1, 1]);
  });

  it("falls back for values it does not know", () => {
    const parsed = settings({ Iris: "Sideways", Origin: "Middle", Count: "x" });
    assert.equal(parsed.irisIn, false);
    assert.deepEqual(parsed.origin, [0.5, 0.5]);
    assert.equal(parsed.count, 8);
  });

  it("rounds Count to a whole number within its range", () => {
    assert.equal(settings({ Count: "5.6" }).count, 6);
    assert.equal(settings({ Count: "0" }).count, 2);
    assert.equal(settings({ Count: "500" }).count, 32);
  });
});
