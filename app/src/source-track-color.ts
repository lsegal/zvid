/** The number of colors in the source-track palette. */
export const PALETTE_SIZE = 5;

/**
 * The palette color of the source track at `index`: like the Layers app, the
 * palette cycles in track order from its last color, 4, 0, 1, 2, 3, 4, ...
 */
export function sourceTrackColorIndex(index: number) {
  return (index + PALETTE_SIZE - 1) % PALETTE_SIZE;
}

/**
 * The color of an opened session's source track at `index`: its own when the
 * session sets one, including -1, or else its place in the cycle.
 */
export function sessionSourceTrackColorIndex(
  colorIndex: number | undefined,
  index: number,
) {
  return colorIndex ?? sourceTrackColorIndex(index);
}

/**
 * The color for a source track added after `tracks`: the one after the last
 * track's, so the new track does not repeat it. A last track without a
 * palette color (-1) continues the cycle from its position instead.
 */
export function nextSourceTrackColorIndex(
  tracks: ReadonlyArray<{ colorIndex: number }>,
) {
  const last = tracks.at(-1)?.colorIndex;
  return last === undefined || last < 0
    ? sourceTrackColorIndex(tracks.length)
    : (last + 1) % PALETTE_SIZE;
}
