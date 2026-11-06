import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react";
import {
  FX_PANEL_HEIGHT_STORAGE_KEY,
  FX_PANEL_MIN_HEIGHT,
  FX_PANEL_RESIZE_KEY_STEP,
} from "../app/constants.ts";
import { getFxPanelMaxHeight, readFxPanelHeight } from "../app/layout-prefs.ts";
import { clamp } from "../app/util.ts";

const workspaceHeight = (handle: HTMLElement) =>
  handle.parentElement?.clientHeight ?? 0;
const panelHeight = (handle: HTMLElement) =>
  handle.nextElementSibling?.getBoundingClientRect().height ?? 0;

// The FX panel's height, which the handle on its top edge resizes by dragging
// or from the keyboard. Until then, and after a double-click, it fits its
// content up to the workspace's cap. Bounds come from the handle's own
// surroundings, so they hold for whatever size the window is now.
export function useFxPanelResize() {
  const [height, setHeight] = useState(readFxPanelHeight);
  const resizeRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);

  function commit(handle: HTMLElement, nextHeight: number) {
    const next = clamp(
      Math.round(nextHeight),
      FX_PANEL_MIN_HEIGHT,
      getFxPanelMaxHeight(workspaceHeight(handle)),
    );
    setHeight(next);
    try {
      window.localStorage.setItem(FX_PANEL_HEIGHT_STORAGE_KEY, String(next));
    } catch {
      // Storage can be unavailable (private mode, quota); resizing still works.
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLHRElement>) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: panelHeight(event.currentTarget),
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLHRElement>) {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) {
      return;
    }

    // The panel sits below the handle, so dragging up heightens it.
    commit(
      event.currentTarget,
      resize.startHeight + resize.startY - event.clientY,
    );
  }

  function onPointerEnd(event: ReactPointerEvent<HTMLHRElement>) {
    if (resizeRef.current?.pointerId !== event.pointerId) {
      return;
    }

    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLHRElement>) {
    const handle = event.currentTarget;
    let nextHeight: number;
    switch (event.key) {
      case "ArrowUp":
        nextHeight = panelHeight(handle) + FX_PANEL_RESIZE_KEY_STEP;
        break;
      case "ArrowDown":
        nextHeight = panelHeight(handle) - FX_PANEL_RESIZE_KEY_STEP;
        break;
      case "Home":
        nextHeight = FX_PANEL_MIN_HEIGHT;
        break;
      case "End":
        nextHeight = getFxPanelMaxHeight(workspaceHeight(handle));
        break;
      default:
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    commit(handle, nextHeight);
  }

  function onDoubleClick() {
    setHeight(null);
    try {
      window.localStorage.removeItem(FX_PANEL_HEIGHT_STORAGE_KEY);
    } catch {
      // Storage can be unavailable (private mode, quota); the reset still works.
    }
  }

  return {
    height,
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
    onKeyDown,
    onDoubleClick,
  };
}

export type FxPanelResize = ReturnType<typeof useFxPanelResize>;
