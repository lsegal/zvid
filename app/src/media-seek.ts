import { clamp } from "./app/util.ts";

const MEDIA_SEEK_TOLERANCE_SECONDS = 0.001;
const MEDIA_SEEK_TIMEOUT_MS = 4000;
// How far playing media may drift from its clip's time before it is seeked.
const MAX_PLAYBACK_DRIFT_SECONDS = 0.18;
// Playing media this far off keeps its clip's rate; further off, until it is
// seeked, it plays up to MAX_RATE_NUDGE faster or slower, by
// RATE_NUDGE_PER_SECOND for each second it is off, to catch up without the
// hitch a seek makes.
const RATE_NUDGE_DEAD_ZONE_SECONDS = 0.04;
const RATE_NUDGE_PER_SECOND = 0.5;
const MAX_RATE_NUDGE = 0.1;
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
      queuedSeeks.delete(element);
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

// The time each element still seeking seeks to next, once its seek lands.
const queuedSeeks = new WeakMap<HTMLMediaElement, number>();

// Seeks `element` to `targetSeconds`, or, while a seek is still landing, once
// it has: a scrub queues no seeks behind one another, and only its latest
// target is kept.
export function seekWhenReady(
  element: HTMLMediaElement,
  targetSeconds: number,
) {
  if (!element.seeking) {
    queuedSeeks.delete(element);
    element.currentTime = targetSeconds;
    return;
  }
  const waiting = queuedSeeks.has(element);
  queuedSeeks.set(element, targetSeconds);
  if (waiting) {
    return;
  }
  element.addEventListener(
    "seeked",
    () => {
      const target = queuedSeeks.get(element);
      queuedSeeks.delete(element);
      if (
        target !== undefined &&
        Math.abs(element.currentTime - target) > MEDIA_SEEK_TOLERANCE_SECONDS
      ) {
        seekWhenReady(element, target);
      }
    },
    { once: true },
  );
}

// Drops the seek queued for `element`, as when the seek landing is already
// where it is wanted.
export function cancelQueuedSeek(element: HTMLMediaElement) {
  queuedSeeks.delete(element);
}

// The rate media whose clip plays at `rate` plays at while it is
// `behindSeconds` behind its clip's time (ahead, when negative), in hundredths
// so it isn't set again every frame.
export function nudgedPlaybackRate(rate: number, behindSeconds: number) {
  if (Math.abs(behindSeconds) <= RATE_NUDGE_DEAD_ZONE_SECONDS) {
    return rate;
  }
  const nudge = clamp(
    behindSeconds * RATE_NUDGE_PER_SECOND,
    -MAX_RATE_NUDGE,
    MAX_RATE_NUDGE,
  );
  return rate * (1 + Math.round(nudge * 100) / 100);
}
