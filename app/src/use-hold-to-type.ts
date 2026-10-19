import { useEffect, useRef } from "react";

// How long a press must stay within the drag threshold before a readout
// opens its text field (#1529).
export const HOLD_TO_TYPE_MS = 100;

// A timer for a readout's press-and-hold: `arm` on pointer down, `cancel`
// once the press becomes a drag or ends. A quick tap never reaches `onHold`.
export function useHoldToType() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  const arm = (onHold: () => void) => {
    cancel();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onHold();
    }, HOLD_TO_TYPE_MS);
  };
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );
  return { arm, cancel };
}
