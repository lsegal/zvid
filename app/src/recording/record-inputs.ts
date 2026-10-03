// The camera and microphone recording uses: the default inputs and each
// source track's overrides. Device IDs belong to a machine, so they're kept
// in this browser's localStorage rather than in the session.

export const RECORD_VIDEO_INPUT_STORAGE_KEY = "zvid-record-video-input";
export const RECORD_AUDIO_INPUT_STORAGE_KEY = "zvid-record-audio-input";
export const RECORD_TRACK_INPUTS_STORAGE_KEY = "zvid-record-track-inputs";

// A device ID, or null for None.
export type RecordInput = string | null;

// A track's saved inputs; a missing kind uses the default.
export type RecordTrackInputs = { video?: RecordInput; audio?: RecordInput };

// What a recording opens for one kind: a device ID, the browser's default
// device (undefined), or nothing (null).
export type ResolvedRecordInputs = {
  video: string | null | undefined;
  audio: string | null | undefined;
};

type ReadStorage = Pick<Storage, "getItem"> | undefined;
type WriteStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const DEFAULT_KEYS = {
  video: RECORD_VIDEO_INPUT_STORAGE_KEY,
  audio: RECORD_AUDIO_INPUT_STORAGE_KEY,
} as const;

function defaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function parseInput(value: unknown): RecordInput | undefined {
  return value === null || typeof value === "string" ? value : undefined;
}

/** The default input of `kind`; undefined when none was saved. */
export function readDefaultRecordInput(
  kind: "video" | "audio",
  storage: ReadStorage = defaultStorage(),
): RecordInput | undefined {
  try {
    const stored = storage?.getItem(DEFAULT_KEYS[kind]);
    return stored == null ? undefined : parseInput(JSON.parse(stored));
  } catch {
    return undefined;
  }
}

/** Saves the default input of `kind`; undefined clears it. */
export function writeDefaultRecordInput(
  kind: "video" | "audio",
  input: RecordInput | undefined,
  storage: WriteStorage | undefined = defaultStorage(),
) {
  try {
    if (input === undefined) {
      storage?.removeItem(DEFAULT_KEYS[kind]);
    } else {
      storage?.setItem(DEFAULT_KEYS[kind], JSON.stringify(input));
    }
  } catch {
    // Storage can be full or blocked; recording still uses the default.
  }
}

/** Every track's saved overrides, keyed by source track ID. */
export function readTrackRecordInputs(
  storage: ReadStorage = defaultStorage(),
): Record<string, RecordTrackInputs> {
  try {
    const stored = JSON.parse(
      storage?.getItem(RECORD_TRACK_INPUTS_STORAGE_KEY) ?? "null",
    );
    if (!stored || typeof stored !== "object") {
      return {};
    }
    const result: Record<string, RecordTrackInputs> = {};
    for (const [trackId, value] of Object.entries(stored)) {
      if (!value || typeof value !== "object") {
        continue;
      }
      const { video, audio } = value as Record<string, unknown>;
      const inputs: RecordTrackInputs = {};
      if (parseInput(video) !== undefined) inputs.video = parseInput(video);
      if (parseInput(audio) !== undefined) inputs.audio = parseInput(audio);
      result[trackId] = inputs;
    }
    return result;
  } catch {
    return {};
  }
}

/** Saves `trackId`'s overrides; empty overrides remove its entry. */
export function writeTrackRecordInputs(
  trackId: string,
  inputs: RecordTrackInputs,
  storage: WriteStorage | undefined = defaultStorage(),
) {
  const next = { ...readTrackRecordInputs(storage) };
  if (inputs.video === undefined && inputs.audio === undefined) {
    delete next[trackId];
  } else {
    next[trackId] = inputs;
  }
  try {
    storage?.setItem(RECORD_TRACK_INPUTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage can be full or blocked; the override applies this session.
  }
}

// A saved device that isn't attached any more is skipped, like an unsaved
// one; None always applies.
function resolveKind(
  kind: "video" | "audio",
  override: RecordInput | undefined,
  fallback: RecordInput | undefined,
  devices: readonly Pick<MediaDeviceInfo, "deviceId" | "kind">[] | undefined,
) {
  const deviceKind = kind === "video" ? "videoinput" : "audioinput";
  const usable = (input: RecordInput | undefined) =>
    input === null ||
    (input !== undefined &&
      (!devices ||
        devices.some(
          (device) => device.kind === deviceKind && device.deviceId === input,
        )));
  if (usable(override)) return override as RecordInput;
  if (usable(fallback)) return fallback as RecordInput;
  return undefined;
}

/**
 * The inputs `trackId` records from: its override, else the default, else
 * the browser's default device. `devices`, from `enumerateDevices()`, drops
 * saved devices that are no longer attached.
 */
export function resolveTrackInputs(
  trackId: string,
  devices?: readonly Pick<MediaDeviceInfo, "deviceId" | "kind">[],
  storage: ReadStorage = defaultStorage(),
): ResolvedRecordInputs {
  const override = readTrackRecordInputs(storage)[trackId] ?? {};
  return {
    video: resolveKind(
      "video",
      override.video,
      readDefaultRecordInput("video", storage),
      devices,
    ),
    audio: resolveKind(
      "audio",
      override.audio,
      readDefaultRecordInput("audio", storage),
      devices,
    ),
  };
}

/** The `getUserMedia` constraints for `inputs`; null when both are None. */
export function getRecordMediaConstraints(
  inputs: ResolvedRecordInputs,
): MediaStreamConstraints | null {
  if (inputs.video === null && inputs.audio === null) {
    return null;
  }
  const constraint = (input: string | null | undefined) =>
    input === null ? false : input ? { deviceId: { exact: input } } : true;
  return { video: constraint(inputs.video), audio: constraint(inputs.audio) };
}
