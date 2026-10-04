// Saturation as a chain stage. Per frame it boosts the input by Drive,
// upsamples it 4×, shapes it with the Type's curve, low-passes it at Tone,
// decimates it back and scales it by Output, then mixes it with the dry
// input. The oversampling filters are linear-phase, so the stage reports
// their delay as latency and delays its dry signal to match; Mix then
// blends two aligned signals. Drive, Tone, Output and Mix follow the host's
// ramps frame by frame, so edits don't click; a Type change crossfades
// between two processors.
import type {
  AudioEffectDsp,
  AudioParameterBlock,
} from "../../../audio-mix/processor.ts";
import {
  DEFAULT_SATURATION_TYPE,
  DRIVE_KEY,
  dbToAmplitude,
  MIX_KEY,
  OUTPUT_KEY,
  SATURATION_EFFECT_NAME,
  SATURATION_RANGES,
  type SaturationNumberKey,
  type SaturationType,
  saturationType,
  shapeHard,
  shapeSoft,
  shapeTape,
  shapeTube,
  TONE_KEY,
  TYPE_KEY,
} from "./saturation.ts";

export const OVERSAMPLING = 4;
// Taps of the anti-imaging and anti-aliasing filter, at the oversampled
// rate. Upsampling and decimation each delay by half of it less one.
const TAPS = 97;
// Frames the stage's output lags its input, at the host's rate.
export const SATURATION_LATENCY_FRAMES = (TAPS - 1) / OVERSAMPLING;
// The filter's cutoff as a fraction of the host's Nyquist frequency: it
// passes the audible band and stops what would fold back into it.
const CUTOFF = 0.9;
// The Kaiser window's shape, for about 70 dB of stopband attenuation.
const KAISER_BETA = 7;
// Tape's curve follows its input this much of an oversampled frame late, so
// a rising wave takes a lower path than a falling one: a mild hysteresis.
const TAPE_HYSTERESIS = 0.3;
// The asymmetric curves add DC, which a high-pass this low removes.
const DC_BLOCK_HZ = 5;

// Zeroth-order modified Bessel function of the first kind, for the window.
function besselI0(x: number) {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 32; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
  }
  return sum;
}

// A Kaiser-windowed sinc low-pass at the oversampled rate, summing to 1.
function designFilter() {
  const kernel = new Float64Array(TAPS);
  const middle = (TAPS - 1) / 2;
  const cutoff = (0.5 * CUTOFF) / OVERSAMPLING;
  let sum = 0;
  for (let n = 0; n < TAPS; n++) {
    const t = n - middle;
    const sinc =
      t === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * t) / (Math.PI * t);
    const ratio = t / middle;
    const window =
      besselI0(KAISER_BETA * Math.sqrt(1 - ratio * ratio)) /
      besselI0(KAISER_BETA);
    kernel[n] = sinc * window;
    sum += kernel[n];
  }
  for (let n = 0; n < TAPS; n++) {
    kernel[n] /= sum;
  }
  return kernel;
}

const KERNEL = designFilter();
// The kernel split into one phase per oversampled frame, each scaled by
// the oversampling factor to make up for the zeros upsampling inserts.
const PHASE_TAPS = Math.ceil(TAPS / OVERSAMPLING);
const PHASES = Array.from({ length: OVERSAMPLING }, (_, phase) => {
  const taps = new Float64Array(PHASE_TAPS);
  for (let index = 0; index < PHASE_TAPS; index++) {
    const tap = phase + index * OVERSAMPLING;
    taps[index] = tap < TAPS ? KERNEL[tap] * OVERSAMPLING : 0;
  }
  return taps;
});

const SHAPES: Readonly<Record<SaturationType, (x: number) => number>> = {
  Soft: shapeSoft,
  Hard: shapeHard,
  Tape: shapeTape,
  Tube: shapeTube,
};

// A parameter's value clamped to its range. The host reads an unset one as
// 0, which only Drive, Output and Mix may be, so a Tone of 0 is its default.
function inRange(key: SaturationNumberKey, value: number) {
  const range = SATURATION_RANGES[key];
  if (!Number.isFinite(value) || (value <= 0 && range.min > 0)) {
    return range.defaultValue;
  }
  return Math.min(range.max, Math.max(range.min, value));
}

