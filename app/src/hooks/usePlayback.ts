import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
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
  getClipEndQ,
  getPlaybackStopQ,
  secondsToQuarters,
} from "../app/timeline-math.ts";
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
  const timelineScrubAudioTimeoutRef = useRef<number | null>(null);

  const startPlayback = useCallback(
    (fromQ: number = playheadQRef.current) => {
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
    [
      bpm,
      playbackOriginRef,
      playheadQRef,
      projectMediaItems,
      setIsPlaying,
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
      setPlayheadQ(nextPlayheadQ);
      playbackOriginRef.current = nextPlayheadQ;
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
    };
  }, [
    labelWidth,
    playbackOriginRef,
    pulseTimelineAudibleScrub,
    setPlayheadQ,
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
    const startedAt = performance.now();
    const originQ = playbackOriginRef.current;
    const stopQ = playbackStopRef.current || totalQuarters;
    const findNextEdgeQ = (fromQ: number) =>
      findNextClipEdgeQ(
        timelineClipsRef.current.map((clip) => ({
          startQ: clip.startQ,
          endQ: getClipEndQ(clip, bpm),
        })),
        fromQ,
      );
    let committedAt = startedAt;
    let nextEdgeQ = findNextEdgeQ(originQ);

    const step = (timestamp: number) => {
      const elapsed = (timestamp - startedAt) / 1000;
      const nextQ = originQ + secondsToQuarters(elapsed, bpm);

      if (nextQ >= stopQ) {
        setPlayheadQ(stopQ);
        playbackOriginRef.current = stopQ;
        setIsPlaying(false);
        return;
      }

      // Everything drawn per frame follows the signal; state only has to
      // keep up with the clip under the playhead and other coarse readouts.
      playheadQRef.current = nextQ;
      playheadSignal.set(nextQ);
      if (
        nextQ >= nextEdgeQ ||
        timestamp - committedAt >= PLAYBACK_COMMIT_INTERVAL_MS
      ) {
        setPlayheadQState(nextQ);
        committedAt = timestamp;
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
    timelineClipsRef,
    totalQuarters,
  ]);

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
    const next = clamp(
      playheadQRef.current + deltaBars * barLength,
      0,
      totalQuarters,
    );
    setPlayheadQ(next);
    playbackOriginRef.current = next;
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
  };
}
