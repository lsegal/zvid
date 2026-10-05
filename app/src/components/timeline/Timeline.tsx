import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  LABEL_WIDTH_DEFAULT,
  LABEL_WIDTH_MAX,
  LABEL_WIDTH_MIN,
  LABEL_WIDTH_NARROW,
} from "../../app/constants.ts";
import type { LoopRegion } from "../../app/loop-region.ts";
import type { useLabelResize } from "../../hooks/useLabelResize.ts";
import type { useRulerGestures } from "../../hooks/useRulerGestures.ts";
import type { PlayheadSignal } from "../../playhead-signal";
import { PlayheadLine } from "../LivePlayhead";
import { LoopOverlay } from "./LoopOverlay";
import "./timeline.css";

type TimelineProps = {
  timelineScrollRef: RefObject<HTMLDivElement | null>;
  timelineDragScroll: ReturnType<typeof useRulerGestures>["timelineDragScroll"];
  labelResize: ReturnType<typeof useLabelResize>;
  playheadSignal: PlayheadSignal;
  quarterPx: number;
  loopRegion: LoopRegion | null;
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
// resize rail, the loop overlay, the playhead line and the buttons that bring an off-screen
// playhead into view, and under it a footer that stays at the panel's bottom.
// Only the rows above the footer scroll vertically; the footer follows their
// horizontal scroll and zoom, so its waveform and playhead line up with them.
export function Timeline({
  timelineScrollRef,
  timelineDragScroll,
  labelResize,
  playheadSignal,
  quarterPx,
  loopRegion,
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
  const syncFooterScrollRef = useRef(syncFooterScroll);
  syncFooterScrollRef.current = syncFooterScroll;
  // Besides on scroll, the footer follows the rows when they resize, which
  // can show or hide their scrollbar, and when their width changes.
  useLayoutEffect(() => {
    void [labelWidth, timelineWidth];
    syncFooterScrollRef.current();
  }, [labelWidth, timelineWidth]);
  useEffect(() => {
    const scroll = timelineScrollRef.current;
    if (!scroll) {
      return;
    }
    const observer = new ResizeObserver(() => syncFooterScrollRef.current());
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [timelineScrollRef]);

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
          <PlayheadJumpButton
            playheadSignal={playheadSignal}
            quarterPx={quarterPx}
            visibleTimelineStartPx={visibleTimelineStartPx}
            visibleTimelineWidthPx={visibleTimelineWidthPx}
            visibleTimelineEndPx={visibleTimelineEndPx}
            scrollTimelineToPlayhead={scrollTimelineToPlayhead}
          />
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
          <LoopOverlay
            className="timeline-loop"
            loopRegion={loopRegion}
            quarterPx={quarterPx}
            // Past the rows' 1px left border, where their clips and the
            // ruler's loop brace start.
            offsetPx={labelWidth + 1}
          />
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

// The button that brings an off-screen playhead into view, on the side it
// is off. It follows the playhead signal, so it only re-renders when the
// playhead crosses an edge of the view.
function PlayheadJumpButton({
  playheadSignal,
  quarterPx,
  visibleTimelineStartPx,
  visibleTimelineWidthPx,
  visibleTimelineEndPx,
  scrollTimelineToPlayhead,
}: {
  playheadSignal: PlayheadSignal;
  quarterPx: number;
  visibleTimelineStartPx: number;
  visibleTimelineWidthPx: number;
  visibleTimelineEndPx: number;
  scrollTimelineToPlayhead: () => void;
}) {
  const side = useSyncExternalStore(playheadSignal.subscribe, () => {
    const playheadTimelinePx = Math.round(playheadSignal.get() * quarterPx);
    if (visibleTimelineWidthPx <= 0) {
      return null;
    }
    if (playheadTimelinePx < visibleTimelineStartPx) {
      return "left";
    }
    return playheadTimelinePx > visibleTimelineEndPx ? "right" : null;
  });
  if (!side) {
    return null;
  }
  return (
    <button
      className={`playhead-jump playhead-jump--${side}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        scrollTimelineToPlayhead();
      }}
      type="button"
    >
      {side === "left" ? "<<" : ">>"}
    </button>
  );
}
