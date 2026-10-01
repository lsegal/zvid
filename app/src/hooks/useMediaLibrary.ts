import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LOCATE_OFFLINE_MEDIA_HINT,
  PALETTE,
  RELINK_DURATION_TOLERANCE_SECONDS,
} from "../app/constants.ts";
import {
  mediaFrameRate,
  mergeMediaItemsById,
  patchProjectState,
} from "../app/session-project.ts";
import type {
  AdoptMediaResult,
  LocalMediaOverride,
  ProjectState,
  SourceTrackDropTarget,
} from "../app/types.ts";
import { logClient, pluralize } from "../app/util.ts";
import { getHarness } from "../harness";
import {
  inferMediaKind,
  type MediaItem,
  type MediaProbeResult,
  probeMediaBlob,
  toShareableMediaItem,
} from "../media";
import { cacheMediaBlob } from "../media-cache";
import { hasMediaDetails } from "../media-details.ts";
import {
  createMediaRelinker,
  type MediaRelinkCandidate,
} from "../media-relink";
import { revokeObjectUrl } from "../object-url-retention.ts";
import { matchOfflineMedia, type OfflineMediaEntry } from "../relink";
import { addMediaToSourceTrack } from "../source-track-media.ts";

type ProjectUpdater = (current: ProjectState) => ProjectState;

export type MediaLibraryInputs = {
  projectMediaItems: MediaItem[];
  projectSnapshotRef: { current: ProjectState };
  commitViewChange: (label: string, updater: ProjectUpdater) => void;
  setStatus: (status: string) => void;
};

