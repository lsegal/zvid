import { ChevronLeftIcon } from "@heroicons/react/24/solid";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { getShortcutLabels } from "../../app/shortcut-labels.ts";
import { isContextMenuPress, type MenuPoint } from "../../context-menu.ts";
import { type AuditionVoice, auditionNote } from "../../midi-audition.ts";
import {
  type ExpressionSample,
  expressionSampleAtStart,
  type MidiInstrument,
  type MidiNote,
} from "../../midi-clip.ts";
import type { MidiClipTimeline } from "../../midi-clip-timeline.ts";
import { midiHistoryLabels } from "../../midi-editing.ts";
import {
  type ComputerKeyboardEntry,
  computerKeyboardEntry,
} from "../../midi-input/computer-keyboard.ts";
import { type MidiInputHub, midiInputHub } from "../../midi-input/input-hub.ts";
import type { MidiClipModel } from "../../midi-panel-model.ts";
import {
  copyNotes,
  deleteNote,
  deleteNotes,
  duplicateNotes,
  isBlackKey,
  moveNote,
  type NoteEdge,
  type NoteSelectionEdit,
  noteKey,
  PIANO_ROLL_DEFAULT_PITCH,
  PIANO_ROLL_HIGH_PITCH,
  PIANO_ROLL_LOW_PITCH,
  pasteNotes,
  pitchName,
  placeNote,
  resizeNote,
  sameNotes,
  shiftNotes,
  snapQ,
  sortNotes,
} from "../../midi-piano-roll.ts";
import {
  getNoteClipboard,
  NOTE_SHIFTS,
  type NoteAction,
  noteActionForKey,
  noteMenuEntries,
  setNoteClipboard,
} from "../../piano-roll-actions.ts";
import { useMidiPassActive } from "../../recording/record-source.ts";
import { chainHandlers } from "../../use-drag-scroll";
import { ContextMenu } from "../ContextMenu";
import { MidiMapContext, useKeyMapControls } from "../fx/key-map-context";
import { FxModulationClockContext } from "../fx/modulation-clock";
import type { FxEditMode } from "../fx/types";
import { KeyInputControl, MidiInputControl } from "../InputModeControl";
import "../fx/fx-chain.css";
import "../fx/fx-device-title.css";
import "./midi-devices.css";
import { PianoRollHeldNote } from "./PianoRollHeldNotes";
import { PianoRollKeyboardEntry } from "./PianoRollKeyboardEntry";
import { isMidiControl, PianoRollMidiControls } from "./PianoRollMidiControls";
import { PianoRollPlayhead, pianoRollPlayheadQ } from "./PianoRollPlayhead";
import { PianoRollRuler } from "./PianoRollRuler";
import { PianoRollVelocity, useVelocityLaneHeight } from "./PianoRollVelocity";
import { useComputerKeyboardEntry } from "./use-computer-keyboard-entry";
import { useMidiNoteCapture } from "./use-midi-note-capture";
import { usePianoRollPan } from "./use-piano-roll-pan";
import { usePianoRollStroke } from "./use-piano-roll-stroke";

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
  onAudition?: (
    pitch: number,
    instrument: MidiInstrument,
    expression?: ExpressionSample,
    hold?: boolean,
  ) => AuditionVoice | undefined;
  // Where MIDI keys come from; tests play a simulated device through it.
  midiHub?: MidiInputHub;
  // Whether the typing keyboard plays notes; tests keep their own.
  keyboardEntry?: ComputerKeyboardEntry;
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
  // Whether the drag moves a copy of the note, leaving the note in place.
  duplicate: boolean;
  from: MidiNote;
  startX: number;
  startY: number;
  // The clip's notes before the drag, with the copy at `index` when
  // duplicating.
  base: MidiNote[];
  // The clip's notes during the drag, the dragged one moved or resized.
  notes: MidiNote[];
};

