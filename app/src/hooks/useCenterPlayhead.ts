import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import {
  centeredScrollLeft,
  centerPlayheadQ,
  exceedsTouchSlop,
  LONG_PRESS_MS,
  pinchZoom,
  swipePlayheadQ,
} from "../mobile/timeline-touch.ts";
import type { PlayheadSignal } from "../playhead-signal";

// While a swipe scrubs, the playhead commits to React state this often; the
// signal (and so the playhead line and readouts) follows every frame.
const SCRUB_COMMIT_INTERVAL_MS = 60;
// A scroll this long after the last one has settled, for browsers without
// the scrollend event.
const SCROLL_SETTLE_MS = 140;

// Marks the scroller at its start, where it only pans vertically (see
// mobile-shell.css) and a sideways swipe scrubs by hand instead.
function markAtStart(scroll: HTMLElement) {
  scroll.toggleAttribute("data-at-start", scroll.scrollLeft < 0.5);
}

// Whether a finger on `target` could pan the timeline sideways: nothing
// between it and the scroller, such as a trim handle, keeps the finger.
function allowsPanX(target: EventTarget | null, scroll: HTMLElement) {
  for (
    let element = target instanceof Element ? target : null;
    element && element !== scroll;
    element = element.parentElement
  ) {
    const { touchAction } = getComputedStyle(element);
    if (
      touchAction !== "auto" &&
      touchAction !== "manipulation" &&
      !touchAction.includes("pan-x")
    ) {
      return false;
    }
  }
  return true;
}

export type CenterPlayheadInputs = {
  enabled: boolean;
  timelineScrollRef: RefObject<HTMLDivElement | null>;
  playheadSignal: PlayheadSignal;
  playheadQRef: { current: number };
  setPlayheadQ: (playheadQ: number) => void;
  playbackOriginRef: { current: number };
  labelWidth: number;
  quarterPx: number;
  resolvedZoom: number;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  updateZoomDraft: (zoom: number | null) => void;
  flushZoomDraft: (label?: string) => void;
};

