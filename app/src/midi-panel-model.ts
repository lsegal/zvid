// What the FX panel's piano roll shows for the source selection: the
// selected source clip when it is a MIDI clip.

import type { SourceSelection } from "./app/source-selection.ts";
import { getClipDurationQ, secondsToQuarters } from "./app/timeline-math.ts";
import type { SourceSpan } from "./app/types.ts";
import { noteOnsets } from "./audio-mix/midi-modulation.ts";
import { DEFAULT_TIME_SIGNATURE } from "./audio-mix/processor.ts";
import { sourceClipEffectTrackId } from "./fx/stack/clip-stacks.ts";
import type { SessionEffect } from "./fx/stack/types.ts";
import type { ReactiveOnset } from "./fx-animation-impulse.ts";
import {
  DEFAULT_INSTRUMENT,
  type MidiInstrument,
  type MidiNote,
} from "./midi-clip.ts";
import {
  defaultMidiTimeline,
  type MidiClipTimeline,
  performMidiNotes,
} from "./midi-clip-timeline.ts";
import { auditionInstrumentOf, midiChainOf } from "./midi-effects.ts";
import { arpeggiate } from "./note-generators.ts";

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
  // The hits each of its MIDI effects in Reactive mode hears, by effect id, for
  // its Modulation section to follow. Absent when none is.
  reactiveOnsets?: ReadonlyMap<string, readonly ReactiveOnset[]>;
};

// The notes reaching each MIDI effect of `span`'s `stack` that hears them as
// Reactive hits, as the mix plays them (see audio-mix/resolve.ts). The panel
// has no time signature, which only moves an Arpeggiator synced in bars, so
// the hits shown can differ from those heard there outside 4/4.
function reactiveOnsetsOf(
  span: SourceSpan,
  stack: readonly SessionEffect[],
  bpm: number,
): Pick<MidiClipModel, "reactiveOnsets"> {
  const chain = midiChainOf(stack);
  const { instrument } = chain ?? {};
  if (
    !chain ||
    !span.notes ||
    ![
      ...chain.generators,
      ...(instrument?.kind === "drums" ? [] : instrument ? [instrument] : []),
    ].some((played) => played.modulation?.mode === "transient")
  ) {
    return {};
  }
  const durationSeconds = span.trimStartSeconds + span.durationSeconds;
  const offsetSeconds = (span.startQ * 60) / bpm - span.trimStartSeconds;
  const gridOffsetQ =
    span.startQ - secondsToQuarters(span.trimStartSeconds, bpm);
  const clock = { offsetSeconds, signature: DEFAULT_TIME_SIGNATURE, bpm };
  const reactiveOnsets = new Map<string, readonly ReactiveOnset[]>();
  const hear = (
    modulation: { mode: string; seed: string } | undefined,
    notes: readonly MidiNote[],
  ) => {
    if (modulation?.mode === "transient") {
      reactiveOnsets.set(
        modulation.seed,
        noteOnsets(notes, bpm, offsetSeconds),
      );
    }
  };
  let notes: readonly MidiNote[] = performMidiNotes(
    span.notes,
    span.midiTimeline,
    secondsToQuarters(durationSeconds, bpm),
  );
  for (const generator of chain.generators) {
    hear(generator.modulation, notes);
    if (generator.enabled) {
      notes = arpeggiate(notes, generator, gridOffsetQ, clock);
    }
  }
  if (chain.instrument.kind !== "drums") {
    hear(chain.instrument.modulation, notes);
  }
  return { reactiveOnsets };
}

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
  const stack = effects.filter((effect) => effect.trackId === stackId);
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
      instrument: auditionInstrumentOf(stack) ?? DEFAULT_INSTRUMENT,
      ...reactiveOnsetsOf(span, stack, bpm),
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
