import {
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react";
import type { MidiNote } from "../../midi-clip.ts";
import { midiHistoryLabels } from "../../midi-editing.ts";
import { addNote, noteKey, paintNote } from "../../midi-piano-roll.ts";
import type { SetMidiClipNotes } from "./PianoRoll";

type Stroke = {
  pointerId: number;
  spanId: string;
  // The clip's notes before the stroke.
  base: readonly MidiNote[];
  // The clip's notes during the stroke.
  notes: readonly MidiNote[];
  // Where the pointer last was, in client pixels.
  x: number;
  y: number;
  // The pitch last auditioned.
  pitch: number;
};

type ClientPoint = { clientX: number; clientY: number };

type PianoRollStrokeOptions = {
  spanId: string;
  // Where the clip's Length ends: a stroke paints inside it only.
  lengthQ: number;
  gridPoint: (
    point: ClientPoint,
  ) => { pitch: number; startQ: number } | undefined;
  onAudition: (pitch: number) => void;
  // The keys of the notes painted so far.
  onPaint: (keys: readonly string[]) => void;
  onSetNotes: SetMidiClipNotes;
};

// The piano roll's paint strokes: from a press, every grid cell the pointer
// crosses gets a note. The whole stroke is one undo step when it ends. The
// stroke lives in a ref as well as state, since pointer moves can outrun the
// roll's renders.
export function usePianoRollStroke({
  spanId,
  lengthQ,
  gridPoint,
  onAudition,
  onPaint,
  onSetNotes,
}: PianoRollStrokeOptions) {
  const strokeRef = useRef<Stroke | null>(null);
  const [notes, setNotes] = useState<readonly MidiNote[] | null>(null);

  // `current` with the stroke's edit at a client point.
  function strokeAt(current: readonly MidiNote[], at: ClientPoint) {
    const point = gridPoint(at);
    if (!point) {
      return current;
    }
    return point.startQ < lengthQ
      ? paintNote(current, point.pitch, point.startQ)
      : current;
  }

  function paintedKeys(stroke: Stroke) {
    return stroke.notes
      .filter((note) => !stroke.base.includes(note))
      .map(noteKey);
  }

  function start(
    event: ReactPointerEvent<HTMLElement>,
    base: readonly MidiNote[],
  ) {
    const stroke: Stroke = {
      pointerId: event.pointerId,
      spanId,
      base,
      notes: base,
      x: event.clientX,
      y: event.clientY,
      pitch: Number.NaN,
    };
    const point = gridPoint(event);
    if (point) {
      // The press lands on no note, even in a cell another note reaches into.
      stroke.notes = addNote(base, point.pitch, point.startQ);
      stroke.pitch = point.pitch;
      onAudition(point.pitch);
      onPaint(paintedKeys(stroke));
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    strokeRef.current = stroke;
    setNotes(stroke.notes);
  }

  function move(event: ReactPointerEvent<HTMLElement>) {
    const stroke = strokeRef.current;
    if (!stroke || event.pointerId !== stroke.pointerId) {
      return;
    }
    // Walks the pixels since the last event, which a fast drag leaves far
    // behind.
    const deltaX = event.clientX - stroke.x;
    const deltaY = event.clientY - stroke.y;
    const steps = Math.ceil(Math.max(Math.abs(deltaX), Math.abs(deltaY)));
    let next = stroke.notes;
    for (let step = 1; step <= steps; step += 1) {
      next = strokeAt(next, {
        clientX: stroke.x + (deltaX * step) / steps,
        clientY: stroke.y + (deltaY * step) / steps,
      });
    }
    stroke.x = event.clientX;
    stroke.y = event.clientY;
    if (next === stroke.notes) {
      return;
    }
    stroke.notes = next;
    setNotes(next);
    const pitch = gridPoint(event)?.pitch;
    if (pitch !== undefined && pitch !== stroke.pitch) {
      stroke.pitch = pitch;
      onAudition(pitch);
    }
    onPaint(paintedKeys(stroke));
  }

  function cancel() {
    strokeRef.current = null;
    setNotes(null);
  }

  function end(event: { pointerId: number }, commit: boolean) {
    const stroke = strokeRef.current;
    if (!stroke || event.pointerId !== stroke.pointerId) {
      return;
    }
    cancel();
    const count = Math.abs(stroke.notes.length - stroke.base.length);
    if (!commit || !count) {
      return;
    }
    onSetNotes(
      stroke.spanId,
      stroke.notes,
      count > 1 ? midiHistoryLabels.addNotes : midiHistoryLabels.addNote,
    );
  }

  return {
    // The clip's notes during a stroke.
    notes,
    start,
    move,
    end,
    cancel,
    // Whether another pointer's stroke is underway.
    isBusy: (pointerId: number) =>
      strokeRef.current !== null && strokeRef.current.pointerId !== pointerId,
  };
}
