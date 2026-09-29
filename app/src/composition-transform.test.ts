import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type LayoutAnchor,
  resolveLayerPlacement,
} from "./composition-layout.ts";
import {
  applyMatrix,
  canvasToLayer,
  frameBoxInCanvas,
  IDENTITY_TRANSFORM,
  invertMatrix,
  isIdentityTransform,
  type LayerTransform,
  layerBoxInCanvas,
  type Point,
  parseLayerTransform,
  transformedQuadAxes,
  transformMatrix,
} from "./composition-transform.ts";

const CANVAS = { width: 1080, height: 1920 };

function transform(overrides: Partial<LayerTransform>): LayerTransform {
  return { ...IDENTITY_TRANSFORM, ...overrides };
}

// Band `index` of `count` on CANVAS, placed with a portrait source.
function placement(index = 0, count = 1, anchor: LayoutAnchor = "center") {
  return resolveLayerPlacement({
    index,
    count,
    canvasWidth: CANVAS.width,
    canvasHeight: CANVAS.height,
    sourceWidth: 1920,
    sourceHeight: 1080,
    visual: { scale: 1, translateX: 0, translateY: 0, layoutAnchor: anchor },
  });
}

function assertPoint(actual: Point, expected: Point, message = "") {
  assert.ok(
    Math.abs(actual.x - expected.x) < 1e-6 &&
      Math.abs(actual.y - expected.y) < 1e-6,
    `${message} (${actual.x}, ${actual.y}) != (${expected.x}, ${expected.y})`,
  );
}

function assertCorners(actual: Point[], expected: Array<[number, number]>) {
  for (const [index, [x, y]] of expected.entries()) {
    assertPoint(actual[index], { x, y }, `corner ${index}`);
  }
}

describe("frameBoxInCanvas", () => {
  it("is the band in canvas pixels, top band first", () => {
    assert.deepEqual(frameBoxInCanvas(placement(0, 2).frame, CANVAS), {
      x: 0,
      y: 0,
      width: 1080,
      height: 960,
    });
    assert.deepEqual(frameBoxInCanvas(placement(1, 2).frame, CANVAS), {
      x: 0,
      y: 960,
      width: 1080,
      height: 960,
    });
  });
});

describe("layerBoxInCanvas", () => {
  it("is the band itself for the identity Transform", () => {
    assertCorners(
      layerBoxInCanvas(placement(1, 3), IDENTITY_TRANSFORM, CANVAS),
      [
        [0, 640],
        [1080, 640],
        [1080, 1280],
        [0, 1280],
      ],
    );
  });

  it("moves by canvas widths and heights, + down", () => {
    const corners = layerBoxInCanvas(
      placement(0, 2),
      transform({ positionX: 0.25, positionY: -0.5 }),
      CANVAS,
    );
    assertCorners(corners, [
      [270, -960],
      [1350, -960],
      [1350, 0],
      [270, 0],
    ]);
  });

  it("scales width and height independently about the centre", () => {
    const corners = layerBoxInCanvas(
      placement(),
      transform({ scaleX: 0.5, scaleY: 0.25 }),
      CANVAS,
    );
    assertCorners(corners, [
      [270, 720],
      [810, 720],
      [810, 1200],
      [270, 1200],
    ]);
  });

  it("scales about the origin, which stays put", () => {
    const corners = layerBoxInCanvas(
      placement(),
      transform({ scaleX: 0.5, scaleY: 0.5, originX: -1, originY: 1 }),
      CANVAS,
    );
    // Bottom-left pivot: the bottom-left corner does not move.
    assertCorners(corners, [
      [0, 960],
      [540, 960],
      [540, 1920],
      [0, 1920],
    ]);
  });

  it("rotates clockwise about the origin", () => {
    const corners = layerBoxInCanvas(
      placement(),
      transform({ rotationDeg: 90, originX: -1, originY: -1 }),
      CANVAS,
    );
    // Turned a quarter clockwise about the top-left corner.
    assertCorners(corners, [
      [0, 0],
      [0, 1080],
      [-1920, 1080],
      [-1920, 0],
    ]);
  });

  it("applies position after origin, rotation and scale", () => {
    const pivotTransform = transform({
      positionX: 0.5,
      positionY: 0.25,
      scaleX: 2,
      scaleY: 0.5,
      originX: 1,
      originY: 0,
      rotationDeg: 180,
    });
    const box = frameBoxInCanvas(placement().frame, CANVAS);
    const matrix = transformMatrix(pivotTransform, box, CANVAS);
    // The pivot (right edge, middle) only moves by the position.
    assertPoint(applyMatrix(matrix, { x: 1080, y: 960 }), {
      x: 1080 + 540,
      y: 960 + 480,
    });
    // The centre is half a box width left of the pivot: scaled 2× and turned
    // 180°, it ends up a full box width right of it.
    assertPoint(applyMatrix(matrix, { x: 540, y: 960 }), {
      x: 1080 + 540 + 1080,
      y: 960 + 480,
    });
  });

  it("transforms the band as Layout placed it, whatever the anchor", () => {
    for (const anchor of ["top", "center", "bottom"] as const) {
      const corners = layerBoxInCanvas(
        placement(0, 2, anchor),
        transform({ positionY: 0.5 }),
        CANVAS,
      );
      assertCorners(corners, [
        [0, 960],
        [1080, 960],
        [1080, 1920],
        [0, 1920],
      ]);
    }
  });
});

