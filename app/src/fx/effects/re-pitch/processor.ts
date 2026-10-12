// Re-Pitch as a chain stage: its source stage resamples where the clip
// reads its media, so the stage itself passes the re-pitched sound through
// to the effects after it.
import {
  type AudioEffectDsp,
  copyFrames,
} from "../../../audio-mix/processor.ts";
import {
  CENTS_KEY,
  RE_PITCH_EFFECT_NAME,
  rePitchRate,
  rePitchReadSeconds,
  SEMITONES_KEY,
} from "./re-pitch.ts";

export const processor: AudioEffectDsp = {
  effectName: RE_PITCH_EFFECT_NAME,
  createProcessor: () => ({
    process(input, output, frames) {
      for (let channel = 0; channel < output.length; channel++) {
        copyFrames(input[channel], output[channel], frames);
      }
    },
    // Stateless: nothing carries from one block to the next.
    reset() {},
  }),
  source: {
    readSeconds: (seconds, span, { numbers }) =>
      rePitchReadSeconds(
        seconds,
        span,
        rePitchRate(numbers[SEMITONES_KEY] ?? 0, numbers[CENTS_KEY] ?? 0),
      ),
  },
};
