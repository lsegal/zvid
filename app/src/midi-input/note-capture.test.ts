import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultMidiTimeline } from "../midi-clip-timeline.ts";
import {
  CAPTURED_NOTE_MIN_LENGTH_Q,
  captureNote,
  pressNote,
} from "./note-capture.ts";

const CLIP = {
  startQ: 10,
  trimStartQ: 0,
  lengthQ: 8,
  timeline: defaultMidiTimeline(8),
};

function played(pressQ: number, releaseQ: number, clip = CLIP) {
  const held = pressNote(clip, 60, 90, pressQ);
  assert.ok(held);
  return captureNote(clip, held, releaseQ);
}

test("a note starts where its key went down and ends where it came up", () => {
  assert.deepEqual(played(11.5, 13), {
    pitch: 60,
    start: 1.5,
    length: 1.5,
    velocity: 90,
  });
});

test("a key pressed outside the clip writes no note", () => {
  assert.equal(pressNote(CLIP, 60, 90, 9.5), undefined);
  assert.equal(pressNote(CLIP, 60, 90, 18), undefined);
});

test("a held note stops at the clip's end", () => {
  assert.equal(played(16, 30).length, 2);
});

test("a held note stops at the end of the looped pass", () => {
  const clip = {
    ...CLIP,
    timeline: { ...CLIP.timeline, loop: true, loopStart: 0, loopEnd: 4 },
  };
  assert.deepEqual(played(13, 17, clip), {
    pitch: 60,
    start: 3,
    length: 1,
    velocity: 90,
  });
});

test("a press in a later loop pass lands on the note sounding", () => {
  const clip = {
    ...CLIP,
    timeline: { ...CLIP.timeline, loop: true, loopStart: 0, loopEnd: 4 },
  };
  assert.equal(played(15, 15.5, clip).start, 1);
});

test("the note starts through the clip's trim", () => {
  assert.equal(played(11, 12, { ...CLIP, trimStartQ: 2 }).start, 3);
});

test("the shortest tap still leaves a note", () => {
  assert.equal(played(11, 11).length, CAPTURED_NOTE_MIN_LENGTH_Q);
});
