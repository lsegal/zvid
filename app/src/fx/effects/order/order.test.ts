import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type CompositionOrder,
  DEFAULT_COMPOSITION_ORDER,
  hiddenLayerCount,
  isLayerArranged,
  parseCompositionOrder,
  parseLayerIdList,
  pruneLayerIdList,
  resolveCompositionOrder,
  serializeLayerIdList,
  toggleLayerId,
  visibleLayerCount,
  Z_ORDER_COMPOSITION,
} from "./order.ts";

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
      excludedLayers: [],
      borderColor: BLACK,
    });
    assert.equal(
      parseCompositionOrder(order("horizontal", 2, 0).parameters).arrangement,
      "horizontal",
    );
  });

  it("clamps out-of-range values and keeps defaults for unreadable ones", () => {
    assert.deepEqual(
      parseCompositionOrder(order("Grid", 9.4, 160).parameters),
      {
        arrangement: "grid",
        gridSize: 6,
        spacing: 108,
        excludedLayers: [],
        borderColor: BLACK,
      },
    );
    assert.deepEqual(parseCompositionOrder(order("Spiral", 1, -2).parameters), {
      arrangement: "vertical",
      gridSize: 2,
      spacing: 0,
      excludedLayers: [],
      borderColor: BLACK,
    });
    assert.deepEqual(parseCompositionOrder([]), DEFAULT_COMPOSITION_ORDER);
  });

  it("reads the outer margin, off when missing or unreadable", () => {
    const margin = (value?: string) =>
      parseCompositionOrder([
        ...order("Grid", 2, 20).parameters,
        ...(value === undefined ? [] : [{ key: "OuterMargin", value }]),
      ]).outerMargin;
    assert.equal(margin(), undefined);
    assert.equal(margin("On"), true);
    assert.equal(margin(" on "), true);
    assert.equal(margin("Off"), false);
    assert.equal(margin("Maybe"), false);
  });

  it("reads the border color, black when missing or unreadable", () => {
    const border = (value?: string) =>
      parseCompositionOrder([
        ...order("Grid", 2, 20).parameters,
        ...(value === undefined ? [] : [{ key: "BorderColor", value }]),
      ]).borderColor;
    assert.deepEqual(border(), BLACK);
    assert.deepEqual(DEFAULT_COMPOSITION_ORDER.borderColor, BLACK);
    assert.deepEqual(border("rgba(255,0,0,1)"), { r: 255, g: 0, b: 0, a: 1 });
    assert.deepEqual(border("rgba(0, 0, 255, 0)"), {
      r: 0,
      g: 0,
      b: 255,
      a: 0,
    });
    assert.deepEqual(border("#00ff0080"), {
      r: 0,
      g: 255,
      b: 0,
      a: 128 / 255,
    });
    assert.deepEqual(border("tomato"), BLACK);
  });

  it("keeps spacing within 0 to 108", () => {
    for (const [saved, expected] of [
      [0, 0],
      [10, 10],
      [50, 50],
      [108, 108],
      [160, 108],
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
      excludedLayers: [],
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

describe("excluded layers", () => {
  it("excludes no layer by default, so every layer is arranged", () => {
    const parsed = parseCompositionOrder(order("Grid", 2, 0).parameters);
    assert.deepEqual(parsed.excludedLayers, []);
    assert.equal(isLayerArranged(parsed, "1"), true);
  });

  it("reads the excluded layer ids", () => {
    const parsed = parseCompositionOrder([
      { key: "Arrangement", value: "Grid" },
      { key: "ExcludedLayers", value: " 3, 1,,3 " },
    ]);
    assert.deepEqual(parsed.excludedLayers, ["3", "1"]);
    assert.equal(isLayerArranged(parsed, "1"), false);
    assert.equal(isLayerArranged(parsed, "2"), true);
    // A layer added later is not in the list, so it is arranged.
    assert.equal(isLayerArranged(parsed, "9"), true);
  });

  it("arranges nothing without an Order", () => {
    assert.equal(isLayerArranged(Z_ORDER_COMPOSITION, "1"), false);
  });

  it("toggles one layer id at a time", () => {
    assert.equal(toggleLayerId("", "2"), "2");
    assert.equal(toggleLayerId("2", "5"), "2,5");
    assert.equal(toggleLayerId("2,5", "2"), "5");
    assert.equal(toggleLayerId("5", "5"), "");
  });

  it("drops ids of layers that no longer exist", () => {
    assert.equal(pruneLayerIdList("1,4,7", ["1", "2", "7"]), "1,7");
    assert.equal(pruneLayerIdList("4", ["1"]), "");
    assert.equal(serializeLayerIdList(["2", "2", " 3 "]), "2,3");
    assert.deepEqual(parseLayerIdList(undefined), []);
  });
});
