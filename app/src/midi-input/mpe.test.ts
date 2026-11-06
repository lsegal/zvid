import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type MidiMessage, parseMidiMessage } from "./messages.ts";
import { createMpeInput, type MpeInput, mpeInputFor } from "./mpe.ts";

// Sends raw bytes through the parser, as the hub does.
function send(input: MpeInput, ...bytes: number[]) {
  input.receive(parseMidiMessage(bytes) as MidiMessage);
}

function bend(input: MpeInput, channel: number, value: number) {
  send(input, 0xe0 | (channel - 1), value & 0x7f, value >> 7);
}

function pressure(input: MpeInput, channel: number, value: number) {
  send(input, 0xd0 | (channel - 1), value);
}

function cc(input: MpeInput, channel: number, number: number, value: number) {
  send(input, 0xb0 | (channel - 1), number, value);
}

// The MPE Configuration Message: RPN 6 on a manager channel.
function configure(input: MpeInput, manager: number, members: number) {
  cc(input, manager, 101, 0);
  cc(input, manager, 100, 6);
  cc(input, manager, 6, members);
}

function setBendRange(
  input: MpeInput,
  channel: number,
  semitones: number,
  cents = 0,
) {
  cc(input, channel, 101, 0);
  cc(input, channel, 100, 0);
  cc(input, channel, 6, semitones);
  if (cents) {
    cc(input, channel, 38, cents);
  }
}

const BEND_UP = 16383;
const BEND_DOWN = 0;
const BEND_CENTER = 8192;

function configured(manager = 1, members = 15) {
  const input = createMpeInput();
  configure(input, manager, members);
  return input;
}

describe("the MPE input's per-note dimensions", () => {
  it("attributes a bend to its channel's note alone", () => {
    const input = configured();
    input.pressed(2, 60);
    input.pressed(3, 64);
    bend(input, 2, BEND_UP);
    bend(input, 3, BEND_DOWN);
    assert.equal(input.sampleOf(2)?.bend, 48);
    assert.equal(input.sampleOf(3)?.bend, -48);
  });

  it("attributes pressure and CC 74 to their channel's note", () => {
    const input = configured();
    input.pressed(2, 60);
    input.pressed(3, 64);
    pressure(input, 2, 127);
    cc(input, 3, 74, 127);
    assert.deepEqual(input.sampleOf(2), { bend: 0, pressure: 1 });
    assert.deepEqual(input.sampleOf(3), { bend: 0, timbre: 1 });
  });

  it("gives a note what its channel sent just before it", () => {
    const input = configured();
    cc(input, 2, 74, 127);
    pressure(input, 2, 127);
    bend(input, 2, BEND_UP);
    input.pressed(2, 60);
    assert.deepEqual(input.sampleOf(2), { bend: 48, pressure: 1, timbre: 1 });
  });

  it("starts the next note on a channel from nothing", () => {
    const input = configured();
    input.pressed(2, 60);
    bend(input, 2, BEND_UP);
    pressure(input, 2, 100);
    input.released(2, 60);
    assert.deepEqual(input.sampleOf(2), { bend: 0 });
  });

  it("keeps a channel's expression while another of its notes is held", () => {
    const input = configured();
    input.pressed(2, 60);
    input.pressed(2, 64);
    bend(input, 2, BEND_UP);
    input.released(2, 60);
    assert.equal(input.sampleOf(2)?.bend, 48);
  });
});

describe("the MPE input's manager channel", () => {
  it("bends every note in the zone, on top of its own bend", () => {
    const input = configured();
    input.pressed(2, 60);
    input.pressed(3, 64);
    bend(input, 2, BEND_UP);
    bend(input, 1, BEND_UP);
    assert.equal(input.sampleOf(2)?.bend, 50);
    assert.equal(input.sampleOf(3)?.bend, 2);
  });

  it("sets every note's pressure and timbre until a note speaks again", () => {
    const input = configured();
    input.pressed(2, 60);
    input.pressed(3, 64);
    pressure(input, 2, 10);
    pressure(input, 1, 127);
    cc(input, 1, 74, 0);
    assert.deepEqual(input.sampleOf(2), { bend: 0, pressure: 1, timbre: 0 });
    assert.deepEqual(input.sampleOf(3), { bend: 0, pressure: 1, timbre: 0 });
    pressure(input, 3, 0);
    assert.equal(input.sampleOf(3)?.pressure, 0);
    assert.equal(input.sampleOf(2)?.pressure, 1);
  });

  it("speaks only to its own zone", () => {
    const input = configured(1, 7);
    configure(input, 16, 7);
    input.pressed(2, 60);
    input.pressed(15, 64);
    bend(input, 16, BEND_UP);
    assert.equal(input.sampleOf(2)?.bend, 0);
    assert.equal(input.sampleOf(15)?.bend, 2);
  });
});

