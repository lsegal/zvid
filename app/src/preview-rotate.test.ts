import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type BoxCorners,
  IDENTITY_TRANSFORM,
  layerBoxInCanvas,
} from "./composition-transform.ts";
import type { SessionEffect } from "./fx-stack.ts";
import {
  findLayerTransform,
  readLayerTransformPosition,
  setLayerTransformPosition,
} from "./preview-edit.ts";
import {
  formatRotation,
  isInRotateZone,
  isOnRotationHandle,
  isPointInQuad,
  layerOriginInCanvas,
  ROTATION_HANDLE_OFFSET_PX,
  readLayerTransformRotation,
  rotateTransform,
  rotationHandleGeometry,
  setLayerTransformRotation,
  wrapRotation,
} from "./preview-rotate.ts";

const EPSILON = 1e-9;

function assertClose(actual: number, expected: number) {
  assert.ok(
    Math.abs(actual - expected) < EPSILON,
    `expected ${actual} to be close to ${expected}`,
  );
}

const canvas = { width: 1000, height: 1000 };
const fullFrame = {
  frame: { centerX: 0, centerY: 0, halfWidth: 1, halfHeight: 1, aspect: 1 },
};

// Turns a pointer 100px from the centre by `turnDeg`, clockwise, starting
// from `startDeg`.
function rotateBy(startDeg: number, turnDeg: number, snap15 = false) {
  const origin = { x: 500, y: 500 };
  const radians = (turnDeg * Math.PI) / 180;
  return rotateTransform(
    { ...IDENTITY_TRANSFORM, rotationDeg: startDeg },
    origin,
    { x: 600, y: 500 },
    {
      x: origin.x + 100 * Math.cos(radians),
      y: origin.y + 100 * Math.sin(radians),
    },
    { snap15 },
  ).rotationDeg;
}

describe("rotateTransform", () => {
  it("turns the layer about its centre by the pointer's angle", () => {
    const origin = layerOriginInCanvas(
      { placement: fullFrame, transform: IDENTITY_TRANSFORM },
      canvas,
    );
    assert.deepEqual(origin, { x: 500, y: 500 });

    // From straight above the centre to straight right of it: a quarter turn
    // clockwise, which brings the top-left corner to the top-right.
    const next = rotateTransform(
      IDENTITY_TRANSFORM,
      origin,
      { x: 500, y: 0 },
      { x: 1000, y: 500 },
    );
    assertClose(next.rotationDeg, 90);
    assert.equal(next.positionX, 0);
    assert.equal(next.positionY, 0);
    const corners = layerBoxInCanvas(fullFrame, next, canvas);
    assertClose(corners[0].x, 1000);
    assertClose(corners[0].y, 0);
  });

  it("pivots on an off-centre origin, which stays put", () => {
    // Origin at the box's top-left corner, with the box halved and moved
    // right 10%.
    const start = {
      ...IDENTITY_TRANSFORM,
      originX: -1,
      originY: -1,
      positionX: 0.1,
      scaleX: 0.5,
      scaleY: 0.5,
    };
    const origin = layerOriginInCanvas(
      { placement: fullFrame, transform: start },
      canvas,
    );
    assert.deepEqual(origin, { x: 100, y: 0 });

    const next = rotateTransform(
      start,
      origin,
      { x: 200, y: 0 },
      { x: 100, y: 100 },
    );
    assertClose(next.rotationDeg, 90);
    assert.equal(next.positionX, start.positionX);
    // The top-left corner is the origin and does not move; the top-right one
    // swings from right of it to below it.
    const corners = layerBoxInCanvas(fullFrame, next, canvas);
    assertClose(corners[0].x, 100);
    assertClose(corners[0].y, 0);
    assertClose(corners[1].x, 100);
    assertClose(corners[1].y, 500);
    assert.deepEqual(
      layerOriginInCanvas({ placement: fullFrame, transform: next }, canvas),
      origin,
    );
  });

  it("adds to the start rotation and wraps into -180..180", () => {
    assertClose(rotateBy(30, 20), 50);
    assertClose(rotateBy(170, 20), -170);
    assertClose(rotateBy(-170, -20), 170);
    assert.equal(wrapRotation(-180), 180);
    assert.equal(wrapRotation(540), 180);
    assert.equal(wrapRotation(-450), -90);
  });

  it("snaps to 15 degree steps with Shift", () => {
    assertClose(rotateBy(0, 32, true), 30);
    assertClose(rotateBy(0, 38, true), 45);
    assertClose(rotateBy(10, -17, true), 0);
    assertClose(rotateBy(170, 16, true), 180);
  });

  it("softly snaps onto right angles within 3 degrees", () => {
    assertClose(rotateBy(0, 88), 90);
    assertClose(rotateBy(0, 86), 86);
    assertClose(rotateBy(0, -2.5), 0);
    assertClose(rotateBy(0, -92), -90);
    assertClose(rotateBy(0, 178), 180);
    assertClose(rotateBy(0, -178), 180);
    assertClose(rotateBy(0, 4), 4);
  });

  it("formats the angle readout", () => {
    assert.equal(formatRotation(32.46), "32.5°");
    assert.equal(formatRotation(15), "15°");
    assert.equal(formatRotation(-90), "-90°");
    assert.equal(formatRotation(-0.04), "0°");
  });
});

