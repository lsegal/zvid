import { type Dispatch, type SetStateAction, useEffect } from "react";
import type { TimelineSelection } from "../app/types.ts";

// A primary press anywhere in the timeline panel outside the uncommitted
// selection clears it: on lane space, clips, the ruler or another row. A
// press inside it moves or resizes it instead, and a press on the timeline's
// scrollbars keeps it.
export function useSelectionOutsidePress(
  hasPendingSelection: boolean,
  setPendingSelection: Dispatch<SetStateAction<TimelineSelection | null>>,
  timelineScrollRef: { current: HTMLDivElement | null },
) {
  useEffect(() => {
    if (!hasPendingSelection) {
      return;
    }

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
      setPendingSelection(null);
    };

    // Captured, so a row that stops the press still clears the selection.
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [hasPendingSelection, setPendingSelection, timelineScrollRef]);
}
