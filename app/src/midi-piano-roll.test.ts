import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MidiNote } from "./midi-clip.ts";
import {
  addNote,
  copyNotes,
  deleteNote,
  deleteNotes,
  duplicateNotes,
  eraseNote,
  isBlackKey,
  moveNote,
  noteKey,
  PIANO_ROLL_HIGH_PITCH,
  PIANO_ROLL_LOW_PITCH,
  paintNote,
  pasteNotes,
  pitchName,
  placeNote,
  placeNotes,
  resizeNote,
  resizeOverNotes,
  sameNotes,
  shiftNotes,
  snapQ,
  sortNotes,
  thumbnailNotes,
  thumbnailPitchRange,
} from "./midi-piano-roll.ts";

const C4: MidiNote = { pitch: 60, start: 0, length: 1, velocity: 100 };
const E4: MidiNote = { pitch: 64, start: 2, length: 0.5, velocity: 90 };
// A sixteenth-note grid's cells per quarter.
const SIXTEENTHS = 4;

describe("pitch names", () => {
  it("names middle C C4 and marks black keys", () => {
    assert.equal(pitchName(60), "C4");
    assert.equal(pitchName(61), "C#4");
    assert.equal(pitchName(48), "C3");
    assert.equal(isBlackKey(61), true);
    assert.equal(isBlackKey(64), false);
  });
});

