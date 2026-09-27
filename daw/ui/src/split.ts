// The body's preview / side column split, as the side column's share of the
// width the two columns divide between them.

export const SIDE_DEFAULT_FRACTION = 0.3;
export const SIDE_MIN_FRACTION = 0.2;
export const SIDE_MAX_FRACTION = 0.6;
export const SIDE_KEY_STEP = 0.02;
export const SPLIT_STORAGE_KEY = "zvid-capture-side-fraction";

/** Clamps a side fraction to the allowed range, rounded to 0.1%. */
export function clampSideFraction(fraction: number): number {
  if (!Number.isFinite(fraction)) return SIDE_DEFAULT_FRACTION;
  const clamped = Math.min(
    SIDE_MAX_FRACTION,
    Math.max(SIDE_MIN_FRACTION, fraction),
  );
  return Math.round(clamped * 1000) / 1000;
}

/** The side fraction after dragging the handle `deltaX` px from its start. */
export function dragSideFraction(
  startFraction: number,
  deltaX: number,
  width: number,
): number {
  if (!(width > 0)) return clampSideFraction(startFraction);
  // The side column sits to the right of the handle, so dragging left widens it.
  return clampSideFraction(startFraction - deltaX / width);
}

/** The side fraction a key press on the handle moves to, or `null`. */
export function keySideFraction(
  fraction: number,
  key: string,
): number | null {
  switch (key) {
    case "ArrowLeft":
      return clampSideFraction(fraction + SIDE_KEY_STEP);
    case "ArrowRight":
      return clampSideFraction(fraction - SIDE_KEY_STEP);
    case "Home":
      return SIDE_MIN_FRACTION;
    case "End":
      return SIDE_MAX_FRACTION;
    default:
      return null;
  }
}

/** The saved side fraction, or the default when none is stored. */
export function loadSideFraction(storage: Pick<Storage, "getItem"> | null) {
  try {
    const saved = storage?.getItem(SPLIT_STORAGE_KEY);
    return saved ? clampSideFraction(Number(saved)) : SIDE_DEFAULT_FRACTION;
  } catch {
    // Storage can be unavailable in the plugin's webview.
    return SIDE_DEFAULT_FRACTION;
  }
}

export function saveSideFraction(
  storage: Pick<Storage, "setItem"> | null,
  fraction: number,
): void {
  try {
    storage?.setItem(SPLIT_STORAGE_KEY, String(fraction));
  } catch {
    // Storage can be unavailable (private mode, quota); resizing still works.
  }
}
