import { ensureGlobalOrder, ensureLayerLayouts } from "../fx-stack";
import type { Palette } from "../media";
import type { GridLineWeight, SnapMode } from "../timeline-grid";
import type { Lane, ProjectState, TimeSignature } from "./types.ts";

// Media whose probed duration differs from the recorded one by more than
// this is probably a different file that happens to share its name.
export const RELINK_DURATION_TOLERANCE_SECONDS = 0.5;

export const LABEL_WIDTH_DEFAULT = 240;

export const LABEL_WIDTH_MIN = 120;

export const LABEL_WIDTH_MAX = 300;

export const LABEL_WIDTH_KEYBOARD_STEP = 10;

// Below this width the label rows tighten their padding and gaps.
export const LABEL_WIDTH_NARROW = 170;

export const BASE_QUARTER_PX = 28;

export const GRID_LINE_COLORS: Record<GridLineWeight, string> = {
  division: "rgba(255,255,255,0.04)",
  beat: "rgba(255,255,255,0.08)",
  bar: "rgba(255,255,255,0.16)",
};

export const TIMELINE_SCRUB_AUDIO_TAIL_MS = 50;

// A scrub started during playback keeps audio running between pointer moves
// and only pauses it once the pointer has been held still this long.
export const TIMELINE_PLAYBACK_SCRUB_AUDIO_IDLE_MS = 150;

export const TIMELINE_DRAG_EPSILON = 0.0001;

export const RANDOM_SELECTION_BAR_INCREMENT = 0.25;

export const MAX_PEER_MEDIA_TRANSFERS = 2;

export const PEER_MEDIA_STATUS_INTERVAL_MS = 250;

// How long a clip keeps cross-fading from its skeleton to its filmstrip.
export const PEER_MEDIA_REVEAL_MS = 1200;

export const RANDOM_SELECTION_MAX_BARS = 2;

// The arrangement wand replaces the main layers with this many.
export const MAX_WAND_LAYERS = 3;

export const SOURCE_TRACK_DRAG_CLEAR_DELAY_MS = 80;

export const COLLAB_STORAGE_KEY = "zvid-collaboration";

// Per-tab record of the room this tab joined, so a refresh can rejoin it even
// though the password is scrubbed from the address bar.
export const JOINED_ROOM_STORAGE_KEY = "zvid-joined-room";

export const INSPECTOR_COLLAPSED_STORAGE_KEY = "zvid-inspector-collapsed";

export const LABEL_WIDTH_STORAGE_KEY = "zvid-label-width";

export const PREVIEW_WIDTH_STORAGE_KEY = "zvid-preview-width";

export const PREVIEW_DEFAULT_WIDTH = 280;

export const PREVIEW_MIN_WIDTH = 240;

export const PREVIEW_MAX_WIDTH = 560;

export const PREVIEW_RESIZE_KEY_STEP = 16;

// Horizontal space the preview panel may never take from the timeline: the
// grid's side padding, the resize handle's column, and a usable timeline.
export const PREVIEW_RESERVED_WIDTH = 32 + 16 + 360;

export const SIGNATURES: TimeSignature[] = [
  { id: "4/4", numerator: 4, denominator: 4 },
  { id: "3/4", numerator: 3, denominator: 4 },
  { id: "5/4", numerator: 5, denominator: 4 },
  { id: "6/8", numerator: 6, denominator: 8 },
  { id: "7/8", numerator: 7, denominator: 8 },
];

export const SNAP_OPTIONS: { id: SnapMode; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "bar", label: "Bar" },
  { id: "beat", label: "Beat" },
  { id: "half", label: "1/2" },
  { id: "quarter", label: "1/4" },
];

export const DEFAULT_LANES: Lane[] = [
  { id: "1", name: "Layer 1", colorIndex: -1 },
  { id: "5", name: "Layer 2", colorIndex: -1 },
  { id: "6", name: "Layer 3", colorIndex: -1 },
];

export const INITIAL_PROJECT_STATE: ProjectState = {
  timelineMode: "musical",
  signatureId: "4/4",
  snapMode: "auto",
  snapEnabled: true,
  bpm: 120,
  fps: 30,
  canvasWidth: 1080,
  canvasHeight: 1920,
  zoom: 1,
  sessionName: null,
  mediaItems: [],
  lanes: DEFAULT_LANES,
  sourceTracks: [],
  sourceSpans: [],
  clips: [],
  effects: ensureGlobalOrder(
    ensureLayerLayouts(
      [],
      DEFAULT_LANES.map((lane) => lane.id),
    ),
  ),
  mainAudioId: undefined,
  orderDefaulted: true,
  clipContentEffects: true,
};

// Card colours of fill clips on layers without an accent.
export const FILL_CLIP_TINT = "#2a2d38";

export const FILL_CLIP_ACCENT = "#8d93a8";

// Bars a text clip inserted at the playhead spans.
export const TEXT_CLIP_BARS = 4;

// Bars an FX clip inserted at the playhead spans.
export const FX_CLIP_BARS = 4;

export const PALETTE: Palette[] = [
  { color: "#3d4052", accent: "#7ca1ff" },
  { color: "#444351", accent: "#ff6f9d" },
  { color: "#393d4d", accent: "#7ee0a4" },
  { color: "#474150", accent: "#f6b73c" },
  { color: "#434a58", accent: "#c38fff" },
];

export const LOCATE_OFFLINE_MEDIA_HINT =
  "Relink from File → Locate Offline Media…";
