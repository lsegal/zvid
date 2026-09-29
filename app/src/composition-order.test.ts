import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type CompositionOrder,
  DEFAULT_COMPOSITION_ORDER,
  hiddenLayerCount,
  parseCompositionOrder,
  resolveCompositionOrder,
  visibleLayerCount,
} from "./composition-order.ts";

const GLOBAL = "__group_main";

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
    });
    assert.equal(
      parseCompositionOrder(order("horizontal", 2, 0).parameters).arrangement,
      "horizontal",
    );
  });

  it("clamps out-of-range values and keeps defaults for unreadable ones", () => {
    assert.deepEqual(parseCompositionOrder(order("Grid", 9.4, 30).parameters), {
      arrangement: "grid",
      gridSize: 6,
      spacing: 10,
    });
    assert.deepEqual(parseCompositionOrder(order("Spiral", 1, -2).parameters), {
      arrangement: "vertical",
      gridSize: 2,
      spacing: 0,
    });
    assert.deepEqual(parseCompositionOrder([]), DEFAULT_COMPOSITION_ORDER);
  });
});

describe("resolveCompositionOrder", () => {
  it("stacks vertically with no spacing without an Order effect", () => {
    assert.deepEqual(resolveCompositionOrder([], GLOBAL), {
      arrangement: "vertical",
      gridSize: 2,
      spacing: 0,
    });
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

  it("draws at most one layer per grid cell", () => {
    assert.equal(visibleLayerCount(3, grid(2)), 3);
    assert.equal(visibleLayerCount(5, grid(2)), 4);
    assert.equal(hiddenLayerCount(5, grid(2)), 1);
    assert.equal(hiddenLayerCount(40, grid(6)), 4);
    assert.equal(hiddenLayerCount(0, grid(2)), 0);
  });
});
