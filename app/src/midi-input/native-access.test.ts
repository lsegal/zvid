import assert from "node:assert/strict";
import { test } from "node:test";
import { createMidiInputHub } from "./input-hub.ts";
import type { MidiMessage } from "./messages.ts";
import {
  createNativeMidiAccess,
  type NativeMidiBridge,
  type NativeMidiEvent,
} from "./native-access.ts";

function fakeBridge() {
  const calls: string[] = [];
  let emit: (event: NativeMidiEvent) => void = () => {};
  const bridge: NativeMidiBridge = {
    start: async (onEvent) => {
      emit = onEvent;
    },
    open: async (id) => {
      calls.push(`open ${id}`);
    },
    close: async (id) => {
      calls.push(`close ${id}`);
    },
  };
  return { bridge, calls, emit: (event: NativeMidiEvent) => emit(event) };
}

const KEYS = { id: "1", name: "Keys" };
const PADS = { id: "2", name: "Pads" };

function inputIds(hub: ReturnType<typeof createMidiInputHub>) {
  return hub.getState().inputs.map(({ id }) => id);
}

async function listeningHub(bridge: NativeMidiBridge) {
  const hub = createMidiInputHub({
    requestAccess: () => createNativeMidiAccess(bridge),
    loadMappings: async () => [],
    storage: {
      getItem: () => JSON.stringify({ enabled: true }),
      setItem: () => {},
    },
  });
  const messages: [string, MidiMessage][] = [];
  const disconnected: string[] = [];
  const stop = hub.listen({
    message: (input, message) => messages.push([input.id, message]),
    disconnected: (input) => disconnected.push(input.id),
  });
  await new Promise((resolve) => setTimeout(resolve));
  return { hub, messages, disconnected, stop };
}

test("native ports open for the hub and deliver its messages", async () => {
  const { bridge, calls, emit } = fakeBridge();
  const { hub, messages } = await listeningHub(bridge);

  emit({ kind: "ports", ports: [KEYS] });
  emit({ kind: "message", portId: "1", data: [0x90, 60, 100] });

  assert.deepEqual(inputIds(hub), ["1"]);
  assert.deepEqual(calls, ["open 1"]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0][0], "1");
});

test("native hot-plug adds and removes inputs without touching the rest", async () => {
  const { bridge, calls, emit } = fakeBridge();
  const { hub, disconnected } = await listeningHub(bridge);

  emit({ kind: "ports", ports: [KEYS] });
  emit({ kind: "ports", ports: [KEYS, PADS] });
  assert.deepEqual(inputIds(hub), ["1", "2"]);
  assert.deepEqual(calls, ["open 1", "open 2"]);

  emit({ kind: "ports", ports: [PADS] });
  assert.deepEqual(inputIds(hub), ["2"]);
  assert.deepEqual(disconnected, ["1"]);
});

test("a replugged native port opens again", async () => {
  const { bridge, calls, emit } = fakeBridge();
  const { messages } = await listeningHub(bridge);

  emit({ kind: "ports", ports: [KEYS] });
  emit({ kind: "ports", ports: [] });
  emit({ kind: "ports", ports: [KEYS] });
  emit({ kind: "message", portId: "1", data: [0x90, 60, 100] });

  assert.equal(calls.filter((call) => call === "open 1").length, 2);
  assert.equal(messages.length, 1);
});

test("native ports close when nothing listens and reopen when it does", async () => {
  const { bridge, calls, emit } = fakeBridge();
  const { hub, stop } = await listeningHub(bridge);
  emit({ kind: "ports", ports: [KEYS] });

  stop();
  assert.deepEqual(calls, ["open 1", "close 1"]);

  hub.listen({ message: () => {}, disconnected: () => {} });
  assert.deepEqual(calls, ["open 1", "close 1", "open 1"]);
});

test("messages from a port the app no longer knows are dropped", async () => {
  const { bridge, emit } = fakeBridge();
  const { messages } = await listeningHub(bridge);

  emit({ kind: "message", portId: "gone", data: [0x90, 60, 100] });

  assert.deepEqual(messages, []);
});

test("a port that fails to open or close doesn't reject", async () => {
  const { bridge, emit } = fakeBridge();
  bridge.open = () => Promise.reject(new Error("busy"));
  bridge.close = () => Promise.reject(new Error("busy"));
  const { hub, stop } = await listeningHub(bridge);

  emit({ kind: "ports", ports: [KEYS] });
  stop();
  await new Promise((resolve) => setTimeout(resolve));

  assert.deepEqual(inputIds(hub), ["1"]);
});
