import assert from "node:assert/strict";
import { test } from "node:test";
import type { MidiDeviceMapping } from "./device-mappings.ts";
import {
  createMidiInputHub,
  type MidiAccessLike,
  type MidiInputInfo,
  type MidiInputPort,
} from "./input-hub.ts";
import type { MidiMessage } from "./messages.ts";

const MAPPINGS = [
  { id: "known", portNames: ["known device"], controls: [] },
] as unknown as MidiDeviceMapping[];

function port(id: string, name: string): MidiInputPort {
  return { id, name, state: "connected", onmidimessage: null };
}

function fakeAccess(...ports: MidiInputPort[]) {
  const inputs = new Map(ports.map((input) => [input.id, input]));
  const access: MidiAccessLike = { inputs, onstatechange: null };
  return { access, inputs };
}

async function listen(hub: ReturnType<typeof createMidiInputHub>) {
  const messages: [string, MidiMessage][] = [];
  const disconnected: string[] = [];
  const stop = hub.listen({
    message: (input: MidiInputInfo, message) =>
      messages.push([input.id, message]),
    disconnected: (input) => disconnected.push(input.id),
  });
  await new Promise((resolve) => setTimeout(resolve));
  return { messages, disconnected, stop };
}

function send(input: MidiInputPort, ...bytes: number[]) {
  input.onmidimessage?.({ data: new Uint8Array(bytes) });
}

test("reads a connected input and matches it to its mapping", async () => {
  const input = port("a", "Known Device MIDI 1");
  const hub = createMidiInputHub({
    requestAccess: async () => fakeAccess(input).access,
    loadMappings: async () => MAPPINGS,
  });
  const { messages } = await listen(hub);
  send(input, 0x90, 60, 100);
  assert.deepEqual(messages, [
    ["a", { type: "note-on", channel: 1, note: 60, velocity: 100 }],
  ]);
  assert.equal(hub.getInputs()[0].mapping?.id, "known");
});

test("an unrecognized device has no mapping but still plays", async () => {
  const input = port("a", "Homemade Thing");
  const hub = createMidiInputHub({
    requestAccess: async () => fakeAccess(input).access,
    loadMappings: async () => MAPPINGS,
  });
  const { messages } = await listen(hub);
  send(input, 0x90, 60, 100);
  assert.equal(messages.length, 1);
  assert.equal(hub.getInputs()[0].mapping, undefined);
});

test("a device connected later is usable and matched", async () => {
  const { access, inputs } = fakeAccess();
  const hub = createMidiInputHub({
    requestAccess: async () => access,
    loadMappings: async () => MAPPINGS,
  });
  const { messages } = await listen(hub);
  assert.deepEqual(hub.getInputs(), []);
  const input = port("late", "Known Device");
  inputs.set(input.id, input);
  access.onstatechange?.();
  send(input, 0x90, 61, 90);
  assert.equal(messages[0][0], "late");
  assert.equal(hub.getInputs()[0].mapping?.id, "known");
});

test("a disconnected device is let go and reported", async () => {
  const input = port("a", "Known Device");
  const { access } = fakeAccess(input);
  const hub = createMidiInputHub({
    requestAccess: async () => access,
    loadMappings: async () => MAPPINGS,
  });
  const { disconnected } = await listen(hub);
  input.state = "disconnected";
  access.onstatechange?.();
  assert.deepEqual(disconnected, ["a"]);
  assert.equal(input.onmidimessage, null);
  assert.deepEqual(hub.getInputs(), []);
});

test("permission denied or no Web MIDI leaves no inputs and no errors", async () => {
  for (const requestAccess of [
    () => Promise.reject(new DOMException("denied", "NotAllowedError")),
    () => Promise.resolve(undefined),
    () => {
      throw new Error("insecure context");
    },
  ]) {
    const hub = createMidiInputHub({ requestAccess });
    const { stop } = await listen(hub);
    assert.deepEqual(hub.getInputs(), []);
    stop();
  }
});

test("a failed mapping load still plays through the standard layout", async () => {
  const input = port("a", "Known Device");
  const hub = createMidiInputHub({
    requestAccess: async () => fakeAccess(input).access,
    loadMappings: () => Promise.reject(new Error("offline")),
  });
  const { messages } = await listen(hub);
  send(input, 0x90, 60, 100);
  assert.equal(messages.length, 1);
});

test("asks once, and lets go of the ports when nothing listens", async () => {
  let requests = 0;
  const input = port("a", "Known Device");
  const { access } = fakeAccess(input);
  const hub = createMidiInputHub({
    requestAccess: async () => {
      requests += 1;
      return access;
    },
    loadMappings: async () => [],
  });
  const first = await listen(hub);
  first.stop();
  assert.equal(input.onmidimessage, null);
  const second = await listen(hub);
  assert.equal(requests, 1);
  send(input, 0x90, 60, 100);
  assert.equal(second.messages.length, 1);
});
