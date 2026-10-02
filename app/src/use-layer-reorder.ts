import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { getAutoScrollDelta } from "./fx-chain.ts";
import {
  type LayerRowBox,
  layerDropIndex,
  layerLandingTop,
  layerReorderAnnouncements,
  layerRowShift,
  stepLayerIndex,
} from "./layer-reorder.ts";

// How far a mouse or pen moves before a press on the grip becomes a drag.
const DRAG_THRESHOLD_PX = 4;
// A touch must rest on the grip this long, without wandering further than
// the slop, before it picks the layer up.
const LONG_PRESS_MS = 400;
const LONG_PRESS_SLOP_PX = 10;
// The lifted row grows by this much.
const LIFT_SCALE = 1.01;

type LayerRef = { id: string; name: string };

type Session = {
  lane: LayerRef;
  fromIndex: number;
  targetIndex: number;
  mode: "pointer" | "keyboard";
  rows: HTMLElement[];
  boxes: LayerRowBox[];
  pointerId: number;
  // The pointer's offset into the list when the drag started, so the row
  // follows it however far the list scrolls.
  startOffsetY: number;
  startX: number;
  startY: number;
  lastY: number;
  active: boolean;
  frame: number;
  longPress: number;
  endPointer?: () => void;
};

/**
 * Drag, keyboard and long-press reordering for the layer headers' grips, or
 * with their own `rowAttribute`, `gripAttribute` and `listClass`, the source
 * track labels'.
 * Rows (`[data-layer-row-id]` inside `listRef`) slide imperatively while a
 * layer is lifted, so dragging never re-renders the app; `onMove` commits
 * the drop as one change. The list and lifted row take their classes from
 * `listClassName` and `liftedLaneId`.
 */