describe("the MPE input's zones", () => {
  it("reads an upper zone, whose members count down from its manager", () => {
    const input = configured(16, 3);
    assert.equal(input.isActive(), true);
    input.pressed(15, 60);
    input.pressed(13, 64);
    bend(input, 15, BEND_UP);
    bend(input, 13, BEND_DOWN);
    assert.equal(input.sampleOf(15)?.bend, 48);
    assert.equal(input.sampleOf(13)?.bend, -48);
    assert.equal(input.sampleOf(12), undefined);
    assert.equal(input.sampleOf(2), undefined);
  });

  it("leaves channels outside a zone alone", () => {
    const input = configured(1, 3);
    bend(input, 5, BEND_UP);
    assert.equal(input.sampleOf(5), undefined);
    assert.ok(input.sampleOf(4));
  });

  it("lets a new zone take the channels it overlaps", () => {
    const input = configured(1, 15);
    configure(input, 16, 5);
    assert.ok(input.sampleOf(11));
    assert.equal(input.sampleOf(9)?.bend, 0);
    assert.equal(input.sampleOf(10)?.bend, 0);
    // 11 and up belong to the upper zone, so the lower keeps 2 to 10.
    input.pressed(11, 60);
    bend(input, 16, BEND_UP);
    assert.equal(input.sampleOf(11)?.bend, 2);
    assert.equal(input.sampleOf(9)?.bend, 0);
  });

  it("removes a zone a new one leaves no channels", () => {
    const input = configured(16, 5);
    configure(input, 1, 15);
    // Channel 16 is one of the lower zone's members now, not a manager.
    bend(input, 16, BEND_UP);
    assert.equal(input.sampleOf(15)?.bend, 0);
    assert.equal(input.sampleOf(16)?.bend, 48);
  });

  it("turns a zone off with no members", () => {
    const input = configured();
    configure(input, 1, 0);
    assert.equal(input.isActive(), false);
    assert.equal(input.sampleOf(2), undefined);
  });
});

describe("the MPE input's pitch bend range", () => {
  it("defaults to the specification's, on members and manager alike", () => {
    const input = configured();
    bend(input, 2, BEND_UP);
    bend(input, 1, BEND_DOWN);
    assert.equal(input.sampleOf(2)?.bend, 46);
  });

  it("honors the range a member channel sets, for every member", () => {
    const input = configured();
    setBendRange(input, 2, 24);
    bend(input, 3, BEND_UP);
    assert.equal(input.sampleOf(3)?.bend, 24);
  });

  it("honors the range the manager sets, for the manager's bend", () => {
    const input = configured();
    setBendRange(input, 1, 12);
    bend(input, 1, BEND_UP);
    bend(input, 2, BEND_CENTER);
    assert.equal(input.sampleOf(2)?.bend, 12);
  });

  it("reads a range's cents", () => {
    const input = configured();
    setBendRange(input, 2, 2, 50);
    bend(input, 2, BEND_UP);
    assert.equal(input.sampleOf(2)?.bend, 2.5);
  });

  it("goes back to the defaults on a new configuration", () => {
    const input = configured();
    setBendRange(input, 2, 24);
    configure(input, 1, 15);
    bend(input, 2, BEND_UP);
    assert.equal(input.sampleOf(2)?.bend, 48);
  });

  it("ignores data for an RPN nothing selected, or a null one", () => {
    const input = configured();
    cc(input, 2, 6, 24);
    bend(input, 2, BEND_UP);
    assert.equal(input.sampleOf(2)?.bend, 48);
    cc(input, 2, 101, 127);
    cc(input, 2, 100, 127);
    cc(input, 2, 6, 24);
    assert.equal(input.sampleOf(2)?.bend, 48);
  });
});

describe("telling MPE devices from others", () => {
  it("doesn't count a keyboard on one channel", () => {
    const input = createMpeInput();
    input.pressed(1, 60);
    input.pressed(1, 64);
    bend(input, 1, BEND_UP);
    assert.equal(input.isActive(), false);
  });

  it("doesn't count a keyboard on the first channel with pads on the tenth", () => {
    const input = createMpeInput();
    input.pressed(1, 60);
    input.pressed(10, 36);
    assert.equal(input.isActive(), false);
  });

  it("counts a device with no configuration once it plays two member channels", () => {
    const input = createMpeInput();
    input.pressed(2, 60);
    assert.equal(input.isActive(), false);
    input.pressed(3, 64);
    assert.equal(input.isActive(), true);
    bend(input, 2, BEND_UP);
    assert.equal(input.sampleOf(2)?.bend, 48);
    assert.equal(input.sampleOf(3)?.bend, 0);
  });

  it("forgets held notes when a device goes away but keeps its zones", () => {
    const input = configured(16, 3);
    input.pressed(15, 60);
    bend(input, 15, BEND_UP);
    pressure(input, 16, 127);
    input.releaseAll();
    assert.deepEqual(input.sampleOf(15), { bend: 0 });
    assert.equal(input.sampleOf(2), undefined);
    assert.equal(input.isActive(), true);
  });
});

describe("mpeInputFor", () => {
  it("keeps one input per device of a hub", () => {
    const hub = {};
    assert.equal(mpeInputFor(hub, "a"), mpeInputFor(hub, "a"));
    assert.notEqual(mpeInputFor(hub, "a"), mpeInputFor(hub, "b"));
    assert.notEqual(mpeInputFor(hub, "a"), mpeInputFor({}, "a"));
  });
});

describe("zoneNameOf", () => {
  it("names the assumed zone before a device configures any", () => {
    const input = createMpeInput();
    assert.equal(input.zoneNameOf(2), "lower");
    assert.equal(input.zoneNameOf(16), "lower");
  });

  it("names the zones a device configures, and nothing outside them", () => {
    const input = configured(1, 4);
    configure(input, 16, 3);
    assert.equal(input.zoneNameOf(3), "lower");
    assert.equal(input.zoneNameOf(14), "upper");
    assert.equal(input.zoneNameOf(8), undefined);
  });
});
