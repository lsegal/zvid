import {
  INSPECTOR_COLLAPSED_STORAGE_KEY,
  LABEL_WIDTH_DEFAULT,
  LABEL_WIDTH_MAX,
  LABEL_WIDTH_MIN,
  LABEL_WIDTH_STORAGE_KEY,
  PREVIEW_DEFAULT_WIDTH,
  PREVIEW_MAX_WIDTH,
  PREVIEW_MIN_WIDTH,
  PREVIEW_RESERVED_WIDTH,
  PREVIEW_WIDTH_STORAGE_KEY,
} from "./constants.ts";
import { clamp } from "./util.ts";

export function clampLabelWidth(width: number) {
  return Math.round(clamp(width, LABEL_WIDTH_MIN, LABEL_WIDTH_MAX));
}

export function readLabelWidth() {
  if (typeof window === "undefined") {
    return LABEL_WIDTH_DEFAULT;
  }

  try {
    const stored = Number(
      window.localStorage.getItem(LABEL_WIDTH_STORAGE_KEY) ?? Number.NaN,
    );
    return Number.isFinite(stored)
      ? clampLabelWidth(stored)
      : LABEL_WIDTH_DEFAULT;
  } catch {
    return LABEL_WIDTH_DEFAULT;
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
    return stored
      ? clamp(Math.round(stored), PREVIEW_MIN_WIDTH, PREVIEW_MAX_WIDTH)
      : PREVIEW_DEFAULT_WIDTH;
  } catch {
    return PREVIEW_DEFAULT_WIDTH;
  }
}

export function getPreviewMaxWidth(editorGridWidth: number) {
  if (!editorGridWidth) {
    return PREVIEW_MAX_WIDTH;
  }

  return clamp(
    editorGridWidth - PREVIEW_RESERVED_WIDTH,
    PREVIEW_MIN_WIDTH,
    PREVIEW_MAX_WIDTH,
  );
}