// The session's media as this tab sees it: the project's items with the
// object URLs and availability this tab resolved for them, and the calls
// that load, cache and adopt their files.
export function useMediaLibrary({
  projectMediaItems,
  projectSnapshotRef,
  commitViewChange,
  setStatus,
}: MediaLibraryInputs) {
  const [localMediaOverrides, setLocalMediaOverrides] = useState<
    Record<string, LocalMediaOverride>
  >({});
  const localMediaOverridesRef = useRef<Record<string, LocalMediaOverride>>({});
  const mediaObjectUrlsRef = useRef(new Map<string, string>());

  const mediaItems = useMemo(
    () =>
      projectMediaItems.map((item) => ({
        ...item,
        ...(localMediaOverrides[item.id] ?? {}),
        availability:
          localMediaOverrides[item.id]?.availability ?? item.availability,
      })),
    [localMediaOverrides, projectMediaItems],
  );
  const mediaItemsById = useMemo(
    () => new Map(mediaItems.map((item) => [item.id, item])),
    [mediaItems],
  );

  const setLocalMediaOverride = useCallback(
    (mediaId: string, patch: LocalMediaOverride) => {
      setLocalMediaOverrides((current) => {
        const previous = current[mediaId];
        const nextPreviewUrl = patch.previewUrl ?? previous?.previewUrl;
        const previousPreviewUrl = previous?.previewUrl;

        if (
          previousPreviewUrl &&
          previousPreviewUrl !== nextPreviewUrl &&
          mediaObjectUrlsRef.current.get(mediaId) === previousPreviewUrl
        ) {
          revokeObjectUrl(previousPreviewUrl);
          mediaObjectUrlsRef.current.delete(mediaId);
        }

        const next = {
          ...previous,
          ...patch,
        };
        if (next.availability === "ready") {
          delete next.lastError;
        }

        if (!next.previewUrl && !next.thumbnailUrl && !next.availability) {
          const rest = { ...current };
          delete rest[mediaId];
          return rest;
        }

        return {
          ...current,
          [mediaId]: next,
        };
      });
    },
    [],
  );

  const seedLocalMediaItems = useCallback(
    (items: MediaItem[]) => {
      for (const item of items) {
        if (item.previewUrl.startsWith("blob:")) {
          mediaObjectUrlsRef.current.set(item.id, item.previewUrl);
        }
        setLocalMediaOverride(item.id, {
          availability: item.previewUrl ? "ready" : item.availability,
          previewUrl: item.previewUrl || undefined,
          thumbnailUrl: item.thumbnailUrl,
        });
      }
    },
    [setLocalMediaOverride],
  );

  // Caching skips a file rather than failing when browser storage is full, so
  // the user learns the file won't survive a refresh.
  const reportMediaNotCached = useCallback(
    (mediaId: string, blob: Blob, name?: string) => {
      const displayName =
        name ??
        projectSnapshotRef.current.mediaItems.find(
          (candidate) => candidate.id === mediaId,
        )?.name ??
        (blob instanceof File ? blob.name : mediaId);
      logClient("media:cache:skipped", { mediaId, size: blob.size });
      setStatus(
        `${displayName} not cached, browser storage is full; it will need relinking after refresh.`,
      );
    },
    [projectSnapshotRef, setStatus],
  );

  const adoptMediaBlob = useCallback(
    async (
      mediaId: string,
      blob: Blob,
      options?: { analyze?: boolean; verify?: boolean },
    ): Promise<AdoptMediaResult> => {
      const existing = projectSnapshotRef.current.mediaItems.find(
        (item) => item.id === mediaId,
      );

      let warning: string | undefined;
      if (options?.verify) {
        const kind =
          existing?.kind ??
          inferMediaKind(blob instanceof File ? blob.name : "");
        let probed: MediaProbeResult;
        try {
          probed = await probeMediaBlob(blob, kind);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          setLocalMediaOverride(mediaId, {
            availability: "offline",
            lastError: message,
          });
          logClient("media:adopt:verify:error", { mediaId, message });
          throw error;
        }

        if (
          existing &&
          existing.durationSeconds > 0 &&
          probed.durationSeconds > 0 &&
          Math.abs(probed.durationSeconds - existing.durationSeconds) >
            RELINK_DURATION_TOLERANCE_SECONDS
        ) {
          warning = `Duration differs from the original (${probed.durationSeconds.toFixed(1)}s vs ${existing.durationSeconds.toFixed(1)}s)`;
          logClient("media:adopt:verify:warning", { mediaId, warning });
        }
      }

      try {
        const cached = await cacheMediaBlob(mediaId, blob);
        if (cached.status === "skipped") {
          reportMediaNotCached(mediaId, blob);
        }
      } catch (error) {
        logClient("media:adopt:cache:error", {
          mediaId,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      const previousPreviewUrl = mediaObjectUrlsRef.current.get(mediaId);
      const previewUrl = URL.createObjectURL(blob);
      mediaObjectUrlsRef.current.set(mediaId, previewUrl);
      setLocalMediaOverride(mediaId, { availability: "ready", previewUrl });
      if (previousPreviewUrl && previousPreviewUrl !== previewUrl) {
        revokeObjectUrl(previousPreviewUrl);
      }

      // Media saved before its file details were read gets them now.
      if (
        !existing ||
        !(
          options?.analyze ||
          existing.durationSeconds === 0 ||
          !hasMediaDetails(existing)
        )
      ) {
        return { previewUrl, warning };
      }

      try {
        const [result] = await getHarness().analyzeMedia(
          {
            kind: "files",
            files: [new File([blob], existing.name, { type: blob.type })],
          },
          PALETTE,
          0,
        );
        if (!result) {
          return { previewUrl, warning };
        }

        if (
          result.previewUrl.startsWith("blob:") &&
          result.previewUrl !== previewUrl
        ) {
          revokeObjectUrl(result.previewUrl);
        }
        const analyzed: MediaItem = {
          ...result,
          id: mediaId,
          color: existing.color,
          accent: existing.accent,
          sourcePath: existing.sourcePath ?? result.sourcePath,
          // The analyzed copy of a cached blob was modified just now.
          lastModified:
            blob instanceof File ? blob.lastModified : existing.lastModified,
          previewUrl,
        };
        seedLocalMediaItems([analyzed]);
        commitViewChange("Hydrate media", (current) =>
          patchProjectState(current, {
            mediaItems: mergeMediaItemsById(current.mediaItems, [
              toShareableMediaItem(analyzed),
            ]),
          }),
        );
      } catch (error) {
        logClient("media:adopt:analyze:error", {
          mediaId,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      return { previewUrl, warning };
    },
    [
      commitViewChange,
      projectSnapshotRef,
      reportMediaNotCached,
      seedLocalMediaItems,
      setLocalMediaOverride,
    ],
  );

  const cacheLocalMediaItems = useCallback(
    async (items: MediaItem[]) => {
      const harness = getHarness();
      await Promise.allSettled(
        items
          .filter((item) => item.previewUrl)
          .map(async (item) => {
            const blob = await harness.readMediaBlob(item);
            const cached = await cacheMediaBlob(item.id, blob);
            if (cached.status === "skipped") {
              reportMediaNotCached(item.id, blob, item.name);
            }
          }),
      );
    },
    [reportMediaNotCached],
  );

  useEffect(() => {
    localMediaOverridesRef.current = localMediaOverrides;
  }, [localMediaOverrides]);

  useEffect(
    () => () => {
      for (const url of mediaObjectUrlsRef.current.values()) {
        revokeObjectUrl(url);
      }
      mediaObjectUrlsRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    const activeIds = new Set(projectMediaItems.map((item) => item.id));
    setLocalMediaOverrides((current) => {
      let changed = false;
      const next: Record<string, LocalMediaOverride> = {};
      for (const [mediaId, override] of Object.entries(current)) {
        if (!activeIds.has(mediaId)) {
          const previewUrl = mediaObjectUrlsRef.current.get(mediaId);
          if (previewUrl) {
            revokeObjectUrl(previewUrl);
            mediaObjectUrlsRef.current.delete(mediaId);
          }
          changed = true;
          continue;
        }

        next[mediaId] = override;
      }

      return changed ? next : current;
    });
  }, [projectMediaItems]);

  // Media whose cached copy the storage dialog removed while it was loaded
  // from that copy can no longer be read, so it goes offline for relinking.
  const handleMediaStorageCleared = useCallback(
    (invalidatedIds: string[], clearedCount: number) => {
      for (const mediaId of invalidatedIds) {
        const previewUrl = mediaObjectUrlsRef.current.get(mediaId);
        if (previewUrl) {
          revokeObjectUrl(previewUrl);
          mediaObjectUrlsRef.current.delete(mediaId);
        }
      }
      if (invalidatedIds.length) {
        setLocalMediaOverrides((current) => {
          const next = { ...current };
          for (const mediaId of invalidatedIds) {
            next[mediaId] = {
              availability: "offline",
              lastError: "Its cached copy was cleared",
            };
          }
          return next;
        });
      }
      setStatus(
        `Cleared ${pluralize(clearedCount, "cached media file")}.${
          invalidatedIds.length
            ? ` ${pluralize(invalidatedIds.length, "file")} in this session went offline. ${LOCATE_OFFLINE_MEDIA_HINT}`
            : ""
        }`,
      );
    },
    [setStatus],
  );

  return {
    mediaItems,
    mediaItemsById,
    localMediaOverridesRef,
    setLocalMediaOverride,
    seedLocalMediaItems,
    reportMediaNotCached,
    adoptMediaBlob,
    cacheLocalMediaItems,
    handleMediaStorageCleared,
  };
}

export type MediaLibraryCommandsInputs = {
  projectMediaItems: MediaItem[];
  refuseReadOnlyEdit: () => boolean;
  commitProjectChange: (label: string, updater: ProjectUpdater) => void;
  seedLocalMediaItems: (items: MediaItem[]) => void;
  cacheLocalMediaItems: (items: MediaItem[]) => Promise<void>;
  setSourceTracksCollapsed: (collapsed: boolean) => void;
  offlineMedia: OfflineMediaEntry[];
  mediaItemsById: Map<string, MediaItem>;
  adoptMediaBlob: (
    mediaId: string,
    blob: Blob,
    options?: { analyze?: boolean; verify?: boolean },
  ) => Promise<AdoptMediaResult>;
  setStatus: (status: string) => void;
};

// Importing dropped media into source tracks and relinking offline media.
// They use the offline media state useMediaStatus derives after
// useMediaLibrary, so useMediaImport calls this hook after it.
export function useMediaLibraryCommands({
  projectMediaItems,
  refuseReadOnlyEdit,
  commitProjectChange,
  seedLocalMediaItems,
  cacheLocalMediaItems,
  setSourceTracksCollapsed,
  offlineMedia,
  mediaItemsById,
  adoptMediaBlob,
  setStatus,
}: MediaLibraryCommandsInputs) {
  const [relinkingMediaIds, setRelinkingMediaIds] = useState<
    ReadonlySet<string>
  >(() => new Set());

  const importMediaIntoSourceTrack = useCallback(
    async (files: File[], target: SourceTrackDropTarget) => {
      if (refuseReadOnlyEdit()) {
        return;
      }

      const harness = getHarness();

      try {
        setStatus(
          `Analyzing ${pluralize(files.length, "dropped media file")}...`,
        );
        const analyzed = await harness.analyzeMedia(
          {
            kind: "files",
            files,
          },
          PALETTE,
          projectMediaItems.length,
        );
        const sharedAnalyzed = analyzed.map((item) =>
          toShareableMediaItem(item),
        );

        commitProjectChange("Drop media into source tracks", (current) => {
          const placed = addMediaToSourceTrack(current, analyzed, target);
          const patch: Partial<ProjectState> = {
            mediaItems: [...current.mediaItems, ...sharedAnalyzed],
            ...placed,
          };
          if (
            !current.sessionName &&
            !current.mediaItems.length &&
            !current.sourceTracks.length &&
            !current.sourceSpans.length &&
            !current.clips.length
          ) {
            const sizedMedia = analyzed.find(
              (item) => item.width && item.height,
            );
            if (sizedMedia?.width && sizedMedia.height) {
              patch.canvasWidth = Math.max(320, sizedMedia.width);
              patch.canvasHeight = Math.max(320, sizedMedia.height);
            }
            const fps = mediaFrameRate(analyzed);
            if (fps) {
              patch.fps = fps;
            }
          }

          return patchProjectState(current, patch);
        });

        seedLocalMediaItems(analyzed);
        void cacheLocalMediaItems(analyzed);
        // Reveal the dropped media, even when it landed on a collapsed header.
        setSourceTracksCollapsed(false);
        setStatus(
          `Dropped ${pluralize(analyzed.length, "media file")} into ${
            target.kind === "track"
              ? "the selected source track"
              : "a new source track"
          }.`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`Dropped media import failed: ${message}`);
      }
    },
    [
      cacheLocalMediaItems,
      commitProjectChange,
      projectMediaItems.length,
      refuseReadOnlyEdit,
      seedLocalMediaItems,
      setSourceTracksCollapsed,
      setStatus,
    ],
  );

  // Media dragged from the Media drawer is already in the project, so its
  // clips reuse the media items, pre-trimmed to their In/Out points.
  const placeMediaInSourceTrack = useCallback(
    (mediaIds: string[], target: SourceTrackDropTarget) => {
      if (refuseReadOnlyEdit()) {
        return;
      }

      const ids = new Set(mediaIds);
      const count = projectMediaItems.filter((item) => ids.has(item.id))
        .length;
      if (!count) {
        setStatus("The dragged media is no longer in this session.");
        return;
      }

      commitProjectChange("Add media to source track", (current) => {
        const byId = new Map(current.mediaItems.map((item) => [item.id, item]));
        const items = mediaIds.flatMap((id) => byId.get(id) ?? []);
        return items.length
          ? patchProjectState(
              current,
              addMediaToSourceTrack(current, items, target),
            )
          : current;
      });
      setSourceTracksCollapsed(false);
      setStatus(
        `Added ${pluralize(count, "media clip")} to ${
          target.kind === "track"
            ? "the source track"
            : "a new source track"
        }.`,
      );
    },
    [
      commitProjectChange,
      projectMediaItems,
      refuseReadOnlyEdit,
      setSourceTracksCollapsed,
      setStatus,
    ],
  );

  // Rows show a spinner from the moment a batch starts until their own file
  // has been verified and adopted, so progress is visible item by item.
  function createOfflineMediaRelinker() {
    return createMediaRelinker({
      offlineMedia,
      mediaItemsById,
      adoptMediaBlob: async (mediaId, blob, options) => {
        try {
          return await adoptMediaBlob(mediaId, blob, options);
        } finally {
          updateRelinkingMediaIds([mediaId], false);
        }
      },
      log: logClient,
    });
  }

  function updateRelinkingMediaIds(ids: string[], relinking: boolean) {
    setRelinkingMediaIds((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (relinking) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      return next;
    });
  }

  async function relinkOfflineMedia(candidates: MediaRelinkCandidate[]) {
    const { matches } = matchOfflineMedia(
      offlineMedia.map((entry) => entry.item),
      candidates,
    );
    const ids = matches.map(({ item }) => item.id);
    updateRelinkingMediaIds(ids, true);
    try {
      return await createOfflineMediaRelinker().relinkMedia(candidates);
    } finally {
      updateRelinkingMediaIds(ids, false);
    }
  }

  async function relinkOfflineMediaItem(
    itemId: string,
    candidate: MediaRelinkCandidate,
  ) {
    updateRelinkingMediaIds([itemId], true);
    try {
      return await createOfflineMediaRelinker().relinkMediaItem(
        itemId,
        candidate,
      );
    } finally {
      updateRelinkingMediaIds([itemId], false);
    }
  }

  return {
    importMediaIntoSourceTrack,
    placeMediaInSourceTrack,
    relinkingMediaIds,
    relinkOfflineMedia,
    relinkOfflineMediaItem,
  };
}
