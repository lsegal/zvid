import { type Dispatch, type SetStateAction, useEffect, useMemo } from "react";
import type { ProjectState } from "../app/types.ts";
import { logClient } from "../app/util.ts";
import type { MediaItem } from "../media";
import { migrateMediaCache, setCachedMediaSession } from "../media-cache";
import type { ProjectHistoryState } from "../project-history";
import type { AppMedia } from "./useAppMedia.ts";
import { useMediaHydration } from "./useMediaHydration.ts";

export type MediaCacheSessionInputs = {
  media: AppMedia;
  projectHistory: ProjectHistoryState<ProjectState>;
  projectSnapshotRef: { current: ProjectState };
  settleSessionMediaCheck: (
    mediaId: string,
    outcome: "restored" | "offline",
  ) => void;
  setStatus: Dispatch<SetStateAction<string>>;
};

// Keeps the media cache's record of the open session's media current, and
// restores the project's media that isn't ready (useMediaHydration).
export function useMediaCacheSession({
  media,
  projectHistory,
  projectSnapshotRef,
  settleSessionMediaCheck,
  setStatus,
}: MediaCacheSessionInputs) {
  const { sessionName, mediaItems: projectMediaItems } = projectHistory.present;

  // Media an undo or redo step still uses counts as part of the session too,
  // since the history survives a refresh. Keyed by the sorted ids so the
  // cache index is only rewritten when the set changes.
  const sessionMediaIdsKey = useMemo(() => {
    const ids = new Set<string>();
    const seen = new Set<MediaItem[]>();
    for (const snapshot of [
      projectHistory.present,
      ...projectHistory.past.map((entry) => entry.snapshot),
      ...projectHistory.future.map((entry) => entry.snapshot),
    ]) {
      if (seen.has(snapshot.mediaItems)) {
        continue;
      }
      seen.add(snapshot.mediaItems);
      for (const item of snapshot.mediaItems) {
        ids.add(item.id);
      }
    }
    return JSON.stringify([...ids].sort());
  }, [projectHistory.past, projectHistory.present, projectHistory.future]);

  // Runs before hydration so media the open session uses is never evicted to
  // make room for its other files.
  useEffect(() => {
    setCachedMediaSession(
      sessionName ?? "Untitled session",
      JSON.parse(sessionMediaIdsKey) as string[],
    ).catch((error) => {
      logClient("media:cache:session:error", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }, [sessionMediaIdsKey, sessionName]);

  useEffect(() => {
    migrateMediaCache()
      .then((moved) => {
        if (moved) {
          logClient("media:cache:migrated", { moved });
        }
      })
      .catch((error) => {
        logClient("media:cache:migrate:error", {
          message: error instanceof Error ? error.message : String(error),
        });
      });
  }, []);

  return useMediaHydration({
    projectMediaItems,
    localMediaOverridesRef: media.localMediaOverridesRef,
    mediaHydrationTick: media.mediaHydrationTick,
    setMediaHydrationTick: media.setMediaHydrationTick,
    mediaHydrationInFlightRef: media.mediaHydrationInFlightRef,
    projectSnapshotRef,
    setLocalMediaOverride: media.setLocalMediaOverride,
    adoptMediaBlob: media.adoptMediaBlob,
    peerMedia: media.peerMedia,
    settleSessionMediaCheck,
    setStatus,
  });
}
