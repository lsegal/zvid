import { type PointerEvent, useRef, useState } from "react";
import { editLoopRegion, type LoopRegion } from "../../app/loop-region.ts";
import { snapQuarterValue } from "../../app/timeline-math.ts";
import { isRulerPanPress } from "../../drag-scroll.ts";
import type { SelectionEditKind } from "../../lane-selection-gesture.ts";

// How far the pointer moves before a press on the loop counts as a drag
// rather than half of a double-click.
const LOOP_REGION_DRAG_THRESHOLD_PX = 3;

type LoopRegionBarProps = {
  mac: boolean;
  quarterPx: number;
  totalQuarters: number;
  snapUnit: number;
  snapEnabled: boolean;
  loopRegion: LoopRegion;
  setLoopRegion: (region: LoopRegion | null) => void;
};

// The loop region in the loop strip: a bar from the in marker to the out
// marker, edited like a layer clip. Dragging an edge handle resizes that
// end, dragging the middle moves it, and a double-click deletes it.
export function LoopRegionBar({
  mac,
  quarterPx,
  totalQuarters,
  snapUnit,
  snapEnabled,
  loopRegion,
  setLoopRegion,
}: LoopRegionBarProps) {
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    origin: LoopRegion;
    kind: SelectionEditKind;
    moved: boolean;
  } | null>(null);
  const [dragKind, setDragKind] = useState<SelectionEditKind | null>(null);

  const startDrag =
    (kind: SelectionEditKind) => (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || isRulerPanPress(event, mac)) {
        return;
      }

      // Neither the strip's selection drag nor the ruler's scrub sees it.
      event.stopPropagation();
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        origin: loopRegion,
        kind,
        moved: false,
      };
      setDragKind(kind);
    };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    if (
      !drag.moved &&
      Math.abs(event.clientX - drag.startX) < LOOP_REGION_DRAG_THRESHOLD_PX
    ) {
      return;
    }

    drag.moved = true;
    const snap = snapEnabled && !event.shiftKey;
    setLoopRegion(
      editLoopRegion(
        drag.origin,
        drag.kind,
        (event.clientX - drag.startX) / quarterPx,
        (valueQ) => snapQuarterValue(valueQ, snapUnit, snap),
        { minimumQ: snapUnit, totalQuarters },
      ),
    );
  };

  const endDrag = (event: PointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = null;
    setDragKind(null);
  };

  const dragHandlers = {
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };
  const handleClass = (edge: "start" | "end") =>
    `ruler-loop-region__handle ruler-loop-region__handle--${edge}${
      dragKind === `resize-${edge}`
        ? " ruler-loop-region__handle--trimming"
        : ""
    }`;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: double-click is a pointer shortcut; the loop strip menu's Delete loop is its equivalent
    <div
      className={`ruler-loop-region${
        dragKind === "move" ? " ruler-loop-region--moving" : ""
      }`}
      data-start-q={loopRegion.startQ}
      data-end-q={loopRegion.endQ}
      style={{
        left: loopRegion.startQ * quarterPx,
        width: (loopRegion.endQ - loopRegion.startQ) * quarterPx,
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        setLoopRegion(null);
      }}
    >
      <div
        className="ruler-loop-region__body"
        onPointerDown={startDrag("move")}
        {...dragHandlers}
      />
      <span aria-hidden="true" className="ruler-loop-region__marker--in" />
      <span aria-hidden="true" className="ruler-loop-region__marker--out" />
      <div
        className={handleClass("start")}
        onPointerDown={startDrag("resize-start")}
        {...dragHandlers}
      />
      <div
        className={handleClass("end")}
        onPointerDown={startDrag("resize-end")}
        {...dragHandlers}
      />
    </div>
  );
}
