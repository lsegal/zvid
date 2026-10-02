// Tremolo as a chain stage. Rate and Depth are numbers the chain ramps, so
// the processor reads them per frame; Sync, Note and Shape are switches the
// chain crossfades.
import type { AudioEffectDsp } from "../../../audio-mix/processor.ts";
import {
  DEPTH_KEY,
  NOTE_KEY,
  RATE_KEY,
  SHAPE_KEY,
  SYNC_KEY,
  TREMOLO_EFFECT_NAME,
  TremoloDsp,
  tremoloShape,
  tremoloSyncedPeriod,
} from "./tremolo.ts";

export const processor: AudioEffectDsp = {
  effectName: TREMOLO_EFFECT_NAME,
  createProcessor(sampleRate, channels) {
    const dsp = new TremoloDsp(channels);
    return {
      process(input, output, frames, params, time) {
        dsp.process(input, output, {
          frames,
          sampleRate,
          timeSeconds: time.timeSeconds,
          syncedPeriodSeconds: tremoloSyncedPeriod(
            params.switch(SYNC_KEY),
            params.switch(NOTE_KEY),
            time,
          ),
          shape: tremoloShape(params.switch(SHAPE_KEY)),
          rate: params.number(RATE_KEY),
          depth: params.number(DEPTH_KEY),
        });
      },
    };
  },
};