describe("canvasToLayer", () => {
  const transforms = [
    IDENTITY_TRANSFORM,
    transform({ positionX: 0.1, positionY: -0.2, rotationDeg: 30 }),
    transform({ scaleX: 0.4, scaleY: 3, originX: 0.5, originY: -1 }),
    transform({ rotationDeg: -135, scaleX: 1.5, originX: 1, positionY: 1 }),
  ];

  for (const [index, value] of transforms.entries()) {
    it(`inverts layerBoxInCanvas (${index})`, () => {
      const layer = placement(1, 3);
      const corners = layerBoxInCanvas(layer, value, CANVAS);
      const expected = [
        { x: -1, y: -1 },
        { x: 1, y: -1 },
        { x: 1, y: 1 },
        { x: -1, y: 1 },
      ];
      for (const [corner, point] of corners.entries()) {
        assertPoint(
          canvasToLayer(point, layer, value, CANVAS) as Point,
          expected[corner],
        );
      }
    });
  }

  it("puts the origin at the layer's pivot", () => {
    const value = transform({ originX: 0.5, originY: -0.5, rotationDeg: 45 });
    const layer = placement();
    const box = frameBoxInCanvas(layer.frame, CANVAS);
    const pivot = { x: box.x + 0.75 * box.width, y: box.y + 0.25 * box.height };
    assertPoint(canvasToLayer(pivot, layer, value, CANVAS) as Point, {
      x: 0.5,
      y: -0.5,
    });
  });

  it("puts points off the layer outside -1..1", () => {
    const local = canvasToLayer(
      { x: 100, y: 100 },
      placement(),
      transform({ scaleX: 0.5, scaleY: 0.5 }),
      CANVAS,
    ) as Point;
    assert.ok(Math.abs(local.x) > 1 && Math.abs(local.y) > 1);
  });
});

describe("invertMatrix", () => {
  it("has no inverse for a collapsed box", () => {
    assert.equal(
      invertMatrix({ a: 1, b: 2, c: 2, d: 4, e: 0, f: 0 }),
      undefined,
    );
  });
});

describe("transformedQuadAxes", () => {
  it("fills the band for the identity Transform", () => {
    const { frame } = placement(0, 2);
    assert.deepEqual(transformedQuadAxes(frame, IDENTITY_TRANSFORM, CANVAS), {
      axisX: [frame.halfWidth, 0],
      axisY: [0, frame.halfHeight],
      offset: [frame.centerX, frame.centerY],
    });
  });

  it("matches layerBoxInCanvas in clip space", () => {
    const layer = placement(1, 2);
    const value = transform({ positionX: 0.2, scaleY: 1.5, rotationDeg: 60 });
    const { axisX, axisY, offset } = transformedQuadAxes(
      layer.frame,
      value,
      CANVAS,
    );
    const [topLeft] = layerBoxInCanvas(layer, value, CANVAS);
    // The quad's (-1, 1) vertex is the image's top-left corner.
    assertPoint(
      {
        x: ((offset[0] - axisX[0] + axisY[0] + 1) / 2) * CANVAS.width,
        y: ((1 - (offset[1] - axisX[1] + axisY[1])) / 2) * CANVAS.height,
      },
      topLeft,
    );
  });
});

describe("isIdentityTransform", () => {
  it("ignores the origin when nothing else moves the layer", () => {
    assert.ok(isIdentityTransform(undefined));
    assert.ok(isIdentityTransform(transform({ originX: 1, originY: -1 })));
    assert.ok(!isIdentityTransform(transform({ scaleX: 1.01 })));
    assert.ok(!isIdentityTransform(transform({ rotationDeg: 1 })));
  });
});

describe("parseLayerTransform", () => {
  it("reads each key exactly and clamps it to its range", () => {
    assert.deepEqual(
      parseLayerTransform([
        { key: "PositionX", value: "0.25", numericValue: 0.25 },
        { key: "PositionY", value: "-3" },
        { key: "ScaleX", value: "2", numericValue: 2 },
        { key: "ScaleY", value: "0", numericValue: 0 },
        { key: "OriginX", value: "-1", numericValue: -1 },
        { key: "OriginY", value: "0.5", numericValue: 0.5 },
        { key: "Rotation", value: "270", numericValue: 270 },
      ]),
      {
        positionX: 0.25,
        positionY: -2,
        scaleX: 2,
        scaleY: 0.05,
        originX: -1,
        originY: 0.5,
        rotationDeg: 180,
      },
    );
  });

  it("keeps identity defaults for missing or unreadable values", () => {
    assert.deepEqual(
      parseLayerTransform([
        { key: "ScaleX", value: "wide" },
        { key: "Opacity", value: "0.5", numericValue: 0.5 },
      ]),
      IDENTITY_TRANSFORM,
    );
  });
});
