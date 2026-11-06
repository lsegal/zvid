import { useContext, useSyncExternalStore } from "react";
import {
  type CaptureClip,
  type HeldNote,
  heldNoteLength,
} from "../../midi-input/note-capture.ts";
import { FxModulationClockContext } from "../fx/modulation-clock";

// The notes MIDI keys are holding down, growing with the playhead until the
// keys come up and they become ordinary notes. They follow the playhead
// signal on their own, like PianoRollPlayhead, and let pointers through.
export function PianoRollHeldNote({
  clip,
  note,
  quarterPx,
  top,
}: {
  clip: CaptureClip;
  note: HeldNote;
  quarterPx: number;
  top: number;
}) {
  const clock = useContext(FxModulationClockContext);
  const width = useSyncExternalStore(
    clock?.signal.subscribe ?? noSubscription,
    () =>
      clock
        ? Math.round(heldNoteLength(clip, note, clock.signal.get()) * quarterPx)
        : 0,
  );
  return (
    <div
      aria-hidden="true"
      className="piano-roll__note piano-roll__note--held"
      data-piano-roll-held-note={note.pitch}
      style={{ left: note.startQ * quarterPx, width, top }}
    />
  );
}

function noSubscription() {
  return () => {};
}
