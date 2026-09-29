import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type CompositionOrder,
  DEFAULT_COMPOSITION_ORDER,
  hiddenLayerCount,
  parseCompositionOrder,
  resolveCompositionOrder,
  visibleLayerCount,
  Z_ORDER_COMPOSITION,
} from "./composition-order.ts";

const GLOBAL = "__group_main";
const BLACK = { r: 0, g: 0, b: 0, a: 1 };

function order(
  arrangement: string,
  gridSize: number,
  spacing: number,
  overrides: { trackId?: string; enabled?: boolean } = {},
) {
  return {
    trackId: overrides.trackId ?? GLOBAL,
    effectName: "Order",
    enabled: overrides.enabled,
    parameters: [
      { key: "Arrangement", value: arrangement },
      { key: "GridSize", value: `${gridSize}`, numericValue: gridSize },
      { key: "Spacing", value: `${spacing}`, numericValue: spacing },
    ],
  };
}

describe("parseCompositionOrder", () => {
  it("reads the arrangement, grid size and spacing", () => {
    assert.deepEqual(parseCompositionOrder(order("Grid", 4, 6).parameters), {
      arrangement: "grid",
      gridSize: 4,
      spacing: 6,
      borderColor: BLACK,
    });
    assert.equal(
      parseCompositionOrder(order("horizontal", 2, 0).parameters).arrangement,
      "horizontal",
    );
  });

  it("clamps out-of-range values and keeps defaults for unreadable ones", () => {
    assert.deepEqual(parseCompositionOrder(order("Grid", 9.4, 60).parameters), {
      arrangement: "grid",
      gridSize: 6,
      spacing: 50,
      borderColor: BLACK,
    });
    assert.deepEqual(parseCompositionOrder(order("Spiral", 1, -2).parameters), {
      arrangement: "vertical",
      gridSize: 2,
      spacing: 0,
      borderColor: BLACK,
    });
    assert.deepEqual(parseCompositionOrder([]), DEFAULT_COMPOSITION_ORDER);
  });

  it("reads the border colour, black when missing or unreadable", () => {
    const border = (value?: string) =>
      parseCompositionOrder([
        ...order("Grid", 2, 20).parameters,
        ...(value === undefined ? [] : [{ key: "BorderColor", value }]),
      ]).borderColor;
    assert.deepEqual(border(), BLACK);
    assert.deepEqual(DEFAULT_COMPOSITION_ORDER.borderColor, BLACK);
    assert.deepEqual(border("rgba(255,0,0,1)"), { r: 255, g: 0, b: 0, a: 1 });
    assert.deepEqual(border("rgba(0, 0, 255, 0)"), { r: 0, g: 0, b: 255, a: 0 });
    assert.deepEqual(border("#00ff0080"), {
      r: 0,
      g: 255,
      b: 0,
      a: 128 / 255,
    });
    assert.deepEqual(border("tomato"), BLACK);
  });

  it("keeps spacing within 0 to 50", () => {
    for (const [saved, expected] of [
      [0, 0],
      [10, 10],
      [30, 30],
      [50, 50],
      [60, 50],
    ]) {
      assert.equal(
        parseCompositionOrder(order("Vertical", 2, saved).parameters).spacing,
        expected,
        `${saved}`,
      );
    }
  });
});

describe("resolveCompositionOrder", () => {
  it("overlaps the layers by z-order without an Order effect", () => {
    assert.deepEqual(resolveCompositionOrder([], GLOBAL), Z_ORDER_COMPOSITION);
    assert.equal(Z_ORDER_COMPOSITION.arrangement, "none");
    assert.deepEqual(
      resolveCompositionOrder([order("Grid", 3, 2, { trackId: "1" })], GLOBAL),
      Z_ORDER_COMPOSITION,
    );
  });

  it("treats a bypassed Order like no Order", () => {
    assert.deepEqual(
      resolveCompositionOrder(
        [order("Vertical", 2, 0, { enabled: false })],
        GLOBAL,
      ),
      Z_ORDER_COMPOSITION,
    );
  });

  it("uses the last enabled Order on the Global stack", () => {
    const effects = [
      order("Horizontal", 2, 1),
      order("Grid", 3, 2),
      order("Grid", 5, 5, { enabled: false }),
      order("Grid", 6, 9, { trackId: "lane-1" }),
    ];
    assert.deepEqual(resolveCompositionOrder(effects, GLOBAL), {
      arrangement: "grid",
      gridSize: 3,
      spacing: 2,
      borderColor: BLACK,
    });
  });
});

describe("visibleLayerCount", () => {
  const grid = (gridSize: number): CompositionOrder => ({
    arrangement: "grid",
    gridSize,
    spacing: 0,
  });

  it("draws every layer in rows and columns", () => {
    for (const arrangement of ["vertical", "horizontal"] as const) {
      const value = { arrangement, gridSize: 2, spacing: 0 };
      assert.equal(visibleLayerCount(9, value), 9);
      assert.equal(hiddenLayerCount(9, value), 0);
    }
  });

  it("draws every layer when they overlap", () => {
    assert.equal(visibleLayerCount(9, Z_ORDER_COMPOSITION), 9);
    assert.equal(hiddenLayerCount(9, Z_ORDER_COMPOSITION), 0);
  });

  it("draws at most one layer per grid cell", () => {
    assert.equal(visibleLayerCount(3, grid(2)), 3);
    assert.equal(visibleLayerCount(5, grid(2)), 4);
    assert.equal(hiddenLayerCount(5, grid(2)), 1);
    assert.equal(hiddenLayerCount(40, grid(6)), 4);
    assert.equal(hiddenLayerCount(0, grid(2)), 0);
  });
});
