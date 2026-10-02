// Auto Pan as a chain stage. Rate and Depth are numbers the chain ramps, so
// the processor reads them per frame; Sync, Note and Shape are switches the
// chain crossfades between two processors when they change.
import type { AudioEffectDsp } from "../../../audio-mix/processor.ts";
import {
  AUTO_PAN_EFFECT_NAME,
  AutoPanDsp,
  autoPanShape,
  autoPanSyncedPeriod,
  DEPTH_KEY,
  NOTE_KEY,
  RATE_KEY,
  SHAPE_KEY,
  SYNC_KEY,
} from "./auto-pan.ts";

export const processor: AudioEffectDsp = {
  effectName: AUTO_PAN_EFFECT_NAME,
  createProcessor(sampleRate, channels) {
    const dsp = new AutoPanDsp(channels);
    return {
      process(input, output, frames, params, time) {
        dsp.process(input, output, {
          frames,
          sampleRate,
          timeSeconds: time.timeSeconds,
          syncedPeriodSeconds: autoPanSyncedPeriod(
            params.switch(SYNC_KEY),
            params.switch(NOTE_KEY),
            time,
          ),
          shape: autoPanShape(params.switch(SHAPE_KEY)),
          rate: params.number(RATE_KEY),
          depth: params.number(DEPTH_KEY),
        });
      },
    };
  },
};
