// The Reverb effect: an algorithmic room/hall reverb. The input passes
// through a pre-delay, then feeds a set of early reflections and, through a
// few allpass diffusers, an 8-line feedback delay network (FDN) whose
// lossless Householder matrix recirculates it. Each line's gain sets the
// network's RT60 to Decay at every Size, and a one-pole low-pass in each
// line makes high frequencies die sooner below the Damping frequency.
// Nothing is random, so the preview and an export ring identically.

export const REVERB_EFFECT_NAME = "Reverb";

export const DECAY_KEY = "Decay";
export const PRE_DELAY_KEY = "Pre-delay";
export const SIZE_KEY = "Size";
export const DAMPING_KEY = "Damping";
export const MIX_KEY = "Mix";

// Seconds, the RT60.
export const DECAY_MIN = 0.2;
export const DECAY_MAX = 10;
export const DECAY_DEFAULT = 2;
// Milliseconds.
export const PRE_DELAY_MAX_MS = 200;
export const PRE_DELAY_DEFAULT_MS = 20;
// Hz.
export const DAMPING_MIN = 1000;
export const DAMPING_MAX = 20_000;
export const DAMPING_DEFAULT = 8000;
// Fractions, shown as percentages.
export const SIZE_DEFAULT = 0.5;
export const MIX_DEFAULT = 0.25;

// The network's delay lengths at Size 0 % and 100 %, as a scale of the base
// lengths below: a small room to a large hall.
const SCALE_MIN = 0.25;
const SCALE_MAX = 1.5;

// The FDN lines' lengths at scale 1, in milliseconds. Mutually prime-ish
// lengths keep their echoes from piling up on the same frames.
const LINE_MS = [29.7, 37.1, 41.1, 43.7, 50.3, 53.9, 59.3, 63.7];
const LINES = LINE_MS.length;

// The early reflections at scale 1, after the pre-delay: [ms, gain] pairs,
// one set per side so the reflections arrive differently in each ear.
const REFLECTIONS: readonly (readonly [number, number])[][] = [
  [
    [0, 0.5],
    [4.3, 0.45],
    [11.7, 0.4],
    [19.1, 0.33],
    [27.9, 0.27],
    [36.7, 0.2],
    [48.3, 0.14],
  ],
  [
    [0, 0.5],
    [5.9, 0.45],
    [13.1, 0.38],
    [21.7, 0.32],
    [30.1, 0.26],
    [41.3, 0.19],
    [52.9, 0.13],
  ],
];
const LONGEST_REFLECTION_MS = 52.9;

// The input diffusers per side: Schroeder allpasses of fixed length.
const DIFFUSER_MS = [
  [4.77, 3.59, 2.53],
  [4.97, 3.71, 2.41],
];
const DIFFUSION = 0.6;

// How loud the reflections and the late tail sound in the wet signal.
const REFLECTION_LEVEL = 0.6;
const LATE_LEVEL = 0.35;

export function formatDecay(seconds: number) {
  return `${seconds < 10 ? seconds.toFixed(2) : seconds.toFixed(1)} s`;
}

export function formatPreDelay(ms: number) {
  return `${Math.round(ms)} ms`;
}

// "1.00 kHz", "8.00 kHz", "20.0 kHz".
export function formatDamping(hz: number) {
  const khz = hz / 1000;
  return `${khz.toFixed(khz < 10 ? 2 : 1)} kHz`;
}

// The scale Size applies to every delay in the network.
export function sizeScale(size: number) {
  return SCALE_MIN + (SCALE_MAX - SCALE_MIN) * size;
}

// The gain a line `seconds` long needs per pass for the network to fall
// 60 dB in `decay` seconds.
export function lineGain(seconds: number, decay: number) {
  return 10 ** ((-3 * seconds) / decay);
}

// How long the reverb keeps sounding once its input falls silent: the
// pre-delay and the last early reflection, then Decay to fall 60 dB.
export function reverbTailSeconds(
  decay: number,
  preDelayMs: number,
  size: number,
) {
  return (
    decay + (preDelayMs + LONGEST_REFLECTION_MS * sizeScale(size)) / 1000
  );
}

export type ReverbBlock = {
  frames: number;
  sampleRate: number;
  // Each parameter's value at every frame.
  decay: Float32Array;
  preDelayMs: Float32Array;
  size: Float32Array;
  damping: Float32Array;
  mix: Float32Array;
};

// A ring buffer read at fractional delays.
class DelayLine {
  private readonly buffer: Float32Array;
  private readonly mask: number;
  private write = 0;

  constructor(frames: number) {
    let size = 1;
    while (size < frames + 4) {
      size *= 2;
    }
    this.buffer = new Float32Array(size);
    this.mask = size - 1;
  }

  // The sample written `delay` frames before the next write, linearly
  // interpolated; `delay` is at least 1.
  read(delay: number) {
    const whole = Math.floor(delay);
    const fraction = delay - whole;
    const newer = this.buffer[(this.write - whole) & this.mask];
    const older = this.buffer[(this.write - whole - 1) & this.mask];
    return newer + (older - newer) * fraction;
  }

  push(value: number) {
    this.buffer[this.write] = value;
    this.write = (this.write + 1) & this.mask;
  }
}