describe("rotation handle and zones", () => {
  const square: BoxCorners = [
    { x: 100, y: 100 },
    { x: 300, y: 100 },
    { x: 300, y: 300 },
    { x: 100, y: 300 },
  ];

  it("puts the handle above the top edge's midpoint", () => {
    const { stemStart, handle } = rotationHandleGeometry(square);
    assert.deepEqual(stemStart, { x: 200, y: 100 });
    assert.deepEqual(handle, { x: 200, y: 100 - ROTATION_HANDLE_OFFSET_PX });
    assert.equal(isOnRotationHandle({ x: 203, y: 78 }, square), true);
    assert.equal(isOnRotationHandle({ x: 200, y: 110 }, square), false);
  });

  it("follows the box's rotation", () => {
    // The same square turned a quarter clockwise: its top edge is now on the
    // right, so the handle points right.
    const turned: BoxCorners = [square[1], square[2], square[3], square[0]];
    const { handle } = rotationHandleGeometry(turned);
    assertClose(handle.x, 300 + ROTATION_HANDLE_OFFSET_PX);
    assertClose(handle.y, 200);
  });

  it("rotates just outside a corner, but not inside the box", () => {
    assert.equal(isInRotateZone({ x: 88, y: 88 }, square), true);
    assert.equal(isInRotateZone({ x: 312, y: 305 }, square), true);
    assert.equal(isInRotateZone({ x: 110, y: 110 }, square), false);
    assert.equal(isInRotateZone({ x: 70, y: 70 }, square), false);
    assert.equal(isInRotateZone({ x: 200, y: 90 }, square), false);
  });

  it("tests points against a turned quad", () => {
    const diamond: BoxCorners = [
      { x: 0, y: -10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
      { x: -10, y: 0 },
    ];
    assert.equal(isPointInQuad({ x: 0, y: 0 }, diamond), true);
    assert.equal(isPointInQuad({ x: 8, y: 8 }, diamond), false);
    assert.equal(isPointInQuad({ x: 10, y: 0 }, diamond), true);
  });
});

describe("setLayerTransformRotation", () => {
  const base: SessionEffect[] = [
    {
      id: "layout-a",
      trackId: "a",
      effectName: "Layout",
      parameters: [],
      enabled: true,
    },
  ];

  it("adds a Transform if needed and writes a wrapped Rotation", () => {
    const next = setLayerTransformRotation(base, "a", 190, "transform-a");
    assert.equal(findLayerTransform(next, "a")?.id, "transform-a");
    assertClose(readLayerTransformRotation(next, "a"), -170);
    assert.deepEqual(readLayerTransformPosition(next, "a"), { x: 0, y: 0 });
  });

  it("keeps the position and resets to 0", () => {
    const moved = setLayerTransformPosition(base, "a", { x: 0.2, y: 0 }, "t");
    const turned = setLayerTransformRotation(moved, "a", 45, "unused");
    assert.equal(findLayerTransform(turned, "a")?.id, "t");
    assert.deepEqual(readLayerTransformPosition(turned, "a"), {
      x: 0.2,
      y: 0,
    });
    const reset = setLayerTransformRotation(turned, "a", 0, "unused");
    assert.equal(readLayerTransformRotation(reset, "a"), 0);
    assert.equal(setLayerTransformRotation(reset, "a", 0, "unused"), reset);
  });
});
