// Reverb as a chain stage. Decay, Damping and Mix are read per frame as the
// chain ramps them; Pre-delay and Size as stored, since the reverb
// crossfades its delays to them itself.
import type { AudioEffectDsp } from "../../../audio-mix/processor.ts";
import {
  DAMPING_KEY,
  DECAY_DEFAULT,
  DECAY_KEY,
  MIX_KEY,
  PRE_DELAY_DEFAULT_MS,
  PRE_DELAY_KEY,
  REVERB_EFFECT_NAME,
  ReverbDsp,
  reverbTailSeconds,
  SIZE_DEFAULT,
  SIZE_KEY,
} from "./reverb.ts";

export const processor: AudioEffectDsp = {
  effectName: REVERB_EFFECT_NAME,
  createProcessor(sampleRate, channels) {
    const dsp = new ReverbDsp(sampleRate, channels);
    return {
      process(input, output, frames, params) {
        dsp.process(input, output, {
          frames,
          sampleRate,
          decay: params.number(DECAY_KEY),
          damping: params.number(DAMPING_KEY),
          mix: params.number(MIX_KEY),
          preDelayMs: params.value(PRE_DELAY_KEY),
          size: params.value(SIZE_KEY),
        });
      },
    };
  },
  tailSeconds: (settings) =>
    reverbTailSeconds(
      settings.numbers[DECAY_KEY] ?? DECAY_DEFAULT,
      settings.numbers[PRE_DELAY_KEY] ?? PRE_DELAY_DEFAULT_MS,
      settings.numbers[SIZE_KEY] ?? SIZE_DEFAULT,
    ),
};
