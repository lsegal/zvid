// File ▸ Export ▸ Project…: the `.zvd` filename it suggests, and the session
// it writes. The session goes into a `.zvd` project archive as its
// `project.json` (see project-archive-export.ts). Exporting always asks where
// to write, even for a session opened from a path.

import { type ClipWarp, warpSampleStartSeconds } from "./clip-warp.ts";
import type { EffectAnimation } from "./fx-animation-defaults.ts";
import type { EffectModulation } from "./fx-modulation-defaults.ts";
import {
  pruneExcludedLayers,
  pruneMaskTargets,
  renameClipEffectTracks,
  renameSourceClipEffectTracks,
} from "./fx-stack.ts";
import type { MediaItem } from "./media.ts";
import { type SavedMediaRange, savedMediaRanges } from "./media-range.ts";
import type { ProjectLayerClip, ProjectSession } from "./session.ts";
import type { SessionEncoding } from "./session-settings.ts";
import {
  getClipTrackOffsetSeconds,
  type TrackContentSpan,
} from "./source-track-content.ts";
import type { WorkspaceSessionSource } from "./workspace-session.ts";

export const PROJECT_FILE_EXTENSION = ".zvd";
const DEFAULT_PROJECT_FILENAME = `zvid-session${PROJECT_FILE_EXTENSION}`;

function basename(rawPath: string) {
  return rawPath.split(/[/\\]/).filter(Boolean).pop() ?? rawPath;
}

// The filename Export ▸ Project… suggests: the opened session's name, or the
// session's own name, with its session extension swapped for `.zvd`.
export function projectExportFilename(
  source: WorkspaceSessionSource,
  sessionName: string | null,
) {
  const name =
    source.kind === "none" ? sessionName : source.name || sessionName;
  const trimmed = basename(name?.trim() ?? "").replace(
    /\.(zvd|lvp|json|als)$/i,
    "",
  );
  return trimmed
    ? `${trimmed}${PROJECT_FILE_EXTENSION}`
    : DEFAULT_PROJECT_FILENAME;
}

export type SaveableLane = {
  id: string;
  name: string;
  colorIndex: number;
  fxEnabled?: boolean;
  hidden?: boolean;
};

export type SaveableSourceTrack = {
  id: string;
  name: string;
  colorIndex: number;
  recordingPaths: string[];
  fxEnabled?: boolean;
  hidden?: boolean;
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
  // Source position minus song position, in seconds, measured against the
  // source clip offset `sourceSpanOffsetSeconds` (see
  // source-track-content.ts).
  sourceOffsetSeconds?: number;
  sourceSpanOffsetSeconds?: number;
};

export type SaveableEffect = {
  id: string;
  trackId: string;
  effectName: string;
  parameters: Array<{ key: string; value: string; numericValue?: number }>;
  enabled?: boolean;
  animation?: EffectAnimation;
  modulation?: EffectModulation;
  defaulted?: boolean;
};

export type SaveableProject = {
  bpm: number;
  fps: number;
  canvasWidth: number;
  canvasHeight: number;
  encoding?: SessionEncoding;
  zoom: number;
  timelineMode: string;
  snapEnabled: boolean;
  lanes: SaveableLane[];
  sourceTracks: SaveableSourceTrack[];
  sourceSpans: SaveableSourceSpan[];
  clips: SaveableClip[];
  effects: SaveableEffect[];
  mediaItems: Array<
    Pick<
      MediaItem,
      "id" | "name" | "sourcePath" | "rangeInSeconds" | "rangeOutSeconds"
    >
  >;
  projectDurationFrames?: number;
  sourceTracksLocked?: boolean;
};

export type SaveableView = {
  playheadQ: number;
  selectedClipId?: string;
};

const SOURCE_SPAN_ID_PREFIX = "source-";
const SELECTION_ID_PATTERN = /^selection-(\d+)$/;
// Warp anchors closer than this to their span's start are not saved.
const SLIP_EPSILON_SECONDS = 1e-6;

function toFrames(seconds: number, fps: number) {
  return Math.round(seconds * fps);
}

