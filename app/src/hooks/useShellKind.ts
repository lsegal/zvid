import { useSyncExternalStore } from "react";
import { pickShellKind, type ShellKind } from "../mobile/shell-kind.ts";

const COARSE_POINTER_QUERY = "(pointer: coarse)";

function subscribe(onChange: () => void) {
  const coarse = window.matchMedia?.(COARSE_POINTER_QUERY);
  window.addEventListener("resize", onChange);
  window.addEventListener("orientationchange", onChange);
  coarse?.addEventListener?.("change", onChange);
  return () => {
    window.removeEventListener("resize", onChange);
    window.removeEventListener("orientationchange", onChange);
    coarse?.removeEventListener?.("change", onChange);
  };
}

function readShellKind(): ShellKind {
  return pickShellKind({
    width: window.innerWidth,
    height: window.innerHeight,
    coarsePointer: window.matchMedia?.(COARSE_POINTER_QUERY).matches ?? false,
  });
}

// The editor's shell for the current viewport and pointer, following
// resizes, rotation and a change of primary pointer.
export function useShellKind(): ShellKind {
  return useSyncExternalStore(subscribe, readShellKind, () => "desktop");
}
