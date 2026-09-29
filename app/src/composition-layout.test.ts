import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type LayerDrawStep,
  type LayoutAnchor,
  orderStackedLayers,
  planLayerDraws,
  resolveBandScissor,
  resolveCoverHalfExtents,
  resolveFrameBounds,
  resolveLayerPlacement,
  resolveSlotBounds,
  resolveSlotScissor,
  resolveSpacingPixels,
  type ScissorBox,
} from "./composition-layout.ts";
import {
  type Arrangement,
  type CompositionOrder,
  DEFAULT_COMPOSITION_ORDER,
  Z_ORDER_COMPOSITION,
} from "./composition-order.ts";

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
  it("stacks the first lane first, then earlier clips first", () => {
    const layers = [
      { id: "a", laneRank: 0, clip: { startQ: 0 } },
      { id: "b", laneRank: 2, clip: { startQ: 8 } },
      { id: "c", laneRank: 1, clip: { startQ: 0 } },
      { id: "d", laneRank: 2, clip: { startQ: 4 } },
    ];

    assert.deepEqual(
      orderStackedLayers(layers).map((layer) => layer.id),
      ["a", "c", "d", "b"],
    );
    assert.deepEqual(
      layers.map((layer) => layer.id),
      ["a", "b", "c", "d"],
      "the input is left in place",
    );
  });

  it("draws the highest layer first and Layer 1 last without an Order", () => {
    const layers = [
      { id: "a", laneRank: 0, clip: { startQ: 0 } },
      { id: "b", laneRank: 2, clip: { startQ: 8 } },
      { id: "c", laneRank: 1, clip: { startQ: 0 } },
      { id: "d", laneRank: 2, clip: { startQ: 4 } },
    ];

    assert.deepEqual(
      orderStackedLayers(layers, Z_ORDER_COMPOSITION).map((layer) => layer.id),
      ["d", "b", "c", "a"],
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

function arranged(
  arrangement: Arrangement,
  spacing = 0,
  gridSize = 2,
): CompositionOrder {
  return { arrangement, gridSize, spacing };
}

// How many of `boxes` cover each pixel of a width × height surface.
function coverage(boxes: ScissorBox[], width: number, height: number) {
  const counts = new Uint8Array(width * height);
  for (const box of boxes) {
    for (let y = box.y; y < box.y + box.height; y++) {
      for (let x = box.x; x < box.x + box.width; x++) {
        counts[y * width + x]++;
      }
    }
  }
  return counts;
}

function slotScissors(
  count: number,
  order: CompositionOrder,
  width: number,
  height: number,
) {
  const slots =
    order.arrangement === "grid" ? order.gridSize * order.gridSize : count;
  return Array.from({ length: slots }, (_, index) =>
    resolveSlotScissor(index, count, order, width, height),
  );
}

describe("resolveSlotBounds", () => {
  it("matches today's bands for Vertical with no spacing", () => {
    for (const canvas of CANVASES) {
      for (let count = 1; count <= 6; count++) {
        for (let index = 0; index < count; index++) {
          const slot = resolveSlotBounds(
            index,
            count,
            arranged("vertical"),
            canvas.width,
            canvas.height,
          );
          const band = resolveFrameBounds(
            index,
            count,
            canvas.width / canvas.height,
          );
          for (const key of Object.keys(band) as Array<keyof typeof band>) {
            assertClose(slot[key], band[key], `${canvas.name} ${key}`);
          }
        }
      }
    }
  });

  it("puts Horizontal layers in equal full-height columns, left to right", () => {
    const count = 3;
    let previousRight = -1;
    for (let index = 0; index < count; index++) {
      const slot = resolveSlotBounds(
        index,
        count,
        arranged("horizontal"),
        1920,
        1080,
      );
      assertClose(slot.centerY, 0, "centred vertically");
      assertClose(slot.halfHeight, 1, "full height");
      assertClose(slot.halfWidth, 1 / count, "equal widths");
      assertClose(slot.centerX - slot.halfWidth, previousRight, "no gap");
      assertClose(slot.aspect, 1920 / count / 1080, "aspect");
      previousRight = slot.centerX + slot.halfWidth;
    }
    assertClose(previousRight, 1, "reaches the right edge");
  });

  it("fills equal Grid cells row by row, whatever the layer count", () => {
    for (let gridSize = 2; gridSize <= 6; gridSize++) {
      for (const count of [1, gridSize * gridSize, gridSize * gridSize + 3]) {
        for (let index = 0; index < gridSize * gridSize; index++) {
          const slot = resolveSlotBounds(
            index,
            count,
            arranged("grid", 0, gridSize),
            1080,
            1920,
          );
          const column = index % gridSize;
          const row = Math.floor(index / gridSize);
          const name = `grid ${gridSize} with ${count} layer(s), cell ${index}`;
          assertClose(slot.halfWidth, 1 / gridSize, `${name} width`);
          assertClose(slot.halfHeight, 1 / gridSize, `${name} height`);
          assertClose(
            slot.centerX,
            -1 + (2 * column + 1) / gridSize,
            `${name} x`,
          );
          assertClose(slot.centerY, 1 - (2 * row + 1) / gridSize, `${name} y`);
          assertClose(slot.aspect, 1080 / 1920, `${name} aspect`);
        }
      }
    }
  });

  it("leaves even gaps between slots but none at the canvas edges", () => {
    const width = 1920;
    const height = 1080;
    const order = arranged("grid", 10, 3);
    const gap = resolveSpacingPixels(order, width, height);
    assertClose(gap, 10, "10 px at 1080p");
    const toPixels = (index: number) => {
      const slot = resolveSlotBounds(index, 9, order, width, height);
      return {
        left: ((slot.centerX - slot.halfWidth + 1) / 2) * width,
        right: ((slot.centerX + slot.halfWidth + 1) / 2) * width,
        top: ((1 - slot.centerY - slot.halfHeight) / 2) * height,
        bottom: ((1 - slot.centerY + slot.halfHeight) / 2) * height,
      };
    };
    assertClose(toPixels(0).left, 0, "first column at the left edge");
    assertClose(toPixels(0).top, 0, "first row at the top edge");
    assertClose(toPixels(8).right, width, "last column at the right edge");
    assertClose(toPixels(8).bottom, height, "last row at the bottom edge");
    assertClose(toPixels(1).left - toPixels(0).right, gap, "column gap");
    assertClose(toPixels(3).top - toPixels(0).bottom, gap, "row gap");
    assertClose(
      toPixels(0).right - toPixels(0).left,
      toPixels(1).right - toPixels(1).left,
      "equal widths",
    );
  });

  it("leaves 50 px gaps at the widest spacing", () => {
    const order = arranged("horizontal", 50);
    assertClose(resolveSpacingPixels(order, 1920, 1080), 50, "50 px at 1080p");
    const first = resolveSlotBounds(0, 3, order, 1920, 1080);
    const second = resolveSlotBounds(1, 3, order, 1920, 1080);
    assertClose(
      ((second.centerX - second.halfWidth - first.centerX - first.halfWidth) /
        2) *
        1920,
      50,
      "column gap",
    );
    assertClose(first.halfWidth, (1920 - 100) / 3 / 1920, "equal widths");
  });

  it("keeps cells positive with the widest spacing on small outputs", () => {
    const cases = [
      { order: arranged("grid", 50, 6), count: 36, width: 640, height: 360 },
      { order: arranged("grid", 50, 6), count: 36, width: 360, height: 640 },
      { order: arranged("vertical", 50), count: 40, width: 360, height: 640 },
      { order: arranged("horizontal", 50), count: 40, width: 97, height: 53 },
    ];
    for (const { order, count, width, height } of cases) {
      const slots = order.arrangement === "grid" ? 36 : count;
      for (let index = 0; index < slots; index++) {
        const slot = resolveSlotBounds(index, count, order, width, height);
        const name = `${order.arrangement} ${count} at ${width}×${height}, cell ${index}`;
        assert.ok(slot.halfWidth * width >= 1 - 1e-9, `${name} width`);
        assert.ok(slot.halfHeight * height >= 1 - 1e-9, `${name} height`);
        assert.ok(Number.isFinite(slot.aspect) && slot.aspect > 0, name);
      }
    }
  });

  it("scales spacing with the output size", () => {
    assertClose(
      resolveSpacingPixels(arranged("vertical", 10), 540, 960),
      5,
      "half size",
    );
    assertClose(
      resolveSpacingPixels(arranged("grid", 50, 6), 640, 360),
      50 / 3,
      "50 at 360p",
    );
    assertClose(
      resolveSpacingPixels(arranged("vertical", 0), 1080, 1920),
      0,
      "no spacing",
    );
  });
});

describe("resolveSlotScissor", () => {
  const SIZES = [
    [1080, 1920],
    [1920, 1080],
    [361, 643],
    [97, 53],
  ];

  it("matches today's band scissors for Vertical with no spacing", () => {
    for (const [width, height] of SIZES) {
      for (let count = 1; count <= 7; count++) {
        for (let index = 0; index < count; index++) {
          assert.deepEqual(
            resolveSlotScissor(
              index,
              count,
              arranged("vertical"),
              width,
              height,
            ),
            resolveBandScissor(index, count, width, height),
          );
        }
      }
    }
  });

  it("tiles the surface with no seams or overlaps without spacing", () => {
    for (const [width, height] of SIZES) {
      const cases = [
        ...[1, 2, 3, 5, 7].flatMap((count) => [
          { count, order: arranged("vertical") },
          { count, order: arranged("horizontal") },
        ]),
        ...[2, 3, 4, 5, 6].map((gridSize) => ({
          count: gridSize * gridSize,
          order: arranged("grid", 0, gridSize),
        })),
      ];
      for (const { count, order } of cases) {
        const counts = coverage(
          slotScissors(count, order, width, height),
          width,
          height,
        );
        assert.ok(
          counts.every((value) => value === 1),
          `${order.arrangement} ${count} at ${width}×${height}`,
        );
      }
    }
  });

  it("never overlaps with spacing and leaves the gaps uncovered", () => {
    for (const [width, height] of SIZES) {
      for (const order of [
        arranged("vertical", 10),
        arranged("horizontal", 10),
        arranged("grid", 10, 3),
      ]) {
        const counts = coverage(
          slotScissors(3, order, width, height),
          width,
          height,
        );
        assert.ok(
          counts.every((value) => value <= 1),
          `${order.arrangement} at ${width}×${height}`,
        );
      }
    }

    const boxes = slotScissors(2, arranged("horizontal", 10), 1920, 1080);
    assert.equal(boxes[0].x, 0);
    assert.equal(boxes[1].x - (boxes[0].x + boxes[0].width), 10);
    assert.equal(boxes[1].x + boxes[1].width, 1920);

    const wide = slotScissors(2, arranged("horizontal", 50), 1920, 1080);
    assert.equal(wide[1].x - (wide[0].x + wide[0].width), 50);
    assert.equal(wide[1].x + wide[1].width, 1920);
  });

  it("stays pixel-exact and inside the surface at the widest spacing", () => {
    const cases = [
      { count: 36, order: arranged("grid", 50, 6), width: 640, height: 360 },
      { count: 36, order: arranged("grid", 50, 6), width: 97, height: 53 },
      { count: 7, order: arranged("vertical", 50), width: 361, height: 643 },
      { count: 40, order: arranged("vertical", 50), width: 360, height: 640 },
      { count: 60, order: arranged("horizontal", 50), width: 97, height: 53 },
    ];
    for (const { count, order, width, height } of cases) {
      const name = `${order.arrangement} ${count} at ${width}×${height}`;
      const boxes = slotScissors(count, order, width, height);
      for (const box of boxes) {
        assert.ok(box.width >= 1 && box.height >= 1, `${name} positive`);
        assert.ok(box.x >= 0 && box.y >= 0, `${name} inside`);
        assert.ok(box.x + box.width <= width, `${name} inside right`);
        assert.ok(box.y + box.height <= height, `${name} inside top`);
      }
      const counts = coverage(boxes, width, height);
      assert.ok(
        counts.every((value) => value <= 1),
        `${name} overlaps`,
      );
    }
  });
});

describe("resolveLayerPlacement without an Order", () => {
  it("gives every layer the whole canvas", () => {
    for (const index of [0, 1, 2]) {
      const placement = resolveLayerPlacement({
        index,
        count: 3,
        canvasWidth: 1080,
        canvasHeight: 1920,
        sourceWidth: 1920,
        sourceHeight: 1080,
        visual: visual("top"),
        order: Z_ORDER_COMPOSITION,
      });
      assert.deepEqual(placement.frame, {
        centerX: 0,
        centerY: 0,
        halfWidth: 1,
        halfHeight: 1,
        aspect: 1080 / 1920,
      });
      assert.deepEqual(placement.scissor, {
        x: 0,
        y: 0,
        width: 1080,
        height: 1920,
      });
      assertClose(placement.halfExtents.y, 1, "covers the canvas height");
      assertClose(placement.translate.x, 0, "centred sideways");
    }
  });
});

describe("resolveLayerPlacement with an Order", () => {
  it("covers a Horizontal column, centring sideways overflow", () => {
    const placement = resolveLayerPlacement({
      index: 1,
      count: 2,
      canvasWidth: 1920,
      canvasHeight: 1080,
      sourceWidth: 1920,
      sourceHeight: 1080,
      visual: visual("top"),
      order: arranged("horizontal"),
    });
    assertClose(placement.translate.x, 0.5, "centred on its column");
    assertClose(placement.halfExtents.y, 1, "covers the column height");
    assert.ok(placement.halfExtents.x > placement.frame.halfWidth);
    assert.deepEqual(placement.scissor, {
      x: 960,
      y: 0,
      width: 960,
      height: 1080,
    });
  });

  it("pins vertical overflow in a Grid cell to the Layout anchor", () => {
    const placement = resolveLayerPlacement({
      index: 0,
      count: 1,
      canvasWidth: 1920,
      canvasHeight: 1080,
      sourceWidth: 1080,
      sourceHeight: 1920,
      visual: visual("top"),
      order: arranged("grid", 0, 2),
    });
    assertClose(
      placement.translate.y + placement.halfExtents.y,
      placement.frame.centerY + placement.frame.halfHeight,
      "top edge pinned to the cell top",
    );
    assertClose(placement.translate.x, -0.5, "first cell is top left");
    assert.deepEqual(placement.scissor, {
      x: 0,
      y: 540,
      width: 960,
      height: 540,
    });
  });
});

describe("planLayerDraws", () => {
  const layer = (laneRank: number, fx = false) => ({
    id: `${fx ? "fx" : "layer"}-${laneRank}`,
    laneRank,
    clip: { startQ: 0 },
    fx,
  });
  const describeSteps = (steps: LayerDrawStep<ReturnType<typeof layer>>[]) =>
    steps.map((step) =>
      step.type === "layer"
        ? `${step.entry.id}@${step.slot}/${step.slotCount}`
        : step.entry.id,
    );

  it("draws layers in slot order without FX clips", () => {
    assert.deepEqual(
      describeSteps(
        planLayerDraws([layer(0), layer(1), layer(2)], Z_ORDER_COMPOSITION),
      ),
      ["layer-2@0/3", "layer-1@1/3", "layer-0@2/3"],
    );
  });

  it("applies an FX clip after the layers beneath it and before those above", () => {
    assert.deepEqual(
      describeSteps(
        planLayerDraws(
          [layer(0), layer(1, true), layer(2), layer(3)],
          Z_ORDER_COMPOSITION,
        ),
      ),
      ["layer-3@0/3", "layer-2@1/3", "fx-1", "layer-0@2/3"],
    );
  });

  it("applies FX clips from the highest-numbered layer up", () => {
    assert.deepEqual(
      describeSteps(
        planLayerDraws(
          [layer(0, true), layer(1), layer(2, true), layer(3)],
          Z_ORDER_COMPOSITION,
        ),
      ),
      ["layer-3@0/2", "fx-2", "layer-1@1/2", "fx-0"],
    );
  });

  it("gives FX clips no Order slot", () => {
    const steps = planLayerDraws(
      [layer(0, true), layer(1), layer(2)],
      DEFAULT_COMPOSITION_ORDER,
    );
    // Two bands for the two layers, drawn from the highest-numbered up so
    // the FX clip on Layer 1 comes after both.
    assert.deepEqual(describeSteps(steps), [
      "layer-2@1/2",
      "layer-1@0/2",
      "fx-0",
    ]);
  });

  it("leaves a Grid's hidden layers out beneath an FX clip", () => {
    const grid: CompositionOrder = {
      arrangement: "grid",
      gridSize: 2,
      spacing: 0,
    };
    const steps = planLayerDraws(
      [layer(0, true), ...[1, 2, 3, 4, 5].map((rank) => layer(rank))],
      grid,
    );
    assert.deepEqual(describeSteps(steps), [
      "layer-4@3/4",
      "layer-3@2/4",
      "layer-2@1/4",
      "layer-1@0/4",
      "fx-0",
    ]);
  });
});

describe("planLayerDraws with excluded layers", () => {
  // Layer N is on lane "N", at lane rank N - 1.
  const layer = (number: number, fx = false) => ({
    id: `${fx ? "fx" : "layer"}-${number}`,
    laneRank: number - 1,
    clip: { startQ: 0, laneId: `${number}` },
    fx,
  });
  const grid = (excludedLayers: string[] = []): CompositionOrder => ({
    arrangement: "grid",
    gridSize: 2,
    spacing: 0,
    excludedLayers,
  });
  // Arranged layers show their slot; excluded ones show "full" for the
  // whole canvas.
  const describeSteps = (steps: LayerDrawStep<ReturnType<typeof layer>>[]) =>
    steps.map((step) =>
      step.type === "fx"
        ? step.entry.id
        : step.order.arrangement === "none"
          ? `${step.entry.id}@full`
          : `${step.entry.id}@${step.slot}/${step.slotCount}`,
    );
  const layers = [1, 2, 3, 4, 5].map((number) => layer(number));

  it("arranges every layer when none is excluded", () => {
    assert.deepEqual(
      describeSteps(planLayerDraws(layers, grid())),
      describeSteps(
        planLayerDraws(layers, {
          arrangement: "grid",
          gridSize: 2,
          spacing: 0,
        }),
      ),
    );
    assert.deepEqual(describeSteps(planLayerDraws(layers, grid())), [
      "layer-1@0/4",
      "layer-2@1/4",
      "layer-3@2/4",
      "layer-4@3/4",
    ]);
  });

  it("draws an excluded Layer 1 full-frame on top of a 2×2 grid of Layers 2–5", () => {
    assert.deepEqual(describeSteps(planLayerDraws(layers, grid(["1"]))), [
      "layer-5@3/4",
      "layer-4@2/4",
      "layer-3@1/4",
      "layer-2@0/4",
      "layer-1@full",
    ]);
  });

  it("draws an excluded lowest layer full-frame beneath the arranged ones", () => {
    const six = [...layers, layer(6)];
    assert.deepEqual(describeSteps(planLayerDraws(six, grid(["6"]))), [
      "layer-6@full",
      "layer-4@3/4",
      "layer-3@2/4",
      "layer-2@1/4",
      "layer-1@0/4",
    ]);
  });

  it("gives slots only to the layers the Order arranges", () => {
    const vertical: CompositionOrder = {
      arrangement: "vertical",
      gridSize: 2,
      spacing: 0,
      excludedLayers: ["2", "4"],
    };
    assert.deepEqual(describeSteps(planLayerDraws(layers, vertical)), [
      "layer-5@2/3",
      "layer-4@full",
      "layer-3@1/3",
      "layer-2@full",
      "layer-1@0/3",
    ]);
  });

  it("follows the layer by id when it moves to another position", () => {
    // Lane "1" moved to the bottom: it is now the fifth layer.
    const moved = [
      { ...layer(2), laneRank: 0 },
      { ...layer(3), laneRank: 1 },
      { ...layer(4), laneRank: 2 },
      { ...layer(5), laneRank: 3 },
      { ...layer(1), laneRank: 4 },
    ];
    assert.deepEqual(describeSteps(planLayerDraws(moved, grid(["1"]))), [
      "layer-1@full",
      "layer-5@3/4",
      "layer-4@2/4",
      "layer-3@1/4",
      "layer-2@0/4",
    ]);
  });

  it("stacks FX clips and excluded layers by z-order", () => {
    assert.deepEqual(
      describeSteps(
        planLayerDraws([layer(1), layer(2, true), layer(3)], grid(["1"])),
      ),
      ["layer-3@0/1", "fx-2", "layer-1@full"],
    );
  });

  it("ignores exclusions without an Order", () => {
    assert.deepEqual(
      describeSteps(
        planLayerDraws(layers.slice(0, 2), {
          ...Z_ORDER_COMPOSITION,
          excludedLayers: ["1"],
        }),
      ),
      ["layer-2@full", "layer-1@full"],
    );
  });
});