// A parameter as a per-frame reader: the ramp while it moves, else its
// settled value, converted once. A dB parameter reads as an amplitude.
// Each processor keeps one per parameter and updates it every block, so
// reading allocates nothing.
class ParameterReader {
  private ramp: Float32Array | null = null;
  private settled = 0;
  private readonly key: SaturationNumberKey;
  private readonly decibels: boolean;

  constructor(key: SaturationNumberKey, decibels = false) {
    this.key = key;
    this.decibels = decibels;
  }

  update(params: AudioParameterBlock) {
    if (params.changing(this.key)) {
      this.ramp = params.number(this.key);
      return;
    }
    this.ramp = null;
    const value = inRange(this.key, params.value(this.key));
    this.settled = this.decibels ? dbToAmplitude(value) : value;
  }

  at(index: number) {
    if (!this.ramp) {
      return this.settled;
    }
    const value = inRange(this.key, this.ramp[index]);
    return this.decibels ? dbToAmplitude(value) : value;
  }

  reset() {
    this.ramp = null;
    this.settled = 0;
  }
}

// One channel's filter histories and curve state.
class SaturationChannel {
  // Recent driven input frames, written twice so a phase reads them
  // contiguously from `upAt`.
  private readonly up = new Float64Array(2 * PHASE_TAPS);
  private upAt = 0;
  // Recent oversampled frames, likewise.
  private readonly down = new Float64Array(2 * TAPS);
  private downAt = 0;
  private readonly dry = new Float32Array(SATURATION_LATENCY_FRAMES);
  private dryAt = 0;
  private tapeLast = 0;
  // The Tone filter's two integrators.
  private low1 = 0;
  private low2 = 0;
  private dcIn = 0;
  private dcOut = 0;

  // Fills the histories as if the input had held at `sample` (driven to
  // `driven`), so a fresh processor, such as the one a Type change fades
  // to, starts from the signal rather than stepping up from silence.
  prime(sample: number, driven: number, shape: SaturationType) {
    const shaped = SHAPES[shape](driven);
    this.up.fill(driven);
    this.down.fill(shaped);
    this.dry.fill(sample);
    this.tapeLast = driven;
    this.low1 = 0;
    this.low2 = shaped;
    this.dcIn = shaped;
    this.dcOut = 0;
  }

  // Back to its constructed state: silent histories.
  reset() {
    this.up.fill(0);
    this.upAt = 0;
    this.down.fill(0);
    this.downAt = 0;
    this.dry.fill(0);
    this.dryAt = 0;
    this.tapeLast = 0;
    this.low1 = 0;
    this.low2 = 0;
    this.dcIn = 0;
    this.dcOut = 0;
  }

  // The input SATURATION_LATENCY_FRAMES frames ago, as `sample` goes in.
  delayDry(sample: number) {
    const delayed = this.dry[this.dryAt];
    this.dry[this.dryAt] = sample;
    this.dryAt = (this.dryAt + 1) % this.dry.length;
    return delayed;
  }

  // The shaped and filtered signal for one driven input frame, at the
  // host's rate.
  process(driven: number, shape: SaturationType, tone: ToneFilter) {
    this.upAt = (this.upAt + PHASE_TAPS - 1) % PHASE_TAPS;
    this.up[this.upAt] = driven;
    this.up[this.upAt + PHASE_TAPS] = driven;
    const curve = SHAPES[shape];
    let decimated = 0;
    for (let phase = 0; phase < OVERSAMPLING; phase++) {
      const taps = PHASES[phase];
      let sample = 0;
      for (let index = 0; index < PHASE_TAPS; index++) {
        sample += taps[index] * this.up[this.upAt + index];
      }
      if (shape === "Tape") {
        const lagged = sample - TAPE_HYSTERESIS * (sample - this.tapeLast);
        this.tapeLast = sample;
        sample = lagged;
      }
      sample = this.lowPass(curve(sample), tone);
      this.downAt = (this.downAt + TAPS - 1) % TAPS;
      this.down[this.downAt] = sample;
      this.down[this.downAt + TAPS] = sample;
      // Decimates on the frame's first oversampled frame, so the stage's
      // delay is a whole number of the host's frames.
      if (phase === 0) {
        for (let index = 0; index < TAPS; index++) {
          decimated += KERNEL[index] * this.down[this.downAt + index];
        }
      }
    }
    if (shape === "Tape" || shape === "Tube") {
      const blocked = decimated - this.dcIn + tone.dcPole * this.dcOut;
      this.dcIn = decimated;
      this.dcOut = blocked;
      return blocked;
    }
    return decimated;
  }

