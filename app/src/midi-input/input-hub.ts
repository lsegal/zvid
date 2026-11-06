// The app's connection to the MIDI ports: asks for Web MIDI once, the first
// time anything listens, and keeps a handler on each connected input as
// devices come and go. The desktop app's webviews without Web MIDI read the
// ports natively instead (native-access.ts). Without either, or without
// permission, it simply never has any inputs.
import {
  loadDeviceMappings,
  type MidiDeviceMapping,
  matchDeviceMapping,
} from "./device-mappings.ts";
import { type MidiMessage, parseMidiMessage } from "./messages.ts";
import { requestDesktopAccess } from "./native-access.ts";

// The parts of Web MIDI's MIDIAccess and MIDIInput the hub uses.
export type MidiInputPort = {
  id: string;
  name?: string | null;
  state: string;
  onmidimessage: ((event: { data: Uint8Array | null }) => void) | null;
};

export type MidiAccessLike = {
  inputs: { values: () => Iterable<MidiInputPort> };
  onstatechange: (() => void) | null;
};

/** A connected input, and its mapping when the device has one. */
export type MidiInputInfo = {
  id: string;
  name: string;
  mapping?: MidiDeviceMapping;
};

export type MidiInputListener = {
  message: (input: MidiInputInfo, message: MidiMessage) => void;
  disconnected: (input: MidiInputInfo) => void;
};

export type MidiInputHub = {
  listen: (listener: MidiInputListener) => () => void;
  subscribeInputs: (listener: () => void) => () => void;
  getInputs: () => readonly MidiInputInfo[];
};

const NO_INPUTS: readonly MidiInputInfo[] = [];

export function createMidiInputHub({
  requestAccess = requestPlatformAccess,
  loadMappings = loadDeviceMappings,
}: {
  requestAccess?: () => Promise<MidiAccessLike | undefined>;
  loadMappings?: () => Promise<MidiDeviceMapping[]>;
} = {}): MidiInputHub {
  const listeners = new Set<MidiInputListener>();
  const inputListeners = new Set<() => void>();
  const bound = new Map<string, { port: MidiInputPort; info: MidiInputInfo }>();
  let requested = false;
  let access: MidiAccessLike | undefined;
  let mappings: readonly MidiDeviceMapping[] = [];
  let inputs = NO_INPUTS;

  function publishInputs() {
    inputs = [...bound.values()].map(({ info }) => info);
    for (const listener of inputListeners) {
      listener();
    }
  }

  function infoOf(port: MidiInputPort): MidiInputInfo {
    const name = port.name ?? "MIDI input";
    const mapping = matchDeviceMapping(name, mappings);
    return { id: port.id, name, ...(mapping ? { mapping } : {}) };
  }

  function release(id: string, port: MidiInputPort, info: MidiInputInfo) {
    port.onmidimessage = null;
    bound.delete(id);
    for (const listener of listeners) {
      listener.disconnected(info);
    }
  }

  // Binds the connected inputs and lets go of the rest.
  function sync() {
    if (!access || !listeners.size) {
      return;
    }
    const connected = new Map(
      [...access.inputs.values()]
        .filter((port) => port.state === "connected")
        .map((port) => [port.id, port]),
    );
    for (const [id, { port, info }] of bound) {
      if (connected.get(id) !== port) {
        release(id, port, info);
      }
    }
    for (const [id, port] of connected) {
      if (bound.has(id)) {
        continue;
      }
      const entry = { port, info: infoOf(port) };
      bound.set(id, entry);
      port.onmidimessage = (event) => {
        const message = event.data && parseMidiMessage(event.data);
        if (message) {
          for (const listener of listeners) {
            listener.message(entry.info, message);
          }
        }
      };
    }
    publishInputs();
  }

  async function start() {
    try {
      access = await requestAccess();
    } catch {
      // Denied or unavailable: the piano roll works as it does without MIDI.
      return;
    }
    if (!access) {
      return;
    }
    access.onstatechange = sync;
    sync();
    try {
      mappings = await loadMappings();
    } catch {
      // Every device still plays through the standard layout.
      return;
    }
    for (const entry of bound.values()) {
      entry.info = infoOf(entry.port);
    }
    publishInputs();
  }

  return {
    listen(listener) {
      listeners.add(listener);
      if (!requested) {
        requested = true;
        void start();
      } else {
        sync();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          // Lets the browser close the ports while nothing plays them.
          for (const [id, { port, info }] of bound) {
            release(id, port, info);
          }
          publishInputs();
        }
      };
    },
    subscribeInputs(listener) {
      inputListeners.add(listener);
      return () => {
        inputListeners.delete(listener);
      };
    },
    getInputs: () => inputs,
  };
}

function requestPlatformAccess() {
  const request = globalThis.navigator?.requestMIDIAccess;
  return request
    ? (request.call(navigator) as unknown as Promise<MidiAccessLike>)
    : requestDesktopAccess();
}

export const midiInputHub = createMidiInputHub();
