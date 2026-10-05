import { useRef } from "react";
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
// select the row.
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
    startHeight: number;
    expandedHeight: number;
  } | null>(null);

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
        dragRef.current = {
          pointerId: event.pointerId,
          startY: event.clientY,
          startHeight: height,
          expandedHeight,
        };
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (drag?.pointerId !== event.pointerId) {
          return;
        }

        onResize(
          drag.startHeight + event.clientY - drag.startY,
          drag.expandedHeight,
        );
      }}
      onPointerUp={(event) => {
        if (dragRef.current?.pointerId === event.pointerId) {
          dragRef.current = null;
        }
      }}
      onPointerCancel={(event) => {
        const drag = dragRef.current;
        if (drag?.pointerId === event.pointerId) {
          dragRef.current = null;
          onResize(drag.startHeight, drag.expandedHeight);
        }
      }}
      onClick={(event) => event.stopPropagation()}
    />
  );
}
