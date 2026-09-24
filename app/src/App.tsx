import {
  BackwardIcon,
  ChevronDownIcon,
  ForwardIcon,
  PauseIcon,
  PlayIcon,
} from "@heroicons/react/24/solid";
import {
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import "./App.css";
import {
  AlsImportError,
  formatAlsImportSummary,
  isAlsFilename,
} from "./als-import";
import {
  CompositionPlayer,
  type CompositionPlayerHandle,
  CompositionRenderer,
} from "./CompositionPlayer";
import {
  type CollaborationConnectionState,
  type CollaborationController,
  createCollaborationController,
} from "./collaboration";
import {
  APP_BUILD_LABEL,
  BrandMark,
  openBuildCommit,
} from "./components/BrandMark";
import { FxChain, type FxEditMode } from "./components/FxChain";
import {
  ImportNotice,
  type ImportNoticeContent,
} from "./components/ImportNotice";
import { OfflineMediaDialog } from "./components/OfflineMediaDialog";
import {
  StatusBar,
  type StatusItem,
  type StatusMessage,
} from "./components/StatusBar";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import {
  getDefaultLaneId,
  resolveSelectedLaneId,
  stepSelectedLaneId,
} from "./fx-chain";
import {
  addEffect,
  duplicateEffect,
  effectHistoryLabels,
  type FxDevice,
  isLayerFxEnabled,
  mapEffects,
  mapSessionEffectsToDevices,
  moveEffect,
  removeEffect,
  type SessionEffect,
  setEffectEnabled,
  setEffectParameter,
  setLaneFxEnabled,
} from "./fx-stack";
import { getHarness, type SaveTarget } from "./harness";
import { hasMediaExtension } from "./harness/media-extensions";
import { MasterWaveform } from "./MasterWaveform";
import {
  buildFallbackMediaItem,
  inferMediaKind,
  type MediaAvailability,
  type MediaItem,
  type MediaKind,
  type MediaProbeResult,
  type Palette,
  probeMediaBlob,
  toShareableMediaItem,
} from "./media";
import { cacheMediaBlob, getCachedMediaBlob } from "./media-cache";
import { createMediaRelinker, type MediaRelinkCandidate } from "./media-relink";
import {
  createProjectHistoryState,
  projectHistoryReducer,
} from "./project-history";
import { listOfflineMedia, matchOfflineMedia } from "./relink";
import type { LvpSession, SessionOpenResponse } from "./session";
import { statusMessageTone } from "./status-bar";
import { formatMusicalPosition, formatTimecode } from "./timeline-format.ts";
import { loadWaveformPeaks } from "./waveform-loader";
import type { WaveformPeaks } from "./waveform-peaks";

type TimelineMode = "musical" | "timecode";
type SnapMode = "bar" | "beat" | "half" | "quarter";

type TimeSignature = {
  id: string;
  numerator: number;
  denominator: number;
};

type Lane = {
  id: string;
  name: string;
  colorIndex: number;
  // Layer-wide FX bypass; a missing flag means on.
  fxEnabled?: boolean;
};

type SourceTrack = {
  id: string;
  name: string;
  colorIndex: number;
  recordingPaths: string[];
};

type SourceSpan = {
  id: string;
  sourceTrackId: string;
  label: string;
  mediaPath: string;
  mediaId?: string;
  startQ: number;
  durationSeconds: number;
  trimStartSeconds: number;
  tint: string;
  accent: string;
};

type ArrangementClip = {
  id: string;
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
  tint: string;
  accent: string;
  selected?: boolean;
};

type TimelineSelection = {
  id: string;
  laneId: string;
  startQ: number;
  durationQ: number;
};

type DragState =
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
      anchorQ: number;
    };

type TimelineDragState = {
  pointerId: number;
  pointerStartX: number;
  pointerStartY: number;
  originPlayheadQ: number;
  originZoom: number;
  wasPlaying: boolean;
};

type ExportState = {
  phase: "idle" | "preparing" | "decoding-audio" | "rendering" | "muxing";
  progress: number | null;
  detail: string;
};

type TimelineViewport = {
  scrollLeft: number;
  clientWidth: number;
};

type SourceTrackDropTarget =
  | {
      kind: "track";
      trackId: string;
    }
  | {
      kind: "new-track";
    };

type SourceTrackDragPreview = {
  dragKey: string;
  fileCount: number;
  names: string[];
  label: string;
  status: "loading" | "ready" | "error";
  kind?: MediaKind;
  durationSeconds?: number;
  thumbnailUrl?: string;
  error?: string;
};

type CollaborationMode = "idle" | "sharing" | "connected";

type CollaborationTone = "idle" | "pending" | "waiting" | "live";

type CollaborationRemoteCursor = {
  clientId: number;
  name: string;
  color: string;
  x: number;
  y: number;
};

type ProjectState = {
  timelineMode: TimelineMode;
  signatureId: string;
  snapMode: SnapMode;
  snapEnabled: boolean;
  bpm: number;
  fps: number;
  canvasWidth: number;
  canvasHeight: number;
  zoom: number;
  sessionName: string | null;
  mediaItems: MediaItem[];
  lanes: Lane[];
  sourceTracks: SourceTrack[];
  sourceSpans: SourceSpan[];
  clips: ArrangementClip[];
  effects: SessionEffect[];
  masterAudioId?: string;
};

type LocalMediaOverride = {
  availability?: MediaAvailability;
  previewUrl?: string;
  thumbnailUrl?: string;
  lastError?: string;
};

type AdoptMediaResult = {
  previewUrl: string;
  warning?: string;
};

// Media whose probed duration differs from the recorded one by more than
// this is probably a different file that happens to share its name.
const RELINK_DURATION_TOLERANCE_SECONDS = 0.5;

// Placeholder content until the status bar items are populated.
const STATUS_BAR_ITEMS: StatusItem[] = [{ id: "app", value: "zvid" }];

// Tracks the offline refs of a just-opened session until cache hydration
// settles, so the status bar can report the real outcome.
type SessionMediaCheck = {
  sessionName: string;
  pendingIds: Set<string>;
  restored: number;
  offline: number;
  analyzingFromDisk: boolean;
  hydratedFromDisk: boolean;
};

const LABEL_WIDTH_DEFAULT = 240;
const LABEL_WIDTH_MIN = 120;
const LABEL_WIDTH_MAX = 300;
const LABEL_WIDTH_KEYBOARD_STEP = 10;
// Below this width the label rows tighten their padding and gaps.
const LABEL_WIDTH_NARROW = 170;
const BASE_QUARTER_PX = 28;
const ZOOM_MIN = 0.65;
const ZOOM_MAX = 1.8;
const MAX_LAYERS = 9;
const TIMELINE_DRAG_ZOOM_SPEED = 0.004;
const TIMELINE_DRAG_ZOOM_THRESHOLD_PX = 25;
const TIMELINE_SCRUB_AUDIO_TAIL_MS = 50;
// A scrub started during playback keeps audio running between pointer moves
// and only pauses it once the pointer has been held still this long.
const TIMELINE_PLAYBACK_SCRUB_AUDIO_IDLE_MS = 150;
const TIMELINE_DRAG_EPSILON = 0.0001;
const RANDOM_SELECTION_BAR_INCREMENT = 0.25;
const MAX_PEER_MEDIA_TRANSFERS = 2;
const PEER_MEDIA_STATUS_INTERVAL_MS = 250;
const RANDOM_SELECTION_MAX_BARS = 2;
const SOURCE_TRACK_DRAG_CLEAR_DELAY_MS = 80;
const COLLAB_STORAGE_KEY = "zvid-collaboration";
const INSPECTOR_COLLAPSED_STORAGE_KEY = "zvid-inspector-collapsed";
const LABEL_WIDTH_STORAGE_KEY = "zvid-label-width";
const PREVIEW_WIDTH_STORAGE_KEY = "zvid-preview-width";
const PREVIEW_DEFAULT_WIDTH = 280;
const PREVIEW_MIN_WIDTH = 240;
const PREVIEW_MAX_WIDTH = 560;
const PREVIEW_RESIZE_KEY_STEP = 16;
// Horizontal space the preview panel may never take from the timeline: the
// grid's side padding, the resize handle's column, and a usable timeline.
const PREVIEW_RESERVED_WIDTH = 32 + 16 + 360;
const PUBLIC_SIGNALING_URL = "wss://y-webrtc-eu.fly.dev";
const DEFAULT_SIGNALING_URLS = splitSignalingUrls(
  import.meta.env.VITE_SIGNALING_URL || PUBLIC_SIGNALING_URL,
);
const LEGACY_DEFAULT_SIGNALING_URLS = [
  "wss://zvid-signaling.lsegal.workers.dev",
];
const SIGNATURES: TimeSignature[] = [
  { id: "4/4", numerator: 4, denominator: 4 },
  { id: "3/4", numerator: 3, denominator: 4 },
  { id: "5/4", numerator: 5, denominator: 4 },
  { id: "6/8", numerator: 6, denominator: 8 },
  { id: "7/8", numerator: 7, denominator: 8 },
];
const SNAP_OPTIONS: { id: SnapMode; label: string }[] = [
  { id: "bar", label: "Bar" },
  { id: "beat", label: "Beat" },
  { id: "half", label: "1/2" },
  { id: "quarter", label: "1/4" },
];
const DEFAULT_LANES: Lane[] = [
  { id: "1", name: "Layer 1", colorIndex: -1 },
  { id: "5", name: "Layer 2", colorIndex: -1 },
  { id: "6", name: "Layer 3", colorIndex: -1 },
];
const INITIAL_PROJECT_STATE: ProjectState = {
  timelineMode: "musical",
  signatureId: "4/4",
  snapMode: "beat",
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
  effects: [],
  masterAudioId: undefined,
};
const PALETTE: Palette[] = [
  { color: "#3d4052", accent: "#7ca1ff" },
  { color: "#444351", accent: "#ff6f9d" },
  { color: "#393d4d", accent: "#7ee0a4" },
  { color: "#474150", accent: "#f6b73c" },
  { color: "#434a58", accent: "#c38fff" },
];
const COLLAB_NAME_PREFIXES = [
  "Neon",
  "Velvet",
  "Signal",
  "Tempo",
  "Quartz",
  "Echo",
  "Prism",
  "Static",
];
const COLLAB_NAME_SUFFIXES = [
  "Fox",
  "Tape",
  "Wave",
  "Frame",
  "Orbit",
  "Pulse",
  "Cut",
  "Vector",
];
function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

const LOCATE_OFFLINE_MEDIA_HINT = "Relink from File → Locate Offline Media…";

function formatSessionMediaCheckStatus(check: SessionMediaCheck) {
  const { sessionName, restored, offline, hydratedFromDisk } = check;
  if (!restored && !offline) {
    return hydratedFromDisk
      ? `Loaded ${sessionName} with local media hydrated from disk.`
      : `Loaded ${sessionName}.`;
  }

  if (!restored && !hydratedFromDisk) {
    return `Loaded ${sessionName}. All referenced media is currently offline. ${LOCATE_OFFLINE_MEDIA_HINT}`;
  }

  const details: string[] = [];
  if (restored) {
    details.push(`Restored ${pluralize(restored, "media file")} from cache.`);
  }
  if (offline) {
    details.push(
      `${offline === 1 ? "1 clip is" : `${offline} clips are`} still offline. ${LOCATE_OFFLINE_MEDIA_HINT}`,
    );
  }
  return `Loaded ${sessionName}. ${details.join(" ")}`;
}

function isEditableEventTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function quartersToSeconds(quarters: number, bpm: number) {
  return (quarters * 60) / bpm;
}

function secondsToQuarters(seconds: number, bpm: number) {
  return (seconds * bpm) / 60;
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  return `${minutes}:${remainderSeconds.toString().padStart(2, "0")}.${tenths}`;
}

function getSnapUnit(mode: SnapMode, signature: TimeSignature) {
  const beatUnit = 4 / signature.denominator;
  const barLength = signature.numerator * beatUnit;
  switch (mode) {
    case "bar":
      return barLength;
    case "beat":
      return beatUnit;
    case "half":
      return beatUnit / 2;
    case "quarter":
      return beatUnit / 4;
    default:
      return beatUnit;
  }
}

function snapQuarterValue(valueQ: number, snapUnit: number, enabled: boolean) {
  if (!enabled) {
    return valueQ;
  }

  return Math.round(valueQ / snapUnit) * snapUnit;
}

function getClipDurationQ(
  clip: Pick<ArrangementClip | SourceSpan, "durationSeconds">,
  bpm: number,
) {
  return secondsToQuarters(clip.durationSeconds, bpm);
}

function getClipEndQ(
  clip: Pick<ArrangementClip | SourceSpan, "startQ" | "durationSeconds">,
  bpm: number,
) {
  return clip.startQ + getClipDurationQ(clip, bpm);
}

function withWindowTiming(
  clip: ArrangementClip,
  startQ: number,
  durationQ: number,
  bpm: number,
  laneId = clip.laneId,
) {
  return {
    ...clip,
    laneId,
    startQ,
    durationSeconds: quartersToSeconds(durationQ, bpm),
    trimStartSeconds: quartersToSeconds(startQ, bpm) + clip.sourceOffsetSeconds,
  };
}

function resolveClipOverlapPreview(
  clips: ArrangementClip[],
  activeClipId: string,
  startQ: number,
  durationQ: number,
  bpm: number,
  laneId?: string,
) {
  const targetClip = clips.find((clip) => clip.id === activeClipId);
  if (!targetClip) {
    return clips;
  }

  const activeClip = withWindowTiming(
    targetClip,
    startQ,
    durationQ,
    bpm,
    laneId,
  );
  return resolveClipOverlaps(clips, activeClip, bpm);
}

function findClosestTimelineLaneId(
  timelineScroll: HTMLElement,
  clientY: number,
  fallbackLaneId: string,
) {
  const laneElements = Array.from(
    timelineScroll.querySelectorAll<HTMLElement>("[data-timeline-lane-id]"),
  );

  if (!laneElements.length) {
    return fallbackLaneId;
  }

  for (const laneElement of laneElements) {
    const laneId = laneElement.dataset.timelineLaneId;
    if (!laneId) {
      continue;
    }

    const bounds = laneElement.getBoundingClientRect();
    if (clientY >= bounds.top && clientY <= bounds.bottom) {
      return laneId;
    }
  }

  let closestLaneId = fallbackLaneId;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const laneElement of laneElements) {
    const laneId = laneElement.dataset.timelineLaneId;
    if (!laneId) {
      continue;
    }

    const bounds = laneElement.getBoundingClientRect();
    const distance = Math.abs(clientY - (bounds.top + bounds.bottom) / 2);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestLaneId = laneId;
    }
  }

  return closestLaneId;
}

function resolveClipOverlaps(
  clips: ArrangementClip[],
  activeClip: ArrangementClip,
  bpm: number,
) {
  const epsilon = 0.0001;
  const activeEndQ = getClipEndQ(activeClip, bpm);

  return clips.flatMap<ArrangementClip>((clip) => {
    if (clip.id === activeClip.id) {
      return [activeClip];
    }

    if (clip.laneId !== activeClip.laneId) {
      return [clip];
    }

    const clipEndQ = getClipEndQ(clip, bpm);
    const overlapStartQ = Math.max(activeClip.startQ, clip.startQ);
    const overlapEndQ = Math.min(activeEndQ, clipEndQ);
    if (overlapEndQ - overlapStartQ <= epsilon) {
      return [clip];
    }

    const leftDurationQ = Math.max(0, activeClip.startQ - clip.startQ);
    const rightDurationQ = Math.max(0, clipEndQ - activeEndQ);

    if (leftDurationQ <= epsilon && rightDurationQ <= epsilon) {
      return [];
    }

    if (leftDurationQ >= rightDurationQ && leftDurationQ > epsilon) {
      return [withWindowTiming(clip, clip.startQ, leftDurationQ, bpm)];
    }

    if (rightDurationQ > epsilon) {
      return [withWindowTiming(clip, activeEndQ, rightDurationQ, bpm)];
    }

    return [];
  });
}

function cloneClipAtStartQ(
  clip: ArrangementClip,
  bpm: number,
  startQ: number,
  id = `window-${crypto.randomUUID()}`,
) {
  return {
    ...clip,
    id,
    startQ,
    trimStartSeconds: clip.trimStartSeconds,
    sourceOffsetSeconds: clip.trimStartSeconds - quartersToSeconds(startQ, bpm),
    selected: true,
  };
}

function duplicateClip(
  clip: ArrangementClip,
  bpm: number,
  id = `window-${crypto.randomUUID()}`,
) {
  return cloneClipAtStartQ(clip, bpm, getClipEndQ(clip, bpm), id);
}

function getSelectionEndQ(selection: TimelineSelection) {
  return selection.startQ + selection.durationQ;
}

function buildSelection(
  anchorQ: number,
  currentQ: number,
  minimumDurationQ: number,
) {
  const startQ = Math.max(0, Math.min(anchorQ, currentQ));
  const endQ = Math.max(anchorQ, currentQ, startQ + minimumDurationQ);
  return {
    startQ,
    durationQ: Math.max(minimumDurationQ, endQ - startQ),
  };
}

function getTimelineContentEndQ(
  clips: ArrangementClip[],
  sourceSpans: SourceSpan[],
  masterAudioDurationSeconds: number | undefined,
  bpm: number,
  barLength: number,
) {
  const clipTimelineEndQ = clips.reduce(
    (maximum, clip) => Math.max(maximum, getClipEndQ(clip, bpm)),
    0,
  );
  const sourceTimelineEndQ = sourceSpans.reduce(
    (maximum, span) => Math.max(maximum, getClipEndQ(span, bpm)),
    0,
  );
  const audioTimelineEndQ = masterAudioDurationSeconds
    ? secondsToQuarters(masterAudioDurationSeconds, bpm)
    : 0;

  return Math.max(
    barLength,
    clipTimelineEndQ,
    sourceTimelineEndQ,
    audioTimelineEndQ,
  );
}

function getSwatch(colorIndex: number) {
  return PALETTE[Math.abs(colorIndex) % PALETTE.length] ?? PALETTE[0];
}

function basename(path: string) {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? path;
}

function stripFilenameExtension(value: string) {
  return value.replace(/\.[^/.]+$/, "") || value;
}

function getDraggedMediaFiles(dataTransfer: DataTransfer | null) {
  const directFiles = Array.from(dataTransfer?.files ?? []);
  const itemFiles =
    directFiles.length > 0
      ? directFiles
      : Array.from(dataTransfer?.items ?? [])
          .filter((item) => item.kind === "file")
          .map((item) => item.getAsFile())
          .filter((file): file is File => Boolean(file));

  return itemFiles.filter(
    (file) =>
      file.type.startsWith("video/") ||
      file.type.startsWith("audio/") ||
      hasMediaExtension(file.name),
  );
}

function hasDraggedFileData(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) {
    return false;
  }

  if (Array.from(dataTransfer.types).includes("Files")) {
    return true;
  }

  return Array.from(dataTransfer.items ?? []).some(
    (item) => item.kind === "file",
  );
}

function buildDraggedMediaKey(files: readonly File[]) {
  return files
    .map((file) => `${file.name}:${file.size}:${file.lastModified}`)
    .join("|");
}

function getNextLaneNumber(lanes: Lane[]) {
  return lanes.length + 1;
}

function createLaneId(lanes: Lane[]) {
  const numericIds = lanes
    .map((lane) => Number.parseInt(lane.id, 10))
    .filter((value) => Number.isInteger(value));
  let nextId = Math.max(0, ...numericIds) + 1;

  while (lanes.some((lane) => lane.id === `${nextId}`)) {
    nextId += 1;
  }

  return `${nextId}`;
}

function randomFloat() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] / 0x1_0000_0000;
}

function pickRandom<T>(items: readonly T[]) {
  if (!items.length) {
    return undefined;
  }

  return items[Math.floor(randomFloat() * items.length)];
}

function describeMediaAvailability(
  availability: MediaAvailability | undefined,
) {
  switch (availability) {
    case "ready":
      return "online";
    case "hydrating":
      return "hydrating";
    default:
      return "offline";
  }
}

function mergeMediaItemsById(current: MediaItem[], incoming: MediaItem[]) {
  const incomingById = new Map(incoming.map((item) => [item.id, item]));
  return current.map((item) => incomingById.get(item.id) ?? item);
}

function splitSignalingUrls(value: string) {
  return value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseSignalingUrls(value: string) {
  const urls = splitSignalingUrls(value);
  return urls.length ? urls : DEFAULT_SIGNALING_URLS;
}

function migrateLegacyStoredSignaling(
  value: string | undefined,
  fallback: string,
) {
  if (!value) {
    return fallback;
  }

  const normalized = parseSignalingUrls(value).join(", ");
  const legacy = LEGACY_DEFAULT_SIGNALING_URLS.join(", ");
  return normalized === legacy ? fallback : normalized;
}

function buildCollaboratorName() {
  const prefix = pickRandom(COLLAB_NAME_PREFIXES) ?? "Signal";
  const suffix = pickRandom(COLLAB_NAME_SUFFIXES) ?? "Wave";
  return `${prefix} ${suffix}`;
}

function clampLabelWidth(width: number) {
  return Math.round(clamp(width, LABEL_WIDTH_MIN, LABEL_WIDTH_MAX));
}

function readLabelWidth() {
  if (typeof window === "undefined") {
    return LABEL_WIDTH_DEFAULT;
  }

  try {
    const stored = Number(
      window.localStorage.getItem(LABEL_WIDTH_STORAGE_KEY) ?? Number.NaN,
    );
    return Number.isFinite(stored)
      ? clampLabelWidth(stored)
      : LABEL_WIDTH_DEFAULT;
  } catch {
    return LABEL_WIDTH_DEFAULT;
  }
}

function readInspectorCollapsed() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return (
      window.localStorage.getItem(INSPECTOR_COLLAPSED_STORAGE_KEY) === "true"
    );
  } catch {
    return false;
  }
}

function readPreviewWidth() {
  if (typeof window === "undefined") {
    return PREVIEW_DEFAULT_WIDTH;
  }

  try {
    const stored = Number(
      window.localStorage.getItem(PREVIEW_WIDTH_STORAGE_KEY),
    );
    return stored
      ? clamp(Math.round(stored), PREVIEW_MIN_WIDTH, PREVIEW_MAX_WIDTH)
      : PREVIEW_DEFAULT_WIDTH;
  } catch {
    return PREVIEW_DEFAULT_WIDTH;
  }
}

function getPreviewMaxWidth(editorGridWidth: number) {
  if (!editorGridWidth) {
    return PREVIEW_MAX_WIDTH;
  }

  return clamp(
    editorGridWidth - PREVIEW_RESERVED_WIDTH,
    PREVIEW_MIN_WIDTH,
    PREVIEW_MAX_WIDTH,
  );
}

function getInitialCollaborationConfig() {
  const defaults = {
    room: "",
    password: "",
    signaling: DEFAULT_SIGNALING_URLS.join(", "),
    name: buildCollaboratorName(),
    color: pickRandom(PALETTE)?.accent ?? "#7ca1ff",
    autoConnect: false,
  };

  if (typeof window === "undefined") {
    return defaults;
  }

  let stored: Partial<typeof defaults> = {};
  try {
    const raw = window.localStorage.getItem(COLLAB_STORAGE_KEY);
    if (raw) {
      stored = JSON.parse(raw) as Partial<typeof defaults>;
    }
  } catch (error) {
    logClient("collaboration:storage:read:error", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const params = new URLSearchParams(window.location.search);
  const paramRoom = params.get("room")?.trim() || "";
  const room = paramRoom || defaults.room;
  const password = params.get("password")?.trim() || defaults.password;
  const signalingParam = params.get("signal")?.trim();
  const signaling = signalingParam
    ? parseSignalingUrls(signalingParam).join(", ")
    : migrateLegacyStoredSignaling(stored.signaling, defaults.signaling);

  return {
    room,
    password,
    signaling,
    name: stored.name || defaults.name,
    color: stored.color || defaults.color,
    autoConnect: Boolean(paramRoom),
  };
}

function buildShareRoomName() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 8);
}

