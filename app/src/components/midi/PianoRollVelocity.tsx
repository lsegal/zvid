import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react";
import type { MidiNote } from "../../midi-clip.ts";
import { noteKey, pitchName, sameNotes } from "../../midi-piano-roll.ts";
import {
  clampVelocity,
  clampVelocityLaneHeight,
  paintVelocities,
  readVelocityLaneHeight,
  saveVelocityLaneHeight,
  shiftVelocities,
  stemsBetween,
  VELOCITY_LANE_DEFAULT_PX,
  VELOCITY_LANE_MAX_PX,
  VELOCITY_LANE_MIN_PX,
  VELOCITY_MAX,
  VELOCITY_MIN,
  velocityAt,
} from "../../piano-roll-velocity.ts";

// The lane's top edge, which resizes it, and the room it leaves above the
// tallest stem.
const HANDLE_PX = 5;
// How far an arrow key moves a stem or the lane's edge, and Shift+arrow.
const KEY_STEP = 1;
const SHIFT_KEY_STEP = 10;
const RESIZE_KEY_STEP = 8;

type VelocityDrag = {
  pointerId: number;
  // The clip's notes before the drag.
  base: MidiNote[];
  // The notes during the drag.
  notes: MidiNote[];
} & (
  | // Paints each stem the pointer crosses to the height under it.
  { mode: "paint"; lastX: number; lastVelocity: number }
  // Shifts the selected notes by as much as the pressed stem moved.
  | { mode: "shift"; indexes: ReadonlySet<number>; anchor: number }
);

/** The lane's height, which its top edge resizes, kept between sessions. */
export function useVelocityLaneHeight() {
  const [height, setHeight] = useState(readVelocityLaneHeight);
  const commit = (next: number) => {
    const clamped = clampVelocityLaneHeight(next);
    setHeight(clamped);
    saveVelocityLaneHeight(clamped);
  };
  return { height, setHeight, commit };
}

type PianoRollVelocityProps = {
  notes: readonly MidiNote[];
  selectedKeys: ReadonlySet<string>;
  quarterPx: number;
  width: number;
  lane: ReturnType<typeof useVelocityLaneHeight>;
  onSetVelocities: (notes: MidiNote[]) => void;
};

