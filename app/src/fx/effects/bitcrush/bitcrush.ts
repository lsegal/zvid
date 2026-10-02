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
  if (sample === 0) {
    return 0;
  }
  // The levels on each side sit at (k + ½) / halfSpan for k from 0 to
  // levels / 2 − 1; the magnitude is quantized so both sides round alike.
  const levels = 2 ** bits;
  const halfSpan = (levels - 1) / 2;
  const index = Math.min(
    levels / 2 - 1,
    Math.floor(Math.abs(sample) * halfSpan),
  );
  const magnitude = (index + 0.5) / halfSpan;
  return sample < 0 ? -magnitude : magnitude;
}

// `sample` quantized to 2^bits levels. While Bits ramps between whole
// values, it blends the two neighbouring depths, so the output moves
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

export type BitcrushBlock = {
  frames: number;
  // The timeline frame of the block's first frame.
  startFrame: number;
  // Each number parameter's value at every frame.
  bits: (index: number) => number;
  downsample: (index: number) => number;
  mix: (index: number) => number;
};

export class BitcrushDsp {
  // One held sample per channel.
  private readonly held: Float64Array;
  // The Downsample-sized stretch of the timeline the held samples were
  // taken in. The stretches count from the timeline's start, so preview and
  // export hold the same frames wherever they start playing.
  private stretch = Number.NaN;

  constructor(channels: number) {
    this.held = new Float64Array(channels);
  }

  process(
    input: readonly Float32Array[],
    output: Float32Array[],
    block: BitcrushBlock,
  ) {
    for (let index = 0; index < block.frames; index++) {
      // Every channel holds on the same frames, so the stereo image holds.
      const stretch = Math.floor(
        (block.startFrame + index) / block.downsample(index),
      );
      if (stretch !== this.stretch) {
        this.stretch = stretch;
        for (let channel = 0; channel < output.length; channel++) {
          this.held[channel] = input[channel][index];
        }
      }
      const bits = block.bits(index);
      const wetShare = block.mix(index);
      for (let channel = 0; channel < output.length; channel++) {
        const dry = input[channel][index];
        const wet = quantize(this.held[channel], bits);
        output[channel][index] = wet * wetShare + dry * (1 - wetShare);
      }
    }
  }
}
