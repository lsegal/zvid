import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type LayoutAnchor,
  orderStackedLayers,
  resolveCoverHalfExtents,
  resolveFrameBounds,
  resolveLayerPlacement,
} from "./composition-layout.ts";

const EPSILON = 1e-9;
const ANCHORS: LayoutAnchor[] = ["top", "center", "bottom"];
const CANVASES = [
  { name: "portrait canvas", width: 1080, height: 1920 },
  { name: "landscape canvas", width: 1920, height: 1080 },
];
const SOURCES = [
  { name: "portrait source", width: 1080, height: 1920 },
  { name: "landscape source", width: 1920, height: 1080 },
];

function visual(layoutAnchor: LayoutAnchor, scale = 1) {
  return { scale, translateX: 0, translateY: 0, layoutAnchor };
}

function place(
  canvas: { width: number; height: number },
  source: { width: number; height: number },
  index: number,
  count: number,
  anchor: LayoutAnchor,
) {
  return resolveLayerPlacement({
    index,
    count,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    sourceWidth: source.width,
    sourceHeight: source.height,
    visual: visual(anchor),
  });
}

function assertClose(actual: number, expected: number, message: string) {
  assert.ok(
    Math.abs(actual - expected) < 1e-6,
    `${message}: ${actual} != ${expected}`,
  );
}

describe("orderStackedLayers", () => {
  it("stacks the highest lane first, then earlier clips first", () => {
    const layers = [
      { id: "a", laneRank: 0, clip: { startQ: 0 } },
      { id: "b", laneRank: 2, clip: { startQ: 8 } },
      { id: "c", laneRank: 1, clip: { startQ: 0 } },
      { id: "d", laneRank: 2, clip: { startQ: 4 } },
    ];

    assert.deepEqual(
      orderStackedLayers(layers).map((layer) => layer.id),
      ["d", "b", "c", "a"],
    );
    assert.deepEqual(
      layers.map((layer) => layer.id),
      ["a", "b", "c", "d"],
      "the input is left in place",
    );
  });
});

describe("resolveFrameBounds", () => {
  for (const count of [1, 2, 3]) {
    it(`tiles the canvas with ${count} full-width band(s), top to bottom`, () => {
      let previousBottom = 1;
      for (let index = 0; index < count; index++) {
        const frame = resolveFrameBounds(index, count, 9 / 16);
        assert.equal(frame.centerX, 0);
        assert.equal(frame.halfWidth, 1);
        assertClose(
          frame.centerY + frame.halfHeight,
          previousBottom,
          `band ${index} starts where the band above ends`,
        );
        assertClose(frame.halfHeight * 2, 2 / count, `band ${index} height`);
        assertClose(frame.aspect, (9 / 16) * count, `band ${index} aspect`);
        previousBottom = frame.centerY - frame.halfHeight;
      }
      assertClose(previousBottom, -1, "the last band ends at the bottom");
    });
  }

  it("treats zero layers as one full-canvas band", () => {
    assert.deepEqual(resolveFrameBounds(0, 0, 1), resolveFrameBounds(0, 1, 1));
  });
});

describe("resolveCoverHalfExtents", () => {
  it("fills the band height and overflows sideways for wider sources", () => {
    const frame = resolveFrameBounds(0, 3, 9 / 16);
    const extents = resolveCoverHalfExtents(frame, 16 / 9, 9 / 16);
    assertClose(extents.y, frame.halfHeight, "height matches the band");
    assert.ok(extents.x > frame.halfWidth);
  });

  it("fills the band width and overflows vertically for taller sources", () => {
    const frame = resolveFrameBounds(0, 3, 9 / 16);
    const extents = resolveCoverHalfExtents(frame, 9 / 16, 9 / 16);
    assertClose(extents.x, frame.halfWidth, "width matches the band");
    assertClose(extents.y, 1, "a canvas-shaped source keeps its full height");
  });
});

describe("resolveLayerPlacement", () => {
  for (const canvas of CANVASES) {
    for (const source of SOURCES) {
      for (const count of [1, 2, 3]) {
        for (const anchor of ANCHORS) {
          it(`${count} layer(s), ${anchor}, ${source.name}, ${canvas.name}`, () => {
            const placements = Array.from({ length: count }, (_, index) =>
              place(canvas, source, index, count, anchor),
            );

            // Scissor boxes tile the canvas top to bottom with no gap or
            // overlap.
            let nextTop = canvas.height;
            for (const { scissor } of placements) {
              assert.equal(scissor.x, 0);
              assert.equal(scissor.width, canvas.width);
              assert.equal(scissor.y + scissor.height, nextTop);
              nextTop = scissor.y;
            }
            assert.equal(nextTop, 0);

            for (const [index, placement] of placements.entries()) {
              const { frame, halfExtents, translate } = placement;
              // The quad covers its band on every side.
              const left = translate.x - halfExtents.x;
              const right = translate.x + halfExtents.x;
              const top = translate.y + halfExtents.y;
              const bottom = translate.y - halfExtents.y;
              const bandTop = frame.centerY + frame.halfHeight;
              const bandBottom = frame.centerY - frame.halfHeight;
              assert.ok(left <= -1 + EPSILON, `band ${index} left edge`);
              assert.ok(right >= 1 - EPSILON, `band ${index} right edge`);
              assert.ok(top >= bandTop - EPSILON, `band ${index} top edge`);
              assert.ok(
                bottom <= bandBottom + EPSILON,
                `band ${index} bottom edge`,
              );

              // The quad keeps the source's aspect ratio in pixels.
              const drawnAspect =
                (halfExtents.x * canvas.width) /
                (halfExtents.y * canvas.height);
              assertClose(
                drawnAspect,
                source.width / source.height,
                `band ${index} aspect`,
              );

              // The anchor pins the matching edge of an overflowing source.
              if (anchor === "top") {
                assertClose(top, bandTop, `band ${index} pinned to its top`);
              } else if (anchor === "bottom") {
                assertClose(
                  bottom,
                  bandBottom,
                  `band ${index} pinned to its bottom`,
                );
              } else {
                assertClose(translate.y, frame.centerY, `band ${index} centre`);
              }
            }
          });
        }
      }
    }
  }

  it("scales around the anchored edge and offsets within the band", () => {
    const canvas = CANVASES[0];
    const placement = resolveLayerPlacement({
      index: 1,
      count: 3,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      sourceWidth: 1080,
      sourceHeight: 1920,
      visual: {
        scale: 2,
        translateX: 0.5,
        translateY: -0.5,
        layoutAnchor: "top",
      },
    });
    const { frame, halfExtents, translate } = placement;
    assertClose(halfExtents.x, 2, "scaled width");
    assertClose(halfExtents.y, 2, "scaled height");
    assertClose(translate.x, 0.5, "x offset in band widths");
    assertClose(
      translate.y,
      frame.centerY + frame.halfHeight - halfExtents.y - 0.5 * frame.halfHeight,
      "y offset in band heights from the pinned top",
    );
  });

  it("never shrinks a layer below cover", () => {
    const shrunk = resolveLayerPlacement({
      index: 0,
      count: 2,
      canvasWidth: 1080,
      canvasHeight: 1920,
      sourceWidth: 1920,
      sourceHeight: 1080,
      visual: visual("center", 0.5),
    });
    const cover = place(
      { width: 1080, height: 1920 },
      { width: 1920, height: 1080 },
      0,
      2,
      "center",
    );
    assert.deepEqual(shrunk.halfExtents, cover.halfExtents);
  });
});
