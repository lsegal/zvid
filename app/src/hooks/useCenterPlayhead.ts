import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import {
  getTimelinePointerX,
  pointerToTimelineQ,
} from "../app/timeline-math.ts";
import { clamp } from "../app/util.ts";
import {
  centeredScrollLeft,
  centerPlayheadQ,
  exceedsTouchSlop,
  type FingerSample,
  flingStep,
  flingVelocity,
  LONG_PRESS_MS,
  MIN_FLING_VELOCITY,
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
// The ruler, where a finger scrubs by hand at any scroll and a tap seeks,
// apart from its loop strip, which selects a range instead.
const RULER = ".ruler-row__content--interactive";
const LOOP_STRIP = ".ruler-loop-strip";
// The finger samples a release measures its speed from.
const MAX_FINGER_SAMPLES = 8;

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
  totalQuarters: number;
  resolvedZoom: number;
  // A tap on the ruler moves the playhead here.
  seekTo: (playheadQ: number) => void;
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
// center instead, and a sideways swipe there scrubs by hand. A swipe on the
// ruler scrubs by hand too, in the same direction, and a tap on it seeks
// when the finger lifts. A scrub by hand flings on when released, as a
// scroll does. Two fingers pinch the zoom, around the playhead.
export function useCenterPlayhead({
  enabled,
  timelineScrollRef,
  playheadSignal,
  playheadQRef,
  setPlayheadQ,
  playbackOriginRef,
  labelWidth,
  quarterPx,
  totalQuarters,
  resolvedZoom,
  seekTo,
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
  const seekRef = useRef({ totalQuarters, seekTo });
  seekRef.current = { totalQuarters, seekTo };
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
    // A finger that touched down on the ruler, or with the timeline at its
    // start. Once it moves sideways, it scrubs by hand.
    let swipe: {
      x: number;
      y: number;
      dx: number;
      startQ: number;
      startMs: number;
      sideways: boolean;
      onRuler: boolean;
      // It touched down to stop a fling, so lifting it doesn't seek.
      stoppedFling: boolean;
      samples: FingerSample[];
    } | null = null;
    // The animation frame of a released scrub flinging on.
    let flingFrame: number | null = null;

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
      if (swipe?.sideways || flingFrame !== null) {
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
    // Scrubs to where a swipe `dx` px long from `startQ` reaches, as
    // though the timeline could scroll past its start (swipePlayheadQ).
    const scrubBy = (startQ: number, dx: number) => {
      const geometry = {
        ...geometryRef.current,
        clientWidth: scroll.clientWidth,
      };
      const q = swipePlayheadQ(
        startQ,
        dx,
        scroll.scrollWidth - scroll.clientWidth,
        geometry,
      );
      playheadQRef.current = q;
      playheadSignal.set(q);
      scroll.scrollLeft = centeredScrollLeft(q, geometry);
      appliedLeftRef.current = scroll.scrollLeft;
      if (performance.now() - lastCommit >= SCRUB_COMMIT_INTERVAL_MS) {
        commit(q);
      }
      return q;
    };
    const stopFling = () => {
      if (flingFrame === null) {
        return false;
      }
      window.cancelAnimationFrame(flingFrame);
      flingFrame = null;
      settle();
      return true;
    };
    // A released scrub carries on at the finger's speed, slowing as a
    // scroll does, until it stops or reaches either end.
    const fling = (
      startQ: number,
      releaseDx: number,
      releaseVelocity: number,
    ) => {
      let dx = releaseDx;
      let velocity = releaseVelocity;
      let lastQ = playheadSignal.get();
      let lastMs: number | null = null;
      const step = (nowMs: number) => {
        const frame = flingStep(
          velocity,
          lastMs === null ? 1000 / 60 : Math.max(0, nowMs - lastMs),
        );
        lastMs = nowMs;
        velocity = frame.velocity;
        dx += frame.distance;
        const q = scrubBy(startQ, dx);
        if (
          Math.abs(velocity) < MIN_FLING_VELOCITY ||
          Math.abs(q - lastQ) < 1e-9
        ) {
          flingFrame = null;
          settle();
          return;
        }
        lastQ = q;
        flingFrame = window.requestAnimationFrame(step);
      };
      flingFrame = window.requestAnimationFrame(step);
    };
    // Ends the finger's swipe. Lifted (`release`), a scrub flings on and a
    // tap on the ruler seeks to it.
    const endSwipe = (release?: Touch) => {
      const ended = swipe;
      swipe = null;
      if (!ended) {
        return;
      }
      if (ended.sideways) {
        const velocity = release
          ? flingVelocity([
              ...ended.samples,
              { x: release.clientX, timeMs: performance.now() },
            ])
          : 0;
        if (Math.abs(velocity) >= MIN_FLING_VELOCITY) {
          fling(ended.startQ, ended.dx, velocity);
        } else {
          settle();
        }
        return;
      }
      if (release && ended.onRuler && !ended.stoppedFling) {
        const { labelWidth, quarterPx } = geometryRef.current;
        const { totalQuarters, seekTo } = seekRef.current;
        seekTo(
          clamp(
            pointerToTimelineQ(
              getTimelinePointerX(scroll, release.clientX),
              scroll.scrollLeft,
              labelWidth,
              quarterPx,
            ),
            0,
            totalQuarters,
          ),
        );
      }
    };
    const handleTouchStart = (event: TouchEvent) => {
      const stoppedFling = stopFling();
      if (event.touches.length === 2) {
        endSwipe();
        pinch = {
          distance: fingerDistance(event.touches),
          zoom: zoomRef.current.resolvedZoom,
        };
        return;
      }
      if (event.touches.length !== 1) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const onRuler = Boolean(
        target?.closest(RULER) && !target.closest(LOOP_STRIP),
      );
      if (
        onRuler ||
        (scroll.scrollLeft < 0.5 && allowsPanX(event.target, scroll))
      ) {
        const touch = event.touches[0];
        swipe = {
          x: touch.clientX,
          y: touch.clientY,
          dx: 0,
          startQ: playheadSignal.get(),
          startMs: performance.now(),
          sideways: false,
          onRuler,
          stoppedFling,
          samples: [{ x: touch.clientX, timeMs: performance.now() }],
        };
      }
    };
    // A sideways swipe on the ruler or from the start: the timeline
    // follows the finger, as a scroll does, as though it could scroll
    // before 0, so from the start the playhead moves to the center first
    // and the timeline scrolls after.
    const scrubSwipe = (touch: Touch) => {
      if (!swipe) {
        return;
      }
      const dx = touch.clientX - swipe.x;
      const dy = touch.clientY - swipe.y;
      swipe.samples.push({ x: touch.clientX, timeMs: performance.now() });
      if (swipe.samples.length > MAX_FINGER_SAMPLES) {
        swipe.samples.shift();
      }
      if (!swipe.sideways) {
        if (!exceedsTouchSlop(dx, dy)) {
          return;
        }
        // A hold picked up a clip or started a selection instead
        // (useTouchClipGestures), or the finger pans vertically. The ruler
        // only scrubs.
        if (
          !swipe.onRuler &&
          (performance.now() - swipe.startMs >= LONG_PRESS_MS ||
            Math.abs(dy) >= Math.abs(dx))
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
      swipe.dx = dx;
      scrubBy(swipe.startQ, dx);
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
        endSwipe(
          event.type === "touchend" ? event.changedTouches[0] : undefined,
        );
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
      if (flingFrame !== null) {
        window.cancelAnimationFrame(flingFrame);
      }
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
