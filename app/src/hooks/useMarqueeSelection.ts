import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { SelectionItem } from "../app/multi-selection.ts";
import type { SourceSpan } from "../app/types.ts";
import { LANE_SELECTION_DRAG_THRESHOLD_PX } from "../lane-selection-gesture.ts";

// A box dragged out over the timeline, in viewport pixels.
export type MarqueeRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type Point = { x: number; y: number };

// While a marquee is drawn, the whole page shows the crosshair cursor.
export const MARQUEE_CURSOR_CLASS = "is-marquee-selecting";

/** The box between two corners, in either order. */
export function getMarqueeRect(a: Point, b: Point): MarqueeRect {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** Whether `bounds` and `rect` overlap. */
export function intersectsMarquee(
  bounds: Pick<DOMRect, "left" | "top" | "right" | "bottom">,
  rect: MarqueeRect,
) {
  return (
    bounds.right > rect.left &&
    bounds.left < rect.left + rect.width &&
    bounds.bottom > rect.top &&
    bounds.top < rect.top + rect.height
  );
}

/**
 * The layer clips and source clips under `rect` in `root`, as drawn. A
 * source clip's track comes from `spanTrackIds`.
 */
export function findMarqueeHits(
  root: ParentNode,
  rect: MarqueeRect,
  spanTrackIds: ReadonlyMap<string, string>,
): SelectionItem[] {
  const hits: SelectionItem[] = [];
  for (const element of root.querySelectorAll<HTMLElement>(
    ".clip-card[data-clip-id], .source-span[data-source-span-id]",
  )) {
    if (!intersectsMarquee(element.getBoundingClientRect(), rect)) {
      continue;
    }
    const { clipId, sourceSpanId } = element.dataset;
    if (clipId) {
      hits.push({ kind: "clip", id: clipId });
      continue;
    }
    const sourceTrackId = sourceSpanId && spanTrackIds.get(sourceSpanId);
    if (sourceSpanId && sourceTrackId) {
      hits.push({ kind: "span", id: sourceSpanId, sourceTrackId });
    }
  }
  return hits;
}

// The click that ends a marquee drag must not reach the row it ends on,
// which would select the row instead.
function swallowNextClick() {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  window.setTimeout(
    () => window.removeEventListener("click", swallow, { capture: true }),
    0,
  );
}

export type MarqueeSelectionInputs = {
  timelineScrollRef: RefObject<HTMLDivElement | null>;
  sourceSpans: readonly SourceSpan[];
  selectionItemsRef: RefObject<readonly SelectionItem[]>;
  applySelection: (items: readonly SelectionItem[]) => void;
};

// Marquee selection: an accent box with a crosshair cursor that selects
// every clip and source clip it touches as it is drawn. Dragging from empty
// space in a source track's row draws one, adding to the selection with
// Shift; a layer drag that leaves its layer draws one through `show` and
// `hide` (see useClipDrag).
export function useMarqueeSelection({
  timelineScrollRef,
  sourceSpans,
  selectionItemsRef,
  applySelection,
}: MarqueeSelectionInputs) {
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);
  const spanTrackIdsRef = useRef(new Map<string, string>());
  spanTrackIdsRef.current = new Map(
    sourceSpans.map((span) => [span.id, span.sourceTrackId]),
  );

  // Draws the box from `origin` to `point` and selects `base` and what it
  // touches.
  const show = useCallback(
    (origin: Point, point: Point, base: readonly SelectionItem[] = []) => {
      const rect = getMarqueeRect(origin, point);
      setMarqueeRect(rect);
      document.body.classList.add(MARQUEE_CURSOR_CLASS);
      applySelection([
        ...base,
        ...findMarqueeHits(
          timelineScrollRef.current ?? document,
          rect,
          spanTrackIdsRef.current,
        ),
      ]);
    },
    [applySelection, timelineScrollRef],
  );

  const hide = useCallback(() => {
    setMarqueeRect(null);
    document.body.classList.remove(MARQUEE_CURSOR_CLASS);
  }, []);

  useEffect(() => hide, [hide]);

  // A press on empty space in a source track's row draws a marquee once it
  // passes the click threshold; a press released before then is the row's
  // click, which selects the track.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const { target } = event;
      if (
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.pointerType === "touch" ||
        !(target instanceof HTMLElement) ||
        !target.classList.contains("track-row__content--source")
      ) {
        return;
      }

      // No text selection while dragging.
      event.preventDefault();
      const origin = { x: event.clientX, y: event.clientY };
      const base = event.shiftKey ? [...selectionItemsRef.current] : [];
      let dragging = false;
      const onPointerMove = (move: PointerEvent) => {
        if (move.pointerId !== event.pointerId) {
          return;
        }
        dragging ||=
          Math.max(
            Math.abs(move.clientX - origin.x),
            Math.abs(move.clientY - origin.y),
          ) > LANE_SELECTION_DRAG_THRESHOLD_PX;
        if (dragging) {
          show(origin, { x: move.clientX, y: move.clientY }, base);
        }
      };
      const onPointerEnd = (end: PointerEvent) => {
        if (end.pointerId !== event.pointerId) {
          return;
        }
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerEnd);
        window.removeEventListener("pointercancel", onPointerEnd);
        if (dragging) {
          hide();
          swallowNextClick();
        }
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerEnd);
      window.addEventListener("pointercancel", onPointerEnd);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [hide, selectionItemsRef, show]);

  return { marqueeRect, show, hide };
}

export type MarqueeSelection = ReturnType<typeof useMarqueeSelection>;
