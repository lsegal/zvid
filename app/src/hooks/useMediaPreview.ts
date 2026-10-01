import { useCallback, useEffect, useRef, useState } from "react";
import {
  type PreviewPlaybackAction,
  type PreviewPlaybackState,
  type PreviewTab,
  readPreviewTab,
  reducePreviewPlayback,
  writePreviewTab,
} from "../app/media-preview.ts";
import type { MediaItem } from "../media";

export type MediaPreviewInputs = {
  isPlaying: boolean;
  setIsPlaying: (isPlaying: boolean) => void;
  mediaItemsById: Map<string, MediaItem>;
  // The media selected in the Media drawer.
  drawerMediaId: string | undefined;
};

// The preview pane's active tab, the media loaded into the Media tab, and
// its playback, kept exclusive with timeline playback: starting either one
// pauses the other, and switching tabs pauses the tab being left.
export function useMediaPreview({
  isPlaying,
  setIsPlaying,
  mediaItemsById,
  drawerMediaId,
}: MediaPreviewInputs) {
  const [previewTab, setPreviewTab] = useState<PreviewTab>(readPreviewTab);
  const [previewMediaId, setPreviewMediaId] = useState<string>();
  const [isMediaPlaying, setIsMediaPlaying] = useState(false);
  const stateRef = useRef<PreviewPlaybackState>({
    tab: previewTab,
    timelinePlaying: isPlaying,
    mediaPlaying: isMediaPlaying,
  });
  stateRef.current = {
    tab: previewTab,
    timelinePlaying: isPlaying,
    mediaPlaying: isMediaPlaying,
  };

  const dispatchPlayback = useCallback(
    (action: PreviewPlaybackAction) => {
      const current = stateRef.current;
      const next = reducePreviewPlayback(current, action);
      stateRef.current = next;
      if (next.tab !== current.tab) {
        setPreviewTab(next.tab);
        writePreviewTab(next.tab);
      }
      if (next.mediaPlaying !== current.mediaPlaying) {
        setIsMediaPlaying(next.mediaPlaying);
      }
      if (next.timelinePlaying !== current.timelinePlaying) {
        setIsPlaying(next.timelinePlaying);
      }
    },
    [setIsPlaying],
  );

  // Timeline playback starts from many places (the transport, Space, clip
  // shortcuts), so follow it here rather than at each of them.
  useEffect(() => {
    if (isPlaying) {
      dispatchPlayback({ type: "play", target: "timeline" });
    }
  }, [dispatchPlayback, isPlaying]);

  const previewMediaItem = previewMediaId
    ? mediaItemsById.get(previewMediaId)
    : undefined;
  const canPlayMedia = previewMediaItem?.availability === "ready";

  const selectPreviewTab = useCallback(
    (tab: PreviewTab) => dispatchPlayback({ type: "select-tab", tab }),
    [dispatchPlayback],
  );

  // Loads media into the Media tab, switching to it when `activate` is set
  // (double-click or Enter in the Media drawer).
  const loadPreviewMedia = useCallback(
    (mediaId: string, activate = false) => {
      if (mediaId !== previewMediaId) {
        setPreviewMediaId(mediaId);
        dispatchPlayback({ type: "pause", target: "media" });
      }
      if (activate) {
        dispatchPlayback({ type: "select-tab", tab: "media" });
      }
    },
    [dispatchPlayback, previewMediaId],
  );

  // Selecting in the Media drawer only replaces what the Media tab shows
  // while that tab is open. Opening the tab with nothing loaded shows the
  // drawer's selection.
  const hasPreviewMedia = previewMediaId !== undefined;
  const lastDrawerMediaIdRef = useRef(drawerMediaId);
  useEffect(() => {
    const selectionChanged = drawerMediaId !== lastDrawerMediaIdRef.current;
    lastDrawerMediaIdRef.current = drawerMediaId;
    if (
      drawerMediaId &&
      previewTab === "media" &&
      (selectionChanged || !hasPreviewMedia)
    ) {
      loadPreviewMedia(drawerMediaId);
    }
  }, [drawerMediaId, hasPreviewMedia, loadPreviewMedia, previewTab]);

  const setMediaPlaying = useCallback(
    (playing: boolean) => {
      if (playing && !canPlayMedia) {
        return;
      }
      dispatchPlayback({ type: playing ? "play" : "pause", target: "media" });
    },
    [canPlayMedia, dispatchPlayback],
  );

  const toggleMediaPlayback = useCallback(
    () => setMediaPlaying(!stateRef.current.mediaPlaying),
    [setMediaPlaying],
  );

  return {
    previewTab,
    selectPreviewTab,
    previewMediaItem,
    isMediaPlaying: isMediaPlaying && canPlayMedia,
    setMediaPlaying,
    toggleMediaPlayback,
    loadPreviewMedia,
  };
}

export type MediaPreviewModel = ReturnType<typeof useMediaPreview>;
