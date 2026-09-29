import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IDENTITY_TRANSFORM,
  type LayerTransform,
  layerBoxInCanvas,
  TRANSFORM_EFFECT_NAME,
} from "./composition-transform.ts";
import { addEffect, type SessionEffect } from "./fx-stack.ts";
import {
  canvasToScreen,
  constrainDragDelta,
  findLayerTransform,
  formatRotation,
  hitTestLayers,
  layerOriginInCanvas,
  offsetTransformPosition,
  readLayerTransformPosition,
  readLayerTransformRotation,
  resolveNudgeDelta,
  resolvePreviewLayers,
  resolveVideoRect,
  rotateTransform,
  screenToCanvas,
  setLayerTransformPosition,
  setLayerTransformRotation,
  wrapRotation,
} from "./preview-edit.ts";

const EPSILON = 1e-9;

function assertClose(actual: number, expected: number) {
  assert.ok(
    Math.abs(actual - expected) < EPSILON,
    `expected ${actual} to be close to ${expected}`,
  );
}

function effect(
  id: string,
  trackId: string,
  effectName: string,
  parameters: SessionEffect["parameters"] = [],
  enabled = true,
): SessionEffect {
  return { id, trackId, effectName, parameters, enabled };
}

function activeLayer(
  laneId: string,
  laneRank: number,
  transform?: Partial<LayerTransform>,
) {
  return {
    clip: { id: `clip-${laneId}`, laneId, startQ: 0 },
    laneRank,
    isInBounds: true,
    visual: transform
      ? { transform: { ...IDENTITY_TRANSFORM, ...transform } }
      : {},
  };
}

describe("resolveVideoRect", () => {
  it("pillarboxes a portrait canvas in a wide monitor", () => {
    const rect = resolveVideoRect(
      { width: 800, height: 400 },
      { width: 1080, height: 1920 },
    );
    assertClose(rect.height, 400);
    assertClose(rect.width, 225);
    assertClose(rect.left, (800 - 225) / 2);
    assertClose(rect.top, 0);
  });

  it("letterboxes a landscape canvas in a tall monitor", () => {
    const rect = resolveVideoRect(
      { width: 400, height: 800 },
      { width: 1920, height: 1080 },
    );
    assertClose(rect.width, 400);
    assertClose(rect.height, 225);
    assertClose(rect.left, 0);
    assertClose(rect.top, (800 - 225) / 2);
  });

  it("magnifies about the monitor centre with zoom", () => {
    const rect = resolveVideoRect(
      { width: 400, height: 400 },
      { width: 100, height: 100 },
      2,
    );
    assert.deepEqual(rect, { left: -200, top: -200, width: 800, height: 800 });
  });
});

describe("screenToCanvas", () => {
  const canvas = { width: 1080, height: 1920 };
  const video = resolveVideoRect({ width: 800, height: 400 }, canvas);

  it("maps the letterboxed video corners onto the canvas corners", () => {
    assert.deepEqual(
      screenToCanvas({ x: video.left, y: video.top }, video, canvas),
      { x: 0, y: 0 },
    );
    const bottomRight = screenToCanvas(
      { x: video.left + video.width, y: video.top + video.height },
      video,
      canvas,
    );
    assertClose(bottomRight.x, 1080);
    assertClose(bottomRight.y, 1920);
  });

  it("maps points in the letterbox bars outside the canvas", () => {
    const point = screenToCanvas({ x: 10, y: 200 }, video, canvas);
    assert.ok(point.x < 0);
  });

  it("round-trips through canvasToScreen", () => {
    const screen = { x: 412.5, y: 123.25 };
    const back = canvasToScreen(
      screenToCanvas(screen, video, canvas),
      video,
      canvas,
    );
    assertClose(back.x, screen.x);
    assertClose(back.y, screen.y);
  });

  it("places canvas points past the edge outside the video rect", () => {
    const outside = canvasToScreen({ x: 1620, y: -100 }, video, canvas);
    assert.ok(outside.x > video.left + video.width);
    assert.ok(outside.y < video.top);
  });
});

