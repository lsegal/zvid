// Pure maths for the Transform layer effect. A Transform moves, scales and
// rotates a layer's box (its band, showing what Layout placed there) inside
// the canvas. Everything here is in canvas pixels, origin top-left, +y down,
// with positive rotation turning clockwise on screen.
import type { FrameBounds } from "./composition-layout.ts";

export type LayerTransform = {
  // Offset of the box, in canvas widths (x) and heights (y, + down).
  positionX: number;
  positionY: number;
  scaleX: number;
  scaleY: number;
  // Pivot in the box: -1 is the left (top) edge, 0 the centre, 1 the right
  // (bottom) edge.
  originX: number;
  originY: number;
  rotationDeg: number;
};

export const IDENTITY_TRANSFORM: LayerTransform = {
  positionX: 0,
  positionY: 0,
  scaleX: 1,
  scaleY: 1,
  originX: 0,
  originY: 0,
  rotationDeg: 0,
};

export type Point = { x: number; y: number };

export type Box = { x: number; y: number; width: number; height: number };

export type CanvasSize = { width: number; height: number };

// Affine map `x' = a·x + c·y + e`, `y' = b·x + d·y + f`, as in DOMMatrix.
export type Matrix2D = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

// Corners of a box, clockwise from top-left.
export type BoxCorners = [Point, Point, Point, Point];

export function isIdentityTransform(transform: LayerTransform | undefined) {
  return (
    !transform ||
    (transform.positionX === 0 &&
      transform.positionY === 0 &&
      transform.scaleX === 1 &&
      transform.scaleY === 1 &&
      transform.rotationDeg % 360 === 0)
  );
}

