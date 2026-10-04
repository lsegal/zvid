// Low Cut as a chain stage. The host ramps Frequency and Resonance after
// an edit; while either moves, the coefficients follow the ramp every
// LOW_CUT_COEFFICIENT_FRAMES frames, so a sweep has no zipper noise.
// Slope is a switch, so the host crossfades between two filters to change
// it.
import type {
  AudioEffectDsp,
  AudioParameterBlock,
} from "../../../audio-mix/processor.ts";
import {
  DEFAULT_LOW_CUT_SLOPE,
  FREQUENCY_KEY,
  LOW_CUT_EFFECT_NAME,
  LOW_CUT_RANGES,
  LowCutFilter,
  type LowCutNumberKey,
  type LowCutSettings,
  lowCutSlope,
  RESONANCE_KEY,
  SLOPE_KEY,
} from "./low-cut.ts";

export const LOW_CUT_COEFFICIENT_FRAMES = 16;

// A parameter's value clamped to its range. The host reads an unset one as
// 0, which neither may be, so 0 is its default.
function inRange(key: LowCutNumberKey, value: number) {
  const range = LOW_CUT_RANGES[key];
  if (!Number.isFinite(value) || value <= 0) {
    return range.defaultValue;
  }
  return Math.min(range.max, Math.max(range.min, value));
}

// Reads Frequency and Resonance at frame `index` of the block, or settled
// when -1, into `settings`, which each processor reuses.
function readSettings(
  params: AudioParameterBlock,
  index: number,
  settings: LowCutSettings,
) {
  settings.frequency = inRange(
    FREQUENCY_KEY,
    index < 0
      ? params.value(FREQUENCY_KEY)
      : params.number(FREQUENCY_KEY)[index],
  );
  settings.resonance = inRange(
    RESONANCE_KEY,
    index < 0
      ? params.value(RESONANCE_KEY)
      : params.number(RESONANCE_KEY)[index],
  );
}

export const processor: AudioEffectDsp = {
  effectName: LOW_CUT_EFFECT_NAME,
  createProcessor(sampleRate, channels) {
    const filter = new LowCutFilter(sampleRate, channels);
    const settings: LowCutSettings = {
      frequency: 0,
      resonance: 0,
      slope: DEFAULT_LOW_CUT_SLOPE,
    };
    // lowCutSlope trims and lowercases, so it runs only when Slope changes.
    let slopeValue: string | null = null;
    return {
      process(input, output, frames, params) {
        const slope = params.switch(SLOPE_KEY);
        if (slope !== slopeValue) {
          slopeValue = slope;
          settings.slope = lowCutSlope(slope);
        }
        if (
          !params.changing(FREQUENCY_KEY) &&
          !params.changing(RESONANCE_KEY)
        ) {
          readSettings(params, -1, settings);
          filter.setSettings(settings);
          filter.process(input, output, 0, frames);
          return;
        }
        for (
          let start = 0;
          start < frames;
          start += LOW_CUT_COEFFICIENT_FRAMES
        ) {
          readSettings(params, start, settings);
          filter.setSettings(settings);
          const end = Math.min(frames, start + LOW_CUT_COEFFICIENT_FRAMES);
          filter.process(input, output, start, end);
        }
      },
      reset() {
        filter.reset();
        slopeValue = null;
        settings.slope = DEFAULT_LOW_CUT_SLOPE;
      },
    };
  },
};
