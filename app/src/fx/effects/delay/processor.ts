// Delay as a chain stage. Time, Feedback, High cut and Mix are numbers the
// chain ramps, so the processor reads them per frame; Sync, Note and
// Ping-pong are switches the chain crossfades.
import type { AudioEffectDsp } from "../../../audio-mix/processor.ts";
import {
  DELAY_EFFECT_NAME,
  type DelayBlock,
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

const EMPTY = new Float32Array(0);

export const processor: AudioEffectDsp = {
  effectName: DELAY_EFFECT_NAME,
  createProcessor(sampleRate, channels) {
    const dsp = new DelayDsp(sampleRate, channels);
    // Filled in again every block, so processing allocates nothing.
    const block: DelayBlock = {
      frames: 0,
      sampleRate,
      syncedSeconds: undefined,
      pingPong: false,
      timeMs: EMPTY,
      feedback: EMPTY,
      highCut: EMPTY,
      mix: EMPTY,
    };
    // What the switches and tempo last read, so their derived values are
    // worked out again only when one of them changes.
    let sync = "";
    let note = "";
    let pingPong = "";
    let bpm = Number.NaN;
    let numerator = Number.NaN;
    let denominator = Number.NaN;
    return {
      process(input, output, frames, params, time) {
        const nextSync = params.switch(SYNC_KEY);
        const nextNote = params.switch(NOTE_KEY);
        const { signature } = time;
        if (
          nextSync !== sync ||
          nextNote !== note ||
          time.bpm !== bpm ||
          signature.numerator !== numerator ||
          signature.denominator !== denominator
        ) {
          sync = nextSync;
          note = nextNote;
          bpm = time.bpm;
          numerator = signature.numerator;
          denominator = signature.denominator;
          block.syncedSeconds = delaySyncedSeconds(sync, note, time);
        }
        const nextPingPong = params.switch(PING_PONG_KEY);
        if (nextPingPong !== pingPong) {
          pingPong = nextPingPong;
          block.pingPong = delayPingPong(pingPong);
        }
        block.frames = frames;
        block.timeMs = params.number(TIME_KEY);
        block.feedback = params.number(FEEDBACK_KEY);
        block.highCut = params.number(HIGH_CUT_KEY);
        block.mix = params.number(MIX_KEY);
        dsp.process(input, output, block);
      },
      // The switch values above depend only on what they were read from,
      // so they stay.
      reset() {
        dsp.reset();
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
