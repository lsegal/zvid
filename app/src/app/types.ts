import type { ClipWarp } from "../clip-warp.ts";
import type { MenuPoint } from "../context-menu.ts";
import type { SessionEffect } from "../fx-stack.ts";
import type { LaneSelectionGesture } from "../lane-selection-gesture.ts";
import type { MediaAvailability, MediaItem, MediaKind } from "../media.ts";
import type { SessionEncoding } from "../session-settings.ts";
import type { SnapMode } from "../timeline-grid.ts";

export type TimelineMode = "musical" | "timecode";

export type TimeSignature = {
  id: string;
  numerator: number;
  denominator: number;
};

export type Lane = {
  id: string;
  name: string;
  colorIndex: number;
  // Layer-wide FX bypass; a missing flag means on.
  fxEnabled?: boolean;
};

export type SourceTrack = {
  id: string;
  name: string;
  colorIndex: number;
  recordingPaths: string[];
};

export type SourceSpan = {
  id: string;
  sourceTrackId: string;
  label: string;
  mediaPath: string;
  mediaId?: string;
  startQ: number;
  durationSeconds: number;
  trimStartSeconds: number;
  // Warp markers the source follows instead of playing at 1×.
  warp?: ClipWarp;
  tint: string;
  accent: string;
};

export type ArrangementClip = {
  id: string;
  // "fill" for a media-less fill clip painted by its own (or else its
  // layer's) Color effect, "text" for a text clip styled by its own Text
  // effect, or "fx" for an FX clip whose own stack adjusts what is beneath
  // it; media clips leave it unset.
  kind?: "fill" | "text" | "fx";
  sourceSpanId: string;
  sourceTrackId: string;
  laneId: string;
  label: string;
  mediaPath: string;
  mediaId?: string;
  startQ: number;
  durationSeconds: number;
  trimStartSeconds: number;
  sourceOffsetSeconds: number;
  sourceWindowStartSeconds: number;
  sourceWindowEndSeconds: number;
  warp?: ClipWarp;
  tint: string;
  accent: string;
};

// The right-click menu open on an arrangement clip, empty lane space, the
// uncommitted selection, a source clip, a layer header, a source track label
// or the Audio row, at `anchor` in viewport coordinates.
export type ClipMenuState = { anchor: MenuPoint } & (
  | { kind: "clip"; clipId: string }
  | { kind: "lane"; laneId: string }
  | { kind: "selection" }
  | { kind: "span"; spanId: string }
  | { kind: "layer"; laneId: string }
  | { kind: "source-track"; trackId: string }
  | { kind: "audio" }
);

export type TimelineSelection = {
  id: string;
  laneId: string;
  startQ: number;
  durationQ: number;
};

export type DragState =
  | {
      kind: "move";
      pointerId: number;
      clipId: string;
      sourceClipId: string;
      pointerStartX: number;
      originStartQ: number;
      originDurationQ: number;
      originLaneId: string;
      duplicateOnDrag: boolean;
      // A Ctrl/Cmd-press released without dragging jumps to the clip start.
      jumpOnClick: boolean;
    }
  | {
      kind: "resize-start";
      pointerId: number;
      clipId: string;
      pointerStartX: number;
      originStartQ: number;
      originDurationQ: number;
    }
  | {
      kind: "resize-end";
      pointerId: number;
      clipId: string;
      pointerStartX: number;
      originStartQ: number;
      originDurationQ: number;
    }
  | {
      kind: "selection";
      pointerId: number;
      laneId: string;
      gesture: LaneSelectionGesture;
    };

// A source clip pressed to move it or trim one of its edges. Nothing changes
// until the pointer passes the click threshold, so a press released before
// then is a click.
export type SourceSpanDragState = {
  kind: "move" | "resize-start" | "resize-end";
  pointerId: number;
  spanId: string;
  pointerStartX: number;
};

export type TimelineDragState = {
  pointerId: number;
  pointerStartX: number;
  originPlayheadQ: number;
  originZoom: number;
  wasPlaying: boolean;
};

export type ExportState = {
  phase: "idle" | "preparing" | "decoding-audio" | "rendering" | "muxing";
  progress: number | null;
  detail: string;
};

export type TimelineViewport = {
  scrollLeft: number;
  clientWidth: number;
  clientHeight: number;
  // Height of the sticky ruler above the arrangement lanes.
  lanesTop: number;
};

// `startQ` is where dropped media starts, set when it was dropped on a track
// row at a timeline position; without it, media goes after the track's last
// clip.
export type SourceTrackDropTarget =
  | {
      kind: "track";
      trackId: string;
      startQ?: number;
    }
  | {
      kind: "new-track";
      startQ?: number;
    };

export type SourceTrackDragPreview = {
  dragKey: string;
  fileCount: number;
  names: string[];
  label: string;
  // `pending` while the browser hides the dragged files, until drop.
  status: "pending" | "loading" | "ready" | "error";
  kind?: MediaKind;
  durationSeconds?: number;
  thumbnailUrl?: string;
  error?: string;
  // Media dragged from the Media drawer; its thumbnail belongs to the media.
  mediaIds?: string[];
};

export type CollaborationMode = "idle" | "sharing" | "connected";

export type CollaborationRemoteCursor = {
  clientId: number;
  name: string;
  color: string;
  x: number;
  y: number;
};

export type ProjectState = {
  timelineMode: TimelineMode;
  signatureId: string;
  snapMode: SnapMode;
  snapEnabled: boolean;
  bpm: number;
  fps: number;
  canvasWidth: number;
  canvasHeight: number;
  // The export encoding from Session Settings; unset reads as the defaults.
  encoding?: SessionEncoding;
  zoom: number;
  sessionName: string | null;
  mediaItems: MediaItem[];
  lanes: Lane[];
  sourceTracks: SourceTrack[];
  sourceSpans: SourceSpan[];
  clips: ArrangementClip[];
  effects: SessionEffect[];
  mainAudioId?: string;
  // The session length from the opened session, in frames at `fps`.
  projectDurationFrames?: number;
  // When set, source clips can't be moved, resized or retimed and source
  // tracks can't be deleted or reordered. Unset reads as unlocked.
  sourceTracksLocked?: boolean;
  // Set on every state since sessions got a default Order effect. A restored
  // workspace saved without it is older and gets that Order added.
  orderDefaulted?: boolean;
  // Set on every state since text and fill clips carried their own Text and
  // Color. A restored workspace saved without it is older and has its
  // layers' Text and Color moved onto those clips.
  clipContentEffects?: boolean;
  // Set on every state since clips needed a Gain effect to make sound. A
  // restored workspace saved without it is older and gets a 0 dB Gain on
  // each clip that may have sound.
  audioGainDefaulted?: boolean;
};

export type LocalMediaOverride = {
  availability?: MediaAvailability;
  previewUrl?: string;
  thumbnailUrl?: string;
  lastError?: string;
};

export type AdoptMediaResult = {
  previewUrl: string;
  warning?: string;
};

// Tracks the offline refs of a just-opened session until cache hydration
// settles, so the status bar can report the real outcome.
export type SessionMediaCheck = {
  sessionName: string;
  pendingIds: Set<string>;
  restored: number;
  offline: number;
  analyzingFromDisk: boolean;
  hydratedFromDisk: boolean;
  /** Set when loading resolved overlapping clips. */
  overlapNote: string;
};