// The mobile timeline: the playhead stays at the center and the timeline
// scrolls under it. Playback and seeks scroll the timeline; a swipe scrolls
// it and moves the playhead to whatever is under the center, pausing
// playback first. Time 0 starts at the labels' edge, so near the start,
// where the timeline can't scroll, the playhead moves between there and the
// center instead, and a sideways swipe there scrubs by hand. Two fingers
// pinch the zoom, around the playhead.
export function useCenterPlayhead({
  enabled,
  timelineScrollRef,
  playheadSignal,
  playheadQRef,
  setPlayheadQ,
  playbackOriginRef,
  labelWidth,
  quarterPx,
  resolvedZoom,
  isPlaying,
  setIsPlaying,
  updateZoomDraft,
  flushZoomDraft,
}: CenterPlayheadInputs) {
  // The scroll this hook last set, so its own scroll events aren't taken
  // for a swipe.
  const appliedLeftRef = useRef<number | null>(null);
  const scrubbingRef = useRef(false);
  const geometryRef = useRef({ labelWidth, quarterPx });
  geometryRef.current = { labelWidth, quarterPx };
  const playbackRef = useRef({ isPlaying, setIsPlaying });
  playbackRef.current = { isPlaying, setIsPlaying };
  const zoomRef = useRef({ resolvedZoom, updateZoomDraft, flushZoomDraft });
  zoomRef.current = { resolvedZoom, updateZoomDraft, flushZoomDraft };

  // Puts the playhead at the center. Runs on every playhead change outside
  // a swipe, and when the zoom or the view's width changes.
  const centerRef = useRef(() => {});
  centerRef.current = () => {
    const scroll = timelineScrollRef.current;
    if (!enabled || !scroll || scrubbingRef.current) {
      return;
    }
    const left = centeredScrollLeft(playheadSignal.get(), {
      ...geometryRef.current,
      clientWidth: scroll.clientWidth,
    });
    if (Math.abs(scroll.scrollLeft - left) < 0.5) {
      return;
    }
    scroll.scrollLeft = left;
    appliedLeftRef.current = scroll.scrollLeft;
    markAtStart(scroll);
  };

  useEffect(() => {
    if (!enabled) {
      return;
    }
    return playheadSignal.subscribe(() => centerRef.current());
  }, [enabled, playheadSignal]);

  useLayoutEffect(() => {
    void [labelWidth, quarterPx];
    centerRef.current();
  }, [labelWidth, quarterPx]);

  useEffect(() => {
    const scroll = timelineScrollRef.current;
    if (!enabled || !scroll) {
      return;
    }

    let settleTimer = 0;
    let lastCommit = 0;
    let pinch: { distance: number; zoom: number } | null = null;
    // A finger that touched down with the timeline at its start. Once it
    // moves sideways, it scrubs by hand.
    let swipe: {
      x: number;
      y: number;
      startQ: number;
      startMs: number;
      sideways: boolean;
    } | null = null;

    const commit = (q: number) => {
      lastCommit = performance.now();
      setPlayheadQ(q);
      playbackOriginRef.current = q;
    };
    const settle = () => {
      window.clearTimeout(settleTimer);
      if (!scrubbingRef.current) {
        return;
      }
      scrubbingRef.current = false;
      commit(playheadSignal.get());
    };
    const handleScroll = () => {
      markAtStart(scroll);
      if (swipe?.sideways) {
        return;
      }
      const applied = appliedLeftRef.current;
      if (
        !scrubbingRef.current &&
        applied !== null &&
        Math.abs(scroll.scrollLeft - applied) < 1
      ) {
        return;
      }
      appliedLeftRef.current = null;
      if (!scrubbingRef.current) {
        scrubbingRef.current = true;
        if (playbackRef.current.isPlaying) {
          playbackRef.current.setIsPlaying(false);
        }
      }
      const q = centerPlayheadQ(scroll.scrollLeft, {
        ...geometryRef.current,
        clientWidth: scroll.clientWidth,
      });
      playheadQRef.current = q;
      playheadSignal.set(q);
      if (performance.now() - lastCommit >= SCRUB_COMMIT_INTERVAL_MS) {
        commit(q);
      }
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(settle, SCROLL_SETTLE_MS);
    };

    const fingerDistance = (touches: TouchList) =>
      Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY,
      );
    const endSwipe = () => {
      const sideways = swipe?.sideways;
      swipe = null;
      if (sideways) {
        settle();
      }
    };
    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        endSwipe();
        pinch = {
          distance: fingerDistance(event.touches),
          zoom: zoomRef.current.resolvedZoom,
        };
      } else if (
        event.touches.length === 1 &&
        scroll.scrollLeft < 0.5 &&
        allowsPanX(event.target, scroll)
      ) {
        swipe = {
          x: event.touches[0].clientX,
          y: event.touches[0].clientY,
          startQ: playheadSignal.get(),
          startMs: performance.now(),
          sideways: false,
        };
      }
    };
    // A sideways swipe from the start: the timeline follows the finger as
    // though it could scroll before 0, so the playhead moves to the center
    // first and the timeline scrolls after.
    const scrubSwipe = (touch: Touch) => {
      if (!swipe) {
        return;
      }
      const dx = touch.clientX - swipe.x;
      const dy = touch.clientY - swipe.y;
      if (!swipe.sideways) {
        if (!exceedsTouchSlop(dx, dy)) {
          return;
        }
        // A hold picked up a clip or started a selection instead
        // (useTouchClipGestures), or the finger pans vertically.
        if (
          performance.now() - swipe.startMs >= LONG_PRESS_MS ||
          Math.abs(dy) >= Math.abs(dx)
        ) {
          swipe = null;
          return;
        }
        swipe.sideways = true;
        window.clearTimeout(settleTimer);
        scrubbingRef.current = true;
        if (playbackRef.current.isPlaying) {
          playbackRef.current.setIsPlaying(false);
        }
      }
      const geometry = {
        ...geometryRef.current,
        clientWidth: scroll.clientWidth,
      };
      const q = swipePlayheadQ(
        swipe.startQ,
        dx,
        scroll.scrollWidth - scroll.clientWidth,
        geometry,
      );
      playheadQRef.current = q;
      playheadSignal.set(q);
      scroll.scrollLeft = centeredScrollLeft(q, geometry);
      if (performance.now() - lastCommit >= SCRUB_COMMIT_INTERVAL_MS) {
        commit(q);
      }
    };
    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length === 1) {
        scrubSwipe(event.touches[0]);
        return;
      }
      if (!pinch || event.touches.length !== 2) {
        return;
      }
      if (event.cancelable) {
        event.preventDefault();
      }
      zoomRef.current.updateZoomDraft(
        pinchZoom(pinch.zoom, pinch.distance, fingerDistance(event.touches)),
      );
    };
    const handleTouchEnd = (event: TouchEvent) => {
      if (event.touches.length === 0) {
        endSwipe();
      }
      if (pinch && event.touches.length < 2) {
        pinch = null;
        zoomRef.current.flushZoomDraft("Zoom timeline");
      }
    };

    scroll.addEventListener("scroll", handleScroll, { passive: true });
    scroll.addEventListener("scrollend", settle);
    scroll.addEventListener("touchstart", handleTouchStart, { passive: true });
    scroll.addEventListener("touchmove", handleTouchMove, { passive: false });
    scroll.addEventListener("touchend", handleTouchEnd);
    scroll.addEventListener("touchcancel", handleTouchEnd);
    centerRef.current();
    markAtStart(scroll);
    return () => {
      window.clearTimeout(settleTimer);
      scrubbingRef.current = false;
      scroll.removeAttribute("data-at-start");
      scroll.removeEventListener("scroll", handleScroll);
      scroll.removeEventListener("scrollend", settle);
      scroll.removeEventListener("touchstart", handleTouchStart);
      scroll.removeEventListener("touchmove", handleTouchMove);
      scroll.removeEventListener("touchend", handleTouchEnd);
      scroll.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [
    enabled,
    playbackOriginRef,
    playheadQRef,
    playheadSignal,
    setPlayheadQ,
    timelineScrollRef,
  ]);
}
