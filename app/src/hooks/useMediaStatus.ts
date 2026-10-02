import { useMemo } from "react";
import {
  describeSessionMediaStatus,
  isInSharedMediaSession,
  listRemoteMediaMisses,
  listSessionMediaSync,
  listSessionOfflineMedia,
} from "../app/media-status.ts";
import type {
  ArrangementClip,
  CollaborationMode,
  SourceSpan,
} from "../app/types.ts";
import type { CollaborationConnectionState } from "../collaboration";
import type { MediaItem } from "../media";
import { mediaSyncLabel, summarizeMediaSync } from "../media-sync.ts";
import type { RemoteMediaProgressMap } from "../remote-media-sync.ts";

export type MediaStatusInputs = {
  mediaItems: MediaItem[];
  timelineClips: ArrangementClip[];
  sourceSpans: SourceSpan[];
  remoteMediaProgress: RemoteMediaProgressMap;
  peerMediaMissIds: ReadonlySet<string>;
  failedSampleMediaIds: ReadonlySet<string>;
  collaborationMode: CollaborationMode;
  collaborationState: CollaborationConnectionState;
};

// The session's offline media and peer sync progress, as the header, the
// media dialogs and the status bar show them.
export function useMediaStatus({
  mediaItems,
  timelineClips,
  sourceSpans,
  remoteMediaProgress,
  peerMediaMissIds,
  failedSampleMediaIds,
  collaborationMode,
  collaborationState,
}: MediaStatusInputs) {
  const offlineMedia = useMemo(
    () => listSessionOfflineMedia(mediaItems, timelineClips, sourceSpans),
    [mediaItems, sourceSpans, timelineClips],
  );
  const inSharedMediaSession = isInSharedMediaSession(
    collaborationMode,
    collaborationState,
  );
  const misses = useMemo(
    () => listRemoteMediaMisses(peerMediaMissIds, failedSampleMediaIds),
    [failedSampleMediaIds, peerMediaMissIds],
  );
  const mediaSyncEntries = useMemo(
    () =>
      listSessionMediaSync({
        mediaItems,
        timelineClips,
        sourceSpans,
        progress: remoteMediaProgress,
        misses,
        inSharedSession: inSharedMediaSession,
      }),
    [
      inSharedMediaSession,
      mediaItems,
      misses,
      remoteMediaProgress,
      sourceSpans,
      timelineClips,
    ],
  );
  const mediaSyncSummary = useMemo(
    () => summarizeMediaSync(mediaSyncEntries),
    [mediaSyncEntries],
  );
  const mediaSyncStatusLabel = mediaSyncLabel(mediaSyncSummary);
  const offlineCount = mediaSyncSummary.offline;
  // The Media Sync dialog, rather than the offline media one, covers media
  // a peer may send or a download may deliver.
  const showsMediaSync =
    inSharedMediaSession ||
    mediaSyncEntries.some((entry) => entry.source === "url");
  const sessionMediaStatus = useMemo(
    () => describeSessionMediaStatus(mediaItems),
    [mediaItems],
  );

  return {
    offlineMedia,
    inSharedMediaSession,
    showsMediaSync,
    mediaSyncEntries,
    mediaSyncSummary,
    mediaSyncStatusLabel,
    offlineCount,
    sessionMediaStatus,
  };
}
