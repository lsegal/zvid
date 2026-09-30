import { type RefObject, useEffect } from "react";

// A vertical wheel scrolls the chain sideways. React registers wheel
// listeners as passive, so preventDefault needs a native listener. Knobs
// handle their own wheel events and cancel them first.
export function useWheelScrollX(scrollRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        Math.abs(event.deltaY) <= Math.abs(event.deltaX)
      ) {
        return;
      }

      const maxScroll = scroller.scrollWidth - scroller.clientWidth;
      if (maxScroll <= 0) {
        return;
      }

      const scale =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? scroller.clientWidth
            : 1;
      event.preventDefault();
      scroller.scrollLeft += event.deltaY * scale;
    };

    scroller.addEventListener("wheel", handleWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", handleWheel);
  }, [scrollRef]);
}
