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

// Parallel lists, walked by index so the audio thread makes no iterators.
const FIELDS = Object.keys(KEYS) as (keyof EqSettings)[];
const PARAMETER_KEYS = FIELDS.map((field) => KEYS[field]);

// A parameter's value clamped to its range. The host reads an unset one as
// 0, which only the gains may be, so a frequency or Q of 0 is its default.
function inRange(key: EqParameterKey, value: number) {
  const range = EQ_RANGES[key];
  if (!Number.isFinite(value) || (value <= 0 && range.min > 0)) {
    return range.defaultValue;
  }
  return Math.min(range.max, Math.max(range.min, value));
}

// Reads the settings at frame `index` of the block, or settled when -1,
// into `settings`, which each processor reuses.
function readSettings(
  params: AudioParameterBlock,
  index: number,
  settings: EqSettings,
) {
  for (let at = 0; at < FIELDS.length; at++) {
    const key = PARAMETER_KEYS[at];
    const value = index < 0 ? params.value(key) : params.number(key)[index];
    settings[FIELDS[at]] = inRange(key, value);
  }
}

function anyChanging(params: AudioParameterBlock) {
  for (let at = 0; at < PARAMETER_KEYS.length; at++) {
    if (params.changing(PARAMETER_KEYS[at])) {
      return true;
    }
  }
  return false;
}

export const processor: AudioEffectDsp = {
  effectName: EQ_EFFECT_NAME,
  createProcessor(sampleRate, channels) {
    const filter = new EqFilter(sampleRate, channels);
    const settings: EqSettings = {
      lowFreq: 0,
      lowGain: 0,
      midFreq: 0,
      midGain: 0,
      midQ: 0,
      highFreq: 0,
      highGain: 0,
    };
    return {
      process(input, output, frames, params) {
        if (!anyChanging(params)) {
          readSettings(params, -1, settings);
          filter.setSettings(settings);
          filter.process(input, output, 0, frames);
          return;
        }
        for (let start = 0; start < frames; start += EQ_COEFFICIENT_FRAMES) {
          readSettings(params, start, settings);
          filter.setSettings(settings);
          const end = Math.min(frames, start + EQ_COEFFICIENT_FRAMES);
          filter.process(input, output, start, end);
        }
      },
      reset() {
        filter.reset();
      },
    };
  },
};
