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

// How long a Pre-delay or Size change crossfades from the old delays to the
// new ones. Sweeping a delay instead would bend the pitch of everything
// still ringing.
export const SHAPE_FADE_SECONDS = 0.05;

// The network's delay lengths at Size 0 % and 100 %, as a scale of the base
// lengths below: a small room to a large hall.
const SCALE_MIN = 0.25;
const SCALE_MAX = 1.5;

// The FDN lines' lengths at scale 1, in milliseconds. Mutually prime-ish
// lengths keep their echoes from piling up on the same frames.
const LINE_MS = [29.7, 37.1, 41.1, 43.7, 50.3, 53.9, 59.3, 63.7];
const LINES = LINE_MS.length;

// The early reflections at scale 1, after the pre-delay: their delays in
// milliseconds and their gains, one set per side so the reflections arrive
// differently in each ear.
const REFLECTION_MS = [
  [0, 4.3, 11.7, 19.1, 27.9, 36.7, 48.3],
  [0, 5.9, 13.1, 21.7, 30.1, 41.3, 52.9],
];
const REFLECTION_GAINS = [
  [0.5, 0.45, 0.4, 0.33, 0.27, 0.2, 0.14],
  [0.5, 0.45, 0.38, 0.32, 0.26, 0.19, 0.13],
];
const LONGEST_REFLECTION_MS = Math.max(...REFLECTION_MS.flat());

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
  // Decay, Damping and Mix at every frame, as the chain ramps them.
  decay: Float32Array;
  damping: Float32Array;
  mix: Float32Array;
  // Pre-delay and Size as stored: they move the network's delays, which
  // the reverb crossfades rather than sweeps.
  preDelayMs: number;
  size: number;
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
  private readonly frames: number;

  constructor(frames: number) {
    this.frames = frames;
    this.line = new DelayLine(frames);
  }

  process(input: number) {
    const delayed = this.line.read(this.frames);
    const inner = input + DIFFUSION * delayed;
    this.line.push(inner);
    return delayed - DIFFUSION * inner;
  }
}

// The delays one Pre-delay and Size setting makes.
class Shape {
  readonly preDelayMs: number;
  readonly size: number;
  // The pre-delay in frames, read after that frame's push.
  readonly preDelay: number;
  // Each early reflection's delay per side, in frames, pre-delay included.
  readonly reflections: Float64Array[];
  // Each FDN line's length in whole frames: interpolating inside the loop
  // would low-pass every pass and shorten the decay.
  readonly lengths = new Float64Array(LINES);
  // Each line's gain per pass for the latest Decay.
  readonly gains = new Float64Array(LINES);
  private decay = Number.NaN;

  constructor(preDelayMs: number, size: number, sampleRate: number) {
    this.preDelayMs = preDelayMs;
    this.size = size;
    const scale = sizeScale(size);
    // The newest sample sits one frame back after the push.
    this.preDelay = 1 + (preDelayMs / 1000) * sampleRate;
    this.reflections = REFLECTION_MS.map((side) =>
      Float64Array.from(
        side,
        (ms) => this.preDelay + (ms / 1000) * scale * sampleRate,
      ),
    );
    for (let line = 0; line < LINES; line++) {
      this.lengths[line] = Math.max(
        1,
        Math.round((LINE_MS[line] / 1000) * scale * sampleRate),
      );
    }
  }

  updateGains(decay: number, sampleRate: number) {
    if (decay !== this.decay) {
      for (let line = 0; line < LINES; line++) {
        this.gains[line] = lineGain(this.lengths[line] / sampleRate, decay);
      }
      this.decay = decay;
    }
  }
}

function reflectionSum(line: DelayLine, delays: Float64Array, side: number) {
  const gains = REFLECTION_GAINS[side];
  let sum = 0;
  for (let tap = 0; tap < delays.length; tap++) {
    sum += gains[tap] * line.read(delays[tap]);
  }
  return sum;
}

