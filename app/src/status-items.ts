// Status bar content: session, timeline and project info, built as plain data
// so the status bar component only has to render it. Values stay short so the
// bar fits on one line; `title` carries the full text for hover. The items
// come from the providers in status-bar/.

import type { AppBuild } from "./build-info.ts";
import {
  formatMusicalPosition,
  formatTimecode,
  type MeterSignature,
} from "./timeline-format.ts";

export type StatusItemId =
  | "version"
  | "session"
  | "timeline"
  | "playhead"
  | "resolution"
  | "audio"
  | "collaboration"
  | "content"
  | "media";

export type StatusItem = {
  id: StatusItemId;
  label: string;
  value: string;
  title: string;
};

export type StatusTimelineMode = "musical" | "timecode";

export type StatusPlayheadState = {
  timelineMode: StatusTimelineMode;
  playheadQ: number;
  bpm: number;
  signature: MeterSignature;
  fps: number;
};

export type StatusAudioInfo = {
  sampleRate?: number;
  channels?: number;
  hasAudio?: boolean;
};

export type StatusCollaborationInfo = {
  mode: "idle" | "sharing" | "connected";
  connected: boolean;
  peerCount: number;
};

export type StatusItemsState = StatusPlayheadState & {
  // The running zvid build, or null to leave the version item out.
  version: AppBuild | null;
  sessionName: string | null;
  canvasWidth: number;
  canvasHeight: number;
  // Media under the playhead; null when there is none.
  audio: StatusAudioInfo | null;
  collaboration: StatusCollaborationInfo;
  clipCount: number;
  trackCount: number;
  offlineCount: number;
};

// The playhead readout for the current ruler: `bar.beat.sixteenth` on the
// tempo ruler, `mm:ss:ff` on the SMPTE ruler. Exported on its own so a live
// readout can refresh just this value from the playhead ref during playback.
export function formatStatusPlayhead(state: StatusPlayheadState) {
  return state.timelineMode === "musical"
    ? formatMusicalPosition(state.playheadQ, state.signature)
    : formatTimecode((state.playheadQ * 60) / state.bpm, state.fps);
}

export function buildPlayheadStatusItem(
  state: StatusPlayheadState,
): StatusItem {
  const value = formatStatusPlayhead(state);
  return {
    id: "playhead",
    label: "Pos",
    value,
    title:
      state.timelineMode === "musical"
        ? `Playhead: ${value} (bar.beat.sixteenth)`
        : `Playhead: ${value} (minutes:seconds:frames at ${state.fps} fps)`,
  };
}

// Same logic as the preview pane's former Audio row.
export function formatStatusAudio(audio: StatusAudioInfo | null) {
  if (audio?.sampleRate) {
    return `${audio.sampleRate} Hz / ${audio.channels ?? 2} ch`;
  }
  return audio?.hasAudio ? "Embedded" : "None";
}
