import assert from "node:assert/strict";
import { test } from "node:test";
import { type MidiNote, readMidiNotes } from "../midi-clip.ts";
import type { RecordQuantize } from "./midi-quantize.ts";
import { MidiTake } from "./midi-take.ts";

function makeTake(startQ: number, quantize: RecordQuantize = "off") {
  const clock = { playheadQ: startQ };
  const take = new MidiTake({
    startQ,
    input: "device",
    quantize,
    playheadQ: () => clock.playheadQ,
    bpm: () => 120,
  });
  return { clock, take };
}

const note = (start: number, length = 0.5, pitch = 60): MidiNote => ({
  pitch,
  start,
  length,
  velocity: 100,
});

test("the clip starts at the playhead with quantize off", () => {
  assert.equal(makeTake(3.1).take.clipStartQ, 3.1);
});

test("the clip starts on the grid, so every note can land on it", () => {
  const { take } = makeTake(3.1, "1/4");
  assert.equal(take.clipStartQ, 3);
  take.addNote(note(0.05));
  assert.equal(take.finish().notes[0]?.start, 0);
});

for (const quantize of ["off", "1/8"] as const) {
  test(`a take keeps played velocities through a save with quantize ${quantize}`, () => {
    const { take } = makeTake(0, quantize);
    const velocities = [1, 30, 80, 127];
    velocities.forEach((velocity, index) => {
      take.addNote({ ...note(index), velocity });
    });
    const saved = JSON.parse(JSON.stringify(take.finish().notes));
    assert.deepEqual(
      readMidiNotes(saved)?.map((played) => played.velocity),
      velocities,
    );
  });
}

test("notes snap to the timeline's grid and keep their length", () => {
  const { take } = makeTake(1, "1/8");
  take.addNote(note(0.3, 0.2));
  const [recorded] = take.finish().notes;
  assert.equal(recorded?.start, 0.5);
  assert.equal(recorded?.length, 0.2);
});

test("triplet grids land on their triplet lines", () => {
  const { take } = makeTake(0, "1/8T");
  take.addNote(note(0.7));
  const start = take.finish().notes[0]?.start ?? 0;
  assert.ok(Math.abs(start - 2 / 3) < 1e-9);
});

test("a held note shows from its snapped start up to the playhead", () => {
  const { clock, take } = makeTake(0, "1/4");
  take.setHeld([{ pitch: 64, velocity: 90, startQ: 1.2, pressedAtQ: 1.2 }]);
  clock.playheadQ = 2.2;
  const [shown] = take.shownNotes();
  assert.equal(shown?.start, 1);
  assert.equal(shown?.pitch, 64);
  assert.ok(Math.abs((shown?.length ?? 0) - 1) < 1e-9);
});

test("listeners hear about each note, and held keys", () => {
  const { take } = makeTake(0);
  let heard = 0;
  const stop = take.subscribe(() => {
    heard += 1;
  });
  const before = take.getVersion();
  take.addNote(note(0));
  take.setHeld([]);
  assert.equal(heard, 2);
  assert.notEqual(take.getVersion(), before);
  stop();
});

test("notes landing on the same spot of a pitch overwrite each other", () => {
  const { take } = makeTake(0, "1/4");
  take.addNote(note(0.9, 0.1));
  take.addNote(note(1.1, 0.5));
  const { notes } = take.finish();
  assert.equal(notes.length, 1);
  assert.equal(notes[0]?.length, 0.5);
});

test("the clip grows with the playhead, never shrinking", () => {
  const { clock, take } = makeTake(2);
  clock.playheadQ = 4;
  assert.equal(take.elapsedSeconds(), 1);
  clock.playheadQ = 0;
  assert.equal(take.elapsedSeconds(), 1);
  assert.equal(take.finish().durationQ, 2);
});

test("finishing ends the keys still down first", () => {
  const { take } = makeTake(0);
  take.setFlushHeld(() => take.addNote(note(0, 1)));
  const { notes, durationQ } = take.finish();
  assert.equal(notes.length, 1);
  assert.equal(durationQ, 1);
});
