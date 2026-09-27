// Mirrors daw/crates/zvid-daw-ui/src/model.rs. Keep the two in sync.

export type Transport =
  | "builtIn"
  | "usb"
  | "continuity"
  | "virtual"
  | "network"
  | "unknown";

export type Camera = {
  id: string;
  name: string;
  transport: Transport;
};

export type VideoFormat = {
  width: number;
  height: number;
  /** Frame rate as a [numerator, denominator] fraction. */
  fps: [number, number];
};

export type Phase = "noCamera" | "ready" | "capturing" | "error";

export type CaptureInfo = {
  /** Milliseconds since arm when the status was produced. */
  elapsedMs: number;
  /** Takes opened so far in this capture. */
  takes: number;
  /** Frames dropped because the encoder fell behind, shown in the footer. */
  droppedFrames: number;
};

export type ErrorCode =
  | "permissionDenied"
  | "deviceBusy"
  | "deviceLost"
  | "notFound"
  | "invalidRequest"
  | "internal";

export type UiError = {
  code: ErrorCode;
  message: string;
};

/** What the Live companion script reports while it is connected. */
export type LiveInfo = {
  /** Either of Live's record buttons is on. */
  recordArmed: boolean;
};

export type Status = {
  phase: Phase;
  cameraId: string | null;
  format: VideoFormat | null;
  capture: CaptureInfo | null;
  error: UiError | null;
  /** The Live companion, or null while it isn't connected. */
  live: LiveInfo | null;
};

export type TakeInfo = {
  id: string;
  filename: string;
  /** RFC 3339 UTC timestamp of the capture. */
  createdAt: string;
  durationSec: number;
  /** Seconds into the file where the take starts. */
  fileOffsetSec: number;
  /** Song position in quarter-note beats, or null when not placed. */
  transportStartBeats: number | null;
  timeSignature: [number, number] | null;
  unanchored: boolean;
  missing: boolean;
};

export type UiEvent =
  | { event: "status"; payload: Status }
  | { event: "camerasChanged"; payload: Camera[] }
  | { event: "takeOpened"; payload: { index: number } }
  | { event: "takeClosed"; payload: TakeInfo }
  | { event: "error"; payload: UiError };

export type EventBatch = {
  cursor: number;
  resync: boolean;
  events: UiEvent[];
};

export type Commands = {
  getStatus: { args: undefined; result: Status };
  listCameras: { args: undefined; result: Camera[] };
  selectCamera: { args: { id: string }; result: null };
  refreshDevices: { args: undefined; result: Camera[] };
  arm: { args: undefined; result: null };
  disarm: { args: undefined; result: null };
  listTakes: { args: undefined; result: TakeInfo[] };
  revealTake: { args: { id: string }; result: null };
  openPrivacySettings: { args: undefined; result: null };
};

/** Injected by the Rust host before the page loads. */
export type ZvidConfig = {
  origins: Record<
    "app" | "ipc" | "preview" | "take" | "thumb" | "frames",
    string
  >;
  version: string;
  platform: string;
};
