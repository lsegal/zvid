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
  getAutoScrollDelta,
  getDropSlot,
  isNoopDropSlot,
  isPinnedDevice,
} from "../../fx-chain";
import type { FxDevice, FxDeviceGroup } from "../../fx-stack";

// Pixels the pointer travels before a press on a title bar becomes a drag.
const DRAG_THRESHOLD = 4;

type DropTarget = { group: FxDeviceGroup; index: number };

type DragSession = {
  device: FxDevice;
  fromIndex: number;
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  active: boolean;
  target: DropTarget | null;
  frame: number;
};

type DragView = {
  deviceId: string;
  // Insertion marker position in scroll content coordinates, or null when
  // the stack under the pointer won't take the device and the drop would be
  // rejected.
  markerX: number | null;
};

type DeviceDragOptions = {
  scrollRef: RefObject<HTMLDivElement | null>;
  moveDevice: (
    device: FxDevice,
    toGroup: FxDeviceGroup,
    toIndex: number,
  ) => void;
  // Whether the device can drop at `toIndex` of the `toGroup` stack, counted
  // without the device itself.
  canMoveDevice: (
    device: FxDevice,
    toGroup: FxDeviceGroup,
    toIndex: number,
  ) => boolean;
  setAnnouncement: (announcement: string) => void;
};

// Dragging a device's title bar reorders it within its stack or moves it to
// another stack that takes it, with an insertion marker and auto-scroll near
// the chain's edges.
export function useDeviceDrag({
  scrollRef,
  moveDevice,
  canMoveDevice,
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

    const { device } = session;
    const pointerX = session.lastX;
    const reject = () => {
      session.target = null;
      setDrag({ deviceId: device.id, markerX: null });
    };
    // A stack spans from the middle of its own divider to the middle of the
    // next one. Left of the first divider are the leading devices, such as
    // a source track's Record device, which nothing can displace.
    const group = FX_CHAIN_SECTIONS.findLast((section) => {
      const divider = scroller
        .querySelector<HTMLElement>(`[data-fx-divider="${section}"]`)
        ?.getBoundingClientRect();
      return (
        divider !== undefined && divider.left + divider.width / 2 <= pointerX
      );
    });
    if (!group) {
      reject();
      return;
    }

    const panels = getStackPanels(group).map((panel) =>
      panel.getBoundingClientRect(),
    );
    const sameStack = group === device.group;
    const slot = getDropSlot(
      panels.map((rect) => rect.left + rect.width / 2),
      pointerX,
    );
    const index = sameStack
      ? dropSlotToStackIndex(session.fromIndex, slot)
      : slot;
    if (!canMoveDevice(device, group, index)) {
      reject();
      return;
    }

    session.target = { group, index };
    if (sameStack && isNoopDropSlot(session.fromIndex, slot)) {
      setDrag({ deviceId: device.id, markerX: null });
      return;
    }

    const scrollerRect = scroller.getBoundingClientRect();
    const gap = Number.parseFloat(getComputedStyle(scroller).columnGap) || 0;
    let edgeX: number;
    if (panels.length) {
      edgeX =
        slot === 0
          ? panels[0].left - gap / 2
          : panels[slot - 1].right + gap / 2;
    } else {
      // An empty stack takes the device ahead of its add slot.
      const add = scroller
        .querySelector<HTMLElement>(`[data-fx-focus="add-${group}"]`)
        ?.getBoundingClientRect();
      const divider = scroller
        .querySelector<HTMLElement>(`[data-fx-divider="${group}"]`)
        ?.getBoundingClientRect();
      edgeX = add ? add.left - gap / 2 : (divider?.right ?? pointerX) + gap / 2;
    }
    setDrag({
      deviceId: device.id,
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
      isPinnedDevice(device) ||
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
      target: null,
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
      if (!commit || !session?.active || !session.target) {
        return;
      }

      moveDevice(session.device, session.target.group, session.target.index);
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
