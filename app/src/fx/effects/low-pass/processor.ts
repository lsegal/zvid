// Low Pass as a chain stage. The host ramps Frequency and Resonance after
// an edit; while either moves, the coefficients follow the ramp every
// LOW_PASS_COEFFICIENT_FRAMES frames, so a sweep has no zipper noise. Slope
// is a switch, so the host crossfades between two filters to change it.
import type {
  AudioEffectDsp,
  AudioParameterBlock,
} from "../../../audio-mix/processor.ts";
import {
  FREQUENCY_KEY,
  LOW_PASS_EFFECT_NAME,
  LOW_PASS_RANGES,
  LowPassFilter,
  type LowPassNumberKey,
  type LowPassSettings,
  lowPassSlope,
  RESONANCE_KEY,
  SLOPE_KEY,
} from "./low-pass.ts";

export const LOW_PASS_COEFFICIENT_FRAMES = 16;

// A parameter's value clamped to its range. The host reads an unset one as
// 0, which neither may be, so 0 is its default.
function inRange(key: LowPassNumberKey, value: number) {
  const range = LOW_PASS_RANGES[key];
  if (!Number.isFinite(value) || value <= 0) {
    return range.defaultValue;
  }
  return Math.min(range.max, Math.max(range.min, value));
}

// The settings at frame `index` of the block, or settled when undefined.
function readSettings(
  params: AudioParameterBlock,
  index?: number,
): LowPassSettings {
  const read = (key: LowPassNumberKey) =>
    inRange(
      key,
      index === undefined ? params.value(key) : params.number(key)[index],
    );
  return {
    frequency: read(FREQUENCY_KEY),
    resonance: read(RESONANCE_KEY),
    slope: lowPassSlope(params.switch(SLOPE_KEY)),
  };
}

export const processor: AudioEffectDsp = {
  effectName: LOW_PASS_EFFECT_NAME,
  createProcessor(sampleRate, channels) {
    const filter = new LowPassFilter(sampleRate, channels);
    return {
      process(input, output, frames, params) {
        if (
          !params.changing(FREQUENCY_KEY) &&
          !params.changing(RESONANCE_KEY)
        ) {
          filter.setSettings(readSettings(params));
          filter.process(input, output, 0, frames);
          return;
        }
        for (
          let start = 0;
          start < frames;
          start += LOW_PASS_COEFFICIENT_FRAMES
        ) {
          filter.setSettings(readSettings(params, start));
          const end = Math.min(frames, start + LOW_PASS_COEFFICIENT_FRAMES);
          filter.process(input, output, start, end);
        }
      },
    };
  },
};
