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
import { MIDI_INPUT_STORAGE_KEY, type PrefsStorage } from "./preferences.ts";

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

function memoryStorage(saved?: object): PrefsStorage {
  const items = new Map<string, string>();
  if (saved) {
    items.set(MIDI_INPUT_STORAGE_KEY, JSON.stringify(saved));
  }
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

// A hub with MIDI already on, as a previous launch left it.
function enabledHub(options: Parameters<typeof createMidiInputHub>[0]) {
  return createMidiInputHub({
    storage: memoryStorage({ enabled: true }),
    ...options,
  });
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve));
}

async function listen(hub: ReturnType<typeof createMidiInputHub>) {
  const messages: [string, MidiMessage][] = [];
  const disconnected: string[] = [];
  const stop = hub.listen({
    message: (input: MidiInputInfo, message) =>
      messages.push([input.id, message]),
    disconnected: (input) => disconnected.push(input.id),
  });
  await settle();
  return { messages, disconnected, stop };
}

function send(input: MidiInputPort, ...bytes: number[]) {
  input.onmidimessage?.({ data: new Uint8Array(bytes) });
}

test("reads a connected input and matches it to its mapping", async () => {
  const input = port("a", "Known Device MIDI 1");
  const hub = enabledHub({
    requestAccess: async () => fakeAccess(input).access,
    loadMappings: async () => MAPPINGS,
  });
  const { messages } = await listen(hub);
  send(input, 0x90, 60, 100);
  assert.deepEqual(messages, [
    ["a", { type: "note-on", channel: 1, note: 60, velocity: 100 }],
  ]);
  assert.equal(hub.getState().inputs[0].mapping?.id, "known");
});

test("an unrecognized device has no mapping but still plays", async () => {
  const input = port("a", "Homemade Thing");
  const hub = enabledHub({
    requestAccess: async () => fakeAccess(input).access,
    loadMappings: async () => MAPPINGS,
  });
  const { messages } = await listen(hub);
  send(input, 0x90, 60, 100);
  assert.equal(messages.length, 1);
  assert.equal(hub.getState().inputs[0].mapping, undefined);
});

test("a device connected later is usable and matched", async () => {
  const { access, inputs } = fakeAccess();
  const hub = enabledHub({
    requestAccess: async () => access,
    loadMappings: async () => MAPPINGS,
  });
  const { messages } = await listen(hub);
  assert.deepEqual(hub.getState().inputs, []);
  const input = port("late", "Known Device");
  inputs.set(input.id, input);
  access.onstatechange?.();
  send(input, 0x90, 61, 90);
  assert.equal(messages[0][0], "late");
  assert.equal(hub.getState().inputs[0].mapping?.id, "known");
});

test("a disconnected device is let go and reported", async () => {
  const input = port("a", "Known Device");
  const { access } = fakeAccess(input);
  const hub = enabledHub({
    requestAccess: async () => access,
    loadMappings: async () => MAPPINGS,
  });
  const { disconnected } = await listen(hub);
  input.state = "disconnected";
  access.onstatechange?.();
  assert.deepEqual(disconnected, ["a"]);
  assert.equal(input.onmidimessage, null);
  assert.deepEqual(hub.getState().inputs, []);
});

test("permission denied or no Web MIDI leaves no inputs and says why", async () => {
  for (const [requestAccess, status] of [
    [() => Promise.reject(new DOMException("no", "NotAllowedError")), "denied"],
    [() => Promise.reject(new DOMException("no", "SecurityError")), "denied"],
    [() => Promise.resolve(undefined), "unavailable"],
    [
      () => {
        throw new Error("insecure context");
      },
      "unavailable",
    ],
  ] as const) {
    const hub = enabledHub({ requestAccess });
    const { stop } = await listen(hub);
    assert.deepEqual(hub.getState().inputs, []);
    assert.equal(hub.getState().access, status);
    stop();
  }
});