describe("piano roll edits", () => {
  it("snaps down to the grid's cells", () => {
    assert.equal(snapQ(1.3, SIXTEENTHS), 1.25);
    assert.equal(snapQ(0.249, SIXTEENTHS), 0);
    assert.equal(snapQ(0.25, SIXTEENTHS), 0.25);
    assert.equal(snapQ(1.3, 1), 1);
    // Eighth triplets: three cells a quarter, landing on whole thirds.
    assert.equal(snapQ(1.7, 3), 5 / 3);
    assert.equal(snapQ(2 / 3, 3), 2 / 3);
  });

  it("adds a note one grid cell long, in start order", () => {
    assert.deepEqual(addNote([C4, E4], 67, 1.6, SIXTEENTHS), [
      C4,
      { pitch: 67, start: 1.5, length: 0.25, velocity: 100 },
      E4,
    ]);
    // A quarter-note grid's cell is a quarter long (#1654).
    assert.deepEqual(addNote([], 67, 1.6, 1), [
      { pitch: 67, start: 1, length: 1, velocity: 100 },
    ]);
  });

  it("keeps added notes inside the roll's keys", () => {
    assert.equal(
      addNote([], 200, 0, SIXTEENTHS)[0].pitch,
      PIANO_ROLL_HIGH_PITCH,
    );
  });

  it("paints a note into a cell of the grid, replacing the notes under it", () => {
    const start = C4.start + C4.length;
    const painted = (startQ: number) => ({
      pitch: C4.pitch,
      start: startQ,
      length: 0.25,
      velocity: 100,
    });
    // Touching C4's end, which stays.
    assert.deepEqual(paintNote([C4], C4.pitch, start + 0.1, [C4], SIXTEENTHS), [
      C4,
      painted(start),
    ]);
    // C4 covers the cell's start, and goes however little of it is under.
    assert.deepEqual(
      paintNote([C4, E4], C4.pitch, C4.start + 0.1, [C4, E4], SIXTEENTHS),
      [painted(0), E4],
    );
    // A note starting partway through a cell is under it too.
    const partway = { ...C4, start: 0.375 };
    assert.deepEqual(
      paintNote([partway], C4.pitch, 0.3, [partway], SIXTEENTHS),
      [painted(0.25)],
    );
    // Other pitches stay.
    assert.deepEqual(paintNote([E4], C4.pitch, E4.start, [E4], SIXTEENTHS), [
      painted(E4.start),
      E4,
    ]);
  });

  it("paints no cell off the grid or already painted by the stroke", () => {
    const notes = [C4];
    assert.equal(
      paintNote(notes, C4.pitch, C4.start + 0.1, [], SIXTEENTHS),
      notes,
    );
    assert.equal(
      paintNote(notes, C4.pitch + 1, -0.1, notes, SIXTEENTHS),
      notes,
    );
    assert.equal(
      paintNote(notes, PIANO_ROLL_HIGH_PITCH + 1, 0, notes, SIXTEENTHS),
      notes,
    );
    assert.equal(
      paintNote(notes, PIANO_ROLL_LOW_PITCH - 1, 0, notes, SIXTEENTHS),
      notes,
    );
  });

  it("moves a note by snapped quarters and whole semitones from where it was", () => {
    assert.deepEqual(moveNote([C4, E4], 0, C4, 1.1, 2, SIXTEENTHS), [
      { ...C4, start: 1, pitch: 62 },
      E4,
    ]);
    // Never before the clip's content start.
    assert.equal(moveNote([C4], 0, C4, -3, 0, SIXTEENTHS)[0].start, 0);
  });

  it("resizes a note's end on the grid, never shorter than a sixteenth", () => {
    assert.deepEqual(resizeNote([C4, E4], 0, C4, "end", 1.4, SIXTEENTHS), [
      { ...C4, length: 2.5 },
      E4,
    ]);
    assert.equal(
      resizeNote([C4], 0, C4, "end", -0.9, SIXTEENTHS)[0].length,
      0.25,
    );
    assert.equal(
      resizeNote([C4], 0, C4, "end", -5, SIXTEENTHS)[0].length,
      0.25,
    );
    assert.equal(resizeNote([E4], 0, E4, "end", -1, SIXTEENTHS)[0].start, 2);
  });

  it("edits on the grid it's given, a cell at least", () => {
    // Quarter notes: a painted note fills the quarter it lands in.
    assert.deepEqual(paintNote([], 60, 2.7, [], 1), [
      { pitch: 60, start: 2, length: 1, velocity: 100 },
    ]);
    // Eighth triplets: moves and resizes land on thirds of a quarter.
    assert.equal(moveNote([C4], 0, C4, 0.4, 0, 3)[0].start, 1 / 3);
    assert.equal(resizeNote([C4], 0, C4, "end", -0.9, 3)[0].length, 1 / 3);
    assert.equal(resizeNote([C4], 0, C4, "end", 0.6, 3)[0].length, 5 / 3);
  });

  it("removes the same-pitch notes a resized note grew over", () => {
    const next = { ...C4, start: 2, length: 1 };
    const later = { ...C4, start: 4, length: 1 };
    const other = { ...E4, start: 2, length: 1 };
    const grown = (from: MidiNote, edit: Partial<MidiNote>) => ({
      ...from,
      ...edit,
    });
    // Over `next` by the end edge, up to `later` which it only touches.
    assert.deepEqual(
      resizeOverNotes([grown(C4, { length: 4 }), next, other, later], 0, C4),
      [grown(C4, { length: 4 }), other, later],
    );
    // Over `next` by the start edge, however little of it is under.
    assert.deepEqual(
      resizeOverNotes(
        [C4, next, grown(later, { start: 2.75, length: 2.25 })],
        2,
        later,
      ),
      [C4, grown(later, { start: 2.75, length: 2.25 })],
    );
    // Growing over nothing, or shrinking, keeps an overlap it already had.
    const overlapped = { ...C4, start: 0.5, length: 0.25 };
    assert.deepEqual(
      resizeOverNotes([grown(C4, { length: 2 }), overlapped], 0, C4),
      [grown(C4, { length: 2 }), overlapped],
    );
    assert.deepEqual(
      resizeOverNotes([grown(C4, { length: 0.75 }), overlapped], 0, C4),
      [grown(C4, { length: 0.75 }), overlapped],
    );
  });

  it("resizes a note's start, keeping its end", () => {
    assert.deepEqual(resizeNote([E4], 0, E4, "start", -0.6, SIXTEENTHS)[0], {
      ...E4,
      start: 1.5,
      length: 1,
    });
    assert.deepEqual(resizeNote([E4], 0, E4, "start", 2, SIXTEENTHS)[0], {
      ...E4,
      start: 2.25,
      length: 0.25,
    });
    // Never before the clip's content start.
    assert.deepEqual(resizeNote([E4], 0, E4, "start", -9, SIXTEENTHS)[0], {
      ...E4,
      start: 0,
      length: 2.5,
    });
  });

  it("deletes a note and sorts moved notes back into order", () => {
    assert.deepEqual(deleteNote([C4, E4], 0), [E4]);
    assert.deepEqual(sortNotes([E4, C4]), [C4, E4]);
  });

  it("compares note lists by value", () => {
    assert.equal(sameNotes([C4, E4], [{ ...C4 }, { ...E4 }]), true);
    assert.equal(sameNotes([C4], [{ ...C4, start: 1 }]), false);
    assert.equal(sameNotes([C4], [C4, E4]), false);
  });
});