class Allpass {
  private readonly line: DelayLine;

  constructor(private readonly frames: number) {
    this.line = new DelayLine(frames);
  }

  process(input: number) {
    const delayed = this.line.read(this.frames);
    const inner = input + DIFFUSION * delayed;
    this.line.push(inner);
    return delayed - DIFFUSION * inner;
  }
}

export class ReverbDsp {
  readonly channels: number;
  private readonly sampleRate: number;
  // Per side: the pre-delay line, which the reflections also read.
  private readonly preDelays: DelayLine[];
  private readonly diffusers: Allpass[][];
  private readonly lines: DelayLine[];
  // Each FDN line's damping filter state.
  private readonly lowpass = new Float64Array(LINES);
  private readonly filtered = new Float64Array(LINES);
  private readonly gains = new Float64Array(LINES);
  private readonly lengths = new Float64Array(LINES);
  // The values the gains, lengths and damping coefficient were made from.
  private lastDecay = Number.NaN;
  private lastScale = Number.NaN;
  private lastDamping = Number.NaN;
  private dampingCoefficient = 0;

  constructor(sampleRate: number, channels: number) {
    this.sampleRate = sampleRate;
    this.channels = channels;
    const preDelayFrames = Math.ceil(
      ((PRE_DELAY_MAX_MS + LONGEST_REFLECTION_MS * SCALE_MAX) / 1000) *
        sampleRate,
    );
    this.preDelays = [0, 1].map(() => new DelayLine(preDelayFrames));
    this.diffusers = DIFFUSER_MS.map((side) =>
      side.map(
        (ms) => new Allpass(Math.max(1, Math.round((ms / 1000) * sampleRate))),
      ),
    );
    this.lines = LINE_MS.map(
      (ms) => new DelayLine(Math.ceil((ms / 1000) * SCALE_MAX * sampleRate)),
    );
  }

  private updateNetwork(decay: number, scale: number, damping: number) {
    if (decay !== this.lastDecay || scale !== this.lastScale) {
      for (let line = 0; line < LINES; line++) {
        const frames = Math.max(
          1,
          (LINE_MS[line] / 1000) * scale * this.sampleRate,
        );
        this.lengths[line] = frames;
        this.gains[line] = lineGain(frames / this.sampleRate, decay);
      }
      this.lastDecay = decay;
      this.lastScale = scale;
    }
    if (damping !== this.lastDamping) {
      this.dampingCoefficient = Math.exp(
        (-2 * Math.PI * damping) / this.sampleRate,
      );
      this.lastDamping = damping;
    }
  }

  process(
    input: readonly Float32Array[],
    output: Float32Array[],
    block: ReverbBlock,
  ) {
    const { frames, sampleRate } = block;
    const channels = this.channels;
    const right = channels > 1 ? 1 : 0;
    const lines = this.lines;
    const lowpass = this.lowpass;
    const gains = this.gains;
    const lengths = this.lengths;
    const filtered = this.filtered;
    const diffused = [0, 0];
    const wet = [0, 0];
    for (let index = 0; index < frames; index++) {
      const scale = sizeScale(block.size[index]);
      this.updateNetwork(block.decay[index], scale, block.damping[index]);
      const preDelay = (block.preDelayMs[index] / 1000) * sampleRate;
      for (let side = 0; side < 2; side++) {
        const line = this.preDelays[side];
        line.push(input[side === 0 ? 0 : right][index]);
        // The newest sample sits one frame back after the push.
        let reflections = 0;
        for (const [ms, gain] of REFLECTIONS[side]) {
          reflections +=
            gain * line.read(1 + preDelay + (ms / 1000) * scale * sampleRate);
        }
        wet[side] = reflections * REFLECTION_LEVEL;
        let signal = line.read(1 + preDelay);
        for (const diffuser of this.diffusers[side]) {
          signal = diffuser.process(signal);
        }
        diffused[side] = signal;
      }

      // Each line's output, scaled for the decay and damped.
      const coefficient = this.dampingCoefficient;
      let sum = 0;
      for (let line = 0; line < LINES; line++) {
        const delayed = lines[line].read(lengths[line]) * gains[line];
        lowpass[line] = delayed + coefficient * (lowpass[line] - delayed);
        filtered[line] = lowpass[line];
        sum += lowpass[line];
      }
      // Householder feedback, with the left side feeding the even lines and
      // the right the odd ones; the same split taps the output.
      const reflect = (2 / LINES) * sum;
      let lateLeft = 0;
      let lateRight = 0;
      for (let line = 0; line < LINES; line++) {
        lines[line].push(filtered[line] - reflect + diffused[line & 1]);
        const sign = line & 2 ? -1 : 1;
        if (line & 1) {
          lateRight += sign * filtered[line];
        } else {
          lateLeft += sign * filtered[line];
        }
      }
      wet[0] += lateLeft * LATE_LEVEL;
      wet[1] += lateRight * LATE_LEVEL;

      const mix = block.mix[index];
      for (let channel = 0; channel < channels; channel++) {
        const wetSample =
          channels === 1 ? (wet[0] + wet[1]) / 2 : wet[channel & 1];
        output[channel][index] =
          input[channel][index] * (1 - mix) + wetSample * mix;
      }
    }
  }
}
