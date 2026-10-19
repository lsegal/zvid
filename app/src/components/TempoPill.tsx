import {
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react";
import { BPM_MAX, BPM_MIN } from "../app/constants.ts";
import { patchProjectState } from "../app/session-project.ts";
import type { ProjectState } from "../app/types.ts";
import { clamp } from "../app/util.ts";
import { useHoldToType } from "../use-hold-to-type.ts";

const BPM_STEP = 5;
// As on the zoom readout: dragging this far up or down travels the whole
// tempo range, ten times as far with Shift held.
const DRAG_PIXELS = 200;
const FINE_FACTOR = 10;
// A press that moves less than this is not a drag: held still, it opens the
// text field, and a quick tap does nothing.
const DRAG_THRESHOLD_PX = 3;

// The timeline toolbar's tempo readout, with buttons that step it by 5 BPM.
// As on a Knob's value, dragging the readout up or down raises or lowers the
// tempo, committing on release, and holding the pointer still on it, or
// pressing Enter, types one in.
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
  const hold = useHoldToType();
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? bpm;
  // Set when the editor closes, so the readout that replaces it takes focus.
  const refocusRef = useRef(false);
  const [typed, setTyped] = useState<string | null>(null);
  // Guards against the input's blur re-applying a value after Enter/Escape.
  const editingRef = useRef(false);

  const adjust = (delta: number) =>
    commitProjectChange("Adjust BPM", (current) =>
      patchProjectState(current, {
        bpm: clamp(current.bpm + delta, BPM_MIN, BPM_MAX),
      }),
    );

  const setBpm = (next: number) => {
    const bounded = clamp(Math.round(next), BPM_MIN, BPM_MAX);
    if (bounded !== bpm) {
      commitProjectChange("Adjust BPM", (current) =>
        patchProjectState(current, { bpm: bounded }),
      );
    }
  };

  const openEditor = () => {
    editingRef.current = true;
    setTyped(bpm.toFixed(0));
  };

  const closeEditor = (apply: boolean) => {
    if (!editingRef.current || typed === null) {
      return;
    }
    editingRef.current = false;
    refocusRef.current = true;
    setTyped(null);
    const parsed = Number.parseFloat(typed);
    if (apply && Number.isFinite(parsed)) {
      setBpm(parsed);
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
      raw: bpm,
      moved: false,
    };
    hold.arm(() => {
      if (button.hasPointerCapture(event.pointerId)) {
        button.releasePointerCapture(event.pointerId);
      }
      dragRef.current = null;
      openEditor();
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
    drag.raw = clamp(
      drag.raw + ((drag.lastY - event.clientY) / pixels) * (BPM_MAX - BPM_MIN),
      BPM_MIN,
      BPM_MAX,
    );
    drag.lastY = event.clientY;
    setDraft(Math.round(drag.raw));
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
    setDraft(null);
    if (drag.moved) {
      setBpm(drag.raw);
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
      {typed !== null ? (
        <span className="tempo-pill__readout">
          <input
            aria-label="Tempo in BPM"
            className="tempo-pill__input"
            inputMode="decimal"
            // biome-ignore lint/a11y/noAutofocus: the editor opens on an explicit request to type a tempo
            autoFocus
            onBlur={() => closeEditor(true)}
            onChange={(event) => setTyped(event.currentTarget.value)}
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
            value={typed}
          />{" "}
          BPM
        </span>
      ) : (
        <button
          aria-label={`Tempo ${shown.toFixed(0)} BPM. Edit value`}
          className="tempo-pill__readout"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              openEditor();
            }
          }}
          onLostPointerCapture={endDrag}
          onPointerCancel={endDrag}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          ref={(node) => {
            if (node && refocusRef.current) {
              refocusRef.current = false;
              node.focus();
            }
          }}
          title="Drag up or down to change the tempo, or hold still to type one"
          type="button"
        >
          {shown.toFixed(0)} BPM
        </button>
      )}
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
