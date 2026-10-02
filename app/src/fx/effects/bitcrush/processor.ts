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
// settled value.
function reader(params: AudioParameterBlock, key: BitcrushNumberKey) {
  if (params.changing(key)) {
    const values = params.number(key);
    return (index: number) => inRange(key, values[index]);
  }
  const value = inRange(key, params.value(key));
  return () => value;
}

export const processor: AudioEffectDsp = {
  effectName: BITCRUSH_EFFECT_NAME,
  createProcessor(_sampleRate, channels) {
    const dsp = new BitcrushDsp(channels);
    return {
      process(input, output, frames, params, time) {
        dsp.process(input, output, {
          frames,
          startFrame: Math.round(time.timeSeconds * time.sampleRate),
          bits: reader(params, BITS_KEY),
          downsample: reader(params, DOWNSAMPLE_KEY),
          mix: reader(params, MIX_KEY),
        });
      },
    };
  },
};
