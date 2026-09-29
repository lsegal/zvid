// The Order effect: how the compositor arranges its layers (stacked
// Vertical bands, Horizontal columns or an N×N Grid) and how much space it
// leaves between them. On the Global stack it arranges every layer; on an FX
// clip it arranges the layers beneath the clip, for the clip's duration.
// Without an enabled Order effect the layers are not arranged at all: each
// covers the whole canvas and they overlap by z-order, Layer 1 on top.

import { parseCssColor, type Rgba } from "./fill-paint.ts";

// "none" is the z-order overlay used when there is no enabled Order; it is
// never an Order device's own setting.
export type Arrangement = "vertical" | "horizontal" | "grid" | "none";

export type CompositionOrder = {
  arrangement: Arrangement;
  // Cells per side of the grid. Only read for the Grid arrangement.
  gridSize: number;
  // Gap between neighbouring layers, in output pixels at 1080p.
  spacing: number;
  // What fills the Order's area beneath its layers, showing in the gaps
  // and empty grid cells. Black when unset.
  borderColor?: Rgba;
};

export const ORDER_EFFECT_NAME = "Order";

export const ORDER_ARRANGEMENTS = ["Vertical", "Horizontal", "Grid"] as const;

export const GRID_SIZE_MIN = 2;
export const GRID_SIZE_MAX = 6;
export const SPACING_MAX = 50;
export const DEFAULT_BORDER_COLOR = "rgba(0,0,0,1)";
export const BLACK_BORDER: Rgba = { r: 0, g: 0, b: 0, a: 1 };

export const DEFAULT_COMPOSITION_ORDER: CompositionOrder = {
  arrangement: "vertical",
  gridSize: GRID_SIZE_MIN,
  spacing: 0,
  borderColor: BLACK_BORDER,
};

// Layers overlapping full-frame, with no Order to arrange them.
export const Z_ORDER_COMPOSITION: CompositionOrder = {
  arrangement: "none",
  gridSize: GRID_SIZE_MIN,
  spacing: 0,
};

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
    if (key === "bordercolor") {
      order.borderColor = parseCssColor(parameter.value) ?? order.borderColor;
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

// The arrangement the last enabled Order effect on the `trackId` stack
// sets, or undefined when the stack has none.
export function findCompositionOrder(
  effects: readonly OrderEffect[],
  trackId: string,
): CompositionOrder | undefined {
  const effect = effects.findLast(
    (candidate) =>
      candidate.trackId === trackId &&
      candidate.enabled !== false &&
      isOrderEffectName(candidate.effectName),
  );
  return effect ? parseCompositionOrder(effect.parameters) : undefined;
}

// The arrangement the compositor uses: the last enabled Order effect on the
// Global stack, or the z-order overlay when there is none. An FX clip with
// an Order of its own arranges the layers beneath it instead.
export function resolveCompositionOrder(
  effects: readonly OrderEffect[],
  globalTrackId: string,
): CompositionOrder {
  return findCompositionOrder(effects, globalTrackId) ?? Z_ORDER_COMPOSITION;
}

// Layers the arrangement has room for: every layer, except that a Grid
// draws at most one per cell.
export function visibleLayerCount(layerCount: number, order: CompositionOrder) {
  const count = Math.max(0, layerCount);
  return order.arrangement === "grid"
    ? Math.min(count, order.gridSize * order.gridSize)
    : count;
}

export function hiddenLayerCount(layerCount: number, order: CompositionOrder) {
  return Math.max(0, layerCount - visibleLayerCount(layerCount, order));
}
