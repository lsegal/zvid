import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEffect, GLOBAL_EFFECT_TRACK_ID } from "./fx-stack.ts";
import type { KeyMapTarget } from "./key-map.ts";
import {
  assignMidiMapping,
  findMidiMapping,
  learnMidiMappingsMpe,
  type MidiCcMapping,
  type MidiMapKey,
  type MidiNoteMapping,
  midiCcTargets,
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
): MidiNoteMapping => ({
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

describe("learning that a mapping is MPE", () => {
  const assigned = { ...mapping(60, 2), mpe: true as const };

  it("marks a mapping an MPE device plays, wherever in the zone", () => {
    const mappings = [mapping(60, 2), mapping(62, 2)];
    assert.deepEqual(learnMidiMappingsMpe(mappings, key(60, 9, true)), [
      assigned,
      mapping(62, 2),
    ]);
    assert.deepEqual(learnMidiMappingsMpe(mappings, key(60, 2, true)), [
      assigned,
      mapping(62, 2),
    ]);
  });

  it("leaves mappings as they are when there's nothing to learn", () => {
    const mappings = [mapping(60, 2), assigned];
    for (const pressed of [
      key(60, 2),
      key(62, 9, true),
      { ...key(60, 2, true), zoneOf: () => undefined },
    ]) {
      assert.equal(learnMidiMappingsMpe(mappings, pressed), mappings);
    }
    const known = [assigned];
    assert.equal(learnMidiMappingsMpe(known, key(60, 9, true)), known);
    assert.equal(learnMidiMappingsMpe(undefined, key(60, 9, true)), undefined);
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

const CUTOFF = { kind: "number", effectId: "a", parameter: "cutoff" } as const;
const ccMapping = (
  controller: number,
  channel = 1,
  target: MidiCcMapping["target"] = CUTOFF,
): MidiCcMapping => ({ controller, channel, target });

describe("CC mappings", () => {
  it("are found by channel and controller, several knobs to one control", () => {
    const other = { ...CUTOFF, parameter: "drive" };
    const mappings = [ccMapping(74), ccMapping(74, 1, other), ccMapping(75)];
    assert.deepEqual(midiCcTargets(mappings, 1, 74), [CUTOFF, other]);
    assert.deepEqual(midiCcTargets(mappings, 2, 74), []);
    assert.deepEqual(midiCcTargets(undefined, 1, 74), []);
  });

  it("replace what their knob had, and keep apart from notes", () => {
    const note = mapping(74);
    const assigned = assignMidiMapping([note, ccMapping(74)], ccMapping(10));
    assert.deepEqual(assigned, [note, ccMapping(10)]);
    assert.equal(midiMappingMatches(ccMapping(74), key(74, 1)), false);
    assert.deepEqual(midiCcTargets([note], 1, 74), []);
    assert.equal(removeMidiMapping([ccMapping(74)], CUTOFF), undefined);
  });

  it("go away with their effect", () => {
    assert.equal(pruneMidiMappings([ccMapping(74)], []), undefined);
  });

  it("survive being read back from a session", () => {
    const effect = createEffect(GLOBAL_EFFECT_TRACK_ID, "Delay");
    const saved = ccMapping(74, 3, { ...CUTOFF, effectId: effect.id });
    assert.deepEqual(
      readMidiMappings(JSON.parse(JSON.stringify([saved])), [effect]),
      [saved],
    );
  });

  it("are dropped from a session when unusable", () => {
    const effect = createEffect(GLOBAL_EFFECT_TRACK_ID, "Delay");
    const target = { ...CUTOFF, effectId: effect.id };
    for (const raw of [
      { controller: 128, channel: 1, target },
      { controller: 74, channel: 0, target },
      { controller: 74.5, channel: 1, target },
      { note: 60, channel: 1, target },
      {
        controller: 74,
        channel: 1,
        target: { kind: "power", effectId: effect.id },
      },
      { controller: 74, channel: 1, target: { ...target, parameter: 1 } },
    ]) {
      assert.equal(readMidiMappings([raw], [effect]), undefined);
    }
  });
});
