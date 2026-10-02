// The Transient Shaper as a chain stage: one detector across all channels
// sets a per-sample gain from Attack and Sustain, then Output scales the
// result. All three are number parameters, which the host ramps.
import type { AudioEffectDsp } from "../../../audio-mix/processor.ts";
import {
  ATTACK_KEY,
  createEnvelopeDetector,
  dbToAmplitude,
  OUTPUT_KEY,
  SUSTAIN_KEY,
  shapeGainDb,
  TRANSIENT_SHAPER_EFFECT_NAME,
} from "./transient-shaper.ts";

export const processor: AudioEffectDsp = {
  effectName: TRANSIENT_SHAPER_EFFECT_NAME,
  createProcessor(sampleRate) {
    const detector = createEnvelopeDetector(sampleRate);
    return {
      process(input, output, frames, params) {
        const attacks = params.changing(ATTACK_KEY)
          ? params.number(ATTACK_KEY)
          : null;
        const sustains = params.changing(SUSTAIN_KEY)
          ? params.number(SUSTAIN_KEY)
          : null;
        const outputs = params.changing(OUTPUT_KEY)
          ? params.number(OUTPUT_KEY)
          : null;
        const attack = params.value(ATTACK_KEY);
        const sustain = params.value(SUSTAIN_KEY);
        const outputDb = params.value(OUTPUT_KEY);
        for (let index = 0; index < frames; index++) {
          let level = 0;
          for (let channel = 0; channel < input.length; channel++) {
            level = Math.max(level, Math.abs(input[channel][index]));
          }
          // The detector runs on every frame, even at 0 %, so turning a
          // knob up mid-sound starts from the followers' settled state.
          const difference = detector.next(level);
          const gain = dbToAmplitude(
            shapeGainDb(
              difference,
              attacks ? attacks[index] : attack,
              sustains ? sustains[index] : sustain,
            ) + (outputs ? outputs[index] : outputDb),
          );
          for (let channel = 0; channel < output.length; channel++) {
            output[channel][index] = input[channel][index] * gain;
          }
        }
      },
    };
  },
};
