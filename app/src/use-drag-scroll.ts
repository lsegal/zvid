import { type RefObject, useEffect, useRef } from "react";
import { attachDragScroll, type DragScrollOptions } from "./drag-scroll";

// Hand-grab scrolling for the element in `ref`. The latest options are read on
// every press, so callers can pass inline callbacks without re-attaching.
export function useDragScroll(
  ref: RefObject<HTMLElement | null>,
  options: DragScrollOptions,
) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const { axis, suppressMiddleClick, draggingClass } = options;

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    return attachDragScroll(element, {
      axis,
      suppressMiddleClick,
      draggingClass,
      canStart: (event) => optionsRef.current.canStart(event),
      onStart: (event) => optionsRef.current.onStart?.(event),
      onEnd: () => optionsRef.current.onEnd?.(),
    });
  }, [ref, axis, suppressMiddleClick, draggingClass]);
}
