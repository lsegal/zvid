import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import {
  BASE_QUARTER_PX,
  TIMELINE_PLAYBACK_SCRUB_AUDIO_IDLE_MS,
  TIMELINE_SCRUB_AUDIO_TAIL_MS,
} from "../app/constants.ts";
import {
  isBeforeLoopEnd,
  loopPlaybackStartQ,
  wrapLoopPlaybackQ,
} from "../app/loop-playback.ts";
import type { LoopRegion } from "../app/loop-region.ts";
import {
  getClipEndQ,
  getPlaybackRange,
  getPlaybackStopQ,
  secondsToQuarters,
} from "../app/timeline-math.ts";
import { type SkipDirection, skipTarget } from "../app/transport-skip.ts";
import type {
  ArrangementClip,
  TimelineDragState,
  TimelineSelection,
} from "../app/types.ts";
import { clamp } from "../app/util.ts";
import { revealScrollLeft } from "../clip-jump.ts";
import type { MediaItem } from "../media";
import {
  findNextClipEdgeQ,
  PLAYBACK_COMMIT_INTERVAL_MS,
  type PlayheadSignal,
} from "../playhead-signal";
import { scrubScrollLeft } from "../scrub-scroll.ts";

export type PlaybackInputs = {
  playbackOriginRef: { current: number };
  // What the compositor draws (see resolveRenderClips): the layer clips, or
  // the source tracks when there are none.
  clips: ArrangementClip[];
  timelineClips: ArrangementClip[];
  timelineClipsRef: { current: ArrangementClip[] };
  projectMediaItems: MediaItem[];
  bpm: number;
  barLength: number;
  quarterPx: number;
  totalQuarters: number;
  // Playback loops between its in and out markers.
  loopRegion: LoopRegion | null;
  labelWidth: number;
  timelineScrollRef: RefObject<HTMLDivElement | null>;
  isPlaying: boolean;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  timelineDragState: TimelineDragState | null;
  setTimelineDragState: Dispatch<SetStateAction<TimelineDragState | null>>;
  playheadQRef: { current: number };
  playheadSignal: PlayheadSignal;
  setPlayheadQ: (nextQ: number) => void;
  setPlayheadQState: Dispatch<SetStateAction<number>>;
  setPendingSelection: Dispatch<SetStateAction<TimelineSelection | null>>;
  setSelectedClipId: Dispatch<SetStateAction<string | undefined>>;
  setStatus: (status: string) => void;
};

