import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IDENTITY_TRANSFORM,
  type LayerTransform,
  type Point,
} from "./composition-transform.ts";
import { addEffect } from "./fx-stack.ts";
import {
  findLayerTransform,
  readLayerTransform,
  setLayerTransformParameters,
} from "./preview-edit.ts";
import {
  handleName,
  layerPointInCanvas,
  MOVE_ORIGIN_HISTORY_LABEL,
  moveOrigin,
  RESIZE_HANDLES,
  type ResizeHandle,
  resizeCursor,
  resizeHistoryLabel,
  resizeTransform,
  setOrigin,
  snapOriginPoint,
  TRANSFORM_SCALE_MAX,
  TRANSFORM_SCALE_MIN,
} from "./preview-resize.ts";

const EPSILON = 1e-6;
const CANVAS = { width: 1000, height: 500 };
const BOX = { x: 100, y: 50, width: 400, height: 200 };

function assertClose(actual: number, expected: number, message = "") {
  assert.ok(
    Math.abs(actual - expected) < EPSILON,
    `${message} expected ${actual} to be close to ${expected}`,
  );
}

function assertPointClose(actual: Point, expected: Point, message = "") {
  assertClose(actual.x, expected.x, `${message} x:`);
  assertClose(actual.y, expected.y, `${message} y:`);
}

function transform(values: Partial<LayerTransform> = {}): LayerTransform {
  return { ...IDENTITY_TRANSFORM, ...values };
}

function at(local: Point, value: LayerTransform) {
  return layerPointInCanvas(local, value, BOX, CANVAS);
}

const MODIFIERS = [
  { proportional: false, fromCenter: false },
  { proportional: true, fromCenter: false },
  { proportional: false, fromCenter: true },
  { proportional: true, fromCenter: true },
];

const STARTS: Array<[string, LayerTransform]> = [
  ["identity", transform()],
  [
    "moved, scaled, off-centre origin",
    transform({
      positionX: 0.1,
      positionY: -0.2,
      scaleX: 1.5,
      scaleY: 0.75,
      originX: 0.5,
      originY: -0.25,
    }),
  ],
  [
    "rotated 30°",
    transform({ scaleX: 1.2, scaleY: 0.8, originX: -0.4, rotationDeg: 30 }),
  ],
  ["rotated -90°", transform({ rotationDeg: -90, originY: 0.6 })],
];

// A pointer move that grows the box outward through the handle, in canvas
// pixels, turned with the box.
function outwardDelta(handle: ResizeHandle, start: LayerTransform) {
  const radians = (start.rotationDeg * Math.PI) / 180;
  const local = { x: handle.x * 30 + 7, y: handle.y * 20 - 5 };
  return {
    x: Math.cos(radians) * local.x - Math.sin(radians) * local.y,
    y: Math.sin(radians) * local.x + Math.cos(radians) * local.y,
  };
}

