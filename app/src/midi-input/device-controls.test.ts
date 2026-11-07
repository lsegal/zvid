import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ccMove,
  deviceControlAction,
  deviceControlRoles,
} from "./device-controls.ts";
import type { MidiDeviceMapping } from "./device-mappings.ts";

const DEVICES = JSON.parse(
  readFileSync(new URL("./midi-devices.json", import.meta.url), "utf8"),
) as MidiDeviceMapping[];

const device = (id: string) =>
  DEVICES.find((candidate) => candidate.id === id) as MidiDeviceMapping;

function rolesNamed(id: string, kind: string) {
  return deviceControlRoles(device(id))
    .filter(({ role }) => role.kind === kind)
    .map(({ control }) => control.name);
}

test("knobs are the effect's knobs in order, and the master fader the volume", () => {
  const launchkey = device("novation-launchkey-49-mk3");
  const knobs = rolesNamed("novation-launchkey-49-mk3", "fx-knob");
  assert.equal(knobs.length, 8);
  const roles = deviceControlRoles(launchkey);
  assert.deepEqual(
    roles.filter(({ role }) => role.kind === "fx-knob").map(({ role }) => role),
    knobs.map((_, index) => ({ kind: "fx-knob", index })),
  );
  assert.equal(
    rolesNamed("novation-launchkey-49-mk3", "track-volume").length,
    8,
  );
  assert.deepEqual(rolesNamed("novation-launchkey-49-mk3", "master-volume"), [
    "Master Fader",
  ]);
});

test("a control named for volume is the volume, not a knob", () => {
  assert.deepEqual(rolesNamed("m-audio-keystation-49-mk3", "master-volume"), [
    "Volume Fader",
  ]);
  assert.deepEqual(rolesNamed("m-audio-keystation-mini-32-mk3", "fx-knob"), []);
  assert.deepEqual(rolesNamed("akai-fire", "master-volume"), ["Volume"]);
});

test("a lone fader is the volume, and the ninth of nine the master", () => {
  assert.deepEqual(rolesNamed("m-audio-hammer-88", "master-volume"), [
    "Slider",
  ]);
  assert.equal(rolesNamed("arturia-keylab-49-mk3", "track-volume").length, 8);
  assert.equal(rolesNamed("arturia-keylab-49-mk3", "master-volume").length, 1);
  assert.equal(rolesNamed("korg-nanokontrol2", "track-volume").length, 8);
  assert.deepEqual(rolesNamed("korg-nanokontrol2", "master-volume"), []);
});

test("keys, wheels, pedals, buttons and touches take no role", () => {
  for (const mapping of DEVICES) {
    for (const { control } of deviceControlRoles(mapping)) {
      assert.ok(
        ["knob", "encoder", "fader"].includes(control.kind),
        `${mapping.id}: ${control.name}`,
      );
      assert.ok(
        control.type === "cc" || control.type === "pitchbend",
        `${mapping.id}: ${control.name}`,
      );
      assert.ok(
        !/touch$/i.test(control.name),
        `${mapping.id}: ${control.name}`,
      );
    }
  }
});

test("every device's roles number its knobs and tracks from the first", () => {
  for (const mapping of DEVICES) {
    const roles = deviceControlRoles(mapping).map(({ role }) => role);
    for (const kind of ["fx-knob", "track-volume"]) {
      const indexes = roles.flatMap((role) =>
        role.kind === kind && "index" in role ? [role.index] : [],
      );
      assert.deepEqual(
        indexes,
        indexes.map((_, index) => index),
        mapping.id,
      );
    }
  }
});

