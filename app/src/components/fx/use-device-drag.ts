import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  dropSlotToStackIndex,
  FX_CHAIN_SECTIONS,
  type FxChainGroups,
  getAutoScrollDelta,
  getDropSlot,
  isNoopDropSlot,
} from "../../fx-chain";
import type { FxDevice, FxDeviceGroup } from "../../fx-stack";

// Pixels the pointer travels before a press on a title bar becomes a drag.
const DRAG_THRESHOLD = 4;

type DragSession = {
  device: FxDevice;
  fromIndex: number;
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  active: boolean;
  slot: number | null;
  frame: number;
};

type DragView = {
  deviceId: string;
  // Insertion marker position in scroll content coordinates, or null when
  // the pointer is over the other stack and the drop would be rejected.
  markerX: number | null;
};

type DeviceDragOptions = {
  scrollRef: RefObject<HTMLDivElement | null>;
  groups: FxChainGroups;
  moveDevice: (
    device: FxDevice,
    fromIndex: number,
    toIndex: number,
    stackSize: number,
  ) => void;
  setAnnouncement: (announcement: string) => void;
};

// Dragging a device's title bar reorders it within its stack, with an
// insertion marker and auto-scroll near the chain's edges.
export function useDeviceDrag({
  scrollRef,
  groups,
  moveDevice,
  setAnnouncement,
}: DeviceDragOptions) {
  const dragRef = useRef<DragSession | null>(null);
  const endDragRef = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef(false);
  const [drag, setDrag] = useState<DragView | null>(null);

  useEffect(() => () => endDragRef.current?.(), []);

  // Panels of one stack, in stack order.
  function getStackPanels(group: FxDeviceGroup) {
    return Array.from(
      scrollRef.current?.querySelectorAll<HTMLElement>(
        `[data-fx-group="${group}"]`,
      ) ?? [],
    );
  }

  function updateDropTarget() {
    const session = dragRef.current;
    const scroller = scrollRef.current;
    if (!session?.active || !scroller) {
      return;
    }

    const { group } = session.device;
    const pointerX = session.lastX;
    // A stack spans from the middle of its own divider to the middle of the
    // next one; devices only move within their stack.
    const dividerX = (section: FxDeviceGroup | undefined) => {
      const divider = section
        ? scroller
            .querySelector<HTMLElement>(`[data-fx-divider="${section}"]`)
            ?.getBoundingClientRect()
        : undefined;
      return divider ? divider.left + divider.width / 2 : undefined;
    };
    const sectionIndex = FX_CHAIN_SECTIONS.indexOf(group);
    const startX = dividerX(group) ?? Number.NEGATIVE_INFINITY;
    const endX =
      dividerX(FX_CHAIN_SECTIONS[sectionIndex + 1]) ?? Number.POSITIVE_INFINITY;
    const overOtherStack = pointerX < startX || pointerX > endX;

    const panels = getStackPanels(group).map((panel) =>
      panel.getBoundingClientRect(),
    );
    if (overOtherStack || !panels.length) {
      session.slot = null;
      setDrag({ deviceId: session.device.id, markerX: null });
      return;
    }

    const slot = getDropSlot(
      panels.map((rect) => rect.left + rect.width / 2),
      pointerX,
    );
    session.slot = slot;
    if (isNoopDropSlot(session.fromIndex, slot)) {
      setDrag({ deviceId: session.device.id, markerX: null });
      return;
    }

    const scrollerRect = scroller.getBoundingClientRect();
    const gap = Number.parseFloat(getComputedStyle(scroller).columnGap) || 0;
    const edgeX =
      slot === 0 ? panels[0].left - gap / 2 : panels[slot - 1].right + gap / 2;
    setDrag({
      deviceId: session.device.id,
      markerX: edgeX - scrollerRect.left + scroller.scrollLeft,
    });
  }

  function autoScroll() {
    const session = dragRef.current;
    const scroller = scrollRef.current;
    if (!session?.active || !scroller) {
      return;
    }

    const rect = scroller.getBoundingClientRect();
    const delta = getAutoScrollDelta(session.lastX, rect.left, rect.right);
    if (delta) {
      const before = scroller.scrollLeft;
      scroller.scrollLeft += delta;
      if (scroller.scrollLeft !== before) {
        updateDropTarget();
      }
    }
    session.frame = requestAnimationFrame(autoScroll);
  }

  function beginDrag(
    event: ReactPointerEvent<HTMLElement>,
    device: FxDevice,
    index: number,
  ) {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      dragRef.current ||
      (event.target as HTMLElement).closest("[data-fx-no-drag]")
    ) {
      return;
    }

    suppressClickRef.current = false;
    dragRef.current = {
      device,
      fromIndex: index,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      active: false,
      slot: null,
      frame: 0,
    };

    const handleMove = (moveEvent: PointerEvent) => {
      const session = dragRef.current;
      if (!session || moveEvent.pointerId !== session.pointerId) {
        return;
      }

      session.lastX = moveEvent.clientX;
      if (!session.active) {
        if (
          Math.hypot(
            moveEvent.clientX - session.startX,
            moveEvent.clientY - session.startY,
          ) < DRAG_THRESHOLD
        ) {
          return;
        }

        session.active = true;
        suppressClickRef.current = true;
        document.body.classList.add("fx-chain-dragging");
        session.frame = requestAnimationFrame(autoScroll);
      }

      moveEvent.preventDefault();
      updateDropTarget();
    };

    const finish = (commit: boolean) => {
      const session = dragRef.current;
      endDrag();
      if (!commit || !session?.active || session.slot === null) {
        return;
      }

      const stackSize = groups[session.device.group].length;
      moveDevice(
        session.device,
        session.fromIndex,
        dropSlotToStackIndex(session.fromIndex, session.slot),
        stackSize,
      );
    };

    const handleUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId === dragRef.current?.pointerId) {
        finish(true);
      }
    };

    const handleCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId === dragRef.current?.pointerId) {
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
      if (dragRef.current?.active) {
        setAnnouncement(`Canceled moving ${device.name}`);
      }
      finish(false);
    };

    function endDrag() {
      const session = dragRef.current;
      if (session) {
        cancelAnimationFrame(session.frame);
      }
      dragRef.current = null;
      endDragRef.current = null;
      document.body.classList.remove("fx-chain-dragging");
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
      window.removeEventListener("keydown", handleKey, true);
      setDrag(null);
    }

    endDragRef.current = endDrag;
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    window.addEventListener("keydown", handleKey, true);
  }

  return { drag, beginDrag, suppressClickRef };
}
