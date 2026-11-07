// What the FX panel's piano roll shows for the source selection: the
// selected source clip when it is a MIDI clip, and the hits its MIDI effects
// in Reactive mode follow.
import type { SourceSelection } from "./app/source-selection.ts";
import { getClipDurationQ, secondsToQuarters } from "./app/timeline-math.ts";
import type { SourceSpan } from "./app/types.ts";
import { noteOnsets } from "./audio-mix/midi-modulation.ts";
import { DEFAULT_TIME_SIGNATURE } from "./audio-mix/processor.ts";
import {
  sourceClipEffectTrackId,
  sourceTrackEffectTrackId,
} from "./fx/stack/clip-stacks.ts";
import type { SessionEffect } from "./fx/stack/types.ts";
import type { ReactiveOnset } from "./fx-animation-impulse.ts";
import { isMidiEffectName } from "./fx-registry.ts";
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
import {
  auditionInstrumentOf,
  clipMidiStack,
  midiChainOf,
} from "./midi-effects.ts";
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
  // What it plays through, which auditions its notes: its track's instrument
  // or its own (see clipMidiStack), or the default Synth when it has neither.
  instrument: MidiInstrument;
};

/**
 * The hits each MIDI effect in Reactive mode hears, by effect id, for its
 * Modulation section to follow: the notes reaching it from every clip it plays,
 * as the mix plays them (see audio-mix/resolve.ts). Empty when none is. The
 * panel has no time signature, which only moves an Arpeggiator synced in bars,
 * so the hits shown after one can differ from those heard outside 4/4.
 */
export function midiReactiveOnsets(
  sourceSpans: readonly SourceSpan[],
  effects: readonly SessionEffect[],
  bpm: number,
): ReadonlyMap<string, readonly ReactiveOnset[]> {
  const heard = new Map<string, ReactiveOnset[]>();
  if (
    !effects.some(
      ({ effectName, modulation }) =>
        modulation?.enabled &&
        modulation.mode === "transient" &&
        isMidiEffectName(effectName),
    )
  ) {
    return heard;
  }
  const stackOf = (stackId: string) =>
    effects.filter(
      (effect) =>
        effect.trackId === stackId && isMidiEffectName(effect.effectName),
    );
  for (const span of sourceSpans) {
    const chain = span.notes?.length
      ? midiChainOf(
          clipMidiStack(
            stackOf(sourceClipEffectTrackId(span.id)),
            stackOf(sourceTrackEffectTrackId(span.sourceTrackId)),
          ),
        )
      : undefined;
    if (!chain || !span.notes) {
      continue;
    }
    const durationSeconds = span.trimStartSeconds + span.durationSeconds;
    const offsetSeconds = (span.startQ * 60) / bpm - span.trimStartSeconds;
    const gridOffsetQ =
      span.startQ - secondsToQuarters(span.trimStartSeconds, bpm);
    const clock = { offsetSeconds, signature: DEFAULT_TIME_SIGNATURE, bpm };
    const hear = (
      modulation: { mode: string; seed: string } | undefined,
      notes: readonly MidiNote[],
    ) => {
      if (modulation?.mode === "transient") {
        heard.set(modulation.seed, [
          ...(heard.get(modulation.seed) ?? []),
          ...noteOnsets(notes, bpm, offsetSeconds),
        ]);
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
  }
  for (const onsets of heard.values()) {
    onsets.sort((left, right) => left.time - right.time);
  }
  return heard;
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
  const stackOf = (stackId: string) =>
    effects.filter((effect) => effect.trackId === stackId);
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
          clipMidiStack(
            stackOf(sourceClipEffectTrackId(span.id)),
            stackOf(sourceTrackEffectTrackId(span.sourceTrackId)),
          ),
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
