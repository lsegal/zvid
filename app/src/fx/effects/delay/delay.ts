// The Delay effect: an echo. Each channel's delay line feeds its output
// back into itself through a one-pole low-pass (High cut), so every repeat
// is Feedback times quieter and a little darker than the one before. With
// Sync on, the delay is a note value at the session tempo; Ping-pong sends
// the repeats back and forth between the left and right channels.
import type { AudioTempo } from "../../../audio-mix/processor.ts";
import {
  noteValueOption,
  noteValueSeconds,
} from "../../../audio-mix/tempo.ts";

export const DELAY_EFFECT_NAME = "Delay";

export const SYNC_KEY = "Sync";
export const TIME_KEY = "Time";
export const NOTE_KEY = "Note";
export const FEEDBACK_KEY = "Feedback";
export const PING_PONG_KEY = "Ping-pong";
export const HIGH_CUT_KEY = "High cut";
export const MIX_KEY = "Mix";

export const OFF = "Off";
export const ON = "On";
export const SWITCH_OPTIONS = [OFF, ON] as const;
export const SYNC_DEFAULT = ON;
export const PING_PONG_DEFAULT = OFF;

// Milliseconds.
export const TIME_MIN_MS = 1;
export const TIME_MAX_MS = 2000;
export const TIME_DEFAULT_MS = 375;

// Shortest first.
export const NOTE_OPTIONS: readonly string[] = [
  noteValueOption("1/32"),
  noteValueOption("1/16"),
  noteValueOption("1/16", "dotted"),
  noteValueOption("1/8", "triplet"),
  noteValueOption("1/8"),
  noteValueOption("1/8", "dotted"),
  noteValueOption("1/4", "triplet"),
  noteValueOption("1/4"),
  noteValueOption("1/4", "dotted"),
  noteValueOption("1/2"),
  noteValueOption("1 bar"),
];
export const NOTE_DEFAULT = noteValueOption("1/8", "dotted");

// Fractions, shown as percentages.
export const FEEDBACK_MAX = 0.95;
export const FEEDBACK_DEFAULT = 0.35;
export const MIX_DEFAULT = 0.3;

// Hz.
export const HIGH_CUT_MIN = 1000;
export const HIGH_CUT_MAX = 20000;
export const HIGH_CUT_DEFAULT = 8000;

// When the synced delay's length changes with the tempo, the read point
// glides to it over about this long rather than jumping, so it does not
// click. A Time edit glides the same way through the chain's own ramp.
export const SYNC_GLIDE_SECONDS = 0.015;

// The repeats count as gone once they fall 90 dB below the input.
const FEEDBACK_SILENCE = Math.log(10 ** (-90 / 20));

// The delay line holds at least this long, and grows for a longer synced
// note (one bar at a slow tempo).
const INITIAL_LINE_SECONDS = TIME_MAX_MS / 1000;

