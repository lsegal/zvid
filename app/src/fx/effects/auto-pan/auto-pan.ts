// The Auto Pan effect: an equal-power pan whose position an LFO sweeps
// between left and right. The LFO phase comes from the timeline time, the
// rate times the time when free-running or the bar-aligned position in a
// note value's cycle when synced, so the preview and an export pan
// identically. A centered (mono) sound moves between the speakers; a stereo
// sound has its balance swept.
import type { AudioTempo } from "../../../audio-mix/processor.ts";
import { noteValueSeconds, timelinePhase } from "../../../audio-mix/tempo.ts";

export const AUTO_PAN_EFFECT_NAME = "Auto Pan";

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
export const RATE_MIN = 0.05;
export const RATE_MAX = 20;
export const RATE_DEFAULT = 1;

export const NOTE_DEFAULT = "1 bar";

// A fraction, shown as a percentage.
export const DEPTH_DEFAULT = 1;

export const SHAPE_SINE = "Sine";
export const SHAPE_TRIANGLE = "Triangle";
export const SHAPE_SQUARE = "Square";
export const SHAPE_OPTIONS = [
  SHAPE_SINE,
  SHAPE_TRIANGLE,
  SHAPE_SQUARE,
] as const;
export const SHAPE_DEFAULT = SHAPE_SINE;

export type AutoPanShape = (typeof SHAPE_OPTIONS)[number];

// A square LFO moves between its sides over this long instead of jumping,
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

export function autoPanShape(value: string): AutoPanShape {
  return (
    SHAPE_OPTIONS.find(
      (shape) => shape.toLowerCase() === value.trim().toLowerCase(),
    ) ?? SHAPE_DEFAULT
  );
}

// The triangle wave in phase with sin(2π cycles): 0 at the cycle's start,
// 1 a quarter in, -1 three quarters in.
function triangle(cycles: number) {
  const shifted = cycles + 0.25;
  return 1 - 4 * Math.abs(shifted - Math.floor(shifted) - 0.5);
}

// The LFO's value, -1 (left) to 1 (right), at phase `cycles`. A square's
// edges take `edgeCycles` to cross from one side to the other.
export function autoPanLfo(
  shape: AutoPanShape,
  cycles: number,
  edgeCycles = 0,
) {
  if (shape === SHAPE_SINE) {
    return Math.sin(2 * Math.PI * cycles);
  }
  const wave = triangle(cycles);
  if (shape === SHAPE_TRIANGLE) {
    return wave;
  }
  // The triangle rises 4 per cycle through its zero crossings, so scaling
  // it by 1 / (2 · edge) crosses from -1 to 1 in `edge` cycles.
  const edge = Math.min(0.5, Math.max(edgeCycles, 1e-9));
  return Math.max(-1, Math.min(1, wave / (2 * edge)));
}

// The left and right gains for pan position `position`, -1 (left) to 1
// (right). The center leaves both channels at unity, and the gains' powers
// always sum to 2, so a centered sound keeps its loudness wherever it sits.
export function autoPanGains(position: number): [number, number] {
  const angle = ((Math.max(-1, Math.min(1, position)) + 1) * Math.PI) / 4;
  return [Math.SQRT2 * Math.cos(angle), Math.SQRT2 * Math.sin(angle)];
}

// `cycles` less its nearest whole number of cycles, in -0.5..0.5.
function wrapCycles(cycles: number) {
  return cycles - Math.round(cycles);
}

export type AutoPanBlock = {
  frames: number;
  sampleRate: number;
  // The timeline second of the block's first frame.
  timeSeconds: number;
  // The synced cycle's length in seconds, or undefined when free-running.
  syncedPeriodSeconds: number | undefined;
  shape: AutoPanShape;
  // Each number parameter's value at every frame.
  rate: Float32Array;
  depth: Float32Array;
};

export class AutoPanDsp {
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
    block: AutoPanBlock,
  ) {
    const { frames, sampleRate, timeSeconds, syncedPeriodSeconds, shape } =
      block;
    // A single channel has nowhere to pan to.
    if (this.channels < 2) {
      for (let channel = 0; channel < this.channels; channel++) {
        output[channel].set(input[channel].subarray(0, frames));
      }
      return;
    }
    const relock = Math.exp(-1 / (PHASE_RELOCK_SECONDS * sampleRate));
    const [left, right] = input;
    const [leftOut, rightOut] = output;
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
      const position =
        block.depth[index] *
        autoPanLfo(shape, cycles, SQUARE_EDGE_SECONDS / periodSeconds);
      const [leftGain, rightGain] = autoPanGains(position);
      leftOut[index] = left[index] * leftGain;
      rightOut[index] = right[index] * rightGain;
    }
    // Any channels past the stereo pair pass through.
    for (let channel = 2; channel < this.channels; channel++) {
      output[channel].set(input[channel].subarray(0, frames));
    }
  }
}

// The synced cycle's length for note value `note`, or undefined when Sync
// is off or the note names no length at the tempo.
export function autoPanSyncedPeriod(
  sync: string,
  note: string,
  tempo: AudioTempo,
) {
  if (sync.trim().toLowerCase() !== SYNC_ON.toLowerCase()) {
    return undefined;
  }
  return noteValueSeconds(note, tempo) ?? noteValueSeconds(NOTE_DEFAULT, tempo);
}
