import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  formatZoomFactor,
  parseZoomPercent,
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
// How long a click's reset stays a draft, so a double-click that opens the
// editor can take it back without an undo step.
const RESET_COMMIT_DELAY_MS = 500;

type ZoomReadoutProps = {
  resolvedZoom: number;
  setZoomValue: (label: string, nextZoom: number) => void;
  updateZoomDraft: (nextZoom: number | null) => void;
  flushZoomDraft: (label?: string) => void;
};

// The zoom readout: a click resets the zoom to 100%, dragging it up or down
// zooms in or out along the slider's travel, committing on release, and a
// double-click or Enter opens a text field to type the percentage.
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
  // The zoom a click's pending reset replaced, and the timer that commits it.
  const pendingResetRef = useRef<{
    from: number;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
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

  const commitPendingReset = () => {
    const pending = pendingResetRef.current;
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    pendingResetRef.current = null;
    flushZoomDraft("Reset zoom");
  };

  // Commits a reset still pending on unmount. The ref holds the latest
  // commit function, as the cleanup only runs once.
  const commitPendingResetRef = useRef(commitPendingReset);
  commitPendingResetRef.current = commitPendingReset;
  useEffect(() => () => commitPendingResetRef.current(), []);

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
    if (!drag.moved) {
      // A drag right after a click starts from the reset zoom.
      commitPendingReset();
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
      aria-label={`Zoom ${formatZoomFactor(resolvedZoom)}, reset to ${formatZoomFactor(ZOOM_DEFAULT)}`}
      className="zoom-control__readout"
      onClick={(event) => {
        if (draggedRef.current) {
          draggedRef.current = false;
          return;
        }
        // The second click of a double-click leaves the first's reset to it.
        if (event.detail > 1) {
          return;
        }
        // A keyboard click has no double-click to wait for.
        if (event.detail === 0) {
          setZoomValue("Reset zoom", ZOOM_DEFAULT);
          return;
        }
        commitPendingReset();
        if (Math.abs(resolvedZoom - ZOOM_DEFAULT) <= 0.0001) {
          return;
        }
        // Shown at once but committed after the double-click window.
        updateZoomDraft(ZOOM_DEFAULT);
        pendingResetRef.current = {
          from: resolvedZoom,
          timer: setTimeout(commitPendingReset, RESET_COMMIT_DELAY_MS),
        };
      }}
      onDoubleClick={() => {
        const pending = pendingResetRef.current;
        let zoom = resolvedZoom;
        if (pending) {
          clearTimeout(pending.timer);
          pendingResetRef.current = null;
          updateZoomDraft(null);
          zoom = pending.from;
        }
        openEditor(zoom);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commitPendingReset();
          openEditor(resolvedZoom);
        }
      }}
      onLostPointerCapture={endDrag}
      onPointerCancel={endDrag}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      ref={buttonRef}
      title="Reset zoom to 100%, drag up or down to zoom, or double-click or press Enter to type a zoom"
      type="button"
    >
      {formatZoomFactor(resolvedZoom)}
    </button>
  );
}
