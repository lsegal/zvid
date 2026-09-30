import { type Dispatch, type SetStateAction, useEffect } from "react";
import {
  isSampleMediaItem,
  readHydratableMedia,
} from "../app/media-hydration.ts";
import type { LocalMediaOverride, ProjectState } from "../app/types.ts";
import { logClient } from "../app/util.ts";
import type { MediaItem } from "../media";
import { cacheMediaBlob } from "../media-cache";
import type { PeerMediaStateResult } from "./usePeerMedia.ts";
import { useSampleMedia } from "./useSampleMedia.ts";

export type MediaHydrationInputs = {
  projectMediaItems: MediaItem[];
  localMediaOverridesRef: { current: Record<string, LocalMediaOverride> };
  mediaHydrationTick: number;
  setMediaHydrationTick: Dispatch<SetStateAction<number>>;
  mediaHydrationInFlightRef: { current: Set<string> };
  projectSnapshotRef: { current: ProjectState };
  setLocalMediaOverride: (mediaId: string, patch: LocalMediaOverride) => void;
  adoptMediaBlob: (mediaId: string, blob: Blob) => Promise<unknown>;
  peerMedia: PeerMediaStateResult;
  settleSessionMediaCheck: (
    mediaId: string,
    outcome: "restored" | "offline",
  ) => void;
  setStatus: Dispatch<SetStateAction<string>>;
};

// Restores the project's media that isn't ready from the media cache or the
// harness, and downloads a bundled sample's media (useSampleMedia). Media
// from peers is requested by usePeerMedia.
export function useMediaHydration(inputs: MediaHydrationInputs) {
  const {
    projectMediaItems,
    localMediaOverridesRef,
    setMediaHydrationTick,
    mediaHydrationInFlightRef,
    projectSnapshotRef,
    setLocalMediaOverride,
    adoptMediaBlob,
    peerMedia,
    settleSessionMediaCheck,
  } = inputs;

  useEffect(() => {
    // A hydration can outlive the run that started it: the effect reruns
    // whenever the media list changes (and at once under StrictMode), and
    // the rerun skips items still in flight. So a result is only dropped when
    // its media has left the project.
    const isRemoved = (mediaId: string) =>
      !projectSnapshotRef.current.mediaItems.some(
        (candidate) => candidate.id === mediaId,
      );

    for (const item of projectMediaItems) {
      const override = localMediaOverridesRef.current[item.id];
      const effectivePreviewUrl = override?.previewUrl ?? item.previewUrl;
      const effectiveAvailability = override?.availability ?? item.availability;
      if (effectivePreviewUrl || effectiveAvailability === "ready") {
        continue;
      }

      // useSampleMedia downloads a bundled sample's media.
      if (
        mediaHydrationInFlightRef.current.has(item.id) ||
        isSampleMediaItem(item)
      ) {
        continue;
      }

      mediaHydrationInFlightRef.current.add(item.id);
      setLocalMediaOverride(item.id, {
        availability: item.sourcePath ? "hydrating" : "offline",
      });

      void (async () => {
        let restored = false;
        try {
          const media = await readHydratableMedia(item);
          if (!media) {
            if (!isRemoved(item.id)) {
              setLocalMediaOverride(item.id, { availability: "offline" });
            }
            return;
          }
          if (isRemoved(item.id)) {
            // Keep the bytes so the next hydration pass is a cache hit.
            if (!media.cached) {
              await cacheMediaBlob(item.id, media.blob);
            }
            return;
          }

          await adoptMediaBlob(item.id, media.blob);
          restored = true;
        } catch (error) {
          logClient("media:hydrate:error", {
            mediaId: item.id,
            message: error instanceof Error ? error.message : String(error),
          });
          if (!isRemoved(item.id)) {
            setLocalMediaOverride(item.id, { availability: "offline" });
          }
        } finally {
          mediaHydrationInFlightRef.current.delete(item.id);
          setMediaHydrationTick((tick) => tick + 1);
          settleSessionMediaCheck(item.id, restored ? "restored" : "offline");
        }
      })();
    }
  }, [
    adoptMediaBlob,
    localMediaOverridesRef,
    mediaHydrationInFlightRef,
    projectMediaItems,
    projectSnapshotRef,
    setLocalMediaOverride,
    setMediaHydrationTick,
    settleSessionMediaCheck,
  ]);

  return useSampleMedia({
    ...inputs,
    setRemoteMediaProgress: peerMedia.setRemoteMediaProgress,
    failedSampleMediaIds: peerMedia.failedSampleMediaIds,
    setFailedSampleMediaIds: peerMedia.setFailedSampleMediaIds,
    setRevealedMediaIds: peerMedia.setRevealedMediaIds,
  });
}
