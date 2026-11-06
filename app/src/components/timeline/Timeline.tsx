import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { LABEL_WIDTH_NARROW } from "../../app/constants.ts";
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
// The footer stays at the bottom of the view while the rows scroll under it
// vertically, and scrolls sideways with them as part of the same content, so
// its waveform, loop and playhead line up with theirs.
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
  const { labelWidth, limits } = labelResize;
  const footerRef = useRef<HTMLDivElement>(null);

  // The footer sits in the rows' scroll content, stuck to the bottom of the
  // view, so it scrolls sideways with them in the same frame (a separate
  // scroller copying their scrollLeft lagged them, and its playhead drifted
  // from theirs, #1509). Rows scrolled into view stop above it.
  useEffect(() => {
    const scroll = timelineScrollRef.current;
    const footer = footerRef.current;
    if (!scroll || !footer) {
      return;
    }
    const observer = new ResizeObserver(() =>
      scroll.style.setProperty(
        "--timeline-footer-height",
        `${footer.offsetHeight}px`,
      ),
    );
    observer.observe(footer);
    return () => observer.disconnect();
  }, [timelineScrollRef]);

  return (
    <div
      className="timeline-panel"
      style={{
        ["--label-width" as string]: `${labelWidth}px`,
      }}
    >
      <div
        ref={timelineScrollRef}
        className={`timeline-scroll ${
          timelineDragScroll.isGrabbing ? "is-grab-panning" : ""
        }`}
        {...timelineDragScroll.handlers}
        onScroll={syncTimelineViewport}
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
              aria-valuemin={limits.min}
              aria-valuemax={limits.max}
              tabIndex={0}
              title="Drag to resize. Double-click to reset."
              onPointerDown={labelResize.handleLabelResizePointerDown}
              onPointerMove={labelResize.handleLabelResizePointerMove}
              onPointerUp={labelResize.handleLabelResizePointerEnd}
              onPointerCancel={labelResize.handleLabelResizePointerEnd}
              onDoubleClick={() => labelResize.commitLabelWidth(limits.default)}
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
          <div ref={footerRef} className="timeline-footer">
            <div className="timeline-footer__canvas">
              <LoopOverlay
                className="timeline-footer__loop"
                loopRegion={loopRegion}
                quarterPx={quarterPx}
                offsetPx={labelWidth + 1}
              />
              {footer}
            </div>
          </div>
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
