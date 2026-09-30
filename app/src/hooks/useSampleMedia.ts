import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  PEER_MEDIA_REVEAL_MS,
  PEER_MEDIA_STATUS_INTERVAL_MS,
} from "../app/constants.ts";
import type { LocalMediaOverride, ProjectState } from "../app/types.ts";
import { logClient } from "../app/util.ts";
import type { MediaItem } from "../media";
import { cacheMediaBlob, getCachedMediaBlob } from "../media-cache";
import {
  type RemoteMediaProgressMap,
  withoutRemoteMediaProgress,
  withRemoteMediaProgress,
} from "../remote-media-sync.ts";
import {
  loadSampleAssets,
  SampleLoadCancelledError,
  type SampleLoadDeps,
  sha256Hex,
} from "../sample/sample-loader.ts";
import type { SampleAsset } from "../sample/sample-manifest.ts";
import { findBundledSampleAsset } from "../sample/samples.ts";

// The bytes are cached when they are adopted (or, for media that left the
// project meanwhile, right after the download), so the loader itself only
// reads the cache.
const SAMPLE_MEDIA_DEPS: SampleLoadDeps = {
  fetch: (url, init) => fetch(url, init),
  getCached: getCachedMediaBlob,
  cache: async () => {},
  digest: sha256Hex,
};

export type SampleMediaInputs = {
  projectMediaItems: MediaItem[];
  localMediaOverridesRef: { current: Record<string, LocalMediaOverride> };
  mediaHydrationTick: number;
  setMediaHydrationTick: Dispatch<SetStateAction<number>>;
  mediaHydrationInFlightRef: { current: Set<string> };
  projectSnapshotRef: { current: ProjectState };
  setLocalMediaOverride: (mediaId: string, patch: LocalMediaOverride) => void;
  adoptMediaBlob: (mediaId: string, blob: Blob) => Promise<unknown>;
  setRemoteMediaProgress: Dispatch<SetStateAction<RemoteMediaProgressMap>>;
  setRevealedMediaIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
  settleSessionMediaCheck: (
    mediaId: string,
    outcome: "restored" | "offline",
  ) => void;
  setStatus: Dispatch<SetStateAction<string>>;
};

type SampleDownloadBatch = {
  controller: AbortController;
  // The media of this batch that hasn't settled yet.
  ids: Set<string>;
};

