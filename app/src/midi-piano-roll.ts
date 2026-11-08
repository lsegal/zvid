// The piano roll's note edits and geometry, and the lane thumbnail's. Notes
// are a MIDI clip's (see midi-clip.ts): `start` and `length` in quarter notes
// from the clip's content start, so the clip's visible window starts
// `trimStartQ` quarters in.
import { type MidiNote, withNoteStartMoved } from "./midi-clip.ts";

// Edits snap to the roll's grid, given as its cells per quarter note (see
// piano-roll-grid.ts), and a click adds one cell at a firm velocity.
export const NEW_NOTE_VELOCITY = 100;
// The roll's lowest and highest keys: C1 to C8.
export const PIANO_ROLL_LOW_PITCH = 24;
export const PIANO_ROLL_HIGH_PITCH = 108;
// A clip without notes centers the roll on middle C.
export const PIANO_ROLL_DEFAULT_PITCH = 60;

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

/** `pitch`'s name, C4 being middle C (60). */
export function pitchName(pitch: number) {
  return `${NOTE_NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
}

/** Whether `pitch` is a black key. */
export function isBlackKey(pitch: number) {
  return NOTE_NAMES[((pitch % 12) + 12) % 12].endsWith("#");
}

/** `valueQ` snapped down to a grid of `cellsPerQ` cells a quarter. */
export function snapQ(valueQ: number, cellsPerQ: number) {
  return Math.floor(valueQ * cellsPerQ + 1e-9) / cellsPerQ;
}

// `valueQ` snapped to the nearest line of a grid of `cellsPerQ` cells a
// quarter.
function roundQ(valueQ: number, cellsPerQ: number) {
  return Math.round(valueQ * cellsPerQ) / cellsPerQ;
}

function clampPitch(pitch: number) {
  return Math.min(
    PIANO_ROLL_HIGH_PITCH,
    Math.max(PIANO_ROLL_LOW_PITCH, Math.round(pitch)),
  );
}

/** `notes` in start order, then low to high, as the session keeps them. */
export function sortNotes(notes: readonly MidiNote[]) {
  return [...notes].sort(
    (left, right) => left.start - right.start || left.pitch - right.pitch,
  );
}

// Whether `note` overlaps quarters `startQ` to `endQ`, more than touching.
function overlapsSpan(note: MidiNote, startQ: number, endQ: number) {
  return (
    Math.min(note.start + note.length, endQ) - Math.max(note.start, startQ) >
    1e-9
  );
}

/**
 * `notes` with a new note of `pitch` one cell long in the cell of a grid of
 * `cellsPerQ` cells a quarter at `startQ`, kept in start order.
 */
export function addNote(
  notes: readonly MidiNote[],
  pitch: number,
  startQ: number,
  cellsPerQ: number,
): MidiNote[] {
  return sortNotes([
    ...notes,
    {
      pitch: clampPitch(pitch),
      start: Math.max(0, snapQ(startQ, cellsPerQ)),
      length: 1 / cellsPerQ,
      velocity: NEW_NOTE_VELOCITY,
    },
  ]);
}

/**
 * `notes` with a stroke's new note in the cell of a grid of `cellsPerQ`
 * cells a quarter at `pitch` and `startQ`,
 * replacing any notes of that pitch from `base`, the clip before the stroke,
 * that reach into the cell. `notes` itself when the cell is off the grid or
 * the stroke already painted it.
 */
export function paintNote(
  notes: readonly MidiNote[],
  pitch: number,
  startQ: number,
  base: readonly MidiNote[],
  cellsPerQ: number,
): readonly MidiNote[] {
  const start = snapQ(startQ, cellsPerQ);
  const under = notes.filter(
    (note) =>
      note.pitch === pitch && overlapsSpan(note, start, start + 1 / cellsPerQ),
  );
  return under.some((note) => !base.includes(note)) ||
    start < 0 ||
    pitch < PIANO_ROLL_LOW_PITCH ||
    pitch > PIANO_ROLL_HIGH_PITCH
    ? notes
    : addNote(
        notes.filter((note) => !under.includes(note)),
        pitch,
        start,
        cellsPerQ,
      );
}

/**
 * `notes` with the note at `index` moved by `deltaQ` quarters and
 * `deltaPitch` semitones from `from`, its place before the move: snapped to
 * a grid of `cellsPerQ` cells a quarter, kept at or after the content start
 * and inside the roll's keys. The note keeps its index while it moves;
 * `sortNotes` reorders the result.
 */
export function moveNote(
  notes: readonly MidiNote[],
  index: number,
  from: MidiNote,
  deltaQ: number,
  deltaPitch: number,
  cellsPerQ: number,
): MidiNote[] {
  return notes.map((note, noteIndex) =>
    noteIndex === index
      ? {
          ...note,
          start: Math.max(0, roundQ(from.start + deltaQ, cellsPerQ)),
          pitch: clampPitch(from.pitch + deltaPitch),
        }
      : note,
  );
}

/** A note's edge a resize drags. */
export type NoteEdge = "start" | "end";

/**
 * `notes` with the note at `index` resized by dragging its `edge` `deltaQ`
 * quarters from `from`, its place before the drag. The dragged edge snaps to
 * a grid of `cellsPerQ` cells a quarter and the other stays put, so dragging the end changes the length
 * and dragging the start moves the note and changes its length the other
 * way. The note never gets shorter than one cell, nor starts before the
 * content start.
 */
export function resizeNote(
  notes: readonly MidiNote[],
  index: number,
  from: MidiNote,
  edge: NoteEdge,
  deltaQ: number,
  cellsPerQ: number,
): MidiNote[] {
  const endQ = from.start + from.length;
  const cellQ = 1 / cellsPerQ;
  const snapped = (valueQ: number) => roundQ(valueQ, cellsPerQ);
  return notes.map((note, noteIndex) => {
    if (noteIndex !== index) {
      return note;
    }
    if (edge === "end") {
      const end = Math.max(from.start + cellQ, snapped(endQ + deltaQ));
      return { ...note, start: from.start, length: end - from.start };
    }
    const start = Math.max(
      0,
      Math.min(endQ - cellQ, snapped(from.start + deltaQ)),
    );
    return withNoteStartMoved({ ...note, ...from }, start - from.start);
  });
}

/**
 * `notes` in start order after the note at `index` was resized from `from`,
 * without the notes of its pitch under the span it grew over. A note it
 * only touches, or overlapped before and didn't grow over, stays.
 */
export function resizeOverNotes(
  notes: readonly MidiNote[],
  index: number,
  from: MidiNote,
): MidiNote[] {
  const resized = notes[index];
  if (!resized) {
    return sortNotes(notes);
  }
  const under = (note: MidiNote) =>
    note.pitch === resized.pitch &&
    (overlapsSpan(note, resized.start, from.start) ||
      overlapsSpan(
        note,
        from.start + from.length,
        resized.start + resized.length,
      ));
  return sortNotes(
    notes.filter((note, noteIndex) => noteIndex === index || !under(note)),
  );
}

/** `notes` without the note at `index`. */
export function deleteNote(
  notes: readonly MidiNote[],
  index: number,
): MidiNote[] {
  return notes.filter((_, noteIndex) => noteIndex !== index);
}

/**
 * A key naming a note by its pitch, start and length, which a selection
 * keeps across edits that reorder the notes.
 */
export function noteKey(note: MidiNote) {
  return `${note.pitch}:${note.start}:${note.length}`;
}

/**
 * `notes` without the note of `pitch` sounding at `q`, or `notes` itself when
 * there is none.
 */
export function eraseNote(
  notes: readonly MidiNote[],
  pitch: number,
  q: number,
): readonly MidiNote[] {
  const index = notes.findIndex(
    (note) =>
      note.pitch === pitch && note.start <= q && q < note.start + note.length,
  );
  return index < 0 ? notes : deleteNote(notes, index);
}

/** `notes` without those whose `noteKey` is in `keys`. */
export function deleteNotes(
  notes: readonly MidiNote[],
  keys: ReadonlySet<string>,
): MidiNote[] {
  return notes.filter((note) => !keys.has(noteKey(note)));
}

/**
 * `notes` in start order with the note at `index` placed, trimming the
 * notes of its pitch it overlaps the way `resolveClipOverlaps` trims clips:
 * each keeps its longer uncovered side, and is removed when it has none.
 */
export function placeNote(
  notes: readonly MidiNote[],
  index: number,
): MidiNote[] {
  const placed = notes[index];
  if (!placed) {
    return sortNotes(notes);
  }
  const placedEnd = placed.start + placed.length;
  const epsilon = 1e-9;
  return sortNotes(
    notes.flatMap((note, noteIndex) => {
      if (noteIndex === index || note.pitch !== placed.pitch) {
        return [note];
      }
      const end = note.start + note.length;
      if (
        Math.min(end, placedEnd) - Math.max(note.start, placed.start) <=
        epsilon
      ) {
        return [note];
      }
      const left = Math.max(0, placed.start - note.start);
      const right = Math.max(0, end - placedEnd);
      if (left <= epsilon && right <= epsilon) {
        return [];
      }
      return left >= right
        ? [{ ...note, length: left }]
        : [withNoteStartMoved(note, placedEnd - note.start)];
    }),
  );
}

/**
 * `notes` in start order with each of `placed` (indexes into `notes`)
 * placed as `placeNote` places one: the other notes of their pitches they
 * overlap are trimmed or removed. Placed notes never trim each other.
 */
export function placeNotes(
  notes: readonly MidiNote[],
  placed: ReadonlySet<number>,
): MidiNote[] {
  const epsilon = 1e-9;
  let others = notes.filter((_, index) => !placed.has(index));
  for (const index of placed) {
    const note = notes[index];
    if (!note) {
      continue;
    }
    const end = note.start + note.length;
    others = others.flatMap((other) => {
      const otherEnd = other.start + other.length;
      if (
        other.pitch !== note.pitch ||
        Math.min(end, otherEnd) - Math.max(note.start, other.start) <= epsilon
      ) {
        return [other];
      }
      const left = Math.max(0, note.start - other.start);
      const right = Math.max(0, otherEnd - end);
      if (left <= epsilon && right <= epsilon) {
        return [];
      }
      return left >= right
        ? [{ ...other, length: left }]
        : [withNoteStartMoved(other, end - other.start)];
    });
  }
  return sortNotes([
    ...others,
    ...notes.filter((_, index) => placed.has(index)),
  ]);
}

/** Notes after a selection edit, with the keys of the notes to select. */
export type NoteSelectionEdit = { notes: MidiNote[]; keys: Set<string> };

// `notes` with `added` appended and placed, selecting `added`.
function withPlacedNotes(
  notes: readonly MidiNote[],
  added: readonly MidiNote[],
): NoteSelectionEdit {
  const placed = new Set(added.map((_, index) => notes.length + index));
  return {
    notes: placeNotes([...notes, ...added], placed),
    keys: new Set(added.map(noteKey)),
  };
}

/**
 * `notes` with those whose `noteKey` is in `keys` moved `deltaQ` quarters
 * and `deltaPitch` semitones together, placed over the rest. The move is
 * cut short so no note starts before the content start or leaves the roll's
 * keys, keeping the notes' spacing; it returns undefined when nothing can
 * move.
 */
export function shiftNotes(
  notes: readonly MidiNote[],
  keys: ReadonlySet<string>,
  deltaQ: number,
  deltaPitch: number,
): NoteSelectionEdit | undefined {
  const selected = notes.filter((note) => keys.has(noteKey(note)));
  if (!selected.length) {
    return undefined;
  }
  const firstStart = Math.min(...selected.map((note) => note.start));
  const low = Math.min(...selected.map((note) => note.pitch));
  const high = Math.max(...selected.map((note) => note.pitch));
  const shiftQ = Math.max(deltaQ, -firstStart);
  const shiftPitch = Math.min(
    PIANO_ROLL_HIGH_PITCH - high,
    Math.max(PIANO_ROLL_LOW_PITCH - low, deltaPitch),
  );
  if (Math.abs(shiftQ) < 1e-9 && shiftPitch === 0) {
    return undefined;
  }
  return withPlacedNotes(
    notes.filter((note) => !keys.has(noteKey(note))),
    selected.map((note) => ({
      ...note,
      start: note.start + shiftQ,
      pitch: note.pitch + shiftPitch,
    })),
  );
}

/**
 * `notes` with copies of those whose `noteKey` is in `keys` placed right
 * after them: shifted by the span from the first one's start to the last
 * one's end. The copies are selected.
 */
export function duplicateNotes(
  notes: readonly MidiNote[],
  keys: ReadonlySet<string>,
): NoteSelectionEdit | undefined {
  const clipboard = copyNotes(notes, keys);
  if (!clipboard) {
    return undefined;
  }
  const selected = notes.filter((note) => keys.has(noteKey(note)));
  const firstStart = Math.min(...selected.map((note) => note.start));
  return pasteNotes(notes, clipboard, firstStart + clipboard.lengthQ);
}

/**
 * Copied notes, their starts from the first one's, and `lengthQ` from the
 * first one's start to the last one's end.
 */
export type NoteClipboard = {
  notes: readonly MidiNote[];
  lengthQ: number;
};

/** The clipboard for the notes whose `noteKey` is in `keys`. */
export function copyNotes(
  notes: readonly MidiNote[],
  keys: ReadonlySet<string>,
): NoteClipboard | undefined {
  const selected = notes.filter((note) => keys.has(noteKey(note)));
  if (!selected.length) {
    return undefined;
  }
  const firstStart = Math.min(...selected.map((note) => note.start));
  const lastEnd = Math.max(...selected.map((note) => note.start + note.length));
  return {
    notes: sortNotes(
      selected.map((note) => ({ ...note, start: note.start - firstStart })),
    ),
    lengthQ: lastEnd - firstStart,
  };
}

/**
 * `notes` with `clipboard`'s notes placed from `atQ`, keeping their spacing
 * and pitches. The pasted notes are selected.
 */
export function pasteNotes(
  notes: readonly MidiNote[],
  clipboard: NoteClipboard,
  atQ: number,
): NoteSelectionEdit {
  const startQ = Math.max(0, atQ);
  return withPlacedNotes(
    notes,
    clipboard.notes.map((note) => ({ ...note, start: startQ + note.start })),
  );
}

/** Whether two note lists hold the same notes in the same order. */
export function sameNotes(
  left: readonly MidiNote[],
  right: readonly MidiNote[],
) {
  return (
    left.length === right.length &&
    left.every((note, index) => {
      const other = right[index];
      return (
        note.pitch === other.pitch &&
        note.start === other.start &&
        note.length === other.length &&
        note.velocity === other.velocity &&
        JSON.stringify(note.expression) === JSON.stringify(other.expression)
      );
    })
  );
}

/**
 * The pitches a lane thumbnail spans: its notes' lowest to highest, widened
 * to at least an octave so a single note or a unison line sits mid-height.
 */
export function thumbnailPitchRange(notes: readonly MidiNote[]) {
  if (!notes.length) {
    return {
      low: PIANO_ROLL_DEFAULT_PITCH - 6,
      high: PIANO_ROLL_DEFAULT_PITCH + 6,
    };
  }
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const note of notes) {
    low = Math.min(low, note.pitch);
    high = Math.max(high, note.pitch);
  }
  const spread = Math.max(0, 12 - (high - low));
  return {
    low: low - Math.floor(spread / 2),
    high: high + Math.ceil(spread / 2),
  };
}

/** A note bar of a lane thumbnail, in fractions of the clip's box. */
export type ThumbnailNote = {
  left: number;
  width: number;
  top: number;
  height: number;
};

/**
 * The bars a clip's thumbnail draws for `notes` in its window of `lengthQ`
 * quarters from `trimStartQ`: notes outside the window are left out and the
 * rest cut to it. Each pitch takes a row, the highest at the top.
 */
export function thumbnailNotes(
  notes: readonly MidiNote[],
  trimStartQ: number,
  lengthQ: number,
): ThumbnailNote[] {
  if (lengthQ <= 0) {
    return [];
  }
  const { low, high } = thumbnailPitchRange(notes);
  const rows = high - low + 1;
  const endQ = trimStartQ + lengthQ;
  return notes.flatMap((note) => {
    const start = Math.max(note.start, trimStartQ);
    const end = Math.min(note.start + note.length, endQ);
    if (end <= start) {
      return [];
    }
    return [
      {
        left: (start - trimStartQ) / lengthQ,
        width: (end - start) / lengthQ,
        top: (high - note.pitch) / rows,
        height: 1 / rows,
      },
    ];
  });
}