test("a failed mapping load still plays through the standard layout", async () => {
  const input = port("a", "Known Device");
  const hub = enabledHub({
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
  const hub = enabledHub({
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

test("starts off: nothing is requested or bound until it's turned on", async () => {
  let requests = 0;
  const input = port("a", "Known Device");
  const hub = createMidiInputHub({
    requestAccess: async () => {
      requests += 1;
      return fakeAccess(input).access;
    },
    loadMappings: async () => [],
    storage: memoryStorage(),
  });
  await listen(hub);
  assert.equal(requests, 0);
  assert.equal(hub.getState().enabled, false);
  assert.equal(hub.getState().access, "idle");
  assert.equal(input.onmidimessage, null);
  hub.setEnabled(true);
  assert.equal(hub.getState().access, "requesting");
  await settle();
  assert.equal(requests, 1);
  assert.equal(hub.getState().access, "ready");
  assert.notEqual(input.onmidimessage, null);
});

test("turning off lets go of every port and ends what they hold", async () => {
  const a = port("a", "Device A");
  const b = port("b", "Device B");
  const hub = enabledHub({
    requestAccess: async () => fakeAccess(a, b).access,
    loadMappings: async () => [],
  });
  const { disconnected } = await listen(hub);
  hub.setEnabled(false);
  assert.equal(a.onmidimessage, null);
  assert.equal(b.onmidimessage, null);
  assert.deepEqual(disconnected, ["a", "b"]);
  assert.equal(hub.getState().inputs.length, 2);
  hub.setEnabled(true);
  assert.notEqual(a.onmidimessage, null);
});

test("turning it back on retries a denied request", async () => {
  let allow = false;
  const input = port("a", "Device A");
  const hub = enabledHub({
    requestAccess: async () => {
      if (!allow) {
        throw new DOMException("no", "NotAllowedError");
      }
      return fakeAccess(input).access;
    },
    loadMappings: async () => [],
  });
  await listen(hub);
  assert.equal(hub.getState().access, "denied");
  hub.setEnabled(false);
  allow = true;
  hub.setEnabled(true);
  await settle();
  assert.equal(hub.getState().access, "ready");
  assert.notEqual(input.onmidimessage, null);
});

test("choosing a device binds only it, and choosing none binds them all", async () => {
  const a = port("a", "Device A");
  const b = port("b", "Device B");
  const hub = enabledHub({
    requestAccess: async () => fakeAccess(a, b).access,
    loadMappings: async () => [],
  });
  const { messages, disconnected } = await listen(hub);
  hub.chooseDevice({ id: "b", name: "Device B" });
  assert.equal(a.onmidimessage, null);
  assert.deepEqual(disconnected, ["a"]);
  send(a, 0x90, 60, 100);
  send(b, 0x90, 61, 100);
  assert.deepEqual(
    messages.map(([id]) => id),
    ["b"],
  );
  assert.equal(hub.getState().inputs.length, 2);
  hub.chooseDevice(null);
  assert.notEqual(a.onmidimessage, null);
  assert.notEqual(b.onmidimessage, null);
});

test("a chosen device that's gone binds nothing until it reconnects", async () => {
  const a = port("a", "Device A");
  const b = port("b", "Device B");
  const { access, inputs } = fakeAccess(a);
  const hub = createMidiInputHub({
    requestAccess: async () => access,
    loadMappings: async () => [],
    storage: memoryStorage({
      enabled: true,
      device: { id: "b", name: "Device B" },
    }),
  });
  await listen(hub);
  assert.equal(a.onmidimessage, null);
  inputs.set(b.id, b);
  access.onstatechange?.();
  assert.equal(a.onmidimessage, null);
  assert.notEqual(b.onmidimessage, null);
});

test("a chosen device is found by name when its id changed, id first among twins", async () => {
  const twinA = port("input-0", "Same Name");
  const twinB = port("input-1", "Same Name");
  const renumbered = createMidiInputHub({
    requestAccess: async () => fakeAccess(twinA).access,
    loadMappings: async () => [],
    storage: memoryStorage({
      enabled: true,
      device: { id: "input-7", name: "Same Name" },
    }),
  });
  await listen(renumbered);
  assert.notEqual(twinA.onmidimessage, null);
  twinA.onmidimessage = null;
  const twins = createMidiInputHub({
    requestAccess: async () => fakeAccess(twinA, twinB).access,
    loadMappings: async () => [],
    storage: memoryStorage({
      enabled: true,
      device: { id: "input-1", name: "Same Name" },
    }),
  });
  await listen(twins);
  assert.equal(twinA.onmidimessage, null);
  assert.notEqual(twinB.onmidimessage, null);
});

test("the on/off state and chosen device carry over to the next launch", async () => {
  const storage = memoryStorage();
  const first = createMidiInputHub({
    requestAccess: async () => undefined,
    storage,
  });
  assert.equal(first.getState().enabled, false);
  first.setEnabled(true);
  first.chooseDevice({ id: "a", name: "Device A" });
  const second = createMidiInputHub({
    requestAccess: async () => undefined,
    storage,
  });
  assert.equal(second.getState().enabled, true);
  assert.deepEqual(second.getState().device, { id: "a", name: "Device A" });
});

test("unreadable saved preferences start off, on every device", () => {
  const hub = createMidiInputHub({
    storage: {
      getItem: () => "{not json",
      setItem: () => {},
    },
  });
  assert.equal(hub.getState().enabled, false);
  assert.equal(hub.getState().device, null);
});