export function useLayerReorder({
  lanes,
  listRef,
  scrollRef,
  getScrollTop,
  disabled = false,
  rowAttribute = "data-layer-row-id",
  gripAttribute = "data-layer-grip",
  listClass = "arrangement-lanes",
  onMove,
  onSelect,
}: {
  lanes: readonly LayerRef[];
  listRef: RefObject<HTMLElement | null>;
  scrollRef: RefObject<HTMLElement | null>;
  // Where the visible part of the list starts, below any sticky header.
  getScrollTop?: () => number | undefined;
  disabled?: boolean;
  // The data attributes marking each row and grip, and the list's class.
  rowAttribute?: string;
  gripAttribute?: string;
  listClass?: string;
  onMove: (laneId: string, targetIndex: number) => void;
  onSelect?: (laneId: string) => void;
}) {
  const sessionRef = useRef<Session | null>(null);
  const indicatorRef = useRef<HTMLDivElement | null>(null);
  const [lifted, setLifted] = useState<{
    laneId: string;
    mode: Session["mode"];
  }>();
  const [announcement, setAnnouncement] = useState("");
  const latest = useRef({ onMove, onSelect, getScrollTop });
  latest.current = { onMove, onSelect, getScrollTop };

  function measure(fromIndex: number) {
    const list = listRef.current;
    if (!list) {
      return null;
    }

    const rows = [...list.querySelectorAll<HTMLElement>(`[${rowAttribute}]`)];
    if (rows.length !== lanes.length || !rows[fromIndex]) {
      return null;
    }

    const listTop = list.getBoundingClientRect().top;
    const boxes = rows.map((row) => {
      const rect = row.getBoundingClientRect();
      return { top: rect.top - listTop, height: rect.height };
    });
    return { list, rows, boxes };
  }

  // Lays the rows out for `session`: the lifted one at `offset` from where
  // it started, the ones it has passed shifted out of its way.
  function paint(session: Session, offset: number) {
    const { rows, boxes, fromIndex, targetIndex } = session;
    rows.forEach((row, index) => {
      if (index === fromIndex) {
        row.style.transform = `translateY(${offset}px) scale(${LIFT_SCALE})`;
        return;
      }
      const shift = layerRowShift(boxes, index, fromIndex, targetIndex);
      row.style.transform = shift ? `translateY(${shift}px)` : "";
    });

    const indicator = indicatorRef.current;
    if (indicator) {
      indicator.hidden = targetIndex === fromIndex;
      indicator.style.transform = `translateY(${layerLandingTop(
        boxes,
        fromIndex,
        targetIndex,
      )}px)`;
    }
  }

  function lift(session: Session) {
    if (session.mode === "pointer") {
      document.body.classList.add("layer-reorder-dragging");
    }
    setLifted({ laneId: session.lane.id, mode: session.mode });
  }

  function clear(session: Session) {
    cancelAnimationFrame(session.frame);
    window.clearTimeout(session.longPress);
    session.endPointer?.();
    for (const row of session.rows) {
      row.style.transform = "";
    }
    document.body.classList.remove("layer-reorder-dragging");
    if (indicatorRef.current) {
      indicatorRef.current.hidden = true;
    }
    if (sessionRef.current === session) {
      sessionRef.current = null;
    }
    setLifted(undefined);
  }

  function finish(commit: boolean) {
    const session = sessionRef.current;
    if (!session) {
      return;
    }

    clear(session);
    if (!session.active) {
      return;
    }

    const { lane, fromIndex, targetIndex } = session;
    if (!commit) {
      setAnnouncement(layerReorderAnnouncements.canceled(lane.name));
      return;
    }

    setAnnouncement(
      layerReorderAnnouncements.dropped(lane.name, targetIndex, lanes.length),
    );
    if (targetIndex !== fromIndex) {
      latest.current.onMove(lane.id, targetIndex);
    }
    latest.current.onSelect?.(lane.id);
  }

  function retarget(session: Session, targetIndex: number) {
    if (targetIndex === session.targetIndex) {
      return;
    }
    session.targetIndex = targetIndex;
    setAnnouncement(
      layerReorderAnnouncements.position(
        session.lane.name,
        targetIndex,
        session.rows.length,
      ),
    );
  }

  function followPointer(session: Session) {
    const list = listRef.current;
    if (!list) {
      return;
    }

    const offset =
      session.lastY - list.getBoundingClientRect().top - session.startOffsetY;
    const box = session.boxes[session.fromIndex];
    retarget(
      session,
      layerDropIndex(
        session.boxes,
        session.fromIndex,
        box.top + offset + box.height / 2,
      ),
    );
    paint(session, offset);
  }

  function autoScroll() {
    const session = sessionRef.current;
    const scroller = scrollRef.current;
    if (!session?.active || !scroller) {
      return;
    }

    const rect = scroller.getBoundingClientRect();
    const top = Math.max(rect.top, latest.current.getScrollTop?.() ?? rect.top);
    const delta = getAutoScrollDelta(session.lastY, top, rect.bottom);
    if (delta) {
      const before = scroller.scrollTop;
      scroller.scrollTop += delta;
      if (scroller.scrollTop !== before) {
        followPointer(session);
      }
    }
    session.frame = requestAnimationFrame(autoScroll);
  }

  function activatePointer(session: Session) {
    session.active = true;
    lift(session);
    latest.current.onSelect?.(session.lane.id);
    setAnnouncement(
      layerReorderAnnouncements.position(
        session.lane.name,
        session.fromIndex,
        session.rows.length,
      ),
    );
    followPointer(session);
    session.frame = requestAnimationFrame(autoScroll);
  }

  function onPointerDown(
    event: ReactPointerEvent<HTMLElement>,
    lane: LayerRef,
    index: number,
  ) {
    if (
      disabled ||
      event.button !== 0 ||
      !event.isPrimary ||
      sessionRef.current
    ) {
      return;
    }

    const measured = measure(index);
    if (!measured) {
      return;
    }

    // Keeps a mouse press from selecting text or focusing elsewhere; the
    // header's click still selects the layer.
    if (event.pointerType !== "touch") {
      event.preventDefault();
    }

    const session: Session = {
      lane,
      fromIndex: index,
      targetIndex: index,
      mode: "pointer",
      rows: measured.rows,
      boxes: measured.boxes,
      pointerId: event.pointerId,
      startOffsetY: event.clientY - measured.list.getBoundingClientRect().top,
      startX: event.clientX,
      startY: event.clientY,
      lastY: event.clientY,
      active: false,
      frame: 0,
      longPress: 0,
    };
    sessionRef.current = session;

    if (event.pointerType === "touch") {
      session.longPress = window.setTimeout(() => {
        if (sessionRef.current === session && !session.active) {
          navigator.vibrate?.(10);
          activatePointer(session);
        }
      }, LONG_PRESS_MS);
    }

    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== session.pointerId) {
        return;
      }

      session.lastY = moveEvent.clientY;
      if (!session.active) {
        const distance = Math.hypot(
          moveEvent.clientX - session.startX,
          moveEvent.clientY - session.startY,
        );
        if (event.pointerType === "touch") {
          // Wandering before the long press lands lets the touch go.
          if (distance > LONG_PRESS_SLOP_PX) {
            finish(false);
          }
          return;
        }
        if (distance < DRAG_THRESHOLD_PX) {
          return;
        }
        activatePointer(session);
      }

      moveEvent.preventDefault();
      followPointer(session);
    };

    const handleUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId === session.pointerId) {
        finish(true);
      }
    };

    const handleCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId === session.pointerId) {
        finish(false);
      }
    };

    const handleKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") {
        return;
      }

      // Keep Escape from also clearing selections elsewhere in the app.
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      finish(false);
    };

    // A long press opens the browser's context menu on some devices.
    const handleContextMenu = (menuEvent: Event) => {
      if (session.active) {
        menuEvent.preventDefault();
      }
    };

    session.endPointer = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
      window.removeEventListener("keydown", handleKey, true);
      window.removeEventListener("contextmenu", handleContextMenu, true);
    };
    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    window.addEventListener("keydown", handleKey, true);
    window.addEventListener("contextmenu", handleContextMenu, true);
  }

  function onKeyDown(
    event: ReactKeyboardEvent<HTMLElement>,
    lane: LayerRef,
    index: number,
  ) {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    const session = sessionRef.current;
    if (!session || session.mode !== "keyboard") {
      // Enter picks up; Space always toggles playback (#745).
      if (event.key !== "Enter" || disabled || session) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const measured = measure(index);
      if (!measured) {
        return;
      }

      const next: Session = {
        lane,
        fromIndex: index,
        targetIndex: index,
        mode: "keyboard",
        rows: measured.rows,
        boxes: measured.boxes,
        pointerId: -1,
        startOffsetY: 0,
        startX: 0,
        startY: 0,
        lastY: 0,
        active: true,
        frame: 0,
        longPress: 0,
      };
      sessionRef.current = next;
      lift(next);
      latest.current.onSelect?.(lane.id);
      paint(next, 0);
      setAnnouncement(
        layerReorderAnnouncements.pickedUp(lane.name, index, lanes.length),
      );
      return;
    }

    let target: number | undefined;
    switch (event.key) {
      case "ArrowUp":
        target = stepLayerIndex(session.targetIndex, -1, session.rows.length);
        break;
      case "ArrowDown":
        target = stepLayerIndex(session.targetIndex, 1, session.rows.length);
        break;
      case "Home":
        target = 0;
        break;
      case "End":
        target = session.rows.length - 1;
        break;
      case "Enter":
        event.preventDefault();
        event.stopPropagation();
        finish(true);
        // Reordering moves the row's DOM node, which can drop focus.
        refocus(lane.id);
        return;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        finish(false);
        return;
      case "Tab":
        finish(false);
        return;
      default:
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    retarget(session, target);
    // Announce every press, even against the top or bottom.
    if (target === session.targetIndex) {
      setAnnouncement(
        layerReorderAnnouncements.position(
          lane.name,
          target,
          session.rows.length,
        ),
      );
    }
    paint(
      session,
      layerLandingTop(session.boxes, session.fromIndex, target) -
        session.boxes[session.fromIndex].top,
    );
  }

  function refocus(laneId: string) {
    window.setTimeout(() => {
      listRef.current
        ?.querySelector<HTMLElement>(
          `[${gripAttribute}="${CSS.escape(laneId)}"]`,
        )
        ?.focus();
    }, 0);
  }

  function onBlur() {
    const session = sessionRef.current;
    if (session?.mode === "keyboard") {
      finish(false);
    }
  }

  // Another change to the layers (a collaborator, undo) cancels a lift,
  // since the rows it measured have moved.
  const laneKey = lanes.map((lane) => lane.id).join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: laneKey is the trigger; finish reads refs only
  useEffect(() => {
    const session = sessionRef.current;
    if (session) {
      clear(session);
    }
  }, [laneKey, disabled]);

  // Nothing lingers if the list unmounts mid-drag.
  // biome-ignore lint/correctness/useExhaustiveDependencies: cleanup only
  useEffect(
    () => () => {
      const session = sessionRef.current;
      if (session) {
        clear(session);
      }
    },
    [],
  );

  return {
    liftedLaneId: lifted?.laneId,
    listClassName: lifted
      ? `${listClass}--reordering ${listClass}--reordering-${lifted.mode}`
      : "",
    announcement,
    indicatorRef,
    gripProps: (lane: LayerRef, index: number) => ({
      [gripAttribute]: lane.id,
      "aria-pressed": lifted?.laneId === lane.id,
      onBlur,
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) =>
        onKeyDown(event, lane, index),
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) =>
        onPointerDown(event, lane, index),
    }),
  };
}
