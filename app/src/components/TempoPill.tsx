import {
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react";
import { BPM_MAX, BPM_MIN } from "../app/constants.ts";
import { patchProjectState } from "../app/session-project.ts";
import type { ProjectState } from "../app/types.ts";
import { clamp } from "../app/util.ts";

const BPM_STEP = 5;
// As on the zoom readout: dragging this far up or down travels the whole
// tempo range, ten times as far with Shift held.
const DRAG_PIXELS = 200;
const FINE_FACTOR = 10;
// A press that moves less than this is a click, which does nothing.
const DRAG_THRESHOLD_PX = 3;

// The timeline toolbar's tempo readout, with buttons that step it by 5 BPM.
// Dragging the readout up or down raises or lowers the tempo, committing on
// release.
export function TempoPill({
  bpm,
  commitProjectChange,
}: {
  bpm: number;
  commitProjectChange: (
    label: string,
    updater: (current: ProjectState) => ProjectState,
  ) => void;
}) {
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    lastY: number;
    raw: number;
    moved: boolean;
  } | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? bpm;

  const adjust = (delta: number) =>
    commitProjectChange("Adjust BPM", (current) =>
      patchProjectState(current, {
        bpm: clamp(current.bpm + delta, BPM_MIN, BPM_MAX),
      }),
    );

  const handlePointerDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      raw: bpm,
      moved: false,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
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
    drag.raw = clamp(
      drag.raw + ((drag.lastY - event.clientY) / pixels) * (BPM_MAX - BPM_MIN),
      BPM_MIN,
      BPM_MAX,
    );
    drag.lastY = event.clientY;
    setDraft(Math.round(drag.raw));
  };

  const endDrag = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDraft(null);
    const next = Math.round(drag.raw);
    if (drag.moved && next !== bpm) {
      commitProjectChange("Adjust BPM", (current) =>
        patchProjectState(current, { bpm: next }),
      );
    }
  };

  return (
    <div className="tempo-pill">
      <button
        aria-label="Decrease tempo"
        className="tempo-pill__adjust"
        onClick={() => adjust(-BPM_STEP)}
        type="button"
      >
        −
      </button>
      <span
        className="tempo-pill__readout"
        onLostPointerCapture={endDrag}
        onPointerCancel={endDrag}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        title="Drag up or down to change the tempo"
      >
        {shown.toFixed(0)} BPM
      </span>
      <button
        aria-label="Increase tempo"
        className="tempo-pill__adjust"
        onClick={() => adjust(BPM_STEP)}
        type="button"
      >
        +
      </button>
    </div>
  );
}
