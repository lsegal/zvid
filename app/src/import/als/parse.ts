// Parses Ableton Live `.als` sets (gzip-compressed XML) into a typed model.
// Values are kept in Live's own units (beats, samples, seconds); converting
// between them and mapping to zvid layers happens elsewhere.

import { at, child, findAll, parseXml, type XmlElement } from "./xml.ts";

export type AlsTrackKind = "midi" | "audio" | "group" | "return";
export type AlsClipKind = "midi" | "audio";

/** One recording made by the Layers Record plugin on a track. */
export interface LayersRecording {
  filename: string;
  /** `[width, height]` in pixels. */
  dimensions: [number, number];
  /** Frame rate as a `[numerator, denominator]` fraction. */
  fps: [number, number];
  frameStart: number;
}

/** Decoded `ProcessorState` of a Layers Record plugin instance. */
export interface LayersState {
  version: string;
  recordings: LayersRecording[];
}

/** Where ZVID Capture wrote its files; `filename` is relative to it. */
export type RecordRoot = "project" | "documents";

/** One transport play→stop span captured by ZVID Capture. */
export interface ZvidCaptureTake extends LayersRecording {
  /** Seconds into the file where playback started. */
  fileOffsetSec: number;
  /** Song time at play start, or `null` for an unanchored capture. */
  transportStartSec: number | null;
  transportStartBeats: number | null;
  durationSec: number;
  /** ISO 8601 timestamp, or `""` when the plugin did not save one. */
  createdAt: string;
  /**
   * The root this take's file is under, chosen when its capture armed.
   * Absent in states saved before roots were kept per take; those use the
   * state's `recordRoot`.
   */
  recordRoot?: RecordRoot;
}

/** Decoded state of a ZVID Capture plugin instance (Layers-compatible). */
export interface ZvidCaptureState extends LayersState {
  /** The latest capture's root, for takes without their own. */
  recordRoot: RecordRoot;
  recordings: ZvidCaptureTake[];
}

export type CaptureDeviceKind = "layers-record" | "zvid-capture";

export interface AlsWarpMarker {
  secTime: number;
  beatTime: number;
}

/** Clip-content loop settings, in clip beats. */
export interface AlsClipLoop {
  loopStart: number;
  loopEnd: number;
  startRelative: number;
  loopOn: boolean;
  hiddenLoopStart: number;
  hiddenLoopEnd: number;
}

export interface AlsSampleRef {
  /** Absolute path as saved by Live (may be Windows-style). */
  path: string;
  /** Path relative to the project folder, when Live recorded one. */
  relativePath: string;
  /** Length of the sample in samples. */
  defaultDuration: number;
  defaultSampleRate: number;
}

export interface AlsClip {
  id: number;
  kind: AlsClipKind;
  name: string;
  /** Arrangement position of the clip, in beats. */
  time: number;
  currentStart: number;
  currentEnd: number;
  disabled: boolean;
  loop: AlsClipLoop;
  isWarped: boolean;
  warpMode: number;
  warpMarkers: AlsWarpMarker[];
  /** Audio clips only. */
  sample: AlsSampleRef | null;
}

export interface AlsTrack {
  id: number;
  kind: AlsTrackKind;
  name: string;
  color: number;
  /** Id of the containing group track, or `null` at the top level. */
  groupId: number | null;
  /** Arrangement clips; session-view clip slots are ignored. */
  clips: AlsClip[];
  /**
   * State of the track's capture device, or `null` when it has none. A
   * `"zvid-capture"` device's state is a `ZvidCaptureState`.
   */
  layers: LayersState | null;
  /** True when the track carries a Layers Record or ZVID Capture device. */
  isVideoTrack: boolean;
  /** Which capture device the track carries; absent means Layers Record. */
  captureDevice?: CaptureDeviceKind | null;
}

export interface AlsTempoPoint {
  /** Beats; Live stores the initial point at `-63072000`. */
  time: number;
  bpm: number;
}

