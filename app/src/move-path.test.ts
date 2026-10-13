import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveVisualState,
  type SessionEffect,
} from "./composition-active-clips.ts";
import { resolveCanvasBounds } from "./composition-layout.ts";
import {
  applyMatrix,
  frameBoxInCanvas,
  IDENTITY_TRANSFORM,
  type Point,
  visualTransformMatrix,
} from "./composition-transform.ts";
import { clipEffectTrackId } from "./fx-stack.ts";
import {
  findPathMove,
  nearestAlongPath,
  resolveMovePath,
} from "./move-path.ts";
import {
  offsetTransformPosition,
  type PreviewLayer,
  toParentDelta,
} from "./preview-edit.ts";

const CANVAS = { width: 1920, height: 1080 };
const CLIP_TRACK = clipEffectTrackId("c1");

function effect(
  id: string,
  trackId: string,
  effectName: string,
  values: Record<string, number | string>,
): SessionEffect {
  return {
    id,
    trackId,
    effectName,
    parameters: Object.entries(values).map(([key, value]) => ({
      key,
      value: String(value),
    })),
  };
}

// A Move on the clip from the left to the right through a raised waypoint,
// in a layer its Transform shrinks and turns.
const EFFECTS = [
  effect("t", "1", "Transform", { ScaleX: 0.5, ScaleY: 0.5, Rotation: 30 }),
  effect("m", CLIP_TRACK, "Move", {
    Motion: "Linear",
    Waypoints: "1",
    StartPositionX: -0.4,
    Point1PositionY: -0.3,
    Point1ScaleX: 2,
    EndPositionX: 0.4,
  }),
];

function layerAt(effects: SessionEffect[], progress: number): PreviewLayer {
  const visual = resolveVisualState(effects, "1", "c1", progress);
  return {
    laneId: "1",
    clipId: "c1",
    placement: { frame: resolveCanvasBounds(CANVAS.width, CANVAS.height) },
    transform: visual.transform ?? IDENTITY_TRANSFORM,
    clipTransform: visual.clipTransform ?? IDENTITY_TRANSFORM,
    ...(visual.motion && { motion: visual.motion }),
    ...(visual.clipMotion && { clipMotion: visual.clipMotion }),
    ...(visual.moves && { moves: visual.moves }),
    corners: [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ],
  };
}

// Where the compositor draws the clip's box center at `progress`.
function renderedCenter(effects: SessionEffect[], progress: number) {
  const layer = layerAt(effects, progress);
  const box = frameBoxInCanvas(layer.placement.frame, CANVAS);
  return applyMatrix(visualTransformMatrix(box, CANVAS, layer), {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  });
}

function assertNear(actual: Point, expected: Point) {
  assert.ok(
    Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-6,
    `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`,
  );
}

