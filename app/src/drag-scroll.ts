// Hand-grab scrolling for any scroll container: a pointer press that the
// caller accepts drags the content 1:1 with the pointer and flings on release.
// Framework-free so it can be unit tested; `useDragScroll` wraps it for React.

export type DragScrollAxis = "x" | "y" | "both";

export type DragScrollElement = Pick<
  HTMLElement,
  | "scrollLeft"
  | "scrollTop"
  | "addEventListener"
  | "removeEventListener"
  | "setPointerCapture"
  | "releasePointerCapture"
  | "hasPointerCapture"
  | "classList"
>;

export type DragScrollOptions = {
  axis?: DragScrollAxis;
  // Decides whether a press starts a pan. Accepted presses are claimed in the
  // capture phase, so handlers inside the container never see them.
  canStart: (event: PointerEvent) => boolean;
  onStart?: (event: PointerEvent) => void;
  onEnd?: () => void;
  // Block the browser's middle-click autoscroll and paste inside the element.
  suppressMiddleClick?: boolean;
  // Class set on the element while the pointer is down.
  draggingClass?: string;
  reducedMotion?: () => boolean;
  now?: () => number;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
};

export const MIDDLE_BUTTON = 1;
export const DRAG_SCROLL_DRAGGING_CLASS = "is-drag-scrolling";

// Velocity is measured over the last stretch of the drag, and a pause longer
// than the idle window before release cancels the fling.
const VELOCITY_WINDOW_MS = 100;
const RELEASE_IDLE_MS = 50;
// Per-16ms decay of the fling velocity, and the speed (px/ms) it stops at.
const FRICTION = 0.95;
const MIN_FLING_SPEED = 0.02;

type Sample = { t: number; x: number; y: number };

// Scroll offset for a pointer that has moved from `start` to `current`, with
// the content following the pointer.
export function dragScrollPosition(
  axis: DragScrollAxis,
  origin: { left: number; top: number },
  start: { x: number; y: number },
  current: { x: number; y: number },
) {
  return {
    left: axis === "y" ? origin.left : origin.left - (current.x - start.x),
    top: axis === "x" ? origin.top : origin.top - (current.y - start.y),
  };
}

// Pointer velocity (px/ms) over the samples inside the velocity window, or
// zero when the pointer had come to rest before `releaseAt`.
export function releaseVelocity(samples: Sample[], releaseAt: number) {
  const last = samples.at(-1);
  if (!last || releaseAt - last.t > RELEASE_IDLE_MS) {
    return { x: 0, y: 0 };
  }

  const first =
    samples.find((sample) => last.t - sample.t <= VELOCITY_WINDOW_MS) ?? last;
  const elapsed = last.t - first.t;
  if (elapsed <= 0) {
    return { x: 0, y: 0 };
  }

  return { x: (last.x - first.x) / elapsed, y: (last.y - first.y) / elapsed };
}

function defaultReducedMotion() {
  return (
    globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
}

export function attachDragScroll(
  element: DragScrollElement,
  options: DragScrollOptions,
) {
  const axis = options.axis ?? "both";
  const draggingClass = options.draggingClass ?? DRAG_SCROLL_DRAGGING_CLASS;
  const now = options.now ?? (() => performance.now());
  const requestFrame =
    options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
  const cancelFrame =
    options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));
  const reducedMotion = options.reducedMotion ?? defaultReducedMotion;

  let drag: {
    pointerId: number;
    origin: { left: number; top: number };
    start: { x: number; y: number };
    samples: Sample[];
  } | null = null;
  let flingFrame: number | null = null;

  const stopFling = () => {
    if (flingFrame !== null) {
      cancelFrame(flingFrame);
      flingFrame = null;
    }
  };

  const fling = (velocity: { x: number; y: number }) => {
    let vx = axis === "y" ? 0 : velocity.x;
    let vy = axis === "x" ? 0 : velocity.y;
    let last = now();
    const step = () => {
      const t = now();
      const dt = Math.max(t - last, 1);
      last = t;
      const left = element.scrollLeft;
      const top = element.scrollTop;
      element.scrollLeft = left - vx * dt;
      element.scrollTop = top - vy * dt;
      // Stop an axis once it hits the edge of the content.
      if (element.scrollLeft === left) vx = 0;
      if (element.scrollTop === top) vy = 0;
      const decay = FRICTION ** (dt / 16);
      vx *= decay;
      vy *= decay;
      if (Math.hypot(vx, vy) < MIN_FLING_SPEED) {
        flingFrame = null;
        return;
      }
      flingFrame = requestFrame(step);
    };
    if (Math.hypot(vx, vy) >= MIN_FLING_SPEED) {
      flingFrame = requestFrame(step);
    }
  };

  const onPointerDown = (event: PointerEvent) => {
    stopFling();
    if (drag || !options.canStart(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // The pointer may already be gone; the drag still tracks moves.
    }
    drag = {
      pointerId: event.pointerId,
      origin: { left: element.scrollLeft, top: element.scrollTop },
      start: { x: event.clientX, y: event.clientY },
      samples: [{ t: now(), x: event.clientX, y: event.clientY }],
    };
    element.classList.toggle(draggingClass, true);
    options.onStart?.(event);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (drag?.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const t = now();
    drag.samples.push({ t, x: event.clientX, y: event.clientY });
    while (
      drag.samples.length > 2 &&
      t - drag.samples[0].t > VELOCITY_WINDOW_MS
    ) {
      drag.samples.shift();
    }
    const next = dragScrollPosition(axis, drag.origin, drag.start, {
      x: event.clientX,
      y: event.clientY,
    });
    element.scrollLeft = next.left;
    element.scrollTop = next.top;
  };

  const endDrag = (event: PointerEvent, allowFling: boolean) => {
    if (drag?.pointerId !== event.pointerId) {
      return;
    }

    const { samples, pointerId } = drag;
    drag = null;
    element.classList.toggle(draggingClass, false);
    if (element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
    options.onEnd?.();
    if (allowFling && !reducedMotion()) {
      fling(releaseVelocity(samples, now()));
    }
  };

  const onPointerUp = (event: PointerEvent) => endDrag(event, true);
  const onPointerCancel = (event: PointerEvent) => endDrag(event, false);

  const suppressMiddle = (event: MouseEvent) => {
    if (event.button === MIDDLE_BUTTON) {
      event.preventDefault();
    }
  };

  element.addEventListener("pointerdown", onPointerDown, true);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", onPointerUp);
  element.addEventListener("pointercancel", onPointerCancel);
  element.addEventListener("lostpointercapture", onPointerCancel);
  element.addEventListener("wheel", stopFling, { passive: true });
  if (options.suppressMiddleClick) {
    element.addEventListener("mousedown", suppressMiddle, true);
    element.addEventListener("mouseup", suppressMiddle, true);
    element.addEventListener("auxclick", suppressMiddle, true);
  }

  return () => {
    stopFling();
    if (drag) {
      element.classList.toggle(draggingClass, false);
      drag = null;
    }
    element.removeEventListener("pointerdown", onPointerDown, true);
    element.removeEventListener("pointermove", onPointerMove);
    element.removeEventListener("pointerup", onPointerUp);
    element.removeEventListener("pointercancel", onPointerCancel);
    element.removeEventListener("lostpointercapture", onPointerCancel);
    element.removeEventListener("wheel", stopFling);
    if (options.suppressMiddleClick) {
      element.removeEventListener("mousedown", suppressMiddle, true);
      element.removeEventListener("mouseup", suppressMiddle, true);
      element.removeEventListener("auxclick", suppressMiddle, true);
    }
  };
}
