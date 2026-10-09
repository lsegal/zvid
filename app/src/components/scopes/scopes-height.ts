// The Scopes panel's least height, and the least the monitor above it keeps,
// in CSS pixels. It starts sharing the room evenly with the monitor.
export const MIN_SCOPES_HEIGHT_PX = 96;
export const MIN_MONITOR_HEIGHT_PX = 140;

// A `heightPx`-tall panel kept between its least height and the most the
// monitor leaves it when the two share `room` pixels.
export function clampScopesHeight(heightPx: number, room: number) {
  const most = Math.max(MIN_SCOPES_HEIGHT_PX, room - MIN_MONITOR_HEIGHT_PX);
  return Math.min(most, Math.max(MIN_SCOPES_HEIGHT_PX, Math.round(heightPx)));
}
