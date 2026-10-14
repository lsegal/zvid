import { type PointerEvent, useRef, useState } from "react";
import { editLoopRegion, type LoopRegion } from "../../app/loop-region.ts";
import type { PlaybackSelection } from "../../app/playback-selection.ts";
import { snapQuarterValue } from "../../app/timeline-math.ts";
import { isRulerPanPress } from "../../drag-scroll.ts";
import type { SelectionEditKind } from "../../lane-selection-gesture.ts";
import { isDoubleTap, type TouchTap } from "../../mobile/timeline-touch.ts";

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
  setLoopRegion: (region: LoopRegion | null, label?: string) => void;
  previewLoopRegion: (region: LoopRegion | null) => void;
  setPlaybackSelection: (selection: PlaybackSelection | null) => void;
};

// The loop region in the loop strip: a bar from the in marker to the out
// marker, edited like a layer clip. Dragging an edge handle resizes that
// end, dragging the middle moves it, and a double-click or double tap turns
// it back into a playback selection over the same range.
export function LoopRegionBar({
  mac,
  quarterPx,
  totalQuarters,
  snapUnit,
  snapEnabled,
  loopRegion,
  setLoopRegion,
  previewLoopRegion,
  setPlaybackSelection,
}: LoopRegionBarProps) {
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    origin: LoopRegion;
    kind: SelectionEditKind;
    // The loop the drag has made so far, if it has moved.
    region: LoopRegion | null;
  } | null>(null);
  const [dragKind, setDragKind] = useState<SelectionEditKind | null>(null);
  const lastTapRef = useRef<TouchTap | null>(null);
  // Whether the last press was a mouse's or pen's, so a dblclick a double
  // tap elsewhere fires at the bar it revealed is ignored.
  const clickedRef = useRef(false);

  const unlock = () => {
    setLoopRegion(null);
    setPlaybackSelection({ startQ: loopRegion.startQ, endQ: loopRegion.endQ });
  };

  const startDrag =
    (kind: SelectionEditKind) => (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || isRulerPanPress(event, mac)) {
        return;
      }

      // Neither the strip's selection drag nor the ruler's scrub sees it.
      event.stopPropagation();
      event.preventDefault();
      clickedRef.current = event.pointerType !== "touch";
      // Browsers don't all fire dblclick for a double tap.
      if (event.pointerType === "touch") {
        const tap = {
          x: event.clientX,
          y: event.clientY,
          timeMs: event.timeStamp,
        };
        if (isDoubleTap(lastTapRef.current, tap)) {
          lastTapRef.current = null;
          unlock();
          return;
        }
        lastTapRef.current = tap;
      }

      event.currentTarget.setPointerCapture?.(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        origin: loopRegion,
        kind,
        region: null,
      };
      setDragKind(kind);
    };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    if (
      !drag.region &&
      Math.abs(event.clientX - drag.startX) < LOOP_REGION_DRAG_THRESHOLD_PX
    ) {
      return;
    }

    const snap = snapEnabled && !event.shiftKey;
    drag.region = editLoopRegion(
      drag.origin,
      drag.kind,
      (event.clientX - drag.startX) / quarterPx,
      (valueQ) => snapQuarterValue(valueQ, snapUnit, snap),
      { minimumQ: snapUnit, totalQuarters },
    );
    previewLoopRegion(drag.region);
  };

  // The whole drag is one undo entry.
  const endDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = null;
    setDragKind(null);
    if (drag.region) {
      setLoopRegion(
        drag.region,
        drag.kind === "move" ? "Move loop" : "Resize loop",
      );
    }
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
    // biome-ignore lint/a11y/noStaticElementInteractions: double-click is a pointer shortcut; the loop strip menu's Delete loop and Create loop area are its equivalent
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
        if (clickedRef.current) {
          unlock();
        }
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
