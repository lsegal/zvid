import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MidiNote } from "./midi-clip.ts";
import {
  addNote,
  deleteNote,
  isBlackKey,
  moveNote,
  PIANO_ROLL_HIGH_PITCH,
  pitchName,
  sameNotes,
  snapQ,
  sortNotes,
  thumbnailNotes,
  thumbnailPitchRange,
} from "./midi-piano-roll.ts";

const C4: MidiNote = { pitch: 60, start: 0, length: 1, velocity: 100 };
const E4: MidiNote = { pitch: 64, start: 2, length: 0.5, velocity: 90 };

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
  it("snaps to sixteenth notes", () => {
    assert.equal(snapQ(1.3), 1.25);
    assert.equal(snapQ(0.249), 0);
    assert.equal(snapQ(0.25), 0.25);
  });

  it("adds a quarter note on the grid, in start order", () => {
    assert.deepEqual(addNote([C4, E4], 67, 1.6), [
      C4,
      { pitch: 67, start: 1.5, length: 1, velocity: 100 },
      E4,
    ]);
  });

  it("keeps added notes inside the roll's keys", () => {
    assert.equal(addNote([], 200, 0)[0].pitch, PIANO_ROLL_HIGH_PITCH);
  });

  it("moves a note by snapped quarters and whole semitones from where it was", () => {
    assert.deepEqual(moveNote([C4, E4], 0, C4, 1.1, 2), [
      { ...C4, start: 1, pitch: 62 },
      E4,
    ]);
    // Never before the clip's content start.
    assert.equal(moveNote([C4], 0, C4, -3, 0)[0].start, 0);
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
