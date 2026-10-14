// What the FX panel's piano roll shows for the source selection: the
// selected source clip when it is a MIDI clip.
import type { SourceSelection } from "./app/source-selection.ts";
import { getClipDurationQ, secondsToQuarters } from "./app/timeline-math.ts";
import type { SourceSpan } from "./app/types.ts";
import { sourceClipEffectTrackId } from "./fx/stack/clip-stacks.ts";
import type { SessionEffect } from "./fx/stack/types.ts";
import {
  DEFAULT_SYNTH_PARAMS,
  type MidiNote,
  type SynthParams,
} from "./midi-clip.ts";
import {
  defaultMidiTimeline,
  type MidiClipTimeline,
} from "./midi-clip-timeline.ts";
import { auditionSynthOf } from "./midi-effects.ts";

export type MidiClipModel = {
  spanId: string;
  label: string;
  accent: string;
  notes: readonly MidiNote[];
  // The clip's window: `lengthQ` quarters from `trimStartQ` into its notes.
  trimStartQ: number;
  lengthQ: number;
  // Its Length, loop brace and Start marker, or the default for a clip
  // that has never set them (see midi-clip-timeline.ts).
  timeline: MidiClipTimeline;
  // Its Synth's settings, which audition its notes: the default synth's
  // when it has none.
  synth: SynthParams;
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
      trimStartQ: secondsToQuarters(span.trimStartSeconds, bpm),
      lengthQ: getClipDurationQ(span, bpm),
      timeline: midiTimelineOf(span, bpm),
      synth:
        auditionSynthOf(
          effects.filter((effect) => effect.trackId === stackId),
        ) ?? DEFAULT_SYNTH_PARAMS,
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
