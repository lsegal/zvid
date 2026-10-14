// What the FX panel's piano roll shows for the source selection: the
// selected source clip when it is a MIDI clip.
import type { SourceSelection } from "./app/source-selection.ts";
import { getClipDurationQ, secondsToQuarters } from "./app/timeline-math.ts";
import type { SourceSpan } from "./app/types.ts";
import { sourceClipEffectTrackId } from "./fx/stack/clip-stacks.ts";
import type { SessionEffect } from "./fx/stack/types.ts";
import {
  DEFAULT_INSTRUMENT,
  type MidiInstrument,
  type MidiNote,
} from "./midi-clip.ts";
import {
  defaultMidiTimeline,
  type MidiClipTimeline,
} from "./midi-clip-timeline.ts";
import { auditionInstrumentOf } from "./midi-effects.ts";

export type MidiClipModel = {
  spanId: string;
  label: string;
  accent: string;
  notes: readonly MidiNote[];
  // Where the clip starts on the timeline.
  startQ: number;
  // The clip's window: `lengthQ` quarters from `trimStartQ` into its notes.
  trimStartQ: number;
  lengthQ: number;
  // Its Length, loop brace and Start marker, or the default for a clip
  // that has never set them (see midi-clip-timeline.ts).
  timeline: MidiClipTimeline;
  // Its instrument, which auditions its notes: the default Synth when it
  // has none.
  instrument: MidiInstrument;
};

export function getMidiPanelModel(
  selection: SourceSelection | undefined,
  sourceSpans: readonly SourceSpan[],
  effects: readonly SessionEffect[],
  bpm: number,
): { fxMidiClip?: MidiClipModel } {
  const span = selection?.sourceSpanId
    ? sourceSpans.find((candidate) => candidate.id === selection.sourceSpanId)
    : undefined;
  if (!span?.notes) {
    return {};
  }
  const stackId = sourceClipEffectTrackId(span.id);
  return {
    fxMidiClip: {
      spanId: span.id,
      label: span.label,
      accent: span.accent,
      notes: span.notes,
      startQ: span.startQ,
      trimStartQ: secondsToQuarters(span.trimStartSeconds, bpm),
      lengthQ: getClipDurationQ(span, bpm),
      timeline: midiTimelineOf(span, bpm),
      instrument:
        auditionInstrumentOf(
          effects.filter((effect) => effect.trackId === stackId),
        ) ?? DEFAULT_INSTRUMENT,
    },
  };
}

/**
 * `span`'s MIDI timeline: the one it set, or else the default one as long
 * as its content.
 */
export function midiTimelineOf(
  span: Pick<
    SourceSpan,
    "midiTimeline" | "trimStartSeconds" | "durationSeconds"
  >,
  bpm: number,
): MidiClipTimeline {
  return (
    span.midiTimeline ??
    defaultMidiTimeline(
      secondsToQuarters(span.trimStartSeconds + span.durationSeconds, bpm),
    )
  );
}

// The FX chain's fold key for the piano roll, kept with the devices' (see
// fx-chain.ts).
export const PIANO_ROLL_COLLAPSE_KEY = "midi-notes";