describe("resolvePreviewLayers", () => {
  const canvas = { width: 1000, height: 1000 };

  it("gives each in-bounds layer its band, in draw order", () => {
    const layers = resolvePreviewLayers(
      [
        activeLayer("b", 1),
        activeLayer("a", 0),
        { ...activeLayer("gone", 2), isInBounds: false },
      ],
      canvas,
    );
    assert.deepEqual(
      layers.map((layer) => layer.laneId),
      ["a", "b"],
    );
    assert.deepEqual(layers[0].corners, [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 500 },
      { x: 0, y: 500 },
    ]);
  });

  it("moves the corners with the Transform, past the canvas edge", () => {
    const [layer] = resolvePreviewLayers(
      [activeLayer("a", 0, { positionX: 0.5 })],
      canvas,
    );
    assertClose(layer.corners[0].x, 500);
    assertClose(layer.corners[1].x, 1500);
  });
});

describe("hitTestLayers", () => {
  const canvas = { width: 1000, height: 1000 };

  it("hits a layer only inside its transformed box", () => {
    // A lone layer fills the canvas; half size about its centre is 250..750.
    const layers = resolvePreviewLayers(
      [activeLayer("a", 0, { scaleX: 0.5, scaleY: 0.5 })],
      canvas,
    );
    assert.equal(
      hitTestLayers(layers, { x: 500, y: 600 }, canvas)?.laneId,
      "a",
    );
    assert.equal(hitTestLayers(layers, { x: 500, y: 100 }, canvas), undefined);
  });

  it("follows rotation", () => {
    // A narrow box turned 45 degrees no longer covers the band's corner.
    const layers = resolvePreviewLayers(
      [activeLayer("a", 0, { rotationDeg: 45, scaleX: 0.2 })],
      canvas,
    );
    assert.equal(hitTestLayers(layers, { x: 10, y: 10 }, canvas), undefined);
    assert.equal(
      hitTestLayers(layers, { x: 500, y: 600 }, canvas)?.laneId,
      "a",
    );
  });

  it("picks the layer drawn last where layers overlap", () => {
    // Layer b is drawn second and moved up over layer a.
    const layers = resolvePreviewLayers(
      [activeLayer("a", 0), activeLayer("b", 1, { positionY: -0.25 })],
      canvas,
    );
    assert.equal(
      hitTestLayers(layers, { x: 500, y: 400 }, canvas)?.laneId,
      "b",
    );
    assert.equal(
      hitTestLayers(layers, { x: 500, y: 100 }, canvas)?.laneId,
      "a",
    );
    assert.equal(hitTestLayers(layers, { x: 500, y: 900 }, canvas), undefined);
  });
});

describe("drag maths", () => {
  it("locks a Shift drag to its dominant axis", () => {
    assert.deepEqual(constrainDragDelta({ x: 5, y: -3 }, true), {
      x: 5,
      y: 0,
    });
    assert.deepEqual(constrainDragDelta({ x: 2, y: -7 }, true), {
      x: 0,
      y: -7,
    });
    assert.deepEqual(constrainDragDelta({ x: 2, y: -7 }, false), {
      x: 2,
      y: -7,
    });
  });

  it("converts canvas pixels into canvas widths and heights", () => {
    const next = offsetTransformPosition(
      { x: 0.1, y: -0.2 },
      { x: 192, y: 108 },
      { width: 1920, height: 1080 },
    );
    assertClose(next.x, 0.2);
    assertClose(next.y, -0.1);
  });

  it("clamps positions to the Transform range", () => {
    assert.deepEqual(
      offsetTransformPosition(
        { x: 1.9, y: -1.9 },
        { x: 1000, y: -1000 },
        { width: 100, height: 100 },
      ),
      { x: 2, y: -2 },
    );
  });

  it("nudges by 1px, or 10px with Shift", () => {
    assert.deepEqual(resolveNudgeDelta("ArrowLeft", false), { x: -1, y: 0 });
    assert.deepEqual(resolveNudgeDelta("ArrowDown", true), { x: 0, y: 10 });
    assert.equal(resolveNudgeDelta("Enter", false), undefined);
  });
});

