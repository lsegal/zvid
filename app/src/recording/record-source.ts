import { useSyncExternalStore } from "react";
import { midiInputHub } from "../midi-input/input-hub.ts";
import {
  browserStorage,
  type PrefsStorage,
} from "../midi-input/preferences.ts";
import { isRecordQuantize, type RecordQuantize } from "./midi-quantize.ts";

// What recording captures: a per-browser choice in the record panel, kept
// the way the camera and mic are. MIDI is only on offer while MIDI is on, so
// with MIDI off recording always captures video and audio.
export const RECORD_SOURCE_STORAGE_KEY = "zvid-record-source";

export type RecordSource = "media" | "midi";
export type RecordMidiInput = "device" | "keyboard";

export type RecordSourcePrefs = {
  source: RecordSource;
  midiInput: RecordMidiInput;
  quantize: RecordQuantize;
};

export const DEFAULT_RECORD_SOURCE_PREFS: RecordSourcePrefs = {
  source: "media",
  midiInput: "device",
  quantize: "off",
};

export function readRecordSourcePrefs(
  storage: PrefsStorage | undefined,
): RecordSourcePrefs {
  try {
    const saved = JSON.parse(
      storage?.getItem(RECORD_SOURCE_STORAGE_KEY) ?? "null",
    );
    return {
      source: saved?.source === "midi" ? "midi" : "media",
      midiInput: saved?.midiInput === "keyboard" ? "keyboard" : "device",
      quantize: isRecordQuantize(saved?.quantize) ? saved.quantize : "off",
    };
  } catch {
    return DEFAULT_RECORD_SOURCE_PREFS;
  }
}

/** What armed tracks record, given whether MIDI is on. */
export function resolveRecordSource(
  { source }: RecordSourcePrefs,
  midiEnabled: boolean,
): RecordSource {
  return midiEnabled ? source : "media";
}

let prefs = readRecordSourcePrefs(browserStorage());
const listeners = new Set<() => void>();

export function subscribeRecordSource(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getRecordSourcePrefs() {
  return prefs;
}

export function setRecordSourcePrefs(next: Partial<RecordSourcePrefs>) {
  prefs = { ...prefs, ...next };
  try {
    browserStorage()?.setItem(RECORD_SOURCE_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage can be unavailable (private mode, quota); the choice still
    // applies until the page reloads.
  }
  for (const listener of listeners) {
    listener();
  }
}

export function useRecordSourcePrefs() {
  return useSyncExternalStore(subscribeRecordSource, getRecordSourcePrefs);
}

// Whether MIDI is on, which is when the record panels offer the MIDI tab.
export function useMidiEnabled() {
  return useSyncExternalStore(
    midiInputHub.subscribe,
    () => midiInputHub.getState().enabled,
  );
}

/** What armed tracks record right now. */
export function useRecordSource() {
  return resolveRecordSource(useRecordSourcePrefs(), useMidiEnabled());
}

// Whether a pass is recording MIDI, which then takes the notes an open piano
// roll would otherwise write to its own clip.
let midiPassActive = false;
const passListeners = new Set<() => void>();

export function setMidiPassActive(active: boolean) {
  if (active === midiPassActive) {
    return;
  }
  midiPassActive = active;
  for (const listener of passListeners) {
    listener();
  }
}

function subscribeMidiPass(listener: () => void) {
  passListeners.add(listener);
  return () => {
    passListeners.delete(listener);
  };
}

export function useMidiPassActive() {
  return useSyncExternalStore(subscribeMidiPass, () => midiPassActive);
}
