// The camera and microphone recordings capture from: the default inputs and
// each source track's own overrides. Device IDs belong to a machine, so they
// are kept in localStorage rather than in the session.

export type RecordInputKind = "video" | "audio";

// A chosen input: a device ID, or null for None. Where an input may be
// unset, undefined falls through to the next choice (the browser's default
// device, last of all).
export type RecordInput = string | null;

export type RecordInputs = Record<RecordInputKind, RecordInput | undefined>;

// A track's overrides; a missing kind uses the default input.
export type TrackInputOverride = Partial<Record<RecordInputKind, RecordInput>>;

// An input device the browser lists.
export type InputDevice = { deviceId: string; label: string };

// The device IDs the browser lists now, by kind.
export type AvailableInputs = Record<RecordInputKind, readonly string[]>;

type RecordStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const RECORD_INPUT_KINDS: readonly RecordInputKind[] = [
  "video",
  "audio",
];

export const RECORD_INPUT_STORAGE_KEYS: Record<RecordInputKind, string> = {
  video: "zvid-record-video-input",
  audio: "zvid-record-audio-input",
};

export const RECORD_TRACK_INPUTS_STORAGE_KEY = "zvid-record-track-inputs";

// Entries Chromium lists for whichever device the system routes to, in
// addition to that device itself.
const ALIAS_DEVICE_IDS = new Set(["default", "communications"]);

function getStorage(): RecordStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function parseInput(value: unknown): RecordInput | undefined {
  return value === null || typeof value === "string" ? value : undefined;
}

const listeners = new Set<() => void>();
let version = 0;

function notify() {
  version += 1;
  for (const listener of listeners) {
    listener();
  }
}