describe("lane thumbnails", () => {
  it("spans at least an octave around its notes", () => {
    assert.deepEqual(thumbnailPitchRange([C4]), { low: 54, high: 66 });
    assert.deepEqual(thumbnailPitchRange([C4, { ...E4, pitch: 84 }]), {
      low: 60,
      high: 84,
    });
  });

  it("draws the notes in the clip's window, higher notes higher up", () => {
    const [low, high] = thumbnailNotes([C4, E4], 0, 4);
    assert.deepEqual(
      { left: low.left, width: low.width },
      { left: 0, width: 0.25 },
    );
    assert.deepEqual(
      { left: high.left, width: high.width },
      { left: 0.5, width: 0.125 },
    );
    assert.ok(high.top < low.top);
  });

  it("leaves out notes outside the window and cuts those across its edges", () => {
    const bars = thumbnailNotes([C4, E4], 0.5, 1.5);
    assert.equal(bars.length, 1);
    assert.deepEqual(
      { left: bars[0].left, width: bars[0].width },
      { left: 0, width: 1 / 3 },
    );
  });
});

describe("placing a note over others", () => {
  const note = (pitch: number, start: number, length: number): MidiNote => ({
    pitch,
    start,
    length,
    velocity: 100,
  });

  it("trims a same-pitch note to its longer uncovered side", () => {
    // Covering the start of a four-quarter note keeps its tail.
    assert.deepEqual(placeNote([note(60, 0, 4), note(60, 0, 1)], 1), [
      note(60, 0, 1),
      note(60, 1, 3),
    ]);
    // Covering its end keeps its head.
    assert.deepEqual(placeNote([note(60, 0, 4), note(60, 3, 2)], 1), [
      note(60, 0, 3),
      note(60, 3, 2),
    ]);
    // Inside it, the longer side wins, the earlier on a tie.
    assert.deepEqual(placeNote([note(60, 0, 4), note(60, 1, 1)], 1), [
      note(60, 1, 1),
      note(60, 2, 2),
    ]);
    assert.deepEqual(placeNote([note(60, 0, 4), note(60, 1.5, 1)], 1), [
      note(60, 0, 1.5),
      note(60, 1.5, 1),
    ]);
  });

  it("removes a covered note and leaves other pitches and neighbors", () => {
    assert.deepEqual(
      placeNote(
        [note(60, 1, 1), note(62, 0, 4), note(60, 4, 1), note(60, 0, 4)],
        3,
      ),
      [note(60, 0, 4), note(62, 0, 4), note(60, 4, 1)],
    );
  });
});

describe("deleting selected notes", () => {
  it("removes the notes whose keys are selected", () => {
    assert.deepEqual(deleteNotes([C4, E4], new Set([noteKey(E4)])), [C4]);
    assert.deepEqual(deleteNotes([C4, E4], new Set()), [C4, E4]);
  });
});

