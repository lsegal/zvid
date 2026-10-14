// Edits to a source track's synth and a MIDI clip's notes, as project
// updates the FX panel's Synth device and piano roll record in the undo
// history.
import { patchProjectState } from "./app/session-project.ts";
import type { ProjectState } from "./app/types.ts";
import { type MidiNote, type SynthParams, synthParamsOf } from "./midi-clip.ts";
import type {
  MidiClipTimeline,
  MidiTimelineField,
} from "./midi-clip-timeline.ts";
import type { Arpeggiator } from "./note-generators.ts";

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
  resizeNote: "Resize Note",
  deleteNote: "Delete Note",
  addArpeggiator: "Add Arpeggiator",
  removeArpeggiator: "Remove Arpeggiator",
  arpeggiatorEnabled: (enabled: boolean) =>
    enabled ? "Enable Arpeggiator" : "Bypass Arpeggiator",
  arpeggiatorRate: "Change Arpeggiator Rate",
  arpeggiatorPattern: "Change Arpeggiator Pattern",
  arpeggiatorOctaves: "Change Arpeggiator Octaves",
  timeline: {
    length: "Set MIDI Clip Length",
    start: "Move Start Marker",
    loopStart: "Move Loop Start",
    loopEnd: "Move Loop End",
  } satisfies Record<MidiTimelineField, string>,
  moveLoop: "Move Loop",
  loop: (loop: boolean) => (loop ? "Enable Clip Loop" : "Disable Clip Loop"),
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

/**
 * `current` with `trackId`'s arpeggiator set to `arp`, or removed from its
 * note generators when `arp` is undefined.
 */
export function setSourceTrackArpeggiator(
  current: ProjectState,
  trackId: string,
  arp: Arpeggiator | undefined,
): ProjectState {
  return patchProjectState(current, {
    sourceTracks: current.sourceTracks.map((track) => {
      if (track.id !== trackId) {
        return track;
      }
      const { noteGenerators, ...rest } = track;
      const others = (noteGenerators ?? []).filter(
        (generator) => generator.kind !== "arpeggiator",
      );
      const next = arp ? [arp, ...others] : others;
      return next.length ? { ...rest, noteGenerators: next } : rest;
    }),
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

/** `current` with the MIDI clip `spanId`'s timeline set to `timeline`. */
export function setSourceSpanMidiTimeline(
  current: ProjectState,
  spanId: string,
  timeline: MidiClipTimeline,
): ProjectState {
  return patchProjectState(current, {
    sourceSpans: current.sourceSpans.map((span) =>
      span.id === spanId ? { ...span, midiTimeline: { ...timeline } } : span,
    ),
  });
}
