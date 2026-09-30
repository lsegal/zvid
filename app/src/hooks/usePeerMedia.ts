import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  MAX_PEER_MEDIA_TRANSFERS,
  PEER_MEDIA_REVEAL_MS,
  PEER_MEDIA_STATUS_INTERVAL_MS,
} from "../app/constants.ts";
import type {
  CollaborationMode,
  LocalMediaOverride,
  ProjectState,
} from "../app/types.ts";
import { logClient } from "../app/util.ts";
import type { CollaborationController } from "../collaboration";
import { getHarness } from "../harness";
import { getCachedMediaBlob } from "../media-cache";
import {
  formatPeerMediaSyncStatus,
  type RemoteMediaProgressMap,
  withoutRemoteMediaProgress,
  withQueuedRemoteMedia,
  withRemoteMediaProgress,
} from "../remote-media-sync.ts";
import { forgetChangedMainAudioMiss } from "../session-media.ts";

export type PeerMediaStateInputs = {
  localMediaOverridesRef: { current: Record<string, LocalMediaOverride> };
  projectSnapshotRef: { current: ProjectState };
};

// Remote media progress (peer transfers and sample downloads), the media
// just received, the media no peer had and the downloads that failed. Also serves this tab's media to peers and aborts
// transfers. useAppMedia calls this before useSessionSharing's
// `useCollaboration`, which needs both.
export function usePeerMediaState({
  localMediaOverridesRef,
  projectSnapshotRef,
}: PeerMediaStateInputs) {
  const [remoteMediaProgress, setRemoteMediaProgress] =
    useState<RemoteMediaProgressMap>(() => new Map());
  // Media that just finished syncing, so its clips cross-fade in.
  const [revealedMediaIds, setRevealedMediaIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Mirrors peerMediaMissesRef.current.ids so rendering sees peer misses.
  const [peerMediaMissIds, setPeerMediaMissIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Bundled sample media whose download failed, until the user retries it.
  // useSampleMedia downloads it into the same progress map.
  const [failedSampleMediaIds, setFailedSampleMediaIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const peerMediaTransfersRef = useRef(new Map<string, AbortController>());
  const peerMediaMissesRef = useRef<{
    controller: CollaborationController<ProjectState> | null;
    mediaPeerCount: number;
    ids: Set<string>;
  }>({ controller: null, mediaPeerCount: 0, ids: new Set() });
  const peerMainAudioIdRef = useRef<string | undefined>(undefined);

  const resolvePeerMedia = useCallback(
    async (mediaId: string) => {
      try {
        const cachedBlob = await getCachedMediaBlob(mediaId);
        if (cachedBlob) {
          return cachedBlob;
        }
      } catch (error) {
        logClient("media:peer:serve:cache:error", {
          mediaId,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      const previewUrl = localMediaOverridesRef.current[mediaId]?.previewUrl;
      if (!previewUrl) {
        return null;
      }

      const item = projectSnapshotRef.current.mediaItems.find(
        (candidate) => candidate.id === mediaId,
      );
      return getHarness().readMediaBlob({
        id: mediaId,
        name: item?.name ?? mediaId,
        previewUrl,
        sourcePath: item?.sourcePath,
      });
    },
    [localMediaOverridesRef, projectSnapshotRef],
  );

  const abortPeerMediaTransfers = useCallback(() => {
    for (const transfer of peerMediaTransfersRef.current.values()) {
      transfer.abort();
    }
  }, []);

  return {
    remoteMediaProgress,
    setRemoteMediaProgress,
    revealedMediaIds,
    setRevealedMediaIds,
    peerMediaMissIds,
    setPeerMediaMissIds,
    failedSampleMediaIds,
    setFailedSampleMediaIds,
    peerMediaTransfersRef,
    peerMediaMissesRef,
    peerMainAudioIdRef,
    resolvePeerMedia,
    abortPeerMediaTransfers,
  };
}

export type PeerMediaStateResult = ReturnType<typeof usePeerMediaState>;

export type PeerMediaInputs = {
  peerMedia: PeerMediaStateResult;
  collaborationMode: CollaborationMode;
  collaborationControllerRef: {
    current: CollaborationController<ProjectState> | null;
  };
  mediaPeerCount: number;
  mainAudioId: string | undefined;
  offlineSessionMediaIdsKey: string;
  mediaHydrationTick: number;
  setMediaHydrationTick: Dispatch<SetStateAction<number>>;
  mediaHydrationInFlightRef: { current: Set<string> };
  projectSnapshotRef: { current: ProjectState };
  setLocalMediaOverride: (mediaId: string, patch: LocalMediaOverride) => void;
  adoptMediaBlob: (mediaId: string, blob: Blob) => Promise<unknown>;
  setStatus: Dispatch<SetStateAction<string>>;
};

// Fetches offline media from peers while collaborating: requests each file
// a peer may have, shows its progress, reveals it once received, and
// remembers the media no peer had until the user retries it.
export function usePeerMedia({
  peerMedia,
  collaborationMode,
  collaborationControllerRef,
  mediaPeerCount,
  mainAudioId,
  offlineSessionMediaIdsKey,
  mediaHydrationTick,
  setMediaHydrationTick,
  mediaHydrationInFlightRef,
  projectSnapshotRef,
  setLocalMediaOverride,
  adoptMediaBlob,
  setStatus,
}: PeerMediaInputs) {
  const {
    remoteMediaProgress,
    setRemoteMediaProgress,
    setRevealedMediaIds,
    setPeerMediaMissIds,
    peerMediaTransfersRef,
    peerMediaMissesRef,
    peerMainAudioIdRef,
  } = peerMedia;

  // Copies peer misses into state so the media sync list can show them.
  const syncPeerMediaMissIds = useCallback(() => {
    const ids = peerMediaMissesRef.current.ids;
    setPeerMediaMissIds((current) =>
      current.size === ids.size && [...ids].every((id) => current.has(id))
        ? current
        : new Set(ids),
    );
  }, [peerMediaMissesRef, setPeerMediaMissIds]);

  useEffect(() => {
    // mediaHydrationTick reruns this whenever a local or peer hydration
    // settles, so media skipped while it was in flight is picked up.
    void mediaHydrationTick;
    const controller = collaborationControllerRef.current;
    if (collaborationMode === "idle" || !controller || mediaPeerCount === 0) {
      setRemoteMediaProgress((map) => withQueuedRemoteMedia(map, "peer", []));
      return;
    }

    const misses = peerMediaMissesRef.current;
    if (
      misses.controller !== controller ||
      misses.mediaPeerCount !== mediaPeerCount
    ) {
      // A peer joined or left, so previously missing media may now be found.
      misses.controller = controller;
      misses.mediaPeerCount = mediaPeerCount;
      misses.ids.clear();
    }
    // A main audio the host adds or replaces mid-share is requested at once.
    forgetChangedMainAudioMiss(
      misses.ids,
      peerMainAudioIdRef.current,
      mainAudioId,
    );
    peerMainAudioIdRef.current = mainAudioId;
    syncPeerMediaMissIds();

    const transfers = peerMediaTransfersRef.current;
    const offlineIds = JSON.parse(offlineSessionMediaIdsKey) as string[];
    // Media a peer may have that is waiting for a free transfer slot.
    const queuedIds: string[] = [];
    for (const mediaId of offlineIds) {
      if (
        misses.ids.has(mediaId) ||
        mediaHydrationInFlightRef.current.has(mediaId)
      ) {
        continue;
      }
      if (transfers.size >= MAX_PEER_MEDIA_TRANSFERS) {
        queuedIds.push(mediaId);
        continue;
      }

      const name =
        projectSnapshotRef.current.mediaItems.find(
          (item) => item.id === mediaId,
        )?.name ?? mediaId;
      const abortController = new AbortController();
      const recordMiss = () => {
        // Only remember the miss if the peer set is unchanged since the request.
        if (
          misses.controller === controller &&
          misses.mediaPeerCount === mediaPeerCount
        ) {
          misses.ids.add(mediaId);
          syncPeerMediaMissIds();
        }
      };
      transfers.set(mediaId, abortController);
      mediaHydrationInFlightRef.current.add(mediaId);
      setLocalMediaOverride(mediaId, { availability: "hydrating" });
      setRemoteMediaProgress((map) =>
        withRemoteMediaProgress(map, mediaId, {
          source: "peer",
          phase: "receiving",
          received: 0,
          total: 0,
        }),
      );

      void (async () => {
        let receiving = false;
        let progressAt = 0;
        try {
          const blob = await controller.requestMedia(mediaId, {
            signal: abortController.signal,
            onProgress(received, total) {
              const now = performance.now();
              if (
                receiving &&
                now - progressAt < PEER_MEDIA_STATUS_INTERVAL_MS
              ) {
                return;
              }
              receiving = true;
              progressAt = now;
              setRemoteMediaProgress((map) =>
                transfers.get(mediaId) === abortController
                  ? withRemoteMediaProgress(map, mediaId, {
                      source: "peer",
                      phase: "receiving",
                      received,
                      total,
                    })
                  : map,
              );
            },
          });
          if (!blob) {
            recordMiss();
            setLocalMediaOverride(mediaId, { availability: "offline" });
            if (receiving && !abortController.signal.aborted) {
              setStatus(`Receiving ${name} from peer was interrupted.`);
            }
            return;
          }

          await adoptMediaBlob(mediaId, blob);
          setStatus(`Received ${name} from peer.`);
          setRevealedMediaIds((ids) => new Set(ids).add(mediaId));
          window.setTimeout(() => {
            setRevealedMediaIds((ids) => {
              if (!ids.has(mediaId)) {
                return ids;
              }
              const next = new Set(ids);
              next.delete(mediaId);
              return next;
            });
          }, PEER_MEDIA_REVEAL_MS);
        } catch (error) {
          if (!abortController.signal.aborted) {
            const message =
              error instanceof Error ? error.message : String(error);
            logClient("media:peer:request:error", { mediaId, message });
            setStatus(`Failed to receive ${name} from peer: ${message}`);
            recordMiss();
          }
          setLocalMediaOverride(mediaId, { availability: "offline" });
        } finally {
          transfers.delete(mediaId);
          mediaHydrationInFlightRef.current.delete(mediaId);
          setRemoteMediaProgress((map) =>
            withoutRemoteMediaProgress(map, mediaId),
          );
          setMediaHydrationTick((tick) => tick + 1);
        }
      })();
    }
    setRemoteMediaProgress((map) =>
      withQueuedRemoteMedia(map, "peer", queuedIds),
    );
  }, [
    adoptMediaBlob,
    collaborationControllerRef,
    collaborationMode,
    mainAudioId,
    mediaHydrationInFlightRef,
    mediaPeerCount,
    offlineSessionMediaIdsKey,
    mediaHydrationTick,
    peerMainAudioIdRef,
    peerMediaMissesRef,
    peerMediaTransfersRef,
    projectSnapshotRef,
    setLocalMediaOverride,
    setMediaHydrationTick,
    setRemoteMediaProgress,
    setRevealedMediaIds,
    setStatus,
    syncPeerMediaMissIds,
  ]);

  // Forgets a peer miss so the hydration effect requests the media again.
  const retryPeerMedia = useCallback(
    (mediaId: string) => {
      peerMediaMissesRef.current.ids.delete(mediaId);
      syncPeerMediaMissIds();
      setMediaHydrationTick((tick) => tick + 1);
    },
    [peerMediaMissesRef, setMediaHydrationTick, syncPeerMediaMissIds],
  );

  useEffect(() => {
    const message = formatPeerMediaSyncStatus(remoteMediaProgress);
    if (message) {
      setStatus(message);
    }
  }, [remoteMediaProgress, setStatus]);

  return { retryPeerMedia };
}
