import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type DragScrollAxis,
  type DragScrollSample,
  type DragScrollVelocity,
  dragScrollPosition,
  exceedsDragThreshold,
  releaseVelocity,
  type ScrollPosition,
  stepMomentum,
} from "./drag-scroll.ts";

type DragScrollOptions = {
  // The element that scrolls; it may be an ancestor of the one dragged.
  scrollRef: RefObject<HTMLElement | null>;
  // Whether a press starts a pending pan, such as a particular button.
  canStart: (event: ReactMouseEvent<HTMLElement>) => boolean;
  axis?: DragScrollAxis;
  // Keep scrolling after release; turn off for reduced motion.
  momentum?: boolean;
};

type PendingPan = {
  pointerId: number;
  startX: number;
  startY: number;
  origin: ScrollPosition;
  dragging: boolean;
  samples: DragScrollSample[];
};

// Hand-grab panning: pressing where `canStart` allows and dragging past a
// small threshold scrolls `scrollRef` with the pointer, with momentum on
// release unless `momentum` is off. Spread `handlers` on the grabbed
// element and show a grabbing cursor while `isGrabbing`.
export function useDragScroll({
  scrollRef,
  canStart,
  axis = "both",
  momentum = true,
}: DragScrollOptions) {
  const panRef = useRef<PendingPan | null>(null);
  const momentumFrameRef = useRef<number | null>(null);
  // Set when a pan ends so the contextmenu that follows a right-drag is
  // swallowed rather than opening a menu.
  const draggedRef = useRef(false);
  const [isGrabbing, setIsGrabbing] = useState(false);

  const stopMomentum = useCallback(() => {
    if (momentumFrameRef.current !== null) {
      cancelAnimationFrame(momentumFrameRef.current);
      momentumFrameRef.current = null;
    }
  }, []);

  useEffect(() => stopMomentum, [stopMomentum]);

  const startMomentum = useCallback(
    (initial: DragScrollVelocity) => {
      const scroll = scrollRef.current;
      if (!scroll || !momentum) {
        return;
      }

      let velocity = initial;
      let last = performance.now();
      const tick = (now: number) => {
        const step = stepMomentum(velocity, Math.max(0, now - last));
        last = now;
        if (!step) {
          momentumFrameRef.current = null;
          return;
        }

        scroll.scrollLeft += step.dx;
        scroll.scrollTop += step.dy;
        velocity = step.velocity;
        momentumFrameRef.current = requestAnimationFrame(tick);
      };
      momentumFrameRef.current = requestAnimationFrame(tick);
    },
    [momentum, scrollRef],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const scroll = scrollRef.current;
      if (!scroll || panRef.current || !canStart(event)) {
        return;
      }

      event.preventDefault();
      stopMomentum();
      draggedRef.current = false;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      panRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origin: { left: scroll.scrollLeft, top: scroll.scrollTop },
        dragging: false,
        samples: [
          { x: event.clientX, y: event.clientY, time: event.timeStamp },
        ],
      };
    },
    [canStart, scrollRef, stopMomentum],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const pan = panRef.current;
      const scroll = scrollRef.current;
      if (!pan || !scroll || event.pointerId !== pan.pointerId) {
        return;
      }

      const dx = event.clientX - pan.startX;
      const dy = event.clientY - pan.startY;
      if (!pan.dragging) {
        if (!exceedsDragThreshold(dx, dy, axis)) {
          return;
        }
        pan.dragging = true;
        setIsGrabbing(true);
      }

      event.preventDefault();
      pan.samples.push({
        x: event.clientX,
        y: event.clientY,
        time: event.timeStamp,
      });
      const next = dragScrollPosition(pan.origin, dx, dy, axis);
      scroll.scrollLeft = next.left;
      scroll.scrollTop = next.top;
    },
    [axis, scrollRef],
  );

  const endPan = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const pan = panRef.current;
      if (!pan || event.pointerId !== pan.pointerId) {
        return;
      }

      panRef.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (!pan.dragging) {
        return;
      }

      draggedRef.current = true;
      setIsGrabbing(false);
      if (event.type === "pointerup") {
        startMomentum(releaseVelocity(pan.samples, event.timeStamp, axis));
      }
    },
    [axis, startMomentum],
  );

  // Keeps the middle button from starting the browser's autoscroll, which
  // some browsers begin on mousedown even after pointerdown was cancelled.
  const onMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (event.button === 1 && canStart(event)) {
        event.preventDefault();
      }
    },
    [canStart],
  );

  // Swallows the contextmenu a right-drag ends with. Returns whether it did.
  const onContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!draggedRef.current && !panRef.current?.dragging) {
      return false;
    }

    draggedRef.current = false;
    event.preventDefault();
    return true;
  }, []);

  return {
    isGrabbing,
    onContextMenu,
    handlers: {
      onMouseDown,
      onPointerDown,
      onPointerMove,
      onPointerUp: endPan,
      onPointerCancel: endPan,
      onLostPointerCapture: endPan,
    },
  };
}
