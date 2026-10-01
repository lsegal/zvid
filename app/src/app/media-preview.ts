// The preview pane's Timeline and Media tabs: which tab a viewer last had
// open, the Media tab's time readout, and the rule that only one of the
// timeline and the media preview plays at a time.

import { formatTimeValue, type TimeValueFormat } from "../time-value.ts";
import { PREVIEW_TAB_STORAGE_KEY } from "./constants.ts";
import { secondsToQuarters } from "./timeline-math.ts";

export type PreviewTab = "timeline" | "media";

export function readPreviewTab(): PreviewTab {
  if (typeof window === "undefined") {
    return "timeline";
  }

  try {
    return window.localStorage.getItem(PREVIEW_TAB_STORAGE_KEY) === "media"
      ? "media"
      : "timeline";
  } catch {
    return "timeline";
  }
}

export function writePreviewTab(tab: PreviewTab) {
  try {
    window.localStorage.setItem(PREVIEW_TAB_STORAGE_KEY, tab);
  } catch {
    // Private mode or a full quota: the tab just won't persist.
  }
}

// Media time counts from zero, like a duration, in the timeline's format:
// `mm:ss:ff` timecode, or bars.beats.sixteenths at the session tempo.
export function formatMediaTime(seconds: number, format: TimeValueFormat) {
  return formatTimeValue(
    secondsToQuarters(Math.max(0, seconds), format.bpm),
    "duration",
    format,
  );
}

export type PreviewPlaybackState = {
  tab: PreviewTab;
  timelinePlaying: boolean;
  mediaPlaying: boolean;
};

export type PreviewPlaybackAction =
  | { type: "play"; target: PreviewTab }
  | { type: "pause"; target: PreviewTab }
  // Space: toggles whichever tab is showing.
  | { type: "toggle-active" }
  | { type: "select-tab"; tab: PreviewTab };

function setPlaying(
  state: PreviewPlaybackState,
  target: PreviewTab,
  playing: boolean,
): PreviewPlaybackState {
  if (target === "timeline") {
    return {
      ...state,
      timelinePlaying: playing,
      // Starting one pauses the other.
      mediaPlaying: playing ? false : state.mediaPlaying,
    };
  }
  return {
    ...state,
    mediaPlaying: playing,
    timelinePlaying: playing ? false : state.timelinePlaying,
  };
}

function isPlaying(state: PreviewPlaybackState, target: PreviewTab) {
  return target === "timeline" ? state.timelinePlaying : state.mediaPlaying;
}

export function reducePreviewPlayback(
  state: PreviewPlaybackState,
  action: PreviewPlaybackAction,
): PreviewPlaybackState {
  switch (action.type) {
    case "play":
      return setPlaying(state, action.target, true);
    case "pause":
      return setPlaying(state, action.target, false);
    case "toggle-active":
      return setPlaying(state, state.tab, !isPlaying(state, state.tab));
    case "select-tab":
      // Switching tabs pauses the tab being left.
      return action.tab === state.tab
        ? state
        : { ...setPlaying(state, state.tab, false), tab: action.tab };
  }
}
