import type { CSSProperties } from "react";

// Each timeline row's height (#1057). Layer lanes and source tracks default
// to the heights lane-row.css and source-tracks.css give them, and either can
// be collapsed to a one-line row by double-clicking its handle, or resized by
// dragging the separator under it (#1058). The heights are UI state, not part
// of the project.

export type RowKind = "lane" | "source";

type RowMetrics = {
  // The row's height, its bottom border included.
  height: number;
  // The clips' height and the space above them.
  clipHeight: number;
  clipInset: number;
};

export const DEFAULT_ROW_METRICS: Readonly<Record<RowKind, RowMetrics>> = {
  lane: { height: 66, clipHeight: 44, clipInset: 11 },
  source: { height: 82, clipHeight: 56, clipInset: 12 },
};

// A collapsed row: one line of handle text over a 16px clip, with 4px of
// padding above and below it. No row is shorter.
export const COLLAPSED_ROW_METRICS: Readonly<RowMetrics> = {
  height: 24,
  clipHeight: 16,
  clipInset: 4,
};

type RowHeight = {
  height: number;
  // What expanding a collapsed row restores.
  expandedHeight: number;
};

// The tallest a row can be dragged, as a multiple of its default height.
export const MAX_ROW_HEIGHT_SCALE = 4;

// A row height between a collapsed row's and the tallest a row with this
// default height can be.
export function clampRowHeight(height: number, defaultHeight: number) {
  return Math.min(
    defaultHeight * MAX_ROW_HEIGHT_SCALE,
    Math.max(COLLAPSED_ROW_METRICS.height, Math.round(height)),
  );
}

// Rows at their default height have no entry.
export type RowHeights = ReadonlyMap<string, RowHeight>;

export const NO_ROW_HEIGHTS: RowHeights = new Map();

function rowKey(kind: RowKind, id: string) {
  return `${kind}:${id}`;
}

export function getRowHeight(heights: RowHeights, kind: RowKind, id: string) {
  return (
    heights.get(rowKey(kind, id))?.height ?? DEFAULT_ROW_METRICS[kind].height
  );
}

// What expanding the row restores: its height, or the height it had before
// it collapsed.
export function getRowExpandedHeight(
  heights: RowHeights,
  kind: RowKind,
  id: string,
) {
  return (
    heights.get(rowKey(kind, id))?.expandedHeight ??
    DEFAULT_ROW_METRICS[kind].height
  );
}

export function isRowCollapsed(heights: RowHeights, kind: RowKind, id: string) {
  return getRowHeight(heights, kind, id) <= COLLAPSED_ROW_METRICS.height;
}

// Sets a row's height, no lower than a collapsed row's and no taller than
// MAX_ROW_HEIGHT_SCALE times its default.
export function setRowHeight(
  heights: RowHeights,
  kind: RowKind,
  id: string,
  height: number,
): RowHeights {
  const next = new Map(heights);
  const clamped = clampRowHeight(height, DEFAULT_ROW_METRICS[kind].height);
  if (clamped === DEFAULT_ROW_METRICS[kind].height) {
    next.delete(rowKey(kind, id));
  } else {
    next.set(rowKey(kind, id), { height: clamped, expandedHeight: clamped });
  }
  return next;
}

// Collapses a row, or expands a collapsed one back to the height it had.
export function toggleRowCollapsed(
  heights: RowHeights,
  kind: RowKind,
  id: string,
): RowHeights {
  const key = rowKey(kind, id);
  const current = heights.get(key);
  if (isRowCollapsed(heights, kind, id)) {
    return setRowHeight(
      heights,
      kind,
      id,
      current?.expandedHeight ?? DEFAULT_ROW_METRICS[kind].height,
    );
  }

  const next = new Map(heights);
  next.set(key, {
    height: COLLAPSED_ROW_METRICS.height,
    expandedHeight: getRowHeight(heights, kind, id),
  });
  return next;
}

// Resizes a row from its separator. Dragged down to the minimum it collapses,
// and expanding it again restores expandedHeight, the height it had when the
// drag started.
export function resizeRow(
  heights: RowHeights,
  kind: RowKind,
  id: string,
  height: number,
  expandedHeight: number,
): RowHeights {
  const clamped = clampRowHeight(height, DEFAULT_ROW_METRICS[kind].height);
  if (clamped > COLLAPSED_ROW_METRICS.height) {
    return setRowHeight(heights, kind, id, clamped);
  }

  const next = new Map(heights);
  next.set(rowKey(kind, id), {
    height: COLLAPSED_ROW_METRICS.height,
    expandedHeight,
  });
  return next;
}

// The clip size and inset of a row this tall: a collapsed row's at the
// minimum and the default's at the default height, scaling in between, with
// taller rows growing their clips.
export function getRowMetrics(kind: RowKind, height: number): RowMetrics {
  const base = DEFAULT_ROW_METRICS[kind];
  const min = COLLAPSED_ROW_METRICS;
  const clamped = Math.max(min.height, height);
  const t = Math.min(1, (clamped - min.height) / (base.height - min.height));
  const scale = (from: number, to: number) =>
    Math.round(from + (to - from) * t);
  const clipInset = scale(min.clipInset, base.clipInset);
  // The space above and below the clip, and any more below it.
  const chrome =
    2 * clipInset +
    scale(
      min.height - min.clipHeight - 2 * min.clipInset,
      base.height - base.clipHeight - 2 * base.clipInset,
    );
  return { height: clamped, clipHeight: clamped - chrome, clipInset };
}

// Rows shorter than this keep their handle to one line.
const TWO_LINE_ROW_HEIGHT = 44;

// The classes that fit a row's handle to its height (lane-row.css): the
// collapsed form at the minimum, and between that and the row's default
// height, a handle no taller than the row, on one line when it's short.
export function getRowSizeClassName(height: number, defaultHeight: number) {
  if (height <= COLLAPSED_ROW_METRICS.height) {
    return "track-row--collapsed";
  }
  if (height >= defaultHeight) {
    return "";
  }
  return height < TWO_LINE_ROW_HEIGHT
    ? "track-row--short track-row--one-line"
    : "track-row--short";
}

// The CSS variables that size a row other than its default height: the
// lane variables (lane-row.css) its label, clips and selection read, and a
// source track's own (source-tracks.css).
export function getRowHeightStyle(
  kind: RowKind,
  height: number,
): CSSProperties | undefined {
  if (height === DEFAULT_ROW_METRICS[kind].height) {
    return undefined;
  }

  const { clipHeight, clipInset } = getRowMetrics(kind, height);
  const style: Record<string, string> = {
    "--lane-height": `${height}px`,
    "--lane-clip-height": `${clipHeight}px`,
    "--lane-clip-inset": `${clipInset}px`,
  };
  if (kind === "source") {
    style["--source-row-height"] = `${height}px`;
    style["--source-clip-height"] = `${clipHeight}px`;
    style["--source-clip-inset"] = `${clipInset}px`;
  }
  return style as CSSProperties;
}

// Whether a double-click at this target on a row's handle collapses or
// expands the row: anywhere but its name, which renames, and its buttons.
export function isRowCollapseTarget(target: EventTarget) {
  return !(
    target instanceof Element &&
    target.closest(
      ".track-label__select, .track-label__grip, .track-label__hide, .track-label__fx, .track-label__arm, .track-label__rename",
    )
  );
}
