import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PIANO_ROLL_HIGH_PITCH,
  PIANO_ROLL_LOW_PITCH,
} from "../midi-piano-roll.ts";
import type { MidiDeviceMapping } from "./device-mappings.ts";
import { midiKeyEvent, standardKeyEvent } from "./keyboard-layout.ts";

const NOTE_ON = { type: "note-on", channel: 1, velocity: 90 } as const;

const MAPPING: MidiDeviceMapping = {
  id: "test-device",
  manufacturer: "Test",
  model: "Device",
  portNames: ["test device"],
  source: {
    url: "https://example.com",
    title: "Test",
    verification: "documented",
  },
  controls: [
    {
      name: "Key {n}",
      kind: "key",
      type: "note",
      channel: 1,
      number: 48,
      count: 25,
    },
    {
      name: "Pad {n}",
      kind: "pad",
      type: "note",
      channel: 10,
      number: 36,
      count: 8,
    },
    { name: "Stop", kind: "button", type: "note", channel: 1, number: 93 },
    { name: "Knob", kind: "knob", type: "cc", channel: 1, number: 21 },
  ],
};

test("the note number is the pitch and the velocity the note's", () => {
  assert.deepEqual(standardKeyEvent({ ...NOTE_ON, note: 60 }), {
    down: true,
    channel: 1,
    pitch: 60,
    velocity: 90,
  });
  assert.deepEqual(
    standardKeyEvent({ type: "note-off", channel: 2, note: 60 }),
    { down: false, channel: 2, pitch: 60 },
  );
});

test("notes outside the roll's keys are ignored, not clamped", () => {
  const event = (note: number) => standardKeyEvent({ ...NOTE_ON, note });
  assert.equal(event(PIANO_ROLL_LOW_PITCH - 1), undefined);
  assert.equal(event(PIANO_ROLL_HIGH_PITCH + 1), undefined);
  assert.equal(event(PIANO_ROLL_LOW_PITCH)?.pitch, PIANO_ROLL_LOW_PITCH);
  assert.equal(event(PIANO_ROLL_HIGH_PITCH)?.pitch, PIANO_ROLL_HIGH_PITCH);
});

test("controllers and the like are not keys", () => {
  assert.equal(
    standardKeyEvent({ type: "cc", channel: 1, controller: 1, value: 3 }),
    undefined,
  );
});

test("a mapped device's keys and pads act", () => {
  assert.equal(midiKeyEvent({ ...NOTE_ON, note: 50 }, MAPPING)?.pitch, 50);
  assert.equal(
    midiKeyEvent({ ...NOTE_ON, channel: 10, note: 36 }, MAPPING)?.pitch,
    36,
  );
});

test("a mapped device's other controls are recognized and ignored", () => {
  assert.equal(midiKeyEvent({ ...NOTE_ON, note: 93 }, MAPPING), undefined);
  assert.equal(
    midiKeyEvent({ type: "note-off", channel: 1, note: 93 }, MAPPING),
    undefined,
  );
  assert.equal(
    midiKeyEvent({ type: "cc", channel: 1, controller: 21, value: 9 }, MAPPING),
    undefined,
  );
});

test("a note the mapping doesn't list plays through the standard layout", () => {
  assert.equal(
    midiKeyEvent({ ...NOTE_ON, channel: 5, note: 93 }, MAPPING)?.pitch,
    93,
  );
  assert.equal(midiKeyEvent({ ...NOTE_ON, note: 93 }, undefined)?.pitch, 93);
});