// Loads a bundled sample's media while the sample is open, the way media
// syncs from a peer: every asset not yet ready is queued, cached ones are
// ready at once, and the rest download a few at a time with their progress
// in the shared remote media progress, so clips show the skeleton and the
// Media Sync dialog lists them. A failed download is remembered until the
// user retries it; media that leaves the project stops downloading.
export function useSampleMedia({
  projectMediaItems,
  localMediaOverridesRef,
  mediaHydrationTick,
  setMediaHydrationTick,
  mediaHydrationInFlightRef,
  projectSnapshotRef,
  setLocalMediaOverride,
  adoptMediaBlob,
  setRemoteMediaProgress,
  setRevealedMediaIds,
  settleSessionMediaCheck,
  setStatus,
}: SampleMediaInputs) {
  // Media whose download failed, until retried.
  const [failedSampleMediaIds, setFailedSampleMediaIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const failedRef = useRef(failedSampleMediaIds);
  failedRef.current = failedSampleMediaIds;
  const batchesRef = useRef(new Set<SampleDownloadBatch>());

  useEffect(() => {
    const batches = batchesRef.current;
    return () => {
      for (const batch of batches) {
        batch.controller.abort();
      }
    };
  }, []);

  useEffect(() => {
    // mediaHydrationTick reruns this whenever a hydration settles, so media
    // skipped while it was in flight is picked up.
    void mediaHydrationTick;
    const isPresent = (mediaId: string) =>
      projectSnapshotRef.current.mediaItems.some(
        (candidate) => candidate.id === mediaId,
      );

    // Closing or replacing the sample cancels its downloads.
    for (const batch of batchesRef.current) {
      if (![...batch.ids].some(isPresent)) {
        batch.controller.abort();
      }
    }

    const wanted: SampleAsset[] = [];
    const ids = new Set<string>();
    for (const item of projectMediaItems) {
      const override = localMediaOverridesRef.current[item.id];
      if (
        override?.previewUrl ||
        item.previewUrl ||
        (override?.availability ?? item.availability) === "ready" ||
        mediaHydrationInFlightRef.current.has(item.id) ||
        failedRef.current.has(item.id) ||
        ids.has(item.id)
      ) {
        continue;
      }
      const asset = findBundledSampleAsset(item.sourcePath);
      if (asset) {
        // Loaded and cached under the item's id.
        wanted.push({ ...asset, id: item.id });
        ids.add(item.id);
      }
    }
    if (!wanted.length) {
      return;
    }

    const controller = new AbortController();
    const batch: SampleDownloadBatch = { controller, ids };
    batchesRef.current.add(batch);
    for (const mediaId of ids) {
      mediaHydrationInFlightRef.current.add(mediaId);
      setLocalMediaOverride(mediaId, { availability: "hydrating" });
    }
    setRemoteMediaProgress((map) => {
      let next = map;
      for (const mediaId of ids) {
        next = withRemoteMediaProgress(next, mediaId, {
          source: "url",
          phase: "queued",
          received: 0,
          total: 0,
        });
      }
      return next;
    });

    const settle = (mediaId: string, restored: boolean) => {
      if (!ids.delete(mediaId)) {
        return;
      }
      mediaHydrationInFlightRef.current.delete(mediaId);
      setRemoteMediaProgress((map) => withoutRemoteMediaProgress(map, mediaId));
      setMediaHydrationTick((tick) => tick + 1);
      settleSessionMediaCheck(mediaId, restored ? "restored" : "offline");
    };
    const reveal = (mediaId: string) => {
      setRevealedMediaIds((current) => new Set(current).add(mediaId));
      window.setTimeout(() => {
        setRevealedMediaIds((current) => {
          if (!current.has(mediaId)) {
            return current;
          }
          const next = new Set(current);
          next.delete(mediaId);
          return next;
        });
      }, PEER_MEDIA_REVEAL_MS);
    };
    const adopt = async (mediaId: string, blob: Blob, downloaded: boolean) => {
      let restored = false;
      try {
        if (isPresent(mediaId)) {
          await adoptMediaBlob(mediaId, blob);
          restored = true;
          if (downloaded) {
            reveal(mediaId);
          }
        } else if (downloaded) {
          // Keep the bytes so reopening the sample is a cache hit.
          await cacheMediaBlob(mediaId, blob);
        }
      } catch (error) {
        logClient("media:sample:adopt:error", {
          mediaId,
          message: error instanceof Error ? error.message : String(error),
        });
        if (isPresent(mediaId)) {
          setLocalMediaOverride(mediaId, { availability: "offline" });
        }
      } finally {
        settle(mediaId, restored);
      }
    };
    const progressAt = new Map<string, number>();
    // Adoptions still running when the loader returns.
    const adopting: Promise<void>[] = [];

    void loadSampleAssets(wanted, SAMPLE_MEDIA_DEPS, {
      signal: controller.signal,
      onAsset(event) {
        const mediaId = event.asset.id;
        if (event.phase === "receiving") {
          const now = performance.now();
          const last = progressAt.get(mediaId);
          if (
            last !== undefined &&
            event.received < event.total &&
            now - last < PEER_MEDIA_STATUS_INTERVAL_MS
          ) {
            return;
          }
          progressAt.set(mediaId, now);
          setRemoteMediaProgress((map) =>
            ids.has(mediaId)
              ? withRemoteMediaProgress(map, mediaId, {
                  source: "url",
                  phase: "receiving",
                  received: event.received,
                  total: event.total,
                })
              : map,
          );
        } else if (event.phase === "failed") {
          logClient("media:sample:download:error", {
            mediaId,
            message: event.error.message,
          });
          if (isPresent(mediaId)) {
            setFailedSampleMediaIds((current) =>
              new Set(current).add(mediaId),
            );
            setLocalMediaOverride(mediaId, {
              availability: "offline",
              lastError: event.error.message,
            });
            setStatus(event.error.message);
          }
          settle(mediaId, false);
        } else if (event.phase === "ready") {
          adopting.push(adopt(mediaId, event.blob, event.downloaded));
        }
      },
    })
      .catch((error) => {
        if (!(error instanceof SampleLoadCancelledError)) {
          logClient("media:sample:load:error", {
            message: error instanceof Error ? error.message : String(error),
          });
        }
      })
      .finally(async () => {
        await Promise.all(adopting);
        batchesRef.current.delete(batch);
        // Media the loader stopped before it settled, when cancelled.
        for (const mediaId of [...ids]) {
          if (isPresent(mediaId)) {
            setLocalMediaOverride(mediaId, { availability: "offline" });
          }
          settle(mediaId, false);
        }
      });
  }, [
    adoptMediaBlob,
    localMediaOverridesRef,
    mediaHydrationInFlightRef,
    mediaHydrationTick,
    projectMediaItems,
    projectSnapshotRef,
    setLocalMediaOverride,
    setMediaHydrationTick,
    setRemoteMediaProgress,
    setRevealedMediaIds,
    settleSessionMediaCheck,
    setStatus,
  ]);

  // Forgets a failed download so the effect downloads the media again.
  const retrySampleMedia = useCallback(
    (mediaId: string) => {
      if (!failedRef.current.has(mediaId)) {
        return;
      }
      const next = new Set(failedRef.current);
      next.delete(mediaId);
      failedRef.current = next;
      setFailedSampleMediaIds(next);
      setLocalMediaOverride(mediaId, { lastError: undefined });
      setMediaHydrationTick((tick) => tick + 1);
    },
    [setLocalMediaOverride, setMediaHydrationTick],
  );

  return { failedSampleMediaIds, retrySampleMedia };
}
