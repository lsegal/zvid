// The Order global effect: how the compositor arranges its layers (stacked
// Vertical bands, Horizontal columns or an N×N Grid) and how much space it
// leaves between them. Without an enabled Order effect the layers are not
// arranged at all: each covers the whole canvas and they overlap by z-order,
// Layer 1 on top.

// "none" is the z-order overlay used when there is no enabled Order; it is
// never an Order device's own setting.
export type Arrangement = "vertical" | "horizontal" | "grid" | "none";

export type CompositionOrder = {
  arrangement: Arrangement;
  // Cells per side of the grid. Only read for the Grid arrangement.
  gridSize: number;
  // Gap between neighbouring layers, in output pixels at 1080p.
  spacing: number;
  // Ids of the layers the arrangement leaves out. They are drawn full-frame
  // in their z-order instead, as with no Order. Absent means none.
  excludedLayers?: readonly string[];
};

export const ORDER_EFFECT_NAME = "Order";

export const ORDER_ARRANGEMENTS = ["Vertical", "Horizontal", "Grid"] as const;

export const GRID_SIZE_MIN = 2;
export const GRID_SIZE_MAX = 6;
export const SPACING_MAX = 50;

export const DEFAULT_COMPOSITION_ORDER: CompositionOrder = {
  arrangement: "vertical",
  gridSize: GRID_SIZE_MIN,
  spacing: 0,
  excludedLayers: [],
};

// Layers overlapping full-frame, with no Order to arrange them.
export const Z_ORDER_COMPOSITION: CompositionOrder = {
  arrangement: "none",
  gridSize: GRID_SIZE_MIN,
  spacing: 0,
  excludedLayers: [],
};

// The Order parameter that lists the ids of the layers it leaves out.
export const EXCLUDED_LAYERS_KEY = "ExcludedLayers";

export function isOrderEffectName(effectName: string) {
  return effectName.trim().toLowerCase() === ORDER_EFFECT_NAME.toLowerCase();
}

type OrderParameter = {
  key: string;
  value: string;
  numericValue?: number;
};

type OrderEffect = {
  trackId: string;
  effectName: string;
  parameters: OrderParameter[];
  enabled?: boolean;
};

function parseArrangement(value: string | undefined): Arrangement | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized === "vertical" ||
    normalized === "horizontal" ||
    normalized === "grid"
    ? normalized
    : undefined;
}

// A stored list of layer ids: comma-separated, blank and repeated ids
// ignored.
export function parseLayerIdList(value: string | undefined): string[] {
  return [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
}

export function serializeLayerIdList(ids: readonly string[]) {
  return parseLayerIdList(ids.join(",")).join(",");
}

// Adds `layerId` to the stored list, or removes it when it is there.
export function toggleLayerId(value: string | undefined, layerId: string) {
  const ids = parseLayerIdList(value);
  return serializeLayerIdList(
    ids.includes(layerId)
      ? ids.filter((id) => id !== layerId)
      : [...ids, layerId],
  );
}

// The stored list without ids of layers that no longer exist.
export function pruneLayerIdList(
  value: string | undefined,
  layerIds: Iterable<string>,
) {
  const existing = new Set(layerIds);
  return serializeLayerIdList(
    parseLayerIdList(value).filter((id) => existing.has(id)),
  );
}

// Whether `order` gives the layer `layerId` a slot. Excluded layers, and
// every layer without an Order, cover the whole canvas instead.
export function isLayerArranged(order: CompositionOrder, layerId: string) {
  return (
    order.arrangement !== "none" && !order.excludedLayers?.includes(layerId)
  );
}

// Reads an Order effect's parameters by key; missing or unreadable values
// keep their defaults.
export function parseCompositionOrder(
  parameters: OrderParameter[],
): CompositionOrder {
  const order = { ...DEFAULT_COMPOSITION_ORDER };
  for (const parameter of parameters) {
    const key = parameter.key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (key === "arrangement") {
      order.arrangement =
        parseArrangement(parameter.value) ?? order.arrangement;
      continue;
    }

    if (key === "excludedlayers") {
      order.excludedLayers = parseLayerIdList(parameter.value);
      continue;
    }

    const numeric =
      parameter.numericValue ?? Number.parseFloat(parameter.value);
    if (!Number.isFinite(numeric)) {
      continue;
    }

    if (key === "gridsize") {
      order.gridSize = Math.max(
        GRID_SIZE_MIN,
        Math.min(GRID_SIZE_MAX, Math.round(numeric)),
      );
    } else if (key === "spacing") {
      order.spacing = Math.max(0, Math.min(SPACING_MAX, numeric));
    }
  }

  return order;
}

// The arrangement the compositor uses: the last enabled Order effect on the
// Global stack, or the z-order overlay when there is none.
export function resolveCompositionOrder(
  effects: readonly OrderEffect[],
  globalTrackId: string,
): CompositionOrder {
  const effect = effects.findLast(
    (candidate) =>
      candidate.trackId === globalTrackId &&
      candidate.enabled !== false &&
      isOrderEffectName(candidate.effectName),
  );
  return effect
    ? parseCompositionOrder(effect.parameters)
    : Z_ORDER_COMPOSITION;
}

// Layers the arrangement has room for: every layer, except that a Grid
// draws at most one per cell. `layerCount` counts arranged layers only:
// excluded ones take no slot.
export function visibleLayerCount(layerCount: number, order: CompositionOrder) {
  const count = Math.max(0, layerCount);
  return order.arrangement === "grid"
    ? Math.min(count, order.gridSize * order.gridSize)
    : count;
}

export function hiddenLayerCount(layerCount: number, order: CompositionOrder) {
  return Math.max(0, layerCount - visibleLayerCount(layerCount, order));
}
