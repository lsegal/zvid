import { type Dispatch, type SetStateAction, useRef, useState } from "react";
import type { ProjectState } from "../app/types.ts";
import type { MediaItem } from "../media";
import { useMediaLibrary } from "./useMediaLibrary.ts";
import { usePeerMediaState } from "./usePeerMedia.ts";

type ProjectUpdater = (current: ProjectState) => ProjectState;

export type AppMediaInputs = {
  projectMediaItems: MediaItem[];
  projectSnapshotRef: { current: ProjectState };
  commitViewChange: (label: string, updater: ProjectUpdater) => void;
  setStatus: Dispatch<SetStateAction<string>>;
};

// The session's media as this tab sees it (useMediaLibrary), its progress
// from peers and sample downloads (usePeerMediaState), and the hydration
// bookkeeping useMediaCacheSession and usePeerMedia share.
export function useAppMedia({
  projectMediaItems,
  projectSnapshotRef,
  commitViewChange,
  setStatus,
}: AppMediaInputs) {
  const [mediaHydrationTick, setMediaHydrationTick] = useState(0);
  const mediaHydrationInFlightRef = useRef(new Set<string>());
  const library = useMediaLibrary({
    projectMediaItems,
    projectSnapshotRef,
    commitViewChange,
    setStatus,
  });
  const peerMedia = usePeerMediaState({
    localMediaOverridesRef: library.localMediaOverridesRef,
    projectSnapshotRef,
  });

  return {
    ...library,
    peerMedia,
    remoteMediaProgress: peerMedia.remoteMediaProgress,
    revealedMediaIds: peerMedia.revealedMediaIds,
    mediaHydrationTick,
    setMediaHydrationTick,
    mediaHydrationInFlightRef,
  };
}

export type AppMedia = ReturnType<typeof useAppMedia>;