describe("resolveMovePath", () => {
  it("follows the rendered motion exactly, wherever the playhead is", () => {
    const layer = layerAt(EFFECTS, 0.7);
    const source = findPathMove(layer, { laneId: "1", clipId: "c1" }, "");
    assert.ok(source);
    const path = resolveMovePath(layer, source, CANVAS);

    assert.equal(path.points.length, 3);
    assertNear(path.points[0], renderedCenter(EFFECTS, 0));
    assertNear(path.points[1], renderedCenter(EFFECTS, 0.5));
    assertNear(path.points[2], renderedCenter(EFFECTS, 1));
    for (const sample of path.samples.filter((_, index) => index % 7 === 0)) {
      assertNear(sample.point, renderedCenter(EFFECTS, sample.along));
    }
  });

  it("runs straight from Start to End without waypoints", () => {
    const effects = [
      effect("m", CLIP_TRACK, "Move", {
        StartPositionX: -0.25,
        EndPositionY: 0.25,
      }),
    ];
    const layer = layerAt(effects, 0);
    const [source] = layer.moves ?? [];
    const path = resolveMovePath(layer, source, CANVAS);

    assert.deepEqual(path.points, [
      { x: 480, y: 540 },
      { x: 960, y: 810 },
    ]);
    for (const { point, along } of path.samples) {
      assertNear(point, { x: 480 + 480 * along, y: 540 + 270 * along });
    }
  });

  it("moves a dragged point by the pointer's travel through the layer's Transform", () => {
    const layer = layerAt(EFFECTS, 0);
    const [source] = layer.moves ?? [];
    const path = resolveMovePath(layer, source, CANVAS);
    const travel = { x: 120, y: -45 };
    const start = offsetTransformPosition(
      { x: source.move.start.positionX, y: source.move.start.positionY },
      toParentDelta(path.parent, travel),
      path.surface,
    );
    const moved = effect("m", CLIP_TRACK, "Move", {
      Motion: "Linear",
      Waypoints: "1",
      StartPositionX: start.x,
      StartPositionY: start.y,
      Point1PositionY: -0.3,
      Point1ScaleX: 2,
      EndPositionX: 0.4,
    });

    assertNear(renderedCenter([EFFECTS[0], moved], 0), {
      x: path.points[0].x + travel.x,
      y: path.points[0].y + travel.y,
    });
  });
});

describe("findPathMove", () => {
  const layer = layerAt(
    [
      effect("layer-move", "1", "Move", {}),
      effect("first", CLIP_TRACK, "Move", {}),
      effect("second", CLIP_TRACK, "Move", {}),
    ],
    0,
  );

  it("picks the selected clip's Move, the last one unless another is active", () => {
    const target = { laneId: "1", clipId: "c1" };
    assert.equal(findPathMove(layer, target, undefined)?.effectId, "second");
    assert.equal(findPathMove(layer, target, "first")?.effectId, "first");
  });

  it("falls back to the layer's Move", () => {
    assert.equal(
      findPathMove(layer, { laneId: "1" }, undefined)?.effectId,
      "layer-move",
    );
    const layerOnly = layerAt([effect("layer-move", "1", "Move", {})], 0);
    assert.equal(
      findPathMove(layerOnly, { laneId: "1", clipId: "c1" }, undefined)
        ?.effectId,
      "layer-move",
    );
  });
});

describe("nearestAlongPath", () => {
  it("finds how far along the path the nearest point is", () => {
    const samples = [
      { point: { x: 0, y: 0 }, along: 0 },
      { point: { x: 100, y: 0 }, along: 0.5 },
      { point: { x: 100, y: 100 }, along: 1 },
    ];
    const nearest = nearestAlongPath(samples, { x: 104, y: 50 });
    assert.equal(nearest.along, 0.75);
    assert.equal(nearest.distance, 4);
  });
});

describe("resolveVisualState Move sources", () => {
  it("places each Move inside or outside its stack's Transform", () => {
    const state = resolveVisualState(
      [
        effect("before", "1", "Move", {}),
        effect("t1", "1", "Transform", {}),
        effect("after", "1", "Move", {}),
        effect("clip", CLIP_TRACK, "Move", {}),
      ],
      "1",
      "c1",
    );
    assert.deepEqual(
      state.moves?.map(({ effectId, stack, slot, index }) => [
        effectId,
        stack,
        slot,
        index,
      ]),
      [
        ["before", "layer", "outer", 0],
        ["after", "layer", "inner", 0],
        ["clip", "clip", "outer", 0],
      ],
    );
  });

  it("moves a Move outside a Transform that a later one replaces", () => {
    const state = resolveVisualState(
      [
        effect("t1", "1", "Transform", {}),
        effect("m", "1", "Move", {}),
        effect("t2", "1", "Transform", {}),
      ],
      "1",
    );
    assert.deepEqual(
      state.moves?.map(({ slot, index }) => [slot, index]),
      [["outer", 0]],
    );
  });

  it("is unset without a Move", () => {
    assert.equal(resolveVisualState([], "1").moves, undefined);
  });
});