// The piano roll's velocity lane, docked along the bottom of its grid and
// scrolling across with it: a stem at each note's start as tall as its
// velocity. Dragging over the stems paints them to the height under the
// pointer; pressing a selected note's stem moves every selected note's
// velocity with it. Each drag is one undo step. Dragging the lane's top
// edge resizes it.
export function PianoRollVelocity({
  notes,
  selectedKeys,
  quarterPx,
  width,
  lane,
  onSetVelocities,
}: PianoRollVelocityProps) {
  const laneRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{
    pointerId: number;
    startY: number;
    origin: number;
  } | null>(null);
  const [drag, setDrag] = useState<VelocityDrag | null>(null);
  const shownNotes = drag?.notes ?? notes;
  const stemsPx = lane.height - HANDLE_PX;

  function lanePoint(event: { clientX: number; clientY: number }) {
    const bounds = laneRef.current?.getBoundingClientRect();
    if (!bounds) {
      return undefined;
    }
    return {
      x: event.clientX - bounds.left,
      velocity: velocityAt(event.clientY - bounds.top - HANDLE_PX, stemsPx),
    };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as Element).closest("hr")) {
      return;
    }
    const point = lanePoint(event);
    if (!point) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const base = [...notes];
    const hit = stemsBetween(base, point.x, point.x, quarterPx);
    const selected = new Set(
      base.flatMap((note, index) =>
        selectedKeys.has(noteKey(note)) ? [index] : [],
      ),
    );
    const anchor = hit.find((index) => selected.has(index));
    if (anchor !== undefined && selected.size > 1) {
      const delta = point.velocity - base[anchor].velocity;
      setDrag({
        pointerId: event.pointerId,
        base,
        notes: shiftVelocities(base, selected, delta),
        mode: "shift",
        indexes: selected,
        anchor,
      });
      return;
    }
    setDrag({
      pointerId: event.pointerId,
      base,
      notes: paintVelocities(base, point, point, quarterPx),
      mode: "paint",
      lastX: point.x,
      lastVelocity: point.velocity,
    });
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    const point = lanePoint(event);
    if (!point) {
      return;
    }
    if (drag.mode === "shift") {
      const delta = point.velocity - drag.base[drag.anchor].velocity;
      setDrag({
        ...drag,
        notes: shiftVelocities(drag.base, drag.indexes, delta),
      });
      return;
    }
    setDrag({
      ...drag,
      notes: paintVelocities(
        drag.notes,
        { x: drag.lastX, velocity: drag.lastVelocity },
        point,
        quarterPx,
      ),
      lastX: point.x,
      lastVelocity: point.velocity,
    });
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>, commit: boolean) {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    setDrag(null);
    if (commit && !sameNotes(drag.notes, drag.base)) {
      onSetVelocities(drag.notes);
    }
  }

  function handleStemKeyDown(
    event: ReactKeyboardEvent<HTMLElement>,
    index: number,
  ) {
    const step = event.shiftKey ? SHIFT_KEY_STEP : KEY_STEP;
    const delta =
      event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0;
    if (!delta || drag) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const note = notes[index];
    const velocity = clampVelocity(note.velocity + delta);
    if (velocity !== note.velocity) {
      onSetVelocities(
        notes.map((other, at) =>
          at === index ? { ...note, velocity } : other,
        ),
      );
    }
  }

  function handleResizePointerDown(event: ReactPointerEvent<HTMLHRElement>) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    resizeRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      origin: lane.height,
    };
  }

  function handleResizePointerMove(event: ReactPointerEvent<HTMLHRElement>) {
    const resize = resizeRef.current;
    if (resize?.pointerId !== event.pointerId) {
      return;
    }
    lane.setHeight(
      clampVelocityLaneHeight(resize.origin + resize.startY - event.clientY),
    );
  }

  function handleResizePointerEnd(event: ReactPointerEvent<HTMLHRElement>) {
    if (resizeRef.current?.pointerId !== event.pointerId) {
      return;
    }
    resizeRef.current = null;
    lane.commit(lane.height);
  }

  function handleResizeKeyDown(event: ReactKeyboardEvent<HTMLHRElement>) {
    const delta =
      event.key === "ArrowUp"
        ? RESIZE_KEY_STEP
        : event.key === "ArrowDown"
          ? -RESIZE_KEY_STEP
          : 0;
    if (delta) {
      event.preventDefault();
      lane.commit(lane.height + delta);
    }
  }

  return (
    <>
      <div className="piano-roll__velocity-corner">Vel</div>
      <div
        className="piano-roll__velocity"
        data-piano-roll-velocity
        onLostPointerCapture={(event) => endDrag(event, true)}
        onPointerCancel={(event) => endDrag(event, false)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => endDrag(event, true)}
        ref={laneRef}
        style={{ width }}
      >
        <hr
          aria-label="Resize velocity lane"
          aria-orientation="horizontal"
          aria-valuemax={VELOCITY_LANE_MAX_PX}
          aria-valuemin={VELOCITY_LANE_MIN_PX}
          aria-valuenow={lane.height}
          className="piano-roll__velocity-resize"
          onDoubleClick={() => lane.commit(VELOCITY_LANE_DEFAULT_PX)}
          onKeyDown={handleResizeKeyDown}
          onPointerCancel={handleResizePointerEnd}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerEnd}
          tabIndex={0}
          title="Drag to resize. Double-click to reset."
        />
        {shownNotes.map((note, index) => (
          <div
            aria-label={`${pitchName(note.pitch)} at beat ${+(note.start + 1).toFixed(2)} velocity`}
            aria-valuemax={VELOCITY_MAX}
            aria-valuemin={VELOCITY_MIN}
            aria-valuenow={note.velocity}
            className={`piano-roll__stem${selectedKeys.has(noteKey(note)) ? " piano-roll__stem--selected" : ""}`}
            data-stem-index={index}
            // Notes have no ids; a drag keeps each note's index.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            key={index}
            onKeyDown={(event) => handleStemKeyDown(event, index)}
            role="slider"
            style={{
              left: note.start * quarterPx,
              height: (note.velocity / VELOCITY_MAX) * stemsPx,
            }}
            tabIndex={-1}
            title={`Velocity ${note.velocity}`}
          />
        ))}
      </div>
    </>
  );
}