describe("resizeTransform", () => {
  for (const [label, start] of STARTS) {
    for (const handle of RESIZE_HANDLES) {
      for (const options of MODIFIERS) {
        const name = `${label}: ${handleName(handle)} handle${
          options.proportional ? " + Shift" : ""
        }${options.fromCenter ? " + Ctrl/Cmd" : ""}`;

        it(`${name} keeps the fixed point in place`, () => {
          const delta = outwardDelta(handle, start);
          const { transform: next } = resizeTransform(
            start,
            handle,
            delta,
            BOX,
            CANVAS,
            options,
          );
          const fixed = options.fromCenter
            ? { x: 0, y: 0 }
            : { x: -handle.x, y: -handle.y };
          assertPointClose(at(fixed, next), at(fixed, start), "fixed point");
          // Rotation and origin never change.
          assert.equal(next.rotationDeg, start.rotationDeg);
          assert.equal(next.originX, start.originX);
          assert.equal(next.originY, start.originY);
        });

        it(`${name} scales the dragged axes`, () => {
          const delta = outwardDelta(handle, start);
          const { transform: next } = resizeTransform(
            start,
            handle,
            delta,
            BOX,
            CANVAS,
            options,
          );
          if (options.proportional) {
            // Both axes grow by the same factor.
            assertClose(
              next.scaleX / start.scaleX,
              next.scaleY / start.scaleY,
              "aspect",
            );
            assert.ok(next.scaleX > start.scaleX);
            return;
          }

          if (handle.x === 0) {
            assert.equal(next.scaleX, start.scaleX);
          } else {
            assert.ok(next.scaleX > start.scaleX);
          }
          if (handle.y === 0) {
            assert.equal(next.scaleY, start.scaleY);
          } else {
            assert.ok(next.scaleY > start.scaleY);
          }
        });
      }
    }
  }

  it("moves a plain-dragged handle with the pointer along its axes", () => {
    const start = transform({ rotationDeg: 30, originX: 0.3 });
    const handle = { x: 1, y: 1 } as const;
    const delta = outwardDelta(handle, start);
    const { transform: next } = resizeTransform(
      start,
      handle,
      delta,
      BOX,
      CANVAS,
    );
    const before = at(handle, start);
    assertPointClose(at(handle, next), {
      x: before.x + delta.x,
      y: before.y + delta.y,
    });
  });

  it("drags the right edge 100px on an unrotated box", () => {
    const { transform: next } = resizeTransform(
      transform(),
      { x: 1, y: 0 },
      { x: 100, y: 40 },
      BOX,
      CANVAS,
    );
    // 400px wide becomes 500px; the left edge stays at x = 100.
    assertClose(next.scaleX, 1.25);
    assert.equal(next.scaleY, 1);
    assertClose(at({ x: -1, y: 0 }, next).x, 100);
    assertClose(at({ x: 1, y: 0 }, next).x, 600);
  });

  it("grows symmetrically about the centre with Ctrl/Cmd", () => {
    const { transform: next } = resizeTransform(
      transform(),
      { x: 1, y: 0 },
      { x: 100, y: 0 },
      BOX,
      CANVAS,
      { fromCenter: true },
    );
    // Each side moves 100px.
    assertClose(next.scaleX, 1.5);
    assertClose(at({ x: -1, y: 0 }, next).x, 0);
    assertClose(at({ x: 1, y: 0 }, next).x, 600);
  });

  it("uses the box centre, not the origin, for Ctrl/Cmd", () => {
    const start = transform({ originX: 1, originY: 1 });
    const { transform: next } = resizeTransform(
      start,
      { x: 1, y: 1 },
      { x: 40, y: 20 },
      BOX,
      CANVAS,
      { fromCenter: true },
    );
    assertPointClose(at({ x: 0, y: 0 }, next), at({ x: 0, y: 0 }, start));
  });

  it("scales the other axis with Shift on an edge, centred on it", () => {
    const { transform: next } = resizeTransform(
      transform(),
      { x: 1, y: 0 },
      { x: 200, y: 0 },
      BOX,
      CANVAS,
      { proportional: true },
    );
    assertClose(next.scaleX, 1.5);
    assertClose(next.scaleY, 1.5);
    // The left edge's midpoint stays put, so the height grows both ways.
    assertPointClose(at({ x: -1, y: 0 }, next), { x: 100, y: 150 });
    assertClose(at({ x: 0, y: -1 }, next).y, 0);
    assertClose(at({ x: 0, y: 1 }, next).y, 300);
  });

  it("scales a corner by the same factor with Shift", () => {
    const { transform: next } = resizeTransform(
      transform({ scaleX: 2, scaleY: 1 }),
      { x: 1, y: 1 },
      { x: 400, y: 0 },
      BOX,
      CANVAS,
      { proportional: true },
    );
    assertClose(next.scaleX / next.scaleY, 2);
    assert.ok(next.scaleX > 2);
  });

  it("clamps at the minimum instead of flipping past the fixed edge", () => {
    const { transform: next } = resizeTransform(
      transform(),
      { x: 1, y: 0 },
      { x: -900, y: 0 },
      BOX,
      CANVAS,
    );
    assert.equal(next.scaleX, TRANSFORM_SCALE_MIN);
    // The left edge is still fixed, so the layer doesn't jump.
    assertClose(at({ x: -1, y: 0 }, next).x, 100);
  });

  it("clamps at the maximum scale", () => {
    const { transform: next } = resizeTransform(
      transform(),
      { x: 1, y: 1 },
      { x: 10_000, y: 10_000 },
      BOX,
      CANVAS,
    );
    assert.equal(next.scaleX, TRANSFORM_SCALE_MAX);
    assert.equal(next.scaleY, TRANSFORM_SCALE_MAX);
  });

  it("keeps the aspect ratio while clamping a proportional drag", () => {
    const { transform: next } = resizeTransform(
      transform({ scaleX: 2, scaleY: 1 }),
      { x: 1, y: 1 },
      { x: -5000, y: -5000 },
      BOX,
      CANVAS,
      { proportional: true },
    );
    assertClose(next.scaleY, TRANSFORM_SCALE_MIN);
    assertClose(next.scaleX, TRANSFORM_SCALE_MIN * 2);
  });

  it("snaps a moving edge to the canvas edge and reports the guide", () => {
    const result = resizeTransform(
      transform(),
      { x: 1, y: 0 },
      // The right edge lands 4px short of the canvas's right edge.
      { x: 496, y: 0 },
      BOX,
      CANVAS,
      {},
      { xLines: [0, 500, 1000], yLines: [0, 250, 500], threshold: 6 },
    );
    assertClose(at({ x: 1, y: 0 }, result.transform).x, 1000);
    assert.deepEqual(result.guides, { x: [1000], y: [] });
  });

  it("snaps a corner on both axes", () => {
    const result = resizeTransform(
      transform(),
      { x: -1, y: -1 },
      { x: -97, y: -52 },
      BOX,
      CANVAS,
      {},
      { xLines: [0, 500, 1000], yLines: [0, 250, 500], threshold: 6 },
    );
    assertPointClose(at({ x: -1, y: -1 }, result.transform), { x: 0, y: 0 });
    assert.deepEqual(result.guides, { x: [0], y: [0] });
  });

  it("does not snap with modifiers held or on a rotated box", () => {
    const snap = {
      xLines: [0, 500, 1000],
      yLines: [0, 250, 500],
      threshold: 6,
    };
    for (const [start, options] of [
      [transform(), { proportional: true }],
      [transform(), { fromCenter: true }],
      [transform({ rotationDeg: 10 }), {}],
    ] as const) {
      const result = resizeTransform(
        start,
        { x: 1, y: 0 },
        { x: 496, y: 0 },
        BOX,
        CANVAS,
        options,
        snap,
      );
      assert.deepEqual(result.guides, { x: [], y: [] });
    }
  });

  it("does not snap farther than the threshold", () => {
    const result = resizeTransform(
      transform(),
      { x: 1, y: 0 },
      { x: 490, y: 0 },
      BOX,
      CANVAS,
      {},
      { xLines: [0, 500, 1000], yLines: [0, 250, 500], threshold: 6 },
    );
    assertClose(at({ x: 1, y: 0 }, result.transform).x, 990);
    assert.deepEqual(result.guides, { x: [], y: [] });
  });
});

