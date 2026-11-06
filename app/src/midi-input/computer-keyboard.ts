// Playing notes from the keyboard people type on (#1569): whether that's on,
// which a per-browser preference keeps across launches the way MIDI's does,
// and which physical keys play what. Keys go by KeyboardEvent.code, so the
// shape stays the same on non-QWERTY layouts.
import { PIANO_ROLL_HIGH_PITCH, PIANO_ROLL_LOW_PITCH } from "../midi-piano-roll.ts";
import { browserStorage, type PrefsStorage } from "./preferences.ts";

export const COMPUTER_KEYBOARD_STORAGE_KEY = "zvid-computer-keyboard-entry";

// Each key's semitones above the octave's C: the home row plays the white
// keys and the row above it the black keys.
const NOTE_OFFSETS: Readonly<Record<string, number>> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
};

const HIGHEST_OFFSET = Math.max(...Object.values(NOTE_OFFSETS));
const OCTAVE = 12;
const DEFAULT_BASE_PITCH = 60;

export type ComputerKeyboardKey =
  | { kind: "note"; offset: number }
  | { kind: "octave"; direction: -1 | 1 };

/** What the key at the physical position `code` does, if it's one of ours. */
export function computerKeyboardKey(
  code: string,
): ComputerKeyboardKey | undefined {
  if (code === "KeyZ") {
    return { kind: "octave", direction: -1 };
  }
  if (code === "KeyX") {
    return { kind: "octave", direction: 1 };
  }
  const offset = Object.hasOwn(NOTE_OFFSETS, code)
    ? NOTE_OFFSETS[code]
    : undefined;
  return offset === undefined ? undefined : { kind: "note", offset };
}

/**
 * The C the keys play from after an octave shift. It stops where a further
 * shift would take any of the keys off the piano roll.
 */
export function shiftBasePitch(basePitch: number, direction: -1 | 1) {
  const next = basePitch + direction * OCTAVE;
  return next < PIANO_ROLL_LOW_PITCH ||
    next + HIGHEST_OFFSET > PIANO_ROLL_HIGH_PITCH
    ? basePitch
    : next;
}

export type ComputerKeyboardState = { enabled: boolean; basePitch: number };

export type ComputerKeyboardEntry = {
  subscribe: (listener: () => void) => () => void;
  getState: () => ComputerKeyboardState;
  setEnabled: (enabled: boolean) => void;
  shiftOctave: (direction: -1 | 1) => void;
};

function readEnabled(storage: PrefsStorage | undefined) {
  try {
    const saved = JSON.parse(
      storage?.getItem(COMPUTER_KEYBOARD_STORAGE_KEY) ?? "null",
    );
    return saved?.enabled === true;
  } catch {
    return false;
  }
}

function writeEnabled(storage: PrefsStorage | undefined, enabled: boolean) {
  try {
    storage?.setItem(
      COMPUTER_KEYBOARD_STORAGE_KEY,
      JSON.stringify({ enabled }),
    );
  } catch {
    // Storage can be unavailable (private mode, quota); the choice still
    // applies until the page reloads.
  }
}

export function createComputerKeyboardEntry({
  storage = browserStorage(),
}: {
  storage?: PrefsStorage;
} = {}): ComputerKeyboardEntry {
  const listeners = new Set<() => void>();
  let state: ComputerKeyboardState = {
    enabled: readEnabled(storage),
    basePitch: DEFAULT_BASE_PITCH,
  };
  const publish = (next: Partial<ComputerKeyboardState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState: () => state,
    setEnabled(enabled) {
      if (enabled !== state.enabled) {
        publish({ enabled });
        writeEnabled(storage, enabled);
      }
    },
    shiftOctave(direction) {
      const basePitch = shiftBasePitch(state.basePitch, direction);
      if (basePitch !== state.basePitch) {
        publish({ basePitch });
      }
    },
  };
}

export const computerKeyboardEntry = createComputerKeyboardEntry();
