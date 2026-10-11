import { useEffect, useRef } from "react";
import { getAutoScrollDelta } from "../../fx-chain.ts";
import { COLLAPSED_ROW_METRICS } from "../../row-heights.ts";
import "./row-resize-handle.css";

type RowResizeHandleProps = {
  // Names the row, as in "Resize Layer 1".
  label: string;
  height: number;
  maxHeight: number;
  // What expanding the row restores (row-heights.ts).
  expandedHeight: number;
  // Resizes the row; a height at the minimum collapses it, and expanding it
  // again restores expandedHeight.
  onResize: (height: number, expandedHeight: number) => void;
};

// The separator along the bottom of a row's handle (#1058): dragging it
// resizes that row alone, down to the collapsed height. It lies under the
// reorder grip, so it never takes a grip drag, and pressing it doesn't
// select the row. A finger dragging it near the top or bottom of the
// timeline scrolls the timeline, so a row can grow past the visible area.
export function RowResizeHandle({
  label,
  height,
  maxHeight,
  expandedHeight,
  onResize,
}: RowResizeHandleProps) {
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    lastY: number;
    startHeight: number;
    expandedHeight: number;
    // The timeline it scrolls, for a touch drag, and where it started.
    scroller: HTMLElement | null;
    startScrollTop: number;
    frame: number;
  } | null>(null);
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  const resizeTo = (drag: NonNullable<typeof dragRef.current>) => {
    const scrolled = drag.scroller
      ? drag.scroller.scrollTop - drag.startScrollTop
      : 0;
    onResizeRef.current(
      drag.startHeight + drag.lastY - drag.startY + scrolled,
      drag.expandedHeight,
    );
  };

  const autoScroll = () => {
    const drag = dragRef.current;
    const scroller = drag?.scroller;
    if (!drag || !scroller) {
      return;
    }
    const rect = scroller.getBoundingClientRect();
    const delta = getAutoScrollDelta(drag.lastY, rect.top, rect.bottom);
    const before = scroller.scrollTop;
    scroller.scrollTop += delta;
    if (scroller.scrollTop !== before) {
      resizeTo(drag);
    }
    drag.frame = requestAnimationFrame(autoScroll);
  };

  const endDrag = () => {
    const drag = dragRef.current;
    if (drag) {
      cancelAnimationFrame(drag.frame);
      dragRef.current = null;
    }
    return drag;
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: cleanup only
  useEffect(() => () => void endDrag(), []);

  return (
    <hr
      className="row-resize-handle"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuenow={height}
      aria-valuemin={COLLAPSED_ROW_METRICS.height}
      aria-valuemax={maxHeight}
      title="Drag to resize"
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const scroller =
          event.pointerType === "touch"
            ? event.currentTarget.closest<HTMLElement>(".timeline-scroll")
            : null;
        endDrag();
        dragRef.current = {
          pointerId: event.pointerId,
          startY: event.clientY,
          lastY: event.clientY,
          startHeight: height,
          expandedHeight,
          scroller,
          startScrollTop: scroller?.scrollTop ?? 0,
          frame: scroller ? requestAnimationFrame(autoScroll) : 0,
        };
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (drag?.pointerId !== event.pointerId) {
          return;
        }

        drag.lastY = event.clientY;
        resizeTo(drag);
      }}
      onPointerUp={(event) => {
        if (dragRef.current?.pointerId === event.pointerId) {
          endDrag();
        }
      }}
      onPointerCancel={(event) => {
        if (dragRef.current?.pointerId === event.pointerId) {
          const drag = endDrag();
          if (drag) {
            onResize(drag.startHeight, drag.expandedHeight);
          }
        }
      }}
      onClick={(event) => event.stopPropagation()}
    />
  );
}
