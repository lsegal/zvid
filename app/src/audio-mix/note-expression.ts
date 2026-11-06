// How a note's expression (see midi-clip.ts) changes the voice playing it:
// bend moves its pitch, pressure its level, and timbre its tone. Every
// instrument hears a curve through these, so they all answer it alike, and a
// note without a curve never comes here.
import type { ExpressionPoint } from "../midi-clip.ts";

// How quiet a voice gets with no pressure on it: pressing can only swell a
// note up to the level its velocity sets, which keeps a chord's headroom.
const PRESSURE_FLOOR = 0.25;
// The Timbre a device rests at: MIDI's center, 64 of 127.
export const TIMBRE_CENTER = 64 / 127;
// How far Timbre moves a filter from its cutoff either way, in octaves.
const TIMBRE_CUTOFF_OCTAVES = 2;
// The range a filter's cutoff is held to.
const MIN_CUTOFF = 20;
const MAX_CUTOFF = 20_000;

/** What a voice's level is multiplied by at `pressure`. */
export function pressureLevel(pressure: number) {
  return PRESSURE_FLOOR + (1 - PRESSURE_FLOOR) * pressure;
}

/** How fast a read of a sample goes for a bend of `semitones`. */
export function bendRate(semitones: number) {
  return 2 ** (semitones / 12);
}

/** The cutoff of a filter set to `cutoff` at `timbre`. */
export function timbreCutoff(cutoff: number, timbre: number) {
  const octaves = (timbre - TIMBRE_CENTER) * 2 * TIMBRE_CUTOFF_OCTAVES;
  return Math.min(MAX_CUTOFF, Math.max(MIN_CUTOFF, cutoff * 2 ** octaves));
}

/** A curve's point on the clock of the voice it shapes. */
export type VoiceCurvePoint = { seconds: number; value: number };

/**
 * `curve` for a voice starting at `startSeconds`, its values through `value`.
 */
export function voiceCurve(
  curve: readonly ExpressionPoint[],
  startSeconds: number,
  secondsPerQuarter: number,
  value: (point: number) => number,
): VoiceCurvePoint[] {
  return curve.map((point) => ({
    seconds: startSeconds + point.at * secondsPerQuarter,
    value: value(point.value),
  }));
}

/** Plays `points` on `param`, from its first until its last. */
export function scheduleVoiceCurve(
  param: AudioParam,
  points: readonly VoiceCurvePoint[],
) {
  const [first, ...rest] = points;
  param.setValueAtTime(first.value, first.seconds);
  for (const point of rest) {
    param.linearRampToValueAtTime(point.value, point.seconds);
  }
}
