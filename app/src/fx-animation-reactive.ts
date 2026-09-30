// Reactive mode of the Animation modifier: on each audio hit, the effect's
// selected knobs jump by a random amount and settle back along the Motion
// curve over the Timing, scaled by Reactivity and the hit's strength.

import {
  getReactiveTimingFrames,
  type ReactiveAnimation,
  type ReactiveMotion,
} from "./fx-animation-defaults.ts";
import { getEffectDefinition } from "./fx-registry.ts";
import type { AudioOnset } from "./fx-shaders/audio-bands.ts";

type ReactiveParameter = {
  key: string;
  value: string;
  numericValue?: number;
};

export type ReactiveEffect = {
  id?: string;
  effectName: string;
  parameters: ReactiveParameter[];
};

// Timing frames are counted at this rate so preview and export agree at any
// frame rate.
export const REACTIVE_FRAME_RATE = 30;

// A knob swings by at most this fraction of its range at full amplitude.
export const DEFAULT_REACTIVE_RANGE_SCALE = 0.25;

// Hits land on the audio detector's 60 Hz grid; a hit's grid index seeds its
// random offsets.
const ONSET_GRID_RATE = 60;
// Absorbs rounding in times that land on a frame boundary.
const FRAME_EPSILON = 1e-6;

// The Motion curve over the envelope's normalised time `u` (0..1). Bounce is
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
  // Normalised time through the envelope, 0..1.
  u: number;
};

// The envelope running at `time` (seconds), or undefined when none is. Each
// hit starts an envelope `lengthFrames` long; a hit while one is running
// restarts it at the larger of the two strengths.
export function findReactiveImpulse(
  onsets: readonly ReactiveOnset[],
  time: number,
  lengthFrames: number,
): ReactiveImpulse | undefined {
  if (!(lengthFrames > 0)) {
    return undefined;
  }
  const framesBetween = (from: number, to: number) =>
    (to - from) * REACTIVE_FRAME_RATE;
  const isRunning = (start: number, at: number) =>
    framesBetween(start, at) < lengthFrames - FRAME_EPSILON;

  let start: number | undefined;
  let strength = 0;
  const ordered = [...onsets].sort((left, right) => left.time - right.time);
  for (const onset of ordered) {
    if (framesBetween(time, onset.time) > FRAME_EPSILON) {
      break;
    }
    const running = start !== undefined && isRunning(start, onset.time);
    strength = running ? Math.max(strength, onset.strength) : onset.strength;
    start = onset.time;
  }

  if (start === undefined || !isRunning(start, time)) {
    return undefined;
  }
  return {
    seed: Math.round(start * ONSET_GRID_RATE),
    strength,
    u: Math.max(0, framesBetween(start, time)) / lengthFrames,
  };
}

// The detector's recent hits placed on the timeline at `time` (seconds).
// Hits are snapped to the detector's grid so their seeds don't drift.
export function placeOnsets(
  onsets: readonly AudioOnset[] | undefined,
  time: number,
): ReactiveOnset[] {
  return (onsets ?? []).map((onset) => ({
    time:
      Math.round((time - onset.secondsAgo) * ONSET_GRID_RATE) / ONSET_GRID_RATE,
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

export type ReactiveOptions = {
  // Seconds from the timeline start.
  time: number;
  onsets: readonly ReactiveOnset[];
  rangeScale?: number;
};

// The parameters `effect` is drawn with at `options.time` under `reactive`.
// Only the selected knobs move, each clamped to its limits. Returns
// `effect.parameters` itself when nothing moves.
export function resolveReactiveParameters(
  effect: ReactiveEffect,
  reactive: ReactiveAnimation,
  options: ReactiveOptions,
): ReactiveParameter[] {
  if (
    reactive.motion === "None" ||
    !(reactive.reactivity > 0) ||
    !reactive.parameters.length
  ) {
    return effect.parameters;
  }

  const impulse = findReactiveImpulse(
    options.onsets,
    options.time,
    getReactiveTimingFrames(effect.effectName, reactive.timing),
  );
  if (!impulse) {
    return effect.parameters;
  }

  const envelope = reactiveEnvelope(reactive.motion, impulse.u);
  const amplitude = Math.min(1, reactive.reactivity) * impulse.strength;
  if (envelope === 0 || amplitude === 0) {
    return effect.parameters;
  }

  const selected = new Set(reactive.parameters);
  const rangeScale = options.rangeScale ?? DEFAULT_REACTIVE_RANGE_SCALE;
  const effectId = effect.id ?? effect.effectName;
  let result: ReactiveParameter[] | undefined;
  for (const definition of getEffectDefinition(effect.effectName).parameters) {
    if (
      definition.kind !== "number" ||
      definition.hidden ||
      !selected.has(definition.key)
    ) {
      continue;
    }
    const index = effect.parameters.findIndex(
      (parameter) => parameter.key === definition.key,
    );
    const parameter = effect.parameters[index];
    const base = parameter?.numericValue ?? Number(parameter?.value);
    if (!parameter || !Number.isFinite(base)) {
      continue;
    }

    const swing =
      reactiveOffset(effectId, definition.key, impulse.seed) *
      amplitude *
      envelope *
      (definition.max - definition.min) *
      rangeScale;
    const value = Math.max(
      definition.min,
      Math.min(definition.max, base + swing),
    );
    if (value === base) {
      continue;
    }
    result ??= effect.parameters.slice();
    result[index] = {
      ...parameter,
      value: value.toFixed(3),
      numericValue: value,
    };
  }
  return result ?? effect.parameters;
}
