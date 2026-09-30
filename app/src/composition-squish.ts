// Squish, an animated Order's other Transition: a clip entering or exiting
// grows from, or collapses to, zero width or height inside the arrangement
// instead of sliding in from a canvas edge. The other clips re-flow to make
// room as they do with Push, so the squished clip always fills the gap they
// leave. Its content stays cover-fitted to the squished box, so it is
// revealed or cropped rather than stretched. Rects are in canvas pixels
// (origin top-left).
//
// Horizontal and Vertical Orders squish along their axis (width or height):
// a clip in the first slot grows from the canvas's start edge (left or top),
// one in the last slot from its end edge (right or bottom), and one between
// others from the point between its neighbors, which with evenly sized
// slots is its own center. A lone clip grows from the canvas's center.
//
// A Grid squishes along the row: a clip sharing its row grows across its
// cell's width from the cell's left edge in the first column, its right
// edge in the last column, or its center between them. A clip alone in its
// row brings the row in, so it grows across its cell's height the same way
// by row: from the top in the first row, the bottom in the last, or the
// center between them. A clip alone in the whole grid, or in an Order
// without an arrangement, scales in about its cell's center.

import type { CompositionOrder } from "./composition-order.ts";

export type SlotRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

// Where a squishing clip collapses to in a Horizontal or Vertical Order:
// the `boundary`th boundary of the `slotCount` slots the others take
// without it, 0 the start edge and `slotCount` the end edge.
export type SlotCollapse = { boundary: number; slotCount: number };

export function isSquishOrder(order: CompositionOrder) {
  return order.slide?.transition === "Squish";
}

// The point along one axis, of `size`, that `collapse` names, given the
// start and end of each slot the others take along it.
function resolveCollapsePoint(
  collapse: SlotCollapse | undefined,
  size: number,
  edges: (index: number) => { start: number; end: number },
) {
  if (!collapse?.slotCount) {
    return size / 2;
  }
  const { boundary, slotCount } = collapse;
  if (boundary <= 0) {
    return 0;
  }
  if (boundary >= slotCount) {
    return size;
  }
  // Halfway across the spacing between the neighbors.
  return (edges(boundary - 1).end + edges(boundary).start) / 2;
}

// Where along a cell's side of `start`..`end` it collapses to, by its
// position among `cells`: the start in the first, the end in the last.
function resolveCellAnchor(
  position: number,
  cells: number,
  start: number,
  end: number,
) {
  if (position <= 0) {
    return start;
  }
  return position >= cells - 1 ? end : (start + end) / 2;
}

// The zero-width or zero-height box slot `index` of `count`, at `slot`,
// collapses to.
function resolveCollapsedRect(
  slot: SlotRect,
  index: number,
  count: number,
  collapse: SlotCollapse | undefined,
  order: CompositionOrder,
  width: number,
  height: number,
  slotRect: (index: number, count: number) => SlotRect,
): SlotRect {
  if (order.arrangement === "horizontal") {
    const x = resolveCollapsePoint(collapse, width, (other) => {
      const rect = slotRect(other, collapse?.slotCount ?? 1);
      return { start: rect.left, end: rect.right };
    });
    return { ...slot, left: x, right: x };
  }
  if (order.arrangement === "vertical") {
    const y = resolveCollapsePoint(collapse, height, (other) => {
      const rect = slotRect(other, collapse?.slotCount ?? 1);
      return { start: rect.top, end: rect.bottom };
    });
    return { ...slot, top: y, bottom: y };
  }

  const centerX = (slot.left + slot.right) / 2;
  const centerY = (slot.top + slot.bottom) / 2;
  if (order.arrangement !== "grid" || count <= 1) {
    return { left: centerX, right: centerX, top: centerY, bottom: centerY };
  }
  const columns = Math.max(1, order.gridSize);
  const column = index % columns;
  const row = Math.floor(index / columns);
  const inRow = Math.min(count - (index - column), columns);
  if (inRow <= 1) {
    const y = resolveCellAnchor(row, columns, slot.top, slot.bottom);
    return { ...slot, top: y, bottom: y };
  }
  const x = resolveCellAnchor(column, columns, slot.left, slot.right);
  return { ...slot, left: x, right: x };
}

/**
 * Where a clip squished `open` of the way into `slot`, slot `index` of
 * `count`, is drawn and cropped: its collapsed box at 0, the whole slot at
 * 1. `slotRect` gives the arrangement's slots, for where the others' slots
 * leave the gap it collapses into.
 */
export function resolveSquishRect(
  slot: SlotRect,
  index: number,
  count: number,
  collapse: SlotCollapse | undefined,
  order: CompositionOrder,
  width: number,
  height: number,
  slotRect: (index: number, count: number) => SlotRect,
  open: number,
): SlotRect {
  const collapsed = resolveCollapsedRect(
    slot,
    index,
    count,
    collapse,
    order,
    width,
    height,
    slotRect,
  );
  const at = (key: keyof SlotRect) =>
    collapsed[key] + (slot[key] - collapsed[key]) * open;
  return {
    left: at("left"),
    right: at("right"),
    top: at("top"),
    bottom: at("bottom"),
  };
}
