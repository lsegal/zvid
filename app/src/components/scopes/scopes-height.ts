// The Scopes panel's least height, and the least the monitor above it keeps,
// in CSS pixels. It starts sharing the room evenly with the monitor.
export const MIN_SCOPES_HEIGHT_PX = 96;
export const MIN_MONITOR_HEIGHT_PX = 140;
// On a phone the monitor keeps its size and the panel trades height with the
// timeline below instead, which keeps at least this much (#1202).
export const MIN_PHONE_TIMELINE_HEIGHT_PX = 100;

// A `heightPx`-tall panel kept between its least height and the most its
// neighbor leaves it when the two share `room` pixels. The neighbor keeps
// `neighborMinPx`: the monitor's least height unless given.
export function clampScopesHeight(
  heightPx: number,
  room: number,
  neighborMinPx = MIN_MONITOR_HEIGHT_PX,
) {
  const most = Math.max(MIN_SCOPES_HEIGHT_PX, room - neighborMinPx);
  return Math.min(most, Math.max(MIN_SCOPES_HEIGHT_PX, Math.round(heightPx)));
}