function quartersToSeconds(quarters: number, bpm: number) {
  return (quarters * 60) / bpm;
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
// captureOffset` and anchors its warp at that position, so a warped span
// writes its warp's sample start as `clipStart` and the rest as
// `captureOffset`. A span whose start was trimmed keeps its warp anchored
// where it was, so the anchor goes in a zvid-only field.
function spanSourceFrames(span: SaveableSourceSpan, fps: number) {
  const trimFrames = Math.max(0, toFrames(span.trimStartSeconds, fps));
  if (!span.warp) {
    return { clipStart: trimFrames };
  }
  const anchor =
    Math.abs(span.warp.anchorSeconds - trimFrames / fps) < SLIP_EPSILON_SECONDS
      ? {}
      : { warpAnchorSeconds: span.warp.anchorSeconds };
  const sampleStartFrames = toFrames(warpSampleStartSeconds(span.warp), fps);
  const captureOffset = trimFrames - sampleStartFrames;
  // A capture offset of -1 marks an imported video and is read as 0.
  if (captureOffset === 0 || captureOffset === -1) {
    return { clipStart: trimFrames, ...anchor };
  }
  return { clipStart: sampleStartFrames, captureOffset, ...anchor };
}

function toSessionParameters(parameters: SaveableEffect["parameters"]) {
  const result: NonNullable<
    NonNullable<ProjectSession["effects"]>[number]["parameters"]
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

// A clip that shows its source track at another time than its own keeps
// that offset in a zvid-only field; any other shows the track at its own
// position on open.
function selectionTrackOffset(
  clip: SaveableClip,
  spans: SaveableSourceSpan[],
  bpm: number,
) {
  if (clip.sourceOffsetSeconds === undefined) {
    return {};
  }
  const sourceTrackOffsetSeconds = getClipTrackOffsetSeconds(
    {
      sourceSpanId: clip.sourceSpanId ?? "",
      sourceOffsetSeconds: clip.sourceOffsetSeconds,
      sourceSpanOffsetSeconds: clip.sourceSpanOffsetSeconds,
    },
    spans,
    bpm,
  );
  return sourceTrackOffsetSeconds === 0 ? {} : { sourceTrackOffsetSeconds };
}

// Writes the project as the `project.json` session that opens back into the same
// arrangement. Selections point at their source track by track and
// position, the way the Layers app stores them. Fill and text clips, bypass flags,
// animation settings and slipped clips go in zvid-only fields the Layers app
// ignores.
export function projectToSession(
  project: SaveableProject,
  view: SaveableView,
): ProjectSession {
  const { bpm, fps } = project;

  const clips = project.sourceSpans.map<
    NonNullable<ProjectSession["clips"]>[number]
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
    NonNullable<ProjectSession["selections"]>[number]
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
      ...selectionTrackOffset(clip, project.sourceSpans, bpm),
    };
  });
  const layerClips = (kind: "fill" | "text" | "fx") =>
    project.clips
      .filter((clip) => clip.kind === kind)
      .map<ProjectLayerClip>((clip) => {
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

  const mediaRanges = savedMediaRanges(project.mediaItems);

  const session: ProjectSession = {
    mainTracks: project.lanes.map((lane) => ({
      id: lane.id,
      name: lane.name,
      colorIndex: lane.colorIndex,
      ...(lane.fxEnabled === false ? { fxEnabled: false } : {}),
      ...(lane.hidden ? { hidden: true } : {}),
    })),
    tracks: project.sourceTracks.map((track) => ({
      id: track.id,
      name: track.name,
      colorIndex: track.colorIndex,
      ...(track.fxEnabled === false ? { fxEnabled: false } : {}),
      ...(track.hidden ? { hidden: true } : {}),
      recordings: track.recordingPaths.map((filename) => ({ filename })),
    })),
    clips,
    selections,
    ...(fills.length ? { fills } : {}),
    ...(texts.length ? { texts } : {}),
    ...(fxClips.length ? { fxClips } : {}),
    // An Order only keeps exclusions of layers that still exist, and a Mask
    // only a Target that still exists. Source
    // clips load back as `source-<clip id>`, so their own stacks are saved
    // under that id too.
    effects: renameSourceClipEffectTracks(
      renameClipEffectTracks(
        pruneMaskTargets(
          pruneExcludedLayers(
            project.effects,
            project.lanes.map((lane) => lane.id),
          ),
          project.lanes.map((lane) => lane.id),
        ),
        savedClipIds,
      ),
      new Map(
        project.sourceSpans.map((span) => [
          span.id,
          `${SOURCE_SPAN_ID_PREFIX}${sourceClipId(span.id)}`,
        ]),
      ),
    ).map((effect) => ({
      id: effect.id,
      trackId: effect.trackId,
      effectName: effect.effectName,
      parameters: toSessionParameters(effect.parameters),
      ...(effect.enabled === false ? { enabled: false } : {}),
      ...(effect.animation ? { animation: effect.animation } : {}),
      ...(effect.modulation ? { modulation: effect.modulation } : {}),
      ...(effect.defaulted ? { defaulted: true } : {}),
    })),
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
      ...(project.encoding ? { encoding: project.encoding } : {}),
    },
    playPosition: toFrames(quartersToSeconds(view.playheadQ, bpm), fps),
    sourceTracksLocked: project.sourceTracksLocked === true,
    ...(mediaRanges.length ? { mediaRanges } : {}),
    // The effects are written as they are, so a removed Order stays removed.
    orderDefaulted: true,
    // Text and Color are written on the clips that carry them.
    clipContentEffects: true,
    // Clips are written with their Gain, so a removed Gain stays removed.
    audioGainDefaulted: true,
  };

  return session;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

// The linear source position a warped clip's warp was saved anchored at, or
// `sourceSeconds`, where its source starts, when it has none.
export function readWarpAnchorSeconds(
  clip: NonNullable<ProjectSession["clips"]>[number],
  sourceSeconds: number,
) {
  return isFiniteNumber(clip.warpAnchorSeconds)
    ? clip.warpAnchorSeconds
    : sourceSeconds;
}

// Source track position minus song position, in seconds, for what
// `selection` shows: as saved, or from the slip older builds saved against
// one of `sourceSpans`, else 0. Malformed fields read as no offset.
export function readSelectionTrackOffset(
  selection: NonNullable<ProjectSession["selections"]>[number],
  sourceSpans: readonly TrackContentSpan[],
  bpm: number,
) {
  if (isFiniteNumber(selection.sourceTrackOffsetSeconds)) {
    return selection.sourceTrackOffsetSeconds;
  }
  const slip = readSelectionSlip(selection);
  return slip
    ? getClipTrackOffsetSeconds(
        { ...slip, sourceSpanOffsetSeconds: undefined },
        sourceSpans,
        bpm,
      )
    : 0;
}

export type SelectionSlip = {
  sourceSpanId: string;
  sourceOffsetSeconds: number;
};

// The source span and offset a slipped selection was saved with, or
// undefined for a selection that plays the span it falls in. Session files
// are unchecked JSON, so malformed fields read as no slip.
export function readSelectionSlip(
  selection: NonNullable<ProjectSession["selections"]>[number],
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
    const clip = entry as Partial<ProjectLayerClip> | null;
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

// The media In/Out points a session was saved with, skipping malformed entries.
export function readSessionMediaRanges(session: ProjectSession): SavedMediaRange[] {
  const ranges: SavedMediaRange[] = [];
  const entries: unknown = session.mediaRanges;
  for (const entry of Array.isArray(entries) ? entries : []) {
    const range = entry as Partial<SavedMediaRange> | null;
    if (
      !isNonEmptyString(range?.path) ||
      !isFiniteNumber(range.inSeconds) ||
      !isFiniteNumber(range.outSeconds) ||
      range.inSeconds < 0 ||
      range.outSeconds <= range.inSeconds
    ) {
      continue;
    }
    ranges.push({
      path: range.path,
      inSeconds: range.inSeconds,
      outSeconds: range.outSeconds,
    });
  }
  return ranges;
}

// The fill clips a session was saved with, skipping malformed entries.
export function readSessionFills(
  session: ProjectSession,
  bpm: number,
  fps: number,
): SessionLayerClip[] {
  return readLayerClips(session.fills, bpm, fps);
}

// The text clips a session was saved with, skipping malformed entries.
export function readSessionTexts(
  session: ProjectSession,
  bpm: number,
  fps: number,
): SessionLayerClip[] {
  return readLayerClips(session.texts, bpm, fps);
}

// The FX clips a session was saved with, skipping malformed entries.
export function readSessionFxClips(
  session: ProjectSession,
  bpm: number,
  fps: number,
): SessionLayerClip[] {
  return readLayerClips(session.fxClips, bpm, fps);
}
