import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MidiNote } from "../midi-clip.ts";
import {
  CHOKE_FADE_SECONDS,
  DRUM_VOICE_LEVEL,
  drumHits,
  mixDrumHits,
} from "./drum-rack.ts";

const note = (
  pitch: number,
  start: number,
  velocity = 127,
  length = 0.25,
): MidiNote => ({ pitch, start, length, velocity });

describe("drumHits", () => {
  it("plays each note on a pad at its start, its velocity setting its level", () => {
    // At 120 bpm a quarter note lasts half a second.
    const hits = drumHits([note(38, 1, 64), note(36, 0)], 120);
    assert.deepEqual(hits, [
      { pad: 0, startSeconds: 0, level: DRUM_VOICE_LEVEL },
      { pad: 2, startSeconds: 0.5, level: (DRUM_VOICE_LEVEL * 64) / 127 },
    ]);
  });

  it("leaves out notes off the pads and ones starting at the clip's end", () => {
    const hits = drumHits(
      [note(35, 0), note(52, 0), note(60, 0), note(36, 2), note(37, 1.5)],
      60,
      2,
    );
    assert.deepEqual(
      hits.map((hit) => hit.pad),
      [1],
    );
  });

  it("plays a one-shot whatever the note's length", () => {
    const [short] = drumHits([note(36, 0, 127, 0.01)], 120);
    const [long] = drumHits([note(36, 0, 127, 8)], 120);
    assert.deepEqual(short, long);
  });

  it("cuts a ringing open hat off with the next closed or pedal hat", () => {
    // Pads 7, 9 and 11 are the closed, pedal and open hats (42, 44, 46).
    const hits = drumHits(
      [note(46, 0), note(36, 0.5), note(42, 1), note(46, 2), note(44, 3)],
      60,
    );
    const choke = (start: number) =>
      hits.find((hit) => hit.startSeconds === start && hit.pad !== 0)
        ?.chokeSeconds;
    assert.equal(choke(0), 1);
    assert.equal(choke(1), 2);
    assert.equal(choke(2), 3);
    assert.equal(choke(3), undefined);
    assert.equal(hits.find((hit) => hit.pad === 0)?.chokeSeconds, undefined);
  });
});

describe("mixDrumHits", () => {
  const RATE = 1000;
  const ones = (length: number) => new Float32Array(length).fill(1);

  it("adds each pad's sample at its hit, scaled by its level", () => {
    const samples = [ones(3), undefined, Float32Array.of(0.5, -0.5)];
    const mixed = mixDrumHits(
      [
        { pad: 0, startSeconds: 0.002, level: 0.5 },
        { pad: 2, startSeconds: 0.003, level: 1 },
        // No sample: silent.
        { pad: 1, startSeconds: 0, level: 1 },
      ],
      samples,
      RATE,
      8,
    );
    assert.deepEqual(Array.from(mixed), [0, 0, 0.5, 1, 0, 0, 0, 0]);
  });

  it("stops at the clip's end", () => {
    const mixed = mixDrumHits(
      [{ pad: 0, startSeconds: 0.003, level: 1 }],
      [ones(10)],
      RATE,
      5,
    );
    assert.deepEqual(Array.from(mixed), [0, 0, 0, 1, 1]);
  });

  it("fades a choked hit out instead of cutting it", () => {
    const fade = Math.round(CHOKE_FADE_SECONDS * 4000);
    const mixed = mixDrumHits(
      [{ pad: 0, startSeconds: 0, level: 1, chokeSeconds: 0.002 }],
      [ones(100)],
      4000,
      100,
    );
    const choke = 8;
    assert.equal(mixed[choke - 1], 1);
    assert.equal(mixed[choke], 1);
    assert.ok(mixed[choke + 1] < 1 && mixed[choke + 1] > 0);
    assert.equal(mixed[choke + fade], 0);
    assert.ok(mixed.slice(choke + fade).every((sample) => sample === 0));
  });
});
