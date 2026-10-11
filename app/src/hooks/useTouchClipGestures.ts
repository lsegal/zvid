import { type RefObject, useEffect, useRef } from "react";
import {
  getClipDurationQ,
  getTimelinePointerX,
  pointerToTimelineQ,
  snapQuarterValue,
} from "../app/timeline-math.ts";
import type {
  ArrangementClip,
  ClipMenuState,
  DragState,
  TimelineSelection,
} from "../app/types.ts";
import { clamp } from "../app/util.ts";
import { buildSelection } from "../lane-selection-gesture.ts";
import { exceedsTouchSlop, LONG_PRESS_MS } from "../mobile/timeline-touch.ts";

// The layer rows' timeline space, where touches are taken over. Labels,
// trim handles, the ruler and the source tracks keep their own handling.
const ARRANGEMENT_SPACE = ".track-row__content--arrangement";
// Trim handles and a selection's edge handles take their own presses.
const EDGE_HANDLE = ".clip-card__handle, .timeline-selection__handle";
const SELECTION = ".timeline-selection";
const LIFTED_CLASS = "clip-card--lifted";

export type TouchClipGesturesInputs = {
  enabled: boolean;
  timelineScrollRef: RefObject<HTMLDivElement | null>;
  timelineClips: ArrangementClip[];
  bpm: number;
  pendingSelection: TimelineSelection | null;
  labelWidth: number;
  quarterPx: number;
  totalQuarters: number;
  snapUnit: number;
  snapEnabled: boolean;
  // The shortest selection, as a drag on desktop draws.
  minimumSelectionQ: number;
  setSelectedClipId: (clipId: string | undefined) => void;
  setSelectedLaneId: (laneId: string | undefined) => void;
  setPendingSelection: (selection: TimelineSelection | null) => void;
  setDragPreviewClips: (clips: null) => void;
  setDragState: (state: DragState | null) => void;
  setClipMenu: (menu: ClipMenuState | null) => void;
};

type Press = {
  pointerId: number;
  startX: number;
  startY: number;
  clipId: string | undefined;
  laneId: string | undefined;
  // Pressed inside the lane's selection, outside a clip's own handling.
  onSelection: boolean;
  moved: boolean;
  held: boolean;
  timer: number;
};

