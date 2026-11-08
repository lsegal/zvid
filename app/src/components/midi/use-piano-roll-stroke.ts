import {
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react";
import type { MidiNote } from "../../midi-clip.ts";
import { midiHistoryLabels } from "../../midi-editing.ts";
import {
  deleteNote,
  eraseNote,
  noteKey,
  paintNote,
} from "../../midi-piano-roll.ts";
import { useContextMenuSwallow } from "../../use-drag-scroll";
import type { SetMidiClipNotes } from "./PianoRoll";

type Stroke = {
  pointerId: number;
  spanId: string;
  // Whether the stroke deletes notes rather than painting them.
  erase: boolean;
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
  // The roll's grid: a painted note is one of its cells.
  cellsPerQ: number;
  gridPoint: (
    point: ClientPoint,
  ) => { pitch: number; startQ: number } | undefined;
  onAudition: (pitch: number) => void;
  // The keys of the notes painted so far.
  onPaint: (keys: readonly string[]) => void;
  // The keys of the notes an erase stroke deleted, as it ends.
  onErase: (keys: readonly string[]) => void;
  onSetNotes: SetMidiClipNotes;
};

// The piano roll's strokes: from a left press, every grid cell the pointer
// crosses gets a note, replacing the notes of its pitch under it; from a right
// press (Ctrl-press on macOS), every note it crosses is deleted. The whole
// stroke is one undo step when it ends. The stroke lives in a ref as well as
// state, since pointer moves can outrun the
// roll's renders.
export function usePianoRollStroke({
  spanId,
  lengthQ,
  cellsPerQ,
  gridPoint,
  onAudition,
  onPaint,
  onErase,
  onSetNotes,
}: PianoRollStrokeOptions) {
  const strokeRef = useRef<Stroke | null>(null);
  const [notes, setNotes] = useState<readonly MidiNote[] | null>(null);
  // Whether a right press still has its contextmenu to come: at the press or
  // at the release, depending on the platform.
  const menuPendingRef = useRef(false);
  const swallowContextMenu = useContextMenuSwallow();

  // `current` with the stroke's edit at a client point.
  function strokeAt(
    current: readonly MidiNote[],
    base: readonly MidiNote[],
    at: ClientPoint,
    erase = false,
  ) {
    const point = gridPoint(at);
    if (!point) {
      return current;
    }
    if (erase) {
      return eraseNote(current, point.pitch, point.startQ);
    }
    return point.startQ < lengthQ
      ? paintNote(current, point.pitch, point.startQ, base, cellsPerQ)
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
      erase: false,
      base,
      notes: base,
      x: event.clientX,
      y: event.clientY,
      pitch: Number.NaN,
    };
    const point = gridPoint(event);
    if (point) {
      stroke.notes = paintNote(
        base,
        point.pitch,
        point.startQ,
        base,
        cellsPerQ,
      );
      stroke.pitch = point.pitch;
      onAudition(point.pitch);
      onPaint(paintedKeys(stroke));
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    strokeRef.current = stroke;
    setNotes(stroke.notes);
  }

  function startErase(
    event: ReactPointerEvent<HTMLElement>,
    base: readonly MidiNote[],
  ) {
    const pressed = (event.target as Element).closest<HTMLElement>(
      "[data-note-index]",
    );
    const stroke: Stroke = {
      pointerId: event.pointerId,
      spanId,
      erase: true,
      base,
      notes: pressed
        ? deleteNote(base, Number(pressed.dataset.noteIndex))
        : strokeAt(base, base, event, true),
      x: event.clientX,
      y: event.clientY,
      pitch: Number.NaN,
    };
    menuPendingRef.current = true;
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
      next = strokeAt(
        next,
        stroke.base,
        {
          clientX: stroke.x + (deltaX * step) / steps,
          clientY: stroke.y + (deltaY * step) / steps,
        },
        stroke.erase,
      );
    }
    stroke.x = event.clientX;
    stroke.y = event.clientY;
    if (next === stroke.notes) {
      return;
    }
    stroke.notes = next;
    setNotes(next);
    if (stroke.erase) {
      return;
    }
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
    // The release may be off the grid, away from its contextmenu handler.
    if (menuPendingRef.current) {
      menuPendingRef.current = false;
      if (commit) {
        swallowContextMenu();
      }
    }
    // Not the change in length: a painted note can replace the note under it.
    const count = stroke.erase
      ? stroke.base.length - stroke.notes.length
      : paintedKeys(stroke).length;
    if (!commit || !count) {
      return;
    }
    if (stroke.erase) {
      onErase(
        stroke.base.filter((note) => !stroke.notes.includes(note)).map(noteKey),
      );
    }
    const labels = stroke.erase
      ? [midiHistoryLabels.deleteNote, midiHistoryLabels.deleteNotes]
      : [midiHistoryLabels.addNote, midiHistoryLabels.addNotes];
    onSetNotes(stroke.spanId, stroke.notes, labels[count > 1 ? 1 : 0]);
  }

  return {
    // The clip's notes during a stroke.
    notes,
    start,
    startErase,
    move,
    end,
    cancel,
    // Whether a contextmenu belongs to a right press, rather than to a long
    // press or the menu key, which open the note menu.
    claimContextMenu() {
      const pending = menuPendingRef.current;
      menuPendingRef.current = false;
      return pending;
    },
    // Whether another pointer's stroke is underway.
    isBusy: (pointerId: number) =>
      strokeRef.current !== null && strokeRef.current.pointerId !== pointerId,
  };
}
