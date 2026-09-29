import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Z_ORDER_COMPOSITION } from "./composition-order.ts";
import {
  IDENTITY_TRANSFORM,
  type LayerTransform,
  TRANSFORM_EFFECT_NAME,
} from "./composition-transform.ts";
import { addEffect, type SessionEffect } from "./fx-stack.ts";
import {
  canvasToScreen,
  constrainDragDelta,
  findLayerTransform,
  getPreviewEditTrackId,
  hitTestLayers,
  isPointOnLayer,
  matrixRotationDeg,
  offsetTransformPosition,
  readLayerTransformPosition,
  resolveNudgeDelta,
  resolvePreviewEditFrame,
  resolvePreviewLayers,
  resolveVideoRect,
  screenToCanvas,
  setLayerTransformParameters,
  setLayerTransformPosition,
  toParentDelta,
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

  it("gives an FX clip no band and the whole canvas as its box", () => {
    const layers = resolvePreviewLayers(
      [
        activeLayer("b", 1),
        { ...activeLayer("fx", 0), fx: true },
        activeLayer("c", 2),
      ],
      canvas,
    );
    // First, so a click only picks it where no other layer is.
    assert.deepEqual(
      layers.map((layer) => layer.laneId),
      ["fx", "b", "c"],
    );
    assert.deepEqual(layers[0].corners, [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
      { x: 0, y: 1000 },
    ]);
    // The two other layers share the canvas as if the FX clip were not
    // there.
    assert.deepEqual(layers[1].corners, [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 500 },
      { x: 0, y: 500 },
    ]);
  });

  it("follows the Order arrangement", () => {
    const layers = resolvePreviewLayers(
      [activeLayer("a", 0), activeLayer("b", 1)],
      canvas,
      { arrangement: "horizontal", gridSize: 2, spacing: 0 },
    );
    assert.deepEqual(layers[1].corners, [
      { x: 500, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
      { x: 500, y: 1000 },
    ]);
  });

  it("leaves out layers a Grid has no cell for", () => {
    const layers = resolvePreviewLayers(
      ["a", "b", "c", "d", "e"].map((id, rank) => activeLayer(id, rank)),
      canvas,
      { arrangement: "grid", gridSize: 2, spacing: 0 },
    );
    assert.deepEqual(
      layers.map((layer) => layer.laneId),
      ["a", "b", "c", "d"],
    );
  });

  it("gives every layer the whole canvas without an Order, Layer 1 last", () => {
    const layers = resolvePreviewLayers(
      [activeLayer("a", 0), activeLayer("b", 1), activeLayer("c", 2)],
      canvas,
      Z_ORDER_COMPOSITION,
    );
    assert.deepEqual(
      layers.map((layer) => layer.laneId),
      ["c", "b", "a"],
    );
    for (const layer of layers) {
      assert.deepEqual(layer.corners, [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 1000 },
        { x: 0, y: 1000 },
      ]);
    }
  });

  it("moves the corners with the Transform, past the canvas edge", () => {
    const [layer] = resolvePreviewLayers(
      [activeLayer("a", 0, { positionX: 0.5 })],
      canvas,
    );
    assertClose(layer.corners[0].x, 500);
    assertClose(layer.corners[1].x, 1500);
  });

  it("gives an excluded layer the whole canvas, on top when it is Layer 1", () => {
    const layers = resolvePreviewLayers(
      ["a", "b", "c", "d", "e"].map((id, rank) => activeLayer(id, rank)),
      canvas,
      { arrangement: "grid", gridSize: 2, spacing: 0, excludedLayers: ["a"] },
    );
    // Drawn last, so a click picks it wherever it is.
    assert.deepEqual(
      layers.map((layer) => layer.laneId),
      ["e", "d", "c", "b", "a"],
    );
    assert.deepEqual(layers[4].corners, [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
      { x: 0, y: 1000 },
    ]);
    // Layer 2 takes the first cell.
    assert.deepEqual(layers[3].corners, [
      { x: 0, y: 0 },
      { x: 500, y: 0 },
      { x: 500, y: 500 },
      { x: 0, y: 500 },
    ]);
    assert.equal(
      hitTestLayers(layers, { x: 250, y: 250 }, canvas)?.laneId,
      "a",
    );
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

  it("picks Layer 1 where overlapping layers meet without an Order", () => {
    const layers = resolvePreviewLayers(
      [activeLayer("a", 0, { scaleX: 0.5, scaleY: 0.5 }), activeLayer("b", 1)],
      canvas,
      Z_ORDER_COMPOSITION,
    );
    assert.equal(
      hitTestLayers(layers, { x: 500, y: 500 }, canvas)?.laneId,
      "a",
    );
    // Outside Layer 1's shrunk box, the layer behind it is hit.
    assert.equal(
      hitTestLayers(layers, { x: 100, y: 100 }, canvas)?.laneId,
      "b",
    );
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

describe("clip Transform editing", () => {
  const canvas = { width: 1000, height: 1000 };
  // A layer moved right by a quarter, holding a clip at half size.
  const [layer] = resolvePreviewLayers(
    [
      {
        clip: { id: "clip-a", laneId: "a", startQ: 0 },
        laneRank: 0,
        isInBounds: true,
        visual: {
          transform: { ...IDENTITY_TRANSFORM, positionX: 0.25 },
          clipTransform: { ...IDENTITY_TRANSFORM, scaleX: 0.5, scaleY: 0.5 },
        },
      },
    ],
    canvas,
    Z_ORDER_COMPOSITION,
  );

  it("outlines the clip where it is drawn, inside its layer", () => {
    assert.deepEqual(layer.corners, [
      { x: 500, y: 250 },
      { x: 1000, y: 250 },
      { x: 1000, y: 750 },
      { x: 500, y: 750 },
    ]);
  });

  it("hits the clip only where it is drawn", () => {
    assert.equal(isPointOnLayer({ x: 750, y: 500 }, layer, canvas), true);
    assert.equal(isPointOnLayer({ x: 400, y: 500 }, layer, canvas), false);
  });

  it("edits the clip's Transform inside the layer's, or the layer's alone", () => {
    const clipFrame = resolvePreviewEditFrame(layer, true, canvas);
    assert.equal(clipFrame.transform.scaleX, 0.5);
    assert.deepEqual(clipFrame.corners, layer.corners);
    assert.equal(clipFrame.parent.e, 250);

    const layerFrame = resolvePreviewEditFrame(layer, false, canvas);
    assert.equal(layerFrame.transform.positionX, 0.25);
    assert.deepEqual(layerFrame.corners, [
      { x: 250, y: 0 },
      { x: 1250, y: 0 },
      { x: 1250, y: 1000 },
      { x: 250, y: 1000 },
    ]);
  });

  it("measures drags inside a scaled or turned layer in the clip's own space", () => {
    const scaled = {
      a: 2,
      b: 0,
      c: 0,
      d: 0.5,
      e: 30,
      f: 40,
    };
    assert.deepEqual(toParentDelta(scaled, { x: 10, y: 10 }), { x: 5, y: 20 });

    const turned = {
      ...IDENTITY_TRANSFORM,
      rotationDeg: 90,
    };
    const turnedFrame = resolvePreviewEditFrame(
      { ...layer, transform: turned },
      true,
      canvas,
    );
    assertClose(matrixRotationDeg(turnedFrame.parent), 90);
    // Dragging down the screen moves the clip along the layer's own +x.
    const delta = toParentDelta(turnedFrame.parent, { x: 0, y: 10 });
    assertClose(delta.x, 10);
    assertClose(delta.y, 0);
  });

  it("writes a selected clip's Transform to the clip's own stack", () => {
    const base = [effect("layout-a", "a", "Layout")];
    const trackId = getPreviewEditTrackId({ laneId: "a", clipId: "clip-a" });
    assert.equal(trackId, "clip:clip-a");
    assert.equal(getPreviewEditTrackId({ laneId: "a" }), "a");

    const moved = setLayerTransformPosition(
      base,
      trackId,
      { x: 0.1, y: 0.2 },
      "clip-transform",
    );
    assert.deepEqual(
      moved.map((entry) => [entry.id, entry.trackId]),
      [
        ["layout-a", "a"],
        ["clip-transform", "clip:clip-a"],
      ],
    );
    assert.deepEqual(readLayerTransformPosition(moved, trackId), {
      x: 0.1,
      y: 0.2,
    });
    // The layer's own Transform is untouched.
    assert.equal(findLayerTransform(moved, "a"), undefined);

    const resized = setLayerTransformParameters(
      base,
      trackId,
      { scaleX: 0.5 },
      "clip-transform",
    );
    assert.equal(findLayerTransform(resized, trackId)?.id, "clip-transform");
  });
});