describe("resizeCursor", () => {
  it("names the cursor for each handle of an unrotated box", () => {
    const cursors = Object.fromEntries(
      RESIZE_HANDLES.map((handle) => [
        handleName(handle),
        resizeCursor(handle, 0),
      ]),
    );
    assert.deepEqual(cursors, {
      nw: "nwse-resize",
      n: "ns-resize",
      ne: "nesw-resize",
      e: "ew-resize",
      se: "nwse-resize",
      s: "ns-resize",
      sw: "nesw-resize",
      w: "ew-resize",
    });
  });

  it("turns the cursor with the box", () => {
    assert.equal(resizeCursor({ x: 1, y: 0 }, 45), "nwse-resize");
    assert.equal(resizeCursor({ x: 1, y: 0 }, 90), "ns-resize");
    assert.equal(resizeCursor({ x: 1, y: 0 }, -45), "nesw-resize");
    assert.equal(resizeCursor({ x: 0, y: -1 }, 90), "ew-resize");
  });
});

describe("moveOrigin", () => {
  for (const [label, start] of STARTS) {
    it(`${label}: moves the origin without moving the layer`, () => {
      const target = at({ x: 0.8, y: -0.6 }, start);
      const next = moveOrigin(start, target, BOX, CANVAS);
      assertClose(next.originX, 0.8);
      assertClose(next.originY, -0.6);
      for (const corner of RESIZE_HANDLES) {
        assertPointClose(at(corner, next), at(corner, start), "corner");
      }
      // The marker is drawn where it was dropped.
      assertPointClose(at({ x: next.originX, y: next.originY }, next), target);
      assert.equal(next.scaleX, start.scaleX);
      assert.equal(next.rotationDeg, start.rotationDeg);
    });
  }

  it("clamps the origin to the box", () => {
    const next = moveOrigin(transform(), { x: 900, y: -100 }, BOX, CANVAS);
    assert.equal(next.originX, 1);
    assert.equal(next.originY, -1);
  });

  it("resets to the centre without moving the layer", () => {
    const start = transform({
      originX: 0.7,
      originY: 0.2,
      rotationDeg: 45,
      scaleX: 2,
    });
    const next = setOrigin(start, { x: 0, y: 0 }, BOX, CANVAS);
    assert.equal(next.originX, 0);
    assert.equal(next.originY, 0);
    for (const corner of RESIZE_HANDLES) {
      assertPointClose(at(corner, next), at(corner, start));
    }
  });

  it("leaves a collapsed box alone", () => {
    const start = transform();
    assert.equal(
      moveOrigin(start, { x: 0, y: 0 }, { ...BOX, width: 0 }, CANVAS),
      start,
    );
  });
});

