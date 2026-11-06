// Web MIDI's MIDIAccess over the desktop app's native MIDI backend
// (src-tauri/src/midi.rs), for webviews without Web MIDI: WKWebView on macOS
// and WebKitGTK on Linux. Like Web MIDI, a port opens when it gets a message
// handler and closes when it loses it.
import type { MidiAccessLike, MidiInputPort } from "./input-hub.ts";

export type NativeMidiEvent =
  | { kind: "ports"; ports: { id: string; name: string }[] }
  | { kind: "message"; portId: string; data: number[] };

export type NativeMidiBridge = {
  start: (onEvent: (event: NativeMidiEvent) => void) => Promise<void>;
  open: (id: string) => Promise<void>;
  close: (id: string) => Promise<void>;
};

function createPort(
  id: string,
  name: string,
  bridge: NativeMidiBridge,
): MidiInputPort {
  let handler: MidiInputPort["onmidimessage"] = null;
  return {
    id,
    name,
    state: "connected",
    get onmidimessage() {
      return handler;
    },
    set onmidimessage(next) {
      if (Boolean(next) !== Boolean(handler)) {
        // A port that can't open just stays silent, as a denied one does.
        void (next ? bridge.open(id) : bridge.close(id)).catch(() => {});
      }
      handler = next;
    },
  };
}

export async function createNativeMidiAccess(
  bridge: NativeMidiBridge,
): Promise<MidiAccessLike> {
  const inputs = new Map<string, MidiInputPort>();
  const access: MidiAccessLike = { inputs, onstatechange: null };
  await bridge.start((event) => {
    if (event.kind === "message") {
      inputs
        .get(event.portId)
        ?.onmidimessage?.({ data: Uint8Array.from(event.data) });
      return;
    }
    const ids = new Set(event.ports.map(({ id }) => id));
    for (const id of inputs.keys()) {
      if (!ids.has(id)) {
        inputs.delete(id);
      }
    }
    for (const { id, name } of event.ports) {
      if (!inputs.has(id)) {
        inputs.set(id, createPort(id, name, bridge));
      }
    }
    access.onstatechange?.();
  });
  return access;
}

/** The native backend in the desktop app, and nothing in a browser. */
export async function requestDesktopAccess() {
  const { Channel, invoke, isTauri } = await import("@tauri-apps/api/core");
  if (!isTauri()) {
    return undefined;
  }
  return createNativeMidiAccess({
    start: (onEvent) =>
      invoke("midi_start", { events: new Channel(onEvent) }),
    open: (id) => invoke("midi_open", { id }),
    close: (id) => invoke("midi_close", { id }),
  });
}
