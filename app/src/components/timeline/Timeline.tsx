import type { ReactNode, RefObject } from "react";
import {
  LABEL_WIDTH_DEFAULT,
  LABEL_WIDTH_MAX,
  LABEL_WIDTH_MIN,
  LABEL_WIDTH_NARROW,
} from "../../app/constants.ts";
import type { useLabelResize } from "../../hooks/useLabelResize.ts";
import type { useRulerGestures } from "../../hooks/useRulerGestures.ts";
import type { PlayheadSignal } from "../../playhead-signal";
import { PlayheadLine } from "../LivePlayhead";
import "./timeline.css";

type TimelineProps = {
  timelineScrollRef: RefObject<HTMLDivElement | null>;
  timelineDragScroll: ReturnType<typeof useRulerGestures>["timelineDragScroll"];
  labelResize: ReturnType<typeof useLabelResize>;
  playheadQ: number;
  playheadSignal: PlayheadSignal;
  quarterPx: number;
  timelineWidth: number;
  visibleTimelineStartPx: number;
  visibleTimelineWidthPx: number;
  visibleTimelineEndPx: number;
  syncTimelineViewport: () => void;
  scrollTimelineToPlayhead: () => void;
  // The ruler, layers, Audio row and source tracks, top to bottom.
  children: ReactNode;
};

// The timeline's scroll container and grid: the track label resize rail, the
// playhead line and the buttons that bring an off-screen playhead into view.
export function Timeline({
  timelineScrollRef,
  timelineDragScroll,
  labelResize,
  playheadQ,
  playheadSignal,
  quarterPx,
  timelineWidth,
  visibleTimelineStartPx,
  visibleTimelineWidthPx,
  visibleTimelineEndPx,
  syncTimelineViewport,
  scrollTimelineToPlayhead,
  children,
}: TimelineProps) {
  const { labelWidth } = labelResize;
  const playheadTimelinePx = Math.round(playheadQ * quarterPx);
  const isPlayheadOffscreenLeft =
    visibleTimelineWidthPx > 0 && playheadTimelinePx < visibleTimelineStartPx;
  const isPlayheadOffscreenRight =
    visibleTimelineWidthPx > 0 && playheadTimelinePx > visibleTimelineEndPx;

  return (
    <div
      ref={timelineScrollRef}
      className={`timeline-scroll ${
        timelineDragScroll.isGrabbing ? "is-grab-panning" : ""
      }`}
      {...timelineDragScroll.handlers}
      onScroll={() => syncTimelineViewport()}
      style={{ ["--label-width" as string]: `${labelWidth}px` }}
    >
      <div className="timeline-jump-overlay">
        {isPlayheadOffscreenLeft ? (
          <button
            className="playhead-jump playhead-jump--left"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              scrollTimelineToPlayhead();
            }}
            type="button"
          >
            {"<<"}
          </button>
        ) : null}
        {isPlayheadOffscreenRight ? (
          <button
            className="playhead-jump playhead-jump--right"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              scrollTimelineToPlayhead();
            }}
            type="button"
          >
            {">>"}
          </button>
        ) : null}
      </div>
      <div
        className={`timeline-canvas ${labelWidth < LABEL_WIDTH_NARROW ? "timeline-canvas--narrow-labels" : ""}`}
        style={{
          width: labelWidth + timelineWidth,
          ["--label-width" as string]: `${labelWidth}px`,
        }}
      >
        <div className="label-resize-rail">
          <hr
            className="label-resize-handle"
            aria-orientation="vertical"
            aria-label="Resize track labels"
            aria-valuenow={labelWidth}
            aria-valuemin={LABEL_WIDTH_MIN}
            aria-valuemax={LABEL_WIDTH_MAX}
            tabIndex={0}
            title="Drag to resize. Double-click to reset."
            onPointerDown={labelResize.handleLabelResizePointerDown}
            onPointerMove={labelResize.handleLabelResizePointerMove}
            onPointerUp={labelResize.handleLabelResizePointerEnd}
            onPointerCancel={labelResize.handleLabelResizePointerEnd}
            onDoubleClick={() =>
              labelResize.commitLabelWidth(LABEL_WIDTH_DEFAULT)
            }
            onKeyDown={labelResize.handleLabelResizeKeyDown}
          />
        </div>
        <PlayheadLine
          className="timeline-playhead"
          signal={playheadSignal}
          quarterPx={quarterPx}
          offsetPx={labelWidth}
        />

        {children}
      </div>
    </div>
  );
}
