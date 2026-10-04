// The hits the preview has heard, placed on the timeline, for the Animation
// section's Reactive graph. A graph watches while it shows; the preview
// records the hits its audio bands report each frame it plays while one
// does. They are kept after playback stops, so a stopped graph still shows
// the hits around the playhead.
import { placeOnsets, type ReactiveOnset } from "./fx-animation-impulse.ts";
import {
  type AudioBands,
  ONSET_MEMORY_SECONDS,
} from "./fx-shaders/audio-bands.ts";

// Hits further than this from the latest ones are dropped.
const KEEP_SECONDS = 120;

let onsets: ReactiveOnset[] = [];
let watchers = 0;

// Asks for the hits until the returned function is called.
export function watchReactiveOnsets() {
  watchers += 1;
  let watching = true;
  return () => {
    if (watching) {
      watching = false;
      watchers -= 1;
    }
  };
}

// Whether a graph wants the hits.
export function isWatchingReactiveOnsets() {
  return watchers > 0;
}

// Takes the hits `recent` heard over the `memorySeconds` up to `time`, in
// ascending time order, in place of the ones kept over that span: a span
// played again is heard afresh.
export function recordReactiveOnsets(
  recent: readonly ReactiveOnset[],
  time: number,
  memorySeconds: number,
) {
  const from = time - memorySeconds;
  const kept = onsets.filter(
    (onset) =>
      (onset.time <= from || onset.time > time) &&
      Math.abs(onset.time - time) <= KEEP_SECONDS,
  );
  const insertAt = kept.findIndex((onset) => onset.time > time);
  const at = insertAt < 0 ? kept.length : insertAt;
  onsets = [
    ...kept.slice(0, at),
    ...recent.filter((onset) => onset.time > from && onset.time <= time),
    ...kept.slice(at),
  ];
}

// Records the hits in the preview's `bands`, heard with the playhead at
// `playheadQ` (none while stopped) at `bpm`, while a graph watches. Returns
// `bands`.
export function recordHeardOnsets(
  bands: AudioBands,
  playheadQ: number | undefined,
  bpm: number,
) {
  if (watchers > 0 && playheadQ !== undefined && bpm > 0) {
    const time = (playheadQ * 60) / bpm;
    recordReactiveOnsets(
      placeOnsets(bands.onsets, time),
      time,
      ONSET_MEMORY_SECONDS,
    );
  }
  return bands;
}

// The hits heard so far, in ascending time order.
export function reactiveOnsets(): readonly ReactiveOnset[] {
  return onsets;
}

// Forgets every hit, for tests.
export function clearReactiveOnsets() {
  onsets = [];
}
