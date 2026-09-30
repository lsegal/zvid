// Pure maths for the Transform effect. A Transform moves, scales and rotates
// a layer's box (its band, showing what Layout placed there) inside the
// canvas. A clip's own Transform does the same inside its layer's
// transformed box: it is applied to the band first, then the layer's
// Transform moves the result. The compositor crops the result to the band,
// so with an Order a transformed layer never leaves its slot. Everything here is in canvas pixels, origin
// top-left, +y down, with positive rotation turning clockwise on screen.
import type { FrameBounds } from "./composition-layout.ts";

export type LayerTransform = {
  // Offset of the box, in canvas widths (x) and heights (y, + down).
  positionX: number;
  positionY: number;
  scaleX: number;
  scaleY: number;
  // Pivot in the box: -1 is the left (top) edge, 0 the center, 1 the right
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

export const IDENTITY_MATRIX: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

// `outer` after `inner`: maps a point through `inner`, then `outer`.
export function multiplyMatrix(outer: Matrix2D, inner: Matrix2D): Matrix2D {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

// Where a clip's box lands: its own Transform places it in its layer's box,
// and the layer's Transform then places that. Both are taken about the same
// untransformed box, the clip's band.
export function nestedTransformMatrix(
  box: Box,
  canvas: CanvasSize,
  layerTransform: LayerTransform = IDENTITY_TRANSFORM,
  clipTransform: LayerTransform = IDENTITY_TRANSFORM,
): Matrix2D {
  return multiplyMatrix(
    transformMatrix(layerTransform, box, canvas),
    transformMatrix(clipTransform, box, canvas),
  );
}

// A stack's Moves at the playhead, as the Transforms they resolve to, split
// by where they sit in the stack: `outer` before the stack's Transform
// (which nests inside them) and `inner` after it (nested inside it). A stack
// without a Transform has its Moves in `outer`, so a Transform added to the
// end of the stack nests inside them.
export type TransformMotion = {
  outer: readonly LayerTransform[];
  inner: readonly LayerTransform[];
};

// The geometry a clip is drawn with: its layer's Transform and Moves, then
// its own nested inside them.
export type TransformedVisual = {
  transform?: LayerTransform;
  clipTransform?: LayerTransform;
  motion?: TransformMotion;
  clipMotion?: TransformMotion;
};

// Outermost first: each Transform nests inside the ones before it.
export type TransformChain = readonly LayerTransform[];

// One stack's chain: its outer Moves, its Transform, then its inner Moves.
export function stackTransformChain(
  transform: LayerTransform | undefined,
  motion: TransformMotion | undefined,
): LayerTransform[] {
  return [
    ...(motion?.outer ?? []),
    ...(transform ? [transform] : []),
    ...(motion?.inner ?? []),
  ];
}

// The whole chain that places a clip: its layer's stack, then its own.
export function visualTransformChain(visual: TransformedVisual) {
  return [
    ...stackTransformChain(visual.transform, visual.motion),
    ...stackTransformChain(visual.clipTransform, visual.clipMotion),
  ];
}

export function isIdentityChain(chain: TransformChain) {
  return chain.every((transform) => isIdentityTransform(transform));
}

// Where `chain` puts `box`, every Transform taken about the same
// untransformed box, as in `nestedTransformMatrix`.
export function chainTransformMatrix(
  chain: TransformChain,
  box: Box,
  canvas: CanvasSize,
): Matrix2D {
  return chain.reduce<Matrix2D>(
    (matrix, transform) =>
      multiplyMatrix(matrix, transformMatrix(transform, box, canvas)),
    IDENTITY_MATRIX,
  );
}

export function visualTransformMatrix(
  box: Box,
  canvas: CanvasSize,
  visual: TransformedVisual,
) {
  return chainTransformMatrix(visualTransformChain(visual), box, canvas);
}

// The corners of `box` placed by `matrix`, clockwise from top-left.
export function matrixBoxCorners(matrix: Matrix2D, box: Box): BoxCorners {
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  return [
    applyMatrix(matrix, { x: box.x, y: box.y }),
    applyMatrix(matrix, { x: right, y: box.y }),
    applyMatrix(matrix, { x: right, y: bottom }),
    applyMatrix(matrix, { x: box.x, y: bottom }),
  ];
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

// A clip's text box: like `resolveTextBox`, but for the clip's Transform
// nested in its layer's (`matrix`, as `nestedTransformMatrix` gives it).
// The box takes the scale the matrix gives each of the band's sides, about
// `pivot` (the origin of the innermost Transform, in -1..1 box units), and
// `matrix` is what is left to move and turn the box: it keeps text from
// stretching however the Transforms scale it.
export function resolveNestedTextBox(
  band: Box,
  matrix: Matrix2D,
  pivot: Point = { x: 0, y: 0 },
): { box: Box; matrix: Matrix2D } {
  const scaleX = Math.max(1e-6, Math.hypot(matrix.a, matrix.b));
  const scaleY = Math.max(1e-6, Math.hypot(matrix.c, matrix.d));
  const pivotX = band.x + ((pivot.x + 1) / 2) * band.width;
  const pivotY = band.y + ((pivot.y + 1) / 2) * band.height;
  // Maps the resized box back onto the band, so the matrix still applies.
  const unscale: Matrix2D = {
    a: 1 / scaleX,
    b: 0,
    c: 0,
    d: 1 / scaleY,
    e: pivotX - pivotX / scaleX,
    f: pivotY - pivotY / scaleY,
  };
  return {
    box: {
      x: pivotX + (band.x - pivotX) * scaleX,
      y: pivotY + (band.y - pivotY) * scaleY,
      width: band.width * scaleX,
      height: band.height * scaleY,
    },
    matrix: multiplyMatrix(matrix, unscale),
  };
}

// A text clip's box and placement for its layer's Transform and its own
// nested inside it: resized by both Transforms' scale, about the clip's
// origin (or the layer's, without a clip Transform).
export function resolveClipTextBox(
  band: Box,
  canvas: CanvasSize,
  layerTransform?: LayerTransform,
  clipTransform?: LayerTransform,
) {
  return resolveVisualTextBox(band, canvas, {
    transform: layerTransform,
    clipTransform,
  });
}

// `resolveClipTextBox` for a clip's whole chain, Moves included: the box is
// resized about the origin of the innermost Transform that changes it.
export function resolveVisualTextBox(
  band: Box,
  canvas: CanvasSize,
  visual: TransformedVisual,
) {
  const chain = visualTransformChain(visual);
  const pivot = chain.findLast((transform) => !isIdentityTransform(transform));
  return resolveNestedTextBox(
    band,
    chainTransformMatrix(chain, band, canvas),
    pivot && { x: pivot.originX, y: pivot.originY },
  );
}

// The four corners of a placed layer after its Transform, in canvas pixels.
// A clip's Transform nests inside its layer's, which is then `parent`.
export function layerBoxInCanvas(
  placement: { frame: FrameBounds },
  transform: LayerTransform,
  canvas: CanvasSize,
  parent: Matrix2D = IDENTITY_MATRIX,
): BoxCorners {
  const box = frameBoxInCanvas(placement.frame, canvas);
  const matrix = multiplyMatrix(
    parent,
    transformMatrix(transform, box, canvas),
  );
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
  parent: Matrix2D = IDENTITY_MATRIX,
): Point | undefined {
  const box = frameBoxInCanvas(placement.frame, canvas);
  const inverse = invertMatrix(
    multiplyMatrix(parent, transformMatrix(transform, box, canvas)),
  );
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
  return matrixQuadAxes(
    frame,
    transformMatrix(transform, frameBoxInCanvas(frame, canvas), canvas),
    canvas,
  );
}

// `transformedQuadAxes` for a box placed by `matrix`, in canvas pixels.
export function matrixQuadAxes(
  frame: FrameBounds,
  matrix: Matrix2D,
  canvas: CanvasSize,
): QuadAxes {
  const box = frameBoxInCanvas(frame, canvas);
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

// The Transform and Move effects' own parameters, kept here so existing
// imports still resolve.
export * from "./fx/effects/move/move.ts";
export * from "./fx/effects/transform/transform.ts";