describe("editing selected notes", () => {
  const note = (pitch: number, start: number, length: number): MidiNote => ({
    pitch,
    start,
    length,
    velocity: 100,
  });
  const keysOf = (...notes: MidiNote[]) => new Set(notes.map(noteKey));

  it("nudges the selection together and selects the moved notes", () => {
    const a = note(60, 1, 1);
    const b = note(64, 2, 0.5);
    const other = note(67, 0, 1);
    const edit = shiftNotes([other, a, b], keysOf(a, b), 0.25, 0);
    assert.deepEqual(edit?.notes, [
      other,
      note(60, 1.25, 1),
      note(64, 2.25, 0.5),
    ]);
    assert.deepEqual(
      edit?.keys,
      keysOf(note(60, 1.25, 1), note(64, 2.25, 0.5)),
    );
    // Half a snap moves off the grid.
    assert.deepEqual(shiftNotes([a], keysOf(a), -0.125, 0)?.notes, [
      note(60, 0.875, 1),
    ]);
  });

  it("stops at the content start and the roll's keys, keeping spacing", () => {
    const a = note(60, 0.125, 1);
    const b = note(62, 1, 1);
    assert.deepEqual(shiftNotes([a, b], keysOf(a, b), -0.25, 0)?.notes, [
      note(60, 0, 1),
      note(62, 0.875, 1),
    ]);
    const first = note(60, 0, 1);
    assert.equal(shiftNotes([first], keysOf(first), -0.25, 0), undefined);
    const top = note(PIANO_ROLL_HIGH_PITCH, 0, 1);
    assert.equal(shiftNotes([top], keysOf(top), 0, 1), undefined);
    const bottom = note(PIANO_ROLL_LOW_PITCH, 0, 1);
    assert.deepEqual(shiftNotes([bottom], keysOf(bottom), 0, 1)?.notes, [
      note(PIANO_ROLL_LOW_PITCH + 1, 0, 1),
    ]);
    assert.equal(shiftNotes([a], new Set(), 0, 1), undefined);
  });

  it("transposes onto a same-pitch note, trimming it", () => {
    const moving = note(60, 0, 1);
    const under = note(61, 0, 4);
    assert.deepEqual(shiftNotes([moving, under], keysOf(moving), 0, 1)?.notes, [
      note(61, 0, 1),
      note(61, 1, 3),
    ]);
  });

  it("places several notes without them trimming each other", () => {
    const notes = [note(60, 0, 4), note(60, 0, 1), note(60, 1, 1)];
    assert.deepEqual(placeNotes(notes, new Set([1, 2])), [
      note(60, 0, 1),
      note(60, 1, 1),
      note(60, 2, 2),
    ]);
  });

  it("duplicates the selection right after its span", () => {
    const a = note(60, 1, 1);
    const b = note(64, 1.5, 1);
    const edit = duplicateNotes([a, b], keysOf(a, b));
    assert.deepEqual(edit?.notes, [a, b, note(60, 2.5, 1), note(64, 3, 1)]);
    assert.deepEqual(edit?.keys, keysOf(note(60, 2.5, 1), note(64, 3, 1)));
    assert.equal(duplicateNotes([a], new Set()), undefined);
  });

  it("copies notes relative to the first and pastes them at a quarter", () => {
    const a = note(60, 2, 1);
    const b = note(67, 2.5, 2);
    const clipboard = copyNotes([a, b, note(72, 0, 1)], keysOf(a, b));
    assert.deepEqual(clipboard, {
      notes: [note(60, 0, 1), note(67, 0.5, 2)],
      lengthQ: 2.5,
    });
    assert.equal(copyNotes([a], new Set()), undefined);
    if (!clipboard) {
      return;
    }
    const existing = note(60, 8, 4);
    const edit = pasteNotes([existing], clipboard, 8);
    assert.deepEqual(edit.notes, [
      note(60, 8, 1),
      note(67, 8.5, 2),
      note(60, 9, 3),
    ]);
    assert.deepEqual(edit.keys, keysOf(note(60, 8, 1), note(67, 8.5, 2)));
  });
});

describe("a note with expression", () => {
  const bend = [
    { at: 0, value: 0 },
    { at: 2, value: 4 },
  ];
  const expressive: MidiNote = {
    pitch: 60,
    start: 0,
    length: 4,
    velocity: 100,
    expression: { bend },
  };

  it("keeps its curve in place when its start is dragged", () => {
    const [resized] = resizeNote(
      [expressive],
      0,
      expressive,
      "start",
      1,
      SIXTEENTHS,
    );
    assert.equal(resized.start, 1);
    assert.equal(resized.length, 3);
    assert.deepEqual(resized.expression?.bend, [
      { at: 0, value: 2 },
      { at: 1, value: 4 },
    ]);
  });

  it("keeps its curve when its end is dragged or it is moved", () => {
    const [resized] = resizeNote(
      [expressive],
      0,
      expressive,
      "end",
      -1,
      SIXTEENTHS,
    );
    assert.equal(resized.expression?.bend, bend);
    const moved = moveNote([expressive], 0, expressive, 2, 3, SIXTEENTHS);
    assert.equal(
      moved.find((note) => note.pitch === 63)?.expression?.bend,
      bend,
    );
  });

  it("keeps its curve in place when a note placed over its head trims it", () => {
    const placed: MidiNote = { pitch: 60, start: 0, length: 1, velocity: 90 };
    const notes = placeNote([expressive, placed], 1);
    const trimmed = notes.find((note) => note.start === 1);
    assert.equal(trimmed?.length, 3);
    assert.equal(trimmed?.expression?.bend?.[0].value, 2);
  });
});

it("eraseNote deletes the note of the pitch sounding at a quarter", () => {
  const notes = [
    { pitch: 60, start: 1, length: 1, velocity: 100 },
    { pitch: 62, start: 1, length: 1, velocity: 100 },
  ];
  assert.deepEqual(eraseNote(notes, 60, 1.5), [notes[1]]);
  assert.deepEqual(eraseNote(notes, 60, 1), [notes[1]]);
  // Past its end, before its start and on another pitch, it hits nothing.
  assert.equal(eraseNote(notes, 60, 2), notes);
  assert.equal(eraseNote(notes, 60, 0.9), notes);
  assert.equal(eraseNote(notes, 61, 1.5), notes);
});
