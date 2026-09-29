import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type LayoutAnchor,
  resolveLayerPlacement,
} from "./composition-layout.ts";
import {
  applyMatrix,
  canvasBoxToFrame,
  canvasToLayer,
  frameBoxInCanvas,
  IDENTITY_TRANSFORM,
  invertMatrix,
  isIdentityChain,
  isIdentityTransform,
  type LayerMove,
  type LayerTransform,
  layerBoxInCanvas,
  matrixQuadAxes,
  multiplyMatrix,
  nestedTransformMatrix,
  type Point,
  parseLayerMove,
  parseLayerTransform,
  resolveClipTextBox,
  resolveMoveTransform,
  resolveTextBox,
  resolveVisualTextBox,
  transformedQuadAxes,
  transformMatrix,
  visualTransformChain,
  visualTransformMatrix,
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

describe("resolveTextBox", () => {
  const canvas = { width: 1920, height: 1080 };
  const band = { x: 0, y: 540, width: 1920, height: 540 };

  it("round-trips a box through clip-space bounds", () => {
    assert.deepEqual(
      frameBoxInCanvas(canvasBoxToFrame(band, canvas), canvas),
      band,
    );
  });

  it("leaves an unscaled band as it is", () => {
    const moved = { ...IDENTITY_TRANSFORM, positionX: 0.5, rotationDeg: 45 };
    assert.deepEqual(resolveTextBox(band, moved), {
      box: band,
      transform: moved,
    });
  });

  it("resizes the band about the origin, and lands where the scaled band does", () => {
    const transform: LayerTransform = {
      ...IDENTITY_TRANSFORM,
      positionX: 0.1,
      positionY: -0.2,
      scaleX: 2,
      scaleY: 0.25,
      originX: -1,
      originY: 0.5,
      rotationDeg: 30,
    };
    const text = resolveTextBox(band, transform);
    assert.equal(text.box.width, 3840);
    assert.equal(text.box.height, 135);
    assert.equal(text.transform.scaleX, 1);
    assert.equal(text.transform.scaleY, 1);

    const scaled = layerBoxInCanvas(
      { frame: canvasBoxToFrame(band, canvas) },
      transform,
      canvas,
    );
    const resized = layerBoxInCanvas(
      { frame: canvasBoxToFrame(text.box, canvas) },
      text.transform,
      canvas,
    );
    resized.forEach((corner, index) => {
      assert.ok(Math.abs(corner.x - scaled[index].x) < 1e-6);
      assert.ok(Math.abs(corner.y - scaled[index].y) < 1e-6);
    });
  });
});

describe("clip Transform inside the layer Transform", () => {
  const canvas = { width: 1000, height: 2000 };
  const band = { x: 0, y: 0, width: 1000, height: 2000 };
  const corners = (layer?: LayerTransform, clip?: LayerTransform) =>
    layerBoxInCanvas(
      { frame: canvasBoxToFrame(band, canvas) },
      clip ?? IDENTITY_TRANSFORM,
      canvas,
      transformMatrix(layer ?? IDENTITY_TRANSFORM, band, canvas),
    );
  const close = (actual: Point[], expected: Point[]) =>
    actual.forEach((point, index) => {
      assert.ok(Math.abs(point.x - expected[index].x) < 1e-6, `x${index}`);
      assert.ok(Math.abs(point.y - expected[index].y) < 1e-6, `y${index}`);
    });

  it("places the clip in its layer's box, then moves that box", () => {
    // Half size in the middle of the band, then the layer moves right.
    close(
      corners(
        transform({ positionX: 0.25 }),
        transform({ scaleX: 0.5, scaleY: 0.5 }),
      ),
      [
        { x: 500, y: 500 },
        { x: 1000, y: 500 },
        { x: 1000, y: 1500 },
        { x: 500, y: 1500 },
      ],
    );
    // The other way round (the clip's Transform outside the layer's) would
    // scale the moved box about the band's centre instead.
    const swapped = multiplyMatrix(
      transformMatrix(transform({ scaleX: 0.5, scaleY: 0.5 }), band, canvas),
      transformMatrix(transform({ positionX: 0.25 }), band, canvas),
    );
    assert.deepEqual(applyMatrix(swapped, { x: 0, y: 0 }), { x: 375, y: 500 });
  });

  it("turns the clip with its layer", () => {
    close(
      corners(transform({ rotationDeg: 90 }), transform({ positionX: 0.1 })),
      // The clip moves 100px right in the layer, which the layer turns
      // into 100px down.
      corners(transform({ rotationDeg: 90, positionY: 0.05 })),
    );
  });

  it("is the layer Transform alone with no clip Transform", () => {
    const layer = transform({ positionX: 0.2, scaleY: 1.5, rotationDeg: 30 });
    assert.deepEqual(
      nestedTransformMatrix(band, canvas, layer),
      transformMatrix(layer, band, canvas),
    );
    assert.deepEqual(
      matrixQuadAxes(
        canvasBoxToFrame(band, canvas),
        nestedTransformMatrix(band, canvas, layer),
        canvas,
      ),
      transformedQuadAxes(canvasBoxToFrame(band, canvas), layer, canvas),
    );
  });

  it("maps canvas points onto the nested box and back", () => {
    const layer = transform({ positionX: 0.25, rotationDeg: 45 });
    const clip = transform({ scaleX: 0.5, positionY: -0.1 });
    const frame = canvasBoxToFrame(band, canvas);
    const [topLeft] = corners(layer, clip);
    const local = canvasToLayer(
      topLeft,
      { frame },
      clip,
      canvas,
      transformMatrix(layer, band, canvas),
    );
    assert.ok(local);
    assert.ok(Math.abs(local.x + 1) < 1e-9);
    assert.ok(Math.abs(local.y + 1) < 1e-9);
  });

  it("resizes a text box by both Transforms, landing where the scaled box does", () => {
    const layer = transform({ scaleX: 2, positionX: 0.1, rotationDeg: 20 });
    const clip = transform({ scaleY: 0.5, originX: -1, originY: -1 });
    const text = resolveClipTextBox(band, canvas, layer, clip);
    assert.ok(Math.abs(text.box.width - 2000) < 1e-9);
    assert.ok(Math.abs(text.box.height - 1000) < 1e-9);
    const landed = [
      { x: text.box.x, y: text.box.y },
      { x: text.box.x + text.box.width, y: text.box.y },
      { x: text.box.x + text.box.width, y: text.box.y + text.box.height },
      { x: text.box.x, y: text.box.y + text.box.height },
    ].map((point) => applyMatrix(text.matrix, point));
    close(landed, corners(layer, clip));
  });

  it("matches resolveTextBox for a layer Transform alone", () => {
    const layer = transform({
      positionX: 0.1,
      scaleX: 2,
      scaleY: 0.25,
      originX: -1,
      originY: 0.5,
      rotationDeg: 30,
    });
    const nested = resolveClipTextBox(band, canvas, layer);
    const single = resolveTextBox(band, layer);
    close(
      [
        { x: nested.box.x, y: nested.box.y },
        { x: nested.box.width, y: nested.box.height },
      ],
      [
        { x: single.box.x, y: single.box.y },
        { x: single.box.width, y: single.box.height },
      ],
    );
    const expected = transformMatrix(single.transform, single.box, canvas);
    for (const key of ["a", "b", "c", "d", "e", "f"] as const) {
      assert.ok(Math.abs(nested.matrix[key] - expected[key]) < 1e-6, key);
    }
  });
});

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

  it("nests a clip's Move inside its Transform, inside its layer's", () => {
    const box = frameBoxInCanvas(placement().frame, CANVAS);
    const layerTransform = transform({ positionX: 0.1, rotationDeg: 30 });
    const clipTransform = transform({ scaleX: 0.5, originX: -1 });
    const moved = resolveMoveTransform(linear, 0.25);
    const visual = {
      transform: layerTransform,
      clipTransform,
      clipMotion: { outer: [], inner: [moved] },
    };
    const expected = multiplyMatrix(
      nestedTransformMatrix(box, CANVAS, layerTransform, clipTransform),
      transformMatrix(moved, box, CANVAS),
    );
    const actual = visualTransformMatrix(box, CANVAS, visual);
    for (const key of ["a", "b", "c", "d", "e", "f"] as const) {
      assert.ok(Math.abs(actual[key] - expected[key]) < 1e-6, key);
    }
    assert.deepEqual(visualTransformChain(visual), [
      layerTransform,
      clipTransform,
      moved,
    ]);
    // A Move before the stack's Transform nests the Transform inside it.
    assert.deepEqual(
      visualTransformChain({
        clipTransform,
        clipMotion: { outer: [moved], inner: [] },
      }),
      [moved, clipTransform],
    );
  });

  it("composes several Moves in stack order", () => {
    const first = transform({ positionX: 0.25 });
    const second = transform({ scaleX: 2 });
    const chain = visualTransformChain({
      motion: { outer: [first, second], inner: [] },
    });
    assert.deepEqual(chain, [first, second]);
    assert.equal(isIdentityChain(chain), false);
    assert.equal(isIdentityChain([IDENTITY_TRANSFORM]), true);
    assert.equal(isIdentityChain([]), true);
  });

  it("resizes a text clip's box rather than its glyphs", () => {
    const band = { x: 0, y: 0, width: 400, height: 200 };
    const placed = resolveVisualTextBox(band, CANVAS, {
      clipMotion: {
        outer: [transform({ scaleX: 2, originX: -1, originY: -1 })],
        inner: [],
      },
    });
    assert.deepEqual(placed.box, { x: 0, y: 0, width: 800, height: 200 });
    assertPoint(applyMatrix(placed.matrix, { x: 800, y: 200 }), {
      x: 800,
      y: 200,
    });
  });
});
