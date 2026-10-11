import {
  INSPECTOR_COLLAPSED_STORAGE_KEY,
  LABEL_WIDTH_DEFAULT,
  LABEL_WIDTH_MAX,
  LABEL_WIDTH_MIN,
  LABEL_WIDTH_STORAGE_KEY,
  PREVIEW_DEFAULT_WIDTH,
  PREVIEW_MIN_WIDTH,
  PREVIEW_RESERVED_WIDTH,
  PREVIEW_TIMELINE_MIN_WIDTH,
  PREVIEW_WIDTH_STORAGE_KEY,
} from "./constants.ts";
import { clamp } from "./util.ts";

// The track labels' width range, its default, and where it is saved.
export type LabelWidthLimits = {
  min: number;
  max: number;
  default: number;
  storageKey: string;
};

export const DESKTOP_LABEL_WIDTH: LabelWidthLimits = {
  min: LABEL_WIDTH_MIN,
  max: LABEL_WIDTH_MAX,
  default: LABEL_WIDTH_DEFAULT,
  storageKey: LABEL_WIDTH_STORAGE_KEY,
};

export function clampLabelWidth(
  width: number,
  limits: LabelWidthLimits = DESKTOP_LABEL_WIDTH,
) {
  return Math.round(clamp(width, limits.min, limits.max));
}

export function readLabelWidth(
  limits: LabelWidthLimits = DESKTOP_LABEL_WIDTH,
) {
  if (typeof window === "undefined") {
    return limits.default;
  }

  try {
    const stored = Number(
      window.localStorage.getItem(limits.storageKey) ?? Number.NaN,
    );
    return Number.isFinite(stored)
      ? clampLabelWidth(stored, limits)
      : limits.default;
  } catch {
    return limits.default;
  }
}

export function readInspectorCollapsed() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return (
      window.localStorage.getItem(INSPECTOR_COLLAPSED_STORAGE_KEY) === "true"
    );
  } catch {
    return false;
  }
}

export function readPreviewWidth() {
  if (typeof window === "undefined") {
    return PREVIEW_DEFAULT_WIDTH;
  }

  try {
    const stored = Number(
      window.localStorage.getItem(PREVIEW_WIDTH_STORAGE_KEY),
    );
    return Number.isFinite(stored) && stored
      ? Math.max(Math.round(stored), PREVIEW_MIN_WIDTH)
      : PREVIEW_DEFAULT_WIDTH;
  } catch {
    return PREVIEW_DEFAULT_WIDTH;
  }
}

// The widest the preview gets: everything the editor grid has left once the
// timeline keeps its layer headers and PREVIEW_TIMELINE_MIN_WIDTH of timeline
// area, and the Media drawer keeps its column. Never under PREVIEW_MIN_WIDTH.
// Unmeasured (0), nothing limits it yet.
export function getPreviewMaxWidth(
  editorGridWidth: number,
  labelWidth: number,
  mediaDrawerWidth = 0,
) {
  if (!editorGridWidth) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(
    PREVIEW_MIN_WIDTH,
    Math.floor(
      editorGridWidth -
        PREVIEW_RESERVED_WIDTH -
        mediaDrawerWidth -
        labelWidth -
        PREVIEW_TIMELINE_MIN_WIDTH,
    ),
  );
}
