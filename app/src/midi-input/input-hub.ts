// The app's connection to the MIDI ports. MIDI starts off: Web MIDI is asked
// for when it's turned on, and while it's on the hub keeps a handler on each
// chosen input as devices come and go. The desktop app's webviews without Web
// MIDI read the ports natively instead (native-access.ts). Without either, or
// without permission, it never has any inputs, and its state says why.
import {
  loadDeviceMappings,
  type MidiDeviceMapping,
  matchDeviceMapping,
} from "./device-mappings.ts";
import { type MidiMessage, parseMidiMessage } from "./messages.ts";
import { requestDesktopAccess } from "./native-access.ts";
import {
  browserStorage,
  type MidiDeviceChoice,
  type PrefsStorage,
  readMidiInputPreferences,
  writeMidiInputPreferences,
} from "./preferences.ts";

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
  // Asked before any listener hears a message. One that says yes is the only
  // one told, as when a key is mapped to a button rather than playing a note.
  claims?: (input: MidiInputInfo, message: MidiMessage) => boolean;
  message: (input: MidiInputInfo, message: MidiMessage) => void;
  disconnected: (input: MidiInputInfo) => void;
};

/** Where the hub is in getting Web MIDI: asked for once MIDI is turned on. */
export type MidiAccessStatus =
  | "idle"
  | "requesting"
  | "ready"
  | "unavailable"
  | "denied";

export type MidiInputState = {
  enabled: boolean;
  device: MidiDeviceChoice | null;
  access: MidiAccessStatus;
  // Every connected input, whichever of them is chosen.
  inputs: readonly MidiInputInfo[];
};

export type MidiInputHub = {
  listen: (listener: MidiInputListener) => () => void;
  subscribe: (listener: () => void) => () => void;
  getState: () => MidiInputState;
  setEnabled: (enabled: boolean) => void;
  chooseDevice: (device: MidiDeviceChoice | null) => void;
};

const NO_INPUTS: readonly MidiInputInfo[] = [];

/** How the UI names an input: what it was recognized as, or its port name. */
export function midiInputLabel({ name, mapping }: MidiInputInfo) {
  return mapping ? `${mapping.manufacturer} ${mapping.model}` : name;
}

/** The connected input `device` refers to: by name, then id among the same. */
export function findChosenInput(
  inputs: readonly MidiInputInfo[],
  device: MidiDeviceChoice,
) {
  const named = inputs.filter((input) => input.name === device.name);
  return named.find((input) => input.id === device.id) ?? named[0];
}

export function createMidiInputHub({
  requestAccess = requestPlatformAccess,
  loadMappings = loadDeviceMappings,
  storage = browserStorage(),
}: {
  requestAccess?: () => Promise<MidiAccessLike | undefined>;
  loadMappings?: () => Promise<MidiDeviceMapping[]>;
  storage?: PrefsStorage;
} = {}): MidiInputHub {
  const listeners = new Set<MidiInputListener>();
  const stateListeners = new Set<() => void>();
  const bound = new Map<string, { port: MidiInputPort; info: MidiInputInfo }>();
  let access: MidiAccessLike | undefined;
  let mappings: readonly MidiDeviceMapping[] = [];
  let state: MidiInputState = {
    ...readMidiInputPreferences(storage),
    access: "idle",
    inputs: NO_INPUTS,
  };

  function publish(next: Partial<MidiInputState>) {
    state = { ...state, ...next };
    for (const listener of stateListeners) {
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

  // The inputs to take notes from: none while off or while nothing listens.
  function wantedInputs(inputs: readonly MidiInputInfo[]) {
    if (!state.enabled || !listeners.size) {
      return NO_INPUTS;
    }
    if (!state.device) {
      return inputs;
    }
    const chosen = findChosenInput(inputs, state.device);
    return chosen ? [chosen] : NO_INPUTS;
  }

  // Binds the wanted inputs and lets go of the rest, which lets the browser
  // close the ports while nothing plays them.
  function sync() {
    if (!access) {
      return;
    }
    const connected = new Map(
      [...access.inputs.values()]
        .filter((port) => port.state === "connected")
        .map((port) => [port.id, port]),
    );
    const inputs = [...connected.values()].map(infoOf);
    const wanted = wantedInputs(inputs);
    const wantedIds = new Set(wanted.map((input) => input.id));
    for (const [id, { port, info }] of bound) {
      if (!wantedIds.has(id) || connected.get(id) !== port) {
        release(id, port, info);
      }
    }
    for (const info of wanted) {
      const port = connected.get(info.id);
      const entry = bound.get(info.id);
      if (entry) {
        entry.info = info;
      } else if (port) {
        const added = { port, info };
        bound.set(info.id, added);
        port.onmidimessage = (event) => {
          const message = event.data && parseMidiMessage(event.data);
          if (message) {
            const claimant = [...listeners].find((listener) =>
              listener.claims?.(added.info, message),
            );
            for (const listener of claimant ? [claimant] : listeners) {
              listener.message(added.info, message);
            }
          }
        };
      }
    }
    publish({ inputs });
  }

  async function start() {
    publish({ access: "requesting" });
    try {
      access = await requestAccess();
    } catch (error) {
      const name = (error as { name?: string } | undefined)?.name;
      publish({
        access:
          name === "NotAllowedError" || name === "SecurityError"
            ? "denied"
            : "unavailable",
      });
      return;
    }
    if (!access) {
      publish({ access: "unavailable" });
      return;
    }
    access.onstatechange = sync;
    publish({ access: "ready" });
    sync();
    try {
      mappings = await loadMappings();
    } catch {
      // Every device still plays through the standard layout.
      return;
    }
    sync();
  }

  function savePreferences() {
    const { enabled, device } = state;
    writeMidiInputPreferences(storage, { enabled, device });
  }

  return {
    listen(listener) {
      listeners.add(listener);
      if (state.enabled && state.access === "idle") {
        void start();
      } else {
        sync();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          sync();
        }
      };
    },
    subscribe(listener) {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },
    getState: () => state,
    setEnabled(enabled) {
      if (enabled === state.enabled) {
        return;
      }
      publish({ enabled });
      savePreferences();
      // Turning it back on retries a refused request, as the permission may
      // have been granted since.
      if (
        enabled &&
        state.access !== "ready" &&
        state.access !== "requesting"
      ) {
        void start();
      } else {
        sync();
      }
    },
    chooseDevice(device) {
      publish({ device });
      savePreferences();
      sync();
    },
  };
}

function requestPlatformAccess() {
  const request = globalThis.navigator?.requestMIDIAccess;
  return request
    ? (request.call(navigator) as unknown as Promise<MidiAccessLike>)
    : requestDesktopAccess();
}

export const midiInputHub = createMidiInputHub();
