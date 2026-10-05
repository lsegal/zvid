import { type RefObject, useCallback } from "react";
import type { CompositionPlayerHandle } from "../CompositionPlayer";

// A stable getter for the preview player's master meter tap, which the VU
// meter reads; null until the player mounts.
export function useMasterMeterTap(
  playerRef: RefObject<CompositionPlayerHandle | null>,
) {
  return useCallback(
    () => playerRef.current?.getMasterMeterTap() ?? null,
    [playerRef],
  );
}
