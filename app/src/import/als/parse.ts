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
  /** Layers Record plugin state, or `null` when the track has no such device. */
  layers: LayersState | null;
  /** True when the track carries a Layers Record device. */
  isVideoTrack: boolean;
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
  const digits = hex.replace(/\s+/g, "");
  if (digits.length % 2 !== 0 || /[^0-9a-fA-F]/.test(digits)) {
    throw new Error("Layers Record state is not valid hex");
  }
  const bytes = new Uint8Array(digits.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(digits.slice(i * 2, i * 2 + 2), 16);
  }
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

  // Live 12 renamed MasterTrack to MainTrack.
  const master = child(liveSet, "MasterTrack") ?? child(liveSet, "MainTrack");
  if (!master) throw new Error("Ableton Live set has no master track");
  const mixer = at(master, "DeviceChain/Mixer");
  const tempo = child(mixer, "Tempo");
  const timeSignature = child(mixer, "TimeSignature");
  const transport = child(liveSet, "Transport");
  // Live keeps the song's signature in the envelope's initial event and can
  // leave `Manual` stale (e.g. still 4/4 after switching to 7/8).
  const [initialTimeSignature] = envelopeEvents(master, timeSignature);

  return {
    creator: ableton.attributes.Creator ?? "",
    majorVersion: ableton.attributes.MajorVersion ?? "",
    minorVersion: ableton.attributes.MinorVersion ?? "",
    tempo: num(tempo, "Manual"),
    tempoAutomation: envelopeEvents(master, tempo).map((event) => ({
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
  const layersDevice = deviceChain
    ? findAll(deviceChain, "PluginDevice").find(
        (device) =>
          str(at(device, "PluginDesc/Vst3PluginInfo"), "Name") ===
          LAYERS_RECORD_PLUGIN_NAME,
      )
    : undefined;
  const processorState = layersDevice
    ? findAll(layersDevice, "ProcessorState")[0]
    : undefined;
  const groupId = num(element, "TrackGroupId");

  return {
    id: Number(element.attributes.Id),
    kind: TRACK_KINDS[element.name],
    name: str(child(element, "Name"), "EffectiveName"),
    color: num(element, "Color"),
    groupId: groupId >= 0 ? groupId : null,
    clips: arrangementClips(deviceChain),
    layers: processorState ? decodeLayersState(processorState.text) : null,
    isVideoTrack: layersDevice !== undefined,
  };
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
