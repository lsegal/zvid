import { type Dispatch, type SetStateAction, useEffect } from "react";
import type { TimelineSelection } from "../app/types.ts";
import { isTouchTap } from "../mobile/timeline-touch.ts";

// A primary press anywhere in the timeline panel outside the uncommitted
// selection clears it: on lane space, clips, the ruler or another row. A
// press inside it moves or resizes it instead, and a press on the timeline's
// scrollbars keeps it. On the phone shell, where a swipe scrolls the
// timeline, only a touch that turns out to be a tap clears it, so the
// selection survives scrolling to its other edge.
export function useSelectionOutsidePress(
  hasPendingSelection: boolean,
  setPendingSelection: Dispatch<SetStateAction<TimelineSelection | null>>,
  timelineScrollRef: { current: HTMLDivElement | null },
) {
  useEffect(() => {
    if (!hasPendingSelection) {
      return;
    }

    let touch: {
      pointerId: number;
      x: number;
      y: number;
      time: number;
    } | null = null;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        event.button !== 0 ||
        !(target instanceof Element) ||
        target === timelineScrollRef.current ||
        !target.closest(".timeline-panel") ||
        target.closest(".timeline-selection")
      ) {
        return;
      }
      if (
        event.pointerType === "touch" &&
        target.closest(".app-shell--phone")
      ) {
        touch = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          time: event.timeStamp,
        };
        return;
      }
      setPendingSelection(null);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== touch?.pointerId) {
        return;
      }
      if (
        isTouchTap(
          event.clientX - touch.x,
          event.clientY - touch.y,
          event.timeStamp - touch.time,
        )
      ) {
        setPendingSelection(null);
      }
      touch = null;
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerId === touch?.pointerId) {
        touch = null;
      }
    };

    // Captured, so a row that stops the press still clears the selection.
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerCancel, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
    };
  }, [hasPendingSelection, setPendingSelection, timelineScrollRef]);
}
