import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getHarness } from "./harness";
import type { MediaItem } from "./media";
import {
  createThumbnailCache,
  type ThumbnailRequest,
  type ThumbnailSnapshot,
} from "./thumbnail-cache.ts";

// Requests settle this long before decoding, so dragging a trim handle does
// not start a decode for every step of the drag.
const THUMBNAIL_REQUEST_DEBOUNCE_MS = 150;

function revokeObjectUrl(url: string) {
  if (url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

// Decodes and caches the thumbnails in `requests`, returning a snapshot to
// read them from. `requests` should be memoized; a new array reschedules the
// decodes.
export function useThumbnailCache(
  requests: ThumbnailRequest<MediaItem>[],
  onError?: (request: ThumbnailRequest<MediaItem>, error: unknown) => void,
): ThumbnailSnapshot {
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const [cache] = useState(() =>
    createThumbnailCache<MediaItem>({
      generate: async (media, timeSeconds) =>
        getHarness().generateThumbnailAtTime?.(media, timeSeconds),
      revoke: revokeObjectUrl,
      onError: (request, error) => onErrorRef.current?.(request, error),
    }),
  );
  const snapshot = useSyncExternalStore(cache.subscribe, cache.getSnapshot);

  useEffect(() => {
    const timeoutId = window.setTimeout(
      () => cache.setWanted(requests),
      THUMBNAIL_REQUEST_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timeoutId);
  }, [cache, requests]);

  useEffect(() => () => cache.clear(), [cache]);

  return snapshot;
}
