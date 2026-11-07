import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  controlForMessage,
  expandControls,
  type MidiDeviceMapping,
  mappingProblems,
  matchDeviceMapping,
} from "./device-mappings.ts";

const DEVICES = JSON.parse(
  readFileSync(new URL("./midi-devices.json", import.meta.url), "utf8"),
) as MidiDeviceMapping[];

function mapping(id: string, ...portNames: string[]) {
  return { id, portNames } as MidiDeviceMapping;
}

test("expands a run of controls", () => {
  assert.deepEqual(
    expandControls([
      {
        name: "Knob {n}",
        kind: "knob",
        type: "cc",
        channel: 1,
        number: 21,
        count: 2,
      },
      { name: "Bend", kind: "wheel", type: "pitchbend", channel: 1 },
    ]),
    [
      { name: "Knob 1", kind: "knob", type: "cc", channel: 1, number: 21 },
      { name: "Knob 2", kind: "knob", type: "cc", channel: 1, number: 22 },
      { name: "Bend", kind: "wheel", type: "pitchbend", channel: 1 },
    ],
  );
});

test("matches port names whatever the OS does to them", () => {
  const known = [mapping("a", "launchkey mini mk3")];
  for (const name of [
    "Launchkey Mini MK3 MIDI",
    "2- Launchkey Mini MK3 MIDI 1",
    "LAUNCHKEY-MINI_MK3",
  ]) {
    assert.equal(matchDeviceMapping(name, known)?.id, "a");
  }
});

test("the most specific port name wins", () => {
  const known = [
    mapping("short", "launchkey 49"),
    mapping("long", "launchkey 49 mk3"),
  ];
  assert.equal(matchDeviceMapping("Launchkey 49 MK3", known)?.id, "long");
  assert.equal(matchDeviceMapping("Launchkey 49", known)?.id, "short");
});

test("fragments match whole words", () => {
  assert.equal(
    matchDeviceMapping("MicroKEY25", [mapping("a", "key25")]),
    undefined,
  );
});

test("an unrecognized device matches nothing", () => {
  assert.equal(
    matchDeviceMapping("Homemade Thing", [mapping("a", "launchkey")]),
    undefined,
  );
});

test("finds the control sending a message", () => {
  const device = {
    controls: [
      { name: "Bend", kind: "wheel", type: "pitchbend", channel: 1 },
      { name: "Knob", kind: "knob", type: "cc", channel: 2, number: 21 },
    ],
  } as MidiDeviceMapping;
  assert.equal(
    controlForMessage(device, { type: "pitchbend", channel: 1, value: 3 })
      ?.name,
    "Bend",
  );
  assert.equal(
    controlForMessage(device, {
      type: "cc",
      channel: 2,
      controller: 21,
      value: 3,
    })?.name,
    "Knob",
  );
  assert.equal(
    controlForMessage(device, {
      type: "cc",
      channel: 1,
      controller: 21,
      value: 3,
    }),
    undefined,
  );
});

test("the validator catches bad mappings", () => {
  const device = {
    id: "Bad Id",
    manufacturer: "",
    model: "",
    portNames: ["UPPER"],
    source: { url: "http://x", title: "", verification: "guess" },
    controls: [
      { name: "A", kind: "nope", type: "note", channel: 17, number: 200 },
      { name: "B", kind: "knob", type: "cc", channel: 1, number: 1, count: 2 },
      { name: "C", kind: "knob", type: "cc", channel: 1, number: 2 },
      { name: "D", kind: "wheel", type: "pitchbend", channel: 1, number: 2 },
      {
        name: "E",
        kind: "encoder",
        type: "cc",
        channel: 1,
        number: 9,
        relative: "sideways",
      },
    ],
  } as unknown as MidiDeviceMapping;
  const problems = mappingProblems(device).join("\n");
  for (const expected of [
    "kebab-case",
    "manufacturer",
    "lowercase",
    "https",
    "title",
    "verification",
    "unknown kind",
    "channel",
    "out of 0 to 127",
    "needs {n}",
    "another control sends",
    "only note and cc",
    "unknown relative format",
  ]) {
    assert.match(problems, new RegExp(expected.replace(/[{}]/g, "\\$&")));
  }
});

test("200 devices ship", () => {
  assert.equal(DEVICES.length, 200);
});

test("every shipped mapping is valid and sourced", () => {
  assert.deepEqual(DEVICES.flatMap(mappingProblems), []);
});

test("every estimated mapping says why no chart backs it", () => {
  for (const device of DEVICES) {
    if (device.source.verification === "inventory") {
      assert.match(device.source.note ?? "", /no .*chart/i, device.id);
    }
  }
});

test("shipped ids are unique, and each model's port names its own", () => {
  assert.equal(
    new Set(DEVICES.map((device) => device.id)).size,
    DEVICES.length,
  );
  for (const device of DEVICES) {
    for (const name of device.portNames) {
      assert.equal(
        matchDeviceMapping(name, DEVICES)?.id,
        device.id,
        `${device.id}'s "${name}" resolves to another device`,
      );
    }
  }
});

test("every shipped device has keys, pads or other controls with messages", () => {
  for (const device of DEVICES) {
    assert.ok(expandControls(device.controls).length, device.id);
  }
});
