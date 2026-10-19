import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useHoldToType } from "../../use-hold-to-type";
import {
  formatZoomFactor,
  parseZoomPercent,
  sliderPositionToZoom,
  zoomToSliderPosition,
} from "../../zoom";

// As on a Knob: dragging this far up or down travels the whole zoom range,
// ten times as far with Shift held.
const DRAG_PIXELS = 200;
const FINE_FACTOR = 10;
// A press that moves less than this is not a drag: held still, it opens the
// text field, and a quick tap does nothing.
const DRAG_THRESHOLD_PX = 3;

type ZoomReadoutProps = {
  resolvedZoom: number;
  setZoomValue: (label: string, nextZoom: number) => void;
  updateZoomDraft: (nextZoom: number | null) => void;
  flushZoomDraft: (label?: string) => void;
};

// The zoom readout: dragging it up or down zooms in or out along the slider's
// travel, committing on release, and holding the pointer still on it, or
// pressing Enter, opens a text field to type the percentage.
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
  const hold = useHoldToType();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Guards against the input's blur re-applying a value after Enter/Escape.
  const editingRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Set when the editor closes, so the button that replaces it takes focus.
  const refocusRef = useRef(false);
  useEffect(() => {
    if (!editing && refocusRef.current) {
      refocusRef.current = false;
      buttonRef.current?.focus();
    }
  }, [editing]);

  const openEditor = (zoom: number) => {
    setDraft(String(Math.round(zoom * 100)));
    editingRef.current = true;
    setEditing(true);
  };

  const closeEditor = (apply: boolean) => {
    if (!editingRef.current) {
      return;
    }
    editingRef.current = false;
    refocusRef.current = true;
    setEditing(false);
    const typed = parseZoomPercent(draft);
    if (apply && typed !== null) {
      setZoomValue("Set zoom", typed);
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }
    const button = event.currentTarget;
    button.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      raw: zoomToSliderPosition(resolvedZoom),
      moved: false,
    };
    hold.arm(() => {
      if (button.hasPointerCapture(event.pointerId)) {
        button.releasePointerCapture(event.pointerId);
      }
      dragRef.current = null;
      openEditor(resolvedZoom);
    });
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
    hold.cancel();
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
    hold.cancel();
    dragRef.current = null;
    if (drag.moved) {
      flushZoomDraft();
    }
  };

  if (editing) {
    return (
      <input
        aria-label="Zoom percentage"
        className="zoom-control__readout zoom-control__input"
        inputMode="decimal"
        // biome-ignore lint/a11y/noAutofocus: the editor opens on an explicit request to type a value
        autoFocus
        onBlur={() => closeEditor(true)}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            closeEditor(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            closeEditor(false);
          }
        }}
        type="text"
        value={draft}
      />
    );
  }

  return (
    <button
      aria-label={`Zoom ${formatZoomFactor(resolvedZoom)}. Edit value`}
      className="zoom-control__readout"
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          openEditor(resolvedZoom);
        }
      }}
      onLostPointerCapture={endDrag}
      onPointerCancel={endDrag}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      ref={buttonRef}
      title="Drag up or down to zoom, or hold still or press Enter to type a zoom"
      type="button"
    >
      {formatZoomFactor(resolvedZoom)}
    </button>
  );
}
