import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import "./preview-focus-shield.css";

// How far a finger may travel and still count as a tap, in CSS pixels.
const TAP_SLOP = 10;

/**
 * Whether the preview monitor takes edits yet. In the portrait phone shell
 * (#1257) it starts unfocused, so a swipe that starts on the preview doesn't
 * grab and move a layer: a tap focuses it first. A press anywhere outside the
 * monitor (another panel, the tab bar, the preview's own tabs) unfocuses it
 * again. Everywhere else the monitor is always focused.
 */
export function usePreviewFocus(
  requiresTap: boolean,
  monitorRef: RefObject<HTMLElement | null>,
) {
  const [isFocused, setFocused] = useState(false);
  const focused = !requiresTap || isFocused;

  useEffect(() => {
    if (!requiresTap) {
      setFocused(false);
    }
  }, [requiresTap]);

  useEffect(() => {
    if (!requiresTap || !isFocused) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const monitor = monitorRef.current;
      if (!(event.target instanceof Node) || !monitor?.contains(event.target)) {
        setFocused(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [requiresTap, isFocused, monitorRef]);

  return { focused, requiresTap, focus: () => setFocused(true) };
}

/**
 * Covers the unfocused preview so its swipes scroll instead of reaching the
 * transform overlay underneath. A tap, a press released without moving,
 * focuses the preview and lifts the shield.
 */
export function PreviewFocusShield({ onFocus }: { onFocus: () => void }) {
  const pressRef = useRef<{ pointerId: number; x: number; y: number } | null>(
    null,
  );
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    pressRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  };
  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    pressRef.current = null;
    if (
      press?.pointerId === event.pointerId &&
      Math.hypot(event.clientX - press.x, event.clientY - press.y) <= TAP_SLOP
    ) {
      onFocus();
    }
  };
  return (
    <div
      className="preview-focus-shield"
      data-testid="preview-focus-shield"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        pressRef.current = null;
      }}
    />
  );
}
