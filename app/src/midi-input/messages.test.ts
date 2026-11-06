import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMidiMessage } from "./messages.ts";

test("parses Note On and Note Off with their channels", () => {
  assert.deepEqual(parseMidiMessage([0x90, 60, 100]), {
    type: "note-on",
    channel: 1,
    note: 60,
    velocity: 100,
  });
  assert.deepEqual(parseMidiMessage([0x8f, 61, 64]), {
    type: "note-off",
    channel: 16,
    note: 61,
  });
});

test("reads a Note On at velocity 0 as a Note Off", () => {
  assert.deepEqual(parseMidiMessage([0x93, 60, 0]), {
    type: "note-off",
    channel: 4,
    note: 60,
  });
});

test("parses the other channel messages", () => {
  assert.deepEqual(parseMidiMessage([0xb1, 74, 12]), {
    type: "cc",
    channel: 2,
    controller: 74,
    value: 12,
  });
  assert.deepEqual(parseMidiMessage([0xe0, 0x01, 0x40]), {
    type: "pitchbend",
    channel: 1,
    value: 8193,
  });
  assert.deepEqual(parseMidiMessage([0xd2, 90]), {
    type: "pressure",
    channel: 3,
    value: 90,
  });
  assert.deepEqual(parseMidiMessage([0xc0, 5]), {
    type: "program",
    channel: 1,
    value: 5,
  });
});

test("ignores System messages and truncated ones", () => {
  for (const data of [[0xf8], [0xfe], [0xf0, 1, 2, 0xf7], [0x90, 60], []]) {
    assert.equal(parseMidiMessage(data), undefined);
  }
});
