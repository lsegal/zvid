import { ChevronLeftIcon } from "@heroicons/react/24/solid";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { auditionNote } from "../../midi-audition.ts";
import type { MidiNote, SynthParams } from "../../midi-clip.ts";
import type { MidiClipTimeline } from "../../midi-clip-timeline.ts";
import { midiHistoryLabels } from "../../midi-editing.ts";
import type { MidiClipModel } from "../../midi-panel-model.ts";
import {
  addNote,
  deleteNote,
  isBlackKey,
  moveNote,
  type NoteEdge,
  PIANO_ROLL_DEFAULT_PITCH,
  PIANO_ROLL_HIGH_PITCH,
  PIANO_ROLL_LOW_PITCH,
  pitchName,
  resizeNote,
  sameNotes,
  sortNotes,
} from "../../midi-piano-roll.ts";
import type { FxEditMode } from "../fx/types";
import "../fx/fx-chain.css";
import "./midi-devices.css";
import { PianoRollRuler } from "./PianoRollRuler";

export type SetMidiClipNotes = (
  spanId: string,
  notes: readonly MidiNote[],
  label: string,
  mode?: FxEditMode,
) => void;

export type SetMidiClipTimeline = (
  spanId: string,
  timeline: MidiClipTimeline,
  label: string,
  mode?: FxEditMode,
) => void;

type PianoRollProps = {
  model: MidiClipModel;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSetNotes: SetMidiClipNotes;
  onSetTimeline: SetMidiClipTimeline;
  // Plays a note through the clip's Synth; tests listen instead.
  onAudition?: (pitch: number, synth: SynthParams) => void;
};

// A key row's height and a quarter note's width on the roll's grid.
export const PIANO_ROLL_ROW_PX = 10;
export const PIANO_ROLL_QUARTER_PX = 32;
// The ruler's height over the grid.
export const PIANO_ROLL_RULER_PX = 22;

const PITCHES = Array.from(
  { length: PIANO_ROLL_HIGH_PITCH - PIANO_ROLL_LOW_PITCH + 1 },
  (_, index) => PIANO_ROLL_HIGH_PITCH - index,
);

function rowOf(pitch: number) {
  return PIANO_ROLL_HIGH_PITCH - pitch;
}

type NoteDrag = {
  pointerId: number;
  index: number;
  // The edge a resize drags, or undefined for a move.
  edge?: NoteEdge;
  from: MidiNote;
  startX: number;
  startY: number;
  // The clip's notes during the drag, the dragged one moved or resized.
  notes: MidiNote[];
};

// The quarters the roll shows: the clip's Length and every note, out to the
// next bar, and one more bar to drag the loop or the clip's end into.
function rollViewQ(notes: readonly MidiNote[], timeline: MidiClipTimeline) {
  const lastQ = notes.reduce(
    (end, note) => Math.max(end, note.start + note.length),
    timeline.length,
  );
  return Math.ceil(lastQ / 4) * 4 + 4;
}

