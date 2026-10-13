// Edits to a source track's synth and a MIDI clip's notes, as project
// updates the FX panel's Synth device and piano roll record in the undo
// history.
import { patchProjectState } from "./app/session-project.ts";
import type { ProjectState } from "./app/types.ts";
import { type MidiNote, type SynthParams, synthParamsOf } from "./midi-clip.ts";

export type SynthParamKey = keyof SynthParams;

// Each synth parameter's name in the Synth device and its undo label.
export const SYNTH_PARAM_LABELS: Record<SynthParamKey, string> = {
  wave: "Wave",
  octave: "Octave",
  detune: "Detune",
  cutoff: "Cutoff",
  resonance: "Resonance",
  attack: "Attack",
  decay: "Decay",
  sustain: "Sustain",
  release: "Release",
};

export const midiHistoryLabels = {
  synthParam: (key: SynthParamKey) => `Change Synth ${SYNTH_PARAM_LABELS[key]}`,
  addNote: "Add Note",
  moveNote: "Move Note",
  deleteNote: "Delete Note",
};

/** `current` with `trackId`'s synth `key` set to `value`. */
export function setSourceTrackSynthParam<Key extends SynthParamKey>(
  current: ProjectState,
  trackId: string,
  key: Key,
  value: SynthParams[Key],
): ProjectState {
  return patchProjectState(current, {
    sourceTracks: current.sourceTracks.map((track) =>
      track.id === trackId
        ? { ...track, synth: { ...synthParamsOf(track.synth), [key]: value } }
        : track,
    ),
  });
}

/** `current` with the MIDI clip `spanId`'s notes replaced by `notes`. */
export function setSourceSpanNotes(
  current: ProjectState,
  spanId: string,
  notes: readonly MidiNote[],
): ProjectState {
  return patchProjectState(current, {
    sourceSpans: current.sourceSpans.map((span) =>
      span.id === spanId ? { ...span, notes: [...notes] } : span,
    ),
  });
}
