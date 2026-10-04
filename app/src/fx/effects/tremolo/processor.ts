// Tremolo as a chain stage. Rate and Depth are numbers the chain ramps, so
// the processor reads them per frame; Sync, Note and Shape are switches the
// chain crossfades.
import type { AudioEffectDsp } from "../../../audio-mix/processor.ts";
import {
  DEPTH_KEY,
  NOTE_KEY,
  RATE_KEY,
  SHAPE_DEFAULT,
  SHAPE_KEY,
  SYNC_KEY,
  TREMOLO_EFFECT_NAME,
  type TremoloBlock,
  TremoloDsp,
  tremoloShape,
  tremoloSyncedPeriod,
} from "./tremolo.ts";

const EMPTY = new Float32Array(0);

export const processor: AudioEffectDsp = {
  effectName: TREMOLO_EFFECT_NAME,
  createProcessor(sampleRate, channels) {
    const dsp = new TremoloDsp(channels);
    // Filled in again every block, so processing allocates nothing.
    const block: TremoloBlock = {
      frames: 0,
      sampleRate,
      timeSeconds: 0,
      syncedPeriodSeconds: undefined,
      shape: SHAPE_DEFAULT,
      rate: EMPTY,
      depth: EMPTY,
    };
    // What the switches and tempo last read, so their derived values are
    // worked out again only when one of them changes.
    let sync = "";
    let note = "";
    let shape = "";
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
          block.syncedPeriodSeconds = tremoloSyncedPeriod(sync, note, time);
        }
        const nextShape = params.switch(SHAPE_KEY);
        if (nextShape !== shape) {
          shape = nextShape;
          block.shape = tremoloShape(shape);
        }
        block.frames = frames;
        block.timeSeconds = time.timeSeconds;
        block.rate = params.number(RATE_KEY);
        block.depth = params.number(DEPTH_KEY);
        dsp.process(input, output, block);
      },
      // The switch values above depend only on what they were read from,
      // so they stay.
      reset() {
        dsp.reset();
      },
    };
  },
};