  // A two-pole Butterworth low-pass, as a trapezoidal state-variable
  // filter, which stays smooth while its cutoff moves.
  private lowPass(sample: number, tone: ToneFilter) {
    const v3 = sample - this.low2;
    const v1 = tone.a1 * this.low1 + tone.a2 * v3;
    const v2 = this.low2 + tone.a2 * this.low1 + tone.a3 * v3;
    this.low1 = 2 * v1 - this.low1;
    this.low2 = 2 * v2 - this.low2;
    return v2;
  }
}

// The Tone filter's coefficients, at the oversampled rate.
class ToneFilter {
  a1 = 0;
  a2 = 0;
  a3 = 0;
  readonly dcPole: number;
  private hz = Number.NaN;
  private readonly oversampledRate: number;

  constructor(sampleRate: number) {
    this.oversampledRate = sampleRate * OVERSAMPLING;
    this.dcPole = 1 - (2 * Math.PI * DC_BLOCK_HZ) / sampleRate;
  }

  // Back to its constructed state, so the next set() recomputes.
  reset() {
    this.a1 = 0;
    this.a2 = 0;
    this.a3 = 0;
    this.hz = Number.NaN;
  }

  set(hz: number) {
    if (hz === this.hz) {
      return;
    }
    this.hz = hz;
    const g = Math.tan(
      (Math.PI * Math.min(hz, 0.45 * this.oversampledRate)) /
        this.oversampledRate,
    );
    const k = Math.SQRT2;
    this.a1 = 1 / (1 + g * (g + k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
}

export const processor: AudioEffectDsp = {
  effectName: SATURATION_EFFECT_NAME,
  createProcessor(sampleRate, channels) {
    const states = Array.from(
      { length: channels },
      () => new SaturationChannel(),
    );
    const tone = new ToneFilter(sampleRate);
    const drive = new ParameterReader(DRIVE_KEY, true);
    const toneHz = new ParameterReader(TONE_KEY);
    const level = new ParameterReader(OUTPUT_KEY, true);
    const mix = new ParameterReader(MIX_KEY);
    // saturationType trims and lowercases, so it runs only when Type
    // changes.
    let typeValue: string | null = null;
    let shape: SaturationType = DEFAULT_SATURATION_TYPE;
    let primed = false;
    return {
      process(input, output, frames, params) {
        const typeSwitch = params.switch(TYPE_KEY);
        if (typeSwitch !== typeValue) {
          typeValue = typeSwitch;
          shape = saturationType(typeSwitch);
        }
        drive.update(params);
        toneHz.update(params);
        level.update(params);
        mix.update(params);
        if (!primed && frames > 0) {
          primed = true;
          for (let channel = 0; channel < output.length; channel++) {
            const sample = input[channel][0];
            states[channel].prime(sample, sample * drive.at(0), shape);
          }
        }
        for (let index = 0; index < frames; index++) {
          tone.set(toneHz.at(index));
          const gain = drive.at(index);
          const makeup = level.at(index);
          const wetShare = mix.at(index);
          for (let channel = 0; channel < output.length; channel++) {
            const state = states[channel];
            const sample = input[channel][index];
            const dry = state.delayDry(sample);
            const wet = state.process(sample * gain, shape, tone) * makeup;
            output[channel][index] = wet * wetShare + dry * (1 - wetShare);
          }
        }
      },
      reset() {
        for (let channel = 0; channel < states.length; channel++) {
          states[channel].reset();
        }
        tone.reset();
        drive.reset();
        toneHz.reset();
        level.reset();
        mix.reset();
        typeValue = null;
        shape = DEFAULT_SATURATION_TYPE;
        primed = false;
      },
    };
  },
  latencyFrames: () => SATURATION_LATENCY_FRAMES,
};
