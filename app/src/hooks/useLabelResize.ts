import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react";
import {
  LABEL_WIDTH_KEYBOARD_STEP,
  LABEL_WIDTH_MAX,
  LABEL_WIDTH_MIN,
  LABEL_WIDTH_STORAGE_KEY,
} from "../app/constants.ts";
import { clampLabelWidth, readLabelWidth } from "../app/layout-prefs.ts";

// The width of the timeline's track labels, which the rail between the
// labels and the lanes resizes by dragging or from the keyboard.
export function useLabelResize() {
  const [labelWidth, setLabelWidth] = useState(readLabelWidth);
  const labelResizeRef = useRef<{
    pointerId: number;
    pointerStartX: number;
    originWidth: number;
  } | null>(null);

  function commitLabelWidth(width: number) {
    const nextWidth = clampLabelWidth(width);
    setLabelWidth(nextWidth);
    try {
      window.localStorage.setItem(LABEL_WIDTH_STORAGE_KEY, String(nextWidth));
    } catch {
      // Storage can be unavailable (private mode, quota); resizing still works.
    }
  }

  function handleLabelResizePointerDown(
    event: ReactPointerEvent<HTMLHRElement>,
  ) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    labelResizeRef.current = {
      pointerId: event.pointerId,
      pointerStartX: event.clientX,
      originWidth: labelWidth,
    };
  }

  function handleLabelResizePointerMove(
    event: ReactPointerEvent<HTMLHRElement>,
  ) {
    const resize = labelResizeRef.current;
    if (resize?.pointerId !== event.pointerId) {
      return;
    }

    setLabelWidth(
      clampLabelWidth(
        resize.originWidth + event.clientX - resize.pointerStartX,
      ),
    );
  }

  function handleLabelResizePointerEnd(
    event: ReactPointerEvent<HTMLHRElement>,
  ) {
    const resize = labelResizeRef.current;
    if (resize?.pointerId !== event.pointerId) {
      return;
    }

    labelResizeRef.current = null;
    commitLabelWidth(
      event.type === "pointercancel"
        ? labelWidth
        : resize.originWidth + event.clientX - resize.pointerStartX,
    );
  }

  function handleLabelResizeKeyDown(event: ReactKeyboardEvent<HTMLHRElement>) {
    let nextWidth: number;
    switch (event.key) {
      case "ArrowLeft":
        nextWidth = labelWidth - LABEL_WIDTH_KEYBOARD_STEP;
        break;
      case "ArrowRight":
        nextWidth = labelWidth + LABEL_WIDTH_KEYBOARD_STEP;
        break;
      case "Home":
        nextWidth = LABEL_WIDTH_MIN;
        break;
      case "End":
        nextWidth = LABEL_WIDTH_MAX;
        break;
      default:
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    commitLabelWidth(nextWidth);
  }

  return {
    labelWidth,
    commitLabelWidth,
    handleLabelResizePointerDown,
    handleLabelResizePointerMove,
    handleLabelResizePointerEnd,
    handleLabelResizeKeyDown,
  };
}