function isPrivateIpv4Address(address: string) {
  return (
    address === "127.0.0.1" ||
    address === "0.0.0.0" ||
    address.startsWith("10.") ||
    address.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(address)
  );
}

function extractPublicIpFromCandidate(candidate: string) {
  const matches = candidate.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [];
  return matches.find((address) => !isPrivateIpv4Address(address)) ?? null;
}

async function detectPublicIpAddress(timeoutMs = 4000) {
  if (
    typeof window === "undefined" ||
    typeof RTCPeerConnection === "undefined"
  ) {
    return null;
  }

  try {
    const peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
    });
    peerConnection.createDataChannel("zvid-share-probe");
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    return await new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timeoutId);
        if (peerConnection) {
          peerConnection.onicecandidate = null;
          peerConnection.close();
        }
        resolve(value);
      };

      const timeoutId = window.setTimeout(() => finish(null), timeoutMs);
      peerConnection.onicecandidate = (event) => {
        const candidate = event.candidate?.candidate;
        if (!candidate) {
          finish(null);
          return;
        }

        const publicIp = extractPublicIpFromCandidate(candidate);
        if (publicIp) {
          finish(publicIp);
        }
      };
    });
  } catch {
    return null;
  }
}

function buildPublicShareUrl(
  roomName: string,
  signaling: string,
  password: string,
  publicIpAddress: string | null,
) {
  const currentUrl = new URL(window.location.href);
  const origin = publicIpAddress
    ? `${currentUrl.protocol}//${publicIpAddress}${currentUrl.port ? `:${currentUrl.port}` : ""}`
    : currentUrl.origin;
  const shareUrl = new URL(currentUrl.pathname, origin);

  shareUrl.searchParams.set("room", roomName);
  shareUrl.searchParams.set("signal", parseSignalingUrls(signaling).join(","));

  if (password.trim()) {
    shareUrl.searchParams.set("password", password.trim());
  }

  return shareUrl.toString();
}

function parseCollaborationInvite(value: string) {
  const rawValue = value.trim();
  if (!rawValue) {
    throw new Error("Paste the share URL first.");
  }

  let params: URLSearchParams;
  try {
    params = new URL(rawValue).searchParams;
  } catch {
    const fallback = rawValue.startsWith("?") ? rawValue.slice(1) : rawValue;
    params = new URLSearchParams(fallback);
  }

  const room = params.get("room")?.trim() ?? "";
  if (!room) {
    throw new Error("That invite is missing a room name.");
  }

  return {
    room,
    signaling:
      params.get("signal")?.trim() || DEFAULT_SIGNALING_URLS.join(", "),
    password: params.get("password")?.trim() || "",
  };
}

function getShortcutLabels() {
  if (typeof window === "undefined") {
    return {
      undo: "Ctrl+Z",
      redo: "Ctrl+Shift+Z",
    };
  }

  const navigatorWithPlatform = window.navigator as Navigator & {
    userAgentData?: {
      platform?: string;
    };
  };
  const platform =
    navigatorWithPlatform.userAgentData?.platform ??
    window.navigator.platform ??
    "";
  const isMac = /mac/i.test(platform);
  return {
    undo: isMac ? "Cmd+Z" : "Ctrl+Z",
    redo: isMac ? "Shift+Cmd+Z" : "Ctrl+Shift+Z",
  };
}

function formatCollaborationStateLabel(
  mode: CollaborationMode,
  state: CollaborationConnectionState,
  isStartingShare: boolean,
  isStartingConnect: boolean,
) {
  if (isStartingShare) {
    return "Starting share...";
  }

  if (isStartingConnect) {
    return "Connecting...";
  }

  if (state.peerCount > 0) {
    return state.peerCount === 1
      ? "1 peer connected"
      : `${state.peerCount} peers connected`;
  }

  if (mode === "sharing") {
    return state.connected ? "Sharing, waiting for peer" : "Opening share...";
  }

  if (mode === "connected") {
    return state.connected
      ? "Connected, waiting for host"
      : "Connecting to share...";
  }

  return "Not connected";
}

function getCollaborationStateTone(
  mode: CollaborationMode,
  state: CollaborationConnectionState,
  isStartingShare: boolean,
  isStartingConnect: boolean,
): CollaborationTone {
  if (isStartingShare || isStartingConnect) {
    return "pending";
  }

  if (state.peerCount > 0) {
    return "live";
  }

  if (mode === "sharing" || mode === "connected") {
    return state.connected ? "waiting" : "pending";
  }

  return "idle";
}

function buildCollaborationViewModel(
  mode: CollaborationMode,
  state: CollaborationConnectionState,
  isStartingShare: boolean,
  isStartingConnect: boolean,
  activeShareRoom: string,
  collaborationSignaling: string,
) {
  const remoteCollaborators = state.collaborators.filter(
    (collaborator) => !collaborator.isLocal,
  );
  const remoteCursors: CollaborationRemoteCursor[] =
    remoteCollaborators.flatMap((collaborator) =>
      collaborator.cursor
        ? [
            {
              clientId: collaborator.clientId,
              name: collaborator.name,
              color: collaborator.color,
              x: collaborator.cursor.x,
              y: collaborator.cursor.y,
            },
          ]
        : [],
    );

  return {
    pendingShareRoom: activeShareRoom || buildShareRoomName(),
    signalingLabel: parseSignalingUrls(collaborationSignaling).join(", "),
    stateLabel: formatCollaborationStateLabel(
      mode,
      state,
      isStartingShare,
      isStartingConnect,
    ),
    stateTone: getCollaborationStateTone(
      mode,
      state,
      isStartingShare,
      isStartingConnect,
    ),
    remoteCollaboratorNames: remoteCollaborators
      .map((collaborator) => collaborator.name)
      .join(", "),
    remoteCursors,
  };
}

function CollaborationDetailCard({
  label,
  value,
  meta,
}: {
  label: string;
  value: string;
  meta?: string;
}) {
  return (
    <div className="share-dialog__card">
      <span className="share-dialog__label">{label}</span>
      <strong>{value}</strong>
      {meta ? <span className="share-dialog__meta">{meta}</span> : null}
    </div>
  );
}

function normalizeMediaPath(value: string) {
  return value.replaceAll("/", "\\").toLowerCase();
}

function logClient(event: string, payload?: unknown) {
  if (payload === undefined) {
    console.info(`[zvid] ${event}`);
    return;
  }

  console.info(`[zvid] ${event}`, payload);
}

function revokeObjectUrlIfNeeded(url: string | undefined) {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

function getSourceThumbnailCacheKey(
  span: Pick<SourceSpan, "id" | "mediaId" | "trimStartSeconds">,
) {
  return `${span.id}:${span.mediaId ?? "missing"}:${span.trimStartSeconds.toFixed(3)}`;
}

function getSourceTrackEndQ(
  sourceSpans: SourceSpan[],
  sourceTrackId: string,
  bpm: number,
) {
  return sourceSpans.reduce((maximum, span) => {
    if (span.sourceTrackId !== sourceTrackId) {
      return maximum;
    }

    return Math.max(maximum, getClipEndQ(span, bpm));
  }, 0);
}

function sanitizeFilenameSegment(value: string) {
  const sanitized = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    if (code < 0x20 || '<>:"/\\|?*'.includes(character)) {
      return "-";
    }

    return character;
  })
    .join("")
    .trim();
  return sanitized || "zvid-session";
}

function patchProjectState(
  current: ProjectState,
  patch: Partial<ProjectState>,
) {
  let changed = false;
  const next = { ...current };

  for (const [rawKey, value] of Object.entries(patch) as Array<
    [keyof ProjectState, ProjectState[keyof ProjectState]]
  >) {
    if (Object.is(current[rawKey], value)) {
      continue;
    }

    changed = true;
    (next as ProjectState)[rawKey] = value as never;
  }

  return changed ? next : current;
}

function formatHistoryStatus(prefix: "Undid" | "Redid", label: string) {
  return `${prefix}: ${label}.`;
}

function isClipAtPlayhead(
  clip: ArrangementClip,
  playheadQ: number,
  bpm: number,
) {
  const epsilon = 0.0001;
  const clipEndQ = clip.startQ + secondsToQuarters(clip.durationSeconds, bpm);
  return playheadQ >= clip.startQ - epsilon && playheadQ < clipEndQ - epsilon;
}

function findClipAtPlayhead(
  clips: ArrangementClip[],
  playheadQ: number,
  bpm: number,
  lanePriority: Map<string, number>,
) {
  let match: ArrangementClip | undefined;
  let matchLaneRank = -1;
  let matchStartQ = -1;

  for (const clip of clips) {
    if (!isClipAtPlayhead(clip, playheadQ, bpm)) {
      continue;
    }

    const laneRank = lanePriority.get(clip.laneId) ?? -1;
    if (
      laneRank > matchLaneRank ||
      (laneRank === matchLaneRank && clip.startQ > matchStartQ)
    ) {
      match = clip;
      matchLaneRank = laneRank;
      matchStartQ = clip.startQ;
    }
  }

  return match;
}

function getPlaybackStopQ(
  clips: ArrangementClip[],
  mediaItems: MediaItem[],
  startQ: number,
  bpm: number,
) {
  const playableMediaIds = new Set(mediaItems.map((item) => item.id));

  return clips.reduce((maximum, clip) => {
    if (!clip.mediaId || !playableMediaIds.has(clip.mediaId)) {
      return maximum;
    }

    const clipEndQ = getClipEndQ(clip, bpm);
    if (clipEndQ <= startQ) {
      return maximum;
    }

    return Math.max(maximum, clipEndQ);
  }, startQ);
}

function pickMediaByPath(items: MediaItem[], rawPath: string) {
  const normalizedTarget = normalizeMediaPath(rawPath);
  const exactMatch = items.find(
    (item) =>
      item.sourcePath &&
      normalizeMediaPath(item.sourcePath) === normalizedTarget,
  );
  if (exactMatch) {
    return exactMatch;
  }

  const targetBase = basename(rawPath).toLowerCase();
  return items.find((item) => item.name.toLowerCase() === targetBase);
}

function chooseSourceSpanForWindow(
  spans: SourceSpan[],
  sourceTrackId: string,
  startQ: number,
  durationQ: number,
  bpm: number,
) {
  const endQ = startQ + durationQ;
  const sourceTrackSpans = spans.filter(
    (span) => span.sourceTrackId === sourceTrackId,
  );
  return (
    sourceTrackSpans.find((span) => {
      const spanEndQ = span.startQ + getClipDurationQ(span, bpm);
      return startQ >= span.startQ && startQ < spanEndQ;
    }) ??
    sourceTrackSpans.sort((left, right) => {
      const leftEnd = left.startQ + getClipDurationQ(left, bpm);
      const rightEnd = right.startQ + getClipDurationQ(right, bpm);
      const leftOverlap =
        Math.min(endQ, leftEnd) - Math.max(startQ, left.startQ);
      const rightOverlap =
        Math.min(endQ, rightEnd) - Math.max(startQ, right.startQ);
      return rightOverlap - leftOverlap;
    })[0]
  );
}

function sessionToProject(session: LvpSession, mediaItems: MediaItem[]) {
  const bpm = session.timeline?.bpm ?? 120;
  const fps = session.timeline?.fps ?? 30;
  const lanes = (session.mainTracks ?? DEFAULT_LANES).map<Lane>((track) => ({
    id: track.id,
    name: track.name,
    colorIndex: track.colorIndex ?? -1,
  }));
  const sourceTracks = (session.tracks ?? []).map<SourceTrack>((track) => ({
    id: track.id,
    name: track.name,
    colorIndex: track.colorIndex ?? -1,
    recordingPaths: (track.recordings ?? []).map(
      (recording) => recording.filename,
    ),
  }));
  const nameByTrack = new Map(
    sourceTracks.map((track) => [track.id, track.name]),
  );

  const sourceSpans = (session.clips ?? []).map<SourceSpan>((clip) => {
    const swatch = getSwatch(
      sourceTracks.find((track) => track.id === clip.trackId)?.colorIndex ?? 0,
    );
    const media = pickMediaByPath(mediaItems, clip.filePath);
    return {
      id: `source-${clip.id}`,
      sourceTrackId: clip.trackId,
      label:
        nameByTrack.get(clip.trackId) ?? clip.name ?? `Track ${clip.trackId}`,
      mediaPath: clip.filePath,
      mediaId: media?.id,
      startQ: secondsToQuarters(clip.frameStart / fps, bpm),
      durationSeconds: Math.max(1, clip.frameCount) / fps,
      trimStartSeconds:
        Math.max(0, (clip.clipStart ?? 0) + (clip.frameOffset ?? 0)) / fps,
      tint: swatch.color,
      accent: swatch.accent,
    };
  });

  const arrangementClips: ArrangementClip[] = [];

  for (const selection of session.selections ?? []) {
    const selectionStartQ = secondsToQuarters(selection.frameStart / fps, bpm);
    const selectionDurationQ = secondsToQuarters(
      Math.max(1, selection.frameEnd - selection.frameStart) / fps,
      bpm,
    );
    const sourceSpan = chooseSourceSpanForWindow(
      sourceSpans,
      selection.trackId,
      selectionStartQ,
      selectionDurationQ,
      bpm,
    );
    if (!sourceSpan) {
      continue;
    }

    const sourceOffsetSeconds =
      sourceSpan.trimStartSeconds - quartersToSeconds(sourceSpan.startQ, bpm);
    const startSeconds = selection.frameStart / fps;
    const durationSeconds =
      Math.max(1, selection.frameEnd - selection.frameStart) / fps;

    arrangementClips.push({
      id: `selection-${selection.id}`,
      sourceSpanId: sourceSpan.id,
      sourceTrackId: selection.trackId,
      laneId: selection.mainTrackId,
      label: nameByTrack.get(selection.trackId) ?? sourceSpan.label,
      mediaPath: sourceSpan.mediaPath,
      mediaId: sourceSpan.mediaId,
      startQ: selectionStartQ,
      durationSeconds,
      trimStartSeconds: startSeconds + sourceOffsetSeconds,
      sourceOffsetSeconds,
      sourceWindowStartSeconds: sourceSpan.trimStartSeconds,
      sourceWindowEndSeconds:
        sourceSpan.trimStartSeconds + sourceSpan.durationSeconds,
      tint: sourceSpan.tint,
      accent: sourceSpan.accent,
      selected: selection.selected,
    });
  }

  return {
    bpm,
    fps,
    canvasWidth: Math.max(320, session.timeline?.canvasWidth ?? 1080),
    canvasHeight: Math.max(320, session.timeline?.canvasHeight ?? 1920),
    lanes,
    sourceTracks,
    sourceSpans,
    arrangementClips,
    effects: mapEffects(session.effects),
    displaySeconds: session.timeline?.displaySeconds ?? false,
    snapToBeat: session.timeline?.snapToBeat ?? true,
    zoom: clamp(session.timeline?.zoom ?? 1, ZOOM_MIN, ZOOM_MAX),
    playPositionFrames: session.playPosition ?? 0,
    playStartPositionFrames: session.playStartPosition ?? 0,
    masterAudioMediaId: session.audioFilename
      ? pickMediaByPath(mediaItems, session.audioFilename)?.id
      : undefined,
    unresolvedPaths: arrangementClips
      .filter((clip) => !clip.mediaId)
      .map((clip) => basename(clip.mediaPath)),
  };
}

function buildStandaloneProject(mediaItems: MediaItem[]) {
  const lanes = DEFAULT_LANES;
  const canvasWidth = mediaItems.find((item) => item.width)?.width ?? 1080;
  const canvasHeight = mediaItems.find((item) => item.height)?.height ?? 1920;
  const sourceTracks = mediaItems.map<SourceTrack>((item, index) => ({
    id: `import-track-${index}`,
    name: item.name.replace(/\.[^/.]+$/, ""),
    colorIndex: index,
    recordingPaths: [item.name],
  }));
  const sourceSpans = mediaItems.map<SourceSpan>((item, index) => {
    const swatch = getSwatch(index);
    return {
      id: `source-span-${item.id}`,
      sourceTrackId: sourceTracks[index]?.id ?? `import-track-${index}`,
      label: item.name.replace(/\.[^/.]+$/, ""),
      mediaPath: item.name,
      mediaId: item.id,
      startQ: 0,
      durationSeconds: Math.max(1, item.durationSeconds),
      trimStartSeconds: 0,
      tint: swatch.color,
      accent: swatch.accent,
    };
  });
  const arrangementClips = mediaItems.map<ArrangementClip>((item, index) => {
    const sourceSpan = sourceSpans[index];
    return {
      id: `import-clip-${item.id}`,
      sourceSpanId: sourceSpan?.id ?? `source-span-${item.id}`,
      sourceTrackId:
        sourceSpan?.sourceTrackId ??
        sourceTracks[index]?.id ??
        `import-track-${index}`,
      laneId: lanes[index % lanes.length]?.id ?? lanes[0].id,
      label: item.name.replace(/\.[^/.]+$/, ""),
      mediaPath: item.name,
      mediaId: item.id,
      startQ: index * 4,
      durationSeconds: Math.max(1, item.durationSeconds),
      trimStartSeconds: index * quartersToSeconds(4, 120),
      sourceOffsetSeconds: 0,
      sourceWindowStartSeconds: 0,
      sourceWindowEndSeconds: Math.max(0, item.durationSeconds),
      tint: sourceSpan?.tint ?? getSwatch(index).color,
      accent: sourceSpan?.accent ?? getSwatch(index).accent,
    };
  });
  return {
    lanes,
    sourceTracks,
    sourceSpans,
    arrangementClips,
    canvasWidth,
    canvasHeight,
  };
}