// The selected MIDI clip's piano roll, after its Clip properties: a key for
// each pitch down the left and the clip's notes across, from its quarter 0,
// under its own ruler with the loop brace and Start marker (see
// PianoRollRuler). Clicking empty grid inside the clip's Length adds a note
// there, dragging a note moves it in time and pitch, dragging either of its
// edges resizes it, and right-clicking a note deletes it; each edit is one
// undo step. Clicking a note or a key
// auditions it through the clip's Synth.
export function PianoRoll({
  model,
  collapsed,
  onToggleCollapsed,
  onSetNotes,
  onSetTimeline,
  onAudition = auditionNote,
}: PianoRollProps) {
  const { spanId, label, accent, notes, timeline, synth } = model;
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<NoteDrag | null>(null);
  const shownNotes = drag?.notes ?? notes;
  const viewQ = rollViewQ(notes, timeline);
  const gridWidth = viewQ * PIANO_ROLL_QUARTER_PX;
  const gridHeight = PITCHES.length * PIANO_ROLL_ROW_PX;
  const style = {
    "--fx-accent": accent,
    "--piano-roll-row": `${PIANO_ROLL_ROW_PX}px`,
    "--piano-roll-quarter": `${PIANO_ROLL_QUARTER_PX}px`,
    "--piano-roll-ruler": `${PIANO_ROLL_RULER_PX}px`,
  } as CSSProperties;

  // Opens on the clip's notes, or on middle C when it has none.
  const centerPitch = notes.length
    ? Math.round(
        notes.reduce((sum, note) => sum + note.pitch, 0) / notes.length,
      )
    : PIANO_ROLL_DEFAULT_PITCH;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolls once per clip and unfold, not on every note edit
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (scroller) {
      scroller.scrollTop =
        PIANO_ROLL_RULER_PX +
        (rowOf(centerPitch) + 0.5) * PIANO_ROLL_ROW_PX -
        scroller.clientHeight / 2;
    }
  }, [spanId, collapsed]);

  const audition = (pitch: number) => onAudition(pitch, synth);

  // The pitch and quarter (from the clip's content start) under a point of
  // the grid.
  function gridPoint(event: { clientX: number; clientY: number }) {
    const bounds = gridRef.current?.getBoundingClientRect();
    if (!bounds) {
      return undefined;
    }
    const row = Math.floor((event.clientY - bounds.top) / PIANO_ROLL_ROW_PX);
    return {
      pitch: PIANO_ROLL_HIGH_PITCH - row,
      startQ: (event.clientX - bounds.left) / PIANO_ROLL_QUARTER_PX,
    };
  }

  function handleGridPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // Right-clicks, and Ctrl-clicks, which macOS treats as right-clicks,
    // are for deleting notes.
    if (event.button !== 0 || event.ctrlKey) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const noteElement = (event.target as Element).closest<HTMLElement>(
      "[data-note-index]",
    );
    if (noteElement) {
      const index = Number(noteElement.dataset.noteIndex);
      const from = notes[index];
      if (!from) {
        return;
      }
      const edge = (event.target as Element).closest<HTMLElement>(
        "[data-note-edge]",
      )?.dataset.noteEdge as NoteEdge | undefined;
      audition(from.pitch);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setDrag({
        pointerId: event.pointerId,
        index,
        edge,
        from,
        startX: event.clientX,
        startY: event.clientY,
        notes: [...notes],
      });
      return;
    }
    const point = gridPoint(event);
    if (!point || point.startQ >= timeline.length) {
      return;
    }
    audition(point.pitch);
    onSetNotes(
      spanId,
      addNote(notes, point.pitch, point.startQ),
      midiHistoryLabels.addNote,
    );
  }

  function handleGridPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    const deltaQ = (event.clientX - drag.startX) / PIANO_ROLL_QUARTER_PX;
    const moved = drag.edge
      ? resizeNote(notes, drag.index, drag.from, drag.edge, deltaQ)
      : moveNote(
          notes,
          drag.index,
          drag.from,
          deltaQ,
          -Math.round((event.clientY - drag.startY) / PIANO_ROLL_ROW_PX),
        );
    const before = drag.notes[drag.index];
    const after = moved[drag.index];
    if (
      before.pitch !== after.pitch ||
      before.start !== after.start ||
      before.length !== after.length
    ) {
      if (before.pitch !== after.pitch) {
        audition(after.pitch);
      }
      setDrag({ ...drag, notes: moved });
    }
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>, commit: boolean) {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    setDrag(null);
    if (commit && !sameNotes(drag.notes, notes)) {
      onSetNotes(
        spanId,
        sortNotes(drag.notes),
        drag.edge ? midiHistoryLabels.resizeNote : midiHistoryLabels.moveNote,
      );
    }
  }

  function removeNote(index: number) {
    onSetNotes(spanId, deleteNote(notes, index), midiHistoryLabels.deleteNote);
  }

  const name = `${label} notes`;

  if (collapsed) {
    return (
      <section
        aria-label={name}
        className="fx-device-panel fx-device-panel--collapsed piano-roll"
        style={style}
      >
        <button
          aria-expanded={false}
          aria-label="Expand Notes"
          className="fx-device-panel__strip"
          onClick={onToggleCollapsed}
          title="Expand Notes"
          type="button"
        >
          <span>Notes</span>
        </button>
      </section>
    );
  }

  return (
    <section
      aria-label={name}
      className="fx-device-panel piano-roll"
      style={style}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: double-click is a pointer shortcut; the collapse button is its keyboard equivalent */}
      <header
        className="fx-device-panel__title"
        onDoubleClick={(event) => {
          if (!(event.target as HTMLElement).closest("button")) {
            onToggleCollapsed();
          }
        }}
      >
        <span className="fx-device-panel__name">Notes</span>
        <span className="piano-roll__hint">
          click: add · drag: move · drag edge: resize · right-click: delete
        </span>
        <button
          aria-expanded
          aria-label="Collapse Notes"
          className="fx-device-panel__collapse"
          onClick={onToggleCollapsed}
          title="Collapse Notes"
          type="button"
        >
          <ChevronLeftIcon aria-hidden="true" />
        </button>
      </header>
      <div className="piano-roll__scroll" data-fx-no-drag ref={scrollRef}>
        <div className="piano-roll__corner" />
        <PianoRollRuler
          onChange={(next, historyLabel, mode) =>
            onSetTimeline(spanId, next, historyLabel, mode)
          }
          quarterPx={PIANO_ROLL_QUARTER_PX}
          timeline={timeline}
          viewQ={viewQ}
        />
        <div className="piano-roll__keys" style={{ height: gridHeight }}>
          {PITCHES.map((pitch) => (
            <button
              aria-label={`Play ${pitchName(pitch)}`}
              className={`piano-roll__key${isBlackKey(pitch) ? " piano-roll__key--black" : ""}`}
              key={pitch}
              onClick={() => audition(pitch)}
              tabIndex={-1}
              type="button"
            >
              {pitch % 12 === 0 ? pitchName(pitch) : null}
            </button>
          ))}
        </div>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: adding and dragging notes are pointer gestures; each note's button deletes it from the keyboard */}
        <div
          className={`piano-roll__grid${drag?.edge ? " piano-roll__grid--resizing" : ""}`}
          data-piano-roll-grid
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const noteElement = (event.target as Element).closest<HTMLElement>(
              "[data-note-index]",
            );
            if (noteElement && !drag) {
              removeNote(Number(noteElement.dataset.noteIndex));
            }
          }}
          onLostPointerCapture={(event) => endDrag(event, true)}
          onPointerCancel={(event) => endDrag(event, false)}
          onPointerDown={handleGridPointerDown}
          onPointerMove={handleGridPointerMove}
          onPointerUp={(event) => endDrag(event, true)}
          ref={gridRef}
          style={{ width: gridWidth, height: gridHeight }}
        >
          <span
            className="piano-roll__beyond-end"
            style={{ left: timeline.length * PIANO_ROLL_QUARTER_PX }}
          />
          {shownNotes.map((note, index) => {
            const left = note.start * PIANO_ROLL_QUARTER_PX;
            const width = note.length * PIANO_ROLL_QUARTER_PX;
            if (left + width <= 0 || left >= gridWidth) {
              return null;
            }
            return (
              <button
                aria-label={`${pitchName(note.pitch)} at beat ${+(note.start + 1).toFixed(2)}`}
                className={`piano-roll__note${drag?.index === index ? " piano-roll__note--dragging" : ""}`}
                data-note-index={index}
                // Notes have no ids; a drag keeps each note's index.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above
                key={index}
                onKeyDown={(event) => {
                  if (event.key === "Delete" || event.key === "Backspace") {
                    event.preventDefault();
                    removeNote(index);
                  } else if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    audition(note.pitch);
                  }
                }}
                style={{
                  left,
                  width,
                  top: rowOf(note.pitch) * PIANO_ROLL_ROW_PX,
                }}
                title={`${pitchName(note.pitch)}: Delete or right-click to remove`}
                type="button"
              >
                <span
                  className="piano-roll__note-edge piano-roll__note-edge--start"
                  data-note-edge="start"
                />
                <span
                  className="piano-roll__note-edge piano-roll__note-edge--end"
                  data-note-edge="end"
                />
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