export class ReverbDsp {
  readonly channels: number;
  private readonly sampleRate: number;
  // Per side: the pre-delay line, which the reflections also read.
  private readonly preDelays: DelayLine[];
  private readonly diffusers: Allpass[][];
  private readonly lines: DelayLine[];
  // Each FDN line's damping filter state, which is also its output.
  private readonly damped = new Float64Array(LINES);
  private lastDamping = Number.NaN;
  private dampingCoefficient = 0;
  // The delays in use and, while fading to it, the next; a change that
  // arrives mid-fade waits in `pending`.
  private shape: Shape | null = null;
  private next: Shape | null = null;
  private pending: Shape | null = null;
  private fade = 0;
  private readonly wet = [0, 0];
  private readonly diffused = [0, 0];

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

  private retarget(preDelayMs: number, size: number) {
    const latest = this.pending ?? this.next ?? this.shape;
    if (latest?.preDelayMs === preDelayMs && latest.size === size) {
      return;
    }
    const shape = new Shape(preDelayMs, size, this.sampleRate);
    if (this.shape) {
      this.pending = shape;
    } else {
      this.shape = shape;
    }
  }

  process(
    input: readonly Float32Array[],
    output: Float32Array[],
    block: ReverbBlock,
  ) {
    const { frames, sampleRate } = block;
    this.retarget(block.preDelayMs, block.size);
    const channels = this.channels;
    const right = channels > 1 ? 1 : 0;
    const lines = this.lines;
    const damped = this.damped;
    const wet = this.wet;
    const diffused = this.diffused;
    const fadeStep = 1 / (SHAPE_FADE_SECONDS * sampleRate);
    for (let index = 0; index < frames; index++) {
      if (!this.next && this.pending) {
        this.next = this.pending;
        this.pending = null;
        this.fade = 0;
      }
      const from = this.shape as Shape;
      const to = this.next;
      // The share of `to` this frame.
      const fade = this.fade;
      const decay = block.decay[index];
      from.updateGains(decay, sampleRate);
      to?.updateGains(decay, sampleRate);
      const damping = block.damping[index];
      if (damping !== this.lastDamping) {
        this.dampingCoefficient = Math.exp(
          (-2 * Math.PI * damping) / sampleRate,
        );
        this.lastDamping = damping;
      }

      for (let side = 0; side < 2; side++) {
        const line = this.preDelays[side];
        line.push(input[side === 0 ? 0 : right][index]);
        let reflections = reflectionSum(line, from.reflections[side], side);
        let delayed = line.read(from.preDelay);
        if (to) {
          const next = reflectionSum(line, to.reflections[side], side);
          reflections += (next - reflections) * fade;
          delayed += (line.read(to.preDelay) - delayed) * fade;
        }
        wet[side] = reflections * REFLECTION_LEVEL;
        for (const diffuser of this.diffusers[side]) {
          delayed = diffuser.process(delayed);
        }
        diffused[side] = delayed;
      }

      // Each line's output, scaled for the decay and damped.
      const coefficient = this.dampingCoefficient;
      let sum = 0;
      for (let line = 0; line < LINES; line++) {
        let delayed = lines[line].read(from.lengths[line]) * from.gains[line];
        if (to) {
          const next = lines[line].read(to.lengths[line]) * to.gains[line];
          delayed += (next - delayed) * fade;
        }
        damped[line] = delayed + coefficient * (damped[line] - delayed);
        sum += damped[line];
      }
      // Householder feedback, with the left side feeding the even lines and
      // the right the odd ones; the same split taps the output.
      const reflect = (2 / LINES) * sum;
      let lateLeft = 0;
      let lateRight = 0;
      for (let line = 0; line < LINES; line++) {
        lines[line].push(damped[line] - reflect + diffused[line & 1]);
        const sign = line & 2 ? -1 : 1;
        if (line & 1) {
          lateRight += sign * damped[line];
        } else {
          lateLeft += sign * damped[line];
        }
      }
      wet[0] += lateLeft * LATE_LEVEL;
      wet[1] += lateRight * LATE_LEVEL;

      if (to) {
        this.fade += fadeStep;
        if (this.fade >= 1) {
          this.shape = to;
          this.next = null;
          this.fade = 0;
        }
      }

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