function App() {
  const [initialCollaborationConfig] = useState(() =>
    getInitialCollaborationConfig(),
  );
  const [projectHistory, dispatchProject] = useReducer(
    projectHistoryReducer<ProjectState>,
    INITIAL_PROJECT_STATE,
    createProjectHistoryState<ProjectState>,
  );
  const {
    timelineMode,
    signatureId,
    snapMode,
    snapEnabled,
    bpm,
    fps,
    canvasWidth,
    canvasHeight,
    zoom,
    sessionName,
    mediaItems: projectMediaItems,
    lanes,
    sourceTracks,
    sourceSpans,
    clips,
    effects,
    masterAudioId,
  } = projectHistory.present;
  const canUndo = projectHistory.past.length > 0;
  const canRedo = projectHistory.future.length > 0;
  const undoLabel = projectHistory.past[projectHistory.past.length - 1]?.label;
  const redoLabel = projectHistory.future[0]?.label;

  const [dragPreviewClips, setDragPreviewClips] = useState<
    ArrangementClip[] | null
  >(null);
  const [selectedClipId, setSelectedClipId] = useState<string>();
  // The layer the FX chain edits. Selecting a clip selects its layer, and
  // clearing the clip selection keeps the layer.
  const [selectedLaneId, setSelectedLaneId] = useState<string>();
  const [pendingSelection, setPendingSelection] =
    useState<TimelineSelection | null>(null);
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(
    readInspectorCollapsed,
  );
  const [labelWidth, setLabelWidth] = useState(readLabelWidth);
  const labelResizeRef = useRef<{
    pointerId: number;
    pointerStartX: number;
    originWidth: number;
  } | null>(null);
  const [previewWidth, setPreviewWidth] = useState(readPreviewWidth);
  const [editorGridWidth, setEditorGridWidth] = useState(0);
  const [playheadQ, setPlayheadQ] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportState, setExportState] = useState<ExportState>({
    phase: "idle",
    progress: null,
    detail: "",
  });
  const [timelineViewport, setTimelineViewport] = useState<TimelineViewport>({
    scrollLeft: 0,
    clientWidth: 0,
  });
  const [status, setStatus] = useState(
    "Open a session or import media to get started.",
  );
  const [importNotice, setImportNotice] = useState<ImportNoticeContent | null>(
    null,
  );
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [timelineDragState, setTimelineDragState] =
    useState<TimelineDragState | null>(null);
  const [sourceTrackDragTarget, setSourceTrackDragTarget] =
    useState<SourceTrackDropTarget | null>(null);
  const [sourceTrackDragPreview, setSourceTrackDragPreview] =
    useState<SourceTrackDragPreview | null>(null);
  const [isTimelineAudibleScrubbing, setIsTimelineAudibleScrubbing] =
    useState(false);
  const [zoomDraft, setZoomDraft] = useState<number | null>(null);
  const [localMediaOverrides, setLocalMediaOverrides] = useState<
    Record<string, LocalMediaOverride>
  >({});
  const [sourceThumbnailUrls, setSourceThumbnailUrls] = useState<
    Record<string, string>
  >({});
  const [collaborationRoom, setCollaborationRoom] = useState(
    initialCollaborationConfig.room,
  );
  const [collaborationPassword, setCollaborationPassword] = useState(
    initialCollaborationConfig.password,
  );
  const [collaborationSignaling, setCollaborationSignaling] = useState(
    initialCollaborationConfig.signaling,
  );
  const [collaborationName] = useState(initialCollaborationConfig.name);
  const [collaborationMode, setCollaborationMode] = useState<CollaborationMode>(
    initialCollaborationConfig.autoConnect ? "connected" : "idle",
  );
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [isStartingShare, setIsStartingShare] = useState(false);
  const [isConnectDialogOpen, setIsConnectDialogOpen] = useState(false);
  const [isOfflineMediaDialogOpen, setIsOfflineMediaDialogOpen] =
    useState(false);
  const [relinkingMediaIds, setRelinkingMediaIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [connectInviteValue, setConnectInviteValue] = useState("");
  const [isStartingConnect, setIsStartingConnect] = useState(false);
  const [hasCopiedShareInvite, setHasCopiedShareInvite] = useState(false);
  const [lastCopiedShareUrl, setLastCopiedShareUrl] = useState("");
  const [collaborationState, setCollaborationState] =
    useState<CollaborationConnectionState>({
      connected: false,
      peerCount: 0,
      mediaPeerCount: 0,
      collaborators: [],
    });
  const [mediaHydrationTick, setMediaHydrationTick] = useState(0);
  const collaborationColor = initialCollaborationConfig.color;

  const playbackOriginRef = useRef(0);
  const playheadQRef = useRef(0);
  const playbackStopRef = useRef(0);
  const compositionPlayerRef = useRef<CompositionPlayerHandle | null>(null);
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const editorGridRef = useRef<HTMLDivElement | null>(null);
  const previewResizeRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const timelineScrubAudioTimeoutRef = useRef<number | null>(null);
  const clipClipboardRef = useRef<ArrangementClip | null>(null);
  const collaborationControllerRef =
    useRef<CollaborationController<ProjectState> | null>(null);
  const shareCopyResetTimeoutRef = useRef<number | null>(null);
  const projectSnapshotRef = useRef(projectHistory.present);
  const zoomDraftRef = useRef<number | null>(null);
  const localMediaOverridesRef = useRef<Record<string, LocalMediaOverride>>({});
  const mediaObjectUrlsRef = useRef(new Map<string, string>());
  const mediaHydrationInFlightRef = useRef(new Set<string>());
  const peerMediaTransfersRef = useRef(new Map<string, AbortController>());
  const peerMediaMissesRef = useRef<{
    controller: CollaborationController<ProjectState> | null;
    mediaPeerCount: number;
    ids: Set<string>;
  }>({ controller: null, mediaPeerCount: 0, ids: new Set() });
  const peerMediaStatusAtRef = useRef(0);
  const sessionMediaCheckRef = useRef<SessionMediaCheck | null>(null);
  const sourceThumbnailUrlsRef = useRef<Record<string, string>>({});
  const lastCollaborationCursorRef = useRef("");
  const sourceTrackDragPreviewRef = useRef<SourceTrackDragPreview | null>(null);
  const sourceTrackDragHideTimeoutRef = useRef<number | null>(null);
  const sourceTrackDragPreviewKeyRef = useRef<string>("");
  const sourceTrackDragPreviewRequestRef = useRef(0);

  const mediaItems = useMemo(
    () =>
      projectMediaItems.map((item) => ({
        ...item,
        ...(localMediaOverrides[item.id] ?? {}),
        availability:
          localMediaOverrides[item.id]?.availability ?? item.availability,
      })),
    [localMediaOverrides, projectMediaItems],
  );
  const mediaItemsById = useMemo(
    () => new Map(mediaItems.map((item) => [item.id, item])),
    [mediaItems],
  );
  // Serialized so the peer fetch effect only reruns when the set changes.
  const offlineClipMediaIdsKey = useMemo(() => {
    const ids = new Set<string>();
    for (const clip of clips) {
      if (
        clip.mediaId &&
        mediaItemsById.get(clip.mediaId)?.availability === "offline"
      ) {
        ids.add(clip.mediaId);
      }
    }
    return JSON.stringify(Array.from(ids).sort());
  }, [clips, mediaItemsById]);
  const lanePriority = useMemo(
    () => new Map(lanes.map((lane, index) => [lane.id, index])),
    [lanes],
  );
  const timelineClips = dragPreviewClips ?? clips;
  const resolvedZoom = zoomDraft ?? zoom;

  const commitProjectChange = useCallback(
    (label: string, updater: (current: ProjectState) => ProjectState) => {
      dispatchProject({ type: "commit", label, updater });
    },
    [],
  );

  const commitProjectPatch = useCallback(
    (label: string, patch: Partial<ProjectState>) => {
      commitProjectChange(label, (current) =>
        patchProjectState(current, patch),
      );
    },
    [commitProjectChange],
  );

  // Applies an effect-stack edit. Live gestures such as slider drags send
  // `transient` updates, and the `commit` that ends the gesture records the
  // whole gesture as one history entry.
  const editEffects = useCallback(
    (
      label: string,
      updater: (effects: SessionEffect[]) => SessionEffect[],
      mode: "commit" | "transient" = "commit",
    ) => {
      const projectUpdater = (current: ProjectState) =>
        patchProjectState(current, { effects: updater(current.effects) });
      dispatchProject(
        mode === "transient"
          ? { type: "transient", updater: projectUpdater }
          : { type: "commit", label, updater: projectUpdater },
      );
    },
    [],
  );

  const setLayerFxEnabled = useCallback(
    (laneId: string, enabled: boolean) => {
      commitProjectChange(
        effectHistoryLabels.layerFx(
          lanes.find((lane) => lane.id === laneId)?.name ?? `Layer ${laneId}`,
          enabled,
        ),
        (current) =>
          patchProjectState(current, {
            lanes: setLaneFxEnabled(current.lanes, laneId, enabled),
          }),
      );
    },
    [commitProjectChange, lanes],
  );

  const setFxDeviceEnabled = useCallback(
    (device: FxDevice, enabled: boolean) =>
      editEffects(
        effectHistoryLabels.enabled(device.effectName, enabled),
        (current) => setEffectEnabled(current, device.id, enabled),
      ),
    [editEffects],
  );

  const setFxDeviceParameter = useCallback(
    (device: FxDevice, key: string, value: number | string, mode: FxEditMode) =>
      editEffects(
        effectHistoryLabels.parameter(device.effectName, key),
        (current) => setEffectParameter(current, device.id, key, value),
        mode,
      ),
    [editEffects],
  );

  const moveFxDevice = useCallback(
    (device: FxDevice, toIndex: number) =>
      editEffects(effectHistoryLabels.move(device.effectName), (current) =>
        moveEffect(current, device.id, toIndex),
      ),
    [editEffects],
  );

  const addFxDevice = useCallback(
    (trackId: string, effectName: string, id: string) =>
      editEffects(effectHistoryLabels.add(effectName), (current) =>
        addEffect(current, trackId, effectName, undefined, id),
      ),
    [editEffects],
  );

  const removeFxDevice = useCallback(
    (device: FxDevice) =>
      editEffects(effectHistoryLabels.remove(device.effectName), (current) =>
        removeEffect(current, device.id),
      ),
    [editEffects],
  );

  const duplicateFxDevice = useCallback(
    (device: FxDevice, id: string) =>
      editEffects(effectHistoryLabels.duplicate(device.effectName), (current) =>
        duplicateEffect(current, device.id, id),
      ),
    [editEffects],
  );

  const updateZoomDraft = useCallback((nextZoom: number | null) => {
    zoomDraftRef.current = nextZoom;
    setZoomDraft(nextZoom);
  }, []);

  const setLocalMediaOverride = useCallback(
    (mediaId: string, patch: LocalMediaOverride) => {
      setLocalMediaOverrides((current) => {
        const previous = current[mediaId];
        const nextPreviewUrl = patch.previewUrl ?? previous?.previewUrl;
        const previousPreviewUrl = previous?.previewUrl;

        if (
          previousPreviewUrl &&
          previousPreviewUrl !== nextPreviewUrl &&
          mediaObjectUrlsRef.current.get(mediaId) === previousPreviewUrl
        ) {
          URL.revokeObjectURL(previousPreviewUrl);
          mediaObjectUrlsRef.current.delete(mediaId);
        }

        const next = {
          ...previous,
          ...patch,
        };
        if (next.availability === "ready") {
          delete next.lastError;
        }

        if (!next.previewUrl && !next.thumbnailUrl && !next.availability) {
          const rest = { ...current };
          delete rest[mediaId];
          return rest;
        }

        return {
          ...current,
          [mediaId]: next,
        };
      });
    },
    [],
  );

  const seedLocalMediaItems = useCallback(
    (items: MediaItem[]) => {
      for (const item of items) {
        if (item.previewUrl.startsWith("blob:")) {
          mediaObjectUrlsRef.current.set(item.id, item.previewUrl);
        }
        setLocalMediaOverride(item.id, {
          availability: item.previewUrl ? "ready" : item.availability,
          previewUrl: item.previewUrl || undefined,
          thumbnailUrl: item.thumbnailUrl,
        });
      }
    },
    [setLocalMediaOverride],
  );

  const adoptMediaBlob = useCallback(
    async (
      mediaId: string,
      blob: Blob,
      options?: { analyze?: boolean; verify?: boolean },
    ): Promise<AdoptMediaResult> => {
      const existing = projectSnapshotRef.current.mediaItems.find(
        (item) => item.id === mediaId,
      );

      let warning: string | undefined;
      if (options?.verify) {
        const kind =
          existing?.kind ??
          inferMediaKind(blob instanceof File ? blob.name : "");
        let probed: MediaProbeResult;
        try {
          probed = await probeMediaBlob(blob, kind);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          setLocalMediaOverride(mediaId, {
            availability: "offline",
            lastError: message,
          });
          logClient("media:adopt:verify:error", { mediaId, message });
          throw error;
        }

        if (
          existing &&
          existing.durationSeconds > 0 &&
          probed.durationSeconds > 0 &&
          Math.abs(probed.durationSeconds - existing.durationSeconds) >
            RELINK_DURATION_TOLERANCE_SECONDS
        ) {
          warning = `Duration differs from the original (${probed.durationSeconds.toFixed(1)}s vs ${existing.durationSeconds.toFixed(1)}s)`;
          logClient("media:adopt:verify:warning", { mediaId, warning });
        }
      }

      try {
        await cacheMediaBlob(mediaId, blob);
      } catch (error) {
        logClient("media:adopt:cache:error", {
          mediaId,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      const previousPreviewUrl = mediaObjectUrlsRef.current.get(mediaId);
      const previewUrl = URL.createObjectURL(blob);
      mediaObjectUrlsRef.current.set(mediaId, previewUrl);
      setLocalMediaOverride(mediaId, { availability: "ready", previewUrl });
      if (previousPreviewUrl && previousPreviewUrl !== previewUrl) {
        URL.revokeObjectURL(previousPreviewUrl);
      }

      if (!existing || !(options?.analyze || existing.durationSeconds === 0)) {
        return { previewUrl, warning };
      }

      try {
        const [result] = await getHarness().analyzeMedia(
          {
            kind: "files",
            files: [new File([blob], existing.name, { type: blob.type })],
          },
          PALETTE,
          0,
        );
        if (!result) {
          return { previewUrl, warning };
        }

        if (
          result.previewUrl.startsWith("blob:") &&
          result.previewUrl !== previewUrl
        ) {
          URL.revokeObjectURL(result.previewUrl);
        }
        const analyzed: MediaItem = {
          ...result,
          id: mediaId,
          color: existing.color,
          accent: existing.accent,
          sourcePath: existing.sourcePath ?? result.sourcePath,
          previewUrl,
        };
        seedLocalMediaItems([analyzed]);
        commitProjectChange("Hydrate media", (current) =>
          patchProjectState(current, {
            mediaItems: mergeMediaItemsById(current.mediaItems, [
              toShareableMediaItem(analyzed),
            ]),
          }),
        );
      } catch (error) {
        logClient("media:adopt:analyze:error", {
          mediaId,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      return { previewUrl, warning };
    },
    [commitProjectChange, seedLocalMediaItems, setLocalMediaOverride],
  );

  const cacheLocalMediaItems = useCallback(async (items: MediaItem[]) => {
    const harness = getHarness();
    await Promise.allSettled(
      items
        .filter((item) => item.previewUrl)
        .map(async (item) => {
          const blob = await harness.readMediaBlob(item);
          await cacheMediaBlob(item.id, blob);
        }),
    );
  }, []);

  const signature =
    SIGNATURES.find((candidate) => candidate.id === signatureId) ??
    SIGNATURES[0];
  const beatUnit = 4 / signature.denominator;
  const barLength = signature.numerator * beatUnit;
  const snapUnit = getSnapUnit(snapMode, signature);
  const quarterPx = BASE_QUARTER_PX * resolvedZoom;
  const totalQuarters = useMemo(() => {
    let nextTotalQuarters = barLength * 12;
    for (const clip of timelineClips) {
      nextTotalQuarters = Math.max(
        nextTotalQuarters,
        clip.startQ + getClipDurationQ(clip, bpm) + barLength,
      );
    }
    for (const span of sourceSpans) {
      nextTotalQuarters = Math.max(
        nextTotalQuarters,
        span.startQ + getClipDurationQ(span, bpm) + barLength,
      );
    }
    if (pendingSelection) {
      nextTotalQuarters = Math.max(
        nextTotalQuarters,
        getSelectionEndQ(pendingSelection) + barLength,
      );
    }

    return nextTotalQuarters;
  }, [barLength, bpm, pendingSelection, sourceSpans, timelineClips]);
  const timelineWidth = totalQuarters * quarterPx;
  const gridStyle = useMemo(
    () => ({
      backgroundImage:
        "linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(to right, rgba(255,255,255,0.16) 1px, transparent 1px)",
      backgroundSize: `${beatUnit * quarterPx}px 100%, ${barLength * quarterPx}px 100%`,
    }),
    [barLength, beatUnit, quarterPx],
  );
  const selectedClip = useMemo(
    () =>
      timelineClips.find((clip) => clip.id === selectedClipId) ??
      timelineClips.find((clip) => clip.selected) ??
      timelineClips[0],
    [selectedClipId, timelineClips],
  );
  const playheadClip = useMemo(
    () => findClipAtPlayhead(timelineClips, playheadQ, bpm, lanePriority),
    [bpm, lanePriority, playheadQ, timelineClips],
  );
  const previewClip = playheadClip ?? selectedClip;
  const previewMedia = previewClip?.mediaId
    ? mediaItemsById.get(previewClip.mediaId)
    : undefined;
  const previewMediaState = describeMediaAvailability(
    previewMedia?.availability,
  );
  // The compositor draws every online layer at the playhead, so an offline
  // clip on one layer only covers the preview when no layer can be drawn.
  const hasOnlinePlayheadClip = useMemo(
    () =>
      timelineClips.some(
        (clip) =>
          isClipAtPlayhead(clip, playheadQ, bpm) &&
          describeMediaAvailability(
            clip.mediaId
              ? mediaItemsById.get(clip.mediaId)?.availability
              : undefined,
          ) === "online",
      ),
    [bpm, mediaItemsById, playheadQ, timelineClips],
  );
  // Unlike `selectedClip`, this does not fall back to the first clip.
  const explicitClip = useMemo(
    () => timelineClips.find((clip) => clip.id === selectedClipId),
    [selectedClipId, timelineClips],
  );
  const explicitClipLaneId = explicitClip?.laneId;
  useEffect(() => {
    if (explicitClipLaneId !== undefined) {
      setSelectedLaneId(explicitClipLaneId);
    }
  }, [explicitClipLaneId]);
  const fxLaneId = useMemo(
    () => resolveSelectedLaneId(lanes, effects, selectedLaneId, explicitClip),
    [effects, explicitClip, lanes, selectedLaneId],
  );
  const fxLane = lanes.find((lane) => lane.id === fxLaneId);
  const selectLaneFromLabel = (laneId: string) => {
    setSelectedClipId(undefined);
    setSelectedLaneId(laneId);
  };
  // Audio clips have no visual effects; that only applies while one is
  // selected, not to the layer on its own.
  const fxKind = explicitClip?.mediaId
    ? mediaItemsById.get(explicitClip.mediaId)?.kind
    : undefined;
  const fxDevices = useMemo(
    () =>
      fxLaneId
        ? mapSessionEffectsToDevices(effects, fxLaneId, fxKind, fxLane?.name)
        : [],
    [effects, fxKind, fxLane?.name, fxLaneId],
  );
  const playheadSeconds = quartersToSeconds(playheadQ, bpm);
  const masterAudio = masterAudioId
    ? mediaItemsById.get(masterAudioId)
    : undefined;
  const canCreateLayer = lanes.length < MAX_LAYERS;
  // Only peaks decoded from the master audio are drawn; until they exist the
  // lane shows why there is no waveform instead of a placeholder.
  const masterAudioUrl =
    masterAudio?.availability === "ready" ? masterAudio.previewUrl : "";
  const masterWaveformKey =
    masterAudioId && masterAudioUrl
      ? `${masterAudioId}\n${masterAudioUrl}`
      : "";
  const [masterWaveform, setMasterWaveform] = useState<{
    key: string;
    status: "ready" | "no-audio" | "error";
    peaks?: WaveformPeaks;
  } | null>(null);
  useEffect(() => {
    if (!masterAudioId || !masterAudioUrl) {
      return;
    }

    const key = `${masterAudioId}\n${masterAudioUrl}`;
    let cancelled = false;
    loadWaveformPeaks(masterAudioId, masterAudioUrl).then(
      (result) => {
        if (!cancelled) {
          setMasterWaveform(
            result.status === "ready"
              ? { key, status: "ready", peaks: result.peaks }
              : { key, status: "no-audio" },
          );
        }
      },
      (error: unknown) => {
        logClient("waveform:decode:error", {
          mediaId: masterAudioId,
          message: error instanceof Error ? error.message : String(error),
        });
        if (!cancelled) {
          setMasterWaveform({ key, status: "error" });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [masterAudioId, masterAudioUrl]);
  const currentMasterWaveform =
    masterWaveform && masterWaveform.key === masterWaveformKey
      ? masterWaveform
      : null;
  const masterWaveformMessage = !masterAudio
    ? "No master audio track in this session"
    : masterAudio.availability === "offline"
      ? "Master audio is offline"
      : masterAudio.availability === "hydrating"
        ? "Waiting for master audio…"
        : !currentMasterWaveform
          ? "Analyzing master audio…"
          : currentMasterWaveform.status === "no-audio"
            ? "No audio found in master audio file"
            : currentMasterWaveform.status === "error"
              ? "Could not decode master audio"
              : null;
  const timelineContentEndQ = useMemo(
    () =>
      getTimelineContentEndQ(
        timelineClips,
        sourceSpans,
        masterAudio?.durationSeconds,
        bpm,
        barLength,
      ),
    [barLength, bpm, masterAudio?.durationSeconds, sourceSpans, timelineClips],
  );
  const rulerBars = useMemo(() => {
    const barCount = Math.ceil(totalQuarters / barLength);
    return Array.from({ length: barCount }, (_, index) => ({
      index,
      quarter: index * barLength,
    }));
  }, [barLength, totalQuarters]);
  // Arrangement and source-track clips both count, so sessions whose media
  // is only used on source tracks still surface the Locate Media shortcut.
  const offlineMedia = useMemo(
    () => listOfflineMedia(mediaItems, [...timelineClips, ...sourceSpans]),
    [mediaItems, sourceSpans, timelineClips],
  );
  const offlineCount = useMemo(() => {
    const missingKeys = new Set<string>();
    for (const clip of [...timelineClips, ...sourceSpans]) {
      // Placeholder clips, such as MIDI imported from a Live set, never had
      // media, so there is no file to report as offline.
      if (!clip.mediaId && !clip.mediaPath?.trim()) {
        continue;
      }

      if (!clip.mediaId || !mediaItemsById.has(clip.mediaId)) {
        missingKeys.add(clip.mediaId ?? `clip:${clip.id}`);
      }
    }
    return (
      offlineMedia.filter((entry) => entry.state === "offline").length +
      missingKeys.size
    );
  }, [mediaItemsById, offlineMedia, sourceSpans, timelineClips]);
  const sessionMediaStatus = useMemo(() => {
    if (!mediaItems.length) {
      return "No media";
    }

    const pendingCount = mediaItems.filter(
      (item) => item.availability !== "ready",
    ).length;
    return pendingCount
      ? `${pluralize(pendingCount, "media file")} not ready`
      : "Media linked";
  }, [mediaItems]);
  const clipsByLane = useMemo(() => {
    const next = new Map<string, ArrangementClip[]>();
    for (const clip of timelineClips) {
      const laneClips = next.get(clip.laneId);
      if (laneClips) {
        laneClips.push(clip);
        continue;
      }

      next.set(clip.laneId, [clip]);
    }
    return next;
  }, [timelineClips]);
  const laneStatusById = useMemo(() => {
    const next = new Map<
      string,
      {
        effectCount: number;
        fxToggle?: boolean;
        fxClassName: string;
        fxTitle?: string;
        summary: string;
      }
    >();
    for (const lane of lanes) {
      const clipCount = clipsByLane.get(lane.id)?.length ?? 0;
      const effectCount = effects.filter(
        (effect) => effect.trackId === lane.id,
      ).length;
      const fxEnabled = isLayerFxEnabled(lane);
      const summary = [
        clipCount ? pluralize(clipCount, "clip") : "",
        !fxEnabled
          ? "FX off"
          : effectCount
            ? pluralize(effectCount, "effect")
            : "",
      ]
        .filter(Boolean)
        .join(" · ");
      next.set(lane.id, {
        effectCount,
        // Without effects the badge stays inactive and cannot be toggled.
        fxToggle: effectCount ? fxEnabled : undefined,
        fxClassName: !effectCount
          ? "track-label__fx--inactive"
          : fxEnabled
            ? ""
            : "track-label__fx--off",
        fxTitle: effectCount
          ? `Turn ${lane.name} FX ${fxEnabled ? "off" : "on"}`
          : undefined,
        summary: summary || "Empty",
      });
    }
    return next;
  }, [clipsByLane, effects, lanes]);
  const sourceSpansByTrack = useMemo(() => {
    const next = new Map<string, SourceSpan[]>();
    for (const clip of sourceSpans) {
      const trackClips = next.get(clip.sourceTrackId);
      if (trackClips) {
        trackClips.push(clip);
        continue;
      }

      next.set(clip.sourceTrackId, [clip]);
    }
    return next;
  }, [sourceSpans]);
  const isSourceTrackFileDragActive = Boolean(sourceTrackDragTarget);
  const minimumWindowQ = Math.max(snapUnit, beatUnit / 4);
  const visibleTimelineStartPx = Math.max(0, timelineViewport.scrollLeft);
  const visibleTimelineWidthPx = Math.max(
    0,
    timelineViewport.clientWidth - labelWidth,
  );
  const visibleTimelineEndPx = visibleTimelineStartPx + visibleTimelineWidthPx;
  const playheadTimelinePx = Math.round(playheadQ * quarterPx);
  const isPlayheadOffscreenLeft =
    visibleTimelineWidthPx > 0 && playheadTimelinePx < visibleTimelineStartPx;
  const isPlayheadOffscreenRight =
    visibleTimelineWidthPx > 0 && playheadTimelinePx > visibleTimelineEndPx;
  const exportButtonLabel = isExporting
    ? exportState.progress !== null
      ? `${exportState.progress}%`
      : exportState.phase === "muxing"
        ? "Muxing..."
        : exportState.phase === "decoding-audio"
          ? "Audio..."
          : "Render..."
    : "Export";
  const sourceTrackDragPreviewDetail = sourceTrackDragPreview
    ? sourceTrackDragPreview.status === "loading"
      ? "Loading clip preview..."
      : sourceTrackDragPreview.status === "error"
        ? sourceTrackDragPreview.fileCount > 1
          ? `${pluralize(sourceTrackDragPreview.fileCount, "file")} ready to import`
          : "Drop to import without a preview"
        : sourceTrackDragPreview.durationSeconds !== undefined
          ? `${sourceTrackDragPreview.kind === "audio" ? "Audio" : "Video"} · ${formatDuration(
              sourceTrackDragPreview.durationSeconds,
            )}`
          : sourceTrackDragPreview.kind === "audio"
            ? "Audio clip"
            : "Media clip"
    : "";
  const sourceTrackDragPreviewOverflow =
    sourceTrackDragPreview && sourceTrackDragPreview.fileCount > 1
      ? `+${sourceTrackDragPreview.fileCount - 1} more`
      : null;
  const isNewSourceTrackDropTarget =
    sourceTrackDragTarget?.kind === "new-track";

  const clearSourceTrackDragState = useCallback(() => {
    if (sourceTrackDragHideTimeoutRef.current !== null) {
      window.clearTimeout(sourceTrackDragHideTimeoutRef.current);
      sourceTrackDragHideTimeoutRef.current = null;
    }

    sourceTrackDragPreviewKeyRef.current = "";
    sourceTrackDragPreviewRequestRef.current += 1;
    setSourceTrackDragTarget(null);
    setSourceTrackDragPreview((current) => {
      revokeObjectUrlIfNeeded(current?.thumbnailUrl);
      return null;
    });
  }, []);

  const scheduleSourceTrackDragClear = useCallback(() => {
    if (sourceTrackDragHideTimeoutRef.current !== null) {
      window.clearTimeout(sourceTrackDragHideTimeoutRef.current);
    }

    sourceTrackDragHideTimeoutRef.current = window.setTimeout(() => {
      sourceTrackDragHideTimeoutRef.current = null;
      clearSourceTrackDragState();
    }, SOURCE_TRACK_DRAG_CLEAR_DELAY_MS);
  }, [clearSourceTrackDragState]);

  const ensureSourceTrackDragPreview = useCallback(
    (files: File[]) => {
      const dragKey = buildDraggedMediaKey(files);
      const nextLabel = stripFilenameExtension(files[0]?.name ?? "Media clip");

      setSourceTrackDragPreview((current) => {
        if (current?.dragKey === dragKey) {
          return current;
        }

        revokeObjectUrlIfNeeded(current?.thumbnailUrl);
        return {
          dragKey,
          fileCount: files.length,
          names: files.map((file) => file.name),
          label: nextLabel,
          status: "loading",
        };
      });

      if (sourceTrackDragPreviewKeyRef.current === dragKey) {
        return;
      }

      sourceTrackDragPreviewKeyRef.current = dragKey;
      const requestId = ++sourceTrackDragPreviewRequestRef.current;

      void (async () => {
        try {
          const [previewItem] = await getHarness().analyzeMedia(
            {
              kind: "files",
              files: [files[0]],
            },
            PALETTE,
            mediaItems.length,
          );
          const thumbnailUrl = previewItem?.thumbnailUrl;

          if (requestId !== sourceTrackDragPreviewRequestRef.current) {
            revokeObjectUrlIfNeeded(thumbnailUrl);
            return;
          }

          setSourceTrackDragPreview((current) => {
            if (!current || current.dragKey !== dragKey) {
              revokeObjectUrlIfNeeded(thumbnailUrl);
              return current;
            }

            if (current.thumbnailUrl !== thumbnailUrl) {
              revokeObjectUrlIfNeeded(current.thumbnailUrl);
            }

            return {
              ...current,
              label: stripFilenameExtension(previewItem.name),
              status: "ready",
              kind: previewItem.kind,
              durationSeconds: previewItem.durationSeconds,
              thumbnailUrl,
            };
          });
        } catch (error) {
          if (requestId !== sourceTrackDragPreviewRequestRef.current) {
            return;
          }

          const message =
            error instanceof Error ? error.message : String(error);
          setSourceTrackDragPreview((current) =>
            current?.dragKey === dragKey
              ? {
                  ...current,
                  status: "error",
                  error: message,
                }
              : current,
          );
        }
      })();
    },
    [mediaItems.length],
  );

  const handleSourceTrackDragEvent = useCallback(
    (event: ReactDragEvent<HTMLElement>, target: SourceTrackDropTarget) => {
      const files = getDraggedMediaFiles(event.dataTransfer);
      if (!files.length) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";

      if (sourceTrackDragHideTimeoutRef.current !== null) {
        window.clearTimeout(sourceTrackDragHideTimeoutRef.current);
        sourceTrackDragHideTimeoutRef.current = null;
      }

      setSourceTrackDragTarget(target);
      ensureSourceTrackDragPreview(files);
    },
    [ensureSourceTrackDragPreview],
  );

  const resolveSourceTrackDropTargetAtPoint = useCallback(
    (clientX: number, clientY: number): SourceTrackDropTarget | null => {
      const element = document.elementFromPoint(clientX, clientY);
      const target = element?.closest<HTMLElement>(
        "[data-source-track-drop-target]",
      );
      const targetKind = target?.dataset.sourceTrackDropTarget;
      if (targetKind === "track" && target?.dataset.sourceTrackId) {
        return {
          kind: "track",
          trackId: target.dataset.sourceTrackId,
        };
      }

      if (targetKind === "new-track") {
        return { kind: "new-track" };
      }

      return sourceTracks.length ? { kind: "new-track" } : null;
    },
    [sourceTracks.length],
  );

  const importMediaIntoSourceTrack = useCallback(
    async (files: File[], target: SourceTrackDropTarget) => {
      const harness = getHarness();

      try {
        setStatus(
          `Analyzing ${pluralize(files.length, "dropped media file")}...`,
        );
        const analyzed = await harness.analyzeMedia(
          {
            kind: "files",
            files,
          },
          PALETTE,
          projectMediaItems.length,
        );
        const sharedAnalyzed = analyzed.map((item) =>
          toShareableMediaItem(item),
        );

        commitProjectChange("Drop media into source tracks", (current) => {
          const nextMediaItems = [...current.mediaItems, ...sharedAnalyzed];
          let nextSourceTracks = current.sourceTracks;
          let nextSourceSpans = current.sourceSpans;

          let targetTrack =
            target.kind === "track"
              ? current.sourceTracks.find(
                  (track) => track.id === target.trackId,
                )
              : undefined;

          if (!targetTrack) {
            targetTrack = {
              id: `source-track-${crypto.randomUUID()}`,
              name: stripFilenameExtension(analyzed[0]?.name ?? "Source Track"),
              colorIndex: current.sourceTracks.length,
              recordingPaths: [],
            };
            nextSourceTracks = [...current.sourceTracks, targetTrack];
          }

          const mediaPaths = analyzed.map(
            (item) => item.sourcePath ?? item.name,
          );
          nextSourceTracks = nextSourceTracks.map((track) =>
            track.id === targetTrack.id
              ? {
                  ...track,
                  recordingPaths: [...track.recordingPaths, ...mediaPaths],
                }
              : track,
          );

          const swatch = getSwatch(targetTrack.colorIndex);
          let insertQ = getSourceTrackEndQ(
            current.sourceSpans,
            targetTrack.id,
            current.bpm,
          );
          const appendedSpans = analyzed.map<SourceSpan>((item) => {
            const span: SourceSpan = {
              id: `source-span-${crypto.randomUUID()}`,
              sourceTrackId: targetTrack.id,
              label: stripFilenameExtension(item.name),
              mediaPath: item.sourcePath ?? item.name,
              mediaId: item.id,
              startQ: insertQ,
              durationSeconds: Math.max(1, item.durationSeconds),
              trimStartSeconds: 0,
              tint: swatch.color,
              accent: swatch.accent,
            };
            insertQ += getClipDurationQ(span, current.bpm);
            return span;
          });
          nextSourceSpans = [...current.sourceSpans, ...appendedSpans];

          const patch: Partial<ProjectState> = {
            mediaItems: nextMediaItems,
            sourceTracks: nextSourceTracks,
            sourceSpans: nextSourceSpans,
          };
          if (
            !current.sessionName &&
            !current.mediaItems.length &&
            !current.sourceTracks.length &&
            !current.sourceSpans.length &&
            !current.clips.length
          ) {
            const sizedMedia = analyzed.find(
              (item) => item.width && item.height,
            );
            if (sizedMedia?.width && sizedMedia.height) {
              patch.canvasWidth = Math.max(320, sizedMedia.width);
              patch.canvasHeight = Math.max(320, sizedMedia.height);
            }
          }

          return patchProjectState(current, patch);
        });

        seedLocalMediaItems(analyzed);
        void cacheLocalMediaItems(analyzed);
        setStatus(
          `Dropped ${pluralize(analyzed.length, "media file")} into ${
            target.kind === "track"
              ? "the selected source track"
              : "a new source track"
          }.`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`Dropped media import failed: ${message}`);
      }
    },
    [
      cacheLocalMediaItems,
      commitProjectChange,
      projectMediaItems.length,
      seedLocalMediaItems,
    ],
  );

  const activeShareRoom = collaborationRoom.trim();
  const isSharing = collaborationMode === "sharing";
  const isConnectedClient = collaborationMode === "connected";
  const collaborationView = useMemo(
    () =>
      buildCollaborationViewModel(
        collaborationMode,
        collaborationState,
        isStartingShare,
        isStartingConnect,
        activeShareRoom,
        collaborationSignaling,
      ),
    [
      activeShareRoom,
      collaborationMode,
      collaborationSignaling,
      collaborationState,
      isStartingConnect,
      isStartingShare,
    ],
  );
  const shortcutLabels = useMemo(() => getShortcutLabels(), []);
  const previewMaxWidth = getPreviewMaxWidth(editorGridWidth);
  const effectivePreviewWidth = Math.min(previewWidth, previewMaxWidth);

  useEffect(() => {
    sourceThumbnailUrlsRef.current = sourceThumbnailUrls;
  }, [sourceThumbnailUrls]);

  useEffect(() => {
    sourceTrackDragPreviewRef.current = sourceTrackDragPreview;
  }, [sourceTrackDragPreview]);

  useEffect(() => {
    const editorGrid = editorGridRef.current;
    if (!editorGrid) {
      return;
    }

    setEditorGridWidth(editorGrid.clientWidth);
    const observer = new ResizeObserver(() => {
      setEditorGridWidth(editorGrid.clientWidth);
    });
    observer.observe(editorGrid);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const appShell = appShellRef.current;
    if (!appShell) {
      return;
    }

    const isWithinAppShell = (clientX: number, clientY: number) => {
      const bounds = appShell.getBoundingClientRect();
      return (
        clientX >= bounds.left &&
        clientX <= bounds.right &&
        clientY >= bounds.top &&
        clientY <= bounds.bottom
      );
    };

    const handleWindowDrag = (event: DragEvent) => {
      if (!hasDraggedFileData(event.dataTransfer)) {
        return;
      }

      if (!isWithinAppShell(event.clientX, event.clientY)) {
        scheduleSourceTrackDragClear();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const target = resolveSourceTrackDropTargetAtPoint(
        event.clientX,
        event.clientY,
      );
      if (target) {
        setSourceTrackDragTarget(target);
      }

      const files = getDraggedMediaFiles(event.dataTransfer);
      if (files.length) {
        ensureSourceTrackDragPreview(files);
      }
    };

    const handleWindowDrop = (event: DragEvent) => {
      if (!hasDraggedFileData(event.dataTransfer)) {
        return;
      }

      if (!isWithinAppShell(event.clientX, event.clientY)) {
        clearSourceTrackDragState();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const files = getDraggedMediaFiles(event.dataTransfer);
      if (!files.length) {
        clearSourceTrackDragState();
        return;
      }

      const target = resolveSourceTrackDropTargetAtPoint(
        event.clientX,
        event.clientY,
      ) ?? {
        kind: "new-track" as const,
      };
      clearSourceTrackDragState();
      void importMediaIntoSourceTrack(files, target);
    };

    const handleWindowDragLeave = (event: DragEvent) => {
      if (!hasDraggedFileData(event.dataTransfer)) {
        return;
      }

      const leavingWindow =
        event.clientX <= 0 ||
        event.clientY <= 0 ||
        event.clientX >= window.innerWidth ||
        event.clientY >= window.innerHeight;
      if (leavingWindow) {
        event.stopPropagation();
        scheduleSourceTrackDragClear();
      }
    };

    window.addEventListener("dragenter", handleWindowDrag, true);
    window.addEventListener("dragover", handleWindowDrag, true);
    window.addEventListener("dragleave", handleWindowDragLeave, true);
    window.addEventListener("drop", handleWindowDrop, true);

    return () => {
      window.removeEventListener("dragenter", handleWindowDrag, true);
      window.removeEventListener("dragover", handleWindowDrag, true);
      window.removeEventListener("dragleave", handleWindowDragLeave, true);
      window.removeEventListener("drop", handleWindowDrop, true);
    };
  }, [
    clearSourceTrackDragState,
    ensureSourceTrackDragPreview,
    importMediaIntoSourceTrack,
    resolveSourceTrackDropTargetAtPoint,
    scheduleSourceTrackDragClear,
  ]);

  useEffect(
    () => () => {
      if (shareCopyResetTimeoutRef.current !== null) {
        window.clearTimeout(shareCopyResetTimeoutRef.current);
      }

      if (sourceTrackDragHideTimeoutRef.current !== null) {
        window.clearTimeout(sourceTrackDragHideTimeoutRef.current);
      }

      revokeObjectUrlIfNeeded(sourceTrackDragPreviewRef.current?.thumbnailUrl);
    },
    [],
  );

  useEffect(() => {
    const activeSpanIds = new Set(
      sourceSpans.map((span) => getSourceThumbnailCacheKey(span)),
    );

    setSourceThumbnailUrls((current) => {
      let changed = false;
      const next: Record<string, string> = {};

      for (const [spanId, url] of Object.entries(current)) {
        if (activeSpanIds.has(spanId)) {
          next[spanId] = url;
          continue;
        }

        revokeObjectUrlIfNeeded(url);
        changed = true;
      }

      if (!changed) {
        return current;
      }

      sourceThumbnailUrlsRef.current = next;
      return next;
    });
  }, [sourceSpans]);

  useEffect(() => {
    let cancelled = false;
    const mediaById = new Map(mediaItems.map((item) => [item.id, item]));

    async function populateSourceThumbnails() {
      const harness = getHarness();
      const resolved = await Promise.all(
        sourceSpans.map(async (span) => {
          const cacheKey = getSourceThumbnailCacheKey(span);
          if (sourceThumbnailUrlsRef.current[cacheKey]) {
            return null;
          }

          const media = span.mediaId ? mediaById.get(span.mediaId) : undefined;
          if (!media?.hasVideo) {
            return null;
          }

          const fallbackUrl = media.thumbnailUrl;
          if (!harness.generateThumbnailAtTime) {
            return fallbackUrl ? { cacheKey, url: fallbackUrl } : null;
          }

          try {
            const exactUrl = await harness.generateThumbnailAtTime(
              media,
              span.trimStartSeconds,
            );
            return exactUrl || fallbackUrl
              ? {
                  cacheKey,
                  url: exactUrl ?? fallbackUrl ?? "",
                }
              : null;
          } catch (error) {
            logClient("sourceThumbnail:error", {
              spanId: span.id,
              mediaId: media.id,
              message: error instanceof Error ? error.message : String(error),
            });
            return fallbackUrl ? { cacheKey, url: fallbackUrl } : null;
          }
        }),
      );

      const nextEntries = resolved.filter(
        (entry): entry is { cacheKey: string; url: string } => Boolean(entry),
      );
      if (cancelled) {
        const currentUrls = new Set(
          Object.values(sourceThumbnailUrlsRef.current),
        );
        for (const entry of nextEntries) {
          if (!currentUrls.has(entry.url)) {
            revokeObjectUrlIfNeeded(entry.url);
          }
        }
        return;
      }

      if (!nextEntries.length) {
        return;
      }

      const activeSpanIds = new Set(
        sourceSpans.map((span) => getSourceThumbnailCacheKey(span)),
      );
      setSourceThumbnailUrls((current) => {
        const next = { ...current };
        let changed = false;

        for (const entry of nextEntries) {
          if (!activeSpanIds.has(entry.cacheKey)) {
            revokeObjectUrlIfNeeded(entry.url);
            continue;
          }

          const previousUrl = next[entry.cacheKey];
          if (previousUrl === entry.url) {
            continue;
          }

          revokeObjectUrlIfNeeded(previousUrl);
          next[entry.cacheKey] = entry.url;
          changed = true;
        }

        if (!changed) {
          for (const entry of nextEntries) {
            if (current[entry.cacheKey] !== entry.url) {
              revokeObjectUrlIfNeeded(entry.url);
            }
          }
          return current;
        }

        sourceThumbnailUrlsRef.current = next;
        return next;
      });
    }

    if (sourceSpans.length) {
      void populateSourceThumbnails();
    }

    return () => {
      cancelled = true;
    };
  }, [mediaItems, sourceSpans]);

  useEffect(() => {
    return () => {
      for (const url of Object.values(sourceThumbnailUrlsRef.current)) {
        revokeObjectUrlIfNeeded(url);
      }
    };
  }, []);

  const syncTimelineViewport = useCallback(() => {
    const timelineScroll = timelineScrollRef.current;
    if (!timelineScroll) {
      return;
    }

    setTimelineViewport({
      scrollLeft: timelineScroll.scrollLeft,
      clientWidth: timelineScroll.clientWidth,
    });
  }, []);

  const flushZoomDraft = useCallback(
    (label = "Adjust zoom") => {
      const pendingZoom = zoomDraftRef.current;
      updateZoomDraft(null);
      if (pendingZoom === null || Math.abs(pendingZoom - zoom) <= 0.0001) {
        return;
      }

      commitProjectPatch(label, { zoom: pendingZoom });
    },
    [commitProjectPatch, zoom, updateZoomDraft],
  );

  function handleCreateLayer() {
    if (!canCreateLayer) {
      setStatus(`You already have the maximum of ${MAX_LAYERS} layers.`);
      return;
    }

    const nextLayerNumber = getNextLaneNumber(lanes);
    const nextLane: Lane = {
      id: createLaneId(lanes),
      name: `Layer ${nextLayerNumber}`,
      colorIndex: -1,
    };

    commitProjectChange("Create layer", (current) =>
      patchProjectState(current, {
        lanes: [...current.lanes, nextLane],
      }),
    );
    setStatus(`Created ${nextLane.name}.`);
  }

  function scrollTimelineToPlayhead() {
    const timelineScroll = timelineScrollRef.current;
    if (!timelineScroll) {
      return;
    }

    const playheadPx = labelWidth + playheadTimelinePx;
    const targetLeft = clamp(
      playheadPx - timelineScroll.clientWidth / 2,
      0,
      Math.max(0, labelWidth + timelineWidth - timelineScroll.clientWidth),
    );

    timelineScroll.scrollTo({
      left: targetLeft,
      behavior: "smooth",
    });
  }

  const startPlayback = useCallback(
    (fromQ: number = playheadQ) => {
      const epsilon = 0.0001;
      const stopQ = getPlaybackStopQ(
        timelineClips,
        projectMediaItems,
        fromQ,
        bpm,
      );
      if (stopQ <= fromQ + epsilon) {
        setStatus("No more playable source clips after the playhead.");
        return;
      }

      playbackOriginRef.current = fromQ;
      playbackStopRef.current = stopQ;
      setIsPlaying(true);
    },
    [bpm, playheadQ, projectMediaItems, timelineClips],
  );

  // An explicit transport action during a ruler scrub decides the state after
  // release, so drop the pending resume.
  const cancelScrubPlaybackResume = useCallback(() => {
    setTimelineDragState((current) =>
      current?.wasPlaying ? { ...current, wasPlaying: false } : current,
    );
  }, []);

  const createWindowClip = useCallback(
    (
      selection: TimelineSelection,
      sourceTrack: SourceTrack,
      sourceSpan: SourceSpan,
    ): ArrangementClip => {
      const sourceOffsetSeconds =
        sourceSpan.trimStartSeconds - quartersToSeconds(sourceSpan.startQ, bpm);
      return {
        id: `window-${crypto.randomUUID()}`,
        sourceSpanId: sourceSpan.id,
        sourceTrackId: sourceTrack.id,
        laneId: selection.laneId,
        label: sourceTrack.name,
        mediaPath: sourceSpan.mediaPath,
        mediaId: sourceSpan.mediaId,
        startQ: selection.startQ,
        durationSeconds: quartersToSeconds(selection.durationQ, bpm),
        trimStartSeconds:
          quartersToSeconds(selection.startQ, bpm) + sourceOffsetSeconds,
        sourceOffsetSeconds,
        sourceWindowStartSeconds: sourceSpan.trimStartSeconds,
        sourceWindowEndSeconds:
          sourceSpan.trimStartSeconds + sourceSpan.durationSeconds,
        tint: sourceSpan.tint,
        accent: sourceSpan.accent,
        selected: true,
      };
    },
    [bpm],
  );

  const commitPendingSelectionToSourceTrack = useCallback(
    (sourceIndex: number) => {
      if (!pendingSelection) {
        return;
      }

      const sourceTrack = sourceTracks[sourceIndex];
      if (!sourceTrack) {
        setStatus(
          `Source layer ${sourceIndex + 1} is not available in this session.`,
        );
        return;
      }

      const sourceSpan = chooseSourceSpanForWindow(
        sourceSpans,
        sourceTrack.id,
        pendingSelection.startQ,
        pendingSelection.durationQ,
        bpm,
      );
      if (!sourceSpan) {
        setStatus(
          `Source layer ${sourceIndex + 1} has no clip near this selection yet.`,
        );
        return;
      }

      const clip = createWindowClip(pendingSelection, sourceTrack, sourceSpan);
      dispatchProject({
        type: "commit",
        label: "Create window",
        updater: (current) =>
          patchProjectState(current, {
            clips: [...current.clips, clip],
          }),
      });
      setPendingSelection(null);
      setSelectedClipId(clip.id);
      setStatus(
        `Committed a window on ${sourceTrack.name} with key ${sourceIndex + 1}.`,
      );
    },
    [bpm, createWindowClip, pendingSelection, sourceSpans, sourceTracks],
  );

  function getRandomizationTimelineEndQ() {
    return getTimelineContentEndQ(
      clips,
      sourceSpans,
      masterAudio?.durationSeconds,
      bpm,
      barLength,
    );
  }

  function buildRandomizedArrangementClips() {
    const timelineEndQ = getRandomizationTimelineEndQ();
    const stepQ = barLength * RANDOM_SELECTION_BAR_INCREMENT;
    const durationSteps = Array.from(
      {
        length: Math.round(
          RANDOM_SELECTION_MAX_BARS / RANDOM_SELECTION_BAR_INCREMENT,
        ),
      },
      (_, index) => (index + 1) * stepQ,
    );
    const nextAvailableByLane = new Map(lanes.map((lane) => [lane.id, 0]));
    const randomizedClips: ArrangementClip[] = [];
    const epsilon = 0.0001;
    const stepCount = Math.max(1, Math.ceil(timelineEndQ / stepQ));

    for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
      const startQ = stepIndex * stepQ;
      if (startQ >= timelineEndQ - epsilon) {
        break;
      }

      for (const [laneIndex, lane] of lanes.entries()) {
        const nextAvailableQ = nextAvailableByLane.get(lane.id) ?? 0;
        if (startQ < nextAvailableQ - epsilon) {
          continue;
        }

        const layerChance = laneIndex === 0 ? 1 : 0.5 ** laneIndex;
        if (randomFloat() > layerChance) {
          continue;
        }

        const validDurations = durationSteps.filter(
          (durationQ) => startQ + durationQ <= timelineEndQ + epsilon,
        );
        if (!validDurations.length) {
          continue;
        }

        const durationQ = pickRandom(validDurations) ?? validDurations[0];
        const selection: TimelineSelection = {
          id: `selection-random-${lane.id}-${stepIndex}`,
          laneId: lane.id,
          startQ,
          durationQ,
        };
        const candidateSources = sourceTracks
          .map((sourceTrack) => ({
            sourceTrack,
            sourceSpan: chooseSourceSpanForWindow(
              sourceSpans,
              sourceTrack.id,
              startQ,
              durationQ,
              bpm,
            ),
          }))
          .filter(
            (
              candidate,
            ): candidate is {
              sourceTrack: SourceTrack;
              sourceSpan: SourceSpan;
            } => Boolean(candidate.sourceSpan),
          );

        if (!candidateSources.length) {
          continue;
        }

        const pickedSource =
          pickRandom(candidateSources) ?? candidateSources[0];
        randomizedClips.push(
          createWindowClip(
            selection,
            pickedSource.sourceTrack,
            pickedSource.sourceSpan,
          ),
        );
        nextAvailableByLane.set(lane.id, startQ + durationQ);
      }
    }

    return randomizedClips.map((clip, index) => ({
      ...clip,
      selected: index === 0,
    }));
  }

  function handleRandomizeTimeline() {
    if (!sourceTracks.length || !sourceSpans.length) {
      setStatus(
        "Open a session or import source media before randomizing the arrangement.",
      );
      return;
    }

    const randomizedClips = buildRandomizedArrangementClips();
    if (!randomizedClips.length) {
      setStatus(
        "No randomized windows could be generated from the current source timeline.",
      );
      return;
    }

    setIsPlaying(false);
    setPendingSelection(null);
    setDragPreviewClips(null);
    commitProjectChange("Randomize arrangement", (current) =>
      patchProjectState(current, {
        clips: randomizedClips,
      }),
    );
    setSelectedClipId(randomizedClips[0]?.id);
    setPlayheadQ(0);
    playbackOriginRef.current = 0;
    setStatus(
      `Rebuilt the arrangement with ${randomizedClips.length} randomized windows on a quarter-bar grid.`,
    );
  }

  function updateExportState(
    phase: ExportState["phase"],
    detail: string,
    progress: number | null = null,
  ) {
    setExportState({
      phase,
      detail,
      progress,
    });
    setStatus(detail);
  }

  const stopTimelineAudibleScrub = useCallback(() => {
    if (timelineScrubAudioTimeoutRef.current !== null) {
      window.clearTimeout(timelineScrubAudioTimeoutRef.current);
      timelineScrubAudioTimeoutRef.current = null;
    }

    setIsTimelineAudibleScrubbing(false);
  }, []);

  const pulseTimelineAudibleScrub = useCallback(
    (durationMs: number = TIMELINE_SCRUB_AUDIO_TAIL_MS) => {
      if (timelineScrubAudioTimeoutRef.current !== null) {
        window.clearTimeout(timelineScrubAudioTimeoutRef.current);
      }

      setIsTimelineAudibleScrubbing(true);
      timelineScrubAudioTimeoutRef.current = window.setTimeout(() => {
        timelineScrubAudioTimeoutRef.current = null;
        setIsTimelineAudibleScrubbing(false);
      }, durationMs);
    },
    [],
  );

  const handleUndo = useCallback(() => {
    if (!undoLabel || isExporting) {
      return;
    }

    stopTimelineAudibleScrub();
    setIsPlaying(false);
    setDragPreviewClips(null);
    setDragState(null);
    setPendingSelection(null);
    setTimelineDragState(null);
    dispatchProject({ type: "undo" });
    setStatus(formatHistoryStatus("Undid", undoLabel));
  }, [isExporting, stopTimelineAudibleScrub, undoLabel]);

  const handleRedo = useCallback(() => {
    if (!redoLabel || isExporting) {
      return;
    }

    stopTimelineAudibleScrub();
    setIsPlaying(false);
    setDragPreviewClips(null);
    setDragState(null);
    setPendingSelection(null);
    setTimelineDragState(null);
    dispatchProject({ type: "redo" });
    setStatus(formatHistoryStatus("Redid", redoLabel));
  }, [isExporting, redoLabel, stopTimelineAudibleScrub]);

  useEffect(() => {
    projectSnapshotRef.current = projectHistory.present;
  }, [projectHistory.present]);

  useEffect(() => {
    playheadQRef.current = playheadQ;
  }, [playheadQ]);

  useEffect(() => {
    localMediaOverridesRef.current = localMediaOverrides;
  }, [localMediaOverrides]);

  useEffect(
    () => () => {
      for (const url of mediaObjectUrlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
      mediaObjectUrlsRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    const activeIds = new Set(projectMediaItems.map((item) => item.id));
    setLocalMediaOverrides((current) => {
      let changed = false;
      const next: Record<string, LocalMediaOverride> = {};
      for (const [mediaId, override] of Object.entries(current)) {
        if (!activeIds.has(mediaId)) {
          const previewUrl = mediaObjectUrlsRef.current.get(mediaId);
          if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
            mediaObjectUrlsRef.current.delete(mediaId);
          }
          changed = true;
          continue;
        }

        next[mediaId] = override;
      }

      return changed ? next : current;
    });
  }, [projectMediaItems]);

  const reportSessionMediaCheck = useCallback(() => {
    const check = sessionMediaCheckRef.current;
    if (!check || check.pendingIds.size || check.analyzingFromDisk) {
      return;
    }

    sessionMediaCheckRef.current = null;
    setStatus(formatSessionMediaCheckStatus(check));
  }, []);

  const settleSessionMediaCheck = useCallback(
    (mediaId: string, outcome: "restored" | "offline") => {
      const check = sessionMediaCheckRef.current;
      if (!check?.pendingIds.delete(mediaId)) {
        return;
      }

      if (outcome === "restored") {
        check.restored += 1;
      } else {
        check.offline += 1;
      }
      reportSessionMediaCheck();
    },
    [reportSessionMediaCheck],
  );

  useEffect(() => {
    let cancelled = false;

    for (const item of projectMediaItems) {
      const override = localMediaOverridesRef.current[item.id];
      const effectivePreviewUrl = override?.previewUrl ?? item.previewUrl;
      const effectiveAvailability = override?.availability ?? item.availability;
      if (effectivePreviewUrl || effectiveAvailability === "ready") {
        continue;
      }

      if (mediaHydrationInFlightRef.current.has(item.id)) {
        continue;
      }

      mediaHydrationInFlightRef.current.add(item.id);
      setLocalMediaOverride(item.id, {
        availability: item.sourcePath ? "hydrating" : "offline",
      });

      void (async () => {
        let restored = false;
        try {
          const cachedBlob = await getCachedMediaBlob(item.id);
          if (cachedBlob) {
            if (cancelled) {
              return;
            }

            await adoptMediaBlob(item.id, cachedBlob);
            restored = true;
            return;
          }

          if (!item.sourcePath && !item.previewUrl) {
            if (!cancelled) {
              setLocalMediaOverride(item.id, { availability: "offline" });
            }
            return;
          }

          const blob = await getHarness().readMediaBlob(item);
          if (cancelled) {
            // Keep the bytes so the next hydration pass is a cache hit.
            await cacheMediaBlob(item.id, blob);
            return;
          }

          await adoptMediaBlob(item.id, blob);
          restored = true;
        } catch (error) {
          logClient("media:hydrate:error", {
            mediaId: item.id,
            message: error instanceof Error ? error.message : String(error),
          });
          if (!cancelled) {
            setLocalMediaOverride(item.id, { availability: "offline" });
          }
        } finally {
          mediaHydrationInFlightRef.current.delete(item.id);
          setMediaHydrationTick((tick) => tick + 1);
          settleSessionMediaCheck(item.id, restored ? "restored" : "offline");
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [
    adoptMediaBlob,
    projectMediaItems,
    setLocalMediaOverride,
    settleSessionMediaCheck,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(
        COLLAB_STORAGE_KEY,
        JSON.stringify({
          signaling: collaborationSignaling,
          name: collaborationName,
          color: collaborationColor,
        }),
      );
    } catch (error) {
      logClient("collaboration:storage:write:error", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [collaborationColor, collaborationName, collaborationSignaling]);

  const applyRemoteProjectState = useCallback(
    (snapshot: ProjectState) => {
      if (
        JSON.stringify(projectSnapshotRef.current) === JSON.stringify(snapshot)
      ) {
        return;
      }

      setIsPlaying(false);
      stopTimelineAudibleScrub();
      setDragPreviewClips(null);
      setDragState(null);
      setPendingSelection(null);
      setTimelineDragState(null);
      dispatchProject({ type: "replace", snapshot });
    },
    [stopTimelineAudibleScrub],
  );

  const resolvePeerMedia = useCallback(async (mediaId: string) => {
    try {
      const cachedBlob = await getCachedMediaBlob(mediaId);
      if (cachedBlob) {
        return cachedBlob;
      }
    } catch (error) {
      logClient("media:peer:serve:cache:error", {
        mediaId,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const previewUrl = localMediaOverridesRef.current[mediaId]?.previewUrl;
    if (!previewUrl) {
      return null;
    }

    const item = projectSnapshotRef.current.mediaItems.find(
      (candidate) => candidate.id === mediaId,
    );
    return getHarness().readMediaBlob({
      id: mediaId,
      name: item?.name ?? mediaId,
      previewUrl,
      sourcePath: item?.sourcePath,
    });
  }, []);

  const abortPeerMediaTransfers = useCallback(() => {
    for (const transfer of peerMediaTransfersRef.current.values()) {
      transfer.abort();
    }
  }, []);

  useEffect(() => {
    if (collaborationMode === "idle") {
      abortPeerMediaTransfers();
      collaborationControllerRef.current?.destroy();
      collaborationControllerRef.current = null;
      return;
    }

    const roomName = collaborationRoom.trim();
    if (!roomName) {
      abortPeerMediaTransfers();
      collaborationControllerRef.current?.destroy();
      collaborationControllerRef.current = null;
      return;
    }

    const controller = createCollaborationController<ProjectState>({
      roomName,
      password: collaborationPassword.trim(),
      signalingUrls: parseSignalingUrls(collaborationSignaling),
      initialState: INITIAL_PROJECT_STATE,
      bootstrapState: projectSnapshotRef.current,
      user: {
        name: collaborationName.trim() || initialCollaborationConfig.name,
        color: collaborationColor,
      },
      onRemoteState: applyRemoteProjectState,
      onConnectionState: setCollaborationState,
      resolveMedia: resolvePeerMedia,
    });

    collaborationControllerRef.current = controller;

    return () => {
      if (collaborationControllerRef.current === controller) {
        collaborationControllerRef.current = null;
      }
      abortPeerMediaTransfers();
      controller.destroy();
    };
  }, [
    abortPeerMediaTransfers,
    applyRemoteProjectState,
    collaborationColor,
    collaborationName,
    collaborationPassword,
    collaborationRoom,
    collaborationSignaling,
    initialCollaborationConfig.name,
    collaborationMode,
    resolvePeerMedia,
  ]);

  const { mediaPeerCount } = collaborationState;
  useEffect(() => {
    // mediaHydrationTick reruns this whenever a local or peer hydration
    // settles, so media skipped while it was in flight is picked up.
    void mediaHydrationTick;
    const controller = collaborationControllerRef.current;
    if (collaborationMode === "idle" || !controller || mediaPeerCount === 0) {
      return;
    }

    const misses = peerMediaMissesRef.current;
    if (
      misses.controller !== controller ||
      misses.mediaPeerCount !== mediaPeerCount
    ) {
      // A peer joined or left, so previously missing media may now be found.
      misses.controller = controller;
      misses.mediaPeerCount = mediaPeerCount;
      misses.ids.clear();
    }

    const transfers = peerMediaTransfersRef.current;
    const offlineIds = JSON.parse(offlineClipMediaIdsKey) as string[];
    for (const mediaId of offlineIds) {
      if (transfers.size >= MAX_PEER_MEDIA_TRANSFERS) {
        break;
      }
      if (
        misses.ids.has(mediaId) ||
        mediaHydrationInFlightRef.current.has(mediaId)
      ) {
        continue;
      }

      const name =
        projectSnapshotRef.current.mediaItems.find(
          (item) => item.id === mediaId,
        )?.name ?? mediaId;
      const abortController = new AbortController();
      const recordMiss = () => {
        // Only remember the miss if the peer set is unchanged since the request.
        if (
          misses.controller === controller &&
          misses.mediaPeerCount === mediaPeerCount
        ) {
          misses.ids.add(mediaId);
        }
      };
      transfers.set(mediaId, abortController);
      mediaHydrationInFlightRef.current.add(mediaId);
      setLocalMediaOverride(mediaId, { availability: "hydrating" });

      void (async () => {
        let receiving = false;
        try {
          const blob = await controller.requestMedia(mediaId, {
            signal: abortController.signal,
            onProgress(received, total) {
              receiving = true;
              const now = performance.now();
              if (
                now - peerMediaStatusAtRef.current <
                PEER_MEDIA_STATUS_INTERVAL_MS
              ) {
                return;
              }
              peerMediaStatusAtRef.current = now;
              const percent =
                total > 0 ? Math.floor((received / total) * 100) : 0;
              setStatus(`Receiving ${name} from peer... ${percent}%`);
            },
          });
          if (!blob) {
            recordMiss();
            setLocalMediaOverride(mediaId, { availability: "offline" });
            if (receiving && !abortController.signal.aborted) {
              setStatus(`Receiving ${name} from peer was interrupted.`);
            }
            return;
          }

          await adoptMediaBlob(mediaId, blob);
          setStatus(`Received ${name} from peer.`);
        } catch (error) {
          if (!abortController.signal.aborted) {
            const message =
              error instanceof Error ? error.message : String(error);
            logClient("media:peer:request:error", { mediaId, message });
            setStatus(`Failed to receive ${name} from peer: ${message}`);
            recordMiss();
          }
          setLocalMediaOverride(mediaId, { availability: "offline" });
        } finally {
          transfers.delete(mediaId);
          mediaHydrationInFlightRef.current.delete(mediaId);
          setMediaHydrationTick((tick) => tick + 1);
        }
      })();
    }
  }, [
    adoptMediaBlob,
    collaborationMode,
    mediaPeerCount,
    offlineClipMediaIdsKey,
    mediaHydrationTick,
    setLocalMediaOverride,
  ]);

  useEffect(() => {
    collaborationControllerRef.current?.updateUser({
      name: collaborationName.trim() || initialCollaborationConfig.name,
      color: collaborationColor,
    });
  }, [collaborationColor, collaborationName, initialCollaborationConfig.name]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const pushCursor = (cursor: { x: number; y: number } | null) => {
      const nextKey = cursor
        ? `${cursor.x.toFixed(3)}:${cursor.y.toFixed(3)}`
        : "";
      if (lastCollaborationCursorRef.current === nextKey) {
        return;
      }

      lastCollaborationCursorRef.current = nextKey;
      collaborationControllerRef.current?.updateCursor(cursor);
    };

    if (collaborationMode === "idle") {
      pushCursor(null);
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const appShell = appShellRef.current;
      if (!appShell) {
        return;
      }

      const bounds = appShell.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) {
        pushCursor(null);
        return;
      }

      const insideBounds =
        event.clientX >= bounds.left &&
        event.clientX <= bounds.right &&
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom;

      if (!insideBounds) {
        pushCursor(null);
        return;
      }

      pushCursor({
        x: (event.clientX - bounds.left) / bounds.width,
        y: (event.clientY - bounds.top) / bounds.height,
      });
    };

    const clearCursor = () => {
      pushCursor(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("blur", clearCursor);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("blur", clearCursor);
      clearCursor();
    };
  }, [collaborationMode]);

  useEffect(() => {
    collaborationControllerRef.current?.pushState(projectHistory.present);
  }, [projectHistory.present]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!pendingSelection) {
        return;
      }

      if (isEditableEventTarget(event.target)) {
        return;
      }

      if (event.key === "Escape") {
        setPendingSelection(null);
        return;
      }

      const sourceIndex = Number.parseInt(event.key, 10) - 1;
      if (!Number.isInteger(sourceIndex) || sourceIndex < 0) {
        return;
      }

      event.preventDefault();
      commitPendingSelectionToSourceTrack(sourceIndex);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commitPendingSelectionToSourceTrack, pendingSelection]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableEventTarget(event.target)) {
        return;
      }

      if (!event.metaKey && !event.ctrlKey) {
        return;
      }

      const key = event.key.toLowerCase();
      const shouldRedo = key === "y" || (key === "z" && event.shiftKey);
      if (shouldRedo) {
        event.preventDefault();
        handleRedo();
        return;
      }

      if (key !== "z") {
        return;
      }

      event.preventDefault();
      handleUndo();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleRedo, handleUndo]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        isEditableEventTarget(event.target) ||
        dragState ||
        timelineDragState
      ) {
        return;
      }

      const hasPrimaryModifier = event.metaKey || event.ctrlKey;
      const hasSystemModifier = hasPrimaryModifier || event.altKey;
      const key = event.key.toLowerCase();
      if (hasPrimaryModifier && key === "c") {
        if (!selectedClip || isExporting) {
          return;
        }

        event.preventDefault();
        clipClipboardRef.current = { ...selectedClip };
        setStatus(`Copied ${selectedClip.label}.`);
        return;
      }

      if (hasPrimaryModifier && key === "x") {
        if (!selectedClip || isExporting) {
          return;
        }

        event.preventDefault();
        clipClipboardRef.current = { ...selectedClip };
        const nextSelectedClipId =
          timelineClips.find(
            (clip) =>
              clip.id !== selectedClip.id &&
              clip.laneId === selectedClip.laneId,
          )?.id ??
          timelineClips.find((clip) => clip.id !== selectedClip.id)?.id;

        dispatchProject({
          type: "commit",
          label: "Cut clip",
          updater: (current) =>
            patchProjectState(current, {
              clips: current.clips.filter(
                (clip) => clip.id !== selectedClip.id,
              ),
            }),
        });
        setSelectedClipId(nextSelectedClipId);
        setPendingSelection(null);
        setStatus(`Cut ${selectedClip.label}.`);
        return;
      }

      if (hasPrimaryModifier && key === "v") {
        const clipboardClip = clipClipboardRef.current;
        if (!clipboardClip || isExporting) {
          return;
        }

        event.preventDefault();
        const pastedClipId = `window-${crypto.randomUUID()}`;
        dispatchProject({
          type: "commit",
          label: "Paste clip",
          updater: (current) => {
            const pastedClip = cloneClipAtStartQ(
              clipboardClip,
              current.bpm,
              playheadQ,
              pastedClipId,
            );
            return patchProjectState(current, {
              clips: resolveClipOverlaps(
                [...current.clips, pastedClip],
                pastedClip,
                current.bpm,
              ),
            });
          },
        });
        setSelectedClipId(pastedClipId);
        setPendingSelection(null);
        setStatus(`Pasted ${clipboardClip.label}.`);
        return;
      }

      if (hasPrimaryModifier && key === "e") {
        if (!selectedClip || isExporting) {
          return;
        }

        event.preventDefault();
        const clipEndQ = getClipEndQ(selectedClip, bpm);
        const epsilon = 0.0001;
        if (
          playheadQ <= selectedClip.startQ + epsilon ||
          playheadQ >= clipEndQ - epsilon
        ) {
          setStatus(
            `Move the playhead inside ${selectedClip.label} to split it.`,
          );
          return;
        }

        const splitClipId = `window-${crypto.randomUUID()}`;
        dispatchProject({
          type: "commit",
          label: "Split clip",
          updater: (current) => {
            const sourceClip = current.clips.find(
              (clip) => clip.id === selectedClip.id,
            );
            if (!sourceClip) {
              return current;
            }

            const sourceClipEndQ = getClipEndQ(sourceClip, current.bpm);
            const leftDurationQ = playheadQ - sourceClip.startQ;
            const rightDurationQ = sourceClipEndQ - playheadQ;
            if (leftDurationQ <= epsilon || rightDurationQ <= epsilon) {
              return current;
            }

            const leftClip = withWindowTiming(
              {
                ...sourceClip,
                selected: false,
              },
              sourceClip.startQ,
              leftDurationQ,
              current.bpm,
            );
            const rightClip = withWindowTiming(
              {
                ...sourceClip,
                id: splitClipId,
                selected: true,
              },
              playheadQ,
              rightDurationQ,
              current.bpm,
            );

            return patchProjectState(current, {
              clips: current.clips.flatMap((clip) =>
                clip.id === sourceClip.id ? [leftClip, rightClip] : [clip],
              ),
            });
          },
        });
        setSelectedClipId(splitClipId);
        setPendingSelection(null);
        setStatus(`Split ${selectedClip.label} at the playhead.`);
        return;
      }

      if (hasPrimaryModifier && key === "d") {
        if (!selectedClip || isExporting) {
          return;
        }

        event.preventDefault();
        const duplicatedClipId = `window-${crypto.randomUUID()}`;
        dispatchProject({
          type: "commit",
          label: "Duplicate clip",
          updater: (current) => {
            const sourceClip = current.clips.find(
              (clip) => clip.id === selectedClip.id,
            );
            if (!sourceClip) {
              return current;
            }

            const duplicatedClip = duplicateClip(
              sourceClip,
              current.bpm,
              duplicatedClipId,
            );
            return patchProjectState(current, {
              clips: resolveClipOverlaps(
                [...current.clips, duplicatedClip],
                duplicatedClip,
                current.bpm,
              ),
            });
          },
        });
        setSelectedClipId(duplicatedClipId);
        setPendingSelection(null);
        setStatus(`Duplicated ${selectedClip.label}.`);
        return;
      }

      if (hasSystemModifier) {
        return;
      }

      if (event.code === "Space") {
        // Toggle buttons such as a layer's FX badge keep their native Space
        // activation instead of starting playback.
        if (
          event.target instanceof Element &&
          event.target.closest("[data-space-activates]")
        ) {
          return;
        }

        if (event.repeat) {
          return;
        }

        event.preventDefault();
        if (!clips.length) {
          return;
        }

        cancelScrubPlaybackResume();
        if (isPlaying) {
          setIsPlaying(false);
          return;
        }

        startPlayback();
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        const deltaQ = secondsToQuarters(
          (direction * (event.shiftKey ? 5 : 1)) / fps,
          bpm,
        );
        const nextPlayheadQ = clamp(playheadQ + deltaQ, 0, totalQuarters);
        setPlayheadQ(nextPlayheadQ);
        playbackOriginRef.current = nextPlayheadQ;
        return;
      }

      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        const lastFrameQ = Math.max(
          0,
          timelineContentEndQ - secondsToQuarters(1 / fps, bpm),
        );
        const nextPlayheadQ = event.key === "Home" ? 0 : lastFrameQ;
        setPlayheadQ(nextPlayheadQ);
        playbackOriginRef.current = nextPlayheadQ;
        return;
      }

      if (
        (event.key === "ArrowUp" || event.key === "ArrowDown") &&
        !hasSystemModifier
      ) {
        // Only while the timeline (or nothing) has focus and no clip is
        // selected, so other panels keep their own arrow keys.
        const timelineScroll = timelineScrollRef.current;
        const activeElement = document.activeElement;
        if (
          explicitClip ||
          (activeElement &&
            activeElement !== document.body &&
            !timelineScroll?.contains(activeElement))
        ) {
          return;
        }

        const nextLaneId = stepSelectedLaneId(
          lanes,
          fxLaneId,
          event.key === "ArrowUp" ? -1 : 1,
        );
        if (!nextLaneId) {
          return;
        }

        event.preventDefault();
        setSelectedLaneId(nextLaneId);
        if (activeElement?.hasAttribute("data-lane-label-id")) {
          timelineScroll
            ?.querySelector<HTMLElement>(
              `[data-lane-label-id="${CSS.escape(nextLaneId)}"]`,
            )
            ?.focus();
        }
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (!selectedClip || isExporting) {
          return;
        }

        event.preventDefault();
        const nextSelectedClipId =
          timelineClips.find(
            (clip) =>
              clip.id !== selectedClip.id &&
              clip.laneId === selectedClip.laneId,
          )?.id ??
          timelineClips.find((clip) => clip.id !== selectedClip.id)?.id;

        dispatchProject({
          type: "commit",
          label: "Delete clip",
          updater: (current) =>
            patchProjectState(current, {
              clips: current.clips.filter(
                (clip) => clip.id !== selectedClip.id,
              ),
            }),
        });
        setSelectedClipId(nextSelectedClipId);
        setPendingSelection(null);
        setStatus(`Deleted ${selectedClip.label}.`);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    bpm,
    cancelScrubPlaybackResume,
    clips.length,
    dragState,
    explicitClip,
    fps,
    fxLaneId,
    isExporting,
    isPlaying,
    lanes,
    playheadQ,
    selectedClip,
    startPlayback,
    timelineClips,
    timelineContentEndQ,
    timelineDragState,
    totalQuarters,
  ]);

  useEffect(
    () => () => {
      stopTimelineAudibleScrub();
    },
    [stopTimelineAudibleScrub],
  );

  useEffect(() => {
    syncTimelineViewport();

    const handleResize = () => syncTimelineViewport();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [syncTimelineViewport]);

  useEffect(() => {
    if (!dragState) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return;
      }

      const shouldSnap = snapEnabled && !event.shiftKey;

      if (dragState.kind === "selection") {
        const timelineScroll = timelineScrollRef.current;
        if (!timelineScroll) {
          return;
        }

        const timelineBounds = timelineScroll.getBoundingClientRect();
        const pointerX = event.clientX - timelineBounds.left;
        const nextQ = snapQuarterValue(
          clamp(
            (timelineScroll.scrollLeft - labelWidth + pointerX) / quarterPx,
            0,
            totalQuarters,
          ),
          snapUnit,
          shouldSnap,
        );
        setPendingSelection({
          id: `selection-${dragState.laneId}`,
          laneId: dragState.laneId,
          ...buildSelection(dragState.anchorQ, nextQ, minimumWindowQ),
        });
        return;
      }

      const deltaQuarters =
        (event.clientX - dragState.pointerStartX) / quarterPx;

      if (dragState.kind === "move") {
        const nextStartQ = clamp(
          snapQuarterValue(
            dragState.originStartQ + deltaQuarters,
            snapUnit,
            shouldSnap,
          ),
          0,
          Math.max(0, totalQuarters - dragState.originDurationQ - beatUnit),
        );
        const timelineScroll = timelineScrollRef.current;
        const nextLaneId = timelineScroll
          ? findClosestTimelineLaneId(
              timelineScroll,
              event.clientY,
              dragState.originLaneId,
            )
          : dragState.originLaneId;

        if (dragState.duplicateOnDrag) {
          if (
            nextLaneId === dragState.originLaneId &&
            Math.abs(nextStartQ - dragState.originStartQ) <=
              TIMELINE_DRAG_EPSILON
          ) {
            setDragPreviewClips(null);
            return;
          }

          const sourceClip = clips.find(
            (clip) => clip.id === dragState.sourceClipId,
          );
          if (!sourceClip) {
            return;
          }

          setDragPreviewClips(
            resolveClipOverlapPreview(
              [
                ...clips,
                cloneClipAtStartQ(
                  sourceClip,
                  bpm,
                  dragState.originStartQ,
                  dragState.clipId,
                ),
              ],
              dragState.clipId,
              nextStartQ,
              dragState.originDurationQ,
              bpm,
              nextLaneId,
            ),
          );
          return;
        }

        setDragPreviewClips(
          resolveClipOverlapPreview(
            clips,
            dragState.clipId,
            nextStartQ,
            dragState.originDurationQ,
            bpm,
            nextLaneId,
          ),
        );
        return;
      }

      if (dragState.kind === "resize-start") {
        const fixedEndQ = dragState.originStartQ + dragState.originDurationQ;
        const nextStartQ = clamp(
          snapQuarterValue(
            dragState.originStartQ + deltaQuarters,
            snapUnit,
            shouldSnap,
          ),
          0,
          fixedEndQ - minimumWindowQ,
        );
        const nextDurationQ = Math.max(minimumWindowQ, fixedEndQ - nextStartQ);

        setDragPreviewClips(
          resolveClipOverlapPreview(
            clips,
            dragState.clipId,
            nextStartQ,
            nextDurationQ,
            bpm,
          ),
        );
        return;
      }

      const rawEndQ =
        dragState.originStartQ + dragState.originDurationQ + deltaQuarters;
      const nextEndQ = snapQuarterValue(rawEndQ, snapUnit, shouldSnap);
      const nextDurationQ = Math.max(
        minimumWindowQ,
        nextEndQ - dragState.originStartQ,
      );

      setDragPreviewClips(
        resolveClipOverlapPreview(
          clips,
          dragState.clipId,
          dragState.originStartQ,
          nextDurationQ,
          bpm,
        ),
      );
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return;
      }

      if (dragState.kind === "selection" && !pendingSelection) {
        setPendingSelection({
          id: `selection-${dragState.laneId}`,
          laneId: dragState.laneId,
          startQ: dragState.anchorQ,
          durationQ: minimumWindowQ,
        });
      }

      if (dragState.kind !== "selection" && dragPreviewClips) {
        const historyLabel =
          dragState.kind === "move"
            ? dragState.duplicateOnDrag
              ? "Duplicate clip"
              : "Move clip"
            : dragState.kind === "resize-start"
              ? "Trim clip start"
              : "Trim clip end";
        commitProjectChange(historyLabel, (current) =>
          patchProjectState(current, {
            clips: dragPreviewClips,
          }),
        );
      }

      if (
        dragState.kind === "move" &&
        dragState.duplicateOnDrag &&
        !dragPreviewClips
      ) {
        setSelectedClipId(dragState.sourceClipId);
      }

      setDragPreviewClips(null);
      setDragState(null);
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return;
      }

      if (
        dragState.kind === "move" &&
        dragState.duplicateOnDrag &&
        !dragPreviewClips
      ) {
        setSelectedClipId(dragState.sourceClipId);
      }

      setDragPreviewClips(null);
      setDragState(null);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [
    beatUnit,
    bpm,
    clips,
    commitProjectChange,
    dragPreviewClips,
    dragState,
    minimumWindowQ,
    pendingSelection,
    snapEnabled,
    labelWidth,
    quarterPx,
    snapUnit,
    totalQuarters,
  ]);

  useEffect(() => {
    if (!timelineDragState) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== timelineDragState.pointerId) {
        return;
      }

      const timelineScroll = timelineScrollRef.current;
      if (!timelineScroll) {
        return;
      }

      const rawVerticalDelta = timelineDragState.pointerStartY - event.clientY;
      const zoomDelta =
        Math.abs(rawVerticalDelta) <= TIMELINE_DRAG_ZOOM_THRESHOLD_PX
          ? 0
          : Math.sign(rawVerticalDelta) *
            (Math.abs(rawVerticalDelta) - TIMELINE_DRAG_ZOOM_THRESHOLD_PX);
      const nextZoom = clamp(
        timelineDragState.originZoom + zoomDelta * TIMELINE_DRAG_ZOOM_SPEED,
        ZOOM_MIN,
        ZOOM_MAX,
      );
      const nextQuarterPx = BASE_QUARTER_PX * nextZoom;
      const deltaX = event.clientX - timelineDragState.pointerStartX;
      const nextPlayheadQ = clamp(
        timelineDragState.originPlayheadQ + deltaX / nextQuarterPx,
        0,
        totalQuarters,
      );
      const timelineBounds = timelineScroll.getBoundingClientRect();
      const pointerX = clamp(
        event.clientX - timelineBounds.left,
        0,
        timelineScroll.clientWidth,
      );
      const maxScrollLeft = Math.max(
        0,
        labelWidth + totalQuarters * nextQuarterPx - timelineScroll.clientWidth,
      );

      timelineScroll.scrollLeft = clamp(
        labelWidth + nextPlayheadQ * nextQuarterPx - pointerX,
        0,
        maxScrollLeft,
      );
      pulseTimelineAudibleScrub(
        timelineDragState.wasPlaying
          ? TIMELINE_PLAYBACK_SCRUB_AUDIO_IDLE_MS
          : TIMELINE_SCRUB_AUDIO_TAIL_MS,
      );
      updateZoomDraft(nextZoom);
      setPlayheadQ(nextPlayheadQ);
      playbackOriginRef.current = nextPlayheadQ;
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== timelineDragState.pointerId) {
        return;
      }

      stopTimelineAudibleScrub();
      flushZoomDraft();
      setTimelineDragState(null);
      if (event.type === "pointerup" && timelineDragState.wasPlaying) {
        // Batched with stopTimelineAudibleScrub so the player hands the audible
        // scrub straight over to playback without pausing the media.
        startPlayback(playbackOriginRef.current);
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [
    flushZoomDraft,
    labelWidth,
    pulseTimelineAudibleScrub,
    startPlayback,
    stopTimelineAudibleScrub,
    timelineDragState,
    totalQuarters,
    updateZoomDraft,
  ]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    let animationFrame = 0;
    const startedAt = performance.now();
    const originQ = playbackOriginRef.current;
    const stopQ = playbackStopRef.current || totalQuarters;

    const step = (timestamp: number) => {
      const elapsed = (timestamp - startedAt) / 1000;
      const nextQ = originQ + secondsToQuarters(elapsed, bpm);

      if (nextQ >= stopQ) {
        setPlayheadQ(stopQ);
        playbackOriginRef.current = stopQ;
        setIsPlaying(false);
        return;
      }

      setPlayheadQ(nextQ);
      animationFrame = window.requestAnimationFrame(step);
    };

    animationFrame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [bpm, isPlaying, totalQuarters]);

  async function applyOpenedSessionPayload(payload: SessionOpenResponse) {
    const existingRefs = payload.mediaRefs.filter((ref) => ref.exists);
    const missingRefs = payload.mediaRefs.filter((ref) => !ref.exists);
    const placeholderMedia = payload.mediaRefs.map((ref, index) =>
      buildFallbackMediaItem(
        ref,
        PALETTE[index % PALETTE.length] ?? PALETTE[0],
      ),
    );
    logClient("openSession:mediaRefs", {
      total: payload.mediaRefs.length,
      existing: existingRefs.length,
      missing: missingRefs.length,
    });

    const project = sessionToProject(payload.session, placeholderMedia);
    logClient("openSession:project", {
      clips: project.arrangementClips.length,
      lanes: project.lanes.length,
      sourceTracks: project.sourceTracks.length,
    });

    commitProjectChange("Open session", (current) =>
      patchProjectState(current, {
        sessionName: payload.sessionName,
        mediaItems: placeholderMedia.map((item) => toShareableMediaItem(item)),
        bpm: project.bpm,
        fps: project.fps,
        canvasWidth: project.canvasWidth,
        canvasHeight: project.canvasHeight,
        timelineMode: project.displaySeconds ? "timecode" : "musical",
        snapMode: project.snapToBeat ? "beat" : "quarter",
        snapEnabled: project.snapToBeat,
        zoom: project.zoom,
        lanes: project.lanes.length ? project.lanes : DEFAULT_LANES,
        sourceTracks: project.sourceTracks,
        sourceSpans: project.sourceSpans,
        clips: project.arrangementClips,
        effects: project.effects,
        masterAudioId: project.masterAudioMediaId,
      }),
    );
    setDragPreviewClips(null);
    setPendingSelection(null);
    setImportNotice(
      payload.alsImport
        ? {
            tone: payload.alsImport.noLayersVideo ? "warning" : "summary",
            title: `Imported ${payload.sessionName}`,
            lines: formatAlsImportSummary(
              payload.alsImport,
              payload.sessionName,
            ),
          }
        : null,
    );

    const preferredClip =
      project.arrangementClips.find((clip) => clip.selected) ??
      project.arrangementClips[0];
    setSelectedClipId(preferredClip?.id);
    setSelectedLaneId(
      preferredClip?.laneId ??
        getDefaultLaneId(
          project.lanes.length ? project.lanes : DEFAULT_LANES,
          project.effects,
        ),
    );
    setPlayheadQ(
      secondsToQuarters(project.playPositionFrames / project.fps, project.bpm),
    );
    seedLocalMediaItems(
      existingRefs.map((ref, index) => ({
        ...buildFallbackMediaItem(
          ref,
          PALETTE[index % PALETTE.length] ?? PALETTE[0],
        ),
        previewUrl: ref.url,
        availability: "ready",
      })),
    );

    // Offline refs may still be restored from the media cache by the
    // hydration effect; report the outcome once every ref has settled.
    const pendingOfflineIds = missingRefs
      .map((ref) => ref.id)
      .filter((id) => !localMediaOverridesRef.current[id]?.previewUrl);
    const mediaCheck: SessionMediaCheck = {
      sessionName: payload.sessionName,
      pendingIds: new Set(pendingOfflineIds),
      restored: 0,
      offline: 0,
      analyzingFromDisk: existingRefs.length > 0,
      hydratedFromDisk: existingRefs.length > 0,
    };
    sessionMediaCheckRef.current = mediaCheck;

    if (existingRefs.length) {
      setStatus(
        `Loaded ${payload.sessionName}. Hydrating ${pluralize(existingRefs.length, "media file")} in the background.`,
      );
    } else if (pendingOfflineIds.length) {
      setStatus(
        `Loaded ${payload.sessionName}. Checking the media cache for ${pluralize(pendingOfflineIds.length, "offline media file")}...`,
      );
    } else {
      reportSessionMediaCheck();
    }

    if (existingRefs.length) {
      void (async () => {
        try {
          const analyzedMedia = await getHarness().analyzeMedia(
            {
              kind: "refs",
              refs: existingRefs,
            },
            PALETTE,
            0,
          );
          logClient("openSession:analyzedMedia", {
            analyzed: analyzedMedia.length,
            degraded: 0,
          });
          seedLocalMediaItems(analyzedMedia);
          void cacheLocalMediaItems(analyzedMedia);
          commitProjectChange("Hydrate session media", (current) =>
            patchProjectState(current, {
              mediaItems: mergeMediaItemsById(
                current.mediaItems,
                analyzedMedia.map((item) => toShareableMediaItem(item)),
              ),
            }),
          );
          mediaCheck.analyzingFromDisk = false;
          reportSessionMediaCheck();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (sessionMediaCheckRef.current === mediaCheck) {
            sessionMediaCheckRef.current = null;
          }
          setStatus(`Session media hydration failed: ${message}`);
        }
      })();
    }
  }

  async function handleImport() {
    const harness = getHarness();
    const selection = await harness.pickMedia();
    if (!selection) {
      return;
    }

    try {
      const itemCount =
        selection.kind === "files"
          ? selection.files.length
          : selection.refs.length;
      setStatus(`Analyzing ${pluralize(itemCount, "imported media file")}...`);
      const nextPaletteIndex = mediaItems.length;
      const analyzed = await harness.analyzeMedia(
        selection,
        PALETTE,
        nextPaletteIndex,
      );
      const sharedAnalyzed = analyzed.map((item) => toShareableMediaItem(item));

      const nextMedia = [...projectMediaItems, ...sharedAnalyzed];
      if (!sessionName) {
        const standalone = buildStandaloneProject(nextMedia);
        commitProjectChange("Import media", (current) =>
          patchProjectState(current, {
            mediaItems: nextMedia,
            lanes: standalone.lanes,
            sourceTracks: standalone.sourceTracks,
            sourceSpans: standalone.sourceSpans,
            clips: standalone.arrangementClips,
            canvasWidth: standalone.canvasWidth,
            canvasHeight: standalone.canvasHeight,
          }),
        );
        setDragPreviewClips(null);
        setSelectedClipId(standalone.arrangementClips[0]?.id);
        setPendingSelection(null);
      } else {
        commitProjectChange("Import media", (current) =>
          patchProjectState(current, {
            mediaItems: nextMedia,
          }),
        );
      }

      seedLocalMediaItems(analyzed);
      void cacheLocalMediaItems(analyzed);
      setStatus(`Imported ${pluralize(analyzed.length, "media file")}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Media import failed: ${message}`);
    }
  }

  // Rows show a spinner from the moment a batch starts until their own file
  // has been verified and adopted, so progress is visible item by item.
  function createOfflineMediaRelinker() {
    return createMediaRelinker({
      offlineMedia,
      mediaItemsById,
      adoptMediaBlob: async (mediaId, blob, options) => {
        try {
          return await adoptMediaBlob(mediaId, blob, options);
        } finally {
          updateRelinkingMediaIds([mediaId], false);
        }
      },
      log: logClient,
    });
  }

  function updateRelinkingMediaIds(ids: string[], relinking: boolean) {
    setRelinkingMediaIds((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (relinking) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      return next;
    });
  }

  async function relinkOfflineMedia(candidates: MediaRelinkCandidate[]) {
    const { matches } = matchOfflineMedia(
      offlineMedia.map((entry) => entry.item),
      candidates,
    );
    const ids = matches.map(({ item }) => item.id);
    updateRelinkingMediaIds(ids, true);
    try {
      return await createOfflineMediaRelinker().relinkMedia(candidates);
    } finally {
      updateRelinkingMediaIds(ids, false);
    }
  }

  async function relinkOfflineMediaItem(
    itemId: string,
    candidate: MediaRelinkCandidate,
  ) {
    updateRelinkingMediaIds([itemId], true);
    try {
      return await createOfflineMediaRelinker().relinkMediaItem(
        itemId,
        candidate,
      );
    } finally {
      updateRelinkingMediaIds([itemId], false);
    }
  }

  // A failed Live set import is reported in the import notice, since the
  // status line alone is easy to miss.
  function reportOpenFailure(
    prefix: string,
    selectionName: string | undefined,
    error: unknown,
  ) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`${prefix}: ${message}`);
    if (
      error instanceof AlsImportError ||
      (selectionName && isAlsFilename(selectionName))
    ) {
      setImportNotice({
        tone: "error",
        title: `Could not open ${selectionName ?? "the Live set"}`,
        lines: [message],
      });
    }
  }

  async function handleOpenSession() {
    const harness = getHarness();
    let selectionName: string | undefined;
    try {
      const selection = await harness.pickSession();
      if (!selection) {
        return;
      }
      selectionName =
        selection.kind === "file"
          ? selection.file.name
          : selection.kind === "workspace"
            ? selection.sessionFile.name
            : selection.name;
      setStatus(`Opening ${selectionName}...`);
      const payload = await harness.openSession(selection);
      await applyOpenedSessionPayload(payload);
    } catch (error) {
      reportOpenFailure("Open failed", selectionName, error);
    }
  }

  async function handleOpenWorkspace() {
    const harness = getHarness();
    if (!harness.pickWorkspace) {
      setStatus(
        "Opening a workspace is not supported in this version of zvid.",
      );
      return;
    }

    let selectionName: string | undefined;
    try {
      const selection = await harness.pickWorkspace();
      if (!selection) {
        return;
      }

      selectionName =
        selection.kind === "workspace"
          ? selection.sessionFile.name
          : selection.kind === "file"
            ? selection.file.name
            : selection.name;
      setStatus(`Opening workspace ${selectionName}...`);
      const payload = await harness.openSession(selection);
      await applyOpenedSessionPayload(payload);
    } catch (error) {
      reportOpenFailure("Open workspace failed", selectionName, error);
    }
  }

  async function handleExport() {
    if (isExporting) {
      return;
    }

    if (!clips.length) {
      setStatus("Open a session or import media before exporting.");
      return;
    }

    const durationSeconds = Math.max(
      0.01,
      masterAudio?.durationSeconds ?? 0,
      ...clips.map(
        (clip) => quartersToSeconds(clip.startQ, bpm) + clip.durationSeconds,
      ),
    );
    const outputFrameRate = Math.max(1, fps);
    const outputFrameDuration = 1 / outputFrameRate;
    const outputFrameCount = Math.max(
      1,
      Math.ceil(durationSeconds * outputFrameRate),
    );
    const exportName = `${sanitizeFilenameSegment(sessionName ?? "zvid-session")}.mp4`;

    let saveTarget: SaveTarget;
    try {
      const nextSaveTarget = await getHarness().prepareSave(exportName, {
        mimeType: "video/mp4",
        extensions: [".mp4"],
        description: "MP4 video",
      });
      if (!nextSaveTarget) {
        setStatus("Export canceled before rendering.");
        return;
      }
      saveTarget = nextSaveTarget;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("Export canceled before rendering.");
        return;
      }

      setStatus(`Failed to prepare export destination: ${message}`);
      return;
    }

    setIsPlaying(false);
    setIsExporting(true);
    updateExportState(
      "preparing",
      `Preparing export (${pluralize(outputFrameCount, "frame")})...`,
      null,
    );
    logClient("export:start", {
      durationSeconds,
      frameRate: outputFrameRate,
      frames: outputFrameCount,
      canvasWidth,
      canvasHeight,
      masterAudio: masterAudio?.name,
    });
    logClient("export:phase", { phase: "preparing", frames: outputFrameCount });

    const exportRenderer = new CompositionRenderer(
      {
        mediaItems,
        clips: timelineClips,
        lanes,
        effects,
        bpm,
        canvasWidth,
        canvasHeight,
        masterAudio,
      },
      { audioAnalysis: "offline" },
    );

    try {
      const result = await getHarness().exportVideo({
        filename: exportName,
        saveTarget,
        canvas: exportRenderer.canvas,
        canvasWidth,
        canvasHeight,
        durationSeconds,
        frameRate: outputFrameRate,
        frameCount: outputFrameCount,
        frameDuration: outputFrameDuration,
        bpm,
        masterAudio,
        renderFrameAt: (frameQ, frameSeconds) =>
          exportRenderer.renderFrameAt(frameQ, frameSeconds),
        setPlayheadQ: () => {},
        onProgress: (update) => {
          updateExportState(update.phase, update.detail, update.progress);
        },
        onLog: logClient,
      });

      setStatus(
        result.saveMethod === "download"
          ? `Exported ${exportName} through the browser download flow.`
          : `Saved ${exportName}.`,
      );
      setExportState({ phase: "idle", progress: null, detail: "" });
      logClient("export:complete", {
        filename: exportName,
        bytes: result.bytes,
        mimeType: result.mimeType,
        muxedWith: result.muxedWith,
        saveMethod: result.saveMethod,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setExportState({ phase: "idle", progress: null, detail: "" });
      setStatus(`Export failed: ${message}`);
      logClient("export:error", { message });
    } finally {
      setIsExporting(false);
      setExportState({ phase: "idle", progress: null, detail: "" });
      exportRenderer.destroy();
      const previewPlayheadQ = playheadQRef.current;
      try {
        await compositionPlayerRef.current?.restorePreviewSurface(
          previewPlayheadQ,
          quartersToSeconds(previewPlayheadQ, bpm),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logClient("export:restorePreviewSurface:error", { message });
      }
    }
  }

  async function handleTransportToggle() {
    if (!clips.length) {
      return;
    }

    cancelScrubPlaybackResume();
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }

    startPlayback();
  }

  function jumpPlayhead(deltaBars: number) {
    const next = clamp(playheadQ + deltaBars * barLength, 0, totalQuarters);
    setPlayheadQ(next);
    playbackOriginRef.current = next;
  }

  function selectSource(sourceTrackId: string) {
    const match = clips.find((clip) => clip.sourceTrackId === sourceTrackId);
    if (match) {
      setSelectedClipId(match.id);
      if (!isPlaying) {
        setPlayheadQ(match.startQ);
        playbackOriginRef.current = match.startQ;
      }
    }
  }

  async function handleStartShare() {
    if (typeof window === "undefined" || isStartingShare) {
      return;
    }

    const roomName = collaborationView.pendingShareRoom;
    setIsStartingShare(true);
    setHasCopiedShareInvite(false);

    try {
      setCollaborationRoom(roomName);
      setCollaborationMode("sharing");

      const publicIpAddress = await detectPublicIpAddress();
      const shareUrl = buildPublicShareUrl(
        roomName,
        collaborationSignaling,
        collaborationPassword,
        publicIpAddress,
      );

      try {
        await navigator.clipboard.writeText(shareUrl);
        setLastCopiedShareUrl(shareUrl);
        setHasCopiedShareInvite(true);
        if (shareCopyResetTimeoutRef.current !== null) {
          window.clearTimeout(shareCopyResetTimeoutRef.current);
        }
        shareCopyResetTimeoutRef.current = window.setTimeout(() => {
          setHasCopiedShareInvite(false);
        }, 4500);
        setStatus(
          `Public sharing is live. Invite copied${publicIpAddress ? ` via ${publicIpAddress}` : ""}. Click Stop Share to disconnect.`,
        );
      } catch (error) {
        setStatus(
          `Public sharing is live, but copying the invite failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      setIsShareDialogOpen(false);
    } finally {
      setIsStartingShare(false);
    }
  }

  function handleStopShare() {
    collaborationControllerRef.current?.destroy();
    collaborationControllerRef.current = null;
    setCollaborationState({
      connected: false,
      peerCount: 0,
      mediaPeerCount: 0,
      collaborators: [],
    });
    setCollaborationMode("idle");
    setStatus("Public sharing stopped. Signaling socket disconnected.");
  }

  function handleDisconnectConnection() {
    collaborationControllerRef.current?.destroy();
    collaborationControllerRef.current = null;
    setCollaborationState({
      connected: false,
      peerCount: 0,
      mediaPeerCount: 0,
      collaborators: [],
    });
    setCollaborationMode("idle");
    setStatus("Disconnected from the shared collaboration session.");
  }

  async function handleConnectToShare() {
    if (isStartingConnect) {
      return;
    }

    setIsStartingConnect(true);
    try {
      const invite = parseCollaborationInvite(connectInviteValue);
      setCollaborationRoom(invite.room);
      setCollaborationSignaling(invite.signaling);
      setCollaborationPassword(invite.password);
      setCollaborationMode("connected");
      setIsConnectDialogOpen(false);
      setConnectInviteValue("");
      setStatus(`Connecting to collaboration room "${invite.room}".`);
    } catch (error) {
      setStatus(
        `Unable to connect with that invite: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsStartingConnect(false);
    }
  }

  function commitLabelWidth(width: number) {
    const nextWidth = clampLabelWidth(width);
    setLabelWidth(nextWidth);
    try {
      window.localStorage.setItem(LABEL_WIDTH_STORAGE_KEY, String(nextWidth));
    } catch {
      // Storage can be unavailable (private mode, quota); resizing still works.
    }
  }

  function toggleInspectorCollapsed() {
    const nextCollapsed = !isInspectorCollapsed;
    setIsInspectorCollapsed(nextCollapsed);
    try {
      window.localStorage.setItem(
        INSPECTOR_COLLAPSED_STORAGE_KEY,
        String(nextCollapsed),
      );
    } catch {
      // Storage can be unavailable (private mode, quota); the toggle still works.
    }
  }

  function commitPreviewWidth(nextWidth: number) {
    const width = clamp(
      Math.round(nextWidth),
      PREVIEW_MIN_WIDTH,
      previewMaxWidth,
    );
    setPreviewWidth(width);
    try {
      window.localStorage.setItem(PREVIEW_WIDTH_STORAGE_KEY, String(width));
    } catch {
      // Storage can be unavailable (private mode, quota); resizing still works.
    }
  }

  function handlePreviewResizePointerDown(
    event: ReactPointerEvent<HTMLHRElement>,
  ) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    previewResizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: effectivePreviewWidth,
    };
  }

  function handlePreviewResizePointerMove(
    event: ReactPointerEvent<HTMLHRElement>,
  ) {
    const resize = previewResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) {
      return;
    }

    // The panel sits to the right of the handle, so dragging left widens it.
    commitPreviewWidth(resize.startWidth + resize.startX - event.clientX);
  }

  function handlePreviewResizePointerEnd(
    event: ReactPointerEvent<HTMLHRElement>,
  ) {
    if (previewResizeRef.current?.pointerId !== event.pointerId) {
      return;
    }

    previewResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleLabelResizePointerDown(
    event: ReactPointerEvent<HTMLHRElement>,
  ) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    labelResizeRef.current = {
      pointerId: event.pointerId,
      pointerStartX: event.clientX,
      originWidth: labelWidth,
    };
  }

  function handleLabelResizePointerMove(
    event: ReactPointerEvent<HTMLHRElement>,
  ) {
    const resize = labelResizeRef.current;
    if (resize?.pointerId !== event.pointerId) {
      return;
    }

    setLabelWidth(
      clampLabelWidth(
        resize.originWidth + event.clientX - resize.pointerStartX,
      ),
    );
  }

  function handleLabelResizePointerEnd(
    event: ReactPointerEvent<HTMLHRElement>,
  ) {
    const resize = labelResizeRef.current;
    if (resize?.pointerId !== event.pointerId) {
      return;
    }

    labelResizeRef.current = null;
    commitLabelWidth(
      event.type === "pointercancel"
        ? labelWidth
        : resize.originWidth + event.clientX - resize.pointerStartX,
    );
  }

  function handleLabelResizeKeyDown(event: ReactKeyboardEvent<HTMLHRElement>) {
    let nextWidth: number;
    switch (event.key) {
      case "ArrowLeft":
        nextWidth = labelWidth - LABEL_WIDTH_KEYBOARD_STEP;
        break;
      case "ArrowRight":
        nextWidth = labelWidth + LABEL_WIDTH_KEYBOARD_STEP;
        break;
      case "Home":
        nextWidth = LABEL_WIDTH_MIN;
        break;
      case "End":
        nextWidth = LABEL_WIDTH_MAX;
        break;
      default:
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    commitLabelWidth(nextWidth);
  }

  function handlePreviewResizeKeyDown(
    event: ReactKeyboardEvent<HTMLHRElement>,
  ) {
    let nextWidth: number;
    switch (event.key) {
      case "ArrowLeft":
        nextWidth = effectivePreviewWidth + PREVIEW_RESIZE_KEY_STEP;
        break;
      case "ArrowRight":
        nextWidth = effectivePreviewWidth - PREVIEW_RESIZE_KEY_STEP;
        break;
      case "Home":
        nextWidth = PREVIEW_MIN_WIDTH;
        break;
      case "End":
        nextWidth = previewMaxWidth;
        break;
      default:
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    commitPreviewWidth(nextWidth);
  }

  // Export progress stays visible for the whole export.
  const statusMessage: StatusMessage =
    isExporting && exportState.detail
      ? {
          text: exportState.detail,
          tone: statusMessageTone(exportState.detail),
          sticky: true,
        }
      : { text: status, tone: statusMessageTone(status) };

  return (
    <div className="app-shell" ref={appShellRef}>
      {collaborationView.remoteCursors.length ? (
        <div className="collaboration-cursor-layer" aria-hidden="true">
          {collaborationView.remoteCursors.map((cursor) => (
            <div
              key={cursor.clientId}
              className="collaboration-cursor"
              style={{
                left: `${cursor.x * 100}%`,
                top: `${cursor.y * 100}%`,
                color: cursor.color,
              }}
            >
              <svg viewBox="0 0 20 20" role="presentation">
                <path
                  d="M3 2.5v12.7c0 .6.72.9 1.14.48l3.2-3.12l2.32 4.34a.9.9 0 0 0 1.22.37l1.56-.8a.9.9 0 0 0 .37-1.22L10.5 11l4.45-.56c.6-.08.84-.81.39-1.22L3.97 1.88A.67.67 0 0 0 3 2.5Z"
                  fill="currentColor"
                />
              </svg>
              <span
                className="collaboration-cursor__label"
                style={{ backgroundColor: cursor.color }}
              >
                {cursor.name}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <header className="topbar">
        <div className="topbar__group">
          <BrandMark onStatus={setStatus} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ghost-button file-menu-button" type="button">
                <span>File</span>
                <span className="file-menu-button__chevron" aria-hidden="true">
                  <svg viewBox="0 0 16 16" role="presentation">
                    <path
                      d="M4.47 6.22a.75.75 0 0 1 1.06.03L8 8.84l2.47-2.59a.75.75 0 1 1 1.08 1.04l-3.01 3.16a.75.75 0 0 1-1.08 0L4.44 7.29a.75.75 0 0 1 .03-1.07Z"
                      fill="currentColor"
                    />
                  </svg>
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => void handleOpenSession()}>
                Open Session
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void handleOpenWorkspace()}>
                Open Workspace
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void handleImport()}>
                Import Media
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!offlineMedia.length}
                onSelect={() => setIsOfflineMediaDialogOpen(true)}
              >
                {offlineMedia.length
                  ? "Locate Offline Media…"
                  : "All Media Linked"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  if (isConnectedClient) {
                    handleDisconnectConnection();
                    return;
                  }

                  setIsConnectDialogOpen(true);
                }}
              >
                {isConnectedClient
                  ? "Disconnect from Share"
                  : "Connect to Share"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() =>
                  setStatus(
                    "Save/export is not wired yet in the dev-server refactor.",
                  )
                }
              >
                Save
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ghost-button file-menu-button" type="button">
                <span>Edit</span>
                <span className="file-menu-button__chevron" aria-hidden="true">
                  <svg viewBox="0 0 16 16" role="presentation">
                    <path
                      d="M4.47 6.22a.75.75 0 0 1 1.06.03L8 8.84l2.47-2.59a.75.75 0 1 1 1.08 1.04l-3.01 3.16a.75.75 0 0 1-1.08 0L4.44 7.29a.75.75 0 0 1 .03-1.07Z"
                      fill="currentColor"
                    />
                  </svg>
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                disabled={isExporting || !canUndo}
                onSelect={() => handleUndo()}
              >
                <span>{undoLabel ? `Undo ${undoLabel}` : "Undo"}</span>
                <DropdownMenuShortcut>
                  {shortcutLabels.undo}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={isExporting || !canRedo}
                onSelect={() => handleRedo()}
              >
                <span>{redoLabel ? `Redo ${redoLabel}` : "Redo"}</span>
                <DropdownMenuShortcut>
                  {shortcutLabels.redo}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="tempo-pill">
            <button
              aria-label="Decrease tempo"
              className="tempo-pill__adjust"
              onClick={() =>
                commitProjectChange("Adjust BPM", (current) =>
                  patchProjectState(current, {
                    bpm: clamp(current.bpm - 5, 60, 220),
                  }),
                )
              }
              type="button"
            >
              −
            </button>
            <span>{bpm.toFixed(0)} BPM</span>
            <button
              aria-label="Increase tempo"
              className="tempo-pill__adjust"
              onClick={() =>
                commitProjectChange("Adjust BPM", (current) =>
                  patchProjectState(current, {
                    bpm: clamp(current.bpm + 5, 60, 220),
                  }),
                )
              }
              type="button"
            >
              +
            </button>
          </div>
        </div>

        <div className="topbar__group topbar__group--right">
          <button
            className="ghost-button"
            disabled={isExporting}
            onClick={handleExport}
            type="button"
          >
            {exportButtonLabel}
          </button>
          <span
            className={`collaboration-status collaboration-status--${collaborationView.stateTone}`}
            aria-live="polite"
          >
            <span className="collaboration-status__dot" aria-hidden="true" />
            {collaborationView.stateLabel}
          </span>
          <button
            className={`ghost-button share-button ${isSharing ? "is-sharing" : ""}`}
            disabled={isExporting || isStartingShare || isConnectedClient}
            onClick={() => {
              if (isSharing) {
                handleStopShare();
                return;
              }

              setIsShareDialogOpen(true);
            }}
            type="button"
          >
            <span className="share-button__icon" aria-hidden="true">
              <svg viewBox="0 0 16 16" role="presentation">
                <path
                  d="M8 1.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13Zm4.82 5.75H10.9a12 12 0 0 0-.62-3.11a5.03 5.03 0 0 1 2.54 3.11ZM8 2.47c.36 0 1.14 1.02 1.45 3.28h-2.9C6.86 3.49 7.64 2.47 8 2.47ZM5.72 4.14a12 12 0 0 0-.62 3.11H3.18a5.03 5.03 0 0 1 2.54-3.11Zm-2.54 4.61H5.1c.08 1.13.29 2.19.62 3.11a5.03 5.03 0 0 1-2.54-3.11ZM8 13.53c-.36 0-1.14-1.02-1.45-3.28h2.9C9.14 12.51 8.36 13.53 8 13.53Zm1.62-4.78H6.38a10.7 10.7 0 0 1 0-1.5h3.24c.06.5.06 1 0 1.5Zm.66 3.11c.33-.92.54-1.98.62-3.11h1.92a5.03 5.03 0 0 1-2.54 3.11Z"
                  fill="currentColor"
                />
              </svg>
            </span>
            <span>
              {isSharing
                ? "Stop Share"
                : isStartingShare
                  ? "Sharing..."
                  : "Share"}
            </span>
          </button>
          {hasCopiedShareInvite ? (
            <span
              className="share-copy-badge"
              aria-live="polite"
              title={lastCopiedShareUrl}
            >
              <svg viewBox="0 0 20 20" role="presentation" aria-hidden="true">
                <path
                  d="M10 1.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 0 0 0-17Zm3.57 6.2l-4.2 5.1a.75.75 0 0 1-1.12.06l-1.82-1.82a.75.75 0 1 1 1.06-1.06l1.24 1.24l3.62-4.4a.75.75 0 0 1 1.22.88Z"
                  fill="currentColor"
                />
              </svg>
              <span>Copied</span>
            </span>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ghost-button" type="button">
                Help
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() =>
                  setStatus(
                    "Use File → Open Session to open a .lvp session or an Ableton .als set, or File → Import Media to add clips.",
                  )
                }
              >
                Getting Started
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="help-menu__build"
                onSelect={() => void openBuildCommit().then(setStatus)}
              >
                {APP_BUILD_LABEL}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <Dialog open={isShareDialogOpen} onOpenChange={setIsShareDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share this session publicly?</DialogTitle>
            <DialogDescription>
              This will start the collaboration websocket, generate a public
              room, and copy a shareable address to your clipboard. Click Stop
              Share any time to disconnect immediately.
            </DialogDescription>
          </DialogHeader>

          <div className="share-dialog__body">
            <CollaborationDetailCard
              label="Room"
              value={collaborationView.pendingShareRoom}
            />
            <CollaborationDetailCard
              label="Signal"
              value={collaborationView.signalingLabel}
            />
            <CollaborationDetailCard
              label="Connection"
              value={collaborationView.stateLabel}
              meta={collaborationView.remoteCollaboratorNames || undefined}
            />
            <p className="share-dialog__note">
              Your invite uses a Google STUN probe to detect a public IP when
              one is available, then it copies the connection URL automatically.
            </p>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <button
                className="ghost-button"
                disabled={isStartingShare}
                type="button"
              >
                Cancel
              </button>
            </DialogClose>
            <button
              className="ghost-button ghost-button--accent"
              disabled={isStartingShare}
              onClick={handleStartShare}
              type="button"
            >
              {isStartingShare ? "Starting..." : "Start Sharing"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OfflineMediaDialog
        canLocateFolder={Boolean(getHarness().pickMediaFolder)}
        mediaItemsById={mediaItemsById}
        offlineMedia={offlineMedia}
        onOpenChange={setIsOfflineMediaDialogOpen}
        open={isOfflineMediaDialogOpen}
        relinkMedia={relinkOfflineMedia}
        relinkMediaItem={relinkOfflineMediaItem}
        relinkingIds={relinkingMediaIds}
      />

      <Dialog open={isConnectDialogOpen} onOpenChange={setIsConnectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect to a shared session</DialogTitle>
            <DialogDescription>
              Paste the invite copied from Share. The room, signaling server,
              and optional password will be pulled from that URL and the
              collaboration websocket will connect immediately.
            </DialogDescription>
          </DialogHeader>

          <div className="share-dialog__body">
            <label className="connect-dialog__field">
              <span className="share-dialog__label">Shared invite</span>
              <textarea
                className="connect-dialog__input"
                onChange={(event) => setConnectInviteValue(event.target.value)}
                placeholder="http://public-ip:1420/?room=...&signal=wss://y-webrtc-eu.fly.dev"
                rows={4}
                value={connectInviteValue}
              />
            </label>
            <CollaborationDetailCard
              label="Connection"
              value={collaborationView.stateLabel}
              meta={collaborationView.remoteCollaboratorNames || undefined}
            />
            <p className="share-dialog__note">
              If the host shared from this app, just paste the copied invite URL
              here and press Connect.
            </p>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <button
                className="ghost-button"
                disabled={isStartingConnect}
                type="button"
              >
                Cancel
              </button>
            </DialogClose>
            <button
              className="ghost-button ghost-button--accent"
              disabled={isStartingConnect}
              onClick={handleConnectToShare}
              type="button"
            >
              {isStartingConnect ? "Connecting..." : "Connect"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <main className="workspace">
        <div className="workspace__main">
          <section className="editor-panel">
            <div className="timeline-toolbar">
              <div className="timeline-toolbar__display">
                <span className="status-light" />
                <span>{formatTimecode(playheadSeconds, fps)}</span>
                <strong>{formatMusicalPosition(playheadQ, signature)}</strong>
              </div>

              <div className="timeline-toolbar__controls">
                <div
                  className="segmented-control"
                  role="tablist"
                  aria-label="Timeline scale"
                >
                  <button
                    className={timelineMode === "musical" ? "is-active" : ""}
                    onClick={() =>
                      commitProjectPatch("Change timeline scale", {
                        timelineMode: "musical",
                      })
                    }
                    type="button"
                  >
                    Tempo
                  </button>
                  <button
                    className={timelineMode === "timecode" ? "is-active" : ""}
                    onClick={() =>
                      commitProjectPatch("Change timeline scale", {
                        timelineMode: "timecode",
                      })
                    }
                    type="button"
                  >
                    SMPTE
                  </button>
                </div>

                <div
                  className="segmented-control"
                  role="tablist"
                  aria-label="Snap grid"
                >
                  {SNAP_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      className={snapMode === option.id ? "is-active" : ""}
                      onClick={() =>
                        commitProjectPatch("Change snap grid", {
                          snapMode: option.id,
                        })
                      }
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="segmented-control">
                  <button
                    aria-pressed={snapEnabled}
                    className={snapEnabled ? "is-active" : ""}
                    onClick={() =>
                      commitProjectPatch(
                        snapEnabled
                          ? "Disable beat snapping"
                          : "Enable beat snapping",
                        { snapEnabled: !snapEnabled },
                      )
                    }
                    title="Shift while dragging a clip or trim handle to temporarily disable snapping."
                    type="button"
                  >
                    {snapEnabled ? "Snap On" : "Snap Off"}
                  </button>
                </div>

                <label className="signature-picker">
                  <span>Time Sig</span>
                  <select
                    value={signatureId}
                    onChange={(event) =>
                      commitProjectPatch("Change time signature", {
                        signatureId: event.target.value,
                      })
                    }
                  >
                    {SIGNATURES.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.id}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="layer-toolbar">
                  <span className="layer-toolbar__count">
                    Layers {lanes.length}/{MAX_LAYERS}
                  </span>
                  <button
                    className="layer-toolbar__button"
                    disabled={!canCreateLayer}
                    onClick={handleCreateLayer}
                    type="button"
                  >
                    {canCreateLayer
                      ? `Create Layer ${getNextLaneNumber(lanes)}`
                      : "Max Layers"}
                  </button>
                </div>
              </div>
            </div>

            <div
              ref={editorGridRef}
              className="editor-grid"
              style={{
                ["--preview-width" as string]: `${effectivePreviewWidth}px`,
              }}
            >
              <div
                ref={timelineScrollRef}
                className="timeline-scroll"
                onScroll={() => syncTimelineViewport()}
                style={{ ["--label-width" as string]: `${labelWidth}px` }}
              >
                <div className="timeline-jump-overlay">
                  {isPlayheadOffscreenLeft ? (
                    <button
                      className="playhead-jump playhead-jump--left"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        scrollTimelineToPlayhead();
                      }}
                      type="button"
                    >
                      {"<<"}
                    </button>
                  ) : null}
                  {isPlayheadOffscreenRight ? (
                    <button
                      className="playhead-jump playhead-jump--right"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        scrollTimelineToPlayhead();
                      }}
                      type="button"
                    >
                      {">>"}
                    </button>
                  ) : null}
                </div>
                <div
                  className={`timeline-canvas ${labelWidth < LABEL_WIDTH_NARROW ? "timeline-canvas--narrow-labels" : ""}`}
                  style={{
                    width: labelWidth + timelineWidth,
                    ["--label-width" as string]: `${labelWidth}px`,
                  }}
                >
                  <div className="label-resize-rail">
                    <hr
                      className="label-resize-handle"
                      aria-orientation="vertical"
                      aria-label="Resize track labels"
                      aria-valuenow={labelWidth}
                      aria-valuemin={LABEL_WIDTH_MIN}
                      aria-valuemax={LABEL_WIDTH_MAX}
                      tabIndex={0}
                      title="Drag to resize. Double-click to reset."
                      onPointerDown={handleLabelResizePointerDown}
                      onPointerMove={handleLabelResizePointerMove}
                      onPointerUp={handleLabelResizePointerEnd}
                      onPointerCancel={handleLabelResizePointerEnd}
                      onDoubleClick={() =>
                        commitLabelWidth(LABEL_WIDTH_DEFAULT)
                      }
                      onKeyDown={handleLabelResizeKeyDown}
                    />
                  </div>
                  <div
                    className="timeline-playhead"
                    style={{ left: labelWidth + playheadTimelinePx }}
                  />

                  <section className="ruler-row">
                    <div className="track-label track-label--header">
                      <div>
                        <span>{sessionName ?? "Session"}</span>
                        {offlineCount ? (
                          <button
                            className="track-label__offline"
                            onClick={() => setIsOfflineMediaDialogOpen(true)}
                            title="Review and locate offline media"
                            type="button"
                          >
                            {relinkingMediaIds.size ? (
                              <>
                                <span
                                  aria-hidden="true"
                                  className="offline-media__spinner"
                                />
                                Linking{" "}
                                {pluralize(relinkingMediaIds.size, "file")}…
                              </>
                            ) : (
                              pluralize(offlineCount, "offline media file")
                            )}
                          </button>
                        ) : (
                          <small>{sessionMediaStatus}</small>
                        )}
                      </div>
                    </div>
                    <div
                      className={`ruler-row__content ruler-row__content--interactive ${
                        timelineDragState ? "is-dragging" : ""
                      }`}
                      onPointerDown={(event) => {
                        const timelineScroll = timelineScrollRef.current;
                        if (!timelineScroll) {
                          return;
                        }

                        event.preventDefault();
                        if (isPlaying) {
                          // Batched with setIsPlaying so the audio keeps
                          // running from the clicked position.
                          pulseTimelineAudibleScrub(
                            TIMELINE_PLAYBACK_SCRUB_AUDIO_IDLE_MS,
                          );
                        } else {
                          stopTimelineAudibleScrub();
                        }
                        setIsPlaying(false);

                        const timelineBounds =
                          timelineScroll.getBoundingClientRect();
                        const pointerX = event.clientX - timelineBounds.left;
                        const nextPlayheadQ = clamp(
                          (timelineScroll.scrollLeft - labelWidth + pointerX) /
                            quarterPx,
                          0,
                          totalQuarters,
                        );

                        setPlayheadQ(nextPlayheadQ);
                        playbackOriginRef.current = nextPlayheadQ;
                        setTimelineDragState({
                          pointerId: event.pointerId,
                          pointerStartX: event.clientX,
                          pointerStartY: event.clientY,
                          originPlayheadQ: nextPlayheadQ,
                          originZoom: resolvedZoom,
                          wasPlaying: isPlaying,
                        });
                      }}
                      style={gridStyle}
                    >
                      <div
                        className="timeline-playhead-marker"
                        style={{ left: playheadTimelinePx - 1 }}
                      />
                      {rulerBars.map((bar) => (
                        <div
                          key={bar.index}
                          className="ruler-marker"
                          style={{ left: bar.quarter * quarterPx }}
                        >
                          <span>
                            {timelineMode === "musical"
                              ? `${bar.index + 1}`
                              : formatTimecode(
                                  quartersToSeconds(bar.quarter, bpm),
                                  fps,
                                )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>

                  {lanes.map((lane) => (
                    <section
                      key={lane.id}
                      className={`track-row ${lane.id === fxLaneId ? "track-row--selected" : ""}`}
                    >
                      {/* biome-ignore lint/a11y/noStaticElementInteractions: clicking anywhere on the label is a mouse shortcut; the layer name button is the keyboard equivalent */}
                      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the layer name button handles the keyboard */}
                      <div
                        className="track-label track-label--lane"
                        onClick={(event) => {
                          if (
                            event.target instanceof Element &&
                            event.target.closest(".track-label__fx")
                          ) {
                            return;
                          }
                          selectLaneFromLabel(lane.id);
                        }}
                      >
                        <div className="track-label__index">
                          {lane.name.replace("Layer ", "")}
                        </div>
                        <button
                          aria-current={
                            lane.id === fxLaneId ? "true" : undefined
                          }
                          className="track-label__select"
                          data-lane-label-id={lane.id}
                          data-space-activates
                          tabIndex={lane.id === fxLaneId ? 0 : -1}
                          type="button"
                        >
                          <span>{lane.name}</span>
                          <small>{laneStatusById.get(lane.id)?.summary}</small>
                        </button>
                        <button
                          aria-label={`${lane.name} effects`}
                          aria-pressed={laneStatusById.get(lane.id)?.fxToggle}
                          className={`track-label__fx ${laneStatusById.get(lane.id)?.fxClassName ?? ""}`}
                          data-space-activates
                          disabled={!laneStatusById.get(lane.id)?.effectCount}
                          onClick={(event) => {
                            event.stopPropagation();
                            setLayerFxEnabled(lane.id, !isLayerFxEnabled(lane));
                          }}
                          title={laneStatusById.get(lane.id)?.fxTitle}
                          type="button"
                        >
                          fx
                        </button>
                      </div>
                      <div
                        className="track-row__content track-row__content--arrangement"
                        data-timeline-lane-id={lane.id}
                        onPointerDown={(event) => {
                          if (event.target !== event.currentTarget) {
                            return;
                          }

                          event.preventDefault();
                          setSelectedClipId(undefined);
                          setSelectedLaneId(lane.id);
                          setIsPlaying(false);
                          setDragPreviewClips(null);

                          const timelineScroll = timelineScrollRef.current;
                          if (!timelineScroll) {
                            return;
                          }

                          const timelineBounds =
                            timelineScroll.getBoundingClientRect();
                          const pointerX = event.clientX - timelineBounds.left;
                          const anchorQ = snapQuarterValue(
                            clamp(
                              (timelineScroll.scrollLeft -
                                labelWidth +
                                pointerX) /
                                quarterPx,
                              0,
                              totalQuarters,
                            ),
                            snapUnit,
                            snapEnabled && !event.shiftKey,
                          );
                          setPendingSelection({
                            id: `selection-${lane.id}`,
                            laneId: lane.id,
                            startQ: anchorQ,
                            durationQ: minimumWindowQ,
                          });
                          setDragState({
                            kind: "selection",
                            pointerId: event.pointerId,
                            laneId: lane.id,
                            anchorQ,
                          });
                        }}
                        style={gridStyle}
                      >
                        {pendingSelection?.laneId === lane.id ? (
                          <div
                            className="timeline-selection"
                            style={{
                              left: pendingSelection.startQ * quarterPx,
                              width: pendingSelection.durationQ * quarterPx,
                            }}
                          >
                            <span>Press 1-9 to commit</span>
                          </div>
                        ) : null}
                        {(clipsByLane.get(lane.id) ?? []).map((clip) => {
                          const selected = clip.id === selectedClip?.id;
                          const durationQ = getClipDurationQ(clip, bpm);
                          const media = clip.mediaId
                            ? mediaItemsById.get(clip.mediaId)
                            : undefined;
                          const mediaState = describeMediaAvailability(
                            media?.availability,
                          );
                          return (
                            <div
                              key={clip.id}
                              className={`clip-card ${selected ? "clip-card--selected" : ""}`}
                              style={{
                                left: clip.startQ * quarterPx,
                                width: durationQ * quarterPx,
                                ["--clip-accent" as string]: clip.accent,
                                backgroundColor: clip.tint,
                                borderColor: clip.accent,
                                boxShadow: selected
                                  ? `0 0 0 2px ${clip.accent}`
                                  : undefined,
                                opacity: mediaState === "online" ? 1 : 0.62,
                              }}
                            >
                              <button
                                className="clip-card__handle clip-card__handle--start"
                                onPointerDown={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setPendingSelection(null);
                                  setDragPreviewClips(null);
                                  setSelectedClipId(clip.id);
                                  setDragState({
                                    kind: "resize-start",
                                    pointerId: event.pointerId,
                                    clipId: clip.id,
                                    pointerStartX: event.clientX,
                                    originStartQ: clip.startQ,
                                    originDurationQ: durationQ,
                                  });
                                }}
                                type="button"
                              />
                              <button
                                className="clip-card__body"
                                onClick={() => {
                                  setPendingSelection(null);
                                  setSelectedClipId(clip.id);
                                  if (!isPlaying) {
                                    setPlayheadQ(clip.startQ);
                                    playbackOriginRef.current = clip.startQ;
                                  }
                                }}
                                onPointerDown={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setPendingSelection(null);
                                  setDragPreviewClips(null);
                                  const duplicateOnDrag =
                                    event.ctrlKey || event.metaKey;
                                  const dragClipId = duplicateOnDrag
                                    ? `window-${crypto.randomUUID()}`
                                    : clip.id;
                                  setSelectedClipId(dragClipId);
                                  setDragState({
                                    kind: "move",
                                    pointerId: event.pointerId,
                                    clipId: dragClipId,
                                    sourceClipId: clip.id,
                                    pointerStartX: event.clientX,
                                    originStartQ: clip.startQ,
                                    originDurationQ: durationQ,
                                    originLaneId: clip.laneId,
                                    duplicateOnDrag,
                                  });
                                }}
                                type="button"
                              >
                                <strong>{clip.label}</strong>
                                <span>
                                  {formatMusicalPosition(
                                    clip.startQ,
                                    signature,
                                  )}{" "}
                                  / {formatDuration(clip.durationSeconds)}
                                  {mediaState === "online"
                                    ? ""
                                    : ` / ${mediaState}`}
                                </span>
                              </button>
                              <button
                                className="clip-card__handle clip-card__handle--end"
                                onPointerDown={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setPendingSelection(null);
                                  setDragPreviewClips(null);
                                  setSelectedClipId(clip.id);
                                  setDragState({
                                    kind: "resize-end",
                                    pointerId: event.pointerId,
                                    clipId: clip.id,
                                    pointerStartX: event.clientX,
                                    originStartQ: clip.startQ,
                                    originDurationQ: durationQ,
                                  });
                                }}
                                type="button"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}

                  <section className="track-row track-row--bus">
                    <div className="track-label">
                      <div className="track-label__index">A</div>
                      <div>
                        <span>Audio</span>
                        <small>
                          {masterAudio ? masterAudio.name : "No master audio"}
                        </small>
                      </div>
                    </div>
                    <div
                      className="track-row__content track-row__content--waveform"
                      style={gridStyle}
                    >
                      {masterWaveformMessage ? (
                        <div
                          className="waveform__empty"
                          style={{ left: visibleTimelineStartPx + 16 }}
                        >
                          {masterWaveformMessage}
                        </div>
                      ) : null}
                      {currentMasterWaveform?.peaks ? (
                        <MasterWaveform
                          bpm={bpm}
                          peaks={currentMasterWaveform.peaks}
                          quarterPx={quarterPx}
                          visibleStartPx={visibleTimelineStartPx}
                          visibleWidthPx={visibleTimelineWidthPx}
                        />
                      ) : null}
                    </div>
                  </section>

                  <section
                    aria-label="Source track drop area"
                    className={`source-header ${sourceTracks.length ? "" : "source-header--empty"}`}
                    data-source-track-drop-target={
                      sourceTracks.length ? undefined : "new-track"
                    }
                    onDragEnter={(event) => {
                      if (!sourceTracks.length) {
                        handleSourceTrackDragEvent(event, {
                          kind: "new-track",
                        });
                      }
                    }}
                    onDragLeave={() => {
                      if (!sourceTracks.length) {
                        scheduleSourceTrackDragClear();
                      }
                    }}
                    onDragOver={(event) => {
                      if (!sourceTracks.length) {
                        handleSourceTrackDragEvent(event, {
                          kind: "new-track",
                        });
                      }
                    }}
                    onDrop={(event) => {
                      if (sourceTracks.length) {
                        return;
                      }

                      const files = getDraggedMediaFiles(event.dataTransfer);
                      if (!files.length) {
                        return;
                      }

                      event.preventDefault();
                      event.stopPropagation();
                      clearSourceTrackDragState();
                      void importMediaIntoSourceTrack(files, {
                        kind: "new-track",
                      });
                    }}
                  >
                    <div className="track-label track-label--header">
                      <div>
                        <span>Source Tracks</span>
                        <small>
                          {pluralize(
                            sourceTracks.length || mediaItems.length,
                            "track",
                          )}{" "}
                          in session
                        </small>
                      </div>
                    </div>
                    <div className="source-header__content">
                      {sourceTracks.length ? null : (
                        <div className="source-empty-state">
                          <span>No source media yet</span>
                          <button
                            className="ghost-button ghost-button--accent"
                            onClick={() => void handleImport()}
                            type="button"
                          >
                            Import Media
                          </button>
                          <button
                            className="ghost-button"
                            onClick={() => void handleOpenSession()}
                            title="Open a .lvp session or an Ableton .als set"
                            type="button"
                          >
                            Open Session
                          </button>
                        </div>
                      )}
                    </div>
                  </section>

                  {sourceTracks.map((track, index) => {
                    const sourceClips = sourceSpansByTrack.get(track.id) ?? [];
                    const swatch = getSwatch(track.colorIndex);
                    const isDropTarget =
                      sourceTrackDragTarget?.kind === "track" &&
                      sourceTrackDragTarget.trackId === track.id;

                    return (
                      <section
                        key={track.id}
                        className="track-row track-row--source"
                      >
                        <button
                          className="track-label track-label--source"
                          onClick={() => selectSource(track.id)}
                          type="button"
                        >
                          <span
                            className="track-label__stripe"
                            style={{ backgroundColor: swatch.accent }}
                          />
                          <div>
                            <span>{track.name}</span>
                            <small>
                              {track.recordingPaths.length
                                ? `${pluralize(track.recordingPaths.length, "file")} / key ${index + 1}`
                                : `Imported media / key ${index + 1}`}
                            </small>
                          </div>
                        </button>
                        <section
                          aria-label={`Drop media into ${track.name}`}
                          className={`track-row__content track-row__content--source ${isDropTarget ? "is-drop-target" : ""}`}
                          data-source-track-drop-target="track"
                          data-source-track-id={track.id}
                          onDragEnter={(event) =>
                            handleSourceTrackDragEvent(event, {
                              kind: "track",
                              trackId: track.id,
                            })
                          }
                          onDragLeave={() => {
                            scheduleSourceTrackDragClear();
                          }}
                          onDragOver={(event) =>
                            handleSourceTrackDragEvent(event, {
                              kind: "track",
                              trackId: track.id,
                            })
                          }
                          onDrop={(event) => {
                            const files = getDraggedMediaFiles(
                              event.dataTransfer,
                            );
                            if (!files.length) {
                              return;
                            }

                            event.preventDefault();
                            event.stopPropagation();
                            clearSourceTrackDragState();
                            void importMediaIntoSourceTrack(files, {
                              kind: "track",
                              trackId: track.id,
                            });
                          }}
                          style={gridStyle}
                        >
                          {sourceClips.map((clip) => {
                            const media = clip.mediaId
                              ? mediaItemsById.get(clip.mediaId)
                              : undefined;
                            const mediaState = describeMediaAvailability(
                              media?.availability,
                            );
                            const thumbnailUrl =
                              sourceThumbnailUrls[
                                getSourceThumbnailCacheKey(clip)
                              ] ?? media?.thumbnailUrl;
                            return (
                              <div
                                key={clip.id}
                                className="source-span"
                                style={{
                                  left: clip.startQ * quarterPx,
                                  width:
                                    getClipDurationQ(clip, bpm) * quarterPx,
                                  backgroundColor: clip.tint,
                                  borderColor: clip.accent,
                                  opacity: mediaState === "online" ? 1 : 0.56,
                                }}
                              >
                                <div
                                  className="source-span__thumb"
                                  style={
                                    thumbnailUrl
                                      ? {
                                          backgroundImage: `url(${thumbnailUrl})`,
                                          backgroundSize: "cover",
                                          backgroundPosition: "center",
                                        }
                                      : undefined
                                  }
                                />
                                <div className="source-span__body">
                                  <span>{clip.label}</span>
                                  <small>
                                    {mediaState === "online"
                                      ? "online"
                                      : mediaState === "hydrating"
                                        ? "hydrating..."
                                        : "offline clip"}
                                  </small>
                                  <div
                                    className="source-span__line"
                                    style={{ backgroundColor: clip.accent }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                          {isDropTarget && sourceTrackDragPreview ? (
                            <div className="source-drop-preview">
                              <div
                                className={`source-drop-preview__thumb ${
                                  sourceTrackDragPreview.thumbnailUrl
                                    ? "has-image"
                                    : ""
                                }`}
                                style={
                                  sourceTrackDragPreview.thumbnailUrl
                                    ? {
                                        backgroundImage: `url(${sourceTrackDragPreview.thumbnailUrl})`,
                                      }
                                    : undefined
                                }
                              />
                              <div className="source-drop-preview__body">
                                <strong>{sourceTrackDragPreview.label}</strong>
                                <span>{sourceTrackDragPreviewDetail}</span>
                              </div>
                              {sourceTrackDragPreviewOverflow ? (
                                <div className="source-drop-preview__count">
                                  {sourceTrackDragPreviewOverflow}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </section>
                      </section>
                    );
                  })}
                  {isSourceTrackFileDragActive ? (
                    <section className="track-row track-row--source track-row--source-drop">
                      <div className="track-label track-label--source track-label--source-drop">
                        <span className="track-label__stripe" />
                        <div>
                          <span>New Source Track</span>
                          <small>Drop here to create a new source track</small>
                        </div>
                      </div>
                      <section
                        aria-label="Drop media into a new source track"
                        className={`track-row__content track-row__content--source track-row__content--source-drop ${isNewSourceTrackDropTarget ? "is-drop-target" : ""}`}
                        data-source-track-drop-target="new-track"
                        onDragEnter={(event) =>
                          handleSourceTrackDragEvent(event, {
                            kind: "new-track",
                          })
                        }
                        onDragLeave={() => {
                          scheduleSourceTrackDragClear();
                        }}
                        onDragOver={(event) =>
                          handleSourceTrackDragEvent(event, {
                            kind: "new-track",
                          })
                        }
                        onDrop={(event) => {
                          const files = getDraggedMediaFiles(
                            event.dataTransfer,
                          );
                          if (!files.length) {
                            return;
                          }

                          event.preventDefault();
                          event.stopPropagation();
                          clearSourceTrackDragState();
                          void importMediaIntoSourceTrack(files, {
                            kind: "new-track",
                          });
                        }}
                        style={gridStyle}
                      >
                        {sourceTrackDragPreview ? (
                          <div className="source-drop-preview source-drop-preview--new-track">
                            <div
                              className={`source-drop-preview__thumb ${
                                sourceTrackDragPreview.thumbnailUrl
                                  ? "has-image"
                                  : ""
                              }`}
                              style={
                                sourceTrackDragPreview.thumbnailUrl
                                  ? {
                                      backgroundImage: `url(${sourceTrackDragPreview.thumbnailUrl})`,
                                    }
                                  : undefined
                              }
                            />
                            <div className="source-drop-preview__body">
                              <strong>{sourceTrackDragPreview.label}</strong>
                              <span>{sourceTrackDragPreviewDetail}</span>
                            </div>
                            {sourceTrackDragPreviewOverflow ? (
                              <div className="source-drop-preview__count">
                                {sourceTrackDragPreviewOverflow}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </section>
                    </section>
                  ) : null}
                </div>
              </div>

              <hr
                className="preview-resize-handle"
                aria-orientation="vertical"
                aria-label="Resize preview panel"
                aria-valuenow={effectivePreviewWidth}
                aria-valuemin={PREVIEW_MIN_WIDTH}
                aria-valuemax={previewMaxWidth}
                tabIndex={0}
                title="Drag to resize. Double-click to reset."
                onPointerDown={handlePreviewResizePointerDown}
                onPointerMove={handlePreviewResizePointerMove}
                onPointerUp={handlePreviewResizePointerEnd}
                onPointerCancel={handlePreviewResizePointerEnd}
                onDoubleClick={() => commitPreviewWidth(PREVIEW_DEFAULT_WIDTH)}
                onKeyDown={handlePreviewResizeKeyDown}
              />

              <aside className="preview-panel">
                <div className="preview-panel__header">
                  <strong>Program</strong>
                  <span className="preview-panel__clip">
                    {previewClip ? previewClip.label : "No clip at playhead"}
                  </span>
                  <span className="preview-panel__mode">
                    {previewMedia?.kind === "audio" ? "Audio" : "Video"}
                  </span>
                </div>

                <div className="preview-monitor">
                  <CompositionPlayer
                    ref={compositionPlayerRef}
                    bpm={bpm}
                    canvasHeight={canvasHeight}
                    canvasWidth={canvasWidth}
                    clips={timelineClips}
                    effects={effects}
                    isPlaying={isPlaying}
                    isScrubbing={Boolean(timelineDragState)}
                    isAudibleScrubbing={isTimelineAudibleScrubbing}
                    isContinuousScrubbing={Boolean(
                      timelineDragState?.wasPlaying,
                    )}
                    lanes={lanes}
                    masterAudio={masterAudio}
                    mediaItems={mediaItems}
                    playheadQ={playheadQ}
                    playheadSeconds={playheadSeconds}
                  />
                  {!previewClip ||
                  (previewMediaState !== "online" && !hasOnlinePlayheadClip) ? (
                    <div className="preview-placeholder">
                      <div className="preview-placeholder__overlay">
                        <strong>
                          {!previewClip
                            ? "No clip at playhead"
                            : "Offline clip"}
                        </strong>
                        <span>
                          {!previewClip
                            ? isPlaying
                              ? "The playhead is currently in a gap between clips."
                              : "Move the playhead onto a clip or start playback to render the session comp."
                            : previewMediaState === "hydrating"
                              ? "Media hydration is still running in the background."
                              : "This clip is in the project, but its media file is not cached locally yet."}
                        </span>
                      </div>
                    </div>
                  ) : null}
                </div>
              </aside>
            </div>

            <div className="transport-bar">
              <div className="zoom-control">
                <span>Zoom</span>
                <input
                  max="1.8"
                  min="0.65"
                  onBlur={() => flushZoomDraft()}
                  onChange={(event) =>
                    updateZoomDraft(Number(event.target.value))
                  }
                  onKeyUp={() => flushZoomDraft()}
                  onPointerUp={() => flushZoomDraft()}
                  step="0.01"
                  type="range"
                  value={resolvedZoom}
                />
              </div>

              <div className="transport-cluster">
                <button
                  aria-label="Jump back one bar"
                  className="transport-button transport-button--skip-start"
                  onClick={() => jumpPlayhead(-1)}
                  title="Jump back one bar"
                  type="button"
                >
                  <BackwardIcon aria-hidden="true" />
                </button>
                <button
                  aria-label="Jump back half a bar"
                  className="transport-button"
                  onClick={() => jumpPlayhead(-0.5)}
                  title="Jump back half a bar"
                  type="button"
                >
                  <BackwardIcon aria-hidden="true" />
                </button>
                <button
                  aria-label={isPlaying ? "Pause playback" : "Play timeline"}
                  className="transport-button transport-button--primary"
                  onClick={handleTransportToggle}
                  title={isPlaying ? "Pause playback" : "Play timeline"}
                  type="button"
                >
                  {isPlaying ? (
                    <PauseIcon aria-hidden="true" />
                  ) : (
                    <PlayIcon aria-hidden="true" />
                  )}
                </button>
                <button
                  aria-label="Jump forward half a bar"
                  className="transport-button"
                  onClick={() => jumpPlayhead(0.5)}
                  title="Jump forward half a bar"
                  type="button"
                >
                  <ForwardIcon aria-hidden="true" />
                </button>
                <button
                  aria-label="Jump forward one bar"
                  className="transport-button transport-button--skip-end"
                  onClick={() => jumpPlayhead(1)}
                  title="Jump forward one bar"
                  type="button"
                >
                  <ForwardIcon aria-hidden="true" />
                </button>
                <button
                  aria-label="Randomize arrangement"
                  className="transport-button transport-button--wand"
                  disabled={isExporting}
                  onClick={handleRandomizeTimeline}
                  title="Replace the arrangement with randomized selections"
                  type="button"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path
                      d="M4.75 18.19 2.5 20.44l1.06 1.06 2.25-2.25 1.13 1.13L20.5 6.81l-3.19-3.19L3.63 17.06l1.12 1.13Zm13.62-13.06 1.06 1.06-1.31 1.31-1.06-1.06 1.31-1.31ZM12 3.25l.52 1.98 1.98.52-1.98.52L12 8.25l-.52-1.98-1.98-.52 1.98-.52L12 3.25Zm6.75 6.5.39 1.46 1.46.39-1.46.39-.39 1.46-.39-1.46-1.46-.39 1.46-.39.39-1.46Zm-9 6 .39 1.46 1.46.39-1.46.39-.39 1.46-.39-1.46-1.46-.39 1.46-.39.39-1.46Z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </section>

          <section
            className={`fx-panel ${isInspectorCollapsed ? "fx-panel--collapsed" : ""}`}
          >
            <button
              aria-controls="fx-panel-body"
              aria-expanded={!isInspectorCollapsed}
              className="fx-panel__toggle"
              onClick={toggleInspectorCollapsed}
              type="button"
            >
              <span>{fxLane ? `${fxLane.name} effects` : "Effects"}</span>
              <ChevronDownIcon aria-hidden="true" />
            </button>

            <div
              className="fx-panel__body"
              hidden={isInspectorCollapsed}
              id="fx-panel-body"
            >
              <FxChain
                devices={fxDevices}
                kind={fxKind}
                layerFxEnabled={isLayerFxEnabled(fxLane)}
                layerName={fxLane?.name}
                layerTrackId={fxLaneId}
                onAdd={addFxDevice}
                onDuplicate={duplicateFxDevice}
                onMove={moveFxDevice}
                onRemove={removeFxDevice}
                onSetLayerFxEnabled={(enabled) => {
                  if (fxLaneId) {
                    setLayerFxEnabled(fxLaneId, enabled);
                  }
                }}
                onSetEnabled={setFxDeviceEnabled}
                onSetParameter={setFxDeviceParameter}
              />
            </div>
          </section>
        </div>
      </main>

      {importNotice ? (
        <ImportNotice
          notice={importNotice}
          onDismiss={() => setImportNotice(null)}
        />
      ) : null}
      <StatusBar items={STATUS_BAR_ITEMS} message={statusMessage} />
    </div>
  );
}

export default App;
