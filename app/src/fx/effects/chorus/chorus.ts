// The Chorus effect: a short delay per channel whose length a sine LFO
// sweeps, mixed back with the dry signal. The LFO phase is the timeline
// time times the rate, so the preview and an export modulate identically;
// Spread offsets the right channel's phase by up to half a cycle.

export const CHORUS_EFFECT_NAME = "Chorus";

export const RATE_KEY = "Rate";
export const DEPTH_KEY = "Depth";
export const DELAY_KEY = "Delay";
export const FEEDBACK_KEY = "Feedback";
export const SPREAD_KEY = "Spread";
export const MIX_KEY = "Mix";

// Hz.
export const RATE_MIN = 0.05;
export const RATE_MAX = 5;
export const RATE_DEFAULT = 0.8;
// Milliseconds.
export const DELAY_MIN_MS = 5;
export const DELAY_MAX_MS = 30;
export const DELAY_DEFAULT_MS = 15;
// Fractions, shown as percentages.
export const DEPTH_DEFAULT = 0.5;
export const FEEDBACK_MAX = 0.9;
export const FEEDBACK_DEFAULT = 0;
export const SPREAD_DEFAULT = 0.5;
export const MIX_DEFAULT = 0.5;

// After a live Rate change the LFO keeps its phase, then drifts back into
// step with the timeline over about this long, so playback after the edit
// matches an export again.
export const PHASE_RELOCK_SECONDS = 0.5;

// Below this many cycles the drift back counts as done.
const PHASE_LOCKED = 1e-9;

// The output falls 60 dB below its input after this many feedback passes.
const FEEDBACK_SILENCE = Math.log(0.001);

export function formatRate(hz: number) {
  return `${hz < 1 ? hz.toFixed(2) : hz.toFixed(1)} Hz`;
}

export function formatDelayMs(ms: number) {
  return `${ms.toFixed(1)} ms`;
}

// The modulation's swing either side of the base delay, in seconds:
// Depth 100 % swings by half the delay.
export function chorusSwingSeconds(delayMs: number, depth: number) {
  return (delayMs / 1000 / 2) * depth;
}

// How long the chorus keeps sounding once its input falls silent: one pass
// through the longest delay, plus every feedback pass until it decays by
// 60 dB.
export function chorusTailSeconds(
  delayMs: number,
  depth: number,
  feedback: number,
) {
  const longest = delayMs / 1000 + chorusSwingSeconds(delayMs, depth);
  const passes =
    feedback > 0 ? Math.ceil(FEEDBACK_SILENCE / Math.log(feedback)) : 0;
  return longest * (1 + passes);
}

// The LFO's phase in cycles for `channel` at timeline second `seconds`:
// channel 1 (the right) leads by Spread × half a cycle.
export function chorusPhase(
  seconds: number,
  rate: number,
  spread: number,
  channel: number,
) {
  return seconds * rate + (channel % 2) * spread * 0.5;
}

// `cycles` less its nearest whole number of cycles, in -0.5..0.5.
function wrapCycles(cycles: number) {
  return cycles - Math.round(cycles);
}

export type ChorusBlock = {
  frames: number;
  sampleRate: number;
  // The timeline second of the block's first frame.
  timeSeconds: number;
  // Each parameter's value at every frame.
  rate: Float32Array;
  depth: Float32Array;
  delayMs: Float32Array;
  feedback: Float32Array;
  spread: Float32Array;
  mix: Float32Array;
};

export class ChorusDsp {
  readonly channels: number;
  private readonly lines: Float32Array[];
  private readonly mask: number;
  private write = 0;
  // Cycles added to the timeline phase to keep it continuous across a live
  // Rate change; it decays back to 0 over PHASE_RELOCK_SECONDS.
  private phaseOffset = 0;
  private lastRate: number | null = null;

  constructor(sampleRate: number, channels: number) {
    this.channels = channels;
    // The longest delay plus its widest swing, and a frame either side for
    // the interpolation.
    const longest = DELAY_MAX_MS / 1000 + chorusSwingSeconds(DELAY_MAX_MS, 1);
    let size = 1;
    while (size < Math.ceil(longest * sampleRate) + 4) {
      size *= 2;
    }
    this.mask = size - 1;
    this.lines = Array.from({ length: channels }, () => new Float32Array(size));
  }

  process(
    input: readonly Float32Array[],
    output: Float32Array[],
    block: ChorusBlock,
  ) {
    const { frames, sampleRate, timeSeconds } = block;
    const relock = Math.exp(-1 / (PHASE_RELOCK_SECONDS * sampleRate));
    const lines = this.lines;
    const mask = this.mask;
    let write = this.write;
    for (let index = 0; index < frames; index++) {
      const seconds = timeSeconds + index / sampleRate;
      const rate = block.rate[index];
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

      const delaySeconds = block.delayMs[index] / 1000;
      const swing = chorusSwingSeconds(
        block.delayMs[index],
        block.depth[index],
      );
      const feedback = block.feedback[index];
      const mix = block.mix[index];
      for (let channel = 0; channel < this.channels; channel++) {
        const line = lines[channel];
        const phase =
          chorusPhase(seconds, rate, block.spread[index], channel) +
          this.phaseOffset;
        const delay =
          (delaySeconds + swing * Math.sin(2 * Math.PI * phase)) * sampleRate;
        // Linear interpolation between the two frames around the delay.
        const whole = Math.floor(delay);
        const fraction = delay - whole;
        const newer = line[(write - whole) & mask];
        const older = line[(write - whole - 1) & mask];
        const wet = newer + (older - newer) * fraction;

        const dry = input[channel][index];
        line[write] = dry + wet * feedback;
        output[channel][index] = dry * (1 - mix) + wet * mix;
      }
      write = (write + 1) & mask;
    }
    this.write = write;
  }
}
