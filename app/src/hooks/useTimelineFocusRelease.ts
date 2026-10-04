import { useEffect } from "react";
import { shouldReleaseFocus } from "../timeline-focus.ts";

// A press anywhere in the timeline panel blurs the control that had the
// focus, so the keyboard shortcuts reach the timeline again. Captured, so a
// row that stops the press still releases it; a control that takes the focus
// on the press, such as a layer header, still gets it.
export function useTimelineFocusRelease() {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        shouldReleaseFocus(event.target, active, document.body)
      ) {
        active.blur();
      }
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);
}