// The transport: starting and stopping playback, the playback loop, jumping
// the playhead, and the audible scrub while the ruler is dragged.
export function usePlayback({
  playbackOriginRef,
  clips,
  timelineClips,
  timelineClipsRef,
  projectMediaItems,
  bpm,
  barLength,
  quarterPx,
  totalQuarters,
  loopRegion,
  labelWidth,
  timelineScrollRef,
  isPlaying,
  setIsPlaying,
  timelineDragState,
  setTimelineDragState,
  playheadQRef,
  playheadSignal,
  setPlayheadQ,
  setPlayheadQState,
  setPendingSelection,
  setSelectedClipId,
  setStatus,
}: PlaybackInputs) {
  const [isTimelineAudibleScrubbing, setIsTimelineAudibleScrubbing] =
    useState(false);
  const playbackStopRef = useRef(0);
  // Open-ended playback, as while recording, ignores the loop.
  const playbackOpenRef = useRef(false);
  // Read by the playback loop, so editing or deleting the loop during
  // playback takes effect right away.
  const loopRegionRef = useRef(loopRegion);
  loopRegionRef.current = loopRegion;
  // Read by the playback loop, so a timeline growing during playback (as a
  // recording does) doesn't restart it.
  const totalQuartersRef = useRef(totalQuarters);
  totalQuartersRef.current = totalQuarters;
  const timelineScrubAudioTimeoutRef = useRef<number | null>(null);
  // The clips the compositor draws, whose edges the playback loop commits
  // the playhead at.
  const renderClipsRef = useRef(timelineClips);
  renderClipsRef.current = timelineClips;

  // Playback stops after the last playable clip, or with `open`, as when
  // recording, only when stopped; `open` during playback lets it run on from
  // where it is. With nothing playable after `fromQ`, it starts over from the
  // start. Play at or past a loop's out marker starts from its in marker.
  const startPlayback = useCallback(
    (fromQ?: number, options?: { open?: boolean }) => {
      playbackOpenRef.current = Boolean(options?.open);
      if (options?.open) {
        fromQ ??= playheadQRef.current;
        playbackStopRef.current = Number.POSITIVE_INFINITY;
        if (!isPlaying) {
          playbackOriginRef.current = fromQ;
          setIsPlaying(true);
        }
        return;
      }
      const loop = loopRegionRef.current;
      fromQ ??= loopPlaybackStartQ(playheadQRef.current, loop);
      const range = getPlaybackRange(
        timelineClips,
        projectMediaItems,
        fromQ,
        bpm,
      );
      if (!range) {
        setStatus("No playable source clips on the timeline.");
        return;
      }

      // Play at the end restarts from the start, but playback headed for a
      // loop's out marker starts where it is, even with nothing left to play.
      const { startQ, stopQ } = isBeforeLoopEnd(fromQ, loop)
        ? {
            startQ: fromQ,
            stopQ: getPlaybackStopQ(
              timelineClips,
              projectMediaItems,
              fromQ,
              bpm,
            ),
          }
        : range;
      if (startQ !== fromQ) {
        setPlayheadQ(startQ);
      }
      playbackOriginRef.current = startQ;
      playbackStopRef.current = stopQ;
      setIsPlaying(true);
    },
    [
      bpm,
      isPlaying,
      playbackOriginRef,
      playheadQRef,
      projectMediaItems,
      setIsPlaying,
      setPlayheadQ,
      setStatus,
      timelineClips,
    ],
  );

  // An explicit transport action during a ruler scrub decides the state after
  // release, so drop the pending resume.
  const cancelScrubPlaybackResume = useCallback(() => {
    setTimelineDragState((current) =>
      current?.wasPlaying ? { ...current, wasPlaying: false } : current,
    );
  }, [setTimelineDragState]);

  // Moves the playhead to `startQ`, scrolled into view. Playback carries on
  // from there.
  const jumpPlayheadTo = useCallback(
    (startQ: number) => {
      setPlayheadQ(startQ);
      playbackOriginRef.current = startQ;
      if (isPlaying) {
        // The playback loop only restarts from the new origin when it stops
        // first, so the pause commits before playback starts again.
        cancelScrubPlaybackResume();
        flushSync(() => setIsPlaying(false));
        startPlayback(startQ);
      }

      const timelineScroll = timelineScrollRef.current;
      if (timelineScroll) {
        const nextScrollLeft = revealScrollLeft({
          targetPx: labelWidth + startQ * quarterPx,
          scrollLeft: timelineScroll.scrollLeft,
          viewportWidth: timelineScroll.clientWidth,
          labelWidth,
          maxScrollLeft:
            timelineScroll.scrollWidth - timelineScroll.clientWidth,
        });
        if (nextScrollLeft !== timelineScroll.scrollLeft) {
          timelineScroll.scrollTo({ left: nextScrollLeft, behavior: "smooth" });
        }
      }
    },
    [
      cancelScrubPlaybackResume,
      isPlaying,
      labelWidth,
      playbackOriginRef,
      quarterPx,
      setIsPlaying,
      setPlayheadQ,
      startPlayback,
      timelineScrollRef,
    ],
  );

  // Ctrl/Cmd-click on an arrangement clip: select it and move the playhead to
  // its start.
  const jumpToClipStart = useCallback(
    (clipId: string) => {
      const clip = timelineClipsRef.current.find(
        (candidate) => candidate.id === clipId,
      );
      if (!clip) {
        return;
      }

      setPendingSelection(null);
      setSelectedClipId(clip.id);
      jumpPlayheadTo(clip.startQ);
    },
    [jumpPlayheadTo, setPendingSelection, setSelectedClipId, timelineClipsRef],
  );

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

  useEffect(
    () => () => {
      stopTimelineAudibleScrub();
    },
    [stopTimelineAudibleScrub],
  );

  useEffect(() => {
    if (!timelineDragState) {
      return;
    }

    let lastClientX = timelineDragState.pointerStartX;
    let committedAt = performance.now();
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== timelineDragState.pointerId) {
        return;
      }

      const timelineScroll = timelineScrollRef.current;
      if (!timelineScroll) {
        return;
      }

      // A left drag only scrubs; zooming is a right-drag on the ruler.
      const nextQuarterPx = BASE_QUARTER_PX * timelineDragState.originZoom;
      const deltaX = event.clientX - timelineDragState.pointerStartX;
      const nextPlayheadQ = clamp(
        timelineDragState.originPlayheadQ + deltaX / nextQuarterPx,
        0,
        totalQuarters,
      );
      const timelineBounds = timelineScroll.getBoundingClientRect();
      const maxScrollLeft = Math.max(
        0,
        labelWidth + totalQuarters * nextQuarterPx - timelineScroll.clientWidth,
      );

      timelineScroll.scrollLeft = scrubScrollLeft({
        playheadPx: labelWidth + nextPlayheadQ * nextQuarterPx,
        pointerX: event.clientX - timelineBounds.left,
        deltaX: event.clientX - lastClientX,
        scrollLeft: timelineScroll.scrollLeft,
        viewportWidth: timelineScroll.clientWidth,
        labelWidth,
        maxScrollLeft,
      });
      lastClientX = event.clientX;
      pulseTimelineAudibleScrub(
        timelineDragState.wasPlaying
          ? TIMELINE_PLAYBACK_SCRUB_AUDIO_IDLE_MS
          : TIMELINE_SCRUB_AUDIO_TAIL_MS,
      );
      // Scrubbing moves the live playhead, which the preview and readouts
      // follow, and commits it to state only now and then.
      playheadQRef.current = nextPlayheadQ;
      playheadSignal.set(nextPlayheadQ);
      playbackOriginRef.current = nextPlayheadQ;
      if (performance.now() - committedAt >= PLAYBACK_COMMIT_INTERVAL_MS) {
        setPlayheadQState(nextPlayheadQ);
        committedAt = performance.now();
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== timelineDragState.pointerId) {
        return;
      }

      stopTimelineAudibleScrub();
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
      setPlayheadQState(playheadQRef.current);
    };
  }, [
    labelWidth,
    playbackOriginRef,
    playheadQRef,
    playheadSignal,
    pulseTimelineAudibleScrub,
    setPlayheadQState,
    setTimelineDragState,
    startPlayback,
    stopTimelineAudibleScrub,
    timelineDragState,
    timelineScrollRef,
    totalQuarters,
  ]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    let animationFrame = 0;
    // A loop wrap restarts the clock from the in marker.
    let startedAt = performance.now();
    let originQ = playbackOriginRef.current;
    let previousQ = originQ;
    const findNextEdgeQ = (fromQ: number) =>
      findNextClipEdgeQ(
        renderClipsRef.current.map((clip) => ({
          startQ: clip.startQ,
          endQ: getClipEndQ(clip, bpm),
        })),
        fromQ,
      );
    let nextEdgeQ = findNextEdgeQ(originQ);

    const step = (timestamp: number) => {
      const elapsed = (timestamp - startedAt) / 1000;
      let nextQ = originQ + secondsToQuarters(elapsed, bpm);
      const stopQ = playbackStopRef.current || totalQuartersRef.current;
      const loop = playbackOpenRef.current ? null : loopRegionRef.current;

      // Reaching the out marker jumps back to the in marker. The player and
      // the audio mix take a playhead that far off as a seek, as when the
      // playhead is moved during playback.
      const wrappedQ = wrapLoopPlaybackQ(previousQ, nextQ, loop);
      if (wrappedQ !== undefined) {
        nextQ = wrappedQ;
        originQ = wrappedQ;
        startedAt = timestamp;
        playbackOriginRef.current = wrappedQ;
        setPlayheadQ(wrappedQ);
        nextEdgeQ = findNextEdgeQ(wrappedQ);
      } else if (nextQ >= stopQ && !isBeforeLoopEnd(nextQ, loop)) {
        // A loop deleted past the last clip stops where the playhead is.
        const endQ = Math.max(stopQ, previousQ);
        setPlayheadQ(endQ);
        playbackOriginRef.current = endQ;
        setIsPlaying(false);
        return;
      }
      previousQ = nextQ;

      // Everything drawn per frame follows the signal; state only has to
      // keep up with the clips under the playhead, so it is committed only
      // when they change, at a clip edge.
      playheadQRef.current = nextQ;
      playheadSignal.set(nextQ);
      if (nextQ >= nextEdgeQ) {
        setPlayheadQState(nextQ);
        nextEdgeQ = findNextEdgeQ(nextQ);
      }
      animationFrame = window.requestAnimationFrame(step);
    };

    animationFrame = window.requestAnimationFrame(step);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      // Leave state where playback stopped, or where a seek batched with the
      // pause moved the live playhead.
      setPlayheadQState(playheadQRef.current);
    };
  }, [
    bpm,
    isPlaying,
    playbackOriginRef,
    playheadQRef,
    playheadSignal,
    setIsPlaying,
    setPlayheadQ,
    setPlayheadQState,
  ]);

  async function handleTransportToggle() {
    // Playback with nothing to play, as while recording, can still stop.
    if (isPlaying) {
      cancelScrubPlaybackResume();
      setIsPlaying(false);
      return;
    }
    if (!clips.length) {
      return;
    }

    cancelScrubPlaybackResume();

    startPlayback();
  }

  function jumpPlayhead(deltaBars: number) {
    const next = clamp(
      playheadQRef.current + deltaBars * barLength,
      0,
      totalQuarters,
    );
    setPlayheadQ(next);
    playbackOriginRef.current = next;
  }

  // Where playback from the start stops: the end the skip-forward button
  // jumps to.
  const playbackEndQ = useMemo(
    () => getPlaybackStopQ(timelineClips, projectMediaItems, 0, bpm),
    [bpm, projectMediaItems, timelineClips],
  );

  // The outer skip buttons: to the loop's markers or the timeline's ends.
  function skipToEdge(direction: SkipDirection) {
    const { targetQ } = skipTarget(
      direction,
      playheadQRef.current,
      loopRegionRef.current,
      playbackEndQ,
    );
    jumpPlayheadTo(targetQ);
  }

  return {
    // How many clips playback can play; Space does nothing without any.
    playableClipCount: clips.length,
    isTimelineAudibleScrubbing,
    startPlayback,
    cancelScrubPlaybackResume,
    jumpPlayheadTo,
    jumpToClipStart,
    stopTimelineAudibleScrub,
    pulseTimelineAudibleScrub,
    handleTransportToggle,
    jumpPlayhead,
    playbackEndQ,
    skipToEdge,
  };
}
