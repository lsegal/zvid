import { WAVEFORM_MAX_LEVEL, WAVEFORM_TICKS } from "../fx/controls/waveform.ts";

// The least CSS pixels between neighboring scale labels: a 9px label's line
// height plus a little room, so labels never touch.
export const LEVEL_LABEL_MIN_PX = 13;
// Room for a histogram label ("255" at 9px is about 15px wide) and a gap.
export const HISTOGRAM_LABEL_MIN_PX = 24;
// How far in from the plot's edges the histogram's end labels sit.
export const HISTOGRAM_LABEL_INSET_PX = 8;

// The least gap between neighbors of `positions`, which ascend.
function leastGap(positions: number[]) {
  let least = Number.POSITIVE_INFINITY;
  for (let index = 1; index < positions.length; index++) {
    least = Math.min(least, positions[index] - positions[index - 1]);
  }
  return least;
}

// The waveform and parade levels to draw on a `heightPx`-tall plot: every
// tick while their labels fit, then every 256, then 0, 512 and 1023, and at
// least 0 and 1023, like the timeline ruler thinning its bar labels.
export function graticuleLevels(
  heightPx: number,
  minPx = LEVEL_LABEL_MIN_PX,
): number[] {
  const pxPerLevel = Math.max(0, heightPx) / WAVEFORM_MAX_LEVEL;
  for (const step of [128, 256, 512]) {
    const levels = WAVEFORM_TICKS.filter(
      (level) => level % step === 0 || level === WAVEFORM_MAX_LEVEL,
    );
    if (leastGap(levels) * pxPerLevel >= minPx) {
      return levels;
    }
  }
  return [0, WAVEFORM_MAX_LEVEL];
}

// The shares of the histogram's width to mark on a `widthPx`-wide plot:
// quarters while their labels fit, then halves, and at least both ends. The
// end labels sit `insetPx` in from the edges.
export function histogramShares(
  widthPx: number,
  minPx = HISTOGRAM_LABEL_MIN_PX,
  insetPx = HISTOGRAM_LABEL_INSET_PX,
): number[] {
  const width = Math.max(0, widthPx);
  const labelX = (share: number) =>
    Math.min(Math.max(width * share, insetPx), width - insetPx);
  for (const parts of [4, 2]) {
    const shares = Array.from({ length: parts + 1 }, (_, i) => i / parts);
    if (leastGap(shares.map(labelX)) >= minPx) {
      return shares;
    }
  }
  return [0, 1];
}
