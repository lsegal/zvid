import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
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
  // The ruler, layers and source tracks, top to bottom.
  children: ReactNode;
  // The Audio row, docked under the rows at the bottom of the panel.
  footer: ReactNode;
};

// The timeline panel: its scroll container and grid, with the track label
// resize rail, the playhead line and the buttons that bring an off-screen
// playhead into view, and under it a footer that stays at the panel's bottom.
// Only the rows above the footer scroll vertically; the footer follows their
// horizontal scroll and zoom, so its waveform and playhead line up with them.
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
  footer,
}: TimelineProps) {
  const { labelWidth } = labelResize;
  const footerRef = useRef<HTMLDivElement>(null);
  const playheadTimelinePx = Math.round(playheadQ * quarterPx);
  const isPlayheadOffscreenLeft =
    visibleTimelineWidthPx > 0 && playheadTimelinePx < visibleTimelineStartPx;
  const isPlayheadOffscreenRight =
    visibleTimelineWidthPx > 0 && playheadTimelinePx > visibleTimelineEndPx;

  // The footer can't be scrolled by hand (it would leave the rows behind):
  // it takes the rows' horizontal scroll, and a gutter as wide as their
  // vertical scrollbar so it can reach their scroll end.
  const syncFooterScroll = () => {
    const scroll = timelineScrollRef.current;
    const footer = footerRef.current;
    if (!scroll || !footer) {
      return;
    }
    footer.style.setProperty(
      "--timeline-scrollbar-width",
      `${scroll.offsetWidth - scroll.clientWidth}px`,
    );
    footer.scrollLeft = scroll.scrollLeft;
  };
  useLayoutEffect(syncFooterScroll);

  // A wheel over the footer scrolls the rows sideways, which scrolls it too.
  useEffect(() => {
    const footer = footerRef.current;
    if (!footer) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      const scroll = timelineScrollRef.current;
      const deltaX =
        event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
      if (!scroll || event.ctrlKey || !deltaX) {
        return;
      }
      event.preventDefault();
      scroll.scrollLeft +=
        event.deltaMode === WheelEvent.DOM_DELTA_LINE ? deltaX * 16 : deltaX;
    };
    footer.addEventListener("wheel", handleWheel, { passive: false });
    return () => footer.removeEventListener("wheel", handleWheel);
  }, [timelineScrollRef]);

  return (
    <div
      className="timeline-panel"
      style={{ ["--label-width" as string]: `${labelWidth}px` }}
    >
      <div
        ref={timelineScrollRef}
        className={`timeline-scroll ${
          timelineDragScroll.isGrabbing ? "is-grab-panning" : ""
        }`}
        {...timelineDragScroll.handlers}
        onScroll={() => {
          syncTimelineViewport();
          syncFooterScroll();
        }}
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
      <div ref={footerRef} className="timeline-footer">
        <div
          className={`timeline-footer__canvas ${labelWidth < LABEL_WIDTH_NARROW ? "timeline-canvas--narrow-labels" : ""}`}
          style={{
            width: `calc(${labelWidth + timelineWidth}px + var(--timeline-scrollbar-width, 0px))`,
          }}
        >
          {footer}
        </div>
      </div>
    </div>
  );
}