// translate(position) · translate(origin) · rotate · scale · translate(-origin),
// with the origin taken in the untransformed box.
export function transformMatrix(
  transform: LayerTransform,
  box: Box,
  canvas: CanvasSize,
): Matrix2D {
  const pivotX = box.x + ((transform.originX + 1) / 2) * box.width;
  const pivotY = box.y + ((transform.originY + 1) / 2) * box.height;
  const radians = (transform.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const a = cos * transform.scaleX;
  const b = sin * transform.scaleX;
  const c = -sin * transform.scaleY;
  const d = cos * transform.scaleY;

  return {
    a,
    b,
    c,
    d,
    e: pivotX + transform.positionX * canvas.width - (a * pivotX + c * pivotY),
    f: pivotY + transform.positionY * canvas.height - (b * pivotX + d * pivotY),
  };
}

export function applyMatrix(matrix: Matrix2D, point: Point): Point {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

// Undefined when the matrix collapses the box to a line or a point.
export function invertMatrix(matrix: Matrix2D): Matrix2D | undefined {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    return undefined;
  }

  const a = matrix.d / determinant;
  const b = -matrix.b / determinant;
  const c = -matrix.c / determinant;
  const d = matrix.a / determinant;
  return {
    a,
    b,
    c,
    d,
    e: -(a * matrix.e + c * matrix.f),
    f: -(b * matrix.e + d * matrix.f),
  };
}

// A layer's untransformed box in canvas pixels: its band.
export function frameBoxInCanvas(frame: FrameBounds, canvas: CanvasSize): Box {
  const left = frame.centerX - frame.halfWidth;
  const top = frame.centerY + frame.halfHeight;
  return {
    x: ((left + 1) / 2) * canvas.width,
    y: ((1 - top) / 2) * canvas.height,
    width: frame.halfWidth * canvas.width,
    height: frame.halfHeight * canvas.height,
  };
}

// The inverse of `frameBoxInCanvas`: a canvas-pixel box as clip-space
// bounds.
export function canvasBoxToFrame(box: Box, canvas: CanvasSize): FrameBounds {
  const halfWidth = box.width / canvas.width;
  const halfHeight = box.height / canvas.height;
  return {
    centerX: (box.x / canvas.width) * 2 - 1 + halfWidth,
    centerY: 1 - (box.y / canvas.height) * 2 - halfHeight,
    halfWidth,
    halfHeight,
    aspect: box.width / Math.max(box.height, 0.0001),
  };
}

export type TextBox = {
  // The text box in canvas pixels, before its Transform moves and turns it.
  box: Box;
  // The layer's Transform without its scale, which the box already holds.
  transform: LayerTransform;
};

// A text layer's Transform resizes its text box instead of stretching the
// text: Width and Height scale the band about the Transform's origin, and
// the rest of the Transform (position, origin, rotation) moves and turns the
// resized box. The box lands exactly where the Transform puts the band, so
// only the text inside it is laid out differently.
export function resolveTextBox(
  band: Box,
  transform: LayerTransform = IDENTITY_TRANSFORM,
): TextBox {
  const pivotX = band.x + ((transform.originX + 1) / 2) * band.width;
  const pivotY = band.y + ((transform.originY + 1) / 2) * band.height;
  return {
    box: {
      x: pivotX + (band.x - pivotX) * transform.scaleX,
      y: pivotY + (band.y - pivotY) * transform.scaleY,
      width: band.width * transform.scaleX,
      height: band.height * transform.scaleY,
    },
    transform: { ...transform, scaleX: 1, scaleY: 1 },
  };
}

// The four corners of a placed layer after its Transform, in canvas pixels.
export function layerBoxInCanvas(
  placement: { frame: FrameBounds },
  transform: LayerTransform,
  canvas: CanvasSize,
): BoxCorners {
  const box = frameBoxInCanvas(placement.frame, canvas);
  const matrix = transformMatrix(transform, box, canvas);
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  return [
    applyMatrix(matrix, { x: box.x, y: box.y }),
    applyMatrix(matrix, { x: right, y: box.y }),
    applyMatrix(matrix, { x: right, y: bottom }),
    applyMatrix(matrix, { x: box.x, y: bottom }),
  ];
}

// Maps a canvas pixel onto the layer's own box, in the same -1..1 units as
// the origin (-1 left/top, 1 right/bottom). The point is on the layer when
// both coordinates are within -1..1. Undefined for a degenerate Transform.
export function canvasToLayer(
  point: Point,
  placement: { frame: FrameBounds },
  transform: LayerTransform,
  canvas: CanvasSize,
): Point | undefined {
  const box = frameBoxInCanvas(placement.frame, canvas);
  const inverse = invertMatrix(transformMatrix(transform, box, canvas));
  if (!inverse || box.width <= 0 || box.height <= 0) {
    return undefined;
  }

  const local = applyMatrix(inverse, point);
  return {
    x: ((local.x - box.x) / box.width) * 2 - 1,
    y: ((local.y - box.y) / box.height) * 2 - 1,
  };
}

export type QuadAxes = {
  axisX: [number, number];
  axisY: [number, number];
  offset: [number, number];
};

// Where the composite shader's unit quad (-1..1, +y up, (-1, 1) at the top
// left of the image) lands in clip space when it shows the transformed box.
export function transformedQuadAxes(
  frame: FrameBounds,
  transform: LayerTransform,
  canvas: CanvasSize,
): QuadAxes {
  const box = frameBoxInCanvas(frame, canvas);
  const matrix = transformMatrix(transform, box, canvas);
  const toClip = (point: Point): [number, number] => {
    const mapped = applyMatrix(matrix, point);
    return [
      (mapped.x / canvas.width) * 2 - 1,
      1 - (mapped.y / canvas.height) * 2,
    ];
  };
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const center = toClip({ x: centerX, y: centerY });
  const right = toClip({ x: box.x + box.width, y: centerY });
  const top = toClip({ x: centerX, y: box.y });

  return {
    axisX: [right[0] - center[0], right[1] - center[1]],
    axisY: [top[0] - center[0], top[1] - center[1]],
    offset: center,
  };
}

export const TRANSFORM_EFFECT_NAME = "Transform";

export function isTransformEffectName(effectName: string) {
  return effectName.trim().toLowerCase() === "transform";
}

type TransformParameter = {
  key: string;
  value: string;
  numericValue?: number;
};

// Parameter key, the LayerTransform field it sets, and its range.
const TRANSFORM_KEYS: Array<[string, keyof LayerTransform, number, number]> = [
  ["positionx", "positionX", -2, 2],
  ["positiony", "positionY", -2, 2],
  ["scalex", "scaleX", 0.05, 8],
  ["scaley", "scaleY", 0.05, 8],
  ["originx", "originX", -1, 1],
  ["originy", "originY", -1, 1],
  ["rotation", "rotationDeg", -180, 180],
];

// Reads a Transform effect's parameters by exact key; missing or unreadable
// values keep their identity default.
export function parseLayerTransform(
  parameters: TransformParameter[],
): LayerTransform {
  const transform = { ...IDENTITY_TRANSFORM };
  for (const parameter of parameters) {
    const key = parameter.key.toLowerCase().replace(/[^a-z0-9]/g, "");
    const entry = TRANSFORM_KEYS.find(([candidate]) => candidate === key);
    const numeric =
      parameter.numericValue ?? Number.parseFloat(parameter.value);
    if (!entry || !Number.isFinite(numeric)) {
      continue;
    }

    const [, field, minimum, maximum] = entry;
    transform[field] = Math.max(minimum, Math.min(maximum, numeric));
  }

  return transform;
}
