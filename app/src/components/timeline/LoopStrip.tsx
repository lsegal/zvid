import { type PointerEvent, type RefObject, useRef } from "react";
import {
  type PlaybackSelection,
  playbackSelectionFromDrag,
} from "../../app/playback-selection.ts";
import {
  getTimelinePointerX,
  pointerToTimelineQ,
} from "../../app/timeline-math.ts";
import { isRulerPanPress } from "../../drag-scroll.ts";

// How far the pointer moves before a press in the strip counts as a drag
// rather than a click that clears the selection.
const LOOP_STRIP_DRAG_THRESHOLD_PX = 3;

type LoopStripProps = {
  timelineScrollRef: RefObject<HTMLDivElement | null>;
  mac: boolean;
  labelWidth: number;
  quarterPx: number;
  totalQuarters: number;
  snapUnit: number;
  snapEnabled: boolean;
  playbackSelection: PlaybackSelection | null;
  setPlaybackSelection: (selection: PlaybackSelection | null) => void;
};

// The loop strip along the ruler's bottom edge, and the playback selection's
// highlight. Dragging in the strip selects a range without moving the
// playhead; a click clears it. Pan and zoom presses pass through to the
// ruler row.
export function LoopStrip({
  timelineScrollRef,
  mac,
  labelWidth,
  quarterPx,
  totalQuarters,
  snapUnit,
  snapEnabled,
  playbackSelection,
  setPlaybackSelection,
}: LoopStripProps) {
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    anchorQ: number;
    moved: boolean;
  } | null>(null);

  const pointerQ = (clientX: number) => {
    const timelineScroll = timelineScrollRef.current;
    if (!timelineScroll) {
      return null;
    }

    return pointerToTimelineQ(
      getTimelinePointerX(timelineScroll, clientX),
      timelineScroll.scrollLeft,
      labelWidth,
      quarterPx,
    );
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || isRulerPanPress(event, mac)) {
      return;
    }

    const anchorQ = pointerQ(event.clientX);
    if (anchorQ === null) {
      return;
    }

    // The ruler's scrub handler never sees the press.
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      anchorQ,
      moved: false,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    if (
      !drag.moved &&
      Math.abs(event.clientX - drag.startX) < LOOP_STRIP_DRAG_THRESHOLD_PX
    ) {
      return;
    }

    drag.moved = true;
    const currentQ = pointerQ(event.clientX);
    if (currentQ === null) {
      return;
    }

    setPlaybackSelection(
      playbackSelectionFromDrag(drag.anchorQ, currentQ, {
        snapUnit,
        snap: snapEnabled && !event.shiftKey,
        totalQuarters,
      }),
    );
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = null;
    if (!drag.moved && event.type === "pointerup") {
      setPlaybackSelection(null);
    }
  };

  const selectionStyle = playbackSelection
    ? {
        left: playbackSelection.startQ * quarterPx,
        width: (playbackSelection.endQ - playbackSelection.startQ) * quarterPx,
      }
    : null;

  return (
    <>
      {selectionStyle ? (
        <div className="ruler-playback-selection" style={selectionStyle} />
      ) : null}
      <div
        className="ruler-loop-strip"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {playbackSelection && selectionStyle ? (
          <div
            className="ruler-loop-strip__selection"
            data-start-q={playbackSelection.startQ}
            data-end-q={playbackSelection.endQ}
            style={selectionStyle}
          />
        ) : null}
      </div>
    </>
  );
}