describe("snapOriginPoint", () => {
  it("snaps to the centre, corners and edge midpoints nearby", () => {
    const start = transform({ rotationDeg: 20 });
    for (const local of [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: -1, y: 0 },
    ]) {
      const exact = at(local, start);
      assertPointClose(
        snapOriginPoint(
          { x: exact.x + 3, y: exact.y - 2 },
          start,
          BOX,
          CANVAS,
          6,
        ),
        exact,
      );
    }
  });

  it("leaves a point that is not near a snap point", () => {
    const point = { x: 230, y: 110 };
    assert.deepEqual(
      snapOriginPoint(point, transform(), BOX, CANVAS, 6),
      point,
    );
  });
});

describe("layer Transform parameters", () => {
  it("reads the identity when the layer has no Transform", () => {
    assert.deepEqual(readLayerTransform([], "1"), IDENTITY_TRANSFORM);
  });

  it("adds a Transform and writes the given fields", () => {
    const result = setLayerTransformParameters(
      [],
      "1",
      { scaleX: 1.5, positionX: 0.25, originY: -0.5 },
      "new-transform",
    );
    assert.equal(findLayerTransform(result, "1")?.id, "new-transform");
    assert.deepEqual(readLayerTransform(result, "1"), {
      ...IDENTITY_TRANSFORM,
      scaleX: 1.5,
      positionX: 0.25,
      originY: -0.5,
    });
  });

  it("updates the existing Transform and turns it back on", () => {
    const effects = addEffect([], "1", "Transform", undefined, "t1").map(
      (effect) => ({ ...effect, enabled: false }),
    );
    const result = setLayerTransformParameters(
      effects,
      "1",
      { scaleY: 0.5 },
      "unused",
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].enabled, true);
    assert.equal(readLayerTransform(result, "1").scaleY, 0.5);
  });
});

describe("history labels", () => {
  it("names resize and origin steps", () => {
    assert.equal(resizeHistoryLabel("Layer 1"), "Resize Layer 1");
    assert.equal(MOVE_ORIGIN_HISTORY_LABEL, "Move origin");
  });
});