// Calls `listener` when an input choice changes here or in another tab.
export function subscribeRecordInputs(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (
      event.key === null ||
      event.key === RECORD_TRACK_INPUTS_STORAGE_KEY ||
      Object.values(RECORD_INPUT_STORAGE_KEYS).includes(event.key)
    ) {
      notify();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

// Changes whenever an input choice does, for useSyncExternalStore.
export function getRecordInputsVersion() {
  return version;
}

export function readDefaultInput(
  kind: RecordInputKind,
  storage: Pick<Storage, "getItem"> | undefined = getStorage(),
): RecordInput | undefined {
  try {
    const stored = storage?.getItem(RECORD_INPUT_STORAGE_KEYS[kind]);
    return stored == null ? undefined : parseInput(JSON.parse(stored));
  } catch {
    return undefined;
  }
}

// Sets the default input; undefined goes back to the browser's default.
export function writeDefaultInput(
  kind: RecordInputKind,
  input: RecordInput | undefined,
  storage: RecordStorage | undefined = getStorage(),
) {
  try {
    if (input === undefined) {
      storage?.removeItem(RECORD_INPUT_STORAGE_KEYS[kind]);
    } else {
      storage?.setItem(RECORD_INPUT_STORAGE_KEYS[kind], JSON.stringify(input));
    }
  } catch {
    // Storage can be unavailable (private mode, quota); the choice is lost.
  }
  notify();
}

function readOverrides(
  storage: Pick<Storage, "getItem"> | undefined,
): Record<string, TrackInputOverride> {
  try {
    const parsed: unknown = JSON.parse(
      storage?.getItem(RECORD_TRACK_INPUTS_STORAGE_KEY) ?? "{}",
    );
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, TrackInputOverride>)
      : {};
  } catch {
    return {};
  }
}

export function readTrackInputOverride(
  trackId: string,
  storage: Pick<Storage, "getItem"> | undefined = getStorage(),
): TrackInputOverride {
  const stored = readOverrides(storage)[trackId];
  const override: TrackInputOverride = {};
  for (const kind of RECORD_INPUT_KINDS) {
    const input = parseInput(stored?.[kind]);
    if (input !== undefined) {
      override[kind] = input;
    }
  }
  return override;
}

// Sets one of a track's inputs; undefined clears the override so the track
// uses the default input again.
export function writeTrackInputOverride(
  trackId: string,
  kind: RecordInputKind,
  input: RecordInput | undefined,
  storage: RecordStorage | undefined = getStorage(),
) {
  const overrides = readOverrides(storage);
  const next: TrackInputOverride = {
    ...readTrackInputOverride(trackId, storage),
  };
  if (input === undefined) {
    delete next[kind];
  } else {
    next[kind] = input;
  }
  if (Object.keys(next).length) {
    overrides[trackId] = next;
  } else {
    delete overrides[trackId];
  }
  try {
    storage?.setItem(
      RECORD_TRACK_INPUTS_STORAGE_KEY,
      JSON.stringify(overrides),
    );
  } catch {
    // Storage can be unavailable (private mode, quota); the choice is lost.
  }
  notify();
}

// A saved input still usable: None, or a device the browser still lists.
// Without a device list yet, every saved device is trusted.
function usable(
  input: RecordInput | undefined,
  available: readonly string[] | undefined,
) {
  return (
    input !== undefined &&
    (input === null || !available || available.includes(input))
  );
}

// The default input, or undefined for the browser's default device when
// none is saved or the saved device is gone.
export function resolveDefaultInput(
  kind: RecordInputKind,
  available?: AvailableInputs,
  storage: Pick<Storage, "getItem"> | undefined = getStorage(),
) {
  const input = readDefaultInput(kind, storage);
  return usable(input, available?.[kind]) ? input : undefined;
}

// The track's override if it is still usable, or undefined when the track
// uses the default input.
export function resolveTrackOverride(
  trackId: string,
  kind: RecordInputKind,
  available?: AvailableInputs,
  storage: Pick<Storage, "getItem"> | undefined = getStorage(),
) {
  const input = readTrackInputOverride(trackId, storage)[kind];
  return usable(input, available?.[kind]) ? input : undefined;
}

// The inputs a track records from: its override, else the default, else
// the browser's default device (undefined). A saved device that is no
// longer present falls through the same way.
export function resolveTrackInputs(
  trackId: string,
  available?: AvailableInputs,
  storage: Pick<Storage, "getItem"> | undefined = getStorage(),
): RecordInputs {
  const inputs = {} as RecordInputs;
  for (const kind of RECORD_INPUT_KINDS) {
    const override = resolveTrackOverride(trackId, kind, available, storage);
    inputs[kind] =
      override !== undefined
        ? override
        : resolveDefaultInput(kind, available, storage);
  }
  return inputs;
}

// The cameras or microphones in an enumerateDevices() list, without
// Chromium's "default" and "communications" aliases. Devices the page may
// not name yet are numbered.
export function listInputDevices(
  infos: readonly Pick<MediaDeviceInfo, "deviceId" | "kind" | "label">[],
  kind: RecordInputKind,
): InputDevice[] {
  const mediaKind = kind === "video" ? "videoinput" : "audioinput";
  const noun = kind === "video" ? "Camera" : "Microphone";
  return infos
    .filter(
      (info) =>
        info.kind === mediaKind &&
        info.deviceId &&
        !ALIAS_DEVICE_IDS.has(info.deviceId),
    )
    .map((info, index) => ({
      deviceId: info.deviceId,
      label: info.label || `${noun} ${index + 1}`,
    }));
}

// What the browser's default device is called: Chromium's "default" alias
// names it, otherwise the first device listed is the one used.
export function browserDefaultLabel(
  infos: readonly Pick<MediaDeviceInfo, "deviceId" | "kind" | "label">[],
  kind: RecordInputKind,
) {
  const mediaKind = kind === "video" ? "videoinput" : "audioinput";
  const alias = infos.find(
    (info) => info.kind === mediaKind && info.deviceId === "default",
  );
  const aliasLabel = alias?.label.replace(/^Default\s*-\s*/, "");
  return aliasLabel || listInputDevices(infos, kind)[0]?.label;
}

type DefaultDeviceInfo = Pick<MediaDeviceInfo, "deviceId" | "kind"> &
  Partial<Pick<MediaDeviceInfo, "groupId" | "label">>;

// The ID of the device the browser's default input is on, so the default
// opens the same way as choosing that device. Chromium's "default" alias is
// matched to the device it names, then to one in its group (an audio
// interface lists several); without an alias the first device listed is
// the default. Undefined until the browser lists the device IDs.
export function browserDefaultDeviceId(
  infos: readonly DefaultDeviceInfo[],
  kind: RecordInputKind,
) {
  const mediaKind = kind === "video" ? "videoinput" : "audioinput";
  const ofKind = infos.filter((info) => info.kind === mediaKind);
  const devices = ofKind.filter(
    (info) => info.deviceId && !ALIAS_DEVICE_IDS.has(info.deviceId),
  );
  const alias = ofKind.find((info) => info.deviceId === "default");
  const aliasLabel = alias?.label?.replace(/^Default\s*-\s*/, "");
  const match =
    (aliasLabel && devices.find((info) => info.label === aliasLabel)) ||
    (alias?.groupId &&
      devices.find((info) => info.groupId === alias.groupId)) ||
    devices[0];
  return match?.deviceId;
}

// The inputs to open: the browser's default device (undefined) becomes the
// device it is on now, so it follows the system default as it changes.
export function withBrowserDefaults(
  inputs: RecordInputs,
  infos: readonly DefaultDeviceInfo[],
): RecordInputs {
  const resolved = { ...inputs };
  for (const kind of RECORD_INPUT_KINDS) {
    if (resolved[kind] === undefined) {
      resolved[kind] = browserDefaultDeviceId(infos, kind);
    }
  }
  return resolved;
}
