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
      waypoints: [],
      path: "Curve",
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

  it("reads waypoints up to the Waypoints count, and the Path", () => {
    const move = parseLayerMove([
      { key: "Waypoints", value: "2" },
      { key: "Path", value: "lines" },
      { key: "Point1PositionX", value: "0.25" },
      { key: "Point2Rotation", value: "45" },
      { key: "Point2ScaleX", value: "99" },
      { key: "Point3PositionY", value: "1" },
    ]);
    assert.equal(move.path, "Lines");
    assert.deepEqual(move.waypoints, [
      transform({ positionX: 0.25 }),
      transform({ rotationDeg: 45, scaleX: 8 }),
    ]);
    assert.equal(parseLayerMove([{ key: "Waypoints", value: "9" }]).waypoints?.length, 4);
    assert.equal(parseLayerMove([{ key: "Waypoints", value: "x" }]).waypoints?.length, 0);
  });

  it("matches a plain Start to End Move exactly with zero waypoints", () => {
    for (const motion of ["Linear", "Ease In", "Ease Out", "Ease In Out"]) {
      const plain = { ...linear, motion } as LayerMove;
      const parsed = { ...plain, waypoints: [], path: "Curve" } as LayerMove;
      for (let step = 0; step <= 40; step += 1) {
        assert.deepEqual(
          resolveMoveTransform(parsed, step / 40),
          resolveMoveTransform(plain, step / 40),
        );
      }
    }
  });

  describe("with waypoints", () => {
    const first = transform({ positionX: 0.5, positionY: 0.5, scaleX: 2, rotationDeg: 30 });
    const second = transform({ positionX: -0.5, positionY: -0.5, scaleX: 0.5, rotationDeg: -30 });
    const path = (pathKind: "Lines" | "Curve"): LayerMove => ({
      ...linear,
      waypoints: [first, second],
      path: pathKind,
    });

    function assertTransformClose(actual: LayerTransform, expected: LayerTransform) {
      for (const field of Object.keys(expected) as Array<keyof LayerTransform>) {
        assert.ok(
          Math.abs(actual[field] - expected[field]) < 1e-9,
          `${field}: ${actual[field]} != ${expected[field]}`,
        );
      }
    }

    it("passes through each waypoint, taking an equal share of the clip per leg", () => {
      for (const kind of ["Lines", "Curve"] as const) {
        assert.deepEqual(resolveMoveTransform(path(kind), 0), start, kind);
        assertTransformClose(resolveMoveTransform(path(kind), 1 / 3), first);
        assertTransformClose(resolveMoveTransform(path(kind), 2 / 3), second);
        assert.deepEqual(resolveMoveTransform(path(kind), 1), end, kind);
      }
    });

    it("runs in straight lines between waypoints on a Lines path", () => {
      const halfway = resolveMoveTransform(path("Lines"), 0.5);
      assertTransformClose(halfway, {
        positionX: 0,
        positionY: 0,
        scaleX: 1.25,
        scaleY: 1,
        originX: 0,
        originY: 0,
        rotationDeg: 0,
      });
    });

    it("bends only the position smoothly through waypoints on a Curve path", () => {
      const lines = resolveMoveTransform(path("Lines"), 1 / 6);
      const curve = resolveMoveTransform(path("Curve"), 1 / 6);
      assert.notEqual(curve.positionX, lines.positionX);
      assert.notEqual(curve.positionY, lines.positionY);
      for (const field of ["scaleX", "scaleY", "originX", "originY", "rotationDeg"] as const) {
        assert.ok(Math.abs(curve[field] - lines[field]) < 1e-12, field);
      }
      // No kink at a waypoint: the position's velocity matches either side.
      const h = 1e-6;
      const at = (p: number) => resolveMoveTransform(path("Curve"), p).positionX;
      const before = (at(1 / 3) - at(1 / 3 - h)) / h;
      const after = (at(1 / 3 + h) - at(1 / 3)) / h;
      assert.ok(Math.abs(before - after) < 1e-3, `${before} != ${after}`);
    });

    it("eases progress along the whole path rather than each leg", () => {
      const eased = { ...path("Lines"), motion: "Ease In Out" } as LayerMove;
      // Halfway through the clip is halfway along the path on a symmetric
      // curve, and the clip does not stop at the first waypoint.
      assertTransformClose(resolveMoveTransform(eased, 0.5), resolveMoveTransform(path("Lines"), 0.5));
      const h = 1e-4;
      const near = resolveMoveTransform(eased, 0.36).positionX;
      const nearer = resolveMoveTransform(eased, 0.36 + h).positionX;
      assert.ok(Math.abs(nearer - near) > 1e-4);
    });
  });
});
