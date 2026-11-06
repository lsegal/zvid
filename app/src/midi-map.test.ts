import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEffect, GLOBAL_EFFECT_TRACK_ID } from "./fx-stack.ts";
import type { KeyMapTarget } from "./key-map.ts";
import {
  assignMidiMapping,
  findMidiMapping,
  type MidiMapKey,
  type MidiMapping,
  midiMappingMatches,
  pruneMidiMappings,
  readMidiMappings,
  removeMidiMapping,
} from "./midi-map.ts";

const POWER: KeyMapTarget = { kind: "power", effectId: "a" };
const PAD: KeyMapTarget = {
  kind: "pad",
  effectId: "b",
  parameter: "rack",
  pad: 2,
};
const mapping = (
  note: number,
  channel = 1,
  target: KeyMapTarget = POWER,
): MidiMapping => ({
  note,
  channel,
  target,
});
const effect = (id: string) => ({
  ...createEffect(GLOBAL_EFFECT_TRACK_ID, "Gain", id),
  id,
});
// A single lower zone, as an MPE device assumes.
const key = (note: number, channel: number, isMpe = false): MidiMapKey => ({
  note,
  channel,
  isMpe,
  zoneOf: () => "lower",
});

describe("midiMappingMatches", () => {
  it("matches the note and channel", () => {
    assert.equal(midiMappingMatches(mapping(60, 1), key(60, 1)), true);
    assert.equal(midiMappingMatches(mapping(60, 1), key(61, 1)), false);
    assert.equal(midiMappingMatches(mapping(60, 1), key(60, 10)), false);
  });

  it("matches the note anywhere in the zone once a device plays MPE", () => {
    assert.equal(midiMappingMatches(mapping(60, 2), key(60, 9, true)), true);
    assert.equal(midiMappingMatches(mapping(60, 2), key(61, 9, true)), false);
    const lowerOrUpper = (channel: number) => (channel < 8 ? "lower" : "upper");
    assert.equal(
      midiMappingMatches(mapping(60, 2), {
        ...key(60, 9, true),
        zoneOf: lowerOrUpper,
      }),
      false,
    );
    assert.equal(
      midiMappingMatches(mapping(60, 2), {
        ...key(60, 9, true),
        zoneOf: () => undefined,
      }),
      false,
    );
  });

  it("matches in the zone from the first press when assigned from MPE", () => {
    const assigned = { ...mapping(60, 2), mpe: true as const };
    assert.equal(midiMappingMatches(assigned, key(60, 9)), true);
  });
});

describe("assigning and removing", () => {
  it("gives a button one key, and a key several buttons", () => {
    let mappings = assignMidiMapping(undefined, mapping(60));
    mappings = assignMidiMapping(mappings, mapping(62));
    assert.deepEqual(mappings, [mapping(62)]);
    mappings = assignMidiMapping(mappings, mapping(62, 1, PAD));
    assert.equal(mappings.length, 2);
    assert.equal(findMidiMapping(mappings, PAD)?.note, 62);
  });

  it("is unset once the last mapping goes", () => {
    const mappings = [mapping(60)];
    assert.equal(removeMidiMapping(mappings, PAD), mappings);
    assert.equal(removeMidiMapping(mappings, POWER), undefined);
  });
});

describe("pruneMidiMappings", () => {
  it("keeps the same array when every effect is still there", () => {
    const mappings = [mapping(60)];
    assert.equal(pruneMidiMappings(mappings, [effect("a")]), mappings);
    assert.equal(pruneMidiMappings(mappings, [effect("b")]), undefined);
  });
});

describe("readMidiMappings", () => {
  const effects = [effect("a"), effect("b")];

  it("reads saved mappings, and nothing from a session without them", () => {
    const mappings = [mapping(60, 3), { ...mapping(62, 1, PAD), mpe: true }];
    assert.deepEqual(readMidiMappings(mappings, effects), mappings);
    assert.equal(readMidiMappings(undefined, effects), undefined);
  });

  it("drops what it can't use", () => {
    assert.equal(
      readMidiMappings(
        [
          null,
          { note: 60, channel: 1 },
          mapping(128),
          mapping(60.5),
          mapping(60, 0),
          mapping(60, 17),
          mapping(60, 1, { kind: "power", effectId: "gone" }),
        ],
        effects,
      ),
      undefined,
    );
  });
});