export interface AlsTimeSignature {
  numerator: number;
  denominator: number;
}

export interface AlsTransport {
  currentTime: number;
  loopOn: boolean;
  loopStart: number;
  loopLength: number;
}

export interface AlsDocument {
  creator: string;
  majorVersion: string;
  minorVersion: string;
  tempo: number;
  /** Tempo automation points; a single point means a constant tempo. */
  tempoAutomation: AlsTempoPoint[];
  timeSignature: AlsTimeSignature;
  transport: AlsTransport;
  tracks: AlsTrack[];
}

export const LAYERS_RECORD_PLUGIN_NAME = "Layers Record";
export const ZVID_CAPTURE_PLUGIN_NAME = "ZVID Capture";

type PluginFormat = "vst3" | "au";

/** A plugin that records video on its track, and how to read its state. */
interface CaptureDevice {
  kind: CaptureDeviceKind;
  /** Names Live saves in the plugin info, per supported format. */
  names: Partial<Record<PluginFormat, readonly string[]>>;
  decode(device: XmlElement, format: PluginFormat): LayersState | null;
}

const PLUGIN_FORMATS: Record<PluginFormat, { device: string; info: string }> = {
  vst3: { device: "PluginDevice", info: "Vst3PluginInfo" },
  au: { device: "AuPluginDevice", info: "AuPluginInfo" },
};

/** Known capture devices, in lookup order. */
const CAPTURE_DEVICES: readonly CaptureDevice[] = [
  {
    kind: "layers-record",
    names: { vst3: [LAYERS_RECORD_PLUGIN_NAME] },
    decode: (device) => {
      const [state] = findAll(device, "ProcessorState");
      return state ? decodeLayersState(state.text) : null;
    },
  },
  {
    kind: "zvid-capture",
    // Some hosts show an AU as "<Manufacturer>: <Name>".
    names: {
      vst3: [ZVID_CAPTURE_PLUGIN_NAME],
      au: [ZVID_CAPTURE_PLUGIN_NAME, `ZVID: ${ZVID_CAPTURE_PLUGIN_NAME}`],
    },
    decode: (device, format) => {
      const [state] = findAll(
        device,
        format === "au" ? "Buffer" : "ProcessorState",
      );
      if (!state) return null;
      return format === "au"
        ? decodeZvidCaptureAuBuffer(state.text)
        : decodeZvidCaptureState(hexToBytes(state.text));
    },
  },
];

const TRACK_KINDS: Record<string, AlsTrackKind> = {
  MidiTrack: "midi",
  AudioTrack: "audio",
  GroupTrack: "group",
  ReturnTrack: "return",
};

const CLIP_KINDS: Record<string, AlsClipKind> = {
  MidiClip: "midi",
  AudioClip: "audio",
};

/** Decodes Live's packed time signature value, e.g. `201` → 4/4. */
export function decodeTimeSignature(value: number): AlsTimeSignature {
  return {
    numerator: (value % 99) + 1,
    denominator: 2 ** Math.floor(value / 99),
  };
}

/** Decodes the hex-encoded JSON `ProcessorState` of a Layers Record device. */
export function decodeLayersState(hex: string): LayersState {
  const bytes = hexToBytes(hex, "Layers Record state");
  const state = JSON.parse(new TextDecoder().decode(bytes)) as {
    version?: unknown;
    recordings?: Array<Record<string, unknown>>;
  };
  return {
    version: String(state.version ?? ""),
    recordings: (state.recordings ?? []).map((recording) => ({
      filename: String(recording.filename ?? ""),
      dimensions: pair(recording.dimensions),
      fps: pair(recording.fps),
      frameStart: Number(recording.frameStart ?? 0),
    })),
  };
}

