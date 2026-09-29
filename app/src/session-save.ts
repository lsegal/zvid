// File ▸ Save: where a session is written, and the `.lvp` it is written as.
//
// A session opened from a file path (the desktop build) saves back to that
// path, including after a refresh restores it. Sessions opened from a browser
// `File`, a workspace folder or an Ableton Live set import have no path the
// app can write to, so they prompt for a location. An imported set is never
// written back: its picker suggests the sibling `.lvp`.

import { alsSavePath } from "./als-import.ts";
import { type ClipWarp, warpSampleStartSeconds } from "./clip-warp.ts";
import type { LvpSession } from "./session.ts";
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
        filename: sessionFilename(alsSavePath(source.name || sessionName || "")),
      };
    case "file":
    case "workspace":
      return { kind: "prompt", filename: sessionFilename(source.name) };
    default:
      return { kind: "prompt", filename: sessionFilename(sessionName) };
  }
}

export type SaveableLane = { id: string; name: string; colorIndex: number };

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
  kind?: "fill";
  sourceTrackId: string;
  laneId: string;
  startQ: number;
  durationSeconds: number;
};

export type SaveableEffect = {
  id: string;
  trackId: string;
  effectName: string;
  parameters: Array<{ key: string; value: string; numericValue?: number }>;
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

export type LvpSessionSave = {
  session: LvpSession;
  // Fill clips have no `.lvp` representation and are left out.
  skippedFillClips: number;
};

const SOURCE_SPAN_ID_PREFIX = "source-";
const SELECTION_ID_PATTERN = /^selection-(\d+)$/;

function toFrames(seconds: number, fps: number) {
  return Math.round(seconds * fps);
}

function quartersToSeconds(quarters: number, bpm: number) {
  return (quarters * 60) / bpm;
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

// Writes the project as a `.lvp` session that opens back into the same
// arrangement. Selections point at their source clip by track and position,
// the way the Layers app stores them.
export function projectToLvpSession(
  project: SaveableProject,
  view: SaveableView,
): LvpSessionSave {
  const { bpm, fps } = project;

  const clips = project.sourceSpans.map<NonNullable<LvpSession["clips"]>[number]>(
    (span) => {
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
    },
  );

  const mediaClips = project.clips.filter((clip) => clip.kind !== "fill");
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
  const selections = mediaClips.map<
    NonNullable<LvpSession["selections"]>[number]
  >((clip) => {
    const frameStart = toFrames(quartersToSeconds(clip.startQ, bpm), fps);
    return {
      id: allocateSelectionId(clip.id),
      trackId: clip.sourceTrackId,
      mainTrackId: clip.laneId,
      frameStart,
      frameEnd: frameStart + Math.max(1, toFrames(clip.durationSeconds, fps)),
      ...(clip.id === view.selectedClipId ? { selected: true } : {}),
    };
  });

  const mainAudio = project.mainAudioId
    ? project.mediaItems.find((item) => item.id === project.mainAudioId)
    : undefined;

  const session: LvpSession = {
    mainTracks: project.lanes.map((lane) => ({
      id: lane.id,
      name: lane.name,
      colorIndex: lane.colorIndex,
    })),
    tracks: project.sourceTracks.map((track) => ({
      id: track.id,
      name: track.name,
      colorIndex: track.colorIndex,
      recordings: track.recordingPaths.map((filename) => ({ filename })),
    })),
    clips,
    selections,
    effects: project.effects.map((effect) => ({
      id: effect.id,
      trackId: effect.trackId,
      effectName: effect.effectName,
      parameters: toLvpParameters(effect.parameters),
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
    },
    playPosition: toFrames(quartersToSeconds(view.playheadQ, bpm), fps),
    ...(mainAudio
      ? { audioFilename: mainAudio.sourcePath ?? mainAudio.name }
      : {}),
  };

  return {
    session,
    skippedFillClips: project.clips.length - mediaClips.length,
  };
}
