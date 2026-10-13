// What the FX panel's Synth device and piano roll show for the source
// selection: the selected source track's synth, once the track has MIDI
// clips, and the selected source clip when it is a MIDI clip.
import type { SourceSelection } from "./app/source-selection.ts";
import { getClipDurationQ, secondsToQuarters } from "./app/timeline-math.ts";
import type { SourceSpan, SourceTrack } from "./app/types.ts";
import { type MidiNote, type SynthParams, synthParamsOf } from "./midi-clip.ts";

export type SynthTrackModel = {
  trackId: string;
  trackName: string;
  synth: SynthParams;
};

export type MidiClipModel = {
  spanId: string;
  label: string;
  accent: string;
  notes: readonly MidiNote[];
  // The clip's window: `lengthQ` quarters from `trimStartQ` into its notes.
  trimStartQ: number;
  lengthQ: number;
  // Its track's synth, which auditions its notes.
  synth: SynthParams;
};

export function getMidiPanelModel(
  selection: SourceSelection | undefined,
  sourceTracks: readonly SourceTrack[],
  sourceSpans: readonly SourceSpan[],
  bpm: number,
): { fxSynthTrack?: SynthTrackModel; fxMidiClip?: MidiClipModel } {
  const track = selection
    ? sourceTracks.find((candidate) => candidate.id === selection.sourceTrackId)
    : undefined;
  if (
    !track ||
    !sourceSpans.some((span) => span.sourceTrackId === track.id && span.notes)
  ) {
    return {};
  }
  const synth = synthParamsOf(track.synth);
  const fxSynthTrack = { trackId: track.id, trackName: track.name, synth };
  const span = sourceSpans.find(
    (candidate) => candidate.id === selection?.sourceSpanId,
  );
  if (!span?.notes) {
    return { fxSynthTrack };
  }
  return {
    fxSynthTrack,
    fxMidiClip: {
      spanId: span.id,
      label: span.label,
      accent: span.accent,
      notes: span.notes,
      trimStartQ: secondsToQuarters(span.trimStartSeconds, bpm),
      lengthQ: getClipDurationQ(span, bpm),
      synth,
    },
  };
}

// The FX chain's fold keys for the Synth device and the piano roll, kept
// with the devices' (see fx-chain.ts).
export const SYNTH_COLLAPSE_KEY = "synth";
export const PIANO_ROLL_COLLAPSE_KEY = "midi-notes";
