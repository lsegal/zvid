import { type MouseEvent, type PointerEvent, useRef } from "react";
import { SHEET_DRAG_SLOP } from "../app/sheet-drag.ts";

type SheetDragOptions = {
  // The finger is `dy` pixels below where it went down (negative above).
  onMove: (dy: number) => void;
  // The finger lifted `dy` pixels from where it went down, or the drag was
  // canceled (`dy` is 0).
  onRelease: (dy: number) => void;
};

// Pointer handlers that make an element a vertical drag handle for a
// sheet. A press only becomes a drag once it moves past the slop, so taps
// on the handle's buttons still click; a drag captures the pointer and
// swallows the click that follows it. The handle needs `touch-action:
// none`, or the browser takes the drag for scrolling or pull-to-refresh.
export function useSheetDrag({ onMove, onRelease }: SheetDragOptions) {
  const drag = useRef<{ pointerId: number; startY: number; moved: boolean }>(
    null,
  );
  const swallowsClick = useRef(false);

  function end(event: PointerEvent<HTMLElement>, dy: number) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) {
      return;
    }
    drag.current = null;
    if (current.moved) {
      swallowsClick.current = true;
      onRelease(dy);
    }
  }

  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (!event.isPrimary || event.button !== 0) {
        return;
      }
      swallowsClick.current = false;
      drag.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        moved: false,
      };
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) {
        return;
      }
      const dy = event.clientY - current.startY;
      if (!current.moved) {
        if (Math.abs(dy) < SHEET_DRAG_SLOP) {
          return;
        }
        current.moved = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      onMove(dy);
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      end(event, event.clientY - (drag.current?.startY ?? event.clientY));
    },
    onPointerCancel(event: PointerEvent<HTMLElement>) {
      end(event, 0);
    },
    onClickCapture(event: MouseEvent<HTMLElement>) {
      if (swallowsClick.current) {
        swallowsClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
}
