// EQ as a chain stage. The host ramps each band's frequency, gain and Q
// after an edit; while any of them moves, the coefficients follow the ramp
// every EQ_COEFFICIENT_FRAMES frames, so a sweep has no zipper noise.
import type {
  AudioEffectDsp,
  AudioParameterBlock,
} from "../../../audio-mix/processor.ts";
import {
  EQ_EFFECT_NAME,
  EQ_RANGES,
  EqFilter,
  type EqParameterKey,
  type EqSettings,
  HIGH_FREQ_KEY,
  HIGH_GAIN_KEY,
  LOW_FREQ_KEY,
  LOW_GAIN_KEY,
  MID_FREQ_KEY,
  MID_GAIN_KEY,
  MID_Q_KEY,
} from "./eq.ts";

export const EQ_COEFFICIENT_FRAMES = 16;

const KEYS: Readonly<Record<keyof EqSettings, EqParameterKey>> = {
  lowFreq: LOW_FREQ_KEY,
  lowGain: LOW_GAIN_KEY,
  midFreq: MID_FREQ_KEY,
  midGain: MID_GAIN_KEY,
  midQ: MID_Q_KEY,
  highFreq: HIGH_FREQ_KEY,
  highGain: HIGH_GAIN_KEY,
};

const ENTRIES = Object.entries(KEYS) as [keyof EqSettings, EqParameterKey][];

// A parameter's value clamped to its range. The host reads an unset one as
// 0, which only the gains may be, so a frequency or Q of 0 is its default.
function inRange(key: EqParameterKey, value: number) {
  const range = EQ_RANGES[key];
  if (!Number.isFinite(value) || (value <= 0 && range.min > 0)) {
    return range.defaultValue;
  }
  return Math.min(range.max, Math.max(range.min, value));
}

// The settings at frame `index` of the block, or settled when undefined.
function readSettings(params: AudioParameterBlock, index?: number) {
  const settings = {} as EqSettings;
  for (const [field, key] of ENTRIES) {
    const value =
      index === undefined ? params.value(key) : params.number(key)[index];
    settings[field] = inRange(key, value);
  }
  return settings;
}

export const processor: AudioEffectDsp = {
  effectName: EQ_EFFECT_NAME,
  createProcessor(sampleRate, channels) {
    const filter = new EqFilter(sampleRate, channels);
    return {
      process(input, output, frames, params) {
        if (!ENTRIES.some(([, key]) => params.changing(key))) {
          filter.setSettings(readSettings(params));
          filter.process(input, output, 0, frames);
          return;
        }
        for (let start = 0; start < frames; start += EQ_COEFFICIENT_FRAMES) {
          filter.setSettings(readSettings(params, start));
          const end = Math.min(frames, start + EQ_COEFFICIENT_FRAMES);
          filter.process(input, output, start, end);
        }
      },
    };
  },
};
