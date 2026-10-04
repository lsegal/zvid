// The Bitcrush effect's parameters, readouts and DSP: a sample-and-hold
// that keeps one input frame every Downsample frames, then a quantizer to
// 2^Bits levels spanning full scale, mixed with the dry input. The same
// code runs per frame in the preview's chain worklet and in export.

export const BITCRUSH_EFFECT_NAME = "Bitcrush";

export const BITS_KEY = "Bits";
export const DOWNSAMPLE_KEY = "Downsample";
export const MIX_KEY = "Mix";

export const BITCRUSH_RANGES = {
  [BITS_KEY]: { min: 1, max: 16, defaultValue: 8 },
  // The hold, in frames.
  [DOWNSAMPLE_KEY]: { min: 1, max: 64, defaultValue: 1 },
  [MIX_KEY]: { min: 0, max: 1, defaultValue: 1 },
} as const;

export type BitcrushNumberKey = keyof typeof BITCRUSH_RANGES;

// "1 bit", "8 bits".
export function formatBits(bits: number) {
  const rounded = Math.round(bits);
  return `${rounded} ${rounded === 1 ? "bit" : "bits"}`;
}

// "1×", "64×".
export function formatDownsample(factor: number) {
  return `${Math.round(factor)}×`;
}

// `sample` quantized to 2^bits levels, for a whole number of bits. The
// levels sit evenly from −1 to +1, so 1 bit leaves only ±1; there is no
// level at 0, so a signal rounds to the nearest level on its own side and
// exact silence stays silent instead of becoming a DC offset.
export function quantizeWhole(sample: number, bits: number) {
  const levels = 2 ** bits;
  return quantizeToLevels(sample, levels, (levels - 1) / 2);
}

// quantizeWhole with 2^bits and its half span worked out, so a processor
// can reuse them while Bits holds.
function quantizeToLevels(sample: number, levels: number, halfSpan: number) {
  if (sample === 0) {
    return 0;
  }
  // The levels on each side sit at (k + ½) / halfSpan for k from 0 to
  // levels / 2 − 1; the magnitude is quantized so both sides round alike.
  const index = Math.min(
    levels / 2 - 1,
    Math.floor(Math.abs(sample) * halfSpan),
  );
  const magnitude = (index + 0.5) / halfSpan;
  return sample < 0 ? -magnitude : magnitude;
}

// `sample` quantized to 2^bits levels. While Bits ramps between whole
// values, it blends the two neighboring depths, so the output moves
// smoothly instead of jumping from one set of levels to the next.
export function quantize(sample: number, bits: number) {
  const lower = Math.floor(bits);
  const fraction = bits - lower;
  const coarse = quantizeWhole(sample, lower);
  if (fraction === 0) {
    return coarse;
  }
  return coarse + (quantizeWhole(sample, lower + 1) - coarse) * fraction;
}

// A number parameter's value at frame `index` of the block.
export type FrameReader = { at(index: number): number };

export type BitcrushBlock = {
  frames: number;
  // The timeline frame of the block's first frame.
  startFrame: number;
  // Each number parameter's value at every frame.
  bits: FrameReader;
  downsample: FrameReader;
  mix: FrameReader;
};

export class BitcrushDsp {
  // One held sample per channel.
  private readonly held: Float64Array;
  // The Downsample-sized stretch of the timeline the held samples were
  // taken in. The stretches count from the timeline's start, so preview and
  // export hold the same frames wherever they start playing.
  private stretch = Number.NaN;
  // The quantizer's levels for the last Bits seen, worked out only when it
  // changes: 2^bits is a power per sample otherwise.
  private bits = Number.NaN;
  private fraction = 0;
  private lowerLevels = 0;
  private lowerHalfSpan = 0;
  private upperLevels = 0;
  private upperHalfSpan = 0;

  constructor(channels: number) {
    this.held = new Float64Array(channels);
  }

  // Back to its constructed state.
  reset() {
    this.held.fill(0);
    this.stretch = Number.NaN;
    this.bits = Number.NaN;
    this.fraction = 0;
    this.lowerLevels = 0;
    this.lowerHalfSpan = 0;
    this.upperLevels = 0;
    this.upperHalfSpan = 0;
  }

  process(
    input: readonly Float32Array[],
    output: Float32Array[],
    block: BitcrushBlock,
  ) {
    for (let index = 0; index < block.frames; index++) {
      // Every channel holds on the same frames, so the stereo image holds.
      const stretch = Math.floor(
        (block.startFrame + index) / block.downsample.at(index),
      );
      if (stretch !== this.stretch) {
        this.stretch = stretch;
        for (let channel = 0; channel < output.length; channel++) {
          this.held[channel] = input[channel][index];
        }
      }
      this.setBits(block.bits.at(index));
      const wetShare = block.mix.at(index);
      for (let channel = 0; channel < output.length; channel++) {
        const dry = input[channel][index];
        const wet = this.quantize(this.held[channel]);
        output[channel][index] = wet * wetShare + dry * (1 - wetShare);
      }
    }
  }

  private setBits(bits: number) {
    if (bits === this.bits) {
      return;
    }
    this.bits = bits;
    const lower = Math.floor(bits);
    this.fraction = bits - lower;
    this.lowerLevels = 2 ** lower;
    this.lowerHalfSpan = (this.lowerLevels - 1) / 2;
    this.upperLevels = 2 ** (lower + 1);
    this.upperHalfSpan = (this.upperLevels - 1) / 2;
  }

  // quantize() at the current Bits.
  private quantize(sample: number) {
    const coarse = quantizeToLevels(
      sample,
      this.lowerLevels,
      this.lowerHalfSpan,
    );
    if (this.fraction === 0) {
      return coarse;
    }
    const fine = quantizeToLevels(sample, this.upperLevels, this.upperHalfSpan);
    return coarse + (fine - coarse) * this.fraction;
  }
}
