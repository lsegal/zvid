import { useEffect, useRef } from "react";
import { dispatchShortcuts, shortcuts } from "./registry.ts";
import type { ShortcutContext } from "./types.ts";

// Dispatches the global keyboard shortcuts from one window listener. The
// listener reads the latest context, so it never has to re-subscribe.
export function useKeyboardShortcuts(context: ShortcutContext) {
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      dispatchShortcuts(shortcuts, contextRef.current, event);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