/** Decodes the UTF-8 JSON state a ZVID Capture instance saves. */
export function decodeZvidCaptureState(bytes: Uint8Array): ZvidCaptureState {
  const state = JSON.parse(new TextDecoder().decode(bytes)) as {
    version?: unknown;
    recordRoot?: unknown;
    recordings?: Array<Record<string, unknown>>;
  };
  return {
    version: String(state.version ?? ""),
    recordRoot: state.recordRoot === "project" ? "project" : "documents",
    recordings: (state.recordings ?? []).map((recording) => ({
      filename: String(recording.filename ?? ""),
      dimensions: pair(recording.dimensions),
      fps: pair(recording.fps),
      frameStart: Number(recording.frameStart ?? 0),
      fileOffsetSec: Number(recording.fileOffsetSec ?? 0),
      transportStartSec: nullableNumber(recording.transportStartSec),
      transportStartBeats: nullableNumber(recording.transportStartBeats),
      durationSec: Number(recording.durationSec ?? 0),
      createdAt: String(recording.createdAt ?? ""),
      ...(isRecordRoot(recording.recordRoot) && {
        recordRoot: recording.recordRoot,
      }),
    })),
  };
}

function isRecordRoot(value: unknown): value is RecordRoot {
  return value === "project" || value === "documents";
}

/**
 * Decodes ZVID Capture's AU state: the hex-encoded ClassInfo property list
 * Live saves in `<Buffer>`, whose `zvid-state` data key holds the JSON.
 */
export function decodeZvidCaptureAuBuffer(hex: string): ZvidCaptureState {
  const bytes = hexToBytes(hex, "ZVID Capture AU state");
  const state = plistDataValue(bytes, ZVID_STATE_KEY);
  if (!state) {
    throw new Error(`ZVID Capture AU state has no "${ZVID_STATE_KEY}" key`);
  }
  return decodeZvidCaptureState(state);
}

const ZVID_STATE_KEY = "zvid-state";

