import { expect, test } from "vitest";
import { DEFAULT_GRANULAR_PARAMS, GRANULAR_PARAM_RANGES } from "../midi-clip.ts";
import {
  granularGrains,
  mixGrains,
  mixGrainsOffThread,
  renderGranularClip,
} from "./granular.ts";

// The Granular at its longest, densest grains: dozens of grains sound at
// once in every note.
const DENSEST = {
  ...DEFAULT_GRANULAR_PARAMS,
  grainSize: GRANULAR_PARAM_RANGES.grainSize.max,
  density: GRANULAR_PARAM_RANGES.density.max,
  spray: 1,
};
// Four bars of four-note chords at 120 bpm.
const CHORDS = [60, 64, 67, 71].flatMap((pitch) =>
  [0, 4, 8, 12].map((start) => ({ pitch, start, length: 4, velocity: 100 })),
);

test("a Granular clip at its longest, densest grains renders without stalling the main thread", async () => {
  let longestGap = 0;
  let lastTick = performance.now();
  const ticker = setInterval(() => {
    const now = performance.now();
    longestGap = Math.max(longestGap, now - lastTick);
    lastTick = now;
  }, 5);
  try {
    const rendered = await renderGranularClip(
      CHORDS,
      DENSEST,
      8,
      120,
      48_000,
    );
    expect(rendered.channels[0].length).toBe(8 * 48_000);
    expect(rendered.channels[0].some((sample) => sample !== 0)).toBe(true);
  } finally {
    clearInterval(ticker);
  }
  // Mixed on the main thread, these grains held it for over a second.
  expect(longestGap).toBeLessThan(150);
});

test("grains mixed in a worker match those mixed in place", async () => {
  const grains = granularGrains(CHORDS, DENSEST, 120, 2);
  const mixed = await mixGrainsOffThread(grains, 48_000, 2 * 48_000);
  expect(mixed).toEqual(mixGrains(grains, 48_000, 2 * 48_000));
});
