// File ▸ Save: where a session is written, and the `.lvp` it is written as.
//
// A session opened from a file path (the desktop build) saves back to that
// path, including after a refresh restores it. Sessions opened from a browser
// `File`, a workspace folder or an Ableton Live set import have no path the
// app can write to, so they prompt for a location. An imported set is never
// written back: its picker suggests the sibling `.lvp`.

import { alsSavePath } from "./als-import.ts";
import { type ClipWarp, warpSampleStartSeconds } from "./clip-warp.ts";
import { renameClipEffectTracks } from "./fx-stack.ts";
import type { LvpLayerClip, LvpSession } from "./session.ts";
import type { WorkspaceSessionSource } from "./workspace-session.ts";

export const SESSION_FILE_EXTENSION = ".lvp";
const DEFAULT_SESSION_FILENAME = `zvid-session${SESSION_FILE_EXTENSION}`;

export type SessionSaveTarget =
  | { kind: "path"; path: string }
  | { kind: "prompt"; filename: string };

function basename(rawPath: string) {
  return rawPath.split(/[/\\]/).filter(Boolean).pop() ?? rawPath;
}

// A session filename the picker can suggest: `.lvp` and `.json` sessions keep
// their name, anything else gets `.lvp`.
function sessionFilename(name: string | null | undefined) {
  const trimmed = basename(name?.trim() ?? "");
  if (!trimmed) {
    return DEFAULT_SESSION_FILENAME;
  }
  if (/\.(lvp|json)$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed.replace(/\.als$/i, "")}${SESSION_FILE_EXTENSION}`;
}

export function chooseSessionSaveTarget(
  source: WorkspaceSessionSource,
  sessionName: string | null,
): SessionSaveTarget {
  switch (source.kind) {
    case "path":
      return { kind: "path", path: source.path };
    case "import":
      return {
        kind: "prompt",
        filename: sessionFilename(
          alsSavePath(source.name || sessionName || ""),
        ),
      };
    case "file":
    case "workspace":
      return { kind: "prompt", filename: sessionFilename(source.name) };
    default:
      return { kind: "prompt", filename: sessionFilename(sessionName) };
  }
}

export type SaveableLane = {
  id: string;
  name: string;
  colorIndex: number;
  fxEnabled?: boolean;
};

export type SaveableSourceTrack = {
  id: string;
  name: string;
  colorIndex: number;
  recordingPaths: string[];
};

export type SaveableSourceSpan = {
  id: string;
  sourceTrackId: string;
  label: string;
  mediaPath: string;
  startQ: number;
  durationSeconds: number;
  trimStartSeconds: number;
  warp?: ClipWarp;
};

export type SaveableClip = {
  id: string;
  kind?: "fill" | "text" | "fx";
  sourceSpanId?: string;
  sourceTrackId: string;
  laneId: string;
  startQ: number;
  durationSeconds: number;
  // Source position minus song position, in seconds.
  sourceOffsetSeconds?: number;
};

export type SaveableEffect = {
  id: string;
  trackId: string;
  effectName: string;
  parameters: Array<{ key: string; value: string; numericValue?: number }>;
  enabled?: boolean;
};

export type SaveableProject = {
  bpm: number;
  fps: number;
  canvasWidth: number;
  canvasHeight: number;
  zoom: number;
  timelineMode: string;
  snapEnabled: boolean;
  lanes: SaveableLane[];
  sourceTracks: SaveableSourceTrack[];
  sourceSpans: SaveableSourceSpan[];
  clips: SaveableClip[];
  effects: SaveableEffect[];
  mediaItems: Array<{ id: string; name: string; sourcePath?: string }>;
  mainAudioId?: string;
  projectDurationFrames?: number;
};

export type SaveableView = {
  playheadQ: number;
  selectedClipId?: string;
};

const SOURCE_SPAN_ID_PREFIX = "source-";
const SELECTION_ID_PATTERN = /^selection-(\d+)$/;
// Offsets closer than this to their span's are not slipped.
const SLIP_EPSILON_SECONDS = 1e-6;

function toFrames(seconds: number, fps: number) {
  return Math.round(seconds * fps);
}

function quartersToSeconds(quarters: number, bpm: number) {
  return (quarters * 60) / bpm;
}

// The source offset a clip gets from span `span` when it is opened.
function spanSourceOffsetSeconds(span: SaveableSourceSpan, bpm: number) {
  return span.trimStartSeconds - quartersToSeconds(span.startQ, bpm);
}

function secondsToQuarters(seconds: number, bpm: number) {
  return (seconds * bpm) / 60;
}

function sourceClipId(spanId: string) {
  return spanId.startsWith(SOURCE_SPAN_ID_PREFIX)
    ? spanId.slice(SOURCE_SPAN_ID_PREFIX.length)
    : spanId;
}

// Opening a session places a span's source at `clipStart + frameOffset +
// captureOffset` and anchors its warp at `clipStart + frameOffset`, so a
// warped span writes the anchor's source position as `clipStart` and the
// rest as `captureOffset`.
function spanSourceFrames(span: SaveableSourceSpan, fps: number) {
  const trimFrames = Math.max(0, toFrames(span.trimStartSeconds, fps));
  if (!span.warp) {
    return { clipStart: trimFrames };
  }
  const sampleStartFrames = toFrames(warpSampleStartSeconds(span.warp), fps);
  const captureOffset = trimFrames - sampleStartFrames;
  // A capture offset of -1 marks an imported video and is read as 0.
  if (captureOffset === 0 || captureOffset === -1) {
    return { clipStart: trimFrames };
  }
  return { clipStart: sampleStartFrames, captureOffset };
}

function toLvpParameters(parameters: SaveableEffect["parameters"]) {
  const result: NonNullable<
    NonNullable<LvpSession["effects"]>[number]["parameters"]
  > = {};
  for (const parameter of parameters) {
    result[parameter.key] =
      typeof parameter.numericValue === "number" &&
      Number.isFinite(parameter.numericValue)
        ? { floatValue: parameter.numericValue }
        : { stringValue: parameter.value };
  }
  return result;
}

// A clip slipped off its span's source offset keeps its span and offset in
// zvid-only fields; any other clip is found by track and position on open.
function selectionSlip(
  clip: SaveableClip,
  spans: SaveableSourceSpan[],
  bpm: number,
) {
  const span = spans.find((candidate) => candidate.id === clip.sourceSpanId);
  if (
    !span ||
    clip.sourceOffsetSeconds === undefined ||
    Math.abs(clip.sourceOffsetSeconds - spanSourceOffsetSeconds(span, bpm)) <
      SLIP_EPSILON_SECONDS
  ) {
    return {};
  }
  return {
    sourceClipId: sourceClipId(span.id),
    sourceOffsetSeconds: clip.sourceOffsetSeconds,
  };
}

// Writes the project as a `.lvp` session that opens back into the same
// arrangement. Selections point at their source clip by track and position,
// the way the Layers app stores them. Fill and text clips, bypass flags and
// slipped clips go in zvid-only fields the Layers app ignores.
export function projectToLvpSession(
  project: SaveableProject,
  view: SaveableView,
): LvpSession {
  const { bpm, fps } = project;

  const clips = project.sourceSpans.map<
    NonNullable<LvpSession["clips"]>[number]
  >((span) => {
    const clipId = sourceClipId(span.id);
    return {
      id: clipId,
      trackId: span.sourceTrackId,
      name: span.label,
      frameStart: toFrames(quartersToSeconds(span.startQ, bpm), fps),
      frameCount: Math.max(1, toFrames(span.durationSeconds, fps)),
      ...spanSourceFrames(span, fps),
      filePath: span.mediaPath,
      ...(span.warp
        ? {
            warpMarkers: span.warp.markers.map((marker, index) => ({
              id: `${clipId}-warp-${index}`,
              clipId,
              secTime: marker.secTime,
              beatTime: marker.beatTime,
            })),
          }
        : {}),
    };
  });

  const mediaClips = project.clips.filter(
    (clip) =>
      clip.kind !== "fill" && clip.kind !== "text" && clip.kind !== "fx",
  );
  const usedSelectionIds = new Set<number>();
  for (const clip of mediaClips) {
    const match = SELECTION_ID_PATTERN.exec(clip.id);
    if (match) {
      usedSelectionIds.add(Number(match[1]));
    }
  }
  let nextSelectionId = 0;
  const allocateSelectionId = (clipId: string) => {
    const match = SELECTION_ID_PATTERN.exec(clipId);
    if (match) {
      return Number(match[1]);
    }
    while (usedSelectionIds.has(nextSelectionId)) {
      nextSelectionId += 1;
    }
    usedSelectionIds.add(nextSelectionId);
    return nextSelectionId;
  };
  // Media clips load back as `selection-<id>`, so their own effect stacks are
  // saved under that id too.
  const savedClipIds = new Map<string, string>();
  const selections = mediaClips.map<
    NonNullable<LvpSession["selections"]>[number]
  >((clip) => {
    const frameStart = toFrames(quartersToSeconds(clip.startQ, bpm), fps);
    const id = allocateSelectionId(clip.id);
    savedClipIds.set(clip.id, `selection-${id}`);
    return {
      id,
      trackId: clip.sourceTrackId,
      mainTrackId: clip.laneId,
      frameStart,
      frameEnd: frameStart + Math.max(1, toFrames(clip.durationSeconds, fps)),
      ...(clip.id === view.selectedClipId ? { selected: true } : {}),
      ...selectionSlip(clip, project.sourceSpans, bpm),
    };
  });
  const layerClips = (kind: "fill" | "text" | "fx") =>
    project.clips
      .filter((clip) => clip.kind === kind)
      .map<LvpLayerClip>((clip) => {
        const frameStart = toFrames(quartersToSeconds(clip.startQ, bpm), fps);
        return {
          id: clip.id,
          mainTrackId: clip.laneId,
          frameStart,
          frameEnd:
            frameStart + Math.max(1, toFrames(clip.durationSeconds, fps)),
          ...(clip.id === view.selectedClipId ? { selected: true } : {}),
        };
      });
  const fills = layerClips("fill");
  const texts = layerClips("text");
  const fxClips = layerClips("fx");

  const mainAudio = project.mainAudioId
    ? project.mediaItems.find((item) => item.id === project.mainAudioId)
    : undefined;

  const session: LvpSession = {
    mainTracks: project.lanes.map((lane) => ({
      id: lane.id,
      name: lane.name,
      colorIndex: lane.colorIndex,
      ...(lane.fxEnabled === false ? { fxEnabled: false } : {}),
    })),
    tracks: project.sourceTracks.map((track) => ({
      id: track.id,
      name: track.name,
      colorIndex: track.colorIndex,
      recordings: track.recordingPaths.map((filename) => ({ filename })),
    })),
    clips,
    selections,
    ...(fills.length ? { fills } : {}),
    ...(texts.length ? { texts } : {}),
    ...(fxClips.length ? { fxClips } : {}),
    effects: renameClipEffectTracks(project.effects, savedClipIds).map(
      (effect) => ({
        id: effect.id,
        trackId: effect.trackId,
        effectName: effect.effectName,
        parameters: toLvpParameters(effect.parameters),
        ...(effect.enabled === false ? { enabled: false } : {}),
      }),
    ),
    timeline: {
      bpm,
      fps,
      canvasWidth: project.canvasWidth,
      canvasHeight: project.canvasHeight,
      displaySeconds: project.timelineMode === "timecode",
      snapToBeat: project.snapEnabled,
      zoom: project.zoom,
      ...(project.projectDurationFrames !== undefined
        ? { projectDuration: project.projectDurationFrames }
        : {}),
    },
    playPosition: toFrames(quartersToSeconds(view.playheadQ, bpm), fps),
    ...(mainAudio
      ? { audioFilename: mainAudio.sourcePath ?? mainAudio.name }
      : {}),
    // The effects are written as they are, so a removed Order stays removed.
    orderDefaulted: true,
    // Text and Color are written on the clips that carry them.
    clipContentEffects: true,
  };

  return session;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

export type SelectionSlip = {
  sourceSpanId: string;
  sourceOffsetSeconds: number;
};

// The source span and offset a slipped selection was saved with, or
// undefined for a selection that plays the span it falls in. Session files
// are unchecked JSON, so malformed fields read as no slip.
export function readSelectionSlip(
  selection: NonNullable<LvpSession["selections"]>[number],
): SelectionSlip | undefined {
  const { sourceClipId: clipId, sourceOffsetSeconds } = selection;
  if (!isNonEmptyString(clipId) || !isFiniteNumber(sourceOffsetSeconds)) {
    return undefined;
  }
  return {
    sourceSpanId: `${SOURCE_SPAN_ID_PREFIX}${clipId}`,
    sourceOffsetSeconds,
  };
}

export type SessionLayerClip = {
  id: string;
  laneId: string;
  startQ: number;
  durationQ: number;
  selected: boolean;
};

function readLayerClips(
  entries: unknown,
  bpm: number,
  fps: number,
): SessionLayerClip[] {
  const clips: SessionLayerClip[] = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const clip = entry as Partial<LvpLayerClip> | null;
    if (
      !isNonEmptyString(clip?.id) ||
      !isNonEmptyString(clip.mainTrackId) ||
      !isFiniteNumber(clip.frameStart) ||
      !isFiniteNumber(clip.frameEnd)
    ) {
      continue;
    }
    clips.push({
      id: clip.id,
      laneId: clip.mainTrackId,
      startQ: secondsToQuarters(clip.frameStart / fps, bpm),
      durationQ: secondsToQuarters(
        Math.max(1, clip.frameEnd - clip.frameStart) / fps,
        bpm,
      ),
      selected: clip.selected === true,
    });
  }
  return clips;
}

// The fill clips a session was saved with, skipping malformed entries.
export function readSessionFills(
  session: LvpSession,
  bpm: number,
  fps: number,
): SessionLayerClip[] {
  return readLayerClips(session.fills, bpm, fps);
}

// The text clips a session was saved with, skipping malformed entries.
export function readSessionTexts(
  session: LvpSession,
  bpm: number,
  fps: number,
): SessionLayerClip[] {
  return readLayerClips(session.texts, bpm, fps);
}

// The FX clips a session was saved with, skipping malformed entries.
export function readSessionFxClips(
  session: LvpSession,
  bpm: number,
  fps: number,
): SessionLayerClip[] {
  return readLayerClips(session.fxClips, bpm, fps);
}
