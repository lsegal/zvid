// Whether MIDI is on and which device it's limited to: a per-browser
// preference kept in localStorage, never in the session.
export const MIDI_INPUT_STORAGE_KEY = "zvid-midi-input";

/**
 * The device input is limited to. Both identify it, since a browser may number
 * its ports differently from one launch to the next.
 */
export type MidiDeviceChoice = { id: string; name: string };

export type MidiInputPreferences = {
  enabled: boolean;
  // Null takes input from every connected device.
  device: MidiDeviceChoice | null;
};

export type PrefsStorage = Pick<Storage, "getItem" | "setItem">;

export function readMidiInputPreferences(
  storage: PrefsStorage | undefined,
): MidiInputPreferences {
  try {
    const saved = JSON.parse(
      storage?.getItem(MIDI_INPUT_STORAGE_KEY) ?? "null",
    );
    const device = saved?.device;
    return {
      enabled: saved?.enabled === true,
      device:
        typeof device?.id === "string" && typeof device?.name === "string"
          ? { id: device.id, name: device.name }
          : null,
    };
  } catch {
    return { enabled: false, device: null };
  }
}

export function writeMidiInputPreferences(
  storage: PrefsStorage | undefined,
  preferences: MidiInputPreferences,
) {
  try {
    storage?.setItem(MIDI_INPUT_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Storage can be unavailable (private mode, quota); the choice still
    // applies until the page reloads.
  }
}

export function browserStorage(): PrefsStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
