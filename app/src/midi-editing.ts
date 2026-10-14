// Edits to a MIDI clip's notes and timeline, as project updates the FX
// panel's piano roll records in the undo history.
import { patchProjectState } from "./app/session-project.ts";
import type { ProjectState } from "./app/types.ts";
import type { MidiNote } from "./midi-clip.ts";
import type {
  MidiClipTimeline,
  MidiTimelineField,
} from "./midi-clip-timeline.ts";

export const midiHistoryLabels = {
  addNote: "Add Note",
  moveNote: "Move Note",
  resizeNote: "Resize Note",
  deleteNote: "Delete Note",
  deleteNotes: "Delete Notes",
  duplicateNote: "Duplicate Note",
  setVelocity: "Set Note Velocity",
  timeline: {
    length: "Set MIDI Clip Length",
    start: "Move Start Marker",
    loopStart: "Move Loop Start",
    loopEnd: "Move Loop End",
  } satisfies Record<MidiTimelineField, string>,
  moveLoop: "Move Loop",
  loop: (loop: boolean) => (loop ? "Enable Clip Loop" : "Disable Clip Loop"),
};

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
