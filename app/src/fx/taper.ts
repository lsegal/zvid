// Where a number parameter sits along its knob's travel. A linear taper
// spreads the range evenly; a log taper (frequencies, times) spreads it by
// ratio, so each turn of the knob multiplies the value by the same amount.
// A log taper needs a positive range and falls back to linear otherwise.
import type { FxNumberTaper } from "./types.ts";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isLog(min: number, max: number, taper: FxNumberTaper | undefined) {
  return taper === "log" && min > 0 && max > min;
}

// The position of `value` along the travel, 0 at `min` to 1 at `max`.
export function taperPosition(
  value: number,
  min: number,
  max: number,
  taper?: FxNumberTaper,
) {
  if (isLog(min, max, taper)) {
    return clamp(Math.log(value / min) / Math.log(max / min), 0, 1);
  }
  return max > min ? (clamp(value, min, max) - min) / (max - min) : 0;
}

// The value at `position` (0..1) along the travel.
export function taperValue(
  position: number,
  min: number,
  max: number,
  taper?: FxNumberTaper,
) {
  const along = clamp(position, 0, 1);
  if (isLog(min, max, taper)) {
    return min * (max / min) ** along;
  }
  return min + along * (max - min);
}
