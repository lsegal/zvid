// The Tremolo effect: rhythmic volume modulation. An LFO sets the gain,
// 1 − Depth · (1 − lfo) / 2, so the sound swings between full level and
// 1 − Depth once a cycle. The LFO phase comes from the timeline time, the
// rate times the time when free-running or the bar-aligned position in a
// note value's cycle when synced, so the preview, scrubbing and an export
// modulate identically.
import type { AudioTempo } from "../../../audio-mix/processor.ts";
import {
  NOTE_VALUES,
  noteValueOption,
  noteValueSeconds,
  timelinePhase,
} from "../../../audio-mix/tempo.ts";

export const TREMOLO_EFFECT_NAME = "Tremolo";

export const SYNC_KEY = "Sync";
export const RATE_KEY = "Rate";
export const NOTE_KEY = "Note";
export const DEPTH_KEY = "Depth";
export const SHAPE_KEY = "Shape";

export const SYNC_OFF = "Off";
export const SYNC_ON = "On";
export const SYNC_OPTIONS = [SYNC_OFF, SYNC_ON] as const;
export const SYNC_DEFAULT = SYNC_ON;

// Hz.
export const RATE_MIN = 0.1;
export const RATE_MAX = 20;
export const RATE_DEFAULT = 5;

// 1/32 up to one bar, each straight, dotted and triplet.
export const NOTE_OPTIONS: readonly string[] = NOTE_VALUES.slice(
  0,
  NOTE_VALUES.indexOf("1 bar") + 1,
).flatMap((value) => [
  noteValueOption(value),
  noteValueOption(value, "dotted"),
  noteValueOption(value, "triplet"),
]);
export const NOTE_DEFAULT = "1/8";

// A fraction, shown as a percentage.
export const DEPTH_DEFAULT = 0.5;

export const SHAPE_SINE = "Sine";
export const SHAPE_TRIANGLE = "Triangle";
export const SHAPE_SQUARE = "Square";
export const SHAPE_OPTIONS = [
  SHAPE_SINE,
  SHAPE_TRIANGLE,
  SHAPE_SQUARE,
] as const;
export const SHAPE_DEFAULT = SHAPE_SINE;

export type TremoloShape = (typeof SHAPE_OPTIONS)[number];

// A square LFO moves between its levels over this long instead of jumping,
// so its edges do not click.
export const SQUARE_EDGE_SECONDS = 0.005;

// After a live Rate change the LFO keeps its phase, then drifts back into
// step with the timeline over about this long, so playback after the edit
// matches an export again.
export const PHASE_RELOCK_SECONDS = 0.5;

// Below this many cycles the drift back counts as done.
const PHASE_LOCKED = 1e-9;

export function formatRate(hz: number) {
  return `${hz < 1 ? hz.toFixed(2) : hz.toFixed(1)} Hz`;
}

export function tremoloShape(value: string): TremoloShape {
  return (
    SHAPE_OPTIONS.find(
      (shape) => shape.toLowerCase() === value.trim().toLowerCase(),
    ) ?? SHAPE_DEFAULT
  );
}

// The triangle wave in phase with cos(2π cycles): 1 at the cycle's start,
// -1 halfway through.
function triangle(cycles: number) {
  return 4 * Math.abs(cycles - Math.floor(cycles) - 0.5) - 1;
}

// The LFO's value, -1 to 1, at phase `cycles`: 1 (full level) at each
// cycle's start, so the loudest point falls on the beat when synced. A
// square's edges take `edgeCycles` to cross from one level to the other.
export function tremoloLfo(
  shape: TremoloShape,
  cycles: number,
  edgeCycles = 0,
) {
  if (shape === SHAPE_SINE) {
    return Math.cos(2 * Math.PI * cycles);
  }
  const wave = triangle(cycles);
  if (shape === SHAPE_TRIANGLE) {
    return wave;
  }
  // The triangle moves 4 per cycle through its zero crossings, so scaling
  // it by 1 / (2 · edge) crosses from -1 to 1 in `edge` cycles.
  const edge = Math.min(0.5, Math.max(edgeCycles, 1e-9));
  return Math.max(-1, Math.min(1, wave / (2 * edge)));
}

// The gain for LFO value `lfo` at `depth`: 1 at the LFO's top, 1 − depth at
// its bottom.
export function tremoloGain(depth: number, lfo: number) {
  return 1 - (depth * (1 - lfo)) / 2;
}

// `cycles` less its nearest whole number of cycles, in -0.5..0.5.
function wrapCycles(cycles: number) {
  return cycles - Math.round(cycles);
}

export type TremoloBlock = {
  frames: number;
  sampleRate: number;
  // The timeline second of the block's first frame.
  timeSeconds: number;
  // The synced cycle's length in seconds, or undefined when free-running.
  syncedPeriodSeconds: number | undefined;
  shape: TremoloShape;
  // Each number parameter's value at every frame.
  rate: Float32Array;
  depth: Float32Array;
};

export class TremoloDsp {
  readonly channels: number;
  // Cycles added to the free-running phase to keep it continuous across a
  // live Rate change; it decays back to 0 over PHASE_RELOCK_SECONDS.
  private phaseOffset = 0;
  private lastRate: number | null = null;

  constructor(channels: number) {
    this.channels = channels;
  }

  // The free-running LFO's phase in cycles at timeline second `seconds`.
  private freePhase(seconds: number, rate: number, relock: number) {
    if (this.lastRate !== null && rate !== this.lastRate) {
      // Keep the phase where it was at this instant under the new rate.
      this.phaseOffset = wrapCycles(
        this.phaseOffset + seconds * (this.lastRate - rate),
      );
    } else if (this.phaseOffset !== 0) {
      this.phaseOffset *= relock;
      if (Math.abs(this.phaseOffset) < PHASE_LOCKED) {
        this.phaseOffset = 0;
      }
    }
    this.lastRate = rate;
    return seconds * rate + this.phaseOffset;
  }

  process(
    input: readonly Float32Array[],
    output: Float32Array[],
    block: TremoloBlock,
  ) {
    const { frames, sampleRate, timeSeconds, syncedPeriodSeconds, shape } =
      block;
    const relock = Math.exp(-1 / (PHASE_RELOCK_SECONDS * sampleRate));
    for (let index = 0; index < frames; index++) {
      const seconds = timeSeconds + index / sampleRate;
      let cycles: number;
      let periodSeconds: number;
      if (syncedPeriodSeconds !== undefined) {
        cycles = timelinePhase(seconds, syncedPeriodSeconds);
        periodSeconds = syncedPeriodSeconds;
      } else {
        const rate = block.rate[index];
        cycles = this.freePhase(seconds, rate, relock);
        periodSeconds = 1 / rate;
      }
      const gain = tremoloGain(
        block.depth[index],
        tremoloLfo(shape, cycles, SQUARE_EDGE_SECONDS / periodSeconds),
      );
      for (let channel = 0; channel < this.channels; channel++) {
        output[channel][index] = input[channel][index] * gain;
      }
    }
  }
}

// The synced cycle's length for note value `note`, or undefined when Sync
// is off. A note that names no length at the tempo uses the default.
export function tremoloSyncedPeriod(
  sync: string,
  note: string,
  tempo: AudioTempo,
) {
  if (sync.trim().toLowerCase() !== SYNC_ON.toLowerCase()) {
    return undefined;
  }
  return noteValueSeconds(note, tempo) ?? noteValueSeconds(NOTE_DEFAULT, tempo);
}
