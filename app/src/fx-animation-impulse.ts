// The core of the Animation modifier's Reactive mode, which audio effects'
// Modulation reuses as Transient: the envelope a hit starts, the hit running
// at a time, and each knob's seeded swing. It imports nothing at run time,
// so the audio chain worklet can bundle it.

import type { ReactiveMotion } from "./fx-animation-defaults.ts";
import type { AudioOnset } from "./fx-shaders/audio-bands.ts";

// Timing frames are counted at this rate when no session frame rate is given.
export const REACTIVE_FRAME_RATE = 30;

// A knob swings by at most this fraction of its range at full amplitude.
export const DEFAULT_REACTIVE_RANGE_SCALE = 0.25;

// Hits land on the audio detector's 60 Hz grid; a hit's grid index seeds its
// random offsets.
const ONSET_GRID_RATE = 60;
// Absorbs rounding in times that land on a frame boundary.
const FRAME_EPSILON = 1e-6;

// The Motion curve over the envelope's normalized time `u` (0..1). Bounce is
// a single push that settles; Wobble is a damped swing either side of zero.
export function reactiveEnvelope(motion: ReactiveMotion, u: number) {
  if (u < 0 || u >= 1) {
    return 0;
  }
  switch (motion) {
    case "Bounce":
      return Math.sin(Math.PI * u) * (1 - u) ** 1.5;
    case "Wobble":
      return Math.sin(3 * 2 * Math.PI * u) * (1 - u) ** 2;
    default:
      return 0;
  }
}

// A hit in timeline time: seconds from the timeline start.
export type ReactiveOnset = { time: number; strength: number };

export type ReactiveImpulse = {
  // Grid index of the hit that last (re)started the envelope.
  seed: number;
  // Hit strength the envelope runs at, 0..1.
  strength: number;
  // Normalized time through the envelope, 0..1.
  u: number;
};

// The envelope running at `time` (seconds), or undefined when none is. Each
// hit starts an envelope `lengthFrames` long at `fps`; a hit while one is
// running restarts it at the larger of the two strengths. `onsets` must be
// in ascending time order, as `placeOnsets` gives them. Runs every frame, so
// it searches rather than sorting or copying the hits, and fills `into`
// when given one rather than making a new impulse.
export function findReactiveImpulse(
  onsets: readonly ReactiveOnset[],
  time: number,
  lengthFrames: number,
  fps = REACTIVE_FRAME_RATE,
  into?: ReactiveImpulse,
): ReactiveImpulse | undefined {
  if (!(lengthFrames > 0) || !(fps > 0)) {
    return undefined;
  }

  // The first hit after `time`; the one before it last (re)started the
  // envelope.
  let low = 0;
  let high = onsets.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (framesBetween(time, onsets[middle].time, fps) > FRAME_EPSILON) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  let index = low - 1;
  if (index < 0) {
    return undefined;
  }
  const start = onsets[index].time;
  if (!isRunning(start, time, fps, lengthFrames)) {
    return undefined;
  }
  // Each hit that landed while the previous envelope ran carried that
  // envelope's strength forward.
  let strength = onsets[index].strength;
  while (
    index > 0 &&
    isRunning(onsets[index - 1].time, onsets[index].time, fps, lengthFrames)
  ) {
    index--;
    strength = Math.max(strength, onsets[index].strength);
  }
  const impulse = into ?? { seed: 0, strength: 0, u: 0 };
  impulse.seed = Math.round(start * ONSET_GRID_RATE);
  impulse.strength = strength;
  impulse.u = Math.max(0, framesBetween(start, time, fps)) / lengthFrames;
  return impulse;
}

function framesBetween(from: number, to: number, fps: number) {
  return (to - from) * fps;
}

// Whether an envelope that started at `start` still runs at `at`.
function isRunning(start: number, at: number, fps: number, lengthFrames: number) {
  return framesBetween(start, at, fps) < lengthFrames - FRAME_EPSILON;
}

// The timeline second of a hit `secondsAgo` before `time`, snapped to the
// detector's grid.
export function onsetTime(time: number, secondsAgo: number) {
  return Math.round((time - secondsAgo) * ONSET_GRID_RATE) / ONSET_GRID_RATE;
}

// The detector's recent hits placed on the timeline at `time` (seconds), in
// ascending time order. Hits are snapped to the detector's grid so their
// seeds don't drift.
export function placeOnsets(
  onsets: readonly AudioOnset[] | undefined,
  time: number,
): ReactiveOnset[] {
  return (onsets ?? []).map((onset) => ({
    time: onsetTime(time, onset.secondsAgo),
    strength: onset.strength,
  }));
}

// FNV-1a over the string, then a final avalanche.
function hashString(text: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

// The direction and size, -1..1, a hit pushes a parameter by. The same
// effect, parameter and hit always give the same value.
export function reactiveOffset(effectId: string, key: string, seed: number) {
  return (
    (hashString(`${effectId}\u0000${key}\u0000${seed}`) / 0xffffffff) * 2 - 1
  );
}

export type ReactiveSwing = { seed: number; amount: number };

// The hit moving the knobs at `time` under Reactive settings, and how hard:
// `amount` is the Motion envelope scaled by Reactivity and the hit's
// strength. Undefined while nothing moves. With `into`, it fills that and
// `impulse` rather than making new objects, for the audio thread.
export function reactiveSwingAt(
  reactive: { motion: ReactiveMotion; reactivity: number },
  onsets: readonly ReactiveOnset[],
  time: number,
  lengthFrames: number,
  fps = REACTIVE_FRAME_RATE,
  into?: { swing: ReactiveSwing; impulse: ReactiveImpulse },
): ReactiveSwing | undefined {
  if (reactive.motion === "None" || !(reactive.reactivity > 0)) {
    return undefined;
  }
  const impulse = findReactiveImpulse(
    onsets,
    time,
    lengthFrames,
    fps,
    into?.impulse,
  );
  if (!impulse) {
    return undefined;
  }
  const amount =
    reactiveEnvelope(reactive.motion, impulse.u) *
    Math.min(1, reactive.reactivity) *
    impulse.strength;
  if (amount === 0) {
    return undefined;
  }
  const swing = into?.swing ?? { seed: 0, amount: 0 };
  swing.seed = impulse.seed;
  swing.amount = amount;
  return swing;
}