test("reads where a CC control and a pitch bend fader are", () => {
  const mapping = {
    controls: [
      {
        name: "Knob {n}",
        kind: "knob",
        type: "cc",
        channel: 1,
        number: 21,
        count: 2,
      },
      { name: "Master fader", kind: "fader", type: "pitchbend", channel: 9 },
    ],
  } as MidiDeviceMapping;
  assert.deepEqual(
    deviceControlAction(mapping, {
      type: "cc",
      channel: 1,
      controller: 22,
      value: 127,
    }),
    { role: { kind: "fx-knob", index: 1 }, move: { to: 1 } },
  );
  assert.deepEqual(
    deviceControlAction(mapping, { type: "pitchbend", channel: 9, value: 0 }),
    { role: { kind: "master-volume" }, move: { to: 0 } },
  );
});

test("a message no control with a role sends does nothing", () => {
  const launchkey = device("novation-launchkey-49-mk3");
  assert.equal(
    deviceControlAction(launchkey, {
      type: "cc",
      channel: 16,
      controller: 1,
      value: 9,
    }),
    undefined,
  );
  assert.equal(
    deviceControlAction(launchkey, {
      type: "note-on",
      channel: 1,
      note: 60,
      velocity: 9,
    }),
    undefined,
  );
});

// What a device's control named `name` does when it sends `value`.
function turn(id: string, name: string, value: number) {
  const mapping = device(id);
  const { control } = deviceControlRoles(mapping).find(
    ({ control }) => control.name === name,
  ) as ReturnType<typeof deviceControlRoles>[number];
  return deviceControlAction(mapping, {
    type: "cc",
    channel: control.channel,
    controller: control.number as number,
    value,
  })?.move;
}

test("reads how far a two's complement encoder turned", () => {
  for (const [id, name] of [
    ["ableton-push-2", "Track1 Encoder"],
    ["ableton-push-1", "Track encoder 1"],
    ["akai-fire", "Filter"],
    ["akai-apc-key-25-mk2", "Knob 1"],
  ]) {
    assert.deepEqual(turn(id, name, 1), { by: 1 / 127 }, id);
    assert.deepEqual(turn(id, name, 127), { by: -1 / 127 }, id);
    assert.deepEqual(turn(id, name, 124), { by: -4 / 127 }, id);
  }
});

test("reads how far a sign-and-magnitude encoder turned", () => {
  for (const [id, name] of [
    ["behringer-x-touch", "Encoder 1"],
    ["behringer-x-touch", "Encoder 8"],
    ["behringer-x-touch-one", "Encoder"],
  ]) {
    assert.deepEqual(turn(id, name, 1), { by: 1 / 127 }, id);
    assert.deepEqual(turn(id, name, 65), { by: -1 / 127 }, id);
    assert.deepEqual(turn(id, name, 68), { by: -4 / 127 }, id);
    assert.equal(turn(id, name, 64)?.by, 0, id);
  }
});

test("an encoder with no format still reads as a place", () => {
  assert.deepEqual(turn("behringer-x-touch-mini", "Encoder 1", 65), {
    to: 65 / 127,
  });
});

test("the data records each relative encoder's format", () => {
  const formats = (id: string) =>
    new Set(device(id).controls.flatMap(({ relative }) => relative ?? []));
  assert.deepEqual([...formats("behringer-x-touch")], ["sign-magnitude"]);
  assert.deepEqual([...formats("presonus-faderport-2018")], ["sign-magnitude"]);
  assert.deepEqual([...formats("ableton-push-2")], ["twos-complement"]);
});

test("a CC mapped by hand is relative only where its device says so", () => {
  const push = device("ableton-push-2");
  const { control } = deviceControlRoles(push).find(
    ({ control }) => control.name === "Track1 Encoder",
  ) as ReturnType<typeof deviceControlRoles>[number];
  const message = {
    type: "cc" as const,
    channel: control.channel,
    controller: control.number as number,
    value: 127,
  };
  assert.deepEqual(ccMove(push, message), { by: -1 / 127 });
  assert.deepEqual(ccMove(undefined, message), { to: 1 });
  assert.deepEqual(
    ccMove(device("novation-launchkey-49-mk3"), { ...message, controller: 21 }),
    { to: 1 },
  );
});
