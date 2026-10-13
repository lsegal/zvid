import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MidiNote } from "./midi-clip.ts";
import {
  defaultMidiTimeline,
  dragMidiTimeline,
  type MidiClipTimeline,
  moveMidiLoop,
  newMidiTimeline,
  performMidiNotes,
  readMidiTimeline,
  setMidiTimelineField,
  setMidiTimelineLoop,
} from "./midi-clip-timeline.ts";

function note(start: number, length = 0.5, pitch = 60): MidiNote {
  return { pitch, start, length, velocity: 100 };
}

// Where each played note starts.
function starts(notes: readonly MidiNote[]) {
  return notes.map((played) => played.start);
}

describe("performMidiNotes", () => {
  // A note on every beat of four bars: quarters 0 through 15.
  const beats = Array.from({ length: 16 }, (_, index) =>
    note(index, 0.5, index),
  );

  it("plays the notes as they lie without a timeline", () => {
    assert.equal(performMidiNotes(beats, undefined, 4), beats);
  });

  it("plays Start to the loop end first, then the loop over and over", () => {
    // Start 2.1.1 with a loop from 1.1.2 to 4.1.1.
    const timeline: MidiClipTimeline = {
      length: 16,
      start: 4,
      loopStart: 0.25,
      loopEnd: 12,
      loop: true,
    };
    const played = performMidiNotes(beats, timeline, 30);
    // The first pass plays quarters 4 to 11 at 0 to 7.
    assert.deepEqual(
      played.slice(0, 8).map((item) => item.pitch),
      [4, 5, 6, 7, 8, 9, 10, 11],
    );
    assert.deepEqual(starts(played.slice(0, 8)), [0, 1, 2, 3, 4, 5, 6, 7]);
    // Later passes start at quarter 8 and play 1 to 11 (quarter 0's note is
    // before the loop start), 11.75 quarters each.
    const second = played.slice(8, 19);
    assert.deepEqual(
      second.map((item) => item.pitch),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    );
    assert.deepEqual(
      starts(second),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((q) => 8 + q - 0.25),
    );
    assert.equal(played[19].pitch, 1);
    assert.equal(played[19].start, 8 + 11.75 + 0.75);
    // Nothing starts at or past the clip's end.
    assert.ok(played.every((item) => item.start < 30));
  });

  it("repeats Start to Length while the loop is off", () => {
    const timeline: MidiClipTimeline = {
      length: 4,
      start: 1,
      loopStart: 0,
      loopEnd: 4,
      loop: false,
    };
    const played = performMidiNotes(beats, timeline, 9);
    assert.deepEqual(
      played.map((item) => [item.start, item.pitch]),
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 1],
        [4, 2],
        [5, 3],
        [6, 1],
        [7, 2],
        [8, 3],
      ],
    );
  });

  it("cuts a note at the end of its pass and drops notes past it", () => {
    const played = performMidiNotes(
      [note(0, 1), note(1.5, 2), note(5)],
      newMidiTimeline(2),
      4,
    );
    assert.deepEqual(
      played.map((item) => [item.start, item.length]),
      [
        [0, 1],
        [1.5, 0.5],
        [2, 1],
        [3.5, 0.5],
      ],
    );
  });

  it("plays its notes once when the clip ends within its Length", () => {
    const notes = [note(0), note(3)];
    assert.deepEqual(performMidiNotes(notes, defaultMidiTimeline(4), 4), notes);
  });
});

describe("the timeline's markers", () => {
  const timeline = newMidiTimeline(8);

  it("starts a new clip looping all of its Length", () => {
    assert.deepEqual(timeline, {
      length: 8,
      start: 0,
      loopStart: 0,
      loopEnd: 8,
      loop: true,
    });
  });

  it("holds the loop and Start inside a shorter Length", () => {
    const moved = setMidiTimelineField({ ...timeline, start: 6 }, "length", 4);
    assert.deepEqual(moved, {
      length: 4,
      start: 3.75,
      loopStart: 0,
      loopEnd: 4,
      loop: true,
    });
  });

  it("lengthens the clip when the loop end moves past its Length", () => {
    assert.deepEqual(setMidiTimelineField(timeline, "loopEnd", 12), {
      ...timeline,
      length: 12,
      loopEnd: 12,
    });
    // The loop end stays past the loop start.
    const short = setMidiTimelineField(
      { ...timeline, loopStart: 4 },
      "loopEnd",
      2,
    );
    assert.equal(short.loopEnd, 4.25);
  });

  it("keeps Start before the end of the first pass", () => {
    const looped = { ...timeline, loopEnd: 4 };
    assert.equal(setMidiTimelineField(looped, "start", 6).start, 3.75);
    // With the loop off, Start may run to the Length.
    const unlooped = setMidiTimelineLoop(looped, false);
    assert.equal(setMidiTimelineField(unlooped, "start", 6).start, 6);
    // Turning the loop back on pulls Start inside it again.
    assert.equal(
      setMidiTimelineLoop({ ...unlooped, start: 6 }, true).start,
      3.75,
    );
  });

  it("moves the loop brace as a whole, from quarter 0 on", () => {
    const loop = { ...timeline, loopStart: 2, loopEnd: 4 };
    assert.deepEqual(moveMidiLoop(loop, -3), {
      ...loop,
      loopStart: 0,
      loopEnd: 2,
    });
    assert.deepEqual(moveMidiLoop(loop, 6), {
      ...loop,
      length: 10,
      loopStart: 8,
      loopEnd: 10,
    });
  });

  it("drags each handle onto the sixteenth grid", () => {
    assert.equal(dragMidiTimeline(timeline, "start", 1.1).start, 1);
    assert.equal(dragMidiTimeline(timeline, "loopStart", 0.4).loopStart, 0.5);
    assert.deepEqual(dragMidiTimeline(timeline, "loop", 1.1), {
      ...timeline,
      length: 9,
      loopStart: 1,
      loopEnd: 9,
    });
  });
});

describe("readMidiTimeline", () => {
  it("reads no timeline from a clip without one", () => {
    assert.equal(readMidiTimeline(undefined), undefined);
    assert.equal(readMidiTimeline({ start: 1 }), undefined);
    assert.equal(readMidiTimeline([]), undefined);
  });

  it("fills in what is missing and holds the rest together", () => {
    assert.deepEqual(readMidiTimeline({ length: 8 }), {
      length: 8,
      start: 0,
      loopStart: 0,
      loopEnd: 8,
      loop: false,
    });
    assert.deepEqual(
      readMidiTimeline({
        length: 4,
        start: 9,
        loopStart: -1,
        loopEnd: 6,
        loop: true,
      }),
      { length: 4, start: 3.75, loopStart: 0, loopEnd: 4, loop: true },
    );
  });
});
