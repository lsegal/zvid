import type { Dispatch, RefObject, SetStateAction } from "react";
import { TIMELINE_PLAYBACK_SCRUB_AUDIO_IDLE_MS } from "../../app/constants.ts";
import type { getShortcutLabels } from "../../app/shortcut-labels.ts";
import { quartersToSeconds } from "../../app/timeline-math.ts";
import type { TimelineDragState, TimelineMode } from "../../app/types.ts";
import { clamp, pluralize } from "../../app/util.ts";
import { isRulerPanPress } from "../../drag-scroll.ts";
import type { useRulerGestures } from "../../hooks/useRulerGestures.ts";
import type { useTimelineViewport } from "../../hooks/useTimelineViewport.ts";
import type { PlayheadSignal } from "../../playhead-signal";
import { formatTimecode } from "../../timeline-format.ts";
import { PlayheadLine } from "../LivePlayhead";

type TimelineViewportModel = ReturnType<typeof useTimelineViewport>;

type RulerProps = {
  rulerDragScroll: ReturnType<typeof useRulerGestures>["rulerDragScroll"];
  sessionName: string | null;
  mediaSyncStatusLabel: string | null;
  offlineCount: number;
  showsMediaSync: boolean;
  relinkingMediaIds: ReadonlySet<string>;
  sessionMediaStatus: string;
  setIsMediaSyncDialogOpen: (open: boolean) => void;
  setIsOfflineMediaDialogOpen: (open: boolean) => void;
  timelineScrollRef: RefObject<HTMLDivElement | null>;
  shortcutLabels: ReturnType<typeof getShortcutLabels>;
  timelineDragState: TimelineDragState | null;
  setTimelineDragState: Dispatch<SetStateAction<TimelineDragState | null>>;
  isPlaying: boolean;
  setIsPlaying: (isPlaying: boolean) => void;
  pulseTimelineAudibleScrub: (durationMs?: number) => void;
  stopTimelineAudibleScrub: () => void;
  setPlayheadQ: (nextPlayheadQ: number) => void;
  playbackOriginRef: { current: number };
  playheadSignal: PlayheadSignal;
  labelWidth: number;
  quarterPx: number;
  totalQuarters: number;
  resolvedZoom: number;
  gridStyle: TimelineViewportModel["gridStyle"];
  rulerBars: TimelineViewportModel["rulerBars"];
  rulerLabelBarStep: number;
  timelineMode: TimelineMode;
  bpm: number;
  fps: number;
};

// The ruler row: the session's media status in its label, and the bars and
// playhead marker above the layers. Pressing the ruler scrubs the playhead.
export function Ruler({
  rulerDragScroll,
  sessionName,
  mediaSyncStatusLabel,
  offlineCount,
  showsMediaSync,
  relinkingMediaIds,
  sessionMediaStatus,
  setIsMediaSyncDialogOpen,
  setIsOfflineMediaDialogOpen,
  timelineScrollRef,
  shortcutLabels,
  timelineDragState,
  setTimelineDragState,
  isPlaying,
  setIsPlaying,
  pulseTimelineAudibleScrub,
  stopTimelineAudibleScrub,
  setPlayheadQ,
  playbackOriginRef,
  playheadSignal,
  labelWidth,
  quarterPx,
  totalQuarters,
  resolvedZoom,
  gridStyle,
  rulerBars,
  rulerLabelBarStep,
  timelineMode,
  bpm,
  fps,
}: RulerProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hand-grab panning is a pointer shortcut; the timeline scrolls from the keyboard and wheel as usual
    <section
      className={`ruler-row ${
        rulerDragScroll.isGrabbing ? "is-grab-panning" : ""
      }`}
      {...rulerDragScroll.handlers}
      onContextMenu={(event) => {
        // The ruler has no menu of its own, so the browser's
        // never shows, with or without a pan.
        event.preventDefault();
        rulerDragScroll.onContextMenu(event);
      }}
    >
      <div className="track-label track-label--header">
        <div>
          <span>{sessionName ?? "Session"}</span>
          {mediaSyncStatusLabel ? (
            <button
              aria-live="polite"
              className="track-label__offline track-label__offline--syncing"
              onClick={() => setIsMediaSyncDialogOpen(true)}
              title="Show media sync status"
              type="button"
            >
              <span aria-hidden="true" className="offline-media__spinner" />
              {mediaSyncStatusLabel}
            </button>
          ) : offlineCount ? (
            <button
              className="track-label__offline"
              onClick={() =>
                showsMediaSync
                  ? setIsMediaSyncDialogOpen(true)
                  : setIsOfflineMediaDialogOpen(true)
              }
              title="Review and locate offline media"
              type="button"
            >
              {relinkingMediaIds.size ? (
                <>
                  <span aria-hidden="true" className="offline-media__spinner" />
                  Linking {pluralize(relinkingMediaIds.size, "file")}…
                </>
              ) : (
                pluralize(offlineCount, "offline media file")
              )}
            </button>
          ) : (
            <small>{sessionMediaStatus}</small>
          )}
        </div>
      </div>
      <div
        className={`ruler-row__content ruler-row__content--interactive ${
          timelineDragState ? "is-dragging" : ""
        }`}
        onPointerDown={(event) => {
          const timelineScroll = timelineScrollRef.current;
          // Only the primary button scrubs; the others pan the
          // timeline through the ruler row.
          if (
            !timelineScroll ||
            event.button !== 0 ||
            isRulerPanPress(event, shortcutLabels.mac)
          ) {
            return;
          }

          event.preventDefault();
          if (isPlaying) {
            // Batched with setIsPlaying so the audio keeps
            // running from the clicked position.
            pulseTimelineAudibleScrub(TIMELINE_PLAYBACK_SCRUB_AUDIO_IDLE_MS);
          } else {
            stopTimelineAudibleScrub();
          }
          setIsPlaying(false);

          const timelineBounds = timelineScroll.getBoundingClientRect();
          const pointerX = event.clientX - timelineBounds.left;
          const nextPlayheadQ = clamp(
            (timelineScroll.scrollLeft - labelWidth + pointerX) / quarterPx,
            0,
            totalQuarters,
          );

          setPlayheadQ(nextPlayheadQ);
          playbackOriginRef.current = nextPlayheadQ;
          setTimelineDragState({
            pointerId: event.pointerId,
            pointerStartX: event.clientX,
            originPlayheadQ: nextPlayheadQ,
            originZoom: resolvedZoom,
            wasPlaying: isPlaying,
          });
        }}
        style={gridStyle}
      >
        <PlayheadLine
          className="timeline-playhead-marker"
          signal={playheadSignal}
          quarterPx={quarterPx}
          offsetPx={-1}
        />
        {rulerBars.map((bar) => (
          <div
            key={bar.index}
            className="ruler-marker"
            style={{ left: bar.quarter * quarterPx }}
          >
            {bar.index % rulerLabelBarStep === 0 ? (
              <span>
                {timelineMode === "musical"
                  ? `${bar.index + 1}`
                  : formatTimecode(quartersToSeconds(bar.quarter, bpm), fps)}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
