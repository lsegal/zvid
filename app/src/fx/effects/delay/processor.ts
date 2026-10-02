// Delay as a chain stage. Time, Feedback, High cut and Mix are numbers the
// chain ramps, so the processor reads them per frame; Sync, Note and
// Ping-pong are switches the chain crossfades.
import type { AudioEffectDsp } from "../../../audio-mix/processor.ts";
import {
  DELAY_EFFECT_NAME,
  DelayDsp,
  delayPingPong,
  delaySyncedSeconds,
  delayTailSeconds,
  FEEDBACK_DEFAULT,
  FEEDBACK_KEY,
  HIGH_CUT_KEY,
  MIX_KEY,
  NOTE_DEFAULT,
  NOTE_KEY,
  PING_PONG_KEY,
  SYNC_DEFAULT,
  SYNC_KEY,
  TIME_DEFAULT_MS,
  TIME_KEY,
} from "./delay.ts";

export const processor: AudioEffectDsp = {
  effectName: DELAY_EFFECT_NAME,
  createProcessor(sampleRate, channels) {
    const dsp = new DelayDsp(sampleRate, channels);
    return {
      process(input, output, frames, params, time) {
        dsp.process(input, output, {
          frames,
          sampleRate,
          syncedSeconds: delaySyncedSeconds(
            params.switch(SYNC_KEY),
            params.switch(NOTE_KEY),
            time,
          ),
          pingPong: delayPingPong(params.switch(PING_PONG_KEY)),
          timeMs: params.number(TIME_KEY),
          feedback: params.number(FEEDBACK_KEY),
          highCut: params.number(HIGH_CUT_KEY),
          mix: params.number(MIX_KEY),
        });
      },
    };
  },
  tailSeconds: (settings, tempo) =>
    delayTailSeconds(
      delaySyncedSeconds(
        settings.switches[SYNC_KEY] ?? SYNC_DEFAULT,
        settings.switches[NOTE_KEY] ?? NOTE_DEFAULT,
        tempo,
      ) ?? (settings.numbers[TIME_KEY] ?? TIME_DEFAULT_MS) / 1000,
      settings.numbers[FEEDBACK_KEY] ?? FEEDBACK_DEFAULT,
    ),
};
