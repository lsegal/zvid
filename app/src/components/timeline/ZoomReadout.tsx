import { type PointerEvent as ReactPointerEvent, useRef } from "react";
import {
  formatZoomFactor,
  sliderPositionToZoom,
  ZOOM_DEFAULT,
  zoomToSliderPosition,
} from "../../zoom";

// As on a Knob: dragging this far up or down travels the whole zoom range,
// ten times as far with Shift held.
const DRAG_PIXELS = 200;
const FINE_FACTOR = 10;
// A press that moves less than this is a click, which resets the zoom.
const DRAG_THRESHOLD_PX = 3;

type ZoomReadoutProps = {
  resolvedZoom: number;
  setZoomValue: (label: string, nextZoom: number) => void;
  updateZoomDraft: (nextZoom: number | null) => void;
  flushZoomDraft: (label?: string) => void;
};

// The zoom readout: a click resets the zoom to 100%, and dragging it up or
// down zooms in or out along the slider's travel, committing on release.
export function ZoomReadout({
  resolvedZoom,
  setZoomValue,
  updateZoomDraft,
  flushZoomDraft,
}: ZoomReadoutProps) {
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    lastY: number;
    raw: number;
    moved: boolean;
  } | null>(null);
  // Set when a drag ends, so the click that follows its release keeps the
  // dragged zoom instead of resetting it.
  const draggedRef = useRef(false);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }
    draggedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      raw: zoomToSliderPosition(resolvedZoom),
      moved: false,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    if (
      !drag.moved &&
      Math.abs(event.clientY - drag.startY) < DRAG_THRESHOLD_PX
    ) {
      return;
    }
    drag.moved = true;
    const pixels = event.shiftKey ? DRAG_PIXELS * FINE_FACTOR : DRAG_PIXELS;
    drag.raw = Math.max(
      0,
      Math.min(1, drag.raw + (drag.lastY - event.clientY) / pixels),
    );
    drag.lastY = event.clientY;
    updateZoomDraft(sliderPositionToZoom(drag.raw));
  };

  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    if (drag.moved) {
      // Only a release is followed by a click.
      draggedRef.current = event.type === "pointerup";
      flushZoomDraft();
    }
  };

  return (
    <button
      aria-label={`Zoom ${formatZoomFactor(resolvedZoom)}, reset to ${formatZoomFactor(ZOOM_DEFAULT)}`}
      className="zoom-control__readout"
      onClick={() => {
        if (draggedRef.current) {
          draggedRef.current = false;
          return;
        }
        setZoomValue("Reset zoom", ZOOM_DEFAULT);
      }}
      onLostPointerCapture={endDrag}
      onPointerCancel={endDrag}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      title="Reset zoom to 100%, or drag up or down to zoom"
      type="button"
    >
      {formatZoomFactor(resolvedZoom)}
    </button>
  );
}