// Touch on the mobile timeline. A swipe scrolls (and so scrubs, see
// useCenterPlayhead) instead of moving a clip or drawing a selection; a tap
// selects. Holding still buzzes where the platform can, then: on a clip it
// picks the clip up, and dragging moves it, while letting go without moving
// opens its menu; on empty lane space it starts a selection there, and
// dragging stretches it; on the selection it picks the selection up to
// move it, and letting go without moving opens its menu, as a tap does.
export function useTouchClipGestures({
  enabled,
  timelineScrollRef,
  timelineClips,
  bpm,
  pendingSelection,
  labelWidth,
  quarterPx,
  totalQuarters,
  snapUnit,
  snapEnabled,
  minimumSelectionQ,
  setSelectedClipId,
  setSelectedLaneId,
  setPendingSelection,
  setDragPreviewClips,
  setDragState,
  setClipMenu,
}: TouchClipGesturesInputs) {
  const latestRef = useRef({
    timelineClips,
    bpm,
    pendingSelection,
    labelWidth,
    quarterPx,
    totalQuarters,
    snapUnit,
    snapEnabled,
    minimumSelectionQ,
    setSelectedClipId,
    setSelectedLaneId,
    setPendingSelection,
    setDragPreviewClips,
    setDragState,
    setClipMenu,
  });
  latestRef.current = {
    timelineClips,
    bpm,
    pendingSelection,
    labelWidth,
    quarterPx,
    totalQuarters,
    snapUnit,
    snapEnabled,
    minimumSelectionQ,
    setSelectedClipId,
    setSelectedLaneId,
    setPendingSelection,
    setDragPreviewClips,
    setDragState,
    setClipMenu,
  };

  useEffect(() => {
    const scroll = timelineScrollRef.current;
    if (!enabled || !scroll) {
      return;
    }

    let press: Press | null = null;
    // Android follows a long press with a contextmenu event; the hold
    // already handled it.
    let suppressContextMenu = false;
    // A held press opens a sheet on release; the click the browser would
    // follow it with would land on the sheet's backdrop and close it.
    let suppressClick = false;

    const liftedCard = (clipId: string | undefined) =>
      clipId
        ? scroll.querySelector<HTMLElement>(
            `.clip-card[data-clip-id="${CSS.escape(clipId)}"]`,
          )
        : null;
    const endPress = () => {
      if (!press) {
        return;
      }
      window.clearTimeout(press.timer);
      liftedCard(press.clipId)?.classList.remove(LIFTED_CLASS);
      press = null;
    };

    const startHold = (current: Press) => {
      current.held = true;
      suppressContextMenu = true;
      navigator.vibrate?.(12);
    };

    const hold = () => {
      const current = press;
      if (!current || current.moved) {
        return;
      }
      if (current.clipId) {
        pickUp(current, current.clipId);
      } else if (current.onSelection) {
        pickUpSelection(current);
      } else if (current.laneId) {
        startSelection(current, current.laneId);
      }
    };

    // The selection starts as the shortest one at the snapped time under
    // the finger, so the hold shows at once, and stretches as it drags.
    const startSelection = (current: Press, laneId: string) => {
      const latest = latestRef.current;
      const anchorQ = snapQuarterValue(
        clamp(
          pointerToTimelineQ(
            getTimelinePointerX(scroll, current.startX),
            scroll.scrollLeft,
            latest.labelWidth,
            latest.quarterPx,
          ),
          0,
          latest.totalQuarters,
        ),
        latest.snapUnit,
        latest.snapEnabled,
      );
      startHold(current);
      latest.setSelectedClipId(undefined);
      latest.setSelectedLaneId(laneId);
      latest.setDragPreviewClips(null);
      latest.setPendingSelection({
        id: `selection-${laneId}`,
        laneId,
        ...buildSelection(anchorQ, anchorQ, latest.minimumSelectionQ),
      });
      latest.setDragState({
        kind: "selection",
        pointerId: current.pointerId,
        laneId,
        gesture: { anchorQ, pointerStartX: current.startX, dragging: true },
      });
    };

    const pickUpSelection = (current: Press) => {
      const latest = latestRef.current;
      if (!latest.pendingSelection) {
        return;
      }
      startHold(current);
      latest.setDragState({
        kind: "selection-edit",
        pointerId: current.pointerId,
        edit: "move",
        pointerStartX: current.startX,
        pointerStartY: current.startY,
        origin: latest.pendingSelection,
        dragging: false,
      });
    };

    const pickUp = (current: Press, clipId: string) => {
      const latest = latestRef.current;
      const clip = latest.timelineClips.find((item) => item.id === clipId);
      if (!clip) {
        return;
      }
      startHold(current);
      liftedCard(clip.id)?.classList.add(LIFTED_CLASS);
      latest.setPendingSelection(null);
      latest.setDragPreviewClips(null);
      latest.setSelectedClipId(clip.id);
      latest.setDragState({
        kind: "move",
        pointerId: current.pointerId,
        clipId: clip.id,
        sourceClipId: clip.id,
        pointerStartX: current.startX,
        originStartQ: clip.startQ,
        originDurationQ: getClipDurationQ(clip, latest.bpm),
        originLaneId: clip.laneId,
        duplicateOnDrag: false,
        jumpOnClick: false,
      });
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || !event.isPrimary) {
        return;
      }
      const target = event.target as Element | null;
      const space = target?.closest(ARRANGEMENT_SPACE);
      if (!space || target?.closest(EDGE_HANDLE)) {
        return;
      }

      // Keeps lane selections and immediate clip drags from starting, so
      // the browser can scroll.
      event.stopPropagation();
      endPress();
      suppressContextMenu = false;
      const clipId =
        target?.closest<HTMLElement>(".clip-card")?.dataset.clipId ?? undefined;
      press = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        clipId,
        laneId:
          space.closest<HTMLElement>("[data-timeline-lane-id]")?.dataset
            .timelineLaneId ?? undefined,
        onSelection: !clipId && Boolean(target?.closest(SELECTION)),
        moved: false,
        held: false,
        timer: window.setTimeout(hold, LONG_PRESS_MS),
      };
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!press || event.pointerId !== press.pointerId || press.moved) {
        return;
      }
      if (
        exceedsTouchSlop(
          event.clientX - press.startX,
          event.clientY - press.startY,
        )
      ) {
        press.moved = true;
        window.clearTimeout(press.timer);
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      const current = press;
      if (!current || event.pointerId !== current.pointerId) {
        return;
      }
      const latest = latestRef.current;
      // A tap on the selection opens a sheet too, like a held press.
      suppressClick = current.held || (current.onSelection && !current.moved);
      if (current.held && !current.moved && current.clipId) {
        latest.setClipMenu({
          kind: "clip",
          clipId: current.clipId,
          anchor: { x: event.clientX, y: event.clientY },
        });
      } else if (!current.moved && current.onSelection) {
        // Its menu, the same as the selection's right-click menu on
        // desktop.
        latest.setClipMenu({
          kind: "selection",
          anchor: { x: event.clientX, y: event.clientY },
        });
      } else if (!current.held && !current.moved && !current.clipId) {
        // A tap on empty space selects the layer and drops the clip
        // selection, which hides the selection toolbar. Taps on a clip
        // select it through the clip's own click.
        latest.setPendingSelection(null);
        latest.setSelectedClipId(undefined);
        latest.setSelectedLaneId(current.laneId);
      }
      endPress();
    };

    // Once a hold picks up a clip or the selection, or starts a selection,
    // the finger drags it instead of scrolling.
    const handleTouchMove = (event: TouchEvent) => {
      if (press?.held && event.cancelable) {
        event.preventDefault();
      }
      if (press?.held) {
        press.moved ||= exceedsTouchSlop(
          event.touches[0].clientX - press.startX,
          event.touches[0].clientY - press.startY,
        );
      }
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (suppressClick && event.cancelable) {
        event.preventDefault();
      }
      suppressClick = false;
    };

    const handleContextMenu = (event: Event) => {
      if (press || suppressContextMenu) {
        event.preventDefault();
        event.stopPropagation();
        suppressContextMenu = false;
      }
    };

    scroll.addEventListener("pointerdown", handlePointerDown, true);
    scroll.addEventListener("contextmenu", handleContextMenu, true);
    scroll.addEventListener("touchmove", handleTouchMove, { passive: false });
    scroll.addEventListener("touchend", handleTouchEnd, { passive: false });
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", endPress);
    return () => {
      endPress();
      scroll.removeEventListener("pointerdown", handlePointerDown, true);
      scroll.removeEventListener("contextmenu", handleContextMenu, true);
      scroll.removeEventListener("touchmove", handleTouchMove);
      scroll.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", endPress);
    };
  }, [enabled, timelineScrollRef]);
}
