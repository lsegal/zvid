import { clamp } from "./app/util.ts";

const MEDIA_SEEK_TOLERANCE_SECONDS = 0.001;
const MEDIA_SEEK_TIMEOUT_MS = 4000;
// How far playing media may drift from its clip's time before it is seeked.
const MAX_PLAYBACK_DRIFT_SECONDS = 0.18;
// HTMLMediaElement.HAVE_CURRENT_DATA, which Node (the unit tests) lacks.
const HAVE_CURRENT_DATA = 2;

// Seeks `element` to `targetSeconds`, resolving once the frame there is
// ready, the seek fails, or it times out.
export function seekMediaElement(
  element: HTMLMediaElement,
  targetSeconds: number,
) {
  const clampedTarget = Math.max(0, targetSeconds);
  const drift = Math.abs(element.currentTime - clampedTarget);
  // A new element sits at 0 before its first frame loads, so being there
  // isn't enough: its frame must be ready too.
  if (
    drift <= MEDIA_SEEK_TOLERANCE_SECONDS &&
    element.readyState >= HAVE_CURRENT_DATA
  ) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    let settled = false;
    let timeoutId = 0;

    const settle = () => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      element.removeEventListener("seeked", settle);
      element.removeEventListener("error", settle);
      element.removeEventListener("loadeddata", settle);
      resolve();
    };

    timeoutId = window.setTimeout(settle, MEDIA_SEEK_TIMEOUT_MS);
    element.addEventListener("seeked", settle, { once: true });
    element.addEventListener("error", settle, { once: true });
    element.addEventListener("loadeddata", settle, { once: true });

    try {
      element.pause();
      element.currentTime = clampedTarget;
    } catch {
      settle();
    }
  });
}

// Whether media `driftSeconds` away from the time its clip shows is seeked
// there: paused or scrubbing, unless it is there already, as media an edit
// didn't move is when a paused preview syncs after it; playing, only once
// it drifts too far.
export function needsPlaybackSeek(
  driftSeconds: number,
  { isPlaying, isScrubbing }: { isPlaying: boolean; isScrubbing: boolean },
) {
  if (driftSeconds <= MEDIA_SEEK_TOLERANCE_SECONDS) {
    return false;
  }
  return isPlaying && !isScrubbing
    ? driftSeconds > MAX_PLAYBACK_DRIFT_SECONDS
    : true;
}

// The playback rates every browser accepts; a media element throws outside
// them.
const MIN_PLAYBACK_RATE = 0.0625;
const MAX_PLAYBACK_RATE = 16;

// Plays, pauses and seeks `element` to follow the clip it is drawn for at
// the playhead, if any.
export function syncPlaybackElement(
  element: HTMLMediaElement,
  entry:
    | { mediaTime: number; playbackRate: number; isInBounds: boolean }
    | undefined,
  playback: { isPlaying: boolean; isScrubbing: boolean },
) {
  if (!entry?.isInBounds) {
    if (!element.paused) {
      element.pause();
    }
    return;
  }

  // A warped clip changes speed between its warp markers; the drift
  // check below re-seeks it at each marker.
  const playbackRate = clamp(
    entry.playbackRate,
    MIN_PLAYBACK_RATE,
    MAX_PLAYBACK_RATE,
  );
  if (element.playbackRate !== playbackRate) {
    element.playbackRate = playbackRate;
  }

  const drift = Math.abs(element.currentTime - entry.mediaTime);
  if (needsPlaybackSeek(drift, playback)) {
    element.currentTime = entry.mediaTime;
  }

  // Clip audio plays through the mixer; these elements are only drawn.
  if (playback.isPlaying) {
    element.play().catch(() => {});
  } else if (!element.paused) {
    element.pause();
  }
}
