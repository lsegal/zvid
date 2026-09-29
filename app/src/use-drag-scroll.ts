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
  // Claim accepted presses in the capture phase so handlers inside the
  // grabbed element never see them. The handlers then use capture names.
  capture?: boolean;
  // Called when a press is claimed for a pan.
  onStart?: (event: ReactPointerEvent<HTMLElement>) => void;
  // Movement along this axis also turns a press into a drag, for an
  // `onDrag` that reads it; defaults to `axis`.
  thresholdAxis?: DragScrollAxis;
  // Places the scroll on each move of a drag instead of following the
  // pointer 1:1, such as to zoom as well as pan.
  onDrag?: (drag: DragScrollMove) => ScrollPosition;
  // Called once a claimed press ends, whether or not it became a drag.
  onEnd?: () => void;
};

export type DragScrollMove = {
  // The pointer's offset since the press.
  dx: number;
  dy: number;
  // The pointer's viewport position now and at the press.
  clientX: number;
  startX: number;
  // The scroll position at the press.
  origin: ScrollPosition;
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
  capture = false,
  onStart,
  thresholdAxis = axis,
  onDrag,
  onEnd,
}: DragScrollOptions) {
  const panRef = useRef<PendingPan | null>(null);
  const momentumFrameRef = useRef<number | null>(null);
  // Set when a pan ends so the contextmenu that follows a right-drag is
  // swallowed rather than opening a menu.
  const draggedRef = useRef(false);
  // Removes the window listener that swallows that contextmenu when the
  // drag is released off the grabbed element.
  const disarmMenuRef = useRef<(() => void) | null>(null);
  const [isGrabbing, setIsGrabbing] = useState(false);

  useEffect(() => () => disarmMenuRef.current?.(), []);

  // Swallows the next contextmenu anywhere, until the next press, so
  // neither the browser's menu nor one under the pointer opens.
  const armMenuSwallow = useCallback(() => {
    disarmMenuRef.current?.();
    const swallow = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      disarm();
    };
    const disarm = () => {
      window.removeEventListener("contextmenu", swallow, true);
      window.removeEventListener("pointerdown", disarm, true);
      disarmMenuRef.current = null;
    };
    window.addEventListener("contextmenu", swallow, true);
    window.addEventListener("pointerdown", disarm, true);
    disarmMenuRef.current = disarm;
  }, []);

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
      if (capture) {
        event.stopPropagation();
      }
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
      onStart?.(event);
    },
    [canStart, capture, onStart, scrollRef, stopMomentum],
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
        if (!exceedsDragThreshold(dx, dy, thresholdAxis)) {
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
      const next = onDrag
        ? onDrag({
            dx,
            dy,
            clientX: event.clientX,
            startX: pan.startX,
            origin: pan.origin,
          })
        : dragScrollPosition(pan.origin, dx, dy, axis);
      scroll.scrollLeft = next.left;
      scroll.scrollTop = next.top;
    },
    [axis, onDrag, scrollRef, thresholdAxis],
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
      onEnd?.();
      if (!pan.dragging) {
        return;
      }

      draggedRef.current = true;
      setIsGrabbing(false);
      if (event.type === "pointerup") {
        armMenuSwallow();
        startMomentum(releaseVelocity(pan.samples, event.timeStamp, axis));
      }
    },
    [armMenuSwallow, axis, onEnd, startMomentum],
  );

  // Keeps the middle button from starting the browser's autoscroll, which
  // some browsers begin on mousedown even after pointerdown was cancelled.
  const onMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (event.button === 1 && canStart(event)) {
        event.preventDefault();
        if (capture) {
          event.stopPropagation();
        }
      }
    },
    [canStart, capture],
  );

  // Keeps a middle click from pasting (Linux) or opening links.
  const onAuxClick = useCallback(
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
      ...(capture
        ? {
            onMouseDownCapture: onMouseDown,
            onPointerDownCapture: onPointerDown,
            onAuxClickCapture: onAuxClick,
          }
        : { onMouseDown, onPointerDown, onAuxClick }),
      onPointerMove,
      onPointerUp: endPan,
      onPointerCancel: endPan,
      onLostPointerCapture: endPan,
    },
  };
}