const NO_SELECTION: ReadonlySet<string> = new Set();

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
// PianoRollRuler). Pressing empty grid inside the clip's Length adds a note
// there and dragging on paints one in each cell crossed (see
// use-piano-roll-stroke.ts), dragging a note moves it in time and pitch,
// Ctrl/Cmd-dragging drops a copy instead, dragging either of its edges resizes
// it, and right-clicking a note deletes it; each edit is one undo step.
// Right-dragging the grid pans the roll (see use-piano-roll-pan.ts), as does
// dragging the ruler, left and right. A long press or the menu key opens the
// menu of note actions. A moved or copied note trims the notes of its pitch it
// lands on, the way clips do.
// Clicking a note selects it (Shift-click adds to the selection) and Escape
// clears the selection. The keys act on the selected notes (see
// piano-roll-actions.ts): the arrows nudge them a snap (Shift for half) or a
// semitone, Delete or Backspace deletes them, and Cmd/Ctrl+D, X, C and V
// duplicate, cut, copy and paste, pasting at the playhead. Clicking a note or a key
// auditions it through the clip's instrument. A read-only line follows the
// transport playhead to the note sounding (see PianoRollPlayhead), and a
// resizable velocity lane along the bottom edits the notes' velocities (see
// PianoRollVelocity). While the roll is open, MIDI keys audition their pitch
// and, while the transport plays, write notes at the playhead, each one undo
// step (see use-midi-note-capture.ts), once MIDI is on in the header. The
// header's other toggle has the typing keyboard do the same (see
// use-computer-keyboard-entry.ts).
export function PianoRoll({
  model,
  collapsed,
  onToggleCollapsed,
  onSetNotes,
  onSetTimeline,
  onAudition = auditionNote,
  midiHub = midiInputHub,
  keyboardEntry = computerKeyboardEntry,
}: PianoRollProps) {
  const { spanId, label, accent, notes, timeline, instrument } = model;
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const clock = useContext(FxModulationClockContext);
  const keyMap = useKeyMapControls();
  const midiMap = useContext(MidiMapContext);
  const [drag, setDrag] = useState<NoteDrag | null>(null);
  const velocityLane = useVelocityLaneHeight();
  const [menuAnchor, setMenuAnchor] = useState<MenuPoint | null>(null);
  // The selected notes' keys, for the clip they were selected in.
  const [selection, setSelection] = useState({
    spanId,
    keys: NO_SELECTION,
  });
  const selectedKeys =
    selection.spanId === spanId ? selection.keys : NO_SELECTION;
  const select = (keys: Iterable<string>) =>
    setSelection({ spanId, keys: new Set(keys) });
  const { mac } = getShortcutLabels();
  const pan = usePianoRollPan({
    scrollRef,
    mac,
    onRightClickNote(index) {
      const note = notes[index];
      if (note) {
        select([...selectedKeys].filter((key) => key !== noteKey(note)));
        removeNote(index);
      }
    },
  });
  const viewQ = rollViewQ(notes, timeline);
  const gridWidth = viewQ * PIANO_ROLL_QUARTER_PX;
  const gridHeight = PITCHES.length * PIANO_ROLL_ROW_PX;
  const style = {
    "--fx-accent": accent,
    "--piano-roll-row": `${PIANO_ROLL_ROW_PX}px`,
    "--piano-roll-quarter": `${PIANO_ROLL_QUARTER_PX}px`,
    "--piano-roll-ruler": `${PIANO_ROLL_RULER_PX}px`,
    "--piano-roll-velocity": `${velocityLane.height}px`,
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
        (scroller.clientHeight - velocityLane.height) / 2;
    }
  }, [spanId, collapsed]);

  const audition = (
    pitch: number,
    expression?: ExpressionSample,
    hold = false,
  ) =>
    expression || hold
      ? onAudition(pitch, instrument, expression, hold)
      : onAudition(pitch, instrument);
  // A note clicked on sounds as it starts.
  const auditionNoteFrom = ({ pitch, expression }: MidiNote) =>
    audition(pitch, expression && expressionSampleAtStart(expression));

  const stroke = usePianoRollStroke({
    spanId,
    lengthQ: timeline.length,
    gridPoint,
    onAudition: (pitch) => audition(pitch),
    onPaint: select,
    onSetNotes,
  });
  const shownNotes = drag?.notes ?? stroke.notes ?? notes;

  // The clip's notes with the captures not yet back from the session, since
  // a chord's keys come up faster than the roll re-renders.
  const capturedNotes = useRef(notes);
  capturedNotes.current = notes;
  // A MIDI recording pass takes the keys for the clip it records.
  const midiPassActive = useMidiPassActive();
  const { heldNotes, midi, playKey, releaseKey } = useMidiNoteCapture({
    enabled: !collapsed && !midiPassActive,
    hub: midiHub,
    clip: model,
    clock,
    onAudition(pitch, expression, hold) {
      revealPitch(pitch);
      return audition(pitch, expression, hold);
    },
    onCapture(note) {
      const next = placeNote(
        [...capturedNotes.current, note],
        capturedNotes.current.length,
      );
      capturedNotes.current = next;
      // A drag's or a stroke's snapshot of the clip would overwrite the new
      // note.
      setDrag(null);
      stroke.cancel();
      onSetNotes(spanId, next, midiHistoryLabels.recordNote);
    },
  });
  const keyboardEntryState = useComputerKeyboardEntry({
    active: !collapsed && !midiPassActive,
    entry: keyboardEntry,
    press: playKey,
    release: releaseKey,
  });

  // Scrolls a pitch played from a key into view, centered, if it isn't.
  function revealPitch(pitch: number) {
    const scroller = scrollRef.current;
    if (!scroller) {
      return;
    }
    const y = PIANO_ROLL_RULER_PX + (rowOf(pitch) + 0.5) * PIANO_ROLL_ROW_PX;
    const top = scroller.scrollTop + PIANO_ROLL_RULER_PX;
    const bottom =
      scroller.scrollTop + scroller.clientHeight - velocityLane.height;
    if (y < top || y > bottom) {
      scroller.scrollTop =
        y - (scroller.clientHeight - velocityLane.height) / 2;
    }
  }

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
    // belong to the pan and its click.
    if (
      event.button !== 0 ||
      isContextMenuPress(event, mac) ||
      stroke.isBusy(event.pointerId)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    // The grid takes the focus so the panel hears Delete and Escape.
    gridRef.current?.focus({ preventScroll: true });
    const noteElement = (event.target as Element).closest<HTMLElement>(
      "[data-note-index]",
    );
    if (noteElement) {
      const index = Number(noteElement.dataset.noteIndex);
      const from = notes[index];
      if (!from) {
        return;
      }
      auditionNoteFrom(from);
      const key = noteKey(from);
      if (event.shiftKey) {
        select(
          selectedKeys.has(key)
            ? [...selectedKeys].filter((selected) => selected !== key)
            : [...selectedKeys, key],
        );
        return;
      }
      select([key]);
      const duplicate = event.ctrlKey || event.metaKey;
      const base = duplicate ? [...notes, { ...from }] : [...notes];
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setDrag({
        pointerId: event.pointerId,
        index: duplicate ? notes.length : index,
        edge: duplicate
          ? undefined
          : ((event.target as Element).closest<HTMLElement>("[data-note-edge]")
              ?.dataset.noteEdge as NoteEdge | undefined),
        duplicate,
        from,
        startX: event.clientX,
        startY: event.clientY,
        base,
        notes: base,
      });
      return;
    }
    const point = gridPoint(event);
    if (!point || point.startQ >= timeline.length) {
      select([]);
      return;
    }
    stroke.start(event, notes);
  }

  function handleGridPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    stroke.move(event);
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    const deltaQ = (event.clientX - drag.startX) / PIANO_ROLL_QUARTER_PX;
    const moved = drag.edge
      ? resizeNote(drag.base, drag.index, drag.from, drag.edge, deltaQ)
      : moveNote(
          drag.base,
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
    if (!commit || sameNotes(drag.notes, drag.base)) {
      return;
    }
    select([noteKey(drag.notes[drag.index])]);
    if (drag.edge) {
      onSetNotes(spanId, sortNotes(drag.notes), midiHistoryLabels.resizeNote);
      return;
    }
    onSetNotes(
      spanId,
      placeNote(drag.notes, drag.index),
      drag.duplicate
        ? midiHistoryLabels.duplicateNote
        : midiHistoryLabels.moveNote,
    );
  }

  function removeNote(index: number) {
    onSetNotes(spanId, deleteNote(notes, index), midiHistoryLabels.deleteNote);
  }

  // Where Paste puts the clipboard's first note: at the note the playhead
  // sounds, snapped to the grid, or at the clip's Start marker while the
  // playhead is outside the clip.
  function pasteQ() {
    const soundingQ = pianoRollPlayheadQ(
      model,
      clock?.signal.get() ?? Number.NaN,
    );
    return soundingQ === undefined ? timeline.start : snapQ(soundingQ);
  }

  function applyEdit(edit: NoteSelectionEdit | undefined, label: string) {
    if (!edit) {
      return;
    }
    select(edit.keys);
    onSetNotes(spanId, edit.notes, label);
  }

  // Runs a note action on the selected notes, each edit one undo step.
  // Returns whether the action applies: Paste needs the clipboard and the
  // rest a selection.
  function runNoteAction(action: NoteAction) {
    const selectedCount = notes.filter((note) =>
      selectedKeys.has(noteKey(note)),
    ).length;
    if (action === "paste") {
      const clipboard = getNoteClipboard();
      if (!clipboard) {
        return false;
      }
      applyEdit(
        pasteNotes(notes, clipboard, pasteQ()),
        midiHistoryLabels.pasteNotes,
      );
      return true;
    }
    if (!selectedCount) {
      return false;
    }
    switch (action) {
      case "delete":
        select([]);
        onSetNotes(
          spanId,
          deleteNotes(notes, selectedKeys),
          selectedCount > 1
            ? midiHistoryLabels.deleteNotes
            : midiHistoryLabels.deleteNote,
        );
        break;
      case "duplicate":
        applyEdit(
          duplicateNotes(notes, selectedKeys),
          midiHistoryLabels.duplicateNotes,
        );
        break;
      case "copy":
        setNoteClipboard(copyNotes(notes, selectedKeys));
        break;
      case "cut":
        setNoteClipboard(copyNotes(notes, selectedKeys));
        select([]);
        onSetNotes(
          spanId,
          deleteNotes(notes, selectedKeys),
          midiHistoryLabels.cutNotes,
        );
        break;
      default: {
        const { deltaQ, deltaPitch } = NOTE_SHIFTS[action];
        applyEdit(
          shiftNotes(notes, selectedKeys, deltaQ, deltaPitch),
          deltaPitch
            ? midiHistoryLabels.transposeNotes
            : midiHistoryLabels.nudgeNotes,
        );
      }
    }
    return true;
  }

  // The note action keys act on the selected notes, and Escape clears the
  // selection, unless a note's own button handled the key.
  function handlePanelKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (
      event.defaultPrevented ||
      drag ||
      stroke.notes ||
      isMidiControl(event.target)
    ) {
      return;
    }
    const action = noteActionForKey(event, mac);
    if (action) {
      if (runNoteAction(action)) {
        event.preventDefault();
      }
    } else if (event.key === "Escape" && selectedKeys.size) {
      event.preventDefault();
      select([]);
    }
  }

  // A long press or the menu key on a note outside the selection selects it,
  // then the menu opens on the selection; on empty grid the selection stays.
  function handleGridContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (pan.claimContextMenu() || drag) {
      return;
    }
    stroke.cancel();
    const noteElement = (event.target as Element).closest<HTMLElement>(
      "[data-note-index]",
    );
    const note = noteElement && notes[Number(noteElement.dataset.noteIndex)];
    if (note && !selectedKeys.has(noteKey(note))) {
      select([noteKey(note)]);
    }
    gridRef.current?.focus({ preventScroll: true });
    setMenuAnchor({ x: event.clientX, y: event.clientY });
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
      onKeyDown={handlePanelKeyDown}
      style={style}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: double-click is a pointer shortcut; the collapse button is its keyboard equivalent */}
      <header
        className="fx-device-panel__title"
        onDoubleClick={(event) => {
          if (
            !(event.target as HTMLElement).closest("button") &&
            !isMidiControl(event.target)
          ) {
            onToggleCollapsed();
          }
        }}
      >
        <span className="fx-device-panel__name">Notes</span>
        <PianoRollMidiControls hub={midiHub} state={midi}>
          <PianoRollKeyboardEntry state={keyboardEntryState} />
          {/* A phone has no top bar for these. */}
          <div className="piano-roll__phone-inputs">
            <KeyInputControl entry={keyboardEntry} map={keyMap} />
            <MidiInputControl hub={midiHub} map={midiMap} />
          </div>
        </PianoRollMidiControls>
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
          scrollRef={scrollRef}
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
        {/* biome-ignore lint/a11y/noStaticElementInteractions: painting and dragging notes are pointer gestures; each note's button deletes it from the keyboard */}
        <div
          className={`piano-roll__grid${drag?.edge ? " piano-roll__grid--resizing" : ""}${pan.isGrabbing ? " piano-roll__grid--panning" : ""}`}
          data-piano-roll-grid
          onContextMenu={handleGridContextMenu}
          {...chainHandlers(pan.handlers, {
            onLostPointerCapture: (
              event: ReactPointerEvent<HTMLDivElement>,
            ) => {
              stroke.end(event, true);
              endDrag(event, true);
            },
            onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => {
              stroke.end(event, false);
              endDrag(event, false);
            },
            onPointerDown: handleGridPointerDown,
            onPointerMove: handleGridPointerMove,
            onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
              stroke.end(event, true);
              endDrag(event, true);
            },
          })}
          ref={gridRef}
          style={{ width: gridWidth, height: gridHeight }}
          tabIndex={-1}
        >
          <span
            className="piano-roll__beyond-end"
            style={{ left: timeline.length * PIANO_ROLL_QUARTER_PX }}
          />
          {shownNotes.map((note, index) => {
            const left = note.start * PIANO_ROLL_QUARTER_PX;
            const width = note.length * PIANO_ROLL_QUARTER_PX;
            const selected = drag
              ? drag.index === index
              : selectedKeys.has(noteKey(note));
            if (left + width <= 0 || left >= gridWidth) {
              return null;
            }
            return (
              <button
                aria-label={`${pitchName(note.pitch)} at beat ${+(note.start + 1).toFixed(2)}`}
                aria-pressed={selected}
                className={`piano-roll__note${selected ? " piano-roll__note--selected" : ""}${drag?.index === index ? " piano-roll__note--dragging" : ""}`}
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
                    auditionNoteFrom(note);
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
          {heldNotes.map((note) => (
            <PianoRollHeldNote
              clip={model}
              key={`${note.pitch}:${note.startQ}`}
              note={note}
              quarterPx={PIANO_ROLL_QUARTER_PX}
              top={rowOf(note.pitch) * PIANO_ROLL_ROW_PX}
            />
          ))}
          <PianoRollPlayhead model={model} quarterPx={PIANO_ROLL_QUARTER_PX} />
        </div>
        <PianoRollVelocity
          lane={velocityLane}
          notes={shownNotes}
          onSetVelocities={(next) =>
            onSetNotes(spanId, next, midiHistoryLabels.setVelocity)
          }
          quarterPx={PIANO_ROLL_QUARTER_PX}
          selectedKeys={selectedKeys}
          width={gridWidth}
        />
      </div>
      {/* The menu is portaled out of the panel, but React still bubbles its
          events here; stop them before the panel acts on its keys. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: only stops the menu's events from reaching the panel */}
      <div
        className="piano-roll__menu"
        onContextMenu={stopMenuEvent}
        onKeyDown={stopMenuEvent}
        onPointerDown={stopMenuEvent}
      >
        <ContextMenu
          anchor={menuAnchor}
          entries={
            menuAnchor
              ? noteMenuEntries({
                  mac,
                  hasSelection: notes.some((note) =>
                    selectedKeys.has(noteKey(note)),
                  ),
                  canPaste: getNoteClipboard() !== undefined,
                  run: runNoteAction,
                })
              : []
          }
          label="Note actions"
          onClose={() => setMenuAnchor(null)}
        />
      </div>
    </section>
  );
}

function stopMenuEvent(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}
