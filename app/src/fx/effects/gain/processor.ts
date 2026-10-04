// Gain as a chain stage: scales its input by the level's amplitude. Mute
// is a switch, so the chain crossfades it; the level ramps.
import type {
  AudioEffectDsp,
  AudioStage,
  AudioStageSettings,
} from "../../../audio-mix/processor.ts";
import {
  GAIN_DEFAULT_DB,
  GAIN_EFFECT_NAME,
  GAIN_KEY,
  gainToAmplitude,
  MUTE_KEY,
} from "./gain.ts";

// The stored Mute switch's value when on.
export const MUTE_ON = "1";

// The amplitude a Gain stage with `settings` applies once settled.
export function gainStageAmplitude(settings: AudioStageSettings) {
  return gainToAmplitude(
    settings.numbers[GAIN_KEY] ?? GAIN_DEFAULT_DB,
    settings.switches[MUTE_KEY] === MUTE_ON,
  );
}

// A Gain stage at `amplitude`, for mixes built by hand (tests, the export
// smoke page): muted at 0.
export function gainStageAt(amplitude: number, id = "gain"): AudioStage {
  const mute = !(amplitude > 0);
  return {
    id,
    effectName: GAIN_EFFECT_NAME,
    enabled: true,
    numbers: {
      [GAIN_KEY]: mute ? GAIN_DEFAULT_DB : 20 * Math.log10(amplitude),
    },
    switches: { [MUTE_KEY]: mute ? MUTE_ON : "0" },
  };
}

export const processor: AudioEffectDsp = {
  effectName: GAIN_EFFECT_NAME,
  createProcessor: () => ({
    process(input, output, frames, params) {
      const mute = params.switch(MUTE_KEY) === MUTE_ON;
      if (!params.changing(GAIN_KEY)) {
        const amplitude = gainToAmplitude(params.value(GAIN_KEY), mute);
        for (let channel = 0; channel < output.length; channel++) {
          const from = input[channel];
          const to = output[channel];
          for (let index = 0; index < frames; index++) {
            to[index] = from[index] * amplitude;
          }
        }
        return;
      }
      const db = params.number(GAIN_KEY);
      for (let index = 0; index < frames; index++) {
        const amplitude = gainToAmplitude(db[index], mute);
        for (let channel = 0; channel < output.length; channel++) {
          output[channel][index] = input[channel][index] * amplitude;
        }
      }
    },
    // Stateless: nothing carries from one block to the next.
    reset() {},
  }),
};
