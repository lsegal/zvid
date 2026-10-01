import { type RefObject, useCallback, useEffect, useState } from "react";
import {
  changePreviewVolume,
  readPreviewVolume,
  togglePreviewMuted,
  writePreviewVolume,
} from "../app/preview-volume.ts";
import type { CompositionPlayerHandle } from "../CompositionPlayer";

// The viewer's preview volume, remembered across sessions and applied to the
// preview player. Exports don't use it.
export function usePreviewVolume(
  playerRef: RefObject<CompositionPlayerHandle | null>,
) {
  const [previewVolume, setPreviewVolumeState] = useState(readPreviewVolume);

  useEffect(() => {
    playerRef.current?.setVolume(previewVolume.volume, previewVolume.muted);
    writePreviewVolume(previewVolume);
  }, [playerRef, previewVolume]);

  const setPreviewVolume = useCallback((volume: number) => {
    setPreviewVolumeState((state) => changePreviewVolume(state, volume));
  }, []);
  const togglePreviewMute = useCallback(() => {
    setPreviewVolumeState(togglePreviewMuted);
  }, []);

  return { previewVolume, setPreviewVolume, togglePreviewMute };
}
