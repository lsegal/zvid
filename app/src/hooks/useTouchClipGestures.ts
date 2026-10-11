import { type RefObject, useEffect, useRef } from "react";
import { getClipDurationQ } from "../app/timeline-math.ts";
import type {
  ArrangementClip,
  ClipMenuState,
  DragState,
} from "../app/types.ts";
import { exceedsTouchSlop, LONG_PRESS_MS } from "../mobile/timeline-touch.ts";

// The layer rows' timeline space, where touches are taken over. Labels,
// trim handles, the ruler and the source tracks keep their own handling.
const ARRANGEMENT_SPACE = ".track-row__content--arrangement";
const TRIM_HANDLE = ".clip-card__handle";
const LIFTED_CLASS = "clip-card--lifted";

export type TouchClipGesturesInputs = {
  enabled: boolean;
  timelineScrollRef: RefObject<HTMLDivElement | null>;
  timelineClips: ArrangementClip[];
  bpm: number;
  setSelectedClipId: (clipId: string | undefined) => void;
  setSelectedLaneId: (laneId: string | undefined) => void;
  setPendingSelection: (selection: null) => void;
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
  moved: boolean;
  held: boolean;
  timer: number;
};

// Touch on the mobile timeline. A swipe scrolls (and so scrubs, see
// useCenterPlayhead) instead of moving a clip or drawing a selection; a tap
// selects; holding a clip still picks it up, buzzing where the platform
// can, and then dragging moves it, while letting go without moving opens
// its menu.
export function useTouchClipGestures({
  enabled,
  timelineScrollRef,
  timelineClips,
  bpm,
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

    const pickUp = () => {
      const current = press;
      if (!current?.clipId || current.moved) {
        return;
      }
      const latest = latestRef.current;
      const clip = latest.timelineClips.find(
        (item) => item.id === current.clipId,
      );
      if (!clip) {
        return;
      }
      current.held = true;
      suppressContextMenu = true;
      navigator.vibrate?.(12);
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
      if (!space || target?.closest(TRIM_HANDLE)) {
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
        moved: false,
        held: false,
        timer: clipId ? window.setTimeout(pickUp, LONG_PRESS_MS) : 0,
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
      if (current.held && !current.moved && current.clipId) {
        latest.setClipMenu({
          kind: "clip",
          clipId: current.clipId,
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

    // Once a clip is picked up, the finger drags it instead of scrolling.
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
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", endPress);
    return () => {
      endPress();
      scroll.removeEventListener("pointerdown", handlePointerDown, true);
      scroll.removeEventListener("contextmenu", handleContextMenu, true);
      scroll.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", endPress);
    };
  }, [enabled, timelineScrollRef]);
}