export function formatTimeMs(ms: number) {
  return ms < 100 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`;
}

export function formatHighCut(hz: number) {
  const khz = hz / 1000;
  return `${khz.toFixed(khz < 10 ? 2 : 1)} kHz`;
}

function isOn(value: string) {
  return value.trim().toLowerCase() === ON.toLowerCase();
}

// The synced delay in seconds for note value `note`, or undefined when Sync
// is off. A note that names no length at the tempo uses the default.
export function delaySyncedSeconds(
  sync: string,
  note: string,
  tempo: AudioTempo,
) {
  if (!isOn(sync)) {
    return undefined;
  }
  return noteValueSeconds(note, tempo) ?? noteValueSeconds(NOTE_DEFAULT, tempo);
}

export function delayPingPong(value: string) {
  return isOn(value);
}

// How long the delay keeps sounding once its input falls silent: one pass
// through the line, plus every feedback pass until the repeats fall 90 dB.
// The High cut only takes away from each pass, so this is an upper bound.
export function delayTailSeconds(delaySeconds: number, feedback: number) {
  const passes =
    feedback > 0 ? Math.ceil(FEEDBACK_SILENCE / Math.log(feedback)) : 0;
  return Math.max(0, delaySeconds) * (1 + passes);
}

// The one-pole low-pass coefficient for `cutoff` Hz.
function lowPassCoefficient(cutoff: number, sampleRate: number) {
  return 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
}

export type DelayBlock = {
  frames: number;
  sampleRate: number;
  // The synced delay in seconds, or undefined when free-running.
  syncedSeconds: number | undefined;
  pingPong: boolean;
  // Each number parameter's value at every frame.
  timeMs: Float32Array;
  feedback: Float32Array;
  highCut: Float32Array;
  mix: Float32Array;
};

export class DelayDsp {
  readonly channels: number;
  private lines: Float32Array[];
  private mask: number;
  private write = 0;
  // Each channel's low-pass state in the feedback path.
  private readonly filters: Float64Array;
  private coefficient = 0;
  private lastCutoff = Number.NaN;
  // The synced delay in frames as it glides to a new tempo's length.
  private syncedFrames: number | null = null;
  private glideStep = 0;
  private glideTarget = 0;

  constructor(sampleRate: number, channels: number) {
    this.channels = channels;
    const size = lineSize(INITIAL_LINE_SECONDS * sampleRate);
    this.mask = size - 1;
    this.lines = Array.from({ length: channels }, () => new Float32Array(size));
    this.filters = new Float64Array(channels);
  }

  // Grows the lines to hold `frames` of delay, keeping what they hold.
  private reserve(frames: number) {
    const size = lineSize(frames);
    if (size <= this.lines[0].length) {
      return;
    }
    const oldSize = this.mask + 1;
    this.lines = this.lines.map((line) => {
      const grown = new Float32Array(size);
      // Oldest first, ending just before the write position.
      for (let age = 1; age <= oldSize; age++) {
        grown[(oldSize - age) & (size - 1)] =
          line[(this.write - age) & this.mask];
      }
      return grown;
    });
    this.write = oldSize & (size - 1);
    this.mask = size - 1;
  }

  // The synced delay in frames this frame, gliding to `target`.
  private syncedDelay(target: number, glideFrames: number) {
    if (this.syncedFrames === null) {
      this.syncedFrames = target;
      this.glideTarget = target;
    } else if (target !== this.glideTarget) {
      this.glideTarget = target;
      this.glideStep = (target - this.syncedFrames) / glideFrames;
    }
    if (this.syncedFrames !== this.glideTarget) {
      const next = this.syncedFrames + this.glideStep;
      const passed =
        this.glideStep > 0 ? next >= this.glideTarget : next <= this.glideTarget;
      this.syncedFrames = passed ? this.glideTarget : next;
    }
    return this.syncedFrames;
  }

  // The line's sample `delay` frames (at least 1) before the write point,
  // interpolated linearly between its two nearest frames.
  private read(line: Float32Array, delay: number) {
    const whole = Math.floor(delay);
    const fraction = delay - whole;
    const newer = line[(this.write - whole) & this.mask];
    if (fraction === 0) {
      return newer;
    }
    const older = line[(this.write - whole - 1) & this.mask];
    return newer + (older - newer) * fraction;
  }

  process(
    input: readonly Float32Array[],
    output: Float32Array[],
    block: DelayBlock,
  ) {
    const { frames, sampleRate, syncedSeconds } = block;
    const pingPong = block.pingPong && this.channels >= 2;
    const glideFrames = Math.max(1, SYNC_GLIDE_SECONDS * sampleRate);
    if (syncedSeconds !== undefined) {
      this.reserve(syncedSeconds * sampleRate + 2);
    } else {
      this.syncedFrames = null;
    }
    const filters = this.filters;
    for (let index = 0; index < frames; index++) {
      const delay = Math.min(
        this.mask - 1,
        Math.max(
          1,
          syncedSeconds !== undefined
            ? this.syncedDelay(syncedSeconds * sampleRate, glideFrames)
            : (block.timeMs[index] / 1000) * sampleRate,
        ),
      );
      const cutoff = block.highCut[index];
      if (cutoff !== this.lastCutoff) {
        this.coefficient = lowPassCoefficient(cutoff, sampleRate);
        this.lastCutoff = cutoff;
      }
      const coefficient = this.coefficient;
      const feedback = block.feedback[index];
      const mix = block.mix[index];
      const write = this.write;

      for (let channel = 0; channel < this.channels; channel++) {
        const wet = this.read(this.lines[channel], delay);
        filters[channel] += coefficient * (wet - filters[channel]);
        output[channel][index] =
          input[channel][index] * (1 - mix) + wet * mix;
      }
      if (pingPong) {
        // Both inputs go into the left line; each line's repeats go into
        // the other, so they alternate left, right, left…
        const [left, right] = this.lines;
        left[write] =
          (input[0][index] + input[1][index]) / 2 + filters[1] * feedback;
        right[write] = filters[0] * feedback;
        for (let channel = 2; channel < this.channels; channel++) {
          this.lines[channel][write] =
            input[channel][index] + filters[channel] * feedback;
        }
      } else {
        for (let channel = 0; channel < this.channels; channel++) {
          this.lines[channel][write] =
            input[channel][index] + filters[channel] * feedback;
        }
      }
      this.write = (write + 1) & this.mask;
    }
  }
}

// The power of two above `frames`, with room for the interpolation.
function lineSize(frames: number) {
  let size = 1;
  while (size < Math.ceil(frames) + 4) {
    size *= 2;
  }
  return size;
}
