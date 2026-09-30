import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IDENTITY_TRANSFORM,
  isIdentityTransform,
  type LayerTransform,
} from "../../../composition-transform.ts";
import {
  type LayerMove,
  parseLayerMove,
  resolveMoveTransform,
} from "./move.ts";

function transform(overrides: Partial<LayerTransform>): LayerTransform {
  return { ...IDENTITY_TRANSFORM, ...overrides };
}

describe("Move", () => {
  const start = transform({
    positionX: -0.5,
    positionY: 0.25,
    scaleX: 0.5,
    scaleY: 2,
    originX: -1,
    originY: 1,
    rotationDeg: -90,
  });
  const end = transform({
    positionX: 0.5,
    positionY: -0.25,
    scaleX: 1.5,
    scaleY: 1,
    originX: 1,
    originY: -1,
    rotationDeg: 90,
  });
  const linear: LayerMove = { start, end, motion: "Linear" };

  it("reads Start and End by Transform's keys, and the Motion curve", () => {
    const move = parseLayerMove([
      { key: "Motion", value: "Ease Out" },
      { key: "StartPositionX", value: "-0.5", numericValue: -0.5 },
      { key: "EndScaleY", value: "3" },
      { key: "EndRotation", value: "999" },
      { key: "PositionX", value: "1" },
    ]);
    assert.equal(move.motion, "Ease Out");
    assert.deepEqual(move.start, transform({ positionX: -0.5 }));
    // Clamped to Transform's range.
    assert.deepEqual(move.end, transform({ scaleY: 3, rotationDeg: 180 }));
  });

  it("defaults to the identity at both ends, eased in and out", () => {
    const move = parseLayerMove([]);
    assert.deepEqual(move, {
      start: IDENTITY_TRANSFORM,
      end: IDENTITY_TRANSFORM,
      motion: "Ease In Out",
    });
    assert.ok(isIdentityTransform(resolveMoveTransform(move, 0.5)));
  });

  it("gives exactly Start at the clip's start and End at its end", () => {
    for (const motion of ["Linear", "Ease In", "Ease Out", "Ease In Out"]) {
      const move = { ...linear, motion } as LayerMove;
      assert.deepEqual(resolveMoveTransform(move, 0), start, motion);
      assert.deepEqual(resolveMoveTransform(move, 1), end, motion);
    }
  });

  it("gives the midpoints halfway through a Linear Move", () => {
    assert.deepEqual(resolveMoveTransform(linear, 0.5), {
      positionX: 0,
      positionY: 0,
      scaleX: 1,
      scaleY: 1.5,
      originX: 0,
      originY: 0,
      rotationDeg: 0,
    });
  });

  it("lags linear halfway through with Ease In and leads it with Ease Out", () => {
    const at = (motion: LayerMove["motion"]) =>
      resolveMoveTransform({ ...linear, motion }, 0.5).positionX;
    assert.ok(at("Ease In") < at("Linear"));
    assert.ok(at("Ease Out") > at("Linear"));
    assert.equal(at("Ease In Out"), at("Linear"));
  });
});
