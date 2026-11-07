import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useLayoutEffect,
  useRef,
} from "react";
import { type DragScrollMove, useDragScroll } from "../../use-drag-scroll";
import { anchoredTimelineScrollLeft, timelineDragZoom } from "../../zoom";
import { usePrefersReducedMotion } from "../MediaSyncSkeleton";

// Panning the piano roll by middle-dragging its grid, with the main timeline's
// threshold and momentum.
export function usePianoRollPan(scrollRef: RefObject<HTMLElement | null>) {
  const reducedMotion = usePrefersReducedMotion();
  return useDragScroll({
    scrollRef,
    canStart: (event) => event.button === 1,
    axis: "both",
    momentum: !reducedMotion,
  });
}

type PianoRollRulerPanOptions = {
  scrollRef: RefObject<HTMLElement | null>;
  // Whether a press starts a pan at all, and whether it can zoom as well.
  canStart: (event: { button: number; ctrlKey: boolean; target: unknown }) => boolean;
  isZoomPress: (event: { button: number; ctrlKey: boolean }) => boolean;
  viewQ: number;
  quarterPx: number;
  zoom: number;
  onZoom: (zoom: number) => void;
};

// Panning the piano roll by dragging its ruler, left and right, and zooming it
// the way the main timeline's ruler does when a zoom press moves up or down.
export function usePianoRollRulerPan({
  scrollRef,
  canStart,
  isZoomPress,
  viewQ,
  quarterPx,
  zoom,
  onZoom,
}: PianoRollRulerPanOptions) {
  const reducedMotion = usePrefersReducedMotion();
  // The zoom at the press, and the width of what scrolls before the ruler.
  const zoomDragRef = useRef<{
    zoom: number;
    quarterPx: number;
    labelWidth: number;
  } | null>(null);
  // The scroll a zoom wants, put back once the new zoom has laid out so it
  // isn't clamped to the old roll width.
  const zoomScrollRef = useRef<{ zoom: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const pending = zoomScrollRef.current;
    if (scroller && pending?.zoom === zoom) {
      scroller.scrollLeft = pending.left;
    }
  }, [scrollRef, zoom]);

  return useDragScroll({
    scrollRef,
    canStart,
    axis: "x",
    thresholdAxis: "both",
    momentum: !reducedMotion,
    onStart(event: ReactPointerEvent<HTMLElement>) {
      const scroller = scrollRef.current;
      zoomDragRef.current =
        scroller && isZoomPress(event)
          ? {
              zoom,
              quarterPx,
              labelWidth:
                event.currentTarget.getBoundingClientRect().left -
                scroller.getBoundingClientRect().left +
                scroller.scrollLeft,
            }
          : null;
    },
    onDrag({ dx, dy, clientX, startX, origin }: DragScrollMove) {
      const zoomDrag = zoomDragRef.current;
      const scroller = scrollRef.current;
      if (!zoomDrag || !scroller) {
        return { left: origin.left - dx, top: origin.top };
      }
      const nextZoom = timelineDragZoom(zoomDrag.zoom, -dy);
      const { labelWidth } = zoomDrag;
      const viewLeft = scroller.getBoundingClientRect().left;
      // The time under the pointer at the press follows the pointer.
      const left = anchoredTimelineScrollLeft({
        anchorQ:
          (origin.left - labelWidth + startX - viewLeft) / zoomDrag.quarterPx,
        pointerX: clientX - viewLeft,
        quarterPx: (zoomDrag.quarterPx * nextZoom) / zoomDrag.zoom,
        labelWidth,
        totalQuarters: viewQ,
        clientWidth: scroller.clientWidth,
      });
      zoomScrollRef.current = { zoom: nextZoom, left };
      onZoom(nextZoom);
      return { left, top: origin.top };
    },
    onEnd() {
      zoomDragRef.current = null;
      zoomScrollRef.current = null;
    },
  });
}