function hexToBytes(hex: string, label = "ZVID Capture state"): Uint8Array {
  const digits = hex.replace(/\s+/g, "");
  if (digits.length % 2 !== 0 || /[^0-9a-fA-F]/.test(digits)) {
    throw new Error(`${label} is not valid hex`);
  }
  const bytes = new Uint8Array(digits.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(digits.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** The `<data>` value of `key` in a top-level XML or binary plist dict. */
function plistDataValue(bytes: Uint8Array, key: string): Uint8Array | null {
  const text = new TextDecoder().decode(bytes.subarray(0, 8));
  if (text === "bplist00") return binaryPlistDataValue(bytes, key);

  const dict = child(parseXml(new TextDecoder().decode(bytes)), "dict");
  const entries = dict?.children ?? [];
  const index = entries.findIndex(
    (entry) => entry.name === "key" && entry.text === key,
  );
  const value = entries[index + 1];
  if (index < 0 || value?.name !== "data") return null;
  const binary = atob(value.text.replace(/\s+/g, ""));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Reads one data value from a `bplist00` file's top-level dict. */
function binaryPlistDataValue(
  bytes: Uint8Array,
  key: string,
): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const uint = (offset: number, size: number) => {
    let value = 0;
    for (let i = 0; i < size; i++) value = value * 256 + bytes[offset + i];
    return value;
  };
  const trailer = bytes.length - 32;
  if (trailer < 8) return null;
  const offsetSize = view.getUint8(trailer + 6);
  const refSize = view.getUint8(trailer + 7);
  const topObject = uint(trailer + 16, 8);
  const offsetTable = uint(trailer + 24, 8);
  const objectOffset = (ref: number) =>
    uint(offsetTable + ref * offsetSize, offsetSize);

  // Returns the object's type nibble and where its length-prefixed body starts.
  const header = (offset: number) => {
    const marker = bytes[offset];
    let length = marker & 0x0f;
    let start = offset + 1;
    if (length === 0x0f) {
      const size = 2 ** (bytes[start] & 0x0f);
      length = uint(start + 1, size);
      start += 1 + size;
    }
    return { type: marker >> 4, length, start };
  };
  const object = (ref: number) => header(objectOffset(ref));
  const string = (ref: number) => {
    const { type, length, start } = object(ref);
    if (type === 0x5) {
      return new TextDecoder("latin1").decode(
        bytes.subarray(start, start + length),
      );
    }
    if (type === 0x6) {
      let value = "";
      for (let i = 0; i < length; i++) {
        value += String.fromCharCode(view.getUint16(start + i * 2));
      }
      return value;
    }
    return null;
  };

  const dict = object(topObject);
  if (dict.type !== 0xd) return null;
  for (let i = 0; i < dict.length; i++) {
    if (string(uint(dict.start + i * refSize, refSize)) !== key) continue;
    const value = object(
      uint(dict.start + (dict.length + i) * refSize, refSize),
    );
    return value.type === 0x4
      ? bytes.slice(value.start, value.start + value.length)
      : null;
  }
  return null;
}

export async function parseAls(bytes: Uint8Array): Promise<AlsDocument> {
  return parseAlsXml(await decompress(bytes));
}

export function parseAlsXml(xml: string): AlsDocument {
  const ableton = parseXml(xml);
  if (ableton.name !== "Ableton") {
    throw new Error("Not an Ableton Live set: missing <Ableton> root");
  }
  const liveSet = child(ableton, "LiveSet");
  if (!liveSet) throw new Error("Not an Ableton Live set: missing <LiveSet>");

  // Live 12 renamed MasterTrack to MainTrack. Older sets still use MasterTrack.
  const mainTrack =
    child(liveSet, "MasterTrack") ?? child(liveSet, "MainTrack");
  if (!mainTrack) throw new Error("Ableton Live set has no main track");
  const mixer = at(mainTrack, "DeviceChain/Mixer");
  const tempo = child(mixer, "Tempo");
  const timeSignature = child(mixer, "TimeSignature");
  const transport = child(liveSet, "Transport");
  // Live keeps the song's signature in the envelope's initial event and can
  // leave `Manual` stale (e.g. still 4/4 after switching to 7/8).
  const [initialTimeSignature] = envelopeEvents(mainTrack, timeSignature);

  return {
    creator: ableton.attributes.Creator ?? "",
    majorVersion: ableton.attributes.MajorVersion ?? "",
    minorVersion: ableton.attributes.MinorVersion ?? "",
    tempo: num(tempo, "Manual"),
    tempoAutomation: envelopeEvents(mainTrack, tempo).map((event) => ({
      time: Number(event.attributes.Time),
      bpm: Number(event.attributes.Value),
    })),
    timeSignature: decodeTimeSignature(
      initialTimeSignature
        ? Number(initialTimeSignature.attributes.Value)
        : num(timeSignature, "Manual"),
    ),
    transport: {
      currentTime: num(transport, "CurrentTime"),
      loopOn: bool(transport, "LoopOn"),
      loopStart: num(transport, "LoopStart"),
      loopLength: num(transport, "LoopLength"),
    },
    tracks: (child(liveSet, "Tracks")?.children ?? [])
      .filter((element) => element.name in TRACK_KINDS)
      .map(parseTrack),
  };
}

function parseTrack(element: XmlElement): AlsTrack {
  const deviceChain = child(element, "DeviceChain");
  const capture = deviceChain ? findCaptureDevice(deviceChain) : null;
  const groupId = num(element, "TrackGroupId");

  return {
    id: Number(element.attributes.Id),
    kind: TRACK_KINDS[element.name],
    name: str(child(element, "Name"), "EffectiveName"),
    color: num(element, "Color"),
    groupId: groupId >= 0 ? groupId : null,
    clips: arrangementClips(deviceChain),
    layers: capture?.state ?? null,
    isVideoTrack: capture !== null,
    captureDevice: capture?.kind ?? null,
  };
}

/** The first known capture device on the chain, with its decoded state. */
function findCaptureDevice(deviceChain: XmlElement) {
  for (const capture of CAPTURE_DEVICES) {
    for (const [format, names] of Object.entries(capture.names) as Array<
      [PluginFormat, readonly string[]]
    >) {
      const { device: deviceName, info } = PLUGIN_FORMATS[format];
      const device = findAll(deviceChain, deviceName).find((candidate) =>
        names.includes(str(at(candidate, `PluginDesc/${info}`), "Name")),
      );
      if (device) {
        return { kind: capture.kind, state: capture.decode(device, format) };
      }
    }
  }
  return null;
}

/** Clips in `MainSequencer/{ClipTimeable|Sample}/ArrangerAutomation/Events`. */
function arrangementClips(deviceChain: XmlElement | undefined): AlsClip[] {
  const sequencer = child(deviceChain, "MainSequencer");
  if (!sequencer) return [];
  const [arranger] = findAll(sequencer, "ArrangerAutomation");
  return (child(arranger, "Events")?.children ?? [])
    .filter((element) => element.name in CLIP_KINDS)
    .map(parseClip);
}

function parseClip(element: XmlElement): AlsClip {
  const loop = child(element, "Loop");
  const sampleRef = child(element, "SampleRef");
  const fileRef = child(sampleRef, "FileRef");
  return {
    id: Number(element.attributes.Id),
    kind: CLIP_KINDS[element.name],
    name: str(element, "Name"),
    time: Number(element.attributes.Time),
    currentStart: num(element, "CurrentStart"),
    currentEnd: num(element, "CurrentEnd"),
    disabled: bool(element, "Disabled"),
    loop: {
      loopStart: num(loop, "LoopStart"),
      loopEnd: num(loop, "LoopEnd"),
      startRelative: num(loop, "StartRelative"),
      loopOn: bool(loop, "LoopOn"),
      hiddenLoopStart: num(loop, "HiddenLoopStart"),
      hiddenLoopEnd: num(loop, "HiddenLoopEnd"),
    },
    isWarped: bool(element, "IsWarped"),
    warpMode: num(element, "WarpMode"),
    warpMarkers: (child(element, "WarpMarkers")?.children ?? [])
      .filter((marker) => marker.name === "WarpMarker")
      .map((marker) => ({
        secTime: Number(marker.attributes.SecTime),
        beatTime: Number(marker.attributes.BeatTime),
      })),
    sample: sampleRef
      ? {
          path: str(fileRef, "Path"),
          relativePath: str(fileRef, "RelativePath"),
          defaultDuration: num(sampleRef, "DefaultDuration"),
          defaultSampleRate: num(sampleRef, "DefaultSampleRate"),
        }
      : null,
  };
}

/** Automation events of the envelope targeting `parameter`'s AutomationTarget. */
function envelopeEvents(
  track: XmlElement,
  parameter: XmlElement | undefined,
): XmlElement[] {
  const targetId = child(parameter, "AutomationTarget")?.attributes.Id;
  if (targetId === undefined) return [];
  const envelope = at(track, "AutomationEnvelopes/Envelopes")?.children.find(
    (candidate) =>
      str(child(candidate, "EnvelopeTarget"), "PointeeId") === targetId,
  );
  return at(envelope, "Automation/Events")?.children ?? [];
}

async function decompress(bytes: Uint8Array): Promise<string> {
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!isGzip) return new TextDecoder().decode(bytes);
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

function str(element: XmlElement | undefined, name: string): string {
  return child(element, name)?.attributes.Value ?? "";
}

function num(element: XmlElement | undefined, name: string): number {
  const value = child(element, name)?.attributes.Value;
  return value === undefined ? Number.NaN : Number(value);
}

function bool(element: XmlElement | undefined, name: string): boolean {
  return child(element, name)?.attributes.Value === "true";
}

function pair(value: unknown): [number, number] {
  const [a, b] = Array.isArray(value) ? value : [];
  return [Number(a ?? 0), Number(b ?? 0)];
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
