import { useSyncExternalStore } from "react";

// The camera and mic that recording into a source track uses. A choice is a
// device ID, or null for None; with no choice saved, the next level down
// decides. A track's override wins over the default inputs, which win over
// the browser's default device.
//
// Device IDs belong to a machine, so the choices are saved per machine in
// localStorage rather than in the session.

export type RecordInputKind = "video" | "audio";

// A device ID, or null for None.
export type RecordInput = string | null;

// Unset fields fall through to the next level.
export type RecordInputChoices = Partial<Record<RecordInputKind, RecordInput>>;

export type ResolvedRecordInputs = Record<RecordInputKind, RecordInput>;

// A device the picker lists, from enumerateDevices().
export type RecordDevice = {
  kind: RecordInputKind;
  // Empty until the page has camera or mic permission.
  deviceId: string;
  label: string;
};

// Resolves to "let the browser pick its default device".
export const BROWSER_DEFAULT_INPUT = "";

export const RECORD_INPUT_STORAGE_KEYS: Record<RecordInputKind, string> = {
  video: "zvid-record-video-input",
  audio: "zvid-record-audio-input",
};
export const RECORD_TRACK_INPUTS_STORAGE_KEY = "zvid-record-track-inputs";

export const RECORD_INPUT_KINDS: readonly RecordInputKind[] = [
  "video",
  "audio",
];

export type RecordInputStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

function getStorage(): RecordInputStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function parseInput(value: unknown): RecordInput | undefined {
  return value === null || typeof value === "string" ? value : undefined;
}

function readJson(storage: RecordInputStorage | null, key: string): unknown {
  try {
    const stored = storage?.getItem(key);
    return stored == null ? undefined : JSON.parse(stored);
  } catch {
    // Unavailable storage and corrupt values read as unset.
    return undefined;
  }
}

function writeJson(
  storage: RecordInputStorage | null,
  key: string,
  value: unknown,
) {
  try {
    if (value === undefined) {
      storage?.removeItem(key);
    } else {
      storage?.setItem(key, JSON.stringify(value));
    }
  } catch {
    // Storage can be unavailable (private mode, quota); the choice still
    // holds until reload.
  }
}

const listeners = new Set<() => void>();
let version = 0;

function notify() {
  version += 1;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readDefaultRecordInputs(
  storage = getStorage(),
): RecordInputChoices {
  const choices: RecordInputChoices = {};
  for (const kind of RECORD_INPUT_KINDS) {
    const input = parseInput(
      readJson(storage, RECORD_INPUT_STORAGE_KEYS[kind]),
    );
    if (input !== undefined) {
      choices[kind] = input;
    }
  }
  return choices;
}

// Saves the default input of `kind`; undefined clears it.
export function setDefaultRecordInput(
  kind: RecordInputKind,
  input: RecordInput | undefined,
  storage = getStorage(),
) {
  writeJson(storage, RECORD_INPUT_STORAGE_KEYS[kind], input);
  notify();
}

function readAllTrackInputs(storage: RecordInputStorage | null) {
  const value = readJson(storage, RECORD_TRACK_INPUTS_STORAGE_KEY);
  const tracks: Record<string, RecordInputChoices> = {};
  if (!value || typeof value !== "object") {
    return tracks;
  }
  for (const [trackId, stored] of Object.entries(value)) {
    if (!stored || typeof stored !== "object") {
      continue;
    }
    const choices: RecordInputChoices = {};
    for (const kind of RECORD_INPUT_KINDS) {
      const input = parseInput((stored as Record<string, unknown>)[kind]);
      if (input !== undefined) {
        choices[kind] = input;
      }
    }
    tracks[trackId] = choices;
  }
  return tracks;
}

export function readTrackRecordInputs(
  trackId: string,
  storage = getStorage(),
): RecordInputChoices {
  return readAllTrackInputs(storage)[trackId] ?? {};
}

// Saves a source track's override of `kind`; undefined clears it, so the
// track follows the default again.
export function setTrackRecordInput(
  trackId: string,
  kind: RecordInputKind,
  input: RecordInput | undefined,
  storage = getStorage(),
) {
  const tracks = readAllTrackInputs(storage);
  const choices = { ...tracks[trackId] };
  if (input === undefined) {
    delete choices[kind];
  } else {
    choices[kind] = input;
  }
  if (Object.keys(choices).length) {
    tracks[trackId] = choices;
  } else {
    delete tracks[trackId];
  }
  writeJson(
    storage,
    RECORD_TRACK_INPUTS_STORAGE_KEY,
    Object.keys(tracks).length ? tracks : undefined,
  );
  notify();
}

// The input of `kind` that `choices` (most specific first) resolve to among
// the attached `devices`. A device that is no longer attached falls through
// like an unset choice. Before permission is granted the devices have no
// IDs, so a saved ID can't be checked and is trusted.
export function resolveRecordInput(
  kind: RecordInputKind,
  choices: readonly RecordInputChoices[],
  devices: readonly RecordDevice[],
): RecordInput {
  const ofKind = devices.filter((device) => device.kind === kind);
  if (!ofKind.length) {
    return null;
  }
  const known = ofKind.some((device) => device.deviceId);
  for (const choice of choices) {
    const input = choice[kind];
    if (input === undefined) {
      continue;
    }
    if (
      input === null ||
      !known ||
      ofKind.some((device) => device.deviceId === input)
    ) {
      return input;
    }
  }
  return BROWSER_DEFAULT_INPUT;
}

export function resolveDefaultRecordInputs(
  devices: readonly RecordDevice[],
  storage = getStorage(),
): ResolvedRecordInputs {
  const defaults = readDefaultRecordInputs(storage);
  return {
    video: resolveRecordInput("video", [defaults], devices),
    audio: resolveRecordInput("audio", [defaults], devices),
  };
}

// The inputs recording into `trackId` uses: the track's override, else the
// default, else the browser's default device.
export function resolveTrackInputs(
  trackId: string,
  devices: readonly RecordDevice[],
  storage = getStorage(),
): ResolvedRecordInputs {
  const choices = [
    readTrackRecordInputs(trackId, storage),
    readDefaultRecordInputs(storage),
  ];
  return {
    video: resolveRecordInput("video", choices, devices),
    audio: resolveRecordInput("audio", choices, devices),
  };
}

// The getUserMedia constraint that opens `input`, or false for None.
export function getInputConstraint(
  input: RecordInput,
): boolean | MediaTrackConstraints {
  if (input === null) {
    return false;
  }
  return input === BROWSER_DEFAULT_INPUT
    ? true
    : { deviceId: { exact: input } };
}

// Re-renders when any saved input changes.
export function useRecordInputsVersion() {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
}
