import { type RefObject, useEffect, useRef, useState } from "react";
import {
  type DragScrollAxis,
  type DragScrollSample,
  type DragScrollVelocity,
  DRAG_SCROLL_MOMENTUM_MS,
  DRAG_SCROLL_VELOCITY_WINDOW_MS,
  dragScrollPosition,
  exceedsDragThreshold,
  momentumOffset,
  releaseVelocity,
  type ScrollPosition,
} from "./drag-scroll.ts";

type DragScrollOptions = {
  axis?: DragScrollAxis;
  // Whether a press (pointerdown, or the mousedown that follows it) may
  // start a pan: typically a background target, or the middle button.
  canStart: (event: MouseEvent) => boolean;
};

type Pan = {
  pointerId: number;
  startX: number;
  startY: number;
  origin: ScrollPosition;
  dragging: boolean;
  samples: DragScrollSample[];
};

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

// Hand-grab panning of the element in `ref`: a press that `canStart` allows
// and drags past a small threshold scrolls the element with the pointer,
// then flings on with a short momentum unless reduced motion is preferred.
// The middle button's autoscroll is suppressed, and the click that ends a
// pan is swallowed. Returns whether a pan is under way, for a grabbing
// cursor. Touch is left to the browser's native scrolling.
export function useDragScroll(
  ref: RefObject<HTMLElement | null>,
  { axis = "both", canStart }: DragScrollOptions,
) {
  const canStartRef = useRef(canStart);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    canStartRef.current = canStart;
  }, [canStart]);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    let pan: Pan | null = null;
    let frame = 0;
    let suppressClick = false;

    const stopMomentum = () => {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };

    const startMomentum = (velocity: DragScrollVelocity) => {
      if (
        (!velocity.x && !velocity.y) ||
        window.matchMedia?.(REDUCED_MOTION_QUERY).matches
      ) {
        return;
      }

      const origin = { left: element.scrollLeft, top: element.scrollTop };
      const start = performance.now();
      const tick = (now: number) => {
        const elapsed = now - start;
        const offset = momentumOffset(velocity, elapsed);
        element.scrollLeft = origin.left + offset.x;
        element.scrollTop = origin.top + offset.y;
        frame =
          elapsed < DRAG_SCROLL_MOMENTUM_MS ? requestAnimationFrame(tick) : 0;
      };
      frame = requestAnimationFrame(tick);
    };

    const handlePointerDown = (event: PointerEvent) => {
      suppressClick = false;
      if (
        pan ||
        !event.isPrimary ||
        event.pointerType === "touch" ||
        !canStartRef.current(event)
      ) {
        return;
      }

      stopMomentum();
      if (event.button === 1) {
        event.preventDefault();
      }
      element.setPointerCapture?.(event.pointerId);
      pan = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origin: { left: element.scrollLeft, top: element.scrollTop },
        dragging: false,
        samples: [
          { x: event.clientX, y: event.clientY, time: event.timeStamp },
        ],
      };
    };

    // Some browsers start middle-button autoscroll on mousedown even after
    // pointerdown was cancelled.
    const handleMouseDown = (event: MouseEvent) => {
      if (event.button === 1 && canStartRef.current(event)) {
        event.preventDefault();
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!pan || event.pointerId !== pan.pointerId) {
        return;
      }

      const dx = event.clientX - pan.startX;
      const dy = event.clientY - pan.startY;
      if (!pan.dragging) {
        if (!exceedsDragThreshold(dx, dy, axis)) {
          return;
        }
        pan.dragging = true;
        setDragging(true);
      }

      event.preventDefault();
      pan.samples = pan.samples.filter(
        (sample) =>
          event.timeStamp - sample.time <= DRAG_SCROLL_VELOCITY_WINDOW_MS,
      );
      pan.samples.push({
        x: event.clientX,
        y: event.clientY,
        time: event.timeStamp,
      });
      const next = dragScrollPosition(pan.origin, dx, dy, axis);
      element.scrollLeft = next.left;
      element.scrollTop = next.top;
    };

    const endPan = (event: PointerEvent) => {
      if (!pan || event.pointerId !== pan.pointerId) {
        return;
      }

      const ended = pan;
      pan = null;
      if (element.hasPointerCapture?.(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
      if (!ended.dragging) {
        return;
      }

      suppressClick = true;
      setDragging(false);
      if (event.type === "pointerup") {
        startMomentum(releaseVelocity(ended.samples, event.timeStamp, axis));
      }
    };

    // The click (or auxclick) a pan ends with is not a click on the target.
    const handleClick = (event: MouseEvent) => {
      if (suppressClick) {
        suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
      }
    };

    element.addEventListener("pointerdown", handlePointerDown);
    element.addEventListener("mousedown", handleMouseDown);
    element.addEventListener("pointermove", handlePointerMove);
    element.addEventListener("pointerup", endPan);
    element.addEventListener("pointercancel", endPan);
    element.addEventListener("lostpointercapture", endPan);
    element.addEventListener("click", handleClick, true);
    element.addEventListener("auxclick", handleClick, true);
    element.addEventListener("wheel", stopMomentum, { passive: true });
    return () => {
      stopMomentum();
      element.removeEventListener("pointerdown", handlePointerDown);
      element.removeEventListener("mousedown", handleMouseDown);
      element.removeEventListener("pointermove", handlePointerMove);
      element.removeEventListener("pointerup", endPan);
      element.removeEventListener("pointercancel", endPan);
      element.removeEventListener("lostpointercapture", endPan);
      element.removeEventListener("click", handleClick, true);
      element.removeEventListener("auxclick", handleClick, true);
      element.removeEventListener("wheel", stopMomentum);
    };
  }, [ref, axis]);

  return dragging;
}
