import { useCallback } from "react";
import { patchProjectState } from "../app/session-project.ts";
import type { ProjectState } from "../app/types.ts";
import type { MediaItem } from "../media";
import {
  clearMediaRange,
  MEDIA_RANGE_HISTORY_LABELS,
  type MediaRangePoint,
  setMediaRangePoint,
  updateMediaItem,
} from "../media-range.ts";

export type MediaRangeInputs = {
  commitProjectChange: (
    label: string,
    update: (current: ProjectState) => ProjectState,
  ) => void;
};

function commitMediaItem(
  current: ProjectState,
  mediaId: string,
  update: (item: MediaItem) => MediaItem,
) {
  const mediaItems = updateMediaItem(current.mediaItems, mediaId, update);
  return mediaItems === current.mediaItems
    ? current
    : patchProjectState(current, { mediaItems });
}

// Sets and clears a media item's In/Out points. Each call is one undo step,
// saved with the session and synced to collaborators with the rest of the
// project. A drag previews locally and calls `setPoint` once when it ends.
export function useMediaRange({ commitProjectChange }: MediaRangeInputs) {
  const setPoint = useCallback(
    (mediaId: string, point: MediaRangePoint, seconds: number) => {
      commitProjectChange(MEDIA_RANGE_HISTORY_LABELS[point], (current) =>
        commitMediaItem(current, mediaId, (item) =>
          setMediaRangePoint(item, point, seconds, current.fps),
        ),
      );
    },
    [commitProjectChange],
  );

  const clear = useCallback(
    (mediaId: string) => {
      commitProjectChange(MEDIA_RANGE_HISTORY_LABELS.clear, (current) =>
        commitMediaItem(current, mediaId, clearMediaRange),
      );
    },
    [commitProjectChange],
  );

  return { setPoint, clear };
}
