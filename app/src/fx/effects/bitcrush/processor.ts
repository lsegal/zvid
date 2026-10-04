// Bitcrush as a chain stage. Its knobs are numbers the chain ramps, so the
// processor reads each one per frame and a change is click-free.
import type {
  AudioEffectDsp,
  AudioParameterBlock,
} from "../../../audio-mix/processor.ts";
import {
  BITCRUSH_EFFECT_NAME,
  BITCRUSH_RANGES,
  BITS_KEY,
  type BitcrushBlock,
  BitcrushDsp,
  type BitcrushNumberKey,
  DOWNSAMPLE_KEY,
  MIX_KEY,
} from "./bitcrush.ts";

// A parameter's value clamped to its range. The host reads an unset one as
// 0, which only Mix may be, so a Bits or Downsample of 0 is its default.
function inRange(key: BitcrushNumberKey, value: number) {
  const range = BITCRUSH_RANGES[key];
  if (!Number.isFinite(value) || (value <= 0 && range.min > 0)) {
    return range.defaultValue;
  }
  return Math.min(range.max, Math.max(range.min, value));
}

// A parameter as a per-frame reader: the ramp while it moves, else its
// settled value. Each processor keeps one per parameter and updates it
// every block, so reading allocates nothing.
class ParameterReader {
  private ramp: Float32Array | null = null;
  private settled = 0;
  private readonly key: BitcrushNumberKey;

  constructor(key: BitcrushNumberKey) {
    this.key = key;
  }

  update(params: AudioParameterBlock) {
    this.ramp = params.changing(this.key) ? params.number(this.key) : null;
    this.settled = inRange(this.key, params.value(this.key));
  }

  at(index: number) {
    return this.ramp ? inRange(this.key, this.ramp[index]) : this.settled;
  }

  reset() {
    this.ramp = null;
    this.settled = 0;
  }
}

export const processor: AudioEffectDsp = {
  effectName: BITCRUSH_EFFECT_NAME,
  createProcessor(_sampleRate, channels) {
    const dsp = new BitcrushDsp(channels);
    const bits = new ParameterReader(BITS_KEY);
    const downsample = new ParameterReader(DOWNSAMPLE_KEY);
    const mix = new ParameterReader(MIX_KEY);
    // One block description, rewritten every block.
    const block: BitcrushBlock = {
      frames: 0,
      startFrame: 0,
      bits,
      downsample,
      mix,
    };
    return {
      process(input, output, frames, params, time) {
        bits.update(params);
        downsample.update(params);
        mix.update(params);
        block.frames = frames;
        block.startFrame = Math.round(time.timeSeconds * time.sampleRate);
        dsp.process(input, output, block);
      },
      reset() {
        dsp.reset();
        bits.reset();
        downsample.reset();
        mix.reset();
      },
    };
  },
};
