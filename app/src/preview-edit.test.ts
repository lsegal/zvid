import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addEffect, type SessionEffect } from "./fx-stack.ts";
import {
  canvasToScreen,
  clipSpaceToCanvas,
  constrainDragDelta,
  findLayerTransform,
  hitTestLayers,
  isPointInQuad,
  offsetTransformPosition,
  type Quad,
  readLayerTransformPosition,
  resolveNudgeDelta,
  resolveVideoRect,
  screenToCanvas,
  setLayerTransformPosition,
  TRANSFORM_EFFECT_NAME,
} from "./preview-edit.ts";

const EPSILON = 1e-9;

function assertClose(actual: number, expected: number) {
  assert.ok(
    Math.abs(actual - expected) < EPSILON,
    `expected ${actual} to be close to ${expected}`,
  );
}

function rectQuad(left: number, top: number, width: number, height: number) {
  return [
    { x: left, y: top },
    { x: left + width, y: top },
    { x: left + width, y: top + height },
    { x: left, y: top + height },
  ] as const satisfies Quad;
}

function effect(
  id: string,
  trackId: string,
  effectName: string,
  parameters: SessionEffect["parameters"] = [],
): SessionEffect {
  return { id, trackId, effectName, parameters, enabled: true };
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
});

describe("clipSpaceToCanvas", () => {
  it("puts clip-space +y at the top of the canvas", () => {
    const canvas = { width: 200, height: 100 };
    assert.deepEqual(clipSpaceToCanvas({ x: -1, y: 1 }, canvas), {
      x: 0,
      y: 0,
    });
    assert.deepEqual(clipSpaceToCanvas({ x: 1, y: -1 }, canvas), {
      x: 200,
      y: 100,
    });
  });
});

describe("hit-testing", () => {
  it("finds points inside, on the edge of and outside a quad", () => {
    const quad = rectQuad(0, 0, 10, 10);
    assert.equal(isPointInQuad({ x: 5, y: 5 }, quad), true);
    assert.equal(isPointInQuad({ x: 10, y: 5 }, quad), true);
    assert.equal(isPointInQuad({ x: 11, y: 5 }, quad), false);
  });

  it("handles rotated quads in either winding", () => {
    const diamond: Quad = [
      { x: 5, y: 0 },
      { x: 10, y: 5 },
      { x: 5, y: 10 },
      { x: 0, y: 5 },
    ];
    const reversed: Quad = [diamond[3], diamond[2], diamond[1], diamond[0]];
    for (const quad of [diamond, reversed]) {
      assert.equal(isPointInQuad({ x: 5, y: 5 }, quad), true);
      assert.equal(isPointInQuad({ x: 1, y: 1 }, quad), false);
    }
  });

  it("picks the layer drawn last where layers overlap", () => {
    const layers = [
      { id: "bottom", quad: rectQuad(0, 0, 100, 100) },
      { id: "top", quad: rectQuad(50, 50, 100, 100) },
    ];
    assert.equal(hitTestLayers(layers, { x: 75, y: 75 })?.id, "top");
    assert.equal(hitTestLayers(layers, { x: 25, y: 25 })?.id, "bottom");
    assert.equal(hitTestLayers(layers, { x: 140, y: 140 })?.id, "top");
    assert.equal(hitTestLayers(layers, { x: 200, y: 10 }), undefined);
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
    const transform = findLayerTransform(next, "a");
    assert.equal(transform?.effectName, TRANSFORM_EFFECT_NAME);
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

  it("returns the same array when the position is unchanged", () => {
    const once = setLayerTransformPosition(base, "a", { x: 0.2, y: 0 }, "t");
    assert.equal(
      setLayerTransformPosition(once, "a", { x: 0.2, y: 0 }, "t2"),
      once,
    );
  });
});
