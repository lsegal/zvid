// Pure maths behind the preview's rotation handle: dragging the handle, or a
// rotate zone just outside a corner, turns the layer's Transform about its
// origin.
//
// Canvas points are composition pixels, origin top-left, +y down, so positive
// angles turn clockwise on screen. Screen points are CSS pixels relative to
// the preview monitor. The video is scaled uniformly onto the monitor, so an
// angle is the same measured in either.
import type {
  BoxCorners,
  LayerTransform,
  Point,
} from "./composition-transform.ts";

// Shift snaps a rotation to these steps; without it, the angle still settles
// onto a right angle within the soft-snap range.
export const ROTATION_SNAP_STEP_DEG = 15;
export const ROTATION_SOFT_SNAP_DEG = 3;

// The rotation handle sits this far out from the middle of the box's top
// edge, on a stem, and takes presses within its hit radius.
export const ROTATION_HANDLE_OFFSET_PX = 24;
export const ROTATION_HANDLE_HIT_PX = 8;
// Outside the box, presses this close to a corner rotate. Resize handles on
// the corners themselves take precedence.
export const ROTATE_ZONE_PX = 20;

// Into the Transform's -180..180 range, keeping 180 rather than -180.
export function wrapRotation(degrees: number) {
  if (!Number.isFinite(degrees)) {
    return 0;
  }

  const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

// The Transform for a rotate drag: the start rotation plus how far the
// pointer has turned about the origin, all in the same (canvas or screen)
// space. Position is left alone: the Transform
// already pivots on its origin, so the origin stays put and the box swings
// around it. Shift snaps to 15 degree steps; otherwise the angle settles onto
// 0, 90, 180 or -90 when within a few degrees of one.
export function rotateTransform(
  start: LayerTransform,
  originCanvas: Point,
  pointerStart: Point,
  pointerNow: Point,
  { snap15 = false }: { snap15?: boolean } = {},
): LayerTransform {
  const angleOf = (point: Point) =>
    (Math.atan2(point.y - originCanvas.y, point.x - originCanvas.x) * 180) /
    Math.PI;
  let rotation = wrapRotation(
    start.rotationDeg + angleOf(pointerNow) - angleOf(pointerStart),
  );
  if (snap15) {
    rotation = wrapRotation(
      Math.round(rotation / ROTATION_SNAP_STEP_DEG) * ROTATION_SNAP_STEP_DEG,
    );
  } else {
    const rightAngle = wrapRotation(Math.round(rotation / 90) * 90);
    if (
      Math.abs(wrapRotation(rotation - rightAngle)) <= ROTATION_SOFT_SNAP_DEG
    ) {
      rotation = rightAngle;
    }
  }

  // `|| 0` turns -0 into 0.
  return { ...start, rotationDeg: rotation || 0 };
}

// The handle on its stem, from the middle of the box's top edge outwards.
// Both follow the box's rotation. `corners` are on screen, clockwise from
// the top-left, as the preview draws them.
export function rotationHandleGeometry(corners: BoxCorners) {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  const top = midpoint(topLeft, topRight);
  const bottom = midpoint(bottomLeft, bottomRight);
  const length = Math.hypot(top.x - bottom.x, top.y - bottom.y);
  // A box squashed flat has no "up" of its own; use the screen's.
  const dx = length > 1e-9 ? top.x - bottom.x : 0;
  const dy = length > 1e-9 ? top.y - bottom.y : -1;
  const unit = length > 1e-9 ? length : 1;

  return {
    stemStart: top,
    handle: {
      x: top.x + (dx / unit) * ROTATION_HANDLE_OFFSET_PX,
      y: top.y + (dy / unit) * ROTATION_HANDLE_OFFSET_PX,
    },
  };
}

export function isOnRotationHandle(point: Point, corners: BoxCorners) {
  const { handle } = rotationHandleGeometry(corners);
  return (
    Math.hypot(point.x - handle.x, point.y - handle.y) <= ROTATION_HANDLE_HIT_PX
  );
}

// Just outside a corner of the box, as in Photoshop.
export function isInRotateZone(point: Point, corners: BoxCorners) {
  return (
    !isPointInQuad(point, corners) &&
    corners.some(
      (corner) =>
        Math.hypot(point.x - corner.x, point.y - corner.y) <= ROTATE_ZONE_PX,
    )
  );
}

// Inside (or on the edge of) a convex quad, in either winding.
export function isPointInQuad(point: Point, corners: BoxCorners) {
  let sign = 0;
  for (let index = 0; index < corners.length; index += 1) {
    const from = corners[index];
    const to = corners[(index + 1) % corners.length];
    const cross =
      (to.x - from.x) * (point.y - from.y) -
      (to.y - from.y) * (point.x - from.x);
    if (Math.abs(cross) < 1e-9) {
      continue;
    }
    if (sign === 0) {
      sign = Math.sign(cross);
    } else if (Math.sign(cross) !== sign) {
      return false;
    }
  }

  return true;
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// The angle readout shown while rotating, e.g. "32.5°".
export function formatRotation(degrees: number) {
  const rounded = Math.round(degrees * 10) / 10 || 0;
  return `${rounded.toFixed(1).replace(/\.0$/, "")}°`;
}

export function rotateHistoryLabel(layerName: string) {
  return `Rotate ${layerName}`;
}