describe("setLayerTransformPosition", () => {
  const base = [
    effect("layout-a", "a", "Layout"),
    effect("blur-a", "a", "Blur"),
    effect("layout-b", "b", "Layout"),
  ];

  it("adds a Transform at the end of the layer's stack and writes PositionX/Y", () => {
    const next = setLayerTransformPosition(
      base,
      "a",
      { x: 0.25, y: -0.5 },
      "transform-a",
    );
    assert.deepEqual(
      next.map((entry) => entry.id),
      ["layout-a", "blur-a", "transform-a", "layout-b"],
    );
    assert.equal(
      findLayerTransform(next, "a")?.effectName,
      TRANSFORM_EFFECT_NAME,
    );
    assert.deepEqual(readLayerTransformPosition(next, "a"), {
      x: 0.25,
      y: -0.5,
    });
    assert.deepEqual(readLayerTransformPosition(next, "b"), { x: 0, y: 0 });
  });

  it("updates an existing Transform without adding another", () => {
    const withTransform = addEffect(
      base,
      "a",
      TRANSFORM_EFFECT_NAME,
      undefined,
      "existing",
    );
    const next = setLayerTransformPosition(
      withTransform,
      "a",
      { x: -0.1, y: 0.3 },
      "unused",
    );
    assert.equal(next.length, withTransform.length);
    assert.equal(findLayerTransform(next, "a")?.id, "existing");
    assert.deepEqual(readLayerTransformPosition(next, "a"), {
      x: -0.1,
      y: 0.3,
    });
  });

  it("edits the enabled Transform and turns a bypassed only one back on", () => {
    const bypassed = [
      ...base,
      effect("off", "a", TRANSFORM_EFFECT_NAME, [], false),
    ];
    const next = setLayerTransformPosition(
      bypassed,
      "a",
      { x: 0.1, y: 0 },
      "unused",
    );
    assert.equal(next.length, bypassed.length);
    assert.equal(findLayerTransform(next, "a")?.enabled, true);

    const both = [
      ...bypassed,
      effect("on", "a", TRANSFORM_EFFECT_NAME, [], true),
      effect("off-2", "a", TRANSFORM_EFFECT_NAME, [], false),
    ];
    assert.equal(findLayerTransform(both, "a")?.id, "on");
  });

  it("returns the same array when the position is unchanged", () => {
    const once = setLayerTransformPosition(base, "a", { x: 0.2, y: 0 }, "t");
    assert.equal(
      setLayerTransformPosition(once, "a", { x: 0.2, y: 0 }, "t2"),
      once,
    );
  });
});

describe("rotateTransform", () => {
  const canvas = { width: 1000, height: 1000 };
  const fullFrame = { frame: { centerX: 0, centerY: 0, halfWidth: 1, halfHeight: 1 } };

  function rotateBy(startDeg: number, turnDeg: number, snap15 = false) {
    // Turn a pointer 100px from the origin by `turnDeg`, clockwise.
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

  it("turns the layer about its centre by the pointer's angle", () => {
    const start = IDENTITY_TRANSFORM;
    const origin = layerOriginInCanvas(
      { placement: fullFrame, transform: start },
      canvas,
    );
    assert.deepEqual(origin, { x: 500, y: 500 });

    // From straight above the centre to straight right of it: a quarter turn
    // clockwise.
    const next = rotateTransform(
      start,
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
    // Origin at the box's top-left corner, with the box moved right 10%.
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

describe("setLayerTransformRotation", () => {
  const base = [effect("layout-a", "a", "Layout")];

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
