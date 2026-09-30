// Pure logic behind dragging a layer header's grip (use-layer-reorder.ts):
// where a dragged row lands, how the other rows make room, and what screen
// readers hear.

/** A row's top edge and height, in the list's own coordinates. */
export type LayerRowBox = { top: number; height: number };

/**
 * The index layer `fromIndex` would move to with its center at `centerY`:
 * past every other row whose middle it has crossed.
 */
export function layerDropIndex(
  rows: readonly LayerRowBox[],
  fromIndex: number,
  centerY: number,
) {
  let index = 0;
  rows.forEach((row, rowIndex) => {
    if (rowIndex !== fromIndex && row.top + row.height / 2 < centerY) {
      index += 1;
    }
  });
  return index;
}

/**
 * How far row `index` slides to make room while layer `fromIndex` hovers at
 * `targetIndex`: the rows it passes shift by its height the other way.
 */
export function layerRowShift(
  rows: readonly LayerRowBox[],
  index: number,
  fromIndex: number,
  targetIndex: number,
) {
  const height = rows[fromIndex]?.height ?? 0;
  if (fromIndex < targetIndex && index > fromIndex && index <= targetIndex) {
    return -height;
  }
  if (targetIndex < fromIndex && index >= targetIndex && index < fromIndex) {
    return height;
  }
  return 0;
}

/** The top edge layer `fromIndex` would have once moved to `targetIndex`. */
export function layerLandingTop(
  rows: readonly LayerRowBox[],
  fromIndex: number,
  targetIndex: number,
) {
  const from = rows[fromIndex];
  const target = rows[targetIndex];
  if (!from || !target) {
    return from?.top ?? 0;
  }
  return targetIndex <= fromIndex
    ? target.top
    : target.top + target.height - from.height;
}

/** Next index for a keyboard move of `step`, kept inside the list. */
export function stepLayerIndex(index: number, step: number, count: number) {
  return Math.max(0, Math.min(count - 1, index + step));
}

export const layerReorderAnnouncements = {
  position: (name: string, index: number, count: number) =>
    `${name}, position ${index + 1} of ${count}`,
  pickedUp: (name: string, index: number, count: number) =>
    `Picked up ${layerReorderAnnouncements.position(name, index, count)}. Use the up and down arrow keys to move it, Space or Enter to drop it, Escape to cancel.`,
  dropped: (name: string, index: number, count: number) =>
    `Dropped ${layerReorderAnnouncements.position(name, index, count)}`,
  canceled: (name: string) => `Canceled moving ${name}`,
};
