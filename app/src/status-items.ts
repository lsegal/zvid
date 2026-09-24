// Status bar content: session, timeline and project info, built as plain data
// so the status bar component only has to render it. Values stay short so the
// bar fits on one line; `title` carries the full text for hover.

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
  // zvid version, or null to leave the version item out.
  version: string | null;
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

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// `120` -> `120`, `92.456` -> `92.46`.
function formatBpm(bpm: number) {
  return `${Math.round(bpm * 100) / 100}`;
}

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

function buildCollaborationItem(
  collaboration: StatusCollaborationInfo,
): StatusItem | null {
  if (collaboration.mode === "idle") {
    return null;
  }

  const role = collaboration.mode === "sharing" ? "Sharing" : "Joined";
  let value: string;
  let detail: string;
  if (collaboration.peerCount > 0) {
    value = `${role} · ${plural(collaboration.peerCount, "peer")}`;
    detail = `${plural(collaboration.peerCount, "peer")} connected`;
  } else if (collaboration.connected) {
    value = `${role} · waiting`;
    detail =
      collaboration.mode === "sharing"
        ? "waiting for a peer"
        : "waiting for the host";
  } else {
    value = "Connecting…";
    detail = "connecting to the signaling server";
  }

  return {
    id: "collaboration",
    label: "Collab",
    value,
    title: `Collaboration: ${
      collaboration.mode === "sharing" ? "sharing this session" : "joined"
    }, ${detail}`,
  };
}

export function buildStatusItems(state: StatusItemsState): StatusItem[] {
  const items: StatusItem[] = [];

  if (state.version) {
    items.push({
      id: "version",
      label: "zvid",
      value: state.version,
      title: `zvid ${state.version}`,
    });
  }

  const sessionName = state.sessionName ?? "Untitled session";
  items.push({
    id: "session",
    label: "Session",
    value: sessionName,
    title: `Session: ${sessionName}`,
  });

  const isMusical = state.timelineMode === "musical";
  const bpm = formatBpm(state.bpm);
  items.push({
    id: "timeline",
    label: isMusical ? "Tempo" : "SMPTE",
    value: `${bpm} BPM`,
    title: `Timeline: ${isMusical ? "Tempo" : "SMPTE"} ruler, ${bpm} BPM`,
  });

  items.push(buildPlayheadStatusItem(state));

  items.push({
    id: "resolution",
    label: "Res",
    value: `${state.canvasWidth}x${state.canvasHeight}`,
    title: `Resolution: ${state.canvasWidth} x ${state.canvasHeight}`,
  });

  const audio = formatStatusAudio(state.audio);
  items.push({
    id: "audio",
    label: "Audio",
    value: audio,
    title: `Audio: ${audio}`,
  });

  const collaboration = buildCollaborationItem(state.collaboration);
  if (collaboration) {
    items.push(collaboration);
  }

  items.push({
    id: "content",
    label: "Clips",
    value: `${state.clipCount} / ${state.trackCount}`,
    title: `${plural(state.clipCount, "clip")} on ${plural(
      state.trackCount,
      "track",
    )}`,
  });

  if (state.offlineCount > 0) {
    items.push({
      id: "media",
      label: "Media",
      value: `${state.offlineCount} offline`,
      title: `${plural(state.offlineCount, "media file")} offline`,
    });
  }

  return items;
}
