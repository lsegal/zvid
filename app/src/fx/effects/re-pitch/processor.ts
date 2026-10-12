// Re-Pitch as a chain stage. At Tape its source stage resamples where the
// clip reads its media, so the stage itself passes the re-pitched sound
// through to the effects after it. At Transients or Formants the source
// stage reads the media as it is and the stage shifts its pitch, a frame
// late (see re-pitch.ts).
import {
  type AudioEffectDsp,
  copyFrames,
} from "../../../audio-mix/processor.ts";
import { FormantShifter } from "./formants.ts";
import {
  ALGORITHM_FORMANTS,
  ALGORITHM_KEY,
  ALGORITHM_TRANSIENTS,
  CENTS_KEY,
  FORMANTS_KEY,
  preservesTime,
  RE_PITCH_EFFECT_NAME,
  rePitchFrameSize,
  rePitchLatencyFrames,
  rePitchRate,
  rePitchReadSeconds,
  rePitchTailSeconds,
  SEMITONES_KEY,
  TRANSIENTS_KEY,
} from "./re-pitch.ts";
import { TransientShifter } from "./transients.ts";

function amount(value: number) {
  return Math.min(1, Math.max(0, value || 0));
}

export const processor: AudioEffectDsp = {
  effectName: RE_PITCH_EFFECT_NAME,
  createProcessor(sampleRate, channels) {
    const frameSize = rePitchFrameSize(sampleRate);
    const transients = new TransientShifter(sampleRate, channels, frameSize);
    const formants = new FormantShifter(sampleRate, channels, frameSize);
    return {
      process(input, output, frames, params) {
        const algorithm = params.switch(ALGORITHM_KEY);
        if (algorithm === ALGORITHM_TRANSIENTS) {
          transients.process(
            input,
            output,
            frames,
            params.number(SEMITONES_KEY),
            params.number(CENTS_KEY),
            amount(params.value(TRANSIENTS_KEY)),
          );
        } else if (algorithm === ALGORITHM_FORMANTS) {
          formants.process(
            input,
            output,
            frames,
            params.number(SEMITONES_KEY),
            params.number(CENTS_KEY),
            amount(params.value(FORMANTS_KEY)),
          );
        } else {
          for (let channel = 0; channel < output.length; channel++) {
            copyFrames(input[channel], output[channel], frames);
          }
        }
      },
      reset() {
        transients.reset();
        formants.reset();
      },
    };
  },
  latencyFrames: ({ switches }, sampleRate) =>
    rePitchLatencyFrames(switches[ALGORITHM_KEY], sampleRate),
  tailSeconds: ({ switches }) => rePitchTailSeconds(switches[ALGORITHM_KEY]),
  source: {
    readSeconds: (seconds, span, { numbers, switches }) =>
      preservesTime(switches[ALGORITHM_KEY])
        ? seconds
        : rePitchReadSeconds(
            seconds,
            span,
            rePitchRate(numbers[SEMITONES_KEY] ?? 0, numbers[CENTS_KEY] ?? 0),
          ),
  },
};
