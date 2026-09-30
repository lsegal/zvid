import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
} from "react";
import { BASE_QUARTER_PX } from "../app/constants.ts";
import type { getShortcutLabels } from "../app/shortcut-labels.ts";
import { isContextMenuPress } from "../context-menu.ts";
import { isRulerPanPress, isTimelinePanPress } from "../drag-scroll.ts";
import type { createSpaceHold } from "../space-shortcut";
import { type DragScrollMove, useDragScroll } from "../use-drag-scroll";
import { anchoredTimelineScrollLeft, timelineDragZoom } from "../zoom";

export type RulerGesturesInputs = {
  shortcutLabels: ReturnType<typeof getShortcutLabels>;
  resolvedZoom: number;
  labelWidth: number;
  totalQuarters: number;
  prefersReducedMotion: boolean;
  timelineScrollRef: RefObject<HTMLDivElement | null>;
  spaceHoldRef: { current: ReturnType<typeof createSpaceHold> };
  updateZoomDraft: (nextZoom: number | null) => void;
  flushZoomDraft: (label?: string) => void;
};

// Panning and zooming the timeline by dragging: the ruler's pan and zoom
// drag, and the middle-drag or Space + left-drag pan over the whole timeline.
export function useRulerGestures({
  shortcutLabels,
  resolvedZoom,
  labelWidth,
  totalQuarters,
  prefersReducedMotion,
  timelineScrollRef,
  spaceHoldRef,
  updateZoomDraft,
  flushZoomDraft,
}: RulerGesturesInputs) {
  // Right-, Ctrl- (macOS) or middle-dragging the ruler pans the timeline;
  // the left button only scrubs the playhead. A right- or Ctrl-drag also
  // zooms when it moves up or down, around the time under the pointer.
  const canStartRulerPan = useCallback(
    (event: { button: number; ctrlKey: boolean }) =>
      isRulerPanPress(event, shortcutLabels.mac),
    [shortcutLabels.mac],
  );
  const rulerZoomRef = useRef<{ originZoom: number } | null>(null);
  // The scroll a ruler zoom wants, put back once the new zoom has laid out
  // so it isn't clamped to the old timeline width.
  const rulerZoomScrollRef = useRef<{ zoom: number; left: number } | null>(
    null,
  );
  const startRulerPan = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      rulerZoomRef.current = isContextMenuPress(event, shortcutLabels.mac)
        ? { originZoom: resolvedZoom }
        : null;
    },
    [resolvedZoom, shortcutLabels.mac],
  );
  const dragRuler = useCallback(
    ({ dx, dy, clientX, startX, origin }: DragScrollMove) => {
      const rulerZoom = rulerZoomRef.current;
      const timelineScroll = timelineScrollRef.current;
      if (!rulerZoom || !timelineScroll) {
        return { left: origin.left - dx, top: origin.top };
      }

      const nextZoom = timelineDragZoom(rulerZoom.originZoom, -dy);
      const viewLeft = timelineScroll.getBoundingClientRect().left;
      // The time under the pointer at the press follows the pointer.
      const anchorQ =
        (origin.left - labelWidth + startX - viewLeft) /
        (BASE_QUARTER_PX * rulerZoom.originZoom);
      const left = anchoredTimelineScrollLeft({
        anchorQ,
        pointerX: clientX - viewLeft,
        quarterPx: BASE_QUARTER_PX * nextZoom,
        labelWidth,
        totalQuarters,
        clientWidth: timelineScroll.clientWidth,
      });
      rulerZoomScrollRef.current = { zoom: nextZoom, left };
      updateZoomDraft(nextZoom);
      return { left, top: origin.top };
    },
    [labelWidth, timelineScrollRef, totalQuarters, updateZoomDraft],
  );
  const endRulerPan = useCallback(() => {
    if (!rulerZoomRef.current) {
      return;
    }

    rulerZoomRef.current = null;
    rulerZoomScrollRef.current = null;
    flushZoomDraft();
  }, [flushZoomDraft]);
  const rulerDragScroll = useDragScroll({
    scrollRef: timelineScrollRef,
    canStart: canStartRulerPan,
    axis: "x",
    momentum: !prefersReducedMotion,
    onStart: startRulerPan,
    thresholdAxis: "both",
    onDrag: dragRuler,
    onEnd: endRulerPan,
  });

  useLayoutEffect(() => {
    const timelineScroll = timelineScrollRef.current;
    const pending = rulerZoomScrollRef.current;
    if (timelineScroll && pending?.zoom === resolvedZoom) {
      timelineScroll.scrollLeft = pending.left;
    }
  }, [resolvedZoom, timelineScrollRef]);

  // Middle-drag, or Space + left-drag, pans the timeline from anywhere in it,
  // including over clips. The press is claimed before lane, clip and ruler
  // handlers see it, so a pan never selects, edits clips or moves the playhead.
  const canStartTimelinePan = useCallback(
    (event: { button: number }) =>
      isTimelinePanPress(event, spaceHoldRef.current.held),
    [spaceHoldRef],
  );
  const markSpacePanned = useCallback(
    (event: { button: number }) => {
      if (event.button === 0) {
        spaceHoldRef.current.markPanned();
      }
    },
    [spaceHoldRef],
  );
  const timelineDragScroll = useDragScroll({
    scrollRef: timelineScrollRef,
    canStart: canStartTimelinePan,
    axis: "both",
    momentum: !prefersReducedMotion,
    capture: true,
    onStart: markSpacePanned,
  });

  return { rulerDragScroll, timelineDragScroll };
}
